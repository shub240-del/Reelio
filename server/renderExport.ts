import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  createExport,
  getProject,
  getProjectAssets,
  getProjectClips,
  updateExport,
} from "./db";
import { storagePut, storageReadToFile } from "./storage";

const MAX_RENDER_DURATION_SECONDS = 2 * 60 * 60;
const MAX_RENDER_CLIPS = 100;
const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 500 * 1024 * 1024;
const activeRenders = new Map<number, AbortController>();
let ffmpegAvailability: Promise<boolean> | null = null;

const resolutions = {
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 },
} as const;

export type ServerRenderResolution = keyof typeof resolutions;

const effectFilter: Record<string, string> = {
  "Cinematic LUT": "eq=contrast=1.2:saturation=1.2:brightness=-0.05",
  "Vibrant HDR": "eq=contrast=1.1:saturation=1.45:brightness=0.05",
  "Film Grain": "eq=contrast=1.1:saturation=0.85",
  "Vignette Blur": "vignette=PI/5",
  "Glow Accent": "eq=brightness=0.1:saturation=1.25",
  Sharpen: "unsharp=5:5:0.8:3:3:0.4",
};

export function checkFfmpegAvailable(): Promise<boolean> {
  ffmpegAvailability ??= new Promise<boolean>(resolve => {
    const child = spawn(process.env.FFMPEG_PATH || "ffmpeg", ["-version"], {
      windowsHide: true,
      stdio: "ignore",
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(false);
    }, 3000);
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

function parseFfmpegTime(value: string) {
  const [hours, minutes, seconds] = value.split(":").map(Number);
  return hours * 3600 + minutes * 60 + seconds;
}

async function runFfmpeg(
  args: string[],
  duration: number,
  signal: AbortSignal,
  onProgress: (progress: number) => void
) {
  const binary = process.env.FFMPEG_PATH || "ffmpeg";
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, args, {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let settled = false;
    let lastProgress = 0;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      error ? reject(error) : resolve();
    };
    const abort = () => {
      child.kill("SIGKILL");
      finish(new Error("Render cancelled."));
    };
    const timeout = setTimeout(
      () => {
        child.kill("SIGKILL");
        finish(new Error("Render exceeded the 15-minute processing limit."));
      },
      15 * 60 * 1000
    );
    signal.addEventListener("abort", abort, { once: true });
    child.once("error", () =>
      finish(new Error("FFmpeg is not installed or could not be started."))
    );
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      for (const match of text.matchAll(
        /time=(\d{2}:\d{2}:\d{2}(?:\.\d+)?)/g
      )) {
        const progress = Math.min(
          95,
          Math.floor((parseFfmpegTime(match[1]) / duration) * 95)
        );
        if (progress >= lastProgress + 5) {
          lastProgress = progress;
          onProgress(progress);
        }
      }
    });
    child.once("close", code => {
      if (signal.aborted) return;
      if (code === 0) finish();
      else finish(new Error(`FFmpeg exited with code ${code ?? "unknown"}.`));
    });
  });
}

