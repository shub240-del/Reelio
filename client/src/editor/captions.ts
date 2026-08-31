import type { CaptionCue } from "../../../shared/editOps";

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
