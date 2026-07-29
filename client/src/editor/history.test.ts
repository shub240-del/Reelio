import { describe, expect, it } from "vitest";
import {
  ClipSnapshot,
  TimelineHistory,
  diffSnapshots,
  planIsEmpty,
  snapshotClips,
  snapshotsEqual,
} from "./history";

function clip(id: number, over: Partial<ClipSnapshot> = {}): ClipSnapshot {
  return {
    id,
    assetId: 1,
    trackId: 0,
    trackType: "video",
    sourceStart: 0,
    duration: 10,
    timelineStart: 0,
    sortIndex: id,
    locked: false,
    visible: true,
    muted: false,
    ...over,
  };
}

function snap(clips: ClipSnapshot[], label = "edit", selection: number[] = []) {
  return { label, clips, selection };
}

describe("snapshotClips", () => {
  it("drops volatile fields so a reloaded blob URL is not seen as a change", () => {
    const withUrl = { ...clip(1), assetUrl: "blob:abc", assetName: "a.mp4" };
    const reloaded = { ...clip(1), assetUrl: "blob:xyz", assetName: "a.mp4" };
    expect(snapshotClips([withUrl])).toEqual(snapshotClips([reloaded]));
    expect(snapshotClips([withUrl])[0]).not.toHaveProperty("assetUrl");
  });

  it("orders by id so snapshots are comparable regardless of query order", () => {
    expect(snapshotClips([clip(3), clip(1), clip(2)]).map((c) => c.id)).toEqual([1, 2, 3]);
  });
});

describe("diffSnapshots", () => {
  it("is empty for identical timelines", () => {
    expect(planIsEmpty(diffSnapshots([clip(1), clip(2)], [clip(1), clip(2)]))).toBe(true);
  });

  it("emits only the fields that changed", () => {
    const plan = diffSnapshots([clip(1)], [clip(1, { timelineStart: 5 })]);
    expect(plan.update).toEqual([{ id: 1, timelineStart: 5 }]);
    expect(plan.create).toEqual([]);
    expect(plan.delete).toEqual([]);
  });

  it("restores a deleted clip by creating it (the old inverse-based undo could not)", () => {
    const plan = diffSnapshots([], [clip(7, { timelineStart: 3 })]);
    expect(plan.create).toHaveLength(1);
    expect(plan.create[0].id).toBe(7);
  });

  it("undoes a split by deleting the new clip and restoring the original duration", () => {
    // Split at 4s turned clip 1 (0..10) into clip 1 (0..4) + clip 2 (4..10).
    const afterSplit = [clip(1, { duration: 4 }), clip(2, { sourceStart: 4, duration: 6, timelineStart: 4 })];
    const beforeSplit = [clip(1, { duration: 10 })];
    const plan = diffSnapshots(afterSplit, beforeSplit);
    expect(plan.delete).toEqual([2]);
    expect(plan.update).toEqual([{ id: 1, duration: 10 }]);
  });

  it("undoes a duplicate by deleting the copy", () => {
    const plan = diffSnapshots([clip(1), clip(2, { timelineStart: 10 })], [clip(1)]);
    expect(plan.delete).toEqual([2]);
  });

  it("detects mute and visibility toggles", () => {
    expect(diffSnapshots([clip(1)], [clip(1, { muted: true })]).update).toEqual([
      { id: 1, muted: true },
    ]);
    expect(diffSnapshots([clip(1)], [clip(1, { visible: false })]).update).toEqual([
      { id: 1, visible: false },
    ]);
  });

  it("handles a reorder as pure sortIndex updates", () => {
    const plan = diffSnapshots(
      [clip(1, { sortIndex: 0 }), clip(2, { sortIndex: 1 })],
      [clip(1, { sortIndex: 1 }), clip(2, { sortIndex: 0 })],
    );
    expect(plan.update).toEqual([{ id: 1, sortIndex: 1 }, { id: 2, sortIndex: 0 }]);
  });
});

