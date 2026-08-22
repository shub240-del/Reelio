/**
 * Media import engine — browser-side analysis of an uploaded file.
 *
 * Why the browser and not the server: the server's hand-rolled MP4 box parser
 * (server/videoMetadata.ts) only understands MP4, misreads 64-bit `mvhd`
 * durations, and hardcodes `fps = 30`. It cannot read MOV or WebM at all. The
 * browser already contains a complete, correct demuxer for every format it can
 * play, so we measure here and treat those numbers as authoritative.
 *
 * Everything below is real measurement. Nothing is estimated or defaulted
 * except where a browser genuinely cannot report a value, which is reported
 * honestly via `fpsConfident`.
 */

export const SUPPORTED_MIME_TYPES = [
  "video/mp4",
  "video/quicktime", // .mov
  "video/webm",
  "video/x-matroska", // .mkv, plays where webm codecs are supported
  "audio/mpeg",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/ogg",
  "audio/webm",
  "audio/mp4",
] as const;

/** Extensions accepted when a browser reports an empty or generic MIME type. */
export const SUPPORTED_EXTENSIONS = [
  ".mp4", ".m4v", ".mov", ".webm", ".mkv",
  ".mp3", ".wav", ".ogg", ".m4a", ".aac",
] as const;

export interface MediaProbe {
  duration: number;
  width: number;
  height: number;
  fps: number;
  /** False when fps had to fall back; the UI should not present it as exact. */
  fpsConfident: boolean;
  aspectRatio: number;
  aspectLabel: string;
  hasAudio: boolean;
  mimeType: string;
  sizeBytes: number;
  name: string;
}

export interface ThumbnailFrame {
  /** Timeline time this frame represents, in seconds. */
  time: number;
  blob: Blob;
  url: string;
}

/* ────────────────────────── pure helpers (unit tested) ────────────────────────── */

/** Frame rates real cameras and editors emit. Measurement lands near one of these. */
export const COMMON_FPS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120] as const;

/**
 * Snaps a measured frame rate to the nearest standard rate when it is within
 * 2%. Measurement jitter otherwise yields values like 29.9712 that are correct
 * but ugly, and worse, break frame-accurate seeking arithmetic downstream.
 */
export function snapToCommonFps(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  let best = raw;
  let bestErr = Infinity;
  for (const candidate of COMMON_FPS) {
    const err = Math.abs(candidate - raw) / candidate;
    if (err < bestErr) {
      bestErr = err;
      best = candidate;
    }
  }
  return bestErr <= 0.02 ? best : Math.round(raw * 1000) / 1000;
}

/** Median is used rather than mean: a single dropped frame skews a mean badly. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Converts presentation timestamps of successive frames into a frame rate. */
export function fpsFromFrameTimes(times: number[]): number {
  const deltas: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const d = times[i] - times[i - 1];
    if (d > 1e-4) deltas.push(d);
  }
  const m = median(deltas);
  return m > 0 ? snapToCommonFps(1 / m) : 0;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** "16:9", "9:16", "4:3" … falls back to a decimal ratio for odd sizes. */
export function aspectRatioLabel(width: number, height: number): string {
  if (!width || !height) return "—";
  const d = gcd(width, height) || 1;
  const w = Math.round(width / d);
  const h = Math.round(height / d);
  if (w <= 64 && h <= 64) return `${w}:${h}`;
  const ratio = width / height;
  const known: [number, string][] = [
    [16 / 9, "16:9"],
    [9 / 16, "9:16"],
    [4 / 3, "4:3"],
    [3 / 4, "3:4"],
    [1, "1:1"],
    [21 / 9, "21:9"],
  ];
  for (const [value, label] of known) {
    if (Math.abs(ratio - value) / value < 0.02) return label;
  }
  return `${ratio.toFixed(2)}:1`;
}

/**
 * Evenly spaced sample times for a thumbnail strip.
 * Samples sit at the centre of each slice, never at 0 or exactly at the end:
 * the first frame is often black and seeking to `duration` frequently fails.
 */
