/**
 * Reelio Export Engine
 *
 * Standalone, testable, modular export pipeline.
 * Renders the canonical timeline to a downloadable WebM file via:
 *   - Frame-by-frame canvas composition (30fps)
 *   - Per-clip CSS filter application (VideoFX)
 *   - Caption cue burn-in overlay on canvas
 *   - Multi-track Web Audio mixing via AudioContext + MediaStreamDestination
 *   - MediaRecorder (VP9 WebM fallback to plain WebM)
 *
 * Usage:
 *   const engine = new ExportEngine(clips, assets, captions);
 *   engine.onProgress = (pct) => setProgress(pct);
 *   const blob = await engine.render();
 *
 * Architectural invariant:
 *   This consumes the SAME canonical TimelineClip / asset data that drives
 *   the preview and the inspector. There is no separate representation.
 */

import type { CaptionCue } from "../../../shared/editOps";

export interface ExportClip {
  id: number;
  assetId: number;
  assetUrl: string;
  assetName: string;
  trackType: "video" | "audio";
  trackId: number;
  sourceStart: number;
  duration: number;
  timelineStart: number;
  sortIndex: number;
  visible: boolean;
  muted: boolean;
  videoFx?: string | null;
}

export interface ExportAsset {
  id: number;
  url: string;
  width: number;
  height: number;
  duration: number;
  hasAudio: boolean;
  fps?: number;
}

export interface ExportOptions {
  fps?: number;
  /** Force canvas width (default: first video clip's width, fallback 1280). */
  width?: number;
  /** Force canvas height (default: first video clip's height, fallback 720). */
  height?: number;
  /** Whether to include caption overlay in export. Default true. */
  includeCaptions?: boolean;
}

/** VideoFX filter map — mirrors the CSS filters used in the preview. */
const FX_FILTER: Record<string, string> = {
  "Cinematic LUT": "contrast(1.2) saturate(1.2) brightness(0.95)",
  "Vibrant HDR": "saturate(1.45) contrast(1.1) brightness(1.05)",
  "Film Grain": "contrast(1.1) sepia(0.15)",
  "Vignette Blur": "contrast(1.25)",
  "Glow Accent": "brightness(1.15) saturate(1.25)",
  Sharpen: "contrast(1.35)",
};

function getActiveCue(cues: CaptionCue[], time: number): CaptionCue | null {
  for (const cue of cues) {
    if (time >= cue.startTime && time < cue.endTime) return cue;
  }
  return null;
}

function timelineContentEnd(clips: ExportClip[]): number {
  let end = 0;
  for (const c of clips) end = Math.max(end, c.timelineStart + c.duration);
  return end;
}

export class ExportEngine {
  private clips: ExportClip[];
  private assets: Map<number, ExportAsset>;
  private captions: CaptionCue[];

  /** Called with 0–100 as export progresses. */
  public onProgress: (pct: number) => void = () => {};

  constructor(
    clips: ExportClip[],
    assets: ExportAsset[] | Map<number, ExportAsset>,
    captions: CaptionCue[] = [],
  ) {
    this.clips = clips;
    this.captions = captions;
    if (assets instanceof Map) {
      this.assets = assets;
    } else {
      this.assets = new Map(assets.map((a) => [a.id, a]));
    }
  }

