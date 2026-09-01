import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ENV } from "./_core/env";
import {
  createCaption,
  createMediaAnalysis,
  getAsset,
  getAssetCaptions,
  getMediaAnalysis,
  getProject,
  getRecoverableMediaAnalyses,
  updateMediaAnalysis,
} from "./db";
import { createWorkerId, getCoordinationAdapter } from "./coordination";
import { storageReadToFile } from "./storage";
import { probeMediaFile } from "./mediaProbe";

const MAX_ANALYSIS_BYTES = 50 * 1024 * 1024;
const MAX_TRANSCRIPTION_BYTES = 16 * 1024 * 1024;
const ANALYSIS_TIMEOUT_MS = 2 * 60 * 1000;
const ANALYSIS_LEASE_MS = 15_000;
const MAX_ANALYSIS_ATTEMPTS = 3;
const MAX_CONCURRENT_ANALYSES_PER_USER = 2;

export type AnalysisKind = "transcription" | "scene";

export interface TimestampedWord {
  word: string;
  start: number;
  end: number;
  confidence?: number;
}

export interface TranscriptSegment {
  text: string;
  start: number;
  end: number;
  words: TimestampedWord[];
}

export interface CaptionCueResult {
  text: string;
  startTime: number;
  endTime: number;
}

export interface FillerOccurrence {
  text: string;
  start: number;
  end: number;
}

export interface SceneBoundaryResult {
  time: number;
  confidence: number;
}

export const transcriptAnalysisResultSchema = z.object({
  provider: z.string().min(1).max(64),
  language: z.string().max(32).nullable(),
  text: z.string().max(2_000_000),
  segments: z.array(
    z.object({
      text: z.string().min(1).max(20_000),
      start: z.number().finite().min(0),
      end: z.number().finite().positive(),
      words: z.array(
        z.object({
          word: z.string().min(1).max(256),
          start: z.number().finite().min(0),
          end: z.number().finite().positive(),
          confidence: z.number().finite().min(0).max(1).optional(),
        })
      ),
    })
  ),
  words: z.array(
    z.object({
      word: z.string().min(1).max(256),
      start: z.number().finite().min(0),
      end: z.number().finite().positive(),
      confidence: z.number().finite().min(0).max(1).optional(),
    })
  ),
  fillers: z.array(
    z.object({
      text: z.string().min(1).max(512),
      start: z.number().finite().min(0),
      end: z.number().finite().positive(),
    })
  ),
  captions: z.array(
    z.object({
      text: z.string().min(1).max(20_000),
      startTime: z.number().finite().min(0),
      endTime: z.number().finite().positive(),
    })
  ),
});

const fillerSingles = new Set([
  "um",
  "umm",
  "uh",
  "uhh",
  "er",
  "err",
  "ah",
  "ahh",
  "like",
  "basically",
  "actually",
]);
const fillerPairs = new Set(["you know", "sort of", "kind of"]);