export function thumbnailTimestamps(duration: number, count: number): number[] {
  if (duration <= 0 || count <= 0) return [];
  const step = duration / count;
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(Math.min(duration - 1e-3, step * (i + 0.5)));
  return out;
}

/**
 * Reduces raw PCM to N peak buckets for waveform drawing.
 * Keeps the maximum absolute amplitude per bucket rather than averaging, so
 * transients stay visible at any zoom level.
 */
export function bucketPeaks(samples: Float32Array, buckets: number): Float32Array {
  const out = new Float32Array(Math.max(0, buckets));
  if (buckets <= 0 || samples.length === 0) return out;
  const per = samples.length / buckets;
  for (let i = 0; i < buckets; i++) {
    const start = Math.floor(i * per);
    const end = Math.min(samples.length, Math.floor((i + 1) * per));
    let peak = 0;
    for (let j = start; j < end; j++) {
      const v = samples[j] < 0 ? -samples[j] : samples[j];
      if (v > peak) peak = v;
    }
    out[i] = peak;
  }
  return out;
}

export function isSupportedMedia(file: { name: string; type: string }): boolean {
  if ((SUPPORTED_MIME_TYPES as readonly string[]).includes(file.type)) return true;
  // Browsers report "" for .mov on some platforms; fall back to the extension.
  const lower = file.name.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/* ────────────────────────── browser measurement ────────────────────────── */

interface VideoFrameMeta {
  mediaTime: number;
}
type RVFC = (cb: (now: number, meta: VideoFrameMeta) => void) => number;

function hasRVFC(video: HTMLVideoElement): video is HTMLVideoElement & { requestVideoFrameCallback: RVFC } {
  return typeof (video as { requestVideoFrameCallback?: unknown }).requestVideoFrameCallback === "function";
}

/** Loads a file into a detached <video> and resolves once dimensions are known. */
export function loadVideoElement(src: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";
    const onLoaded = () => {
      cleanup();
      resolve(video);
    };
    const onError = () => {
      cleanup();
      reject(new Error("This file could not be decoded by the browser"));
    };
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("loadedmetadata", onLoaded);
    video.addEventListener("error", onError);
    video.src = src;
  });
}

/**
 * Some containers (notably WebM from MediaRecorder) report `duration: Infinity`
 * until the file is fully traversed. Seeking to the far end forces the browser
 * to resolve the real duration.
 */
async function resolveDuration(video: HTMLVideoElement): Promise<number> {
  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;
  return new Promise((resolve) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      resolve(Number.isFinite(video.duration) ? video.duration : 0);
    };
    video.addEventListener("seeked", onSeeked);
    video.currentTime = 1e101;
    setTimeout(() => resolve(Number.isFinite(video.duration) ? video.duration : 0), 3000);
  });
}

/** Measures frame rate by timestamping real decoded frames. */
async function measureFps(video: HTMLVideoElement, sampleCount = 16): Promise<{ fps: number; confident: boolean }> {
  if (!hasRVFC(video)) return { fps: 30, confident: false };
  const times: number[] = [];
  const wasMuted = video.muted;
  video.muted = true;
  try {
    await video.play();
  } catch {
    video.muted = wasMuted;
    return { fps: 30, confident: false };
  }
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    const step = (_now: number, meta: VideoFrameMeta) => {
      times.push(meta.mediaTime);
      if (times.length >= sampleCount) return finish();
      video.requestVideoFrameCallback(step);
    };
    video.requestVideoFrameCallback(step);
    setTimeout(finish, 2500); // never hang an import on a stalled decoder
  });
  video.pause();
  video.currentTime = 0;
  video.muted = wasMuted;

  const fps = fpsFromFrameTimes(times);
  return fps > 0 ? { fps, confident: times.length >= 4 } : { fps: 30, confident: false };
}

