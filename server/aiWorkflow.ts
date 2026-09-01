import { createHash, randomUUID } from "node:crypto";
import { applyEditOps, editPlanSchema, type EditPlan } from "../shared/editOps";
import type { TimelineAsset, TimelineClip } from "../shared/timeline";
import type { AIEditProposalRow } from "../drizzle/schema";
import {
  commitAIProposalTimeline,
  createAIEditProposal,
  getAIEditProposal,
  getAIEditProposalByRequest,
  getLatestPendingAIEditProposal,
  getProject,
  getProjectAssets,
  getProjectClips,
  updateAIEditProposalStatus,
} from "./db";
import {
  aiEditRequestSchema,
  createTimelineRevision,
  mapSilenceEvidenceToTimeline,
  requestAIEdit,
  validatePlanForTimeline,
  type AIEditRequest,
  type AIEditResult,
  type CanonicalAIContext,
} from "./aiEdit";

type ProposalStatus = AIEditProposalRow["status"];

export interface StoredAIProvenance {
  source: AIEditResult["source"];
  provider: string | null;
  model: string | null;
  observations: string[];
  inferences: string[];
  unsupported: string[];
  usage: AIEditResult["usage"];
}

export interface AIProposalView {
  id: string;
  requestId: string;
  projectId: number;
  baseRevision: string;
  status: ProposalStatus;
  plan: EditPlan;
  provenance: StoredAIProvenance;
  createdAt: Date;
  updatedAt: Date;
}

const runningRequests = new Map<string, AbortController>();
const applyingProposals = new Set<string>();

const requestKey = (userId: number, requestId: string) =>
  `${userId}:${requestId}`;
const hashInstruction = (instruction: string) =>
  createHash("sha256").update(instruction.trim()).digest("hex");

function canonicalClips(
  rows: Awaited<ReturnType<typeof getProjectClips>>
): TimelineClip[] {
  return rows.map(clip => ({
    id: clip.id,
    assetId: clip.assetId,
    trackId: clip.trackId,
    trackType: clip.trackType,
    sourceStart: clip.sourceStart,
    duration: clip.duration,
    timelineStart: clip.timelineStart,
    sortIndex: clip.sortIndex,
    locked: clip.locked,
    visible: clip.visible,
    muted: clip.muted,
    videoFx: clip.videoFx ?? null,
    transition: clip.transition ?? null,
  }));
}

function canonicalAssets(
  rows: Awaited<ReturnType<typeof getProjectAssets>>
): TimelineAsset[] {
  return rows.map(asset => ({
    id: asset.id,
    duration: asset.duration,
    hasAudio: asset.hasAudio,
    width: asset.width,
    height: asset.height,
    fps: asset.fps,
  }));
}