function cleanWord(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function detectTimestampedFillers(words: TimestampedWord[]) {
  const output: FillerOccurrence[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const cleaned = cleanWord(word.word);
    if (fillerSingles.has(cleaned)) {
      output.push({ text: word.word, start: word.start, end: word.end });
      continue;
    }
    const next = words[index + 1];
    if (next && fillerPairs.has(`${cleaned} ${cleanWord(next.word)}`)) {
      output.push({
        text: `${word.word} ${next.word}`,
        start: word.start,
        end: next.end,
      });
      index += 1;
    }
  }
  return output;
}

function validateCues(cues: CaptionCueResult[]) {
  const sorted = [...cues].sort(
    (a, b) => a.startTime - b.startTime || a.endTime - b.endTime
  );
  let previousEnd = 0;
  for (const cue of sorted) {
    if (
      !cue.text.trim() ||
      !Number.isFinite(cue.startTime) ||
      !Number.isFinite(cue.endTime) ||
      cue.startTime < 0 ||
      cue.endTime <= cue.startTime ||
      cue.startTime < previousEnd - 1e-6
    ) {
      throw new Error("Caption timestamps are invalid or overlapping.");
    }
    previousEnd = cue.endTime;
  }
  return sorted;
}

function timestamp(seconds: number, separator: "," | ".") {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}${separator}${String(millis).padStart(3, "0")}`;
}

export function captionsToSrtText(cues: CaptionCueResult[]) {
  return validateCues(cues)
    .map(
      (cue, index) =>
        `${index + 1}\n${timestamp(cue.startTime, ",")} --> ${timestamp(cue.endTime, ",")}\n${cue.text.trim()}\n`
    )
    .join("\n");
}

export function captionsToWebVtt(cues: CaptionCueResult[]) {
  return `WEBVTT\n\n${validateCues(cues)
    .map(
      cue =>
        `${timestamp(cue.startTime, ".")} --> ${timestamp(cue.endTime, ".")}\n${cue.text.trim()}\n`
    )
    .join("\n")}`;
}

const providerWordSchema = z.object({
  word: z.string().min(1).max(256),
  start: z.number().finite().min(0),
  end: z.number().finite().positive(),
  probability: z.number().finite().min(0).max(1).optional(),
  confidence: z.number().finite().min(0).max(1).optional(),
});
const providerSegmentSchema = z.object({
  text: z.string().min(1).max(20_000),
  start: z.number().finite().min(0),
  end: z.number().finite().positive(),
});
const transcriptionSchema = z.object({
  language: z.string().max(32).optional(),
  duration: z.number().finite().positive().optional(),
  text: z.string().max(2_000_000),
  segments: z.array(providerSegmentSchema).max(50_000),
  words: z.array(providerWordSchema).max(500_000).optional().default([]),
});

export function transcriptionProviderAvailable() {
  return Boolean(ENV.forgeApiUrl && ENV.forgeApiKey);
}

async function transcribeWithForge(
  filePath: string,
  mimeType: string,
  signal: AbortSignal
) {
  if (!transcriptionProviderAvailable()) {
    throw new Error(
      "Timestamped transcription is unavailable because Forge speech credentials are not configured."
    );
  }
  const stats = await fs.promises.stat(filePath);
  if (stats.size > MAX_TRANSCRIPTION_BYTES)
    throw new Error("Transcription input exceeds the 16 MB provider limit.");
  const bytes = await fs.promises.readFile(filePath);
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(bytes)], { type: mimeType }),
    "owned-media"
  );
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  form.append("timestamp_granularities[]", "segment");
  const response = await fetch(
    new URL(
      "v1/audio/transcriptions",
      ENV.forgeApiUrl.replace(/\/+$/, "") + "/"
    ),
    {
      method: "POST",
      headers: { authorization: `Bearer ${ENV.forgeApiKey}` },
      body: form,
      signal,
    }
  );
  if (!response.ok)
    throw new Error(`Transcription provider returned HTTP ${response.status}.`);
  const parsed = transcriptionSchema.safeParse(await response.json());
  if (!parsed.success)
    throw new Error("Transcription provider returned malformed timestamps.");
  return parsed.data;
}

function normalizeTranscript(input: z.infer<typeof transcriptionSchema>) {
  const words = input.words
    .map(word => ({
      word: word.word,
      start: word.start,
      end: word.end,
      confidence: word.confidence ?? word.probability,
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  let previousWordEnd = 0;
  for (const word of words) {
    if (word.end <= word.start || word.start < previousWordEnd - 0.05)
      throw new Error(
        "Transcription provider returned overlapping word timestamps."
      );
    previousWordEnd = Math.max(previousWordEnd, word.end);
  }
  const segments: TranscriptSegment[] = [];
  let previousEnd = 0;
  for (const segment of [...input.segments].sort((a, b) => a.start - b.start)) {
    const start = Math.max(segment.start, previousEnd);
    if (segment.end <= start) continue;
    segments.push({
      text: segment.text.trim(),
      start,
      end: segment.end,
      words: words.filter(
        word => word.start >= start && word.end <= segment.end
      ),
    });
    previousEnd = segment.end;
  }
  const captions = validateCues(
    segments.map(segment => ({
      text: segment.text,
      startTime: segment.start,
      endTime: segment.end,
    }))
  );
  return transcriptAnalysisResultSchema.parse({
    provider: "forge-whisper",
    language: input.language ?? null,
    text: input.text,
    segments,
    words,
    fillers: detectTimestampedFillers(words),
    captions,
  });
}

export async function detectSceneBoundaries(
  filePath: string,
  signal: AbortSignal,
  threshold = 0.3
) {
  if (!Number.isFinite(threshold) || threshold < 0.05 || threshold > 0.9)
    throw new Error("Scene threshold is outside the supported range.");
  const binary = process.env.FFMPEG_PATH || "ffmpeg";
  const filter = `select=gt(scene\\,${threshold.toFixed(3)}),metadata=print`;
  const stderr = await new Promise<string>((resolve, reject) => {
    const child = spawn(
      binary,
      [
        "-hide_banner",
        "-nostdin",
        "-i",
        filePath,
        "-filter:v",
        filter,
        "-an",
        "-f",
        "null",
        "-",
      ],
      { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] }
    );
    let output = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      error ? reject(error) : resolve(output);
    };
    const abort = () => {
      child.kill("SIGKILL");
      finish(new Error("Media analysis cancelled."));
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("Scene detection exceeded the two-minute limit."));
    }, ANALYSIS_TIMEOUT_MS);
    signal.addEventListener("abort", abort, { once: true });
    child.stderr.on("data", chunk => {
      if (output.length < 2_000_000) output += chunk.toString("utf8");
    });
    child.once("error", () =>
      finish(new Error("FFmpeg could not be started."))
    );
    child.once("close", code => {
      if (settled) return;
      code === 0
        ? finish()
        : finish(
            new Error("FFmpeg could not decode the media for scene detection.")
          );
    });
  });
  const lines = stderr.split(/\r?\n/);
  const boundaries: SceneBoundaryResult[] = [];
  let pendingTime: number | null = null;
  for (const line of lines) {
    const time = line.match(/pts_time:([0-9.]+)/);
    if (time) pendingTime = Number(time[1]);
    const score = line.match(/lavfi\.scene_score=([0-9.]+)/);
    if (score && pendingTime !== null) {
      boundaries.push({
        time: pendingTime,
        confidence: Number(score[1]),
      });
      pendingTime = null;
    }
  }
  return boundaries;
}

async function runAnalysisJob(
  id: string,
  assetId: number,
  userId: number,
  kind: AnalysisKind,
  attempt: number
) {
  const coordination = getCoordinationAdapter();
  const workerId = createWorkerId();
  const jobKey = `analysis:${id}`;
  if (!(await coordination.acquireLease(jobKey, workerId, ANALYSIS_LEASE_MS)))
    return;
  const controller = new AbortController();
  const tempRoot = path.resolve(os.tmpdir());
  let tempDir: string | null = null;
  let userLeaseKey: string | null = null;
  let clearSharedState = false;
  let watchdog: ReturnType<typeof setInterval> | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    if (await coordination.isCancellationRequested(jobKey)) {
      clearSharedState = true;
      await updateMediaAnalysis(id, userId, {
        status: "cancelled",
        errorMessage: "Analysis cancelled before processing started.",
      });
      return;
    }
    for (let slot = 0; slot < MAX_CONCURRENT_ANALYSES_PER_USER; slot += 1) {
      const candidate = `analysis-user:${userId}:slot:${slot}`;
      if (
        await coordination.acquireLease(candidate, workerId, ANALYSIS_LEASE_MS)
      ) {
        userLeaseKey = candidate;
        break;
      }
    }
    if (!userLeaseKey) {
      const retryTimer = setTimeout(
        () => launchAnalysisJob(id, assetId, userId, kind, attempt),
        1_000
      );
      retryTimer.unref?.();
      return;
    }
    tempDir = await fs.promises.mkdtemp(
      path.join(tempRoot, "reelio-analysis-")
    );
    watchdog = setInterval(() => {
      void Promise.all([
        coordination.isCancellationRequested(jobKey),
        coordination.renewLease(jobKey, workerId, ANALYSIS_LEASE_MS),
        coordination.renewLease(userLeaseKey!, workerId, ANALYSIS_LEASE_MS),
      ])
        .then(([cancelled, jobAlive, userSlotAlive]) => {
          if (cancelled || !jobAlive || !userSlotAlive) controller.abort();
        })
        .catch(() => controller.abort());
    }, 5_000);
    timeout = setTimeout(() => controller.abort(), ANALYSIS_TIMEOUT_MS);
    await updateMediaAnalysis(id, userId, {
      status: "processing",
      progress: 5,
      attempt,
      errorMessage: null,
    });
    const asset = await getAsset(assetId);
    if (!asset || asset.userId !== userId)
      throw new Error("Asset not found or not owned by this user.");
    const extension = /^\.[a-z0-9]{1,8}$/i.test(path.extname(asset.name))
      ? path.extname(asset.name)
      : ".media";
    const inputPath = path.join(tempDir, `source${extension}`);
    await storageReadToFile(asset.storageKey, inputPath, {
      maxBytes: MAX_ANALYSIS_BYTES,
      signal: controller.signal,
    });
    const measured = await probeMediaFile(inputPath, {
      expectedMimeType: asset.mimeType,
      signal: controller.signal,
    });
    if (kind === "scene" && !measured.hasVideo)
      throw new Error("Scene detection requires a video stream.");
    if (kind === "transcription" && !measured.hasAudio)
      throw new Error("Transcription requires an audio stream.");
    await updateMediaAnalysis(id, userId, { progress: 25 });

    let result: Record<string, unknown>;
    if (kind === "scene") {
      if (!asset.mimeType.startsWith("video/"))
        throw new Error("Scene detection requires a video asset.");
      result = {
        provider: "ffmpeg-scene-score",
        threshold: 0.3,
        boundaries: await detectSceneBoundaries(inputPath, controller.signal),
      };
    } else {
      const transcript = normalizeTranscript(
        await transcribeWithForge(inputPath, asset.mimeType, controller.signal)
      );
      result = transcript;
      if ((await getAssetCaptions(assetId)).length === 0) {
        for (const cue of transcript.captions) {
          await createCaption({
            projectId: asset.projectId,
            assetId,
            text: cue.text,
            startTime: cue.startTime,
            endTime: cue.endTime,
          });
        }
      }
    }
    await updateMediaAnalysis(id, userId, {
      status: "done",
      progress: 100,
      resultJson: JSON.stringify(result),
      errorMessage: null,
    });
    clearSharedState = true;
  } catch (error) {
    const cancelled =
      controller.signal.aborted ||
      (await coordination.isCancellationRequested(jobKey).catch(() => false));
    await updateMediaAnalysis(id, userId, {
      status: cancelled ? "cancelled" : "failed",
      errorMessage:
        error instanceof Error
          ? error.message.slice(0, 1000)
          : "Media analysis failed.",
    });
    clearSharedState = true;
  } finally {
    if (watchdog) clearInterval(watchdog);
    if (timeout) clearTimeout(timeout);
    if (userLeaseKey)
      await coordination
        .releaseLease(userLeaseKey, workerId)
        .catch(() => undefined);
    await coordination.releaseLease(jobKey, workerId).catch(() => undefined);
    if (clearSharedState)
      await coordination.clearJobState(jobKey).catch(() => undefined);
    if (tempDir) {
      const resolved = path.resolve(tempDir);
      if (
        path.dirname(resolved) === tempRoot &&
        path.basename(resolved).startsWith("reelio-analysis-")
      ) {
        await fs.promises.rm(resolved, { recursive: true, force: true });
      }
    }
  }
}

function launchAnalysisJob(
  id: string,
  assetId: number,
  userId: number,
  kind: AnalysisKind,
  attempt: number
) {
  void runAnalysisJob(id, assetId, userId, kind, attempt).catch(async error => {
    await updateMediaAnalysis(id, userId, {
      status: "failed",
      errorMessage:
        error instanceof Error
          ? error.message.slice(0, 1000)
          : "Analysis coordination failed.",
    });
  });
}

export async function startMediaAnalysis(input: {
  requestId: string;
  projectId: number;
  assetId: number;
  userId: number;
  kind: AnalysisKind;
}) {
  const [project, asset] = await Promise.all([
    getProject(input.projectId, input.userId),
    getAsset(input.assetId),
  ]);
  if (
    !project ||
    !asset ||
    asset.projectId !== input.projectId ||
    asset.userId !== input.userId
  ) {
    throw new Error("Asset not found or not owned by this user.");
  }
  const provider =
    input.kind === "scene"
      ? "ffmpeg-scene-score"
      : transcriptionProviderAvailable()
        ? "forge-whisper"
        : "unavailable";
  const row = await createMediaAnalysis({
    id: randomUUID(),
    requestId: input.requestId,
    projectId: input.projectId,
    assetId: input.assetId,
    userId: input.userId,
    kind: input.kind,
    status: provider === "unavailable" ? "failed" : "queued",
    progress: 0,
    attempt: 0,
    provider,
    errorMessage:
      provider === "unavailable"
        ? "Timestamped transcription is unavailable because Forge speech credentials are not configured."
        : null,
  });
  if (!row) throw new Error("Could not create media-analysis job.");
  if (row.status === "queued" && row.attempt < MAX_ANALYSIS_ATTEMPTS) {
    launchAnalysisJob(
      row.id,
      input.assetId,
      input.userId,
      input.kind,
      row.attempt + 1
    );
  }
  return row;
}

export async function cancelMediaAnalysis(id: string, userId: number) {
  const row = await getMediaAnalysis(id, userId);
  if (!row) return false;
  await getCoordinationAdapter().requestCancellation(`analysis:${id}`);
  return true;
}

/** Resume queued or abandoned analysis work after process termination. */
export async function recoverMediaAnalyses() {
  const rows = await getRecoverableMediaAnalyses();
  for (const row of rows) {
    if (row.attempt >= MAX_ANALYSIS_ATTEMPTS) {
      const coordination = getCoordinationAdapter();
      const workerId = createWorkerId();
      const key = `analysis:${row.id}`;
      if (await coordination.acquireLease(key, workerId, 2_000)) {
        await updateMediaAnalysis(row.id, row.userId, {
          status: "failed",
          errorMessage: "Analysis stopped after the maximum recovery attempts.",
        });
        await coordination.releaseLease(key, workerId);
      }
      continue;
    }
    launchAnalysisJob(
      row.id,
      row.assetId,
      row.userId,
      row.kind,
      row.attempt + 1
    );
  }
  return rows.length;
}
