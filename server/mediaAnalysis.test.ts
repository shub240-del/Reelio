import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  captionsToSrtText,
  captionsToWebVtt,
  detectSceneBoundaries,
  detectTimestampedFillers,
} from "./mediaAnalysis";

const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
let tempDir = "";
let sceneFixture = "";

function run(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpeg, args, {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let errorText = "";
    child.stderr.on("data", chunk => (errorText += chunk.toString("utf8")));
    child.once("error", reject);
    child.once("close", code =>
      code === 0
        ? resolve()
        : reject(new Error(`Fixture generation failed (${code}): ${errorText}`))
    );
  });
}

beforeAll(async () => {
  tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "reelio-scene-test-"));
  sceneFixture = path.join(tempDir, "known-cuts.mp4");
  await run([
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=red:s=320x180:r=30:d=1",
    "-f",
    "lavfi",
    "-i",
    "color=blue:s=320x180:r=30:d=1",
    "-f",
    "lavfi",
    "-i",
    "color=green:s=320x180:r=30:d=1",
    "-filter_complex",
    "[0:v][1:v][2:v]concat=n=3:v=1:a=0[out]",
    "-map",
    "[out]",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    sceneFixture,
  ]);
}, 20_000);

afterAll(async () => {
  const resolved = path.resolve(tempDir);
  if (path.basename(resolved).startsWith("reelio-scene-test-")) {
    await fs.promises.rm(resolved, { recursive: true, force: true });
  }
});

describe("media intelligence", () => {
  it("detects measured boundaries in a controlled hard-cut fixture", async () => {
    const boundaries = await detectSceneBoundaries(
      sceneFixture,
      new AbortController().signal,
      0.2
    );
    expect(boundaries.length).toBeGreaterThanOrEqual(2);
    expect(boundaries.some(boundary => Math.abs(boundary.time - 1) < 0.1)).toBe(true);
    expect(boundaries.some(boundary => Math.abs(boundary.time - 2) < 0.1)).toBe(true);
    expect(boundaries.every(boundary => boundary.confidence >= 0.2)).toBe(true);
  }, 20_000);

  it("derives exact filler words from provider timestamps", () => {
    expect(
      detectTimestampedFillers([
        { word: "Um,", start: 0.1, end: 0.3 },
        { word: "you", start: 0.4, end: 0.55 },
        { word: "know", start: 0.56, end: 0.8 },
        { word: "ready", start: 0.9, end: 1.2 },
      ])
    ).toEqual([
      { text: "Um,", start: 0.1, end: 0.3 },
      { text: "you know", start: 0.4, end: 0.8 },
    ]);
  });

  it("exports validated SRT and WebVTT and rejects overlaps", () => {
    const cues = [
      { text: "First", startTime: 0, endTime: 1.25 },
      { text: "Second", startTime: 1.25, endTime: 2.5 },
    ];
    expect(captionsToSrtText(cues)).toContain("00:00:01,250");
    expect(captionsToWebVtt(cues)).toContain("WEBVTT");
    expect(captionsToWebVtt(cues)).toContain("00:00:01.250");
    expect(() =>
      captionsToSrtText([
        ...cues,
        { text: "Overlap", startTime: 1, endTime: 2 },
      ])
    ).toThrow("overlapping");
  });
});