describe("snapshotsEqual", () => {
  it("ignores ordering", () => {
    expect(snapshotsEqual([clip(1), clip(2)], [clip(2), clip(1)])).toBe(true);
  });
  it("notices a differing field", () => {
    expect(snapshotsEqual([clip(1)], [clip(1, { duration: 9 })])).toBe(false);
  });
  it("notices a differing clip count", () => {
    expect(snapshotsEqual([clip(1)], [clip(1), clip(2)])).toBe(false);
  });
});

describe("TimelineHistory", () => {
  it("starts with nothing to undo or redo", () => {
    const h = new TimelineHistory();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    expect(h.undo(snap([clip(1)]))).toBeNull();
    expect(h.redo(snap([clip(1)]))).toBeNull();
  });

  it("returns the recorded state, which is what the broken version never did", () => {
    const h = new TimelineHistory();
    const before = snap([clip(1, { timelineStart: 0 })], "move");
    h.record(before);
    const restored = h.undo(snap([clip(1, { timelineStart: 292 })]));
    expect(restored?.clips[0].timelineStart).toBe(0);
  });

  it("round-trips undo then redo back to the edited state", () => {
    const h = new TimelineHistory();
    const before = [clip(1, { timelineStart: 0 })];
    const after = [clip(1, { timelineStart: 5 })];
    h.record(snap(before));
    const undone = h.undo(snap(after))!;
    expect(undone.clips).toEqual(before);
    const redone = h.redo(snap(undone.clips))!;
    expect(redone.clips).toEqual(after);
  });

  it("walks back through many edits in order", () => {
    const h = new TimelineHistory();
    for (let i = 0; i < 5; i++) h.record(snap([clip(1, { timelineStart: i })], `edit ${i}`));
    let current = snap([clip(1, { timelineStart: 5 })]);
    const seen: number[] = [];
    while (h.canUndo) {
      current = h.undo(current)!;
      seen.push(current.clips[0].timelineStart);
    }
    expect(seen).toEqual([4, 3, 2, 1, 0]);
  });

  it("redoes all the way forward again", () => {
    const h = new TimelineHistory();
    for (let i = 0; i < 3; i++) h.record(snap([clip(1, { timelineStart: i })]));
    let current = snap([clip(1, { timelineStart: 3 })]);
    while (h.canUndo) current = h.undo(current)!;
    const forward: number[] = [];
    while (h.canRedo) {
      current = h.redo(current)!;
      forward.push(current.clips[0].timelineStart);
    }
    expect(forward).toEqual([1, 2, 3]);
  });

  it("drops the redo branch when a new edit is made after undoing", () => {
    const h = new TimelineHistory();
    h.record(snap([clip(1, { timelineStart: 0 })]));
    h.undo(snap([clip(1, { timelineStart: 5 })]));
    expect(h.canRedo).toBe(true);
    h.record(snap([clip(1, { timelineStart: 0 })], "new edit"));
    expect(h.canRedo).toBe(false);
  });

  it("keeps history unlimited by default", () => {
    const h = new TimelineHistory();
    for (let i = 0; i < 500; i++) h.record(snap([clip(1, { timelineStart: i })]));
    expect(h.depth.past).toBe(500);
  });

  it("evicts oldest entries when a limit is set", () => {
    const h = new TimelineHistory(3);
    for (let i = 0; i < 10; i++) h.record(snap([clip(1, { timelineStart: i })], `e${i}`));
    expect(h.depth.past).toBe(3);
    expect(h.undoLabel).toBe("e9");
  });

  it("exposes labels for both directions", () => {
    const h = new TimelineHistory();
    h.record(snap([clip(1)], "Move clip"));
    expect(h.undoLabel).toBe("Move clip");
    h.undo(snap([clip(1, { timelineStart: 2 })], "Move clip"));
    expect(h.redoLabel).toBe("Move clip");
  });

  it("preserves selection so undo restores focus", () => {
    const h = new TimelineHistory();
    h.record(snap([clip(1), clip(2)], "delete", [2]));
    const restored = h.undo(snap([clip(1)], "delete", []))!;
    expect(restored.selection).toEqual([2]);
  });

  it("clear resets both stacks", () => {
    const h = new TimelineHistory();
    h.record(snap([clip(1)]));
    h.undo(snap([clip(1, { duration: 2 })]));
    h.clear();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });
});
