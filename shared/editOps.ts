/**
 * The contract between the AI and the timeline.
 *
 * An AI feature never mutates the editor directly and never returns prose that
 * the UI has to interpret. It returns a list of these operations, they are
 * validated by zod, and `applyEditOps` replays them through the pure timeline
 * engine. That means every AI edit is undoable, previewable, testable and
 * identical whether it came from the model, a test or a button.
 */
import { z } from "zod";
import {
  moveClip,
  normalizeTimeline,
  removeClips,
  removeRanges,
  setClipProps,
  splitClip,
  timelineDuration,
  trimClip,
  type AssetMap,
  type TimelineClip,
} from "./timeline";

const timeRange = z.object({
  start: z.number().min(0),
  end: z.number().min(0),
});

export const captionCueSchema = z.object({
  text: z.string().min(1).max(500),
  startTime: z.number().min(0),
  endTime: z.number().min(0),
});
export type CaptionCue = z.infer<typeof captionCueSchema>;

export const markerSchema = z.object({
  time: z.number().min(0),
  label: z.string().max(256).default(""),
  color: z.string().max(32).default("#7c5cff"),
});
export type MarkerSpec = z.infer<typeof markerSchema>;

/* ────────────────────────── operations ────────────────────────── */

export const editOpSchema = z.discriminatedUnion("type", [
  /** Cut spans of timeline time out and close the gaps. Remove Silence, dead-air trimming. */
  z.object({
    type: z.literal("removeRanges"),
    ranges: z.array(timeRange).min(1).max(2000),
    reason: z.string().max(200).optional(),
  }),
  /** Delete whole clips. */
  z.object({
    type: z.literal("removeClips"),
    clipIds: z.array(z.number().int()).min(1).max(500),
    ripple: z.boolean().default(true),
  }),
  /** Cut a clip in two. Scene detection turns boundaries into cuts with this. */
  z.object({
    type: z.literal("splitClip"),
    clipId: z.number().int(),
    atTime: z.number().min(0),
  }),
  z.object({
    type: z.literal("trimClip"),
    clipId: z.number().int(),
    edge: z.enum(["start", "end"]),
    toTime: z.number().min(0),
    ripple: z.boolean().default(false),
  }),
  z.object({
    type: z.literal("moveClip"),
    clipId: z.number().int(),
    trackId: z.number().int().min(0).max(32).optional(),
    timelineStart: z.number().min(0),
    ripple: z.boolean().default(false),
  }),
  z.object({
    type: z.literal("setClipProps"),
    clipId: z.number().int(),
    visible: z.boolean().optional(),
    muted: z.boolean().optional(),
    locked: z.boolean().optional(),
  }),
  /** Keep only these spans; the inverse of removeRanges. Highlight reels. */
  z.object({
    type: z.literal("keepRanges"),
    ranges: z.array(timeRange).min(1).max(500),
    reason: z.string().max(200).optional(),
  }),
  /** Side-effect ops: not timeline geometry, applied by the caller. */
  z.object({
    type: z.literal("addCaptions"),
    cues: z.array(captionCueSchema).min(1).max(2000),
    replaceExisting: z.boolean().default(true),
  }),
  z.object({
    type: z.literal("addMarkers"),
    markers: z.array(markerSchema).min(1).max(500),
    replaceExisting: z.boolean().default(false),
  }),
  z.object({
    type: z.literal("setAudioFilter"),
    clipId: z.number().int().optional(),
    highPassHz: z.number().min(0).max(2000).default(0),
    noiseGateDb: z.number().min(-100).max(0).default(-100),
    gainDb: z.number().min(-40).max(40).default(0),
    normalize: z.boolean().default(false),
  }),
]);

export type EditOp = z.infer<typeof editOpSchema>;
export type EditOpType = EditOp["type"];

/** What the AI returns: a human summary plus the machine-executable plan. */
export const editPlanSchema = z.object({
  summary: z.string().min(1).max(2000),
  operations: z.array(editOpSchema).max(2000),
});
export type EditPlan = z.infer<typeof editPlanSchema>;

/** Ops that change timeline geometry; the rest are side effects for the caller. */
const TIMELINE_OPS: ReadonlySet<string> = new Set([
  "removeRanges",
  "removeClips",
  "splitClip",
  "trimClip",
  "moveClip",
  "setClipProps",
  "keepRanges",
]);

export function isTimelineOp(op: EditOp): boolean {
  return TIMELINE_OPS.has(op.type);
}

export interface ApplyResult {
  clips: TimelineClip[];
  /** Ops the caller must handle itself (captions, markers, audio filters). */
  sideEffects: EditOp[];
  applied: EditOp[];
  /** Ops that referenced a clip that no longer exists, etc. Never throws. */
  skipped: { op: EditOp; reason: string }[];
}

/**
 * Replays a plan onto a timeline.
 *
 * Never throws and never partially corrupts: an operation that cannot apply is
 * recorded in `skipped` and the rest of the plan still runs. Every step goes
 * through the engine, so the invariants hold at the end no matter what the model
 * asked for.
 */
