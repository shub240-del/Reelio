import { beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import { requestAIEdit, aiEditRequestSchema } from "./aiEdit";
import { resetAIProvider } from "./_core/nvidia";
import type { TrpcContext } from "./_core/context";

// Mock the database for trpc context
vi.mock("./db");

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

describe("aiEditRequestSchema", () => {
  it("validates valid AI edit requests", () => {
    const valid = {
      instruction: "Remove silence from timeline",
      clips: [
        {
          id: 1,
          assetId: 10,
          assetName: "video.mp4",
          trackType: "video" as const,
          trackId: 0,
          timelineStart: 0,
          duration: 15,
          sourceStart: 0,
          sortIndex: 0,
        },
      ],
      assets: [
        {
          id: 10,
          name: "video.mp4",
          mimeType: "video/mp4",
          duration: 15,
          width: 1920,
          height: 1080,
          fps: 30,
          hasAudio: true,
        },
      ],
      silenceRanges: [{ start: 2, end: 5 }],
      playhead: 0,
    };

    const parsed = aiEditRequestSchema.parse(valid);
    expect(parsed.instruction).toBe("Remove silence from timeline");
    expect(parsed.clips).toHaveLength(1);
    expect(parsed.silenceRanges).toHaveLength(1);
  });

  it("rejects empty instruction", () => {
    expect(() =>
      aiEditRequestSchema.parse({
        instruction: "",
        clips: [],
        assets: [],
      })
    ).toThrow();
  });
});

describe("aiEdit service & provider integration", () => {
  const originalEnv = process.env.NVIDIA_API_KEY;

  beforeEach(() => {
    resetAIProvider();
    vi.restoreAllMocks();
  });

  it("throws descriptive error when NVIDIA_API_KEY is not set", async () => {
    delete process.env.NVIDIA_API_KEY;
    resetAIProvider();

    await expect(
      requestAIEdit({
        instruction: "Trim the first clip",
        clips: [],
        assets: [],
        silenceRanges: [],
        playhead: 0,
      })
    ).rejects.toThrow("NVIDIA_API_KEY is not configured");
  });

  it("successfully parses valid NIM response and returns structured plan", async () => {
    process.env.NVIDIA_API_KEY = "test-nvidia-key";
    resetAIProvider();

    const mockResponsePayload = {
      id: "chatcmpl-test",
      model: "meta/llama-3.3-70b-instruct",
      choices: [
        {
          message: {
            role: "assistant",
            content: JSON.stringify({
              summary: "Removed 3 seconds of silence",
              operations: [
                {
                  type: "removeRanges",
                  ranges: [{ start: 2, end: 5 }],
                  reason: "Silence range removal",
                },
              ],
            }),
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 50,
        completion_tokens: 30,
        total_tokens: 80,
      },
    };

    // Mock global fetch
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponsePayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await requestAIEdit({
      instruction: "Remove silence",
      clips: [
        {
          id: 1,
          assetId: 10,
          assetName: "video.mp4",
          trackType: "video",
          trackId: 0,
          timelineStart: 0,
          duration: 10,
          sourceStart: 0,
          sortIndex: 0,
        },
      ],
      assets: [
        {
          id: 10,
          name: "video.mp4",
          mimeType: "video/mp4",
          duration: 10,
          width: 1920,
          height: 1080,
          fps: 30,
          hasAudio: true,
        },
      ],
      silenceRanges: [{ start: 2, end: 5 }],
      playhead: 0,
    });

    expect(result.plan.summary).toBe("Removed 3 seconds of silence");
    expect(result.plan.operations).toHaveLength(1);
    expect(result.plan.operations[0].type).toBe("removeRanges");
    expect(result.model).toBe("meta/llama-3.3-70b-instruct");
    expect(result.usage.totalTokens).toBe(80);

    // Restore env
    if (originalEnv !== undefined) {
      process.env.NVIDIA_API_KEY = originalEnv;
    } else {
      delete process.env.NVIDIA_API_KEY;
    }
  });

  it("handles markdown json fences gracefully", async () => {
    process.env.NVIDIA_API_KEY = "test-nvidia-key";
    resetAIProvider();

    const mockResponsePayload = {
      choices: [
        {
          message: {
            role: "assistant",
            content: "```json\n" + JSON.stringify({
              summary: "Added captions",
              operations: [
                {
                  type: "addCaptions",
                  cues: [{ text: "Hello world", startTime: 0, endTime: 2 }],
                  replaceExisting: true,
                },
              ],
            }) + "\n```",
          },
          finish_reason: "stop",
        },
      ],
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponsePayload), { status: 200 })
    );

    const result = await requestAIEdit({
      instruction: "Add subtitles",
      clips: [],
      assets: [],
      silenceRanges: [],
      playhead: 0,
    });

    expect(result.plan.summary).toBe("Added captions");
    expect(result.plan.operations[0].type).toBe("addCaptions");

    if (originalEnv !== undefined) {
      process.env.NVIDIA_API_KEY = originalEnv;
    } else {
      delete process.env.NVIDIA_API_KEY;
    }
  });
});

describe("appRouter ai endpoints", () => {
  it("ai.health reports available status based on environment", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const health = await caller.ai.health();
    expect(typeof health.available).toBe("boolean");
  });
});