  /** Render and return the exported Blob. Throws on failure. */
  async render(opts: ExportOptions = {}): Promise<Blob> {
    const FPS = opts.fps ?? 30;
    const FRAME_MS = 1000 / FPS;
    const includeCaptions = opts.includeCaptions !== false;

    // ── Filter clips ──────────────────────────────────────────────────────
    const videoClips = this.clips
      .filter((c) => c.trackType === "video" && c.visible !== false && c.duration > 0)
      .sort((a, b) => a.timelineStart - b.timelineStart);

    if (videoClips.length === 0) {
      throw new Error("No visible video clips to export");
    }

    const firstAsset = this.assets.get(videoClips[0].assetId);
    if (!firstAsset?.url) {
      throw new Error("The first video clip's source is not available");
    }

    const width = opts.width ?? (firstAsset.width || 1280);
    const height = opts.height ?? (firstAsset.height || 720);
    const end = timelineContentEnd(videoClips);

    if (end <= 0) throw new Error("Timeline has zero duration");

    // ── Canvas & 2D Context ───────────────────────────────────────────────
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context is not available");
    if (typeof (canvas as any).captureStream !== "function")
      throw new Error("canvas.captureStream() is not supported in this browser");
    if (typeof MediaRecorder === "undefined")
      throw new Error("MediaRecorder is not available in this browser");

    // ── Audio mixing ──────────────────────────────────────────────────────
    const AudioCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    const audioCtx = AudioCtor ? new AudioCtor() : null;
    const audioDest = audioCtx?.createMediaStreamDestination() ?? null;

    type AudioEntry = { el: HTMLAudioElement; clip: ExportClip };
    const audioEntries: AudioEntry[] = [];

    if (audioCtx && audioDest) {
      const audibleClips = this.clips.filter((c) => {
        if (c.muted || c.visible === false || !c.assetUrl) return false;
        const asset = this.assets.get(c.assetId);
        return c.trackType === "audio" || asset?.hasAudio;
      });

      for (const clip of audibleClips) {
        try {
          const el = document.createElement("audio");
          el.crossOrigin = "anonymous";
          el.src = clip.assetUrl;
          el.preload = "auto";
          await new Promise<void>((resolve) => {
            el.addEventListener("loadedmetadata", () => resolve(), { once: true });
            el.addEventListener("error", () => resolve(), { once: true }); // non-fatal
            setTimeout(resolve, 3000);
          });
          const srcNode = audioCtx.createMediaElementSource(el);
          srcNode.connect(audioDest);
          audioEntries.push({ el, clip });
        } catch {
          // Non-decodable — skip gracefully
        }
      }
    }

    // ── Stream & Recorder ─────────────────────────────────────────────────
    const canvasStream = (canvas as any).captureStream(FPS) as MediaStream;
    const streamTracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()];
    if (audioDest) streamTracks.push(...audioDest.stream.getAudioTracks());
    const recordStream = new MediaStream(streamTracks);

    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm";
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(recordStream, { mimeType });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    const stopped = new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType }));
    });

    // ── Frame-by-frame composition ────────────────────────────────────────
    const source = document.createElement("video");
    source.muted = true;
    source.playsInline = true;
    source.preload = "auto";
    source.crossOrigin = "anonymous";

    recorder.start(250);
    let currentSrc = "";

    for (let time = 0; time <= end; time += 1 / FPS) {
      this.onProgress(Math.min(99, (time / end) * 100));

      // Find the active video clip at this timestamp
      const clip = videoClips.find(
        (c) => time >= c.timelineStart && time < c.timelineStart + c.duration,
      );

      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, width, height);

      if (clip) {
        const asset = this.assets.get(clip.assetId);
        if (asset?.url) {
          // Switch source if needed
          if (source.src !== asset.url || currentSrc !== asset.url) {
            source.src = asset.url;
            currentSrc = asset.url;
            await new Promise<void>((resolve, reject) => {
              source.onloadedmetadata = () => resolve();
              source.onerror = () =>
                reject(new Error(`Source video could not be decoded: ${asset.url}`));
              setTimeout(resolve, 2000);
            });
          }

          // Seek source to the correct frame
          const seekTo = clip.sourceStart + (time - clip.timelineStart);
          if (Math.abs(source.currentTime - seekTo) > 0.02) {
            source.currentTime = seekTo;
            await new Promise<void>((resolve) => {
              const done = () => {
                source.removeEventListener("seeked", done);
                resolve();
              };
              source.addEventListener("seeked", done, { once: true });
              setTimeout(done, 800);
            });
          }

          // Apply VideoFX via CanvasRenderingContext2D filter
          const fxFilter = clip.videoFx ? (FX_FILTER[clip.videoFx] ?? "none") : "none";
          ctx.filter = fxFilter;
          ctx.drawImage(source, 0, 0, width, height);
          ctx.filter = "none";
        }
      }

      // Caption burn-in
      if (includeCaptions && this.captions.length > 0) {
        const cue = getActiveCue(this.captions, time);
        if (cue) {
          const text = cue.text;
          const fontSize = Math.max(18, Math.round(height * 0.04));
          ctx.font = `bold ${fontSize}px Inter, system-ui, sans-serif`;
          ctx.textAlign = "center";
          const metrics = ctx.measureText(text);
          const padding = fontSize * 0.5;
          const boxW = metrics.width + padding * 2;
          const boxH = fontSize * 1.6;
          const boxX = (width - boxW) / 2;
          const boxY = height - boxH - height * 0.06;
          ctx.fillStyle = "rgba(0,0,0,0.82)";
          ctx.roundRect(boxX, boxY, boxW, boxH, 6);
          ctx.fill();
          ctx.fillStyle = "#ffffff";
          ctx.fillText(text, width / 2, boxY + boxH * 0.72);
          ctx.textAlign = "left";
        }
      }

      // Sync audio elements to export time
      for (const { el, clip: audioClip } of audioEntries) {
        const srcTime = audioClip.sourceStart + (time - audioClip.timelineStart);
        if (time >= audioClip.timelineStart && time < audioClip.timelineStart + audioClip.duration) {
          if (Math.abs(el.currentTime - srcTime) > 0.15) el.currentTime = srcTime;
          void el.play().catch(() => undefined);
        } else if (!el.paused) {
          el.pause();
        }
      }

      await new Promise<void>((resolve) => setTimeout(resolve, FRAME_MS));
    }

    recorder.stop();
    const blob = await stopped;

    // ── Cleanup ───────────────────────────────────────────────────────────
    for (const { el } of audioEntries) {
      el.pause();
      el.src = "";
    }
    if (audioCtx) void audioCtx.close();
    source.pause();
    source.removeAttribute("src");
    source.load();
    canvasStream.getTracks().forEach((t) => t.stop());
    recordStream.getTracks().forEach((t) => t.stop());

    if (blob.size === 0) throw new Error("Export produced an empty file. The browser may not support the required codecs.");
    return blob;
  }
}

/**
 * Convenience wrapper: creates an engine, renders, and triggers download.
 */
export async function exportTimeline(
  projectName: string,
  clips: ExportClip[],
  assets: ExportAsset[],
  captions: CaptionCue[],
  onProgress: (pct: number) => void,
): Promise<{ sizeKb: number; hasAudio: boolean }> {
  const engine = new ExportEngine(clips, assets, captions);
  engine.onProgress = onProgress;

  const blob = await engine.render();

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${projectName || "reelio-export"}.webm`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);

  const hasAudio = clips.some((c) => {
    const asset = assets.find((a) => a.id === c.assetId);
    return (c.trackType === "audio" || asset?.hasAudio) && !c.muted;
  });

  return { sizeKb: Math.round(blob.size / 1024), hasAudio };
}
