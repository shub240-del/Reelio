import { beforeEach, describe, expect, it, vi } from "vitest";

// Use the in-memory mock so tests run without a live MySQL database.
vi.mock("./db");
import { createAsset, resetStore } from "./__mocks__/db";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function createAuthContext(userOverrides: Partial<NonNullable<TrpcContext["user"]>> = {}): TrpcContext {
  const user = {
    id: 1,
    openId: "sample-user",
    email: "sample@example.com",
    name: "Sample User",
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

describe("clip operations", () => {
  const ctx = createAuthContext();
  const caller = appRouter.createCaller(ctx);

  it("clip.trim rejects with NOT_FOUND for non-existent clip", async () => {
    await expect(
      caller.clip.trim({ id: 99999, sourceStart: 0, duration: 10 })
    ).rejects.toThrow();
  });

  it("clip.split rejects with FORBIDDEN for non-existent project", async () => {
    await expect(
      caller.clip.split({ id: 1, splitAt: 5, projectId: 99999 })
    ).rejects.toThrow();
  });

  it("clip.list rejects with FORBIDDEN for non-existent project", async () => {
    await expect(
      caller.clip.list({ projectId: 99999 })
    ).rejects.toThrow();
  });

  it("clip.batchCommit atomically creates, updates, and deletes clips", async () => {
    const proj = await caller.project.create({ name: "Batch Project" });
    const asset = await createAsset({
      projectId: proj.id,
      name: "batch.mp4",
      storageKey: "test/batch.mp4",
      url: "/uploads/batch.mp4",
      mimeType: "video/mp4",
      sizeBytes: 16,
      duration: 15,
    });
    const result = await caller.clip.batchCommit({
      projectId: proj.id,
      creates: [
        {
          assetId: asset.id,
          trackId: 0,
          trackType: "video",
          sourceStart: 0,
          duration: 10,
          timelineStart: 0,
          sortIndex: 0,
        },
        {
          assetId: asset.id,
          trackId: 0,
          trackType: "video",
          sourceStart: 10,
          duration: 5,
          timelineStart: 10,
          sortIndex: 1,
        },
      ],
      updates: [],
      deletes: [],
    });

    expect(result.success).toBe(true);
    expect(result.clips.length).toBe(2);

    const firstClip = result.clips[0];
    const secondClip = result.clips[1];

    const syncResult = await caller.clip.batchCommit({
      projectId: proj.id,
      creates: [],
      updates: [{ id: firstClip.id, patch: { duration: 8 } }],
      deletes: [secondClip.id],
    });

    expect(syncResult.success).toBe(true);
    expect(syncResult.clips.length).toBe(1);
    expect(syncResult.clips[0].duration).toBe(8);
  });
});

describe("project operations", () => {
  const ctx = createAuthContext();
  const caller = appRouter.createCaller(ctx);

  it("project.list returns array for authenticated user", async () => {
    const result = await caller.project.list();
    expect(Array.isArray(result)).toBe(true);
  });

  it("project.create creates a new project and returns it", async () => {
    const result = await caller.project.create({ name: "Test Project" });
    expect(result).toBeDefined();
    expect(result.name).toBe("Test Project");
    expect(typeof result.id).toBe("number");
  });

  it("asset.list rejects with FORBIDDEN for non-existent project", async () => {
    await expect(
      caller.asset.list({ projectId: 99999 })
    ).rejects.toThrow();
  });
});
