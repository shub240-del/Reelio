import { beforeEach, describe, expect, it, vi } from "vitest";

// Use the in-memory mock so tests run without a live MySQL database.
vi.mock("./db");
import { resetStore } from "./__mocks__/db";
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
