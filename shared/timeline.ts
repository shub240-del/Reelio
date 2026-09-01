/**
 * Pure timeline engine.
 *
 * Zero imports, zero I/O, zero React. Every timeline mutation in the app funnels
 * through these functions so that the editor UI, the AI edit operations and the
 * renderer all agree on exactly what the timeline means.
 *
 * Invariants maintained by `normalizeTimeline`:
 *  - a clip never reads outside its source asset  (0 <= sourceStart, sourceStart + duration <= asset.duration)
 *  - a clip never has negative timelineStart
 *  - a clip shorter than MIN_CLIP_DURATION does not exist
 *  - clips on a track never overlap
 *  - sortIndex is dense and ordered per track
 */

/** Comparison tolerance. Floating point accumulates error over trims/splits. */
export const EPS = 1e-6;

/** Shortest clip we allow. Below this a clip is not representable in a frame-based render. */
export const MIN_CLIP_DURATION = 0.02;

export type TrackType = "video" | "audio";

export interface TimelineClip {
  id: number;
  assetId: number;
  trackId: number;
  trackType: TrackType;
  /** Offset into the source asset where this clip starts reading. */
  sourceStart: number;
  /** Length of the clip, in both source and timeline time (no speed changes yet). */
  duration: number;
  /** Where the clip sits on the timeline. */
  timelineStart: number;
  sortIndex: number;
  locked: boolean;
  visible: boolean;
  muted: boolean;
  /** Persisted visual effect. Only values from the shared allowlist are accepted. */
  videoFx?: string | null;
  transition?: string | null;
}

export interface TimelineAsset {
  id: number;
  duration: number;
  hasAudio: boolean;
  width: number;
  height: number;
  fps: number;
}

export type AssetMap =
  | Map<number, TimelineAsset>
  | Record<number, TimelineAsset>;

export interface TimeRange {
  start: number;
  end: number;
}

/* ────────────────────────── ids ────────────────────────── */

/**
 * Clips created client-side get negative ids until the server assigns real ones.
 * This keeps undo/redo, selection and AI operations able to reference a clip that
 * has not been persisted yet.
 */
let tempIdCounter = -1;

export function nextTempId(): number {
  return tempIdCounter--;
}

export function isTempId(id: number): boolean {
  return id < 0;
}

/** Test helper: makes temp ids deterministic across test cases. */
export function resetTempIds(): void {
  tempIdCounter = -1;
}

/* ────────────────────────── small helpers ────────────────────────── */

function getAsset(assets: AssetMap, id: number): TimelineAsset | undefined {
  return assets instanceof Map ? assets.get(id) : assets[id];
}

/** Rounds away accumulated float error so that 0.30000000000000004 compares as 0.3. */
export function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function clipEnd(clip: TimelineClip): number {
  return round(clip.timelineStart + clip.duration);
}

export function sourceEnd(clip: TimelineClip): number {
  return round(clip.sourceStart + clip.duration);
}

export function cloneClip(clip: TimelineClip): TimelineClip {
  return { ...clip };
}

/* ────────────────────────── normalization ────────────────────────── */

/**
 * Forces a clip inside the bounds of its source asset.
 *
 * Deliberately clamps rather than rejects: an AI operation or a fast drag can
 * easily produce a slightly out-of-range clip, and silently dropping the user's
 * footage is far worse than shortening it by a few milliseconds. Returns null
 * only when nothing usable is left.
 */
export function clampClipToAsset(
  clip: TimelineClip,
  asset: TimelineAsset | undefined
): TimelineClip | null {
  if (!asset) return null;
  const next = cloneClip(clip);

  next.sourceStart = round(
    Math.max(
      0,
      Math.min(
        next.sourceStart,
        Math.max(0, asset.duration - MIN_CLIP_DURATION)
      )
    )
  );
  const maxDuration = round(asset.duration - next.sourceStart);
  next.duration = round(Math.max(0, Math.min(next.duration, maxDuration)));
  next.timelineStart = round(Math.max(0, next.timelineStart));

  if (next.duration < MIN_CLIP_DURATION - EPS) return null;
  if (next.trackType === "audio" && !asset.hasAudio) return null;
  return next;
}

/**
 * Orders clips for rendering and for sortIndex assignment.
 * sortIndex breaks ties so a caller can force a clip before/after another at the
 * same timelineStart by handing it sortIndex -1 (see `moveClip`).
 */
export function sortClips(clips: TimelineClip[]): TimelineClip[] {
  return [...clips].sort(
    (a, b) =>
      a.trackId - b.trackId ||
      a.timelineStart - b.timelineStart ||
      a.sortIndex - b.sortIndex ||
      a.id - b.id
  );
}

