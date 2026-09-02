import { COOKIE_NAME } from "@shared/const";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  batchCommitTimeline,
  createAsset,
  createCaption,
  createClip,
  deleteAsset,
  createMarker,
  createProject,
  deleteClip,
  deleteCaption,
  deleteMarker,
  deleteProject,
  duplicateProject,
  getAsset,
  getAssetCaptions,
  getCaption,
  getClip,
  getExport,
  getMarker,
  getMediaAnalysis,
  getProject,
  getProjectAssets,
  getProjectCaptions,
  getProjectClips,
  getProjectExports,
  getProjectMarkers,
  getProjectMediaAnalyses,
  getUserProjects,
  isStorageKeyReferenced,
  updateClip,
  updateCaption,
  updateProject,
} from "./db";
import { storageDelete, storagePut } from "./storage";
import { probeMediaFile } from "./mediaProbe";
import { aiEditRequestSchema } from "./aiEdit";
import { AIProviderError, getAIProvider } from "./_core/nvidia";
import {
  applyAIProposal,
  cancelRunningAIRequest,
  getPendingAIProposal,
  proposeAIEdit,
  proposeEvidenceRangeRemoval,
  rejectAIProposal,
} from "./aiWorkflow";
import { consumeRateLimit, RateLimitError } from "./rateLimit";
import { cancelServerExport, startServerExport } from "./renderExport";
import {
  cancelMediaAnalysis,
  captionsToSrtText,
  captionsToWebVtt,
  startMediaAnalysis,
  transcriptAnalysisResultSchema,
  transcriptionProviderAvailable,
} from "./mediaAnalysis";

const MAX_CLOUD_UPLOAD_BYTES = 50 * 1024 * 1024;
const idSchema = z.number().int().positive();
const finiteNonNegative = z.number().finite().min(0);
const clipVolume = z.number().finite().min(0).max(2);
const normalizedPosition = z.number().finite().min(-1).max(1);
const clipScale = z.number().finite().min(0.1).max(4);
const cropFraction = z.number().finite().min(0).max(0.9);
const projectStatusSchema = z.enum(["draft", "editing", "exporting", "done"]);

async function requireOwnedProject(projectId: number, userId: number) {
  const project = await getProject(projectId, userId);
  if (!project) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Unauthorized: project does not belong to this user",
    });
  }
  return project;
}

