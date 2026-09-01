import { describe, expect, it } from "vitest";
import { createClip } from "./db";

describe("development database fallback", () => {
  it("materializes the same clip defaults that MySQL applies", async () => {
    const clip = await createClip({
      projectId: 9_001,
      assetId: 9_002,
      sourceStart: 0,
      duration: 2,
      timelineStart: 0,
    });

    expect(clip).toMatchObject({
      trackId: 0,
      trackType: "video",
      sortIndex: 0,
      locked: false,
      visible: true,
      muted: false,
      videoFx: null,
      transition: null,
    });
  });
});