/** Pushes clips right so that no two clips on a track overlap. Order is preserved. */
function resolveOverlaps(clips: TimelineClip[]): TimelineClip[] {
  const byTrack = new Map<number, TimelineClip[]>();
  for (const clip of clips) {
    const list = byTrack.get(clip.trackId);
    if (list) list.push(clip);
    else byTrack.set(clip.trackId, [clip]);
  }
  for (const list of byTrack.values()) {
    let cursor = 0;
    for (const clip of list) {
      if (clip.timelineStart < cursor - EPS) clip.timelineStart = round(cursor);
      cursor = clipEnd(clip);
    }
  }
  return clips;
}

/**
 * The single funnel every mutation returns through. Clamps, drops empties,
 * de-overlaps and renumbers.
 */
export function normalizeTimeline(
  clips: TimelineClip[],
  assets: AssetMap
): TimelineClip[] {
  const clamped: TimelineClip[] = [];
  for (const clip of clips) {
    const next = clampClipToAsset(clip, getAsset(assets, clip.assetId));
    if (next) clamped.push(next);
  }

  const sorted = resolveOverlaps(sortClips(clamped));

  const counters = new Map<number, number>();
  for (const clip of sorted) {
    const n = counters.get(clip.trackId) ?? 0;
    clip.sortIndex = n;
    counters.set(clip.trackId, n + 1);
  }
  return sorted;
}

/* ────────────────────────── queries ────────────────────────── */

export function timelineDuration(clips: TimelineClip[]): number {
  let max = 0;
  for (const clip of clips) max = Math.max(max, clipEnd(clip));
  return round(max);
}

export function trackIdsOf(clips: TimelineClip[]): number[] {
  return [...new Set(clips.map(c => c.trackId))].sort((a, b) => a - b);
}

export function clipsOnTrack(
  clips: TimelineClip[],
  trackId: number
): TimelineClip[] {
  return sortClips(clips.filter(c => c.trackId === trackId));
}

export function findClip(
  clips: TimelineClip[],
  clipId: number
): TimelineClip | undefined {
  return clips.find(c => c.id === clipId);
}

/**
 * Which clip is on screen at `time`, and where in its source file to read.
 * The end of a clip is exclusive so that abutting clips hand over cleanly.
 */
export function resolveAtTime(
  clips: TimelineClip[],
  time: number,
  trackId?: number
): { clip: TimelineClip; sourceTime: number } | null {
  const candidates =
    trackId === undefined ? clips : clips.filter(c => c.trackId === trackId);
  for (const clip of sortClips(candidates)) {
    if (time >= clip.timelineStart - EPS && time < clipEnd(clip) - EPS) {
      return {
        clip,
        sourceTime: round(clip.sourceStart + (time - clip.timelineStart)),
      };
    }
  }
  return null;
}

/** Next clip boundary at or after `time`; used to schedule playback switches. */
export function nextBoundaryAfter(
  clips: TimelineClip[],
  time: number
): number | null {
  let best: number | null = null;
  for (const clip of clips) {
    for (const edge of [clip.timelineStart, clipEnd(clip)]) {
      if (edge > time + EPS && (best === null || edge < best)) best = edge;
    }
  }
  return best;
}

/* ────────────────────────── mutations ────────────────────────── */

export interface RippleOption {
  /** Close the gap left behind / push neighbours aside instead of leaving holes. */
  ripple?: boolean;
}

/** Lays every clip on a track end-to-end from `startAt`, removing gaps. */
export function rippleTrack(
  clips: TimelineClip[],
  trackId: number,
  startAt = 0
): TimelineClip[] {
  const out = clips.map(cloneClip);
  let cursor = startAt;
  for (const clip of sortClips(out)) {
    if (clip.trackId !== trackId) continue;
    if (clip.timelineStart < startAt - EPS) {
      cursor = Math.max(cursor, clipEnd(clip));
      continue;
    }
    clip.timelineStart = round(cursor);
    cursor = clipEnd(clip);
  }
  return out;
}

export function rippleAllTracks(clips: TimelineClip[]): TimelineClip[] {
  let out = clips.map(cloneClip);
  for (const trackId of trackIdsOf(out)) out = rippleTrack(out, trackId);
  return out;
}

export interface AddClipInput {
  assetId: number;
  trackId?: number;
  trackType?: TrackType;
  /** Defaults to the end of the target track (append). */
  timelineStart?: number;
  sourceStart?: number;
  /** Defaults to the remainder of the asset. */
  duration?: number;
}