async function renderExportJob(
  exportId: number,
  projectId: number,
  userId: number,
  resolution: ServerRenderResolution
) {
  const controller = new AbortController();
  activeRenders.set(exportId, controller);
  const tempRoot = path.resolve(os.tmpdir());
  const tempDir = await fs.promises.mkdtemp(
    path.join(tempRoot, "reelio-render-")
  );
  try {
    const project = await getProject(projectId, userId);
    if (!project)
      throw new Error("Project not found or not owned by this user.");
    const [clipRows, assetRows] = await Promise.all([
      getProjectClips(projectId),
      getProjectAssets(projectId),
    ]);
    const assetMap = new Map(assetRows.map(asset => [asset.id, asset]));
    const videoClips = clipRows
      .filter(
        clip => clip.trackType === "video" && clip.visible && clip.duration > 0
      )
      .sort((a, b) => a.timelineStart - b.timelineStart);
    const separateAudio = clipRows.some(
      clip => clip.trackType === "audio" && clip.visible && !clip.muted
    );
    if (separateAudio) {
      throw new Error(
        "Server MP4 export does not yet mix separate audio tracks; use browser WebM export."
      );
    }
    if (videoClips.length === 0)
      throw new Error("No visible video clips are available to render.");
    if (videoClips.length > MAX_RENDER_CLIPS)
      throw new Error("Render exceeds the 100-clip limit.");
    let cursor = 0;
    for (const clip of videoClips) {
      if (clip.timelineStart < cursor - 1e-6) {
        throw new Error(
          "Overlapping video tracks are not supported by server MP4 export."
        );
      }
      cursor = clip.timelineStart + clip.duration;
    }
    if (cursor > MAX_RENDER_DURATION_SECONDS)
      throw new Error("Render exceeds the two-hour limit.");

    const localAssets = new Map<number, string>();
    for (const assetId of new Set(videoClips.map(clip => clip.assetId))) {
      const asset = assetMap.get(assetId);
      if (!asset || !asset.mimeType.startsWith("video/")) {
        throw new Error("A timeline clip references unavailable video media.");
      }
      const destination = path.join(
        tempDir,
        `source-${asset.id}${path.extname(asset.name) || ".bin"}`
      );
      await storageReadToFile(asset.storageKey, destination, {
        maxBytes: MAX_SOURCE_BYTES,
        signal: controller.signal,
      });
      localAssets.set(asset.id, destination);
    }

    const { width, height } = resolutions[resolution];
    const args = ["-hide_banner", "-nostdin", "-y"];
    for (const clip of videoClips)
      args.push("-i", localAssets.get(clip.assetId)!);

    const filters: string[] = [];
    const segments: Array<{ video: string; audio: string }> = [];
    cursor = 0;
    for (let index = 0; index < videoClips.length; index += 1) {
      const clip = videoClips[index];
      const gap = clip.timelineStart - cursor;
      if (gap > 0.001) {
        const gapIndex = segments.length;
        filters.push(
          `color=c=black:s=${width}x${height}:r=30:d=${gap.toFixed(6)}[vg${gapIndex}]`
        );
        filters.push(
          `anullsrc=r=48000:cl=stereo:d=${gap.toFixed(6)}[ag${gapIndex}]`
        );
        segments.push({ video: `vg${gapIndex}`, audio: `ag${gapIndex}` });
      }
      const segmentIndex = segments.length;
      const effect = clip.videoFx ? effectFilter[clip.videoFx] : undefined;
      const videoChain = [
        `trim=start=${clip.sourceStart.toFixed(6)}:duration=${clip.duration.toFixed(6)}`,
        "setpts=PTS-STARTPTS",
        `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`,
        "fps=30",
        "format=yuv420p",
        ...(effect ? [effect] : []),
      ].join(",");
      filters.push(`[${index}:v:0]${videoChain}[v${segmentIndex}]`);
      const asset = assetMap.get(clip.assetId)!;
      if (asset.hasAudio && !clip.muted) {
        filters.push(
          `[${index}:a:0]atrim=start=${clip.sourceStart.toFixed(6)}:duration=${clip.duration.toFixed(6)},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo[a${segmentIndex}]`
        );
      } else {
        filters.push(
          `anullsrc=r=48000:cl=stereo:d=${clip.duration.toFixed(6)}[a${segmentIndex}]`
        );
      }
      segments.push({ video: `v${segmentIndex}`, audio: `a${segmentIndex}` });
      cursor = clip.timelineStart + clip.duration;
    }
    const concatInputs = segments
      .map(segment => `[${segment.video}][${segment.audio}]`)
      .join("");
    filters.push(
      `${concatInputs}concat=n=${segments.length}:v=1:a=1[outv][outa]`
    );

    const outputPath = path.join(tempDir, "output.mp4");
    args.push(
      "-filter_complex",
      filters.join(";"),
      "-map",
      "[outv]",
      "-map",
      "[outa]",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "20",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      outputPath
    );
    await runFfmpeg(args, cursor, controller.signal, progress => {
      void updateExport(exportId, { progress });
    });
    const outputStats = await fs.promises.stat(outputPath);
    if (outputStats.size <= 0)
      throw new Error("FFmpeg produced an empty output.");
    if (outputStats.size > MAX_OUTPUT_BYTES) {
      throw new Error("Rendered output exceeds the 500 MB server limit.");
    }
    const output = await fs.promises.readFile(outputPath);
    const stored = await storagePut(
      `${userId}/projects/${projectId}/exports/${randomUUID()}.mp4`,
      output,
      "video/mp4"
    );
    await updateExport(exportId, {
      status: "done",
      progress: 100,
      storageKey: stored.key,
      url: stored.url,
      duration: cursor,
      errorMessage: null,
    });
  } catch (error) {
    await updateExport(exportId, {
      status: controller.signal.aborted ? "cancelled" : "failed",
      errorMessage:
        error instanceof Error
          ? error.message.slice(0, 1000)
          : "Render failed.",
    });
  } finally {
    activeRenders.delete(exportId);
    const resolvedTemp = path.resolve(tempDir);
    if (
      path.dirname(resolvedTemp) === tempRoot &&
      path.basename(resolvedTemp).startsWith("reelio-render-")
    ) {
      await fs.promises.rm(resolvedTemp, { recursive: true, force: true });
    }
  }
}

export async function startServerExport(
  projectId: number,
  userId: number,
  resolution: ServerRenderResolution
) {
  const project = await getProject(projectId, userId);
  if (!project) throw new Error("Project not found or not owned by this user.");
  const row = await createExport({
    projectId,
    userId,
    storageKey: "",
    url: "",
    resolution,
    format: "mp4",
    duration: 0,
    status: "processing",
    progress: 0,
  });
  if (!row) throw new Error("Could not create export job.");
  void renderExportJob(row.id, projectId, userId, resolution);
  return row;
}

export function cancelServerExport(exportId: number) {
  const controller = activeRenders.get(exportId);
  if (!controller) return false;
  controller.abort();
  return true;
}
