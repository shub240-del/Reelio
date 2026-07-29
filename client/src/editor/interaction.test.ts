import { describe, expect, it } from "vitest";
import {
  MIN_CLIP_DURATION,
  applySnap,
  dragToStart,
  duplicateStart,
  isDrag,
  nextSelection,
  reindexTrack,
  resolveTrim,
  snapCandidates,
  splitOffset,
} from "./interaction";

const origin = { clipId: 1, startAt: 4, pointerX: 200 };

describe("dragToStart", () => {
  it("does not move the clip when the pointer has not moved (the teleport bug)", () => {
    expect(dragToStart(origin, 200, 50)).toBe(4);
  });

  it("applies the pointer delta rather than the absolute position", () => {
    // Pointer moved +100px at 50px/s = +2s.
    expect(dragToStart(origin, 300, 50)).toBe(6);
    expect(dragToStart(origin, 100, 50)).toBe(2);
  });

  it("ignores where inside the clip the grab happened", () => {
    const grabbedLate = { clipId: 1, startAt: 4, pointerX: 380 };
    expect(dragToStart(grabbedLate, 430, 50)).toBe(5);
  });

  it("clamps at the timeline origin", () => {
    expect(dragToStart(origin, 0, 50)).toBe(0);
  });

  it("survives a zero zoom without dividing by zero", () => {
    expect(dragToStart(origin, 900, 0)).toBe(4);
  });
});

describe("isDrag", () => {
  it("treats a stationary press as a click", () => {
    expect(isDrag(origin, 200)).toBe(false);
    expect(isDrag(origin, 202)).toBe(false);
  });
  it("treats real movement as a drag", () => {
    expect(isDrag(origin, 210)).toBe(true);
    expect(isDrag(origin, 190)).toBe(true);
  });
});

describe("snapCandidates", () => {
  const clips = [
    { id: 1, timelineStart: 0, duration: 5 },
    { id: 2, timelineStart: 10, duration: 4 },
  ];

  it("includes the origin, playhead and other clips' edges", () => {
    expect(snapCandidates(clips, [], 7)).toEqual([0, 5, 7, 10, 14]);
  });

  it("excludes the dragged clip so it cannot snap to itself", () => {
    expect(snapCandidates(clips, [1], 7)).toEqual([0, 7, 10, 14]);
  });

  it("deduplicates coincident edges", () => {
    const touching = [
      { id: 1, timelineStart: 0, duration: 5 },
      { id: 2, timelineStart: 5, duration: 5 },
    ];
    expect(snapCandidates(touching, [], 0)).toEqual([0, 5, 10]);
  });
});

describe("applySnap", () => {
  it("snaps the leading edge to a nearby candidate", () => {
    const { start, snappedTo } = applySnap(10.1, 4, [0, 10, 20], 50);
    expect(start).toBeCloseTo(10);
    expect(snappedTo).toBe(10);
  });

  it("snaps the trailing edge so clips butt together", () => {
    // Clip is 4s long; dropping at 5.9 puts its end at 9.9, near candidate 10.
    const { start, snappedTo } = applySnap(5.9, 4, [10], 50);
    expect(start).toBeCloseTo(6);
    expect(snappedTo).toBe(10);
  });

  it("leaves the start alone when nothing is within range", () => {
    expect(applySnap(30, 4, [0, 10], 50)).toEqual({ start: 30, snappedTo: null });
  });

  it("prefers the closest candidate", () => {
    const { snappedTo } = applySnap(10.05, 4, [10, 10.4], 50);
    expect(snappedTo).toBe(10);
  });

  it("never snaps to a negative start", () => {
    const { start } = applySnap(0.05, 4, [0], 50);
    expect(start).toBeGreaterThanOrEqual(0);
  });

  it("scales tolerance with zoom, so snapping stays 8px on screen", () => {
    // At 200px/s, 8px is only 0.04s, so a 0.1s gap must not snap.
    expect(applySnap(10.1, 4, [10], 200).snappedTo).toBeNull();
    expect(applySnap(10.1, 4, [10], 20).snappedTo).toBe(10);
  });
});