export function addClip(
  clips: TimelineClip[],
  assets: AssetMap,
  input: AddClipInput
): { clips: TimelineClip[]; clip: TimelineClip | null } {
  const asset = getAsset(assets, input.assetId);
  if (!asset) return { clips: normalizeTimeline(clips, assets), clip: null };

  const trackType: TrackType = input.trackType ?? "video";
  const trackId = input.trackId ?? (trackType === "audio" ? 1 : 0);
  const sourceStart = round(Math.max(0, input.sourceStart ?? 0));
  const duration = round(input.duration ?? asset.duration - sourceStart);
  const timelineStart =
    input.timelineStart ??
    timelineDuration(clips.filter(c => c.trackId === trackId));

  const clip: TimelineClip = {
    id: nextTempId(),
    assetId: input.assetId,
    trackId,
    trackType,
    sourceStart,
    duration,
    timelineStart: round(Math.max(0, timelineStart)),
    sortIndex: Number.MAX_SAFE_INTEGER,
    locked: false,
    visible: true,
    muted: false,
  };

  const next = normalizeTimeline([...clips.map(cloneClip), clip], assets);
  return { clips: next, clip: next.find(c => c.id === clip.id) ?? null };
}

export function removeClips(
  clips: TimelineClip[],
  ids: number[],
  assets: AssetMap,
  opts: RippleOption = {}
): TimelineClip[] {
  const doomed = new Set(ids);
  const survivors = clips.filter(c => !doomed.has(c.id) || c.locked);
  const tracks = [
    ...new Set(clips.filter(c => doomed.has(c.id)).map(c => c.trackId)),
  ];

  let next = normalizeTimeline(survivors, assets);
  if (opts.ripple)
    for (const trackId of tracks) next = rippleTrack(next, trackId);
  return normalizeTimeline(next, assets);
}

/**
 * Drags a clip edge to an absolute timeline position.
 *
 * Trimming the head moves both timelineStart and sourceStart so the visible
 * frame under the cursor stays put. The guard uses EPS: an exact `<` comparison
 * here is what previously deleted clips during ordinary drags.
 */
export function trimClip(
  clips: TimelineClip[],
  assets: AssetMap,
  clipId: number,
  edge: "start" | "end",
  toTime: number,
  opts: RippleOption = {}
): TimelineClip[] {
  const out = clips.map(cloneClip);
  const clip = out.find(c => c.id === clipId);
  if (!clip || clip.locked) return normalizeTimeline(out, assets);

  const asset = getAsset(assets, clip.assetId);
  if (!asset) return normalizeTimeline(out, assets);

  if (edge === "start") {
    const maxStart = round(clipEnd(clip) - MIN_CLIP_DURATION);
    const minStart = round(clip.timelineStart - clip.sourceStart); // cannot expand past source head
    const target = round(
      Math.min(Math.max(toTime, Math.max(0, minStart)), maxStart)
    );
    const delta = round(target - clip.timelineStart);
    if (Math.abs(delta) < EPS) return normalizeTimeline(out, assets);
    clip.timelineStart = target;
    clip.sourceStart = round(clip.sourceStart + delta);
    clip.duration = round(clip.duration - delta);
  } else {
    const minEnd = round(clip.timelineStart + MIN_CLIP_DURATION);
    const maxEnd = round(
      clip.timelineStart + (asset.duration - clip.sourceStart)
    );
    const target = round(Math.min(Math.max(toTime, minEnd), maxEnd));
    const delta = round(target - clipEnd(clip));
    if (Math.abs(delta) < EPS) return normalizeTimeline(out, assets);
    clip.duration = round(clip.duration + delta);
  }

  let next = normalizeTimeline(out, assets);
  if (opts.ripple)
    next = normalizeTimeline(rippleTrack(next, clip.trackId), assets);
  return next;
}

/** Cuts a clip in two at an absolute timeline time. The right half is a new clip. */
export function splitClip(
  clips: TimelineClip[],
  assets: AssetMap,
  clipId: number,
  atTime: number
): { clips: TimelineClip[]; leftId: number | null; rightId: number | null } {
  const out = clips.map(cloneClip);
  const clip = out.find(c => c.id === clipId);
  if (!clip || clip.locked)
    return {
      clips: normalizeTimeline(out, assets),
      leftId: null,
      rightId: null,
    };

  const offset = round(atTime - clip.timelineStart);
  if (
    offset < MIN_CLIP_DURATION - EPS ||
    offset > clip.duration - MIN_CLIP_DURATION + EPS
  ) {
    return {
      clips: normalizeTimeline(out, assets),
      leftId: null,
      rightId: null,
    };
  }

  const right: TimelineClip = {
    ...cloneClip(clip),
    id: nextTempId(),
    sourceStart: round(clip.sourceStart + offset),
    duration: round(clip.duration - offset),
    timelineStart: round(atTime),
    sortIndex: clip.sortIndex + 1,
  };
  clip.duration = offset;
  out.push(right);

  return {
    clips: normalizeTimeline(out, assets),
    leftId: clip.id,
    rightId: right.id,
  };
}

