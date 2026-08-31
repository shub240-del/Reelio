/**
 * Snapshot-based timeline history.
 *
 * The previous implementation stored action inverses ({type, clipId, undo}) and
 * could not represent structural changes: undoing a delete was impossible
 * because the row was gone, and undoing a split would have required deleting a
 * clip that the inverse record never mentioned. Worse, the toolbar buttons only
 * popped the stack and never applied the result, so the enabled state toggled
 * while the timeline never changed.
 *
 * Snapshots make every operation undoable by the same mechanism: record the
 * whole clip list before mutating, and to undo, reconcile the store back to the
 * recorded list. No operation needs its own inverse.
 */

export interface ClipSnapshot {
  id: number;
  assetId: number;
  trackId: number;
  trackType: "video" | "audio";
  sourceStart: number;
  duration: number;
  timelineStart: number;
  sortIndex: number;
  locked: boolean;
  visible: boolean;
  muted: boolean;
  videoFx?: string | null;
  transition?: string | null;
}

export interface TrackStateSnapshot {
  muted: boolean;
  locked: boolean;
  visible: boolean;
}

export type TrackStatesSnapshot = Record<string, TrackStateSnapshot>;

export interface TimelineSnapshot {
  label: string;
  clips: ClipSnapshot[];
  /** Clip ids selected when the snapshot was taken, so undo can restore focus. */
  selection: number[];
  /** Persisted track controls captured with the timeline state. */
  trackStates?: TrackStatesSnapshot;
}

/**
 * Fields that define a clip's identity on the timeline. Deliberately excludes
 * assetUrl and assetName: in guest mode assetUrl is an object URL regenerated
 * on every page load, so comparing it would make every clip look changed after
 * a reload and produce an endless stream of no-op writes.
 */
const COMPARED_FIELDS: (keyof ClipSnapshot)[] = [
  "assetId",
  "trackId",
  "trackType",
  "sourceStart",
  "duration",
  "timelineStart",
  "sortIndex",
  "locked",
  "visible",
  "muted",
  "videoFx",
  "transition",
];

/** Copies only the persistent fields, dropping volatile ones like assetUrl. */
export function snapshotClip(clip: ClipSnapshot): ClipSnapshot {
  return {
    id: clip.id,
    assetId: clip.assetId,
    trackId: clip.trackId,
    trackType: clip.trackType,
    sourceStart: clip.sourceStart,
    duration: clip.duration,
    timelineStart: clip.timelineStart,
    sortIndex: clip.sortIndex,
    locked: clip.locked,
    visible: clip.visible,
    muted: clip.muted,
    videoFx: clip.videoFx ?? null,
    transition: clip.transition ?? null,
  };
}

export function snapshotClips(clips: readonly ClipSnapshot[]): ClipSnapshot[] {
  return clips.map(snapshotClip).sort((a, b) => a.id - b.id);
}

/** True when two clips agree on every persistent field (ignoring id). */
export function clipsEquivalent(a: ClipSnapshot, b: ClipSnapshot): boolean {
  return COMPARED_FIELDS.every((f) => a[f] === b[f]);
}

export function snapshotsEqual(a: readonly ClipSnapshot[], b: readonly ClipSnapshot[]): boolean {
  if (a.length !== b.length) return false;
  const byId = new Map(b.map((c) => [c.id, c]));
  return a.every((clip) => {
    const other = byId.get(clip.id);
    return other !== undefined && clipsEquivalent(clip, other);
  });
}

export interface ReconcilePlan {
  /** Clips present in the target but missing from the store. */
  create: ClipSnapshot[];
  /** Only the fields that actually differ, plus the id. */
  update: (Partial<ClipSnapshot> & { id: number })[];
  /** Ids present in the store but not in the target. */
  delete: number[];
}

/**
 * Computes the minimal set of store writes that turns `current` into `target`.
 * Emitting only changed fields keeps undo cheap: nudging one clip produces one
 * single-field update rather than rewriting the entire timeline.
 */
export function diffSnapshots(
  current: readonly ClipSnapshot[],
  target: readonly ClipSnapshot[],
): ReconcilePlan {
  const currentById = new Map(current.map((c) => [c.id, c]));
  const targetById = new Map(target.map((c) => [c.id, c]));

  const plan: ReconcilePlan = { create: [], update: [], delete: [] };

  for (const want of target) {
    const have = currentById.get(want.id);
    if (!have) {
      plan.create.push(want);
      continue;
    }
    const changed: Partial<ClipSnapshot> & { id: number } = { id: want.id };
    let dirty = false;
    for (const field of COMPARED_FIELDS) {
      if (have[field] !== want[field]) {
        (changed as Record<string, unknown>)[field] = want[field];
        dirty = true;
      }
    }
    if (dirty) plan.update.push(changed);
  }

  for (const have of current) {
    if (!targetById.has(have.id)) plan.delete.push(have.id);
  }

  return plan;
}

export function planIsEmpty(plan: ReconcilePlan): boolean {
  return plan.create.length === 0 && plan.update.length === 0 && plan.delete.length === 0;
}

/**
 * Undo/redo stacks over timeline snapshots.
 *
 * Callers pass the live clip list in at undo/redo time rather than the store
 * keeping its own mirror of the present. A mirror would drift out of sync with
 * the tRPC cache — which is the real source of truth here — and drift is what
 * made the old implementation silently wrong.
 */
export class TimelineHistory {
  private past: TimelineSnapshot[] = [];
  private future: TimelineSnapshot[] = [];

  /** 0 means unlimited; entries are dropped oldest-first past the limit. */
  constructor(private readonly limit = 0) {}

  /** Records the state *before* an edit is applied. */
  record(snapshot: TimelineSnapshot): void {
    this.past.push(snapshot);
    if (this.limit > 0 && this.past.length > this.limit) {
      this.past.splice(0, this.past.length - this.limit);
    }
    // A fresh edit invalidates any redo branch.
    this.future = [];
  }

  /**
   * Returns the state to restore, or null when there is nothing to undo.
   * `current` is banked so redo can return to it.
   */
  undo(current: TimelineSnapshot): TimelineSnapshot | null {
    const previous = this.past.pop();
    if (!previous) return null;
    this.future.unshift(current);
    return previous;
  }

  redo(current: TimelineSnapshot): TimelineSnapshot | null {
    const next = this.future.shift();
    if (!next) return null;
    this.past.push(current);
    return next;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get undoLabel(): string | null {
    return this.past.length ? this.past[this.past.length - 1].label : null;
  }

  get redoLabel(): string | null {
    return this.future.length ? this.future[0].label : null;
  }

  get depth(): { past: number; future: number } {
    return { past: this.past.length, future: this.future.length };
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }
}
