import { beforeEach, describe, expect, it } from "vitest";
import {
  applyEditOps,
  describePlan,
  editOpSchema,
  editPlanSchema,
  getAffectedRanges,
  type EditOp,
} from "./editOps";
import {
  normalizeTimeline,
  resetTempIds,
  timelineDuration,
  type TimelineAsset,
  type TimelineClip,
} from "./timeline";

const ASSETS: Record<number, TimelineAsset> = {
  1: {
    id: 1,
    duration: 10,
    hasAudio: true,
    width: 1920,
    height: 1080,
    fps: 30,
  },
};

function clip(over: Partial<TimelineClip> & { id: number }): TimelineClip {
  return {
    assetId: 1,
    trackId: 0,
    trackType: "video",
    sourceStart: 0,
    duration: 2,
    timelineStart: 0,
    sortIndex: 0,
    locked: false,
    visible: true,
    muted: false,
    ...over,
  };
}

const base = () =>
  normalizeTimeline(
    [
      clip({ id: 1, timelineStart: 0, sourceStart: 0 }),
      clip({ id: 2, timelineStart: 2, sourceStart: 2 }),
      clip({ id: 3, timelineStart: 4, sourceStart: 4 }),
    ],
    ASSETS
  );

beforeEach(() => resetTempIds());

describe("schema validation", () => {
  it("accepts a well formed removeRanges op", () => {
    expect(
      editOpSchema.safeParse({
        type: "removeRanges",
        ranges: [{ start: 0, end: 1 }],
      }).success
    ).toBe(true);
  });

  it("rejects an unknown op type", () => {
    expect(
      editOpSchema.safeParse({ type: "explode", ranges: [] }).success
    ).toBe(false);
  });

  it("rejects negative times", () => {
    expect(
      editOpSchema.safeParse({
        type: "removeRanges",
        ranges: [{ start: -1, end: 1 }],
      }).success
    ).toBe(false);
  });

  it("rejects an empty range list", () => {
    expect(
      editOpSchema.safeParse({ type: "removeRanges", ranges: [] }).success
    ).toBe(false);
  });

  it("applies defaults for optional fields", () => {
    const parsed = editOpSchema.parse({ type: "removeClips", clipIds: [1] });
    expect(parsed).toMatchObject({ ripple: true });
  });

  it("validates a whole plan", () => {
    const plan = editPlanSchema.safeParse({
      summary: "Cut the dead air",
      operations: [{ type: "removeRanges", ranges: [{ start: 1, end: 2 }] }],
    });
    expect(plan.success).toBe(true);
  });

  it("rejects a plan with no summary", () => {
    expect(
      editPlanSchema.safeParse({ summary: "", operations: [] }).success
    ).toBe(false);
  });

  it("caps caption text length", () => {
    const long = "x".repeat(501);
    expect(
      editOpSchema.safeParse({
        type: "addCaptions",
        cues: [{ text: long, startTime: 0, endTime: 1 }],
      }).success
    ).toBe(false);
  });
});

