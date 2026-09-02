import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { probeMediaFile } from "./mediaProbe";
import {
  buildFfmpegCommand,
  renderTimelineToFile,
  type RenderAssetSource,
} from "./renderPipeline";

const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const ffprobe = process.env.FFPROBE_PATH || "ffprobe";
let fixtureDir = "";
let background = "";
let overlay = "";
let music = "";
let still = "";

function run(binary: string, args: string[], signal?: AbortSignal) {
  return new Promise<{ stdout: Buffer; stderr: string }>((resolve, reject) => {
    const child = spawn(binary, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      signal,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", chunk => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", chunk => stderr.push(Buffer.from(chunk)));
    child.once("error", reject);
    child.once("close", code => {
      const errorText = Buffer.concat(stderr).toString("utf8");
      if (code === 0) resolve({ stdout: Buffer.concat(stdout), stderr: errorText });
      else reject(new Error(`${path.basename(binary)} failed (${code}): ${errorText.slice(-1000)}`));
    });
  });
}

function assets(): RenderAssetSource[] {
  return [
    {
      id: 1,
      localPath: background,
      mimeType: "video/mp4",
      duration: 4,
      width: 320,
      height: 180,
      fps: 30,
      hasAudio: true,
    },
    {
      id: 2,
      localPath: overlay,
      mimeType: "video/mp4",
      duration: 2,
      width: 160,
      height: 90,
      fps: 30,
      hasAudio: false,
    },
    {
      id: 3,
      localPath: music,
      mimeType: "audio/wav",
      duration: 4,
      width: 0,
      height: 0,
      fps: 0,
      hasAudio: true,
    },
    {
      id: 4,
      localPath: still,
      mimeType: "image/png",
      duration: 5,
      width: 320,
      height: 180,
      fps: 30,
      hasAudio: false,
    },
  ];
}

beforeAll(async () => {
  fixtureDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "reelio-render-test-"));
  background = path.join(fixtureDir, "background.mp4");
  overlay = path.join(fixtureDir, "overlay.mp4");
  music = path.join(fixtureDir, "music.wav");
  still = path.join(fixtureDir, "still.png");
  await run(ffmpeg, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=320x180:r=30:d=4",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=4",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    background,
  ]);
  await run(ffmpeg, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=160x90:r=30:d=2",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    overlay,
  ]);
  await run(ffmpeg, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=880:sample_rate=48000:duration=4",
    music,
  ]);
  await run(ffmpeg, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=green:s=320x180",
    "-frames:v",
    "1",
    still,
  ]);
}, 30_000);

afterAll(async () => {
  const resolved = path.resolve(fixtureDir);
  if (path.basename(resolved).startsWith("reelio-render-test-")) {
    await fs.promises.rm(resolved, { recursive: true, force: true });
  }
});

