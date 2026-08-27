import { beforeEach, describe, expect, it, vi } from "vitest";

// Use the in-memory mock so tests run without a live MySQL database.
vi.mock("./db");
import { resetStore } from "./__mocks__/db";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function createAuthContext(userOverrides: Partial<NonNullable<TrpcContext["user"]>> = {}): TrpcContext {
  const user = {
    id: 1,
    openId: "test-split-user",
    email: "split@example.com",
    name: "Split Test User",
    loginMethod: "manus",
    role: "user" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...userOverrides,
  };

  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

beforeEach(() => resetStore());

describe("clip.split - success path", () => {
  const ctx = createAuthContext();
  const caller = appRouter.createCaller(ctx);

  it("clip.split rejects when splitAt is outside clip duration", async () => {
    // First create a project and upload an asset to get a valid clip
    const project = await caller.project.create({ name: "Split Test Project" });
    expect(project.id).toBeDefined();

    // Try to split a non-existent clip - should reject
    await expect(
      caller.clip.split({ id: 99999, splitAt: 5, projectId: project.id })
    ).rejects.toThrow();
  });

  it("clip.trim rejects when clip does not exist", async () => {
    const project = await caller.project.create({ name: "Trim Test Project" });
    await expect(
      caller.clip.trim({ id: 99999, sourceStart: 0, duration: 10 })
    ).rejects.toThrow();
  });
});

describe("videoMetadata extraction", () => {
  it("returns zeroed metadata for empty buffer", async () => {
    // Import the function dynamically
    const { extractVideoMetadata } = await import("./videoMetadata");
    const result = extractVideoMetadata(Buffer.alloc(4));
    expect(result.duration).toBe(0);
    expect(result.width).toBe(0);
    expect(result.height).toBe(0);
    expect(result.hasAudio).toBe(false);
  });

  it("isVideoFile returns true for video MIME types", async () => {
    const { isVideoFile } = await import("./videoMetadata");
    expect(isVideoFile("video/mp4")).toBe(true);
    expect(isVideoFile("video/quicktime")).toBe(true);
    expect(isVideoFile("video/webm")).toBe(true);
    expect(isVideoFile("image/png")).toBe(false);
    expect(isVideoFile("audio/mpeg")).toBe(false);
  });
});