function parseRow(row: AIEditProposalRow): AIProposalView {
  return {
    id: row.id,
    requestId: row.requestId,
    projectId: row.projectId,
    baseRevision: row.baseRevision,
    status: row.status,
    plan: editPlanSchema.parse(JSON.parse(row.planJson)),
    provenance: JSON.parse(row.provenanceJson) as StoredAIProvenance,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function loadCanonicalContext(
  input: AIEditRequest,
  userId: number
): Promise<{ context: CanonicalAIContext; revision: string }> {
  const project = await getProject(input.projectId, userId);
  if (!project) throw new Error("Project not found or not owned by this user.");
  const [clipRows, assetRows] = await Promise.all([
    getProjectClips(input.projectId),
    getProjectAssets(input.projectId),
  ]);
  const clips = canonicalClips(clipRows);
  const assets = canonicalAssets(assetRows);
  const clipIds = new Set(clips.map(clip => clip.id));
  if (input.selectedClipIds.some(id => !clipIds.has(id))) {
    throw new Error(
      "The selected clip list is stale or references another project."
    );
  }
  const silenceRanges = mapSilenceEvidenceToTimeline(
    input.silenceEvidence,
    clips,
    assets
  );
  return {
    context: {
      instruction: input.instruction,
      clips,
      assets,
      playhead: input.playhead,
      selectedClipIds: input.selectedClipIds,
      silenceRanges,
    },
    revision: createTimelineRevision(clips, assets),
  };
}

export async function proposeAIEdit(
  rawInput: AIEditRequest,
  userId: number
): Promise<AIProposalView> {
  const input = aiEditRequestSchema.parse(rawInput);
  const instructionHash = hashInstruction(input.instruction);
  const existing = await getAIEditProposalByRequest(userId, input.requestId);
  if (existing) {
    if (
      existing.instructionHash !== instructionHash ||
      existing.projectId !== input.projectId
    ) {
      throw new Error(
        "This request ID was already used for a different instruction."
      );
    }
    return parseRow(existing as AIEditProposalRow);
  }

  const key = requestKey(userId, input.requestId);
  if (runningRequests.has(key))
    throw new Error("This AI request is already in progress.");
  const controller = new AbortController();
  runningRequests.set(key, controller);
  try {
    const { context, revision } = await loadCanonicalContext(input, userId);
    const result = await requestAIEdit(context, { signal: controller.signal });
    const provenance: StoredAIProvenance = {
      source: result.source,
      provider: result.provider,
      model: result.model,
      observations: result.observations,
      inferences: result.inferences,
      unsupported: result.unsupported,
      usage: result.usage,
    };
    const row = await createAIEditProposal({
      id: randomUUID(),
      requestId: input.requestId,
      projectId: input.projectId,
      userId,
      instructionHash,
      baseRevision: revision,
      planJson: JSON.stringify(result.plan),
      provenanceJson: JSON.stringify(provenance),
      provider: result.provider ?? result.source,
      status: result.plan.operations.length > 0 ? "pending" : "no_action",
    });
    if (!row) throw new Error("The AI proposal could not be persisted.");
    return parseRow(row as AIEditProposalRow);
  } catch (error) {
    const raced = await getAIEditProposalByRequest(userId, input.requestId);
    if (raced && raced.instructionHash === instructionHash) {
      return parseRow(raced as AIEditProposalRow);
    }
    throw error;
  } finally {
    runningRequests.delete(key);
  }
}

export function cancelRunningAIRequest(
  userId: number,
  requestId: string
): boolean {
  const controller = runningRequests.get(requestKey(userId, requestId));
  if (!controller) return false;
  controller.abort();
  return true;
}

export async function getPendingAIProposal(projectId: number, userId: number) {
  const project = await getProject(projectId, userId);
  if (!project) throw new Error("Project not found or not owned by this user.");
  const row = await getLatestPendingAIEditProposal(projectId, userId);
  return row ? parseRow(row as AIEditProposalRow) : null;
}

export async function rejectAIProposal(
  id: string,
  userId: number,
  status: "rejected" | "cancelled" = "rejected"
) {
  const row = await getAIEditProposal(id, userId);
  if (!row) throw new Error("AI proposal not found.");
  if (row.status === "applied")
    throw new Error("An applied proposal cannot be rejected.");
  if (row.status === "pending")
    await updateAIEditProposalStatus(id, userId, status);
  return {
    success: true,
    status: row.status === "pending" ? status : row.status,
  };
}

export async function applyAIProposal(
  id: string,
  userId: number,
  selectedOperationIndices: number[]
) {
  if (applyingProposals.has(id))
    throw new Error("This proposal is already being applied.");
  applyingProposals.add(id);
  try {
    const row = await getAIEditProposal(id, userId);
    if (!row) throw new Error("AI proposal not found.");
    if (row.status === "applied") {
      return { success: true, alreadyApplied: true, appliedCount: 0 };
    }
    if (row.status !== "pending")
      throw new Error(`AI proposal is ${row.status}.`);

    const project = await getProject(row.projectId, userId);
    if (!project)
      throw new Error("Project not found or not owned by this user.");
    const [clipRows, assetRows] = await Promise.all([
      getProjectClips(row.projectId),
      getProjectAssets(row.projectId),
    ]);
    const clips = canonicalClips(clipRows);
    const assets = canonicalAssets(assetRows);
    const revision = createTimelineRevision(clips, assets);
    if (revision !== row.baseRevision) {
      throw new Error(
        "The timeline changed after this proposal was created. Generate a new proposal."
      );
    }

    const plan = editPlanSchema.parse(JSON.parse(row.planJson));
    const indices = [...new Set(selectedOperationIndices)].sort(
      (a, b) => a - b
    );
    if (
      indices.length === 0 ||
      indices.some(index => index < 0 || index >= plan.operations.length)
    ) {
      throw new Error("Select at least one valid proposed operation.");
    }
    const operations = indices.map(index => plan.operations[index]);
    const context: CanonicalAIContext = {
      instruction: "stored-proposal",
      clips,
      assets,
      playhead: 0,
      selectedClipIds: [],
      silenceRanges: [],
    };
    validatePlanForTimeline({ summary: plan.summary, operations }, context);
    const assetMap = new Map(assets.map(asset => [asset.id, asset]));
    const result = applyEditOps(clips, assetMap, operations);
    if (result.skipped.length > 0 || result.sideEffects.length > 0) {
      throw new Error(
        "The proposal could not be applied completely and was left unchanged."
      );
    }

    const creates = result.clips
      .filter(clip => clip.id < 0)
      .map(clip => ({
        projectId: row.projectId,
        assetId: clip.assetId,
        trackId: clip.trackId,
        trackType: clip.trackType,
        sourceStart: clip.sourceStart,
        duration: clip.duration,
        timelineStart: clip.timelineStart,
        sortIndex: clip.sortIndex,
        locked: clip.locked,
        visible: clip.visible,
        muted: clip.muted,
        videoFx: clip.videoFx ?? null,
        transition: clip.transition ?? null,
      }));
    const nextIds = new Set(
      result.clips.filter(clip => clip.id > 0).map(clip => clip.id)
    );
    const deletes = clips
      .filter(clip => !nextIds.has(clip.id))
      .map(clip => clip.id);
    const updates = result.clips
      .filter(clip => clip.id > 0)
      .map(clip => ({
        id: clip.id,
        patch: {
          sourceStart: clip.sourceStart,
          duration: clip.duration,
          timelineStart: clip.timelineStart,
          sortIndex: clip.sortIndex,
          trackId: clip.trackId,
          trackType: clip.trackType,
          locked: clip.locked,
          visible: clip.visible,
          muted: clip.muted,
          videoFx: clip.videoFx ?? null,
          transition: clip.transition ?? null,
        },
      }));

    const commit = await commitAIProposalTimeline(
      id,
      row.projectId,
      userId,
      row.baseRevision,
      (currentClipRows, currentAssetRows) =>
        createTimelineRevision(
          canonicalClips(currentClipRows),
          canonicalAssets(currentAssetRows)
        ),
      { creates, updates, deletes }
    );
    if (commit.alreadyApplied) {
      return { success: true, alreadyApplied: true, appliedCount: 0 };
    }
    return {
      success: true,
      alreadyApplied: false,
      appliedCount: result.applied.length,
    };
  } finally {
    applyingProposals.delete(id);
  }
}
