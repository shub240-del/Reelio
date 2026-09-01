import { describe, expect, it } from "vitest";
import { planEditorRequest } from "./ai";

describe("editor AI planner", () => {
  it("returns a validated removeRanges operation for the required command", () => {
    const plan = planEditorRequest("Remove the first 5 seconds.", []);
    expect(plan.operations).toEqual([
      expect.objectContaining({
        type: "removeRanges",
        ranges: [{ start: 0, end: 5 }],
      }),
    ]);
  });

  it("does not invent a timeline mutation for unsupported requests", () => {
    const plan = planEditorRequest("Make it cinematic.", []);
    expect(plan.operations).toEqual([]);
  });

  it("proposes a selected-clip playhead split in guest mode", () => {
    const plan = planEditorRequest(
      "Split the selected clip at the playhead.",
      [
        {
          id: 4,
          assetId: 1,
          trackId: 0,
          trackType: "video",
          sourceStart: 0,
          duration: 10,
          timelineStart: 0,
          sortIndex: 0,
          locked: false,
          visible: true,
          muted: false,
        },
      ],
      [],
      { playhead: 3, selectedClipIds: [4] }
    );
    expect(plan.operations).toEqual([
      { type: "splitClip", clipId: 4, atTime: 3 },
    ]);
  });
});