describe("reindexTrack", () => {
  it("orders by timeline position", () => {
    const clips = [
      { id: 1, timelineStart: 20, sortIndex: 0 },
      { id: 2, timelineStart: 0, sortIndex: 1 },
    ];
    // Emitted in timeline order, so id 2 (at 0s) comes first.
    expect(reindexTrack(clips)).toEqual([{ id: 2, sortIndex: 0 }, { id: 1, sortIndex: 1 }]);
  });

  it("returns nothing when order is already correct", () => {
    const clips = [
      { id: 1, timelineStart: 0, sortIndex: 0 },
      { id: 2, timelineStart: 10, sortIndex: 1 },
    ];
    expect(reindexTrack(clips)).toEqual([]);
  });

  it("breaks ties on identical starts deterministically", () => {
    const clips = [
      { id: 5, timelineStart: 0, sortIndex: 9 },
      { id: 2, timelineStart: 0, sortIndex: 9 },
    ];
    expect(reindexTrack(clips)).toEqual([{ id: 2, sortIndex: 0 }, { id: 5, sortIndex: 1 }]);
  });
});

describe("nextSelection", () => {
  it("replaces the selection on a plain click", () => {
    expect(nextSelection([1, 2], 3)).toEqual([3]);
  });
  it("adds with ctrl or meta", () => {
    expect(nextSelection([1], 2, { ctrl: true })).toEqual([1, 2]);
    expect(nextSelection([1], 2, { meta: true })).toEqual([1, 2]);
  });
  it("toggles an already selected clip off with ctrl", () => {
    expect(nextSelection([1, 2], 2, { ctrl: true })).toEqual([1]);
  });
  it("shift adds without removing", () => {
    expect(nextSelection([1, 2], 2, { shift: true })).toEqual([1, 2]);
    expect(nextSelection([1], 2, { shift: true })).toEqual([1, 2]);
  });
});

describe("resolveTrim", () => {
  const clip = { sourceStart: 2, duration: 6, timelineStart: 10 };

  it("moves source in-point and timeline start together on a left trim", () => {
    const r = resolveTrim(clip, "start", 1, 20);
    expect(r).toEqual({ sourceStart: 3, duration: 5, timelineStart: 11 });
  });

  it("extends a left trim backwards into unused source", () => {
    const r = resolveTrim(clip, "start", -2, 20);
    expect(r).toEqual({ sourceStart: 0, duration: 8, timelineStart: 8 });
  });

  it("cannot pull the left edge past the head of the source", () => {
    const r = resolveTrim(clip, "start", -10, 20);
    expect(r.sourceStart).toBe(0);
    expect(r.duration).toBe(8);
  });

  it("enforces a minimum duration on a left trim", () => {
    const r = resolveTrim(clip, "start", 100, 20);
    expect(r.duration).toBeCloseTo(MIN_CLIP_DURATION);
  });

  it("shortens on a right trim without touching the source in-point", () => {
    const r = resolveTrim(clip, "end", -2, 20);
    expect(r).toEqual({ sourceStart: 2, duration: 4, timelineStart: 10 });
  });

  it("cannot extend a right trim past the end of the source", () => {
    const r = resolveTrim(clip, "end", 100, 20);
    expect(r.duration).toBe(18);
  });

  it("enforces a minimum duration on a right trim", () => {
    const r = resolveTrim(clip, "end", -100, 20);
    expect(r.duration).toBeCloseTo(MIN_CLIP_DURATION);
  });

  it("keeps timelineStart non-negative when trimming a clip at zero", () => {
    const atZero = { sourceStart: 5, duration: 5, timelineStart: 0 };
    expect(resolveTrim(atZero, "start", -5, 20).timelineStart).toBe(0);
  });
});

describe("duplicateStart", () => {
  it("places the copy directly after the original", () => {
    const clip = { id: 1, timelineStart: 0, duration: 5 };
    expect(duplicateStart(clip, [clip])).toBe(5);
  });

  it("skips past a clip that already occupies that space", () => {
    const clip = { id: 1, timelineStart: 0, duration: 5 };
    const track = [clip, { id: 2, timelineStart: 5, duration: 3 }];
    expect(duplicateStart(clip, track)).toBe(8);
  });

  it("keeps skipping across a run of adjacent clips", () => {
    const clip = { id: 1, timelineStart: 0, duration: 5 };
    const track = [
      clip,
      { id: 2, timelineStart: 5, duration: 3 },
      { id: 3, timelineStart: 8, duration: 2 },
    ];
    expect(duplicateStart(clip, track)).toBe(10);
  });
});

describe("splitOffset", () => {
  const clip = { id: 1, timelineStart: 10, duration: 6 };

  it("returns the offset when the playhead is inside the clip", () => {
    expect(splitOffset(clip, 13)).toBe(3);
  });

  it("refuses a split at or before the clip start", () => {
    expect(splitOffset(clip, 10)).toBeNull();
    expect(splitOffset(clip, 5)).toBeNull();
  });

  it("refuses a split at or past the clip end, which would make a zero-length clip", () => {
    expect(splitOffset(clip, 16)).toBeNull();
    expect(splitOffset(clip, 20)).toBeNull();
  });
});