export function applyEditOps(
  clips: TimelineClip[],
  assets: AssetMap,
  ops: EditOp[],
): ApplyResult {
  let current = normalizeTimeline(clips, assets);
  const sideEffects: EditOp[] = [];
  const applied: EditOp[] = [];
  const skipped: { op: EditOp; reason: string }[] = [];

  const exists = (id: number) => current.some((c) => c.id === id);

  for (const op of ops) {
    if (!isTimelineOp(op)) {
      sideEffects.push(op);
      applied.push(op);
      continue;
    }

    const before = current;
    switch (op.type) {
      case "removeRanges":
        current = removeRanges(current, assets, op.ranges);
        break;

      case "keepRanges": {
        const total = timelineDuration(current);
        const keep = op.ranges.filter((r) => r.end > r.start);
        if (keep.length === 0) {
          skipped.push({ op, reason: "no usable ranges" });
          continue;
        }
        const drop = invert(keep, total);
        current = removeRanges(current, assets, drop);
        break;
      }

      case "removeClips": {
        const known = op.clipIds.filter(exists);
        if (known.length === 0) {
          skipped.push({ op, reason: "no such clip" });
          continue;
        }
        current = removeClips(current, known, assets, { ripple: op.ripple });
        break;
      }

      case "splitClip": {
        if (!exists(op.clipId)) {
          skipped.push({ op, reason: "no such clip" });
          continue;
        }
        const res = splitClip(current, assets, op.clipId, op.atTime);
        if (res.rightId === null) {
          skipped.push({ op, reason: "split point outside clip" });
          continue;
        }
        current = res.clips;
        break;
      }

      case "trimClip":
        if (!exists(op.clipId)) {
          skipped.push({ op, reason: "no such clip" });
          continue;
        }
        current = trimClip(current, assets, op.clipId, op.edge, op.toTime, { ripple: op.ripple });
        break;

      case "moveClip":
        if (!exists(op.clipId)) {
          skipped.push({ op, reason: "no such clip" });
          continue;
        }
        current = moveClip(
          current,
          assets,
          op.clipId,
          { trackId: op.trackId, timelineStart: op.timelineStart },
          { ripple: op.ripple },
        );
        break;

      case "setClipProps": {
        if (!exists(op.clipId)) {
          skipped.push({ op, reason: "no such clip" });
          continue;
        }
        const props: Partial<Pick<TimelineClip, "locked" | "visible" | "muted">> = {};
        if (op.visible !== undefined) props.visible = op.visible;
        if (op.muted !== undefined) props.muted = op.muted;
        if (op.locked !== undefined) props.locked = op.locked;
        current = setClipProps(current, assets, op.clipId, props);
        break;
      }
    }

    if (current === before) skipped.push({ op, reason: "no effect" });
    else applied.push(op);
  }

  return { clips: current, sideEffects, applied, skipped };
}

/** Local copy of range inversion so keepRanges does not depend on call order. */
function invert(keep: { start: number; end: number }[], total: number) {
  const sorted = [...keep].sort((a, b) => a.start - b.start);
  const out: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const r of sorted) {
    if (r.start > cursor) out.push({ start: cursor, end: Math.min(r.start, total) });
    cursor = Math.max(cursor, r.end);
  }
  if (cursor < total) out.push({ start: cursor, end: total });
  return out.filter((r) => r.end > r.start);
}

/** One-line description of a plan, for the AI panel and the undo history label. */
export function describeOp(op: EditOp): string {
  switch (op.type) {
    case "removeRanges": {
      const secs = op.ranges.reduce((n, r) => n + Math.max(0, r.end - r.start), 0);
      return `Remove ${op.ranges.length} span${op.ranges.length === 1 ? "" : "s"} (${secs.toFixed(1)}s)`;
    }
    case "keepRanges":
      return `Keep ${op.ranges.length} highlight${op.ranges.length === 1 ? "" : "s"}`;
    case "removeClips":
      return `Delete ${op.clipIds.length} clip${op.clipIds.length === 1 ? "" : "s"}`;
    case "splitClip":
      return `Split clip at ${op.atTime.toFixed(2)}s`;
    case "trimClip":
      return `Trim clip ${op.edge} to ${op.toTime.toFixed(2)}s`;
    case "moveClip":
      return `Move clip to ${op.timelineStart.toFixed(2)}s`;
    case "setClipProps":
      return "Change clip properties";
    case "addCaptions":
      return `Add ${op.cues.length} caption${op.cues.length === 1 ? "" : "s"}`;
    case "addMarkers":
      return `Add ${op.markers.length} marker${op.markers.length === 1 ? "" : "s"}`;
    case "setAudioFilter":
      return "Apply audio cleanup";
  }
}

export function describePlan(plan: EditPlan): string {
  if (plan.operations.length === 0) return "No changes";
  return plan.operations.map(describeOp).join(", ");
}
