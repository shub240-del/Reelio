import { beforeAll, describe, expect, it, vi } from "vitest";

// Use the in-memory mock so tests run without a live MySQL database.
vi.mock("./db");
vi.mock("./storage", () => ({
  storagePut: vi.fn(async (relKey: string) => ({
    key: `mock_${relKey}`,
    url: `/mock-storage/${relKey}`,
  })),
  storageGet: vi.fn(async (relKey: string) => ({
    key: `mock_${relKey}`,
    url: `/mock-storage/${relKey}`,
  })),
  storageGetSignedUrl: vi.fn(async () => "https://example.com/mock-signed-url"),
}));
import { resetStore } from "./__mocks__/db";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function createAuthContext(userOverrides: Partial<NonNullable<TrpcContext["user"]>> = {}): TrpcContext {
  const user = {
    id: 1,
    openId: "test-crud-user",
    email: "crud@example.com",
    name: "CRUD Test User",
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

beforeAll(() => resetStore());

describe("project CRUD - success paths", () => {
  const ctx = createAuthContext();
  const caller = appRouter.createCaller(ctx);

  it("creates a project and returns it", async () => {
    const project = await caller.project.create({ name: "Test CRUD Project" });
    expect(project.id).toBeDefined();
    expect(project.name).toBe("Test CRUD Project");
    expect(project.status).toBe("draft");
  });

  it("lists user projects including created ones", async () => {
    const projects = await caller.project.list();
    expect(Array.isArray(projects)).toBe(true);
    expect(projects.length).toBeGreaterThan(0);
    // Just verify the created project is in the list (ordering may vary due to other tests)
    const found = projects.find(p => p.name === "Test CRUD Project");
    expect(found).toBeDefined();
  });

  it("gets a specific project by id", async () => {
    const projects = await caller.project.list();
    // Find the project we created by name, not by position
    const targetProject = projects.find(p => p.name === "Test CRUD Project");
    expect(targetProject).toBeDefined();

    const project = await caller.project.get({ id: targetProject!.id });
    expect(project?.id).toBe(targetProject!.id);
    expect(project?.name).toBe("Test CRUD Project");
  });

  it("deletes a project", async () => {
    const projects = await caller.project.list();
    // Find a project to delete (any project)
    const toDelete = projects[projects.length - 1];
    expect(toDelete).toBeDefined();

    const result = await caller.project.delete({ id: toDelete.id });
    expect(result).toBeDefined();

    // Verify it's gone from the list
    const remaining = await caller.project.list();
    const found = remaining.find(p => p.id === toDelete.id);
    expect(found).toBeUndefined();
  });
});

describe("clip operations - success paths", () => {
  const ctx = createAuthContext();
  const caller = appRouter.createCaller(ctx);

  it("creates a clip from an uploaded asset", async () => {
    // Create project first
    const project = await caller.project.create({ name: "Clip Ops Test" });
    expect(project.id).toBeDefined();

    // Upload a minimal base64-encoded file (not a real video, but tests the flow)
    const base64Data = Buffer.from("fake-video-data").toString("base64");
    const asset = await caller.asset.upload({
      projectId: project.id,
      base64Data,
      fileName: "test-video.mp4",
      mimeType: "video/mp4",
      sizeBytes: 1024,
    });
    expect(asset.id).toBeDefined();
    expect(asset.name).toBe("test-video.mp4");

    // Create a clip from the asset
    const clip = await caller.clip.create({
      projectId: project.id,
      assetId: asset.id,
      trackType: "video",
      timelineStart: 0,
      sortIndex: 0,
      sourceStart: 0,
      duration: 10,
    });
    expect(clip.id).toBeDefined();
    expect(clip.assetId).toBe(asset.id);
    expect(clip.trackType).toBe("video");

    // List clips and verify
    const clips = await caller.clip.list({ projectId: project.id });
    expect(clips.length).toBeGreaterThan(0);
    expect(clips[0]?.id).toBe(clip.id);
  });
});

describe("ownership edge cases", () => {
  it("different users cannot access each other's projects", async () => {
    const user1Ctx = createAuthContext({ id: 100, openId: "user1-owner" });
    const user2Ctx = createAuthContext({ id: 200, openId: "user2-owner" });

    const user1Caller = appRouter.createCaller(user1Ctx);
    const user2Caller = appRouter.createCaller(user2Ctx);

    // User 1 creates a project
    const project = await user1Caller.project.create({ name: "User1 Private Project" });

    // User 2 tries to access it - should throw
    await expect(
      user2Caller.project.get({ id: project.id })
    ).rejects.toThrow();
  });
});

describe("videoMetadata - edge cases", () => {
  it("handles truncated MP4 buffer gracefully", async () => {
    const { extractVideoMetadata } = await import("./videoMetadata");
    // A very short buffer that's not a valid MP4
    const result = extractVideoMetadata(Buffer.from([0, 0, 0, 0]));
    expect(result.duration).toBe(0);
    expect(result.width).toBe(0);
    expect(result.height).toBe(0);
  });

  it("isVideoFile handles various MIME types", async () => {
    const { isVideoFile } = await import("./videoMetadata");
    expect(isVideoFile("video/mp4")).toBe(true);
    expect(isVideoFile("video/webm")).toBe(true);
    expect(isVideoFile("video/x-matroska")).toBe(true);
    expect(isVideoFile("audio/mp3")).toBe(false);
    expect(isVideoFile("image/jpeg")).toBe(false);
    expect(isVideoFile("application/pdf")).toBe(false);
  });
});
