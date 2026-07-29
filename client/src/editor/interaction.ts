/**
 * Pure geometry and ordering rules for timeline interaction.
 *
 * The prototype computed a dropped clip's new start as `cursorX / zoom`, i.e. it
 * moved the clip's *left edge* to the pointer regardless of where inside the clip
 * the drag began. Clicking a clip 3 seconds in therefore teleported it 3 seconds
 * later, and a plain click with no movement still moved it. Everything here works
 * in deltas instead, and is kept free of React so it can be tested directly.
 */

export const MIN_CLIP_DURATION = 0.05;

/** Pixel distance within which a dragged edge snaps to a candidate. */
export const SNAP_THRESHOLD_PX = 8;

export interface DragOrigin {
  clipId: number;
  /** Clip start when the drag began. */
  startAt: number;
  /** Pointer x in timeline-content pixels when the drag began. */
  pointerX: number;
}

export function pxToSeconds(px: number, zoom: number): number {
  return zoom > 0 ? px / zoom : 0;
}

/**
 * New start for a dragged clip: original start plus the pointer delta, clamped
 * at the timeline origin. A zero delta returns the original start exactly, so
 * clicking to select never moves anything.
 */
export function dragToStart(origin: DragOrigin, pointerX: number, zoom: number): number {
  const delta = pxToSeconds(pointerX - origin.pointerX, zoom);
  return Math.max(0, origin.startAt + delta);
}

/** True once the pointer has moved far enough to count as a drag, not a click. */
export function isDrag(origin: DragOrigin, pointerX: number, thresholdPx = 3): boolean {
  return Math.abs(pointerX - origin.pointerX) >= thresholdPx;
}

export interface SnapCandidateSource {
  id: number;
  timelineStart: number;
  duration: number;
}

/**
 * Collects the times a dragged clip should snap to: the origin, the playhead,
 * and the edges of every other clip. The dragged clip is excluded so it cannot
 * snap to itself.
 */
export function snapCandidates(
  clips: readonly SnapCandidateSource[],
  excludeIds: readonly number[],
  playhead: number,
): number[] {
  const skip = new Set(excludeIds);
  const times = [0, playhead];
  for (const c of clips) {
    if (skip.has(c.id)) continue;
    times.push(c.timelineStart, c.timelineStart + c.duration);
  }
  return [...new Set(times)].sort((a, b) => a - b);
}

/**
 * Snaps a proposed start so that either the clip's start or its end lands on a
 * candidate. Returns the adjusted start and the time it locked onto, so the UI
 * can draw a guide. Considering both edges is what makes clips butt up against
 * each other cleanly instead of leaving sub-pixel gaps.
 */
export function applySnap(
  proposedStart: number,
  duration: number,
  candidates: readonly number[],
  zoom: number,
  thresholdPx = SNAP_THRESHOLD_PX,
): { start: number; snappedTo: number | null } {
  const tolerance = pxToSeconds(thresholdPx, zoom);
  let best: { start: number; snappedTo: number; distance: number } | null = null;

  for (const candidate of candidates) {
    for (const edge of [proposedStart, proposedStart + duration]) {
      const distance = Math.abs(edge - candidate);
      if (distance > tolerance) continue;
      const start = candidate - (edge - proposedStart);
      if (start < 0) continue;
      if (!best || distance < best.distance) best = { start, snappedTo: candidate, distance };
    }
  }

  if (!best) return { start: proposedStart, snappedTo: null };
  return { start: best.start, snappedTo: best.snappedTo };
}

/**
 * Recomputes sortIndex from left-to-right position within a track.
 * The prototype used `currentIndex + 1` clamped to the track length, which bore
 * no relation to where the clip was dropped and so scrambled ordering.
 */
export function reindexTrack<T extends { id: number; timelineStart: number; sortIndex: number }>(
  clips: readonly T[],
): { id: number; sortIndex: number }[] {
  return [...clips]
    .sort((a, b) => a.timelineStart - b.timelineStart || a.id - b.id)
    .map((clip, index) => ({ id: clip.id, sortIndex: index }))
    .filter((next) => {
      const before = clips.find((c) => c.id === next.id);
      return before && before.sortIndex !== next.sortIndex;
    });
}

/** Selection semantics for a click: plain replaces, ctrl/meta toggles, shift adds. */
export function nextSelection(
  current: readonly number[],
  clipId: number,
  modifiers: { ctrl?: boolean; meta?: boolean; shift?: boolean } = {},
): number[] {
  const additive = modifiers.ctrl || modifiers.meta;
  if (additive) {
    return current.includes(clipId) ? current.filter((id) => id !== clipId) : [...current, clipId];
  }
  if (modifiers.shift) {
    return current.includes(clipId) ? [...current] : [...current, clipId];
  }
  return [clipId];
}

export interface TrimTarget {
  sourceStart: number;
  duration: number;
  timelineStart: number;
}

/**
 * Resolves an edge drag into a trim.
 *
 * Dragging the left edge moves the clip's start on the timeline *and* its source
 * in-point together, so the visible frame under the edge stays put. Both edges
 * are bounded by the available source media and by MIN_CLIP_DURATION, which is
 * what stops a trim from collapsing a clip to zero length.
 */
export function resolveTrim(
  clip: TrimTarget,
  edge: "start" | "end",
  deltaSeconds: number,
  assetDuration: number,
  minDuration = MIN_CLIP_DURATION,
): TrimTarget {
  if (edge === "start") {
    // Cannot pull earlier than the head of the source, nor past the tail.
    const lowerBound = -clip.sourceStart;
    const upperBound = clip.duration - minDuration;
    const delta = Math.min(Math.max(deltaSeconds, lowerBound), upperBound);
    return {
      sourceStart: clip.sourceStart + delta,
      duration: clip.duration - delta,
      timelineStart: Math.max(0, clip.timelineStart + delta),
    };
  }

  const maxDuration = Math.max(minDuration, assetDuration - clip.sourceStart);
  const duration = Math.min(Math.max(clip.duration + deltaSeconds, minDuration), maxDuration);
  return { sourceStart: clip.sourceStart, duration, timelineStart: clip.timelineStart };
}

/**
 * Where a duplicate should land: immediately after the source clip, pushed
 * further right while it would overlap an existing clip on the same track.
 */
export function duplicateStart(
  clip: SnapCandidateSource,
  trackClips: readonly SnapCandidateSource[],
): number {
  let candidate = clip.timelineStart + clip.duration;
  const others = trackClips.filter((c) => c.id !== clip.id).sort((a, b) => a.timelineStart - b.timelineStart);
  for (const other of others) {
    const overlaps = candidate < other.timelineStart + other.duration && candidate + clip.duration > other.timelineStart;
    if (overlaps) candidate = other.timelineStart + other.duration;
  }
  return candidate;
}

/** Offset within a clip where the playhead sits, or null if outside it. */
export function splitOffset(clip: SnapCandidateSource, playhead: number, minDuration = MIN_CLIP_DURATION): number | null {
  const offset = playhead - clip.timelineStart;
  if (offset < minDuration) return null;
  if (offset > clip.duration - minDuration) return null;
  return offset;
}
