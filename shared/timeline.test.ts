import { beforeEach, describe, expect, it } from "vitest";
import {
  addClip,
  clipEnd,
  invertRanges,
  mergeRanges,
  moveClip,
  nextBoundaryAfter,
  normalizeTimeline,
  removeClips,
  removeRanges,
  resetTempIds,
  resolveAtTime,
  rippleTrack,
  setClipProps,
  splitClip,
  timelineDuration,
  trimClip,
  type TimelineAsset,
  type TimelineClip,
} from "./timeline";

const ASSETS: Record<number, TimelineAsset> = {
  1: { id: 1, duration: 10, hasAudio: true, width: 1920, height: 1080, fps: 30 },
  2: { id: 2, duration: 5, hasAudio: false, width: 1280, height: 720, fps: 25 },
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

/** Three abutting 2s clips at 0-2, 2-4, 4-6. */
function threeClips(): TimelineClip[] {
  return normalizeTimeline(
    [
      clip({ id: 1, timelineStart: 0, sourceStart: 0 }),
      clip({ id: 2, timelineStart: 2, sourceStart: 2 }),
      clip({ id: 3, timelineStart: 4, sourceStart: 4 }),
    ],
    ASSETS,
  );
}

beforeEach(() => resetTempIds());

describe("normalizeTimeline", () => {
  it("keeps a valid timeline untouched", () => {
    const clips = threeClips();
    expect(clips.map((c) => [c.timelineStart, c.duration])).toEqual([
      [0, 2],
      [2, 2],
      [4, 2],
    ]);
  });

  it("drops clips whose asset is missing", () => {
    const clips = normalizeTimeline([clip({ id: 1, assetId: 99 })], ASSETS);
    expect(clips).toHaveLength(0);
  });

  it("clamps a clip that reads past the end of its asset instead of deleting it", () => {
    const clips = normalizeTimeline([clip({ id: 1, sourceStart: 8, duration: 5 })], ASSETS);
    expect(clips).toHaveLength(1);
    expect(clips[0].duration).toBe(2);
  });

  it("clamps a negative sourceStart to zero", () => {
    const clips = normalizeTimeline([clip({ id: 1, sourceStart: -3, duration: 2 })], ASSETS);
    expect(clips[0].sourceStart).toBe(0);
  });

  it("clamps a negative timelineStart to zero", () => {
    const clips = normalizeTimeline([clip({ id: 1, timelineStart: -5 })], ASSETS);
    expect(clips[0].timelineStart).toBe(0);
  });

  it("drops a clip below the minimum duration", () => {
    expect(normalizeTimeline([clip({ id: 1, duration: 0.001 })], ASSETS)).toHaveLength(0);
  });

  it("drops an audio clip whose asset has no audio track", () => {
    const clips = normalizeTimeline([clip({ id: 1, assetId: 2, trackType: "audio", trackId: 1 })], ASSETS);
    expect(clips).toHaveLength(0);
  });

  it("pushes overlapping clips apart rather than losing one", () => {
    const clips = normalizeTimeline(
      [clip({ id: 1, timelineStart: 0, duration: 3 }), clip({ id: 2, timelineStart: 1, duration: 2 })],
      ASSETS,
    );
    expect(clips).toHaveLength(2);
    expect(clips[1].timelineStart).toBe(3);
  });

  it("renumbers sortIndex densely per track", () => {
    const clips = normalizeTimeline(
      [
        clip({ id: 1, timelineStart: 4, sortIndex: 77 }),
        clip({ id: 2, timelineStart: 0, sortIndex: 3 }),
        clip({ id: 3, trackId: 1, trackType: "audio", timelineStart: 0, sortIndex: 9 }),
      ],
      ASSETS,
    );
    expect(clips.filter((c) => c.trackId === 0).map((c) => c.sortIndex)).toEqual([0, 1]);
    expect(clips.filter((c) => c.trackId === 1).map((c) => c.sortIndex)).toEqual([0]);
  });

  it("is idempotent", () => {
    const once = threeClips();
    expect(normalizeTimeline(once, ASSETS)).toEqual(once);
  });
});

describe("queries", () => {
  it("reports the duration as the furthest clip end", () => {
    expect(timelineDuration(threeClips())).toBe(6);
  });

  it("reports zero duration for an empty timeline", () => {
    expect(timelineDuration([])).toBe(0);
  });

  it("resolves the clip and source time under the playhead", () => {
    const hit = resolveAtTime(threeClips(), 3);
    expect(hit?.clip.id).toBe(2);
    expect(hit?.sourceTime).toBe(3);
  });

  it("treats a clip end as exclusive so abutting clips hand over", () => {
    expect(resolveAtTime(threeClips(), 2)?.clip.id).toBe(2);
  });

  it("returns null past the end of the timeline", () => {
    expect(resolveAtTime(threeClips(), 99)).toBeNull();
  });

  it("finds the next boundary for playback scheduling", () => {
    expect(nextBoundaryAfter(threeClips(), 0)).toBe(2);
    expect(nextBoundaryAfter(threeClips(), 5)).toBe(6);
    expect(nextBoundaryAfter(threeClips(), 6)).toBeNull();
  });
});

describe("addClip", () => {
  it("appends to the end of the track by default", () => {
    const { clips, clip: added } = addClip(threeClips(), ASSETS, { assetId: 1 });
    expect(added?.timelineStart).toBe(6);
    expect(clips).toHaveLength(4);
  });

  it("uses the whole asset when no duration is given", () => {
    const { clip: added } = addClip([], ASSETS, { assetId: 2 });
    expect(added?.duration).toBe(5);
  });

  it("assigns a negative temp id to an unsaved clip", () => {
    const { clip: added } = addClip([], ASSETS, { assetId: 1 });
    expect(added!.id).toBeLessThan(0);
  });

  it("refuses an unknown asset", () => {
    const { clip: added } = addClip([], ASSETS, { assetId: 42 });
    expect(added).toBeNull();
  });
});

describe("removeClips", () => {
  it("leaves a gap when not rippling", () => {
    const clips = removeClips(threeClips(), [2], ASSETS);
    expect(clips.map((c) => c.timelineStart)).toEqual([0, 4]);
  });

  it("closes the gap when rippling", () => {
    const clips = removeClips(threeClips(), [2], ASSETS, { ripple: true });
    expect(clips.map((c) => c.timelineStart)).toEqual([0, 2]);
  });

  it("refuses to delete a locked clip", () => {
    const base = setClipProps(threeClips(), ASSETS, 2, { locked: true });
    expect(removeClips(base, [2], ASSETS)).toHaveLength(3);
  });

  it("removes several clips at once", () => {
    expect(removeClips(threeClips(), [1, 3], ASSETS)).toHaveLength(1);
  });
});

describe("trimClip", () => {
  it("trims the head and keeps the frame under the cursor", () => {
    const clips = trimClip(threeClips(), ASSETS, 1, "start", 1);
    const c = clips.find((x) => x.id === 1)!;
    expect([c.timelineStart, c.sourceStart, c.duration]).toEqual([1, 1, 1]);
  });

  it("trims the tail", () => {
    const c = trimClip(threeClips(), ASSETS, 1, "end", 1.5).find((x) => x.id === 1)!;
    expect([c.sourceStart, c.duration]).toEqual([0, 1.5]);
  });

  it("extends the tail into unused source footage", () => {
    const clips = trimClip([clip({ id: 1, duration: 2 })], ASSETS, 1, "end", 6);
    expect(clips[0].duration).toBe(6);
  });

  it("cannot extend the tail beyond the source asset", () => {
    const clips = trimClip([clip({ id: 1, duration: 2 })], ASSETS, 1, "end", 999);
    expect(clips[0].duration).toBe(10);
  });

  it("cannot extend the head before the start of the source", () => {
    const clips = trimClip([clip({ id: 1, timelineStart: 5, sourceStart: 1, duration: 2 })], ASSETS, 1, "start", 0);
    const c = clips[0];
    expect(c.sourceStart).toBe(0);
    expect(c.timelineStart).toBe(4);
  });

  it("never trims a clip out of existence", () => {
    const clips = trimClip(threeClips(), ASSETS, 1, "end", 0);
    expect(clips.find((c) => c.id === 1)!.duration).toBeGreaterThan(0);
  });

  it("survives a float-error sized trim without dropping the clip", () => {
    let clips = threeClips();
    for (let i = 0; i < 20; i++) clips = trimClip(clips, ASSETS, 1, "end", clipEnd(clips[0]) - 0.1);
    expect(clips.find((c) => c.id === 1)).toBeDefined();
  });

  it("refuses to trim a locked clip", () => {
    const base = setClipProps(threeClips(), ASSETS, 1, { locked: true });
    expect(trimClip(base, ASSETS, 1, "end", 1)[0].duration).toBe(2);
  });

  it("closes the gap after a trim when rippling", () => {
    const clips = trimClip(threeClips(), ASSETS, 1, "end", 1, { ripple: true });
    expect(clips.map((c) => c.timelineStart)).toEqual([0, 1, 3]);
  });
});

describe("splitClip", () => {
  it("splits into two abutting halves", () => {
    const { clips, leftId, rightId } = splitClip(threeClips(), ASSETS, 2, 3);
    const left = clips.find((c) => c.id === leftId)!;
    const right = clips.find((c) => c.id === rightId)!;
    expect([left.timelineStart, left.duration]).toEqual([2, 1]);
    expect([right.timelineStart, right.duration]).toEqual([3, 1]);
  });

  it("carries the source offset onto the right half", () => {
    const { clips, rightId } = splitClip(threeClips(), ASSETS, 2, 3);
    expect(clips.find((c) => c.id === rightId)!.sourceStart).toBe(3);
  });

  it("preserves total duration", () => {
    const before = timelineDuration(threeClips());
    expect(timelineDuration(splitClip(threeClips(), ASSETS, 2, 3).clips)).toBe(before);
  });

  it("refuses to split at the very edge of a clip", () => {
    expect(splitClip(threeClips(), ASSETS, 2, 2).rightId).toBeNull();
    expect(splitClip(threeClips(), ASSETS, 2, 4).rightId).toBeNull();
  });

  it("refuses to split outside the clip", () => {
    expect(splitClip(threeClips(), ASSETS, 2, 5).rightId).toBeNull();
  });

  it("refuses to split a locked clip", () => {
    const base = setClipProps(threeClips(), ASSETS, 2, { locked: true });
    expect(splitClip(base, ASSETS, 2, 3).rightId).toBeNull();
  });

  it("splits three ways when applied twice", () => {
    const first = splitClip(threeClips(), ASSETS, 2, 3).clips;
    expect(splitClip(first, ASSETS, 2, 2.5).clips).toHaveLength(5);
  });
});

describe("moveClip", () => {
  it("moves a clip to a new time", () => {
    const clips = moveClip(threeClips(), ASSETS, 1, { timelineStart: 8 });
    expect(clips.find((c) => c.id === 1)!.timelineStart).toBe(8);
  });

  it("moves a clip to another track", () => {
    const clips = moveClip(threeClips(), ASSETS, 1, { trackId: 1, timelineStart: 0 });
    expect(clips.find((c) => c.id === 1)!.trackId).toBe(1);
  });

  it("wins the tie-break when dropped exactly on another clip's start", () => {
    const clips = moveClip(threeClips(), ASSETS, 3, { timelineStart: 2 });
    const ids = clips.filter((c) => c.trackId === 0).map((c) => c.id);
    expect(ids).toEqual([1, 3, 2]);
  });

  it("clamps a negative drop position to zero", () => {
    expect(moveClip(threeClips(), ASSETS, 3, { timelineStart: -4 }).find((c) => c.id === 3)!.timelineStart).toBe(0);
  });

  it("does not lose a clip when dropped on top of another", () => {
    expect(moveClip(threeClips(), ASSETS, 1, { timelineStart: 4 })).toHaveLength(3);
  });

  it("refuses to move a locked clip", () => {
    const base = setClipProps(threeClips(), ASSETS, 1, { locked: true });
    expect(moveClip(base, ASSETS, 1, { timelineStart: 8 }).find((c) => c.id === 1)!.timelineStart).toBe(0);
  });

  it("closes the hole on the source track when rippling across tracks", () => {
    const clips = moveClip(threeClips(), ASSETS, 1, { trackId: 1, timelineStart: 0 }, { ripple: true });
    expect(clips.filter((c) => c.trackId === 0).map((c) => c.timelineStart)).toEqual([0, 2]);
  });
});

describe("setClipProps", () => {
  it("toggles visibility", () => {
    expect(setClipProps(threeClips(), ASSETS, 1, { visible: false })[0].visible).toBe(false);
  });

  it("toggles mute", () => {
    expect(setClipProps(threeClips(), ASSETS, 1, { muted: true })[0].muted).toBe(true);
  });

  it("leaves other clips alone", () => {
    const clips = setClipProps(threeClips(), ASSETS, 1, { muted: true });
    expect(clips.filter((c) => c.muted)).toHaveLength(1);
  });
});

describe("rippleTrack", () => {
  it("closes every gap on a track", () => {
    const spread = normalizeTimeline(
      [clip({ id: 1, timelineStart: 0 }), clip({ id: 2, timelineStart: 5 }), clip({ id: 3, timelineStart: 9 })],
      ASSETS,
    );
    expect(rippleTrack(spread, 0).map((c) => c.timelineStart)).toEqual([0, 2, 4]);
  });

  it("leaves other tracks alone", () => {
    const mixed = normalizeTimeline(
      [clip({ id: 1, timelineStart: 5 }), clip({ id: 2, trackId: 1, trackType: "audio", timelineStart: 7 })],
      ASSETS,
    );
    expect(rippleTrack(mixed, 0).find((c) => c.id === 2)!.timelineStart).toBe(7);
  });
});

describe("mergeRanges / invertRanges", () => {
  it("merges overlapping ranges", () => {
    expect(mergeRanges([{ start: 0, end: 2 }, { start: 1, end: 3 }])).toEqual([{ start: 0, end: 3 }]);
  });

  it("sorts unordered input", () => {
    expect(mergeRanges([{ start: 5, end: 6 }, { start: 0, end: 1 }])).toEqual([
      { start: 0, end: 1 },
      { start: 5, end: 6 },
    ]);
  });

  it("drops empty ranges", () => {
    expect(mergeRanges([{ start: 2, end: 2 }])).toEqual([]);
  });

  it("inverts to the surviving spans", () => {
    expect(invertRanges([{ start: 1, end: 2 }], 5)).toEqual([
      { start: 0, end: 1 },
      { start: 2, end: 5 },
    ]);
  });

  it("returns the whole span when nothing is cut", () => {
    expect(invertRanges([], 5)).toEqual([{ start: 0, end: 5 }]);
  });
});

describe("removeRanges (remove silence)", () => {
  it("cuts a span out of the middle of a clip and closes the gap", () => {
    const clips = removeRanges([clip({ id: 1, duration: 6 })], ASSETS, [{ start: 2, end: 3 }]);
    expect(timelineDuration(clips)).toBe(5);
    expect(clips.map((c) => [c.timelineStart, c.duration])).toEqual([
      [0, 2],
      [2, 3],
    ]);
  });

  it("keeps the correct source footage on each side of the cut", () => {
    const clips = removeRanges([clip({ id: 1, duration: 6 })], ASSETS, [{ start: 2, end: 3 }]);
    expect(clips.map((c) => c.sourceStart)).toEqual([0, 3]);
  });

  it("deletes clips that fall entirely inside a removed span", () => {
    const clips = removeRanges(threeClips(), ASSETS, [{ start: 2, end: 4 }]);
    expect(clips.map((c) => c.id)).toEqual([1, 3]);
    expect(timelineDuration(clips)).toBe(4);
  });

  it("cuts several spans at once", () => {
    const clips = removeRanges([clip({ id: 1, duration: 10 })], ASSETS, [
      { start: 1, end: 2 },
      { start: 5, end: 6 },
    ]);
    expect(timelineDuration(clips)).toBe(8);
  });

  it("keeps video and audio tracks in sync", () => {
    const base = normalizeTimeline(
      [
        clip({ id: 1, duration: 6 }),
        clip({ id: 2, trackId: 1, trackType: "audio", duration: 6 }),
      ],
      ASSETS,
    );
    const clips = removeRanges(base, ASSETS, [{ start: 2, end: 3 }]);
    const video = clips.filter((c) => c.trackId === 0).map((c) => [c.timelineStart, c.duration]);
    const audio = clips.filter((c) => c.trackId === 1).map((c) => [c.timelineStart, c.duration]);
    expect(video).toEqual(audio);
  });

  it("is a no-op for an empty range list", () => {
    expect(removeRanges(threeClips(), ASSETS, [])).toEqual(threeClips());
  });

  it("handles a range that covers the entire timeline", () => {
    expect(removeRanges(threeClips(), ASSETS, [{ start: 0, end: 6 }])).toHaveLength(0);
  });
});
