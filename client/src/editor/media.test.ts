import { describe, expect, it } from "vitest";
import {
  aspectRatioLabel,
  bucketPeaks,
  fpsFromFrameTimes,
  isSupportedMedia,
  median,
  snapToCommonFps,
  thumbnailTimestamps,
} from "./media";

describe("snapToCommonFps", () => {
  it("snaps measurement jitter to 29.97", () => {
    expect(snapToCommonFps(29.9712)).toBe(29.97);
  });

  it("snaps to 30", () => {
    expect(snapToCommonFps(30.02)).toBe(30);
  });

  it("snaps to 23.976 rather than 24", () => {
    expect(snapToCommonFps(23.98)).toBe(23.976);
  });

  it("keeps an unusual rate instead of forcing a wrong standard", () => {
    expect(snapToCommonFps(15)).toBe(15);
  });

  it("returns 0 for nonsense input", () => {
    expect(snapToCommonFps(0)).toBe(0);
    expect(snapToCommonFps(NaN)).toBe(0);
    expect(snapToCommonFps(-5)).toBe(0);
  });
});

describe("median", () => {
  it("handles an odd count", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("handles an even count", () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("returns 0 for an empty list", () => {
    expect(median([])).toBe(0);
  });

  it("ignores ordering", () => {
    expect(median([10, 0, 5])).toBe(5);
  });
});

describe("fpsFromFrameTimes", () => {
  it("derives 30fps from evenly spaced frame times", () => {
    const times = Array.from({ length: 10 }, (_, i) => i / 30);
    expect(fpsFromFrameTimes(times)).toBe(30);
  });

  it("derives 25fps", () => {
    const times = Array.from({ length: 10 }, (_, i) => i / 25);
    expect(fpsFromFrameTimes(times)).toBe(25);
  });

  it("survives a dropped frame because it uses the median", () => {
    const times = [0, 1 / 30, 2 / 30, 4 / 30, 5 / 30, 6 / 30, 7 / 30];
    expect(fpsFromFrameTimes(times)).toBe(30);
  });

  it("returns 0 when there are too few samples", () => {
    expect(fpsFromFrameTimes([0])).toBe(0);
    expect(fpsFromFrameTimes([])).toBe(0);
  });

  it("ignores duplicate timestamps", () => {
    expect(fpsFromFrameTimes([0, 0, 0])).toBe(0);
  });
});

describe("aspectRatioLabel", () => {
  it("labels 1920x1080 as 16:9", () => {
    expect(aspectRatioLabel(1920, 1080)).toBe("16:9");
  });

  it("labels vertical video as 9:16", () => {
    expect(aspectRatioLabel(1080, 1920)).toBe("9:16");
  });

  it("labels square video as 1:1", () => {
    expect(aspectRatioLabel(1000, 1000)).toBe("1:1");
  });

  it("labels 640x480 as 4:3", () => {
    expect(aspectRatioLabel(640, 480)).toBe("4:3");
  });

  it("falls back to a decimal ratio for odd dimensions", () => {
    expect(aspectRatioLabel(1001, 337)).toMatch(/:1$/);
  });

  it("handles zero dimensions", () => {
    expect(aspectRatioLabel(0, 0)).toBe("—");
  });
});

describe("thumbnailTimestamps", () => {
  it("returns evenly spaced centred samples", () => {
    expect(thumbnailTimestamps(10, 5)).toEqual([1, 3, 5, 7, 9]);
  });

  it("never samples exactly at zero", () => {
    expect(thumbnailTimestamps(10, 5)[0]).toBeGreaterThan(0);
  });

  it("never samples at or past the duration", () => {
    const stamps = thumbnailTimestamps(10, 5);
    expect(stamps[stamps.length - 1]).toBeLessThan(10);
  });

  it("returns nothing for a zero-length file", () => {
    expect(thumbnailTimestamps(0, 5)).toEqual([]);
  });

  it("returns nothing when no frames are requested", () => {
    expect(thumbnailTimestamps(10, 0)).toEqual([]);
  });
});

describe("bucketPeaks", () => {
  it("produces exactly the requested number of buckets", () => {
    expect(bucketPeaks(new Float32Array(1000), 50)).toHaveLength(50);
  });

  it("keeps the peak of each bucket, not the average", () => {
    const samples = new Float32Array([0, 0, 0, 1, 0, 0, 0, 0]);
    expect(bucketPeaks(samples, 2)[0]).toBe(1);
  });

  it("uses absolute amplitude so negative troughs count", () => {
    const samples = new Float32Array([0, -0.8, 0, 0]);
    expect(bucketPeaks(samples, 1)[0]).toBeCloseTo(0.8);
  });

  it("returns silence for an empty input", () => {
    expect(bucketPeaks(new Float32Array(0), 10).every((v) => v === 0)).toBe(true);
  });

  it("handles more buckets than samples without crashing", () => {
    expect(bucketPeaks(new Float32Array([1, 1]), 8)).toHaveLength(8);
  });
});

describe("isSupportedMedia", () => {
  it("accepts mp4 by mime type", () => {
    expect(isSupportedMedia({ name: "a.mp4", type: "video/mp4" })).toBe(true);
  });

  it("accepts mov by mime type", () => {
    expect(isSupportedMedia({ name: "a.mov", type: "video/quicktime" })).toBe(true);
  });

  it("accepts webm by mime type", () => {
    expect(isSupportedMedia({ name: "a.webm", type: "video/webm" })).toBe(true);
  });

  it("accepts a .mov whose mime type the browser left empty", () => {
    expect(isSupportedMedia({ name: "clip.MOV", type: "" })).toBe(true);
  });

  it("accepts wav audio by mime type", () => {
    expect(isSupportedMedia({ name: "a.wav", type: "audio/wav" })).toBe(true);
  });

  it("accepts mp3 audio by extension when mime type is empty", () => {
    expect(isSupportedMedia({ name: "a.mp3", type: "" })).toBe(true);
  });

  it("rejects an image", () => {
    expect(isSupportedMedia({ name: "a.png", type: "image/png" })).toBe(false);
  });

  it("rejects a pdf with no usable extension match", () => {
    expect(isSupportedMedia({ name: "doc.pdf", type: "application/pdf" })).toBe(false);
  });
});
