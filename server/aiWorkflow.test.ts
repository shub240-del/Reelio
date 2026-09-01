import { beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import {
  createAsset,
  createClip,
  createMediaAnalysis,
  createProject,
  getProjectClips,
  resetStore,
  updateMediaAnalysis,
  updateClip,
} from "./__mocks__/db";
import { resetRateLimitsForTests } from "./rateLimit";

vi.mock("./db");

function context(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `user-${userId}`,
      name: `User ${userId}`,
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

async function fixture() {
  const project = await createProject(1, "AI workflow");
  const asset = await createAsset({
    projectId: project.id,
    userId: 1,
    name: "fixture.mp4",
    storageKey: "fixture.mp4",
    url: "/uploads/fixture.mp4",
    mimeType: "video/mp4",
    sizeBytes: 100,
    duration: 10,
    width: 320,
    height: 180,
    fps: 30,
    hasAudio: true,
  });
  const clip = await createClip({
    projectId: project.id,
    assetId: asset.id,
    trackId: 0,
    trackType: "video",
    sourceStart: 0,
    duration: 10,
    timelineStart: 0,
    sortIndex: 0,
  });
  return { project, asset, clip };
}

describe("persisted AI proposal workflow", () => {
  beforeEach(async () => {
    resetStore();
    await resetRateLimitsForTests();
    delete process.env.NVIDIA_API_KEY;
  });

  it("proposes, restores, applies, persists, and avoids duplicate application", async () => {
    const { project } = await fixture();
    const caller = appRouter.createCaller(context(1));
    const input = {
      projectId: project.id,
      requestId: "10000000-0000-4000-8000-000000000001",
      instruction: "Remove the first 5 seconds",
      playhead: 0,
      selectedClipIds: [],
      silenceEvidence: [],
    };
    const proposal = await caller.ai.propose(input);
    expect(proposal.status).toBe("pending");
    expect(proposal.provenance.source).toBe("deterministic");

    const restored = await caller.ai.pending({ projectId: project.id });
    expect(restored?.id).toBe(proposal.id);

    const applied = await caller.ai.commit({
      id: proposal.id,
      selectedOperationIndices: [0],
    });
    expect(applied).toMatchObject({
      success: true,
      alreadyApplied: false,
      appliedCount: 1,
    });
    const clips = await getProjectClips(project.id);
    expect(clips).toHaveLength(1);
    expect(clips[0]).toMatchObject({
      timelineStart: 0,
      sourceStart: 5,
      duration: 5,
    });
    expect(await caller.ai.pending({ projectId: project.id })).toBeNull();

    const duplicateApply = await caller.ai.commit({
      id: proposal.id,
      selectedOperationIndices: [0],
    });
    expect(duplicateApply.alreadyApplied).toBe(true);
    expect(await getProjectClips(project.id)).toHaveLength(1);
  });

  it("returns the same persisted proposal for an idempotent retry", async () => {
    const { project } = await fixture();
    const caller = appRouter.createCaller(context(1));
    const input = {
      projectId: project.id,
      requestId: "10000000-0000-4000-8000-000000000002",
      instruction: "Remove the first 5 seconds",
      playhead: 0,
      selectedClipIds: [],
      silenceEvidence: [],
    };
    const first = await caller.ai.propose(input);
    const second = await caller.ai.propose(input);
    expect(second.id).toBe(first.id);
    await expect(
      caller.ai.propose({ ...input, instruction: "Remove the first 2 seconds" })
    ).rejects.toThrow("different instruction");
  });

  it("allows only one concurrent apply attempt to mutate the timeline", async () => {
    const { project } = await fixture();
    const caller = appRouter.createCaller(context(1));
    const proposal = await caller.ai.propose({
      projectId: project.id,
      requestId: "10000000-0000-4000-8000-000000000007",
      instruction: "Remove the first 5 seconds",
      playhead: 0,
      selectedClipIds: [],
      silenceEvidence: [],
    });

    const attempts = await Promise.allSettled([
      caller.ai.commit({ id: proposal.id, selectedOperationIndices: [0] }),
      caller.ai.commit({ id: proposal.id, selectedOperationIndices: [0] }),
    ]);

    expect(
      attempts.filter(attempt => attempt.status === "fulfilled")
    ).toHaveLength(1);
    expect(
      attempts.filter(attempt => attempt.status === "rejected")
    ).toHaveLength(1);
    expect(await getProjectClips(project.id)).toEqual([
      expect.objectContaining({ sourceStart: 5, duration: 5 }),
    ]);
  });

  it("rejects stale proposals without mutating the newer timeline", async () => {
    const { project, clip } = await fixture();
    const caller = appRouter.createCaller(context(1));
    const proposal = await caller.ai.propose({
      projectId: project.id,
      requestId: "10000000-0000-4000-8000-000000000003",
      instruction: "Remove the first 5 seconds",
      playhead: 0,
      selectedClipIds: [],
      silenceEvidence: [],
    });
    await updateClip(clip.id, { muted: true });
    await expect(
      caller.ai.commit({ id: proposal.id, selectedOperationIndices: [0] })
    ).rejects.toThrow("timeline changed");
    expect((await getProjectClips(project.id))[0].duration).toBe(10);
  });

  it("enforces proposal ownership across users", async () => {
    const { project } = await fixture();
    const owner = appRouter.createCaller(context(1));
    const attacker = appRouter.createCaller(context(2));
    const proposal = await owner.ai.propose({
      projectId: project.id,
      requestId: "10000000-0000-4000-8000-000000000004",
      instruction: "Remove the first 5 seconds",
      playhead: 0,
      selectedClipIds: [],
      silenceEvidence: [],
    });
    await expect(
      attacker.ai.commit({ id: proposal.id, selectedOperationIndices: [0] })
    ).rejects.toThrow("not found");
    await expect(
      attacker.ai.pending({ projectId: project.id })
    ).rejects.toThrow();
  });

  it("rejects a proposal without changing the timeline", async () => {
    const { project } = await fixture();
    const caller = appRouter.createCaller(context(1));
    const proposal = await caller.ai.propose({
      projectId: project.id,
      requestId: "10000000-0000-4000-8000-000000000005",
      instruction: "Remove the first 5 seconds",
      playhead: 0,
      selectedClipIds: [],
      silenceEvidence: [],
    });
    const result = await caller.ai.reject({ id: proposal.id });
    expect(result.status).toBe("rejected");
    expect((await getProjectClips(project.id))[0].duration).toBe(10);
    await expect(
      caller.ai.commit({ id: proposal.id, selectedOperationIndices: [0] })
    ).rejects.toThrow("rejected");
  });

  it("does not create executable work for unsupported requests without credentials", async () => {
    const { project } = await fixture();
    const caller = appRouter.createCaller(context(1));
    const result = await caller.ai.propose({
      projectId: project.id,
      requestId: "10000000-0000-4000-8000-000000000006",
      instruction: "Invent a transcript and upload it somewhere",
      playhead: 0,
      selectedClipIds: [],
      silenceEvidence: [],
    });
    expect(result.status).toBe("no_action");
    expect(result.plan.operations).toEqual([]);
    expect(result.provenance.source).toBe("provider-unavailable");
  });

  it("maps exact filler timestamps into a durable, reviewable and undoable proposal", async () => {
    const { project, asset } = await fixture();
    const analysis = await createMediaAnalysis({
      id: "20000000-0000-4000-8000-000000000001",
      requestId: "20000000-0000-4000-8000-000000000002",
      projectId: project.id,
      assetId: asset.id,
      userId: 1,
      kind: "transcription",
      status: "done",
      progress: 100,
      attempt: 1,
      provider: "test-timestamp-provider",
      resultJson: null,
      errorMessage: null,
    });
    await updateMediaAnalysis(analysis.id, 1, {
      resultJson: JSON.stringify({
        provider: "test-timestamp-provider",
        language: "en",
        text: "Well, um, continue.",
        segments: [
          {
            text: "Well, um, continue.",
            start: 0,
            end: 3,
            words: [
              { word: "Well", start: 0, end: 0.4 },
              { word: "um", start: 1, end: 1.25 },
              { word: "continue", start: 2, end: 3 },
            ],
          },
        ],
        words: [
          { word: "Well", start: 0, end: 0.4 },
          { word: "um", start: 1, end: 1.25 },
          { word: "continue", start: 2, end: 3 },
        ],
        fillers: [{ text: "um", start: 1, end: 1.25 }],
        captions: [{ text: "Well, um, continue.", startTime: 0, endTime: 3 }],
      }),
    });
    const caller = appRouter.createCaller(context(1));
    const proposal = await caller.analysis.proposeFillerRemoval({
      requestId: "20000000-0000-4000-8000-000000000003",
      analysisId: analysis.id,
      occurrenceIndices: [0],
    });

    expect(proposal).toMatchObject({
      status: "pending",
      provenance: {
        source: "provider-transcript-evidence",
        provider: "test-timestamp-provider",
      },
      plan: {
        operations: [
          {
            type: "removeRanges",
            ranges: [{ start: 1, end: 1.25 }],
          },
        ],
      },
    });
    expect((await getProjectClips(project.id))[0].duration).toBe(10);
    await caller.ai.commit({ id: proposal.id, selectedOperationIndices: [0] });
    expect(await getProjectClips(project.id)).toEqual([
      expect.objectContaining({ sourceStart: 0, duration: 1 }),
      expect.objectContaining({ sourceStart: 1.25, duration: 8.75 }),
    ]);
  });

  it("does not disclose or propose from another user's transcript evidence", async () => {
    const { project, asset } = await fixture();
    const analysis = await createMediaAnalysis({
      id: "20000000-0000-4000-8000-000000000004",
      requestId: "20000000-0000-4000-8000-000000000005",
      projectId: project.id,
      assetId: asset.id,
      userId: 1,
      kind: "transcription",
      status: "done",
      progress: 100,
      attempt: 1,
      provider: "test-provider",
      resultJson: "{}",
      errorMessage: null,
    });
    await expect(
      appRouter.createCaller(context(2)).analysis.proposeFillerRemoval({
        requestId: "20000000-0000-4000-8000-000000000006",
        analysisId: analysis.id,
        occurrenceIndices: [0],
      })
    ).rejects.toThrow("Analysis not found");
  });
});
