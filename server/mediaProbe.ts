import { spawn } from "node:child_process";
import { z } from "zod";

export const MEDIA_LIMITS = {
  maxDurationSeconds: 2 * 60 * 60,
  maxWidth: 8192,
  maxHeight: 8192,
  maxPixels: 8192 * 4096,
  maxFps: 240,
  maxStreams: 16,
  probeTimeoutMs: 10_000,
  maxProbeOutputBytes: 1024 * 1024,
} as const;

const allowedVideoCodecs = new Set([
  "h264",
  "hevc",
  "vp8",
  "vp9",
  "av1",
  "mpeg4",
  "prores",
  "mjpeg",
  "png",
  "webp",
]);
const allowedAudioCodecs = new Set([
  "aac",
  "mp3",
  "opus",
  "vorbis",
  "flac",
  "alac",
  "pcm_s16le",
  "pcm_s24le",
  "pcm_s32le",
  "pcm_f32le",
  "pcm_f64le",
]);

const rawProbeSchema = z.object({
  streams: z
    .array(
      z.object({
        codec_name: z.string().optional(),
        codec_type: z.string().optional(),
        width: z.number().int().nonnegative().optional(),
        height: z.number().int().nonnegative().optional(),
        avg_frame_rate: z.string().optional(),
        r_frame_rate: z.string().optional(),
        duration: z.string().optional(),
      })
    )
    .max(MEDIA_LIMITS.maxStreams),
  format: z
    .object({
      duration: z.string().optional(),
      format_name: z.string().optional(),
    })
    .optional(),
});

export interface ProbedMedia {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  hasVideo: boolean;
  videoCodec: string | null;
  audioCodec: string | null;
  formatName: string | null;
}

function positiveNumber(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function frameRate(value: string | undefined) {
  if (!value) return 0;
  const [numerator, denominator = "1"] = value.split("/");
  const top = Number(numerator);
  const bottom = Number(denominator);
  return Number.isFinite(top) && Number.isFinite(bottom) && bottom > 0
    ? top / bottom
    : 0;
}

function validateProbe(raw: unknown, expectedMimeType?: string): ProbedMedia {
  const parsed = rawProbeSchema.parse(raw);
  const isStillImage = expectedMimeType?.startsWith("image/") ?? false;
  const videoStreams = parsed.streams.filter(
    stream => stream.codec_type === "video"
  );
  const audioStreams = parsed.streams.filter(
    stream => stream.codec_type === "audio"
  );
  if (videoStreams.length + audioStreams.length === 0)
    throw new Error("The file contains no supported audio or video streams.");
  if (
    videoStreams.some(
      stream => !allowedVideoCodecs.has(stream.codec_name ?? "")
    )
  )
    throw new Error("The file uses an unsupported video codec.");
  if (
    audioStreams.some(
      stream => !allowedAudioCodecs.has(stream.codec_name ?? "")
    )
  )
    throw new Error("The file uses an unsupported audio codec.");
  if (expectedMimeType?.startsWith("video/") && videoStreams.length === 0)
    throw new Error("The declared video file contains no video stream.");
  if (expectedMimeType?.startsWith("audio/") && audioStreams.length === 0)
    throw new Error("The declared audio file contains no audio stream.");
  if (isStillImage && videoStreams.length === 0)
    throw new Error("The declared image file contains no image stream.");

  const video = videoStreams[0];
  const width = video?.width ?? 0;
  const height = video?.height ?? 0;
  const fps = isStillImage
    ? 30
    : video
    ? frameRate(video.avg_frame_rate) || frameRate(video.r_frame_rate)
    : 0;
  const duration = isStillImage
    ? 5
    : Math.max(
        positiveNumber(parsed.format?.duration),
        ...parsed.streams.map(stream => positiveNumber(stream.duration))
      );
  if (duration <= 0 || duration > MEDIA_LIMITS.maxDurationSeconds)
    throw new Error("Media duration is missing or exceeds the two-hour limit.");
  if (
    video &&
    (width <= 0 ||
      height <= 0 ||
      width > MEDIA_LIMITS.maxWidth ||
      height > MEDIA_LIMITS.maxHeight ||
      width * height > MEDIA_LIMITS.maxPixels)
  ) {
    throw new Error("Video resolution exceeds the 8K decode safety limit.");
  }
  if (video && (fps <= 0 || fps > MEDIA_LIMITS.maxFps))
    throw new Error(
      "Video frame rate is missing or exceeds the 240 fps limit."
    );

  return {
    duration,
    width,
    height,
    fps,
    hasAudio: audioStreams.length > 0,
    hasVideo: videoStreams.length > 0,
    videoCodec: video?.codec_name ?? null,
    audioCodec: audioStreams[0]?.codec_name ?? null,
    formatName: parsed.format?.format_name ?? null,
  };
}

export async function probeMediaFile(
  filePath: string,
  options: { expectedMimeType?: string; signal?: AbortSignal } = {}
): Promise<ProbedMedia> {
  const binary = process.env.FFPROBE_PATH || "ffprobe";
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(
      binary,
      [
        "-v",
        "error",
        "-probesize",
        "10000000",
        "-analyzeduration",
        "10000000",
        "-show_entries",
        "format=duration,format_name:stream=codec_name,codec_type,width,height,avg_frame_rate,r_frame_rate,duration",
        "-of",
        "json",
        filePath,
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }
    );
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      error ? reject(error) : resolve(Buffer.concat(chunks).toString("utf8"));
    };
    const abort = () => {
      child.kill("SIGKILL");
      finish(new Error("Media inspection cancelled."));
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("Media inspection exceeded the ten-second limit."));
    }, MEDIA_LIMITS.probeTimeoutMs);
    options.signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MEDIA_LIMITS.maxProbeOutputBytes) {
        child.kill("SIGKILL");
        finish(new Error("Media inspection output exceeded its safety limit."));
      } else {
        chunks.push(Buffer.from(chunk));
      }
    });
    child.once("error", () =>
      finish(new Error("FFprobe is not installed or could not be started."))
    );
    child.once("close", code => {
      if (settled) return;
      code === 0
        ? finish()
        : finish(new Error("The uploaded media is corrupt or unsupported."));
    });
  });
  try {
    return validateProbe(JSON.parse(output), options.expectedMimeType);
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof z.ZodError)
      throw new Error("FFprobe returned malformed media metadata.");
    throw error;
  }
}