describe("real multitrack FFmpeg pipeline", () => {
  it("renders overlapping PIP video and separately delayed/trimmed audio", async () => {
    const output = path.join(fixtureDir, "multitrack.mp4");
    const clips = [
      {
        id: 10,
        assetId: 1,
        trackId: 0,
        trackType: "video" as const,
        sourceStart: 0,
        duration: 4,
        timelineStart: 0,
        sortIndex: 0,
        zIndex: 0,
        visible: true,
        muted: false,
        volume: 0.5,
        trackVolume: 0.8,
      },
      {
        id: 11,
        assetId: 2,
        trackId: 1,
        trackType: "video" as const,
        sourceStart: 0,
        duration: 2,
        timelineStart: 1,
        sortIndex: 0,
        zIndex: 2,
        visible: true,
        muted: true,
        scale: 0.35,
        positionX: 0.6,
        positionY: -0.6,
      },
      {
        id: 12,
        assetId: 3,
        trackId: 2,
        trackType: "audio" as const,
        sourceStart: 0.5,
        duration: 2,
        timelineStart: 0.75,
        sortIndex: 0,
        visible: true,
        muted: false,
        volume: 0.25,
        trackVolume: 0.5,
      },
      {
        id: 13,
        assetId: 3,
        trackId: 3,
        trackType: "audio" as const,
        sourceStart: 0,
        duration: 1,
        timelineStart: 2.5,
        sortIndex: 0,
        visible: true,
        muted: true,
      },
    ];
    const command = await renderTimelineToFile(
      { clips, assets: assets(), width: 320, height: 180, fps: 30 },
      output,
      { signal: new AbortController().signal }
    );
    expect(command.videoLayerOrder).toEqual([10, 11]);
    expect(command.audioClipIds).toEqual([10, 12]);

    const probe = JSON.parse(
      (
        await run(ffprobe, [
          "-v",
          "error",
          "-show_entries",
          "format=duration,size:stream=codec_name,codec_type,width,height,r_frame_rate",
          "-of",
          "json",
          output,
        ])
      ).stdout.toString("utf8")
    ) as {
      streams: Array<Record<string, string | number>>;
      format: { duration: string; size: string };
    };
    const video = probe.streams.find(stream => stream.codec_type === "video");
    const audio = probe.streams.find(stream => stream.codec_type === "audio");
    expect(video).toMatchObject({ codec_name: "h264", width: 320, height: 180 });
    expect(video?.r_frame_rate).toBe("30/1");
    expect(audio?.codec_name).toBe("aac");
    expect(Number(probe.format.duration)).toBeCloseTo(4, 1);
    expect(Number(probe.format.size)).toBeGreaterThan(1_000);

    const pipPixel = (
      await run(ffmpeg, [
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        "1.5",
        "-i",
        output,
        "-vf",
        "crop=1:1:220:20,format=rgb24",
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "pipe:1",
      ])
    ).stdout;
    const centerPixel = (
      await run(ffmpeg, [
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        "1.5",
        "-i",
        output,
        "-vf",
        "crop=1:1:100:100,format=rgb24",
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "pipe:1",
      ])
    ).stdout;
    expect(pipPixel[2]).toBeGreaterThan(pipPixel[0]);
    expect(centerPixel[0]).toBeGreaterThan(centerPixel[2]);
  }, 30_000);

  it("supports an audio-only timeline with deterministic black video", async () => {
    const output = path.join(fixtureDir, "audio-only.mp4");
    await renderTimelineToFile(
      {
        clips: [
          {
            id: 20,
            assetId: 3,
            trackId: 0,
            trackType: "audio",
            sourceStart: 0.25,
            duration: 1.5,
            timelineStart: 0.5,
            sortIndex: 0,
            visible: true,
            muted: false,
          },
        ],
        assets: assets(),
        width: 320,
        height: 180,
      },
      output,
      { signal: new AbortController().signal }
    );
    const result = await run(ffprobe, [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_type",
      "-of",
      "json",
      output,
    ]);
    const probe = JSON.parse(result.stdout.toString("utf8"));
    expect(probe.streams.map((stream: { codec_type: string }) => stream.codec_type).sort()).toEqual([
      "audio",
      "video",
    ]);
    expect(Number(probe.format.duration)).toBeCloseTo(2, 1);
  }, 20_000);

  it("renders a still image for its explicit five-second editor duration", async () => {
    await expect(
      probeMediaFile(still, { expectedMimeType: "image/png" })
    ).resolves.toMatchObject({
      duration: 5,
      width: 320,
      height: 180,
      fps: 30,
      hasAudio: false,
      hasVideo: true,
    });

    const output = path.join(fixtureDir, "still-image.mp4");
    const command = await renderTimelineToFile(
      {
        clips: [
          {
            id: 21,
            assetId: 4,
            trackId: 0,
            trackType: "video",
            sourceStart: 0,
            duration: 2,
            timelineStart: 0,
            sortIndex: 0,
            visible: true,
            muted: true,
          },
        ],
        assets: assets(),
        width: 320,
        height: 180,
      },
      output,
      { signal: new AbortController().signal }
    );
    const imageInput = command.args.indexOf(still);
    expect(command.args.slice(imageInput - 5, imageInput)).toEqual([
      "-loop",
      "1",
      "-framerate",
      "30.000000",
      "-i",
    ]);
    const result = await run(ffprobe, [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_type,width,height",
      "-of",
      "json",
      output,
    ]);
    const probe = JSON.parse(result.stdout.toString("utf8"));
    expect(Number(probe.format.duration)).toBeCloseTo(2, 1);
    expect(probe.streams.find((stream: { codec_type: string }) => stream.codec_type === "video")).toMatchObject({
      width: 320,
      height: 180,
    });
  }, 20_000);

  it("cancels an active FFmpeg process and rejects invalid media", async () => {
    const output = path.join(fixtureDir, "cancelled.mp4");
    const controller = new AbortController();
    const promise = renderTimelineToFile(
      {
        clips: [
          {
            id: 30,
            assetId: 1,
            trackId: 0,
            trackType: "video",
            sourceStart: 0,
            duration: 4,
            timelineStart: 0,
            sortIndex: 0,
            visible: true,
            muted: false,
          },
        ],
        assets: assets(),
        width: 1920,
        height: 1080,
      },
      output,
      { signal: controller.signal }
    );
    setTimeout(() => controller.abort(), 25);
    await expect(promise).rejects.toThrow("cancelled");

    const invalid = path.join(fixtureDir, "invalid.bin");
    await fs.promises.writeFile(invalid, "not media");
    const badAssets = assets();
    badAssets[0] = { ...badAssets[0], localPath: invalid };
    await expect(
      renderTimelineToFile(
        {
          clips: [
            {
              id: 31,
              assetId: 1,
              trackId: 0,
              trackType: "video",
              sourceStart: 0,
              duration: 1,
              timelineStart: 0,
              sortIndex: 0,
              visible: true,
              muted: false,
            },
          ],
          assets: badAssets,
          width: 320,
          height: 180,
        },
        path.join(fixtureDir, "invalid.mp4"),
        { signal: new AbortController().signal }
      )
    ).rejects.toThrow(/rejected|decode/);
  }, 20_000);

  it("keeps media paths as argv values and rejects unsafe structured values", () => {
    const spec = {
      clips: [
        {
          id: 40,
          assetId: 1,
          trackId: 0,
          trackType: "video" as const,
          sourceStart: 0,
          duration: 1,
          timelineStart: 0,
          sortIndex: 0,
          visible: true,
          muted: false,
        },
      ],
      assets: [{ ...assets()[0], localPath: "fixture;touch-pwned.mp4" }],
      width: 320,
      height: 180,
    };
    const command = buildFfmpegCommand(spec, "out.mp4");
    expect(command.args).toContain("fixture;touch-pwned.mp4");
    expect(command.args).not.toContain("sh");
    expect(() =>
      buildFfmpegCommand(
        { ...spec, clips: [{ ...spec.clips[0], scale: Number.NaN }] },
        "out.mp4"
      )
    ).toThrow("scale");
  });
});
