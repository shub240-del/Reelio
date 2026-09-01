import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { createExport, createProject, resetStore } from "./__mocks__/db";
import { resetRateLimitsForTests } from "./rateLimit";

const renderMocks = vi.hoisted(() => ({
  start: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock("./db");
vi.mock("./renderExport", () => ({
  startServerExport: renderMocks.start,
  cancelServerExport: renderMocks.cancel,
}));

import { appRouter } from "./routers";

function context(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `export-user-${userId}`,
      name: `Export User ${userId}`,
      email: null,
      loginMethod: "test",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

describe("server export router", () => {
  beforeEach(() => {
    resetStore();
    resetRateLimitsForTests();
    renderMocks.start.mockReset();
    renderMocks.cancel.mockReset();
  });

  it("starts an owned MP4 export with a validated resolution", async () => {
    const project = await createProject(1, "Export project");
    renderMocks.start.mockResolvedValue({ id: 42, status: "processing" });

    const result = await appRouter.createCaller(context(1)).export.create({
      projectId: project.id,
      resolution: "1080p",
      format: "mp4",
    });

    expect(result).toEqual({ id: 42, status: "processing" });
    expect(renderMocks.start).toHaveBeenCalledWith(project.id, 1, "1080p");
  });

  it("does not expose or cancel another user's export", async () => {
    const project = await createProject(1, "Private export project");
    const row = await createExport({
      projectId: project.id,
      userId: 1,
      storageKey: "",
      url: "",
      resolution: "720p",
      format: "mp4",
      duration: 0,
      status: "processing",
      progress: 0,
    });

    const attacker = appRouter.createCaller(context(2));
    await expect(
      attacker.export.list({ projectId: project.id })
    ).rejects.toThrow("Unauthorized");
    await expect(attacker.export.cancel({ id: row.id })).rejects.toThrow(
      "Unauthorized"
    );
    expect(renderMocks.cancel).not.toHaveBeenCalled();
  });

  it("retries only failed or cancelled owned jobs", async () => {
    const project = await createProject(1, "Retry project");
    const failed = await createExport({
      projectId: project.id,
      userId: 1,
      storageKey: "",
      url: "",
      resolution: "1080p",
      format: "mp4",
      duration: 0,
      status: "failed",
      progress: 30,
      errorMessage: "fixture failure",
    });
    const processing = await createExport({
      projectId: project.id,
      userId: 1,
      storageKey: "",
      url: "",
      resolution: "720p",
      format: "mp4",
      duration: 0,
      status: "processing",
      progress: 5,
    });
    renderMocks.start.mockResolvedValue({ id: 99, status: "processing" });
    const caller = appRouter.createCaller(context(1));

    await expect(caller.export.retry({ id: processing.id })).rejects.toThrow(
      "Only failed or cancelled exports"
    );
    await caller.export.retry({ id: failed.id });

    expect(renderMocks.start).toHaveBeenCalledWith(project.id, 1, "1080p");
  });
});