function aiError(error: unknown): TRPCError {
  if (error instanceof RateLimitError) {
    return new TRPCError({ code: "TOO_MANY_REQUESTS", message: error.message });
  }
  if (error instanceof AIProviderError) {
    const code =
      error.code === "cancelled"
        ? "TIMEOUT"
        : error.code === "quota_exceeded"
          ? "TOO_MANY_REQUESTS"
          : "BAD_GATEWAY";
    return new TRPCError({ code, message: error.message });
  }
  const message = error instanceof Error ? error.message : "AI request failed";
  const code = /not owned|outside the project|another project/i.test(message)
    ? "FORBIDDEN"
    : /changed after|already|stale|different instruction|locked|invalid|unknown|outside|exceeds|overlapping/i.test(
          message
        )
      ? "CONFLICT"
      : "BAD_REQUEST";
  return new TRPCError({ code, message });
}

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  /* ─── Projects ─── */
  project: router({
    create: protectedProcedure
      .input(
        z.object({
          name: z.string().trim().min(1).max(256),
          description: z.string().trim().max(4000).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        return createProject(ctx.user.id, input.name, input.description);
      }),
    list: protectedProcedure.query(async ({ ctx }) => {
      return getUserProjects(ctx.user.id);
    }),
    get: protectedProcedure
      .input(z.object({ id: idSchema }))
      .query(async ({ ctx, input }) => {
        return requireOwnedProject(input.id, ctx.user.id);
      }),
    update: protectedProcedure
      .input(
        z.object({
          id: idSchema,
          name: z.string().trim().min(1).max(256).optional(),
          status: projectStatusSchema.optional(),
          description: z.string().trim().max(4000).nullable().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requireOwnedProject(input.id, ctx.user.id);
        await updateProject(
          input.id,
          ctx.user.id,
          input.name,
          input.status,
          input.description
        );
        return { success: true };
      }),
    duplicate: protectedProcedure
      .input(
        z.object({
          id: idSchema,
          name: z.string().trim().min(1).max(256).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const project = await duplicateProject(
          input.id,
          ctx.user.id,
          input.name
        );
        if (!project)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Project not found",
          });
        return project;
      }),
    delete: protectedProcedure
      .input(z.object({ id: idSchema }))
      .mutation(async ({ ctx, input }) => {
        await requireOwnedProject(input.id, ctx.user.id);
        const [projectAssets, projectExports] = await Promise.all([
          getProjectAssets(input.id),
          getProjectExports(input.id),
        ]);
        await deleteProject(input.id, ctx.user.id);
        for (const stored of [...projectAssets, ...projectExports]) {
          if (
            stored.storageKey &&
            !(await isStorageKeyReferenced(stored.storageKey))
          ) {
            await storageDelete(stored.storageKey);
          }
        }
        return { success: true };
      }),
  }),

  /* ─── Assets ─── */
  asset: router({
    list: protectedProcedure
      .input(z.object({ projectId: idSchema }))
      .query(async ({ ctx, input }) => {
        await requireOwnedProject(input.projectId, ctx.user.id);
        return getProjectAssets(input.projectId);
      }),
    upload: protectedProcedure
      .input(
        z.object({
          projectId: idSchema,
          base64Data: z
            .string()
            .min(1)
            .max(Math.ceil((MAX_CLOUD_UPLOAD_BYTES * 4) / 3) + 8),
          fileName: z.string().trim().min(1).max(255),
          mimeType: z
            .string()
            .regex(/^(video|audio|image)\/[a-z0-9.+-]+$/i)
            .max(128),
          sizeBytes: z.number().int().positive().max(MAX_CLOUD_UPLOAD_BYTES),
          duration: finiteNonNegative.optional(),
          width: z.number().int().min(0).max(8192).optional(),
          height: z.number().int().min(0).max(8192).optional(),
          fps: z.number().finite().min(0).max(240).optional(),
          hasAudio: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const userId = ctx.user.id;
        await consumeRateLimit("upload", userId, 20, 60 * 60 * 1000);
        await requireOwnedProject(input.projectId, userId);

        const buffer = Buffer.from(input.base64Data, "base64");
        if (
          buffer.length !== input.sizeBytes ||
          buffer.length > MAX_CLOUD_UPLOAD_BYTES
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Uploaded media size does not match the payload",
          });
        }
        const safeFileName = input.fileName.replace(/[\\/\u0000-\u001f]/g, "_");
        const probeDir = await fs.promises.mkdtemp(
          path.join(path.resolve(os.tmpdir()), "reelio-upload-probe-")
        );
        const probePath = path.join(probeDir, "upload.media");
        let measured;
        try {
          await fs.promises.writeFile(probePath, buffer);
          measured = await probeMediaFile(probePath, {
            expectedMimeType: input.mimeType,
          });
        } finally {
          const resolved = path.resolve(probeDir);
          if (
            path.dirname(resolved) === path.resolve(os.tmpdir()) &&
            path.basename(resolved).startsWith("reelio-upload-probe-")
          ) {
            await fs.promises.rm(resolved, { recursive: true, force: true });
          }
        }
        const storageKey = `${userId}/projects/${input.projectId}/assets/${randomUUID()}-${safeFileName}`;
        const { key, url } = await storagePut(
          storageKey,
          buffer,
          input.mimeType
        );
        try {
          return await createAsset({
            projectId: input.projectId,
            userId,
            name: safeFileName,
            storageKey: key,
            url,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
            duration: measured.duration,
            width: measured.width,
            height: measured.height,
            fps: measured.fps,
            hasAudio: measured.hasAudio,
          });
        } catch (error) {
          await storageDelete(key);
          throw error;
        }
      }),
    delete: protectedProcedure
      .input(z.object({ id: idSchema }))
      .mutation(async ({ ctx, input }) => {
        const asset = await getAsset(input.id);
        if (!asset)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Asset not found",
          });
        const project = await getProject(asset.projectId, ctx.user.id);
        if (!project)
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Unauthorized: asset does not belong to this user",
          });
        await deleteAsset(input.id, ctx.user.id);
        if (!(await isStorageKeyReferenced(asset.storageKey)))
          await storageDelete(asset.storageKey);
        return { success: true };
      }),
  }),

  /* ─── Clips ─── */
  clip: router({
    list: protectedProcedure
      .input(z.object({ projectId: idSchema }))
      .query(async ({ ctx, input }) => {
        const project = await getProject(input.projectId, ctx.user.id);
        if (!project)
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Unauthorized: project does not belong to this user",
          });
        return getProjectClips(input.projectId);
      }),
    create: protectedProcedure
      .input(
        z.object({
          projectId: idSchema,
          assetId: idSchema,
          trackId: z.number().int().min(0).max(32).default(0),
          trackType: z.enum(["video", "audio"]).default("video"),
          sourceStart: finiteNonNegative,
          duration: z.number().finite().positive(),
          timelineStart: finiteNonNegative,
          sortIndex: z.number().int().min(0).default(0),
          zIndex: z.number().int().min(-32).max(32).default(0),
          volume: clipVolume.default(1),
          trackVolume: clipVolume.default(1),
          positionX: normalizedPosition.default(0),
          positionY: normalizedPosition.default(0),
          scale: clipScale.default(1),
          cropLeft: cropFraction.default(0),
          cropTop: cropFraction.default(0),
          cropRight: cropFraction.default(0),
          cropBottom: cropFraction.default(0),
          locked: z.boolean().default(false),
          visible: z.boolean().default(true),
          muted: z.boolean().default(false),
          videoFx: z.string().trim().max(64).nullable().optional(),
          transition: z.string().trim().max(64).nullable().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // Verify project ownership
        const project = await getProject(input.projectId, ctx.user.id);
        if (!project)
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Unauthorized: project does not belong to this user",
          });
        // Verify asset ownership - must belong to the same project and user
        const asset = await getAsset(input.assetId);
        if (!asset)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Asset not found",
          });
        if (
          asset.projectId !== input.projectId ||
          asset.userId !== ctx.user.id
        ) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Unauthorized: asset does not belong to this project",
          });
        }
        return createClip(input);
      }),
    update: protectedProcedure
      .input(
        z.object({
          id: idSchema,
          sourceStart: finiteNonNegative.optional(),
          duration: z.number().finite().positive().optional(),
          timelineStart: finiteNonNegative.optional(),
          sortIndex: z.number().int().min(0).optional(),
          zIndex: z.number().int().min(-32).max(32).optional(),
          volume: clipVolume.optional(),
          trackVolume: clipVolume.optional(),
          positionX: normalizedPosition.optional(),
          positionY: normalizedPosition.optional(),
          scale: clipScale.optional(),
          cropLeft: cropFraction.optional(),
          cropTop: cropFraction.optional(),
          cropRight: cropFraction.optional(),
          cropBottom: cropFraction.optional(),
          trackId: z.number().int().min(0).max(32).optional(),
          trackType: z.enum(["video", "audio"]).optional(),
          locked: z.boolean().optional(),
          visible: z.boolean().optional(),
          muted: z.boolean().optional(),
          videoFx: z.string().trim().max(64).nullable().optional(),
          transition: z.string().trim().max(64).nullable().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { id, ...updates } = input;
        const clip = await getClip(id);
        if (!clip)
          throw new TRPCError({ code: "NOT_FOUND", message: "Clip not found" });
        const project = await getProject(clip.projectId, ctx.user.id);
        if (!project)
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Unauthorized: clip does not belong to this user",
          });
        await updateClip(id, updates);
        return { success: true };
      }),
    delete: protectedProcedure
      .input(z.object({ id: idSchema }))
      .mutation(async ({ ctx, input }) => {
        const clip = await getClip(input.id);
        if (!clip)
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Unauthorized: clip does not belong to this user",
          });
        const project = await getProject(clip.projectId, ctx.user.id);
        if (!project)
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Unauthorized: clip does not belong to this user",
          });
        await deleteClip(input.id, ctx.user.id);
        return { success: true };
      }),
    trim: protectedProcedure
      .input(
        z.object({
          id: idSchema,
          sourceStart: finiteNonNegative,
          duration: z.number().finite().positive(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const clip = await getClip(input.id);
        if (!clip)
          throw new TRPCError({ code: "NOT_FOUND", message: "Clip not found" });
        const project = await getProject(clip.projectId, ctx.user.id);
        if (!project)
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Unauthorized: clip does not belong to this user",
          });
        await updateClip(input.id, {
          sourceStart: input.sourceStart,
          duration: input.duration,
        });
        return { success: true };
      }),
    split: protectedProcedure
      .input(
        z.object({
          id: idSchema,
          splitAt: z.number().finite().positive(), // relative to sourceStart
          projectId: idSchema,
        })
      )
      .mutation(async ({ ctx, input }) => {
        // Verify project ownership
        const project = await getProject(input.projectId, ctx.user.id);
        if (!project)
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Unauthorized: project does not belong to this user",
          });
        const clip = (await getProjectClips(input.projectId)).find(
          c => c.id === input.id
        );
        if (!clip)
          throw new TRPCError({ code: "NOT_FOUND", message: "Clip not found" });
        if (input.splitAt >= clip.duration) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Split point must be inside the clip",
          });
        }

        const firstDuration = input.splitAt;
        const secondDuration = clip.duration - input.splitAt;

        await updateClip(input.id, { duration: firstDuration });

        const newClip = await createClip({
          projectId: input.projectId,
          assetId: clip.assetId,
          trackId: clip.trackId,
          trackType: clip.trackType,
          sourceStart: clip.sourceStart + input.splitAt,
          duration: secondDuration,
          timelineStart: clip.timelineStart + firstDuration,
          sortIndex: clip.sortIndex + 1,
          zIndex: clip.zIndex,
          volume: clip.volume,
          trackVolume: clip.trackVolume,
          positionX: clip.positionX,
          positionY: clip.positionY,
          scale: clip.scale,
          cropLeft: clip.cropLeft,
          cropTop: clip.cropTop,
          cropRight: clip.cropRight,
          cropBottom: clip.cropBottom,
          locked: clip.locked,
          visible: clip.visible,
          muted: clip.muted,
          videoFx: clip.videoFx,
          transition: clip.transition,
        });

        return { success: true, newClipId: newClip?.id };
      }),
    batchCommit: protectedProcedure
      .input(
        z.object({
          projectId: idSchema,
          creates: z
            .array(
              z.object({
                assetId: idSchema,
                trackId: z.number().int().min(0).max(32).default(0),
                trackType: z.enum(["video", "audio"]).default("video"),
                sourceStart: finiteNonNegative,
                duration: z.number().finite().positive(),
                timelineStart: finiteNonNegative,
                sortIndex: z.number().int().min(0).default(0),
                zIndex: z.number().int().min(-32).max(32).optional(),
                volume: clipVolume.optional(),
                trackVolume: clipVolume.optional(),
                positionX: normalizedPosition.optional(),
                positionY: normalizedPosition.optional(),
                scale: clipScale.optional(),
                cropLeft: cropFraction.optional(),
                cropTop: cropFraction.optional(),
                cropRight: cropFraction.optional(),
                cropBottom: cropFraction.optional(),
                locked: z.boolean().optional(),
                visible: z.boolean().optional(),
                muted: z.boolean().optional(),
                videoFx: z.string().trim().max(64).optional().nullable(),
                transition: z.string().trim().max(64).optional().nullable(),
              })
            )
            .default([]),
          updates: z
            .array(
              z.object({
                id: idSchema,
                patch: z.object({
                  sourceStart: finiteNonNegative.optional(),
                  duration: z.number().finite().positive().optional(),
                  timelineStart: finiteNonNegative.optional(),
                  sortIndex: z.number().int().min(0).optional(),
                  zIndex: z.number().int().min(-32).max(32).optional(),
                  volume: clipVolume.optional(),
                  trackVolume: clipVolume.optional(),
                  positionX: normalizedPosition.optional(),
                  positionY: normalizedPosition.optional(),
                  scale: clipScale.optional(),
                  cropLeft: cropFraction.optional(),
                  cropTop: cropFraction.optional(),
                  cropRight: cropFraction.optional(),
                  cropBottom: cropFraction.optional(),
                  trackId: z.number().int().min(0).max(32).optional(),
                  trackType: z.enum(["video", "audio"]).optional(),
                  locked: z.boolean().optional(),
                  visible: z.boolean().optional(),
                  muted: z.boolean().optional(),
                  videoFx: z.string().trim().max(64).optional().nullable(),
                  transition: z.string().trim().max(64).optional().nullable(),
                }),
              })
            )
            .default([]),
          deletes: z.array(idSchema).default([]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requireOwnedProject(input.projectId, ctx.user.id);
        const [projectAssets, projectClips] = await Promise.all([
          getProjectAssets(input.projectId),
          getProjectClips(input.projectId),
        ]);
        const assetIds = new Set(projectAssets.map(asset => asset.id));
        const clipIds = new Set(projectClips.map(clip => clip.id));
        if (input.creates.some(clip => !assetIds.has(clip.assetId))) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "A new clip references media outside this project",
          });
        }
        if (
          input.updates.some(update => !clipIds.has(update.id)) ||
          input.deletes.some(id => !clipIds.has(id))
        ) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "A timeline change references a clip outside this project",
          });
        }
        const clips = await batchCommitTimeline(input.projectId, ctx.user.id, {
          creates: input.creates as any,
          updates: input.updates as any,
          deletes: input.deletes,
        });
        return { success: true, clips };
      }),
  }),

  /* ─── Markers ─── */
  marker: router({
    list: protectedProcedure
      .input(z.object({ projectId: idSchema }))
      .query(async ({ ctx, input }) => {
        await requireOwnedProject(input.projectId, ctx.user.id);
        return getProjectMarkers(input.projectId);
      }),
    create: protectedProcedure
      .input(
        z.object({
          projectId: idSchema,
          time: finiteNonNegative,
          label: z.string().trim().min(1).max(256).optional(),
          color: z
            .string()
            .regex(/^#[0-9a-f]{6}$/i)
            .default("#7c5cff"),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requireOwnedProject(input.projectId, ctx.user.id);
        return createMarker(input);
      }),
    delete: protectedProcedure
      .input(z.object({ id: idSchema }))
      .mutation(async ({ ctx, input }) => {
        const marker = await getMarker(input.id);
        if (!marker)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Marker not found",
          });
        await requireOwnedProject(marker.projectId, ctx.user.id);
        await deleteMarker(input.id);
        return { success: true };
      }),
  }),

  /* ─── Captions ─── */
  caption: router({
    list: protectedProcedure
      .input(z.object({ projectId: idSchema }))
      .query(async ({ ctx, input }) => {
        await requireOwnedProject(input.projectId, ctx.user.id);
        return getProjectCaptions(input.projectId);
      }),
    getByAsset: protectedProcedure
      .input(z.object({ assetId: idSchema }))
      .query(async ({ ctx, input }) => {
        const asset = await getAsset(input.assetId);
        if (!asset)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Asset not found",
          });
        await requireOwnedProject(asset.projectId, ctx.user.id);
        return getAssetCaptions(input.assetId);
      }),
    create: protectedProcedure
      .input(
        z
          .object({
            projectId: idSchema,
            assetId: idSchema,
            text: z.string().trim().min(1).max(4000),
            startTime: finiteNonNegative,
            endTime: finiteNonNegative,
          })
          .refine(input => input.endTime > input.startTime, {
            message: "Caption end time must be after its start time",
            path: ["endTime"],
          })
      )
      .mutation(async ({ ctx, input }) => {
        await requireOwnedProject(input.projectId, ctx.user.id);
        const asset = await getAsset(input.assetId);
        if (
          !asset ||
          asset.projectId !== input.projectId ||
          asset.userId !== ctx.user.id
        ) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Unauthorized: asset does not belong to this project",
          });
        }
        return createCaption(input);
      }),
    update: protectedProcedure
      .input(
        z
          .object({
            id: idSchema,
            text: z.string().trim().min(1).max(4000),
            startTime: finiteNonNegative,
            endTime: finiteNonNegative,
          })
          .refine(input => input.endTime > input.startTime, {
            message: "Caption end time must be after its start time",
            path: ["endTime"],
          })
      )
      .mutation(async ({ ctx, input }) => {
        const caption = await getCaption(input.id);
        if (!caption)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Caption not found",
          });
        await requireOwnedProject(caption.projectId, ctx.user.id);
        const siblings = await getProjectCaptions(caption.projectId);
        if (
          siblings.some(
            candidate =>
              candidate.id !== caption.id &&
              input.startTime < candidate.endTime &&
              input.endTime > candidate.startTime
          )
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Caption timestamps cannot overlap",
          });
        }
        await updateCaption(input.id, {
          text: input.text,
          startTime: input.startTime,
          endTime: input.endTime,
        });
        return { success: true };
      }),
    delete: protectedProcedure
      .input(z.object({ id: idSchema }))
      .mutation(async ({ ctx, input }) => {
        const caption = await getCaption(input.id);
        if (!caption)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Caption not found",
          });
        await requireOwnedProject(caption.projectId, ctx.user.id);
        await deleteCaption(input.id);
        return { success: true };
      }),
    formats: protectedProcedure
      .input(z.object({ projectId: idSchema }))
      .query(async ({ ctx, input }) => {
        await requireOwnedProject(input.projectId, ctx.user.id);
        const cues = await getProjectCaptions(input.projectId);
        return {
          srt: captionsToSrtText(cues),
          webvtt: captionsToWebVtt(cues),
          cueCount: cues.length,
        };
      }),
  }),

  /* ─── Durable media intelligence ─── */
  analysis: router({
    capabilities: publicProcedure.query(() => ({
      sceneDetection: {
        available: true,
        provider: "ffmpeg-scene-score",
        verified: true,
      },
      transcription: {
        available: transcriptionProviderAvailable(),
        provider: transcriptionProviderAvailable() ? "forge-whisper" : null,
        verified: false,
      },
    })),
    list: protectedProcedure
      .input(z.object({ projectId: idSchema }))
      .query(async ({ ctx, input }) => {
        await requireOwnedProject(input.projectId, ctx.user.id);
        return getProjectMediaAnalyses(input.projectId, ctx.user.id);
      }),
    start: protectedProcedure
      .input(
        z.object({
          requestId: z.string().uuid(),
          projectId: idSchema,
          assetId: idSchema,
          kind: z.enum(["transcription", "scene"]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await consumeRateLimit(
          "media-analysis",
          ctx.user.id,
          20,
          60 * 60 * 1000
        );
        try {
          return await startMediaAnalysis({ ...input, userId: ctx.user.id });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Could not start analysis";
          throw new TRPCError({
            code: /not owned/i.test(message) ? "FORBIDDEN" : "BAD_REQUEST",
            message,
          });
        }
      }),
    cancel: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => ({
        success: await cancelMediaAnalysis(input.id, ctx.user.id),
      })),
    retry: protectedProcedure
      .input(z.object({ id: z.string().uuid(), requestId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const row = await getMediaAnalysis(input.id, ctx.user.id);
        if (!row)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Analysis not found",
          });
        if (row.status !== "failed" && row.status !== "cancelled")
          throw new TRPCError({
            code: "CONFLICT",
            message: "Only failed or cancelled analyses can be retried",
          });
        await consumeRateLimit(
          "media-analysis",
          ctx.user.id,
          20,
          60 * 60 * 1000
        );
        return startMediaAnalysis({
          requestId: input.requestId,
          projectId: row.projectId,
          assetId: row.assetId,
          userId: ctx.user.id,
          kind: row.kind,
        });
      }),
    proposeFillerRemoval: protectedProcedure
      .input(
        z.object({
          requestId: z.string().uuid(),
          analysisId: z.string().uuid(),
          occurrenceIndices: z.array(z.number().int().min(0)).min(1).max(200),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const analysis = await getMediaAnalysis(input.analysisId, ctx.user.id);
        if (!analysis)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Analysis not found",
          });
        if (
          analysis.kind !== "transcription" ||
          analysis.status !== "done" ||
          !analysis.resultJson
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "A completed timestamped transcript is required",
          });
        }
        const parsed = transcriptAnalysisResultSchema.safeParse(
          JSON.parse(analysis.resultJson)
        );
        if (!parsed.success)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Stored transcript evidence is invalid",
          });
        const selectedIndices = [...new Set(input.occurrenceIndices)].sort(
          (a, b) => a - b
        );
        if (
          selectedIndices.some(index => index >= parsed.data.fillers.length)
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "A selected filler occurrence does not exist",
          });
        }
        const clips = (await getProjectClips(analysis.projectId)).filter(
          clip =>
            clip.assetId === analysis.assetId && clip.visible && !clip.locked
        );
        const mapped = selectedIndices.flatMap(index => {
          const occurrence = parsed.data.fillers[index];
          return clips.flatMap(clip => {
            const sourceEnd = clip.sourceStart + clip.duration;
            const start = Math.max(occurrence.start, clip.sourceStart);
            const end = Math.min(occurrence.end, sourceEnd);
            return end > start
              ? [
                  {
                    start: clip.timelineStart + start - clip.sourceStart,
                    end: clip.timelineStart + end - clip.sourceStart,
                  },
                ]
              : [];
          });
        });
        const ranges = mapped
          .sort((a, b) => a.start - b.start || a.end - b.end)
          .reduce<Array<{ start: number; end: number }>>((merged, range) => {
            const previous = merged.at(-1);
            if (previous && range.start <= previous.end + 0.001) {
              previous.end = Math.max(previous.end, range.end);
            } else {
              merged.push({ ...range });
            }
            return merged;
          }, []);
        if (ranges.length === 0)
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "The selected filler words are outside the current timeline",
          });
        await consumeRateLimit("ai-edit", ctx.user.id, 30, 60 * 60 * 1000);
        return proposeEvidenceRangeRemoval(
          {
            requestId: input.requestId,
            projectId: analysis.projectId,
            evidenceId: analysis.id,
            provider: parsed.data.provider,
            ranges,
            observations: selectedIndices.map(index => {
              const filler = parsed.data.fillers[index];
              return `Transcript contains “${filler.text}” at ${filler.start.toFixed(3)}–${filler.end.toFixed(3)} seconds.`;
            }),
          },
          ctx.user.id
        );
      }),
  }),

  /* ─── Exports ─── */
  export: router({
    list: protectedProcedure
      .input(z.object({ projectId: idSchema }))
      .query(async ({ ctx, input }) => {
        await requireOwnedProject(input.projectId, ctx.user.id);
        return getProjectExports(input.projectId);
      }),
    create: protectedProcedure
      .input(
        z.object({
          projectId: idSchema,
          requestId: z.string().uuid(),
          resolution: z.enum(["720p", "1080p"]).default("720p"),
          format: z.literal("mp4").default("mp4"),
          includeCaptions: z.boolean().default(false),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await consumeRateLimit("export", ctx.user.id, 10, 60 * 60 * 1000);
        await requireOwnedProject(input.projectId, ctx.user.id);
        return startServerExport(
          input.projectId,
          ctx.user.id,
          input.resolution,
          {
            requestId: input.requestId,
            includeCaptions: input.includeCaptions,
          }
        );
      }),
    cancel: protectedProcedure
      .input(z.object({ id: idSchema }))
      .mutation(async ({ ctx, input }) => {
        const exportRow = await getExport(input.id);
        if (!exportRow)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Export not found",
          });
        await requireOwnedProject(exportRow.projectId, ctx.user.id);
        return { success: await cancelServerExport(input.id) };
      }),
    retry: protectedProcedure
      .input(z.object({ id: idSchema }))
      .mutation(async ({ ctx, input }) => {
        const exportRow = await getExport(input.id);
        if (!exportRow)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Export not found",
          });
        await requireOwnedProject(exportRow.projectId, ctx.user.id);
        if (exportRow.status !== "failed" && exportRow.status !== "cancelled") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Only failed or cancelled exports can be retried",
          });
        }
        await consumeRateLimit("export", ctx.user.id, 10, 60 * 60 * 1000);
        return startServerExport(
          exportRow.projectId,
          ctx.user.id,
          exportRow.resolution === "1080p" ? "1080p" : "720p",
          {
            requestId: randomUUID(),
            includeCaptions: exportRow.includeCaptions,
          }
        );
      }),
  }),

  /* ─── AI ─── */
  ai: router({
    /**
     * Health check — reports whether the AI provider is configured.
     * Never leaks the API key; only returns a boolean.
     */
    health: publicProcedure.query(() => {
      const available = getAIProvider().isAvailable();
      return {
        available,
        provider: available ? "nvidia-nim" : null,
        deterministicAvailable: true,
        verifiedActions: [
          "remove-opening-duration",
          "remove-browser-detected-silence",
          "split-at-playhead",
          "mute-or-unmute-selected-clips",
          "remove-selected-clips",
          "apply-supported-video-effect",
        ],
        unavailableCapabilities: [
          ...(transcriptionProviderAvailable()
            ? []
            : ["transcription", "caption-generation", "filler-word-detection"]),
        ],
        mediaIntelligence: {
          sceneDetection: "ffmpeg-scene-score",
          transcription: transcriptionProviderAvailable()
            ? "forge-whisper"
            : null,
        },
      };
    }),

    propose: protectedProcedure
      .input(aiEditRequestSchema)
      .mutation(async ({ ctx, input }) => {
        try {
          await consumeRateLimit(
            "ai-proposal",
            ctx.user.id,
            20,
            60 * 60 * 1000
          );
          return await proposeAIEdit(input, ctx.user.id);
        } catch (error) {
          throw aiError(error);
        }
      }),
    pending: protectedProcedure
      .input(z.object({ projectId: idSchema }))
      .query(async ({ ctx, input }) => {
        try {
          return await getPendingAIProposal(input.projectId, ctx.user.id);
        } catch (error) {
          throw aiError(error);
        }
      }),
    commit: protectedProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          selectedOperationIndices: z
            .array(z.number().int().min(0).max(49))
            .min(1)
            .max(50),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          await consumeRateLimit("ai-apply", ctx.user.id, 30, 60 * 60 * 1000);
          return await applyAIProposal(
            input.id,
            ctx.user.id,
            input.selectedOperationIndices
          );
        } catch (error) {
          throw aiError(error);
        }
      }),
    reject: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        try {
          return await rejectAIProposal(input.id, ctx.user.id);
        } catch (error) {
          throw aiError(error);
        }
      }),
    cancel: protectedProcedure
      .input(
        z.object({
          requestId: z.string().uuid(),
          proposalId: z.string().uuid().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const requestCancelled = cancelRunningAIRequest(
          ctx.user.id,
          input.requestId
        );
        if (input.proposalId) {
          try {
            await rejectAIProposal(input.proposalId, ctx.user.id, "cancelled");
          } catch (error) {
            throw aiError(error);
          }
        }
        return { success: true, requestCancelled };
      }),
  }),
});

export type AppRouter = typeof appRouter;
