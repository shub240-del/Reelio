import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  createExport,
  getProject,
  getProjectAssets,
  getProjectCaptions,
  getProjectClips,
  getRecoverableExports,
  updateExport,
} from "./db";
import { createWorkerId, getCoordinationAdapter } from "./coordination";
import { renderTimelineToFile, type RenderAssetSource } from "./renderPipeline";
import { probeMediaFile } from "./mediaProbe";
import { storagePutFile, storageReadToFile } from "./storage";

const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_SOURCE_BYTES = 500 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 500 * 1024 * 1024;
const MAX_CAPTIONS = 10_000;
const RENDER_LEASE_MS = 15_000;
const MAX_RENDER_ATTEMPTS = 3;
const MAX_CONCURRENT_RENDERS_PER_USER = 2;
const activeRenders = new Map<number, AbortController>();
let ffmpegAvailability: Promise<boolean> | null = null;

const resolutions = {
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 },
} as const;

export type ServerRenderResolution = keyof typeof resolutions;

export interface StartServerExportOptions {
  requestId: string;
  includeCaptions?: boolean;
}

export function checkFfmpegAvailable(): Promise<boolean> {
  ffmpegAvailability ??= new Promise<boolean>(resolve => {
    const child = spawn(process.env.FFMPEG_PATH || "ffmpeg", ["-version"], {
      windowsHide: true,
      stdio: "ignore",
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(false);
    }, 3_000);
    child.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.once("close", code => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
  return ffmpegAvailability;
}

function srtTimestamp(seconds: number) {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

export function captionsToSrt(
  rows: Array<{ text: string; startTime: number; endTime: number }>
) {
  if (rows.length > MAX_CAPTIONS)
    throw new Error(`Caption count exceeds the ${MAX_CAPTIONS}-cue limit.`);
  const sorted = [...rows].sort(
    (a, b) => a.startTime - b.startTime || a.endTime - b.endTime
  );
  let previousEnd = 0;
  return sorted
    .map((row, index) => {
      if (
        !Number.isFinite(row.startTime) ||
        !Number.isFinite(row.endTime) ||
        row.startTime < 0 ||
        row.endTime <= row.startTime ||
        row.startTime < previousEnd - 1e-6
      ) {
        throw new Error("Captions contain invalid or overlapping timestamps.");
      }
      previousEnd = row.endTime;
      const text = row.text
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
        .replace(/\r\n?/g, "\n")
        .trim();
      if (!text) throw new Error("A caption cue is empty.");
      return `${index + 1}\n${srtTimestamp(row.startTime)} --> ${srtTimestamp(row.endTime)}\n${text}\n`;
    })
    .join("\n");
}

function sourceExtension(name: string) {
  const extension = path.extname(name).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(extension) ? extension : ".media";
}

async function renderExportJob(
  exportId: number,
  projectId: number,
  userId: number,
  resolution: ServerRenderResolution,
  includeCaptions: boolean,
  attempt: number
) {
  const coordination = getCoordinationAdapter();
  const workerId = createWorkerId();
  const jobKey = `export:${exportId}`;
  if (!(await coordination.acquireLease(jobKey, workerId, RENDER_LEASE_MS))) {
    return;
  }

  const controller = new AbortController();
  const tempRoot = path.resolve(os.tmpdir());
  let tempDir: string | null = null;
  let userLeaseKey: string | null = null;
  let clearSharedState = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  try {
    if (await coordination.isCancellationRequested(jobKey)) {
      clearSharedState = true;
      await updateExport(exportId, {
        status: "cancelled",
        errorMessage: "Render cancelled before processing started.",
      });
      return;
    }
    for (let slot = 0; slot < MAX_CONCURRENT_RENDERS_PER_USER; slot += 1) {
      const candidate = `export-user:${userId}:slot:${slot}`;
      if (
        await coordination.acquireLease(candidate, workerId, RENDER_LEASE_MS)
      ) {
        userLeaseKey = candidate;
        break;
      }
    }
    if (!userLeaseKey) {
      const timer = setTimeout(
        () =>
          launchRenderJob(
            exportId,
            projectId,
            userId,
            resolution,
            includeCaptions,
            attempt
          ),
        1_000
      );
      timer.unref?.();
      return;
    }
    tempDir = await fs.promises.mkdtemp(path.join(tempRoot, "reelio-render-"));
    activeRenders.set(exportId, controller);
    heartbeat = setInterval(() => {
      void Promise.all([
        coordination.isCancellationRequested(jobKey),
        coordination.renewLease(jobKey, workerId, RENDER_LEASE_MS),
        coordination.renewLease(userLeaseKey!, workerId, RENDER_LEASE_MS),
      ])
        .then(([cancelled, jobAlive, userSlotAlive]) => {
          if (cancelled || !jobAlive || !userSlotAlive) controller.abort();
        })
        .catch(() => controller.abort());
    }, 5_000);
    await updateExport(exportId, {
      status: "processing",
      progress: 0,
      attempt,
      errorMessage: null,
    });
    const project = await getProject(projectId, userId);
    if (!project)
      throw new Error("Project not found or not owned by this user.");
    const [clipRows, assetRows, captionRows] = await Promise.all([
      getProjectClips(projectId),
      getProjectAssets(projectId),
      includeCaptions ? getProjectCaptions(projectId) : Promise.resolve([]),
    ]);
    const visibleClips = clipRows.filter(
      clip => clip.visible && clip.duration > 0
    );
    const assetMap = new Map(assetRows.map(asset => [asset.id, asset]));
    const localAssets = new Map<number, RenderAssetSource>();
    let totalSourceBytes = 0;
    for (const assetId of new Set(visibleClips.map(clip => clip.assetId))) {
      const asset = assetMap.get(assetId);
      if (!asset || !/^(video|audio)\//.test(asset.mimeType)) {
        throw new Error("A timeline clip references unavailable media.");
      }
      const destination = path.join(
        tempDir,
        `source-${asset.id}${sourceExtension(asset.name)}`
      );
      totalSourceBytes += await storageReadToFile(
        asset.storageKey,
        destination,
        {
          maxBytes: MAX_SOURCE_BYTES,
          signal: controller.signal,
        }
      );
      if (totalSourceBytes > MAX_TOTAL_SOURCE_BYTES) {
        throw new Error("Render sources exceed the 500 MB aggregate limit.");
      }
      const measured = await probeMediaFile(destination, {
        expectedMimeType: asset.mimeType,
        signal: controller.signal,
      });
      localAssets.set(asset.id, {
        id: asset.id,
        localPath: destination,
        mimeType: asset.mimeType,
        duration: measured.duration,
        width: measured.width,
        height: measured.height,
        fps: measured.fps,
        hasAudio: measured.hasAudio,
      });
    }

    let subtitleFile: string | undefined;
    if (includeCaptions && captionRows.length > 0) {
      subtitleFile = path.join(tempDir, "captions.srt");
      await fs.promises.writeFile(
        subtitleFile,
        captionsToSrt(captionRows),
        "utf8"
      );
    }

    const outputPath = path.join(tempDir, "output.mp4");
    const { width, height } = resolutions[resolution];
    const command = await renderTimelineToFile(
      {
        clips: visibleClips,
        assets: [...localAssets.values()],
        width,
        height,
        fps: 30,
        subtitleFile,
      },
      outputPath,
      {
        signal: controller.signal,
        shouldCancel: () => coordination.isCancellationRequested(jobKey),
        onHeartbeat: () =>
          Promise.all([
            coordination.renewLease(jobKey, workerId, RENDER_LEASE_MS),
            coordination.renewLease(userLeaseKey!, workerId, RENDER_LEASE_MS),
          ]).then(results => results.every(Boolean)),
        onProgress: progress => {
          void updateExport(exportId, { progress });
        },
      }
    );
    const stored = await storagePutFile(
      `${userId}/projects/${projectId}/exports/${randomUUID()}.mp4`,
      outputPath,
      "video/mp4",
      MAX_OUTPUT_BYTES
    );
    await updateExport(exportId, {
      status: "done",
      progress: 100,
      storageKey: stored.key,
      url: stored.url,
      duration: command.duration,
      errorMessage: null,
    });
    clearSharedState = true;
  } catch (error) {
    const cancelled =
      controller.signal.aborted ||
      (await coordination.isCancellationRequested(jobKey).catch(() => false));
    await updateExport(exportId, {
      status: cancelled ? "cancelled" : "failed",
      errorMessage:
        error instanceof Error
          ? error.message.slice(0, 1000)
          : "Render failed.",
    });
    clearSharedState = true;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    activeRenders.delete(exportId);
    if (userLeaseKey)
      await coordination
        .releaseLease(userLeaseKey, workerId)
        .catch(() => undefined);
    await coordination.releaseLease(jobKey, workerId).catch(() => undefined);
    if (clearSharedState)
      await coordination.clearJobState(jobKey).catch(() => undefined);
    if (tempDir) {
      const resolvedTemp = path.resolve(tempDir);
      if (
        path.dirname(resolvedTemp) === tempRoot &&
        path.basename(resolvedTemp).startsWith("reelio-render-")
      ) {
        await fs.promises.rm(resolvedTemp, { recursive: true, force: true });
      }
    }
  }
}

function launchRenderJob(
  exportId: number,
  projectId: number,
  userId: number,
  resolution: ServerRenderResolution,
  includeCaptions: boolean,
  attempt: number
) {
  void renderExportJob(
    exportId,
    projectId,
    userId,
    resolution,
    includeCaptions,
    attempt
  ).catch(async error => {
    await updateExport(exportId, {
      status: "failed",
      errorMessage:
        error instanceof Error
          ? error.message.slice(0, 1000)
          : "Render coordination failed.",
    });
  });
}

export async function startServerExport(
  projectId: number,
  userId: number,
  resolution: ServerRenderResolution,
  options: StartServerExportOptions
) {
  const project = await getProject(projectId, userId);
  if (!project) throw new Error("Project not found or not owned by this user.");
  const row = await createExport({
    requestId: options.requestId,
    projectId,
    userId,
    storageKey: "",
    url: "",
    resolution,
    format: "mp4",
    includeCaptions: options.includeCaptions ?? false,
    duration: 0,
    status: "queued",
    progress: 0,
    attempt: 0,
  });
  if (!row) throw new Error("Could not create export job.");
  if (row.status === "queued" && row.attempt < MAX_RENDER_ATTEMPTS) {
    launchRenderJob(
      row.id,
      projectId,
      userId,
      resolution,
      row.includeCaptions,
      row.attempt + 1
    );
  }
  return row;
}

export async function cancelServerExport(exportId: number) {
  const jobKey = `export:${exportId}`;
  await getCoordinationAdapter().requestCancellation(jobKey);
  activeRenders.get(exportId)?.abort();
  return true;
}

/** Resume queued or abandoned work. Redis leases prevent duplicate workers. */
export async function recoverServerExports() {
  const rows = await getRecoverableExports();
  for (const row of rows) {
    if (row.attempt >= MAX_RENDER_ATTEMPTS) {
      const coordination = getCoordinationAdapter();
      const workerId = createWorkerId();
      const key = `export:${row.id}`;
      if (await coordination.acquireLease(key, workerId, 2_000)) {
        await updateExport(row.id, {
          status: "failed",
          errorMessage: "Render stopped after the maximum recovery attempts.",
        });
        await coordination.releaseLease(key, workerId);
      }
      continue;
    }
    launchRenderJob(
      row.id,
      row.projectId,
      row.userId,
      row.resolution === "1080p" ? "1080p" : "720p",
      row.includeCaptions,
      row.attempt + 1
    );
  }
  return rows.length;
}