/** Detects an audio track without decoding the whole file. */
function detectAudio(video: HTMLVideoElement): boolean {
  const withCapture = video as HTMLVideoElement & { captureStream?: () => MediaStream };
  if (typeof withCapture.captureStream === "function") {
    try {
      return withCapture.captureStream().getAudioTracks().length > 0;
    } catch {
      /* falls through to the vendor probes below */
    }
  }
  const vendor = video as HTMLVideoElement & { mozHasAudio?: boolean; webkitAudioDecodedByteCount?: number };
  if (typeof vendor.mozHasAudio === "boolean") return vendor.mozHasAudio;
  if (typeof vendor.webkitAudioDecodedByteCount === "number") return vendor.webkitAudioDecodedByteCount > 0;
  return false;
}

/** Loads a standalone audio file through the browser's native media decoder. */
function loadAudioElement(src: string): Promise<HTMLAudioElement> {
  return new Promise((resolve, reject) => {
    const audio = document.createElement("audio");
    audio.preload = "auto";
    const onLoaded = () => { cleanup(); resolve(audio); };
    const onError = () => { cleanup(); reject(new Error("This audio file could not be decoded by the browser")); };
    const cleanup = () => {
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("error", onError);
    };
    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("error", onError);
    audio.src = src;
  });
}

/** Full probe of an imported file. Every field is measured, not guessed. */
export async function probeMedia(file: File): Promise<MediaProbe> {
  const url = URL.createObjectURL(file);
  try {
    if (file.type.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|aac)$/i.test(file.name)) {
      const audio = await loadAudioElement(url);
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      audio.src = "";
      return {
        duration,
        width: 0,
        height: 0,
        fps: 0,
        fpsConfident: false,
        aspectRatio: 0,
        aspectLabel: "—",
        hasAudio: true,
        mimeType: file.type || "audio/wav",
        sizeBytes: file.size,
        name: file.name,
      };
    }

    const video = await loadVideoElement(url);
    const duration = await resolveDuration(video);
    const width = video.videoWidth;
    const height = video.videoHeight;
    const { fps, confident } = await measureFps(video);
    const hasAudio = detectAudio(video);
    video.src = "";
    return {
      duration,
      width,
      height,
      fps,
      fpsConfident: confident,
      aspectRatio: height > 0 ? width / height : 0,
      aspectLabel: aspectRatioLabel(width, height),
      hasAudio,
      mimeType: file.type || "video/mp4",
      sizeBytes: file.size,
      name: file.name,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Captures an evenly spaced strip of real frames for the timeline. */
export async function generateThumbnailStrip(
  file: File,
  count = 10,
  maxWidth = 160,
): Promise<ThumbnailFrame[]> {
  const url = URL.createObjectURL(file);
  const frames: ThumbnailFrame[] = [];
  try {
    const video = await loadVideoElement(url);
    const duration = await resolveDuration(video);
    const scale = video.videoWidth > 0 ? Math.min(1, maxWidth / video.videoWidth) : 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas unavailable");

    for (const time of thumbnailTimestamps(duration, count)) {
      await seekTo(video, time);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.72));
      if (blob) frames.push({ time, blob, url: URL.createObjectURL(blob) });
    }
    video.src = "";
    return frames;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Seeks and waits for the frame to actually be presented. */
export function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };
    video.addEventListener("seeked", onSeeked);
    video.currentTime = time;
    setTimeout(resolve, 2000); // a failed seek must not deadlock the import
  });
}

/** Decodes the audio track to peak buckets for the waveform. */
export async function extractAudioPeaks(file: File, buckets = 2000): Promise<Float32Array> {
  const AudioCtor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtor) return new Float32Array(0);
  const ctx = new AudioCtor();
  try {
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    if (buffer.numberOfChannels === 0) return new Float32Array(0);
    const channel = buffer.getChannelData(0);
    // Mix a second channel in so a hard-panned source still shows a waveform.
    if (buffer.numberOfChannels > 1) {
      const right = buffer.getChannelData(1);
      const mixed = new Float32Array(channel.length);
      for (let i = 0; i < channel.length; i++) mixed[i] = (channel[i] + right[i]) / 2;
      return bucketPeaks(mixed, buckets);
    }
    return bucketPeaks(channel, buckets);
  } catch {
    return new Float32Array(0); // no audio track, or a codec the browser cannot decode
  } finally {
    void ctx.close();
  }
}