/**
 * Moves a clip to a new track/time.
 *
 * sortIndex is set to -1 so that when the clip lands exactly on top of another
 * clip's start, the tie-break in `sortClips` places the moved clip first, which
 * is what the user sees under the cursor. The old code compared against
 * `currentSortIndex + 1` and produced off-by-one drops.
 */
export function moveClip(
  clips: TimelineClip[],
  assets: AssetMap,
  clipId: number,
  to: { trackId?: number; timelineStart: number },
  opts: RippleOption = {}
): TimelineClip[] {
  const out = clips.map(cloneClip);
  const clip = out.find(c => c.id === clipId);
  if (!clip || clip.locked) return normalizeTimeline(out, assets);

  const fromTrack = clip.trackId;
  clip.timelineStart = round(Math.max(0, to.timelineStart));
  if (to.trackId !== undefined) clip.trackId = to.trackId;
  clip.sortIndex = -1;

  let next = normalizeTimeline(out, assets);
  if (opts.ripple) {
    next = normalizeTimeline(rippleTrack(next, clip.trackId), assets);
    if (fromTrack !== clip.trackId)
      next = normalizeTimeline(rippleTrack(next, fromTrack), assets);
  }
  return next;
}

export function setClipProps(
  clips: TimelineClip[],
  assets: AssetMap,
  clipId: number,
  props: Partial<Pick<TimelineClip, "locked" | "visible" | "muted" | "trackId">>
): TimelineClip[] {
  const out = clips.map(c =>
    c.id === clipId ? { ...c, ...props } : cloneClip(c)
  );
  return normalizeTimeline(out, assets);
}

/**
 * Cuts spans of timeline time out of every track and closes the gaps.
 *
 * This is the primitive behind Remove Silence. Ripple is global rather than
 * per-track so video and audio cannot drift apart.
 */
export function removeRanges(
  clips: TimelineClip[],
  assets: AssetMap,
  ranges: TimeRange[]
): TimelineClip[] {
  const merged = mergeRanges(ranges);
  if (merged.length === 0) return normalizeTimeline(clips, assets);

  // 1. split every clip at every range boundary
  let out = normalizeTimeline(clips, assets);
  for (const range of merged) {
    for (const edge of [range.start, range.end]) {
      for (const clip of [...out]) {
        if (edge > clip.timelineStart + EPS && edge < clipEnd(clip) - EPS) {
          out = splitClip(out, assets, clip.id, edge).clips;
        }
      }
    }
  }

  // 2. drop anything that now sits wholly inside a removed span
  const inside = (clip: TimelineClip) =>
    merged.some(
      r => clip.timelineStart >= r.start - EPS && clipEnd(clip) <= r.end + EPS
    );
  out = out.filter(clip => !inside(clip));

  // 3. shift survivors left by the amount of removed time before them
  out = out.map(clip => {
    let shift = 0;
    for (const r of merged) {
      if (r.end <= clip.timelineStart + EPS) shift += r.end - r.start;
    }
    return {
      ...clip,
      timelineStart: round(Math.max(0, clip.timelineStart - shift)),
    };
  });

  return normalizeTimeline(out, assets);
}

/** Sorts, clamps to >= 0 and unions overlapping/adjacent ranges. */
export function mergeRanges(ranges: TimeRange[]): TimeRange[] {
  const valid = ranges
    .map(r => ({
      start: round(Math.max(0, Math.min(r.start, r.end))),
      end: round(Math.max(r.start, r.end)),
    }))
    .filter(r => r.end - r.start > EPS)
    .sort((a, b) => a.start - b.start);

  const out: TimeRange[] = [];
  for (const range of valid) {
    const last = out[out.length - 1];
    if (last && range.start <= last.end + EPS)
      last.end = Math.max(last.end, range.end);
    else out.push({ ...range });
  }
  return out;
}

/** Inverse of `mergeRanges` over [0, duration]: the spans that survive a cut. */
export function invertRanges(
  ranges: TimeRange[],
  duration: number
): TimeRange[] {
  const merged = mergeRanges(ranges);
  const out: TimeRange[] = [];
  let cursor = 0;
  for (const r of merged) {
    if (r.start - cursor > EPS)
      out.push({
        start: round(cursor),
        end: round(Math.min(r.start, duration)),
      });
    cursor = Math.max(cursor, r.end);
  }
  if (duration - cursor > EPS)
    out.push({ start: round(cursor), end: round(duration) });
  return out.filter(r => r.end - r.start > EPS);
}