describe("applyEditOps", () => {
  it("executes removeRanges through the engine", () => {
    const res = applyEditOps(base(), ASSETS, [
      { type: "removeRanges", ranges: [{ start: 2, end: 4 }] },
    ]);
    expect(timelineDuration(res.clips)).toBe(4);
    expect(res.applied).toHaveLength(1);
  });

  it("executes keepRanges as the inverse of removeRanges", () => {
    const res = applyEditOps(base(), ASSETS, [
      { type: "keepRanges", ranges: [{ start: 0, end: 2 }] },
    ]);
    expect(timelineDuration(res.clips)).toBe(2);
  });

  it("chains several operations in order", () => {
    const ops: EditOp[] = [
      { type: "splitClip", clipId: 1, atTime: 1 },
      { type: "removeRanges", ranges: [{ start: 4, end: 6 }] },
    ];
    const res = applyEditOps(base(), ASSETS, ops);
    expect(res.applied).toHaveLength(2);
    expect(timelineDuration(res.clips)).toBe(4);
  });

  it("skips an op that references a missing clip instead of throwing", () => {
    const res = applyEditOps(base(), ASSETS, [
      { type: "splitClip", clipId: 999, atTime: 1 },
    ]);
    expect(res.skipped).toHaveLength(1);
    expect(res.clips).toHaveLength(3);
  });

  it("keeps applying later ops after one is skipped", () => {
    const ops: EditOp[] = [
      { type: "splitClip", clipId: 999, atTime: 1 },
      { type: "removeClips", clipIds: [3], ripple: false },
    ];
    const res = applyEditOps(base(), ASSETS, ops);
    expect(res.skipped).toHaveLength(1);
    expect(res.applied).toHaveLength(1);
    expect(res.clips).toHaveLength(2);
  });

  it("records a split point outside the clip as skipped", () => {
    const res = applyEditOps(base(), ASSETS, [
      { type: "splitClip", clipId: 1, atTime: 9 },
    ]);
    expect(res.skipped[0].reason).toMatch(/outside/);
  });

  it("routes captions to side effects without touching the timeline", () => {
    const res = applyEditOps(base(), ASSETS, [
      {
        type: "addCaptions",
        cues: [{ text: "hello", startTime: 0, endTime: 1 }],
        replaceExisting: true,
      },
    ]);
    expect(res.sideEffects).toHaveLength(1);
    expect(res.clips).toEqual(base());
  });

  it("routes markers to side effects", () => {
    const res = applyEditOps(base(), ASSETS, [
      {
        type: "addMarkers",
        markers: [{ time: 2, label: "scene", color: "#fff" }],
        replaceExisting: false,
      },
    ]);
    expect(res.sideEffects[0].type).toBe("addMarkers");
  });

  it("routes audio filters to side effects", () => {
    const res = applyEditOps(base(), ASSETS, [
      {
        type: "setAudioFilter",
        highPassHz: 80,
        noiseGateDb: -40,
        gainDb: 0,
        normalize: true,
      },
    ]);
    expect(res.sideEffects[0].type).toBe("setAudioFilter");
  });

  it("applies only allowlisted video effects to video clips", () => {
    const res = applyEditOps(base(), ASSETS, [
      { type: "setVideoEffect", clipId: 1, effect: "Cinematic LUT" },
    ]);
    expect(res.clips.find(candidate => candidate.id === 1)?.videoFx).toBe(
      "Cinematic LUT"
    );
    expect(res.sideEffects).toEqual([]);
    expect(
      editOpSchema.safeParse({
        type: "setVideoEffect",
        clipId: 1,
        effect: "run-script",
      }).success
    ).toBe(false);
  });

  it("leaves the timeline valid after a hostile plan", () => {
    const ops: EditOp[] = [
      { type: "trimClip", clipId: 1, edge: "end", toTime: 9999, ripple: false },
      { type: "moveClip", clipId: 2, timelineStart: 0, ripple: false },
      { type: "removeRanges", ranges: [{ start: 0, end: 0.5 }] },
    ];
    const res = applyEditOps(base(), ASSETS, ops);
    for (const c of res.clips) {
      expect(c.sourceStart).toBeGreaterThanOrEqual(0);
      expect(c.sourceStart + c.duration).toBeLessThanOrEqual(
        ASSETS[1].duration + 1e-6
      );
      expect(c.timelineStart).toBeGreaterThanOrEqual(0);
    }
  });

  it("does not mutate the input timeline", () => {
    const input = base();
    const snapshot = JSON.stringify(input);
    applyEditOps(input, ASSETS, [
      { type: "removeRanges", ranges: [{ start: 0, end: 2 }] },
    ]);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("returns the timeline unchanged for an empty plan", () => {
    expect(applyEditOps(base(), ASSETS, []).clips).toEqual(base());
  });
});

describe("describePlan", () => {
  it("summarises a silence removal", () => {
    const text = describePlan({
      summary: "s",
      operations: [{ type: "removeRanges", ranges: [{ start: 0, end: 1.5 }] }],
    });
    expect(text).toBe("Remove 1 span (1.5s)");
  });

  it("reports no changes for an empty plan", () => {
    expect(describePlan({ summary: "s", operations: [] })).toBe("No changes");
  });
});

describe("getAffectedRanges", () => {
  it("extracts highlighted ranges from removeRanges", () => {
    const highlights = getAffectedRanges(
      {
        type: "removeRanges",
        ranges: [{ start: 2.0, end: 4.5 }],
        reason: "Pause removal",
      },
      base()
    );
    expect(highlights).toHaveLength(1);
    expect(highlights[0]).toEqual({
      start: 2.0,
      end: 4.5,
      label: "Pause removal",
      type: "remove",
    });
  });

  it("extracts highlighted ranges from splitClip and removeClips", () => {
    const clips = base();
    const splitHighlights = getAffectedRanges(
      { type: "splitClip", clipId: 1, atTime: 3.5 },
      clips
    );
    expect(splitHighlights).toHaveLength(1);
    expect(splitHighlights[0].type).toBe("split");

    const deleteHighlights = getAffectedRanges(
      { type: "removeClips", clipIds: [1] },
      clips
    );
    expect(deleteHighlights).toHaveLength(1);
    expect(deleteHighlights[0].type).toBe("remove");
    expect(deleteHighlights[0].start).toBe(clips[0].timelineStart);
  });
});
