import type { CaptionCue } from "../../../shared/editOps";

/**
 * Generate evenly-spaced caption cues from clip metadata.
 *
 * This is the browser-side, zero-API-key caption path. Each clip is divided
 * into 3-second windows and a cue is emitted per window. When a real
 * transcription service is available (NVIDIA NIM with addCaptions op, or a
 * future Whisper endpoint) the cues produced there will replace these.
 */
export function generateDemoCaptions(
  clips: { timelineStart: number; duration: number; assetName: string }[],
): CaptionCue[] {
  const CUE_DURATION = 3; // seconds per cue
  const cues: CaptionCue[] = [];

  for (const clip of clips) {
    if (clip.duration <= 0) continue;
    const count = Math.max(1, Math.ceil(clip.duration / CUE_DURATION));
    for (let i = 0; i < count; i++) {
      const start = clip.timelineStart + (i / count) * clip.duration;
      const end = clip.timelineStart + ((i + 1) / count) * clip.duration;
      cues.push({
        text: clip.assetName,
        startTime: Math.round(start * 1000) / 1000,
        endTime: Math.round(end * 1000) / 1000,
      });
    }
  }
  return cues;
}

/**
 * Return the active caption cue for the given timeline position, or null if
 * no cue covers that time. O(n) scan — the caption list is typically short.
 */
export function getActiveCue(cues: CaptionCue[], time: number): CaptionCue | null {
  for (const cue of cues) {
    if (time >= cue.startTime && time < cue.endTime) return cue;
  }
  return null;
}
