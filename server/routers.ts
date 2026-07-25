import { COOKIE_NAME } from "@shared/const";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  createAsset,
  createCaption,
  createClip,
  createExport,
  createMarker,
  createProject,
  deleteClip,
  deleteMarker,
  deleteProject,
  getAsset,
  getAssetCaptions,
  getClip,
  getProject,
  getProjectAssets,
  getProjectCaptions,
  getProjectClips,
  getProjectExports,
  getProjectMarkers,
  getUserProjects,
  updateClip,
  updateExport,
  updateProject,
} from "./db";
import { storagePut } from "./storage";
import { extractVideoMetadata, isVideoFile } from "./videoMetadata";

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  /* ─── Projects ─── */
  project: router({
    create: protectedProcedure
      .input(z.object({ name: z.string().min(1), description: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        return createProject(ctx.user.id, input.name, input.description);
      }),
    list: protectedProcedure.query(async ({ ctx }) => {
      return getUserProjects(ctx.user.id);
    }),
    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const project = await getProject(input.id, ctx.user.id);
        if (!project) throw new TRPCError({ code: "FORBIDDEN", message: "Unauthorized: project does not belong to this user" });
        return project;
      }),
    update: protectedProcedure
      .input(z.object({ id: z.number(), name: z.string().optional(), status: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        await updateProject(input.id, ctx.user.id, input.name, input.status);
        return { success: true };
      }),
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await deleteProject(input.id, ctx.user.id);
        return { success: true };
      }),
  }),

  /* ─── Assets ─── */
  asset: router({
    list: protectedProcedure
      .input(z.object({ projectId: z.number() }))
      .query(async ({ ctx, input }) => {
        // Verify project ownership
        const project = await getProject(input.projectId, ctx.user.id);
        if (!project) throw new TRPCError({ code: "FORBIDDEN", message: "Unauthorized: project does not belong to this user" });
        return getProjectAssets(input.projectId);
      }),
    upload: protectedProcedure
      .input(z.object({
        projectId: z.number(),
        base64Data: z.string(),
        fileName: z.string(),
        mimeType: z.string(),
        sizeBytes: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        const userId = ctx.user.id;
        // Verify project ownership before uploading
        const project = await getProject(input.projectId, userId);
        if (!project) throw new TRPCError({ code: "FORBIDDEN", message: "Unauthorized: project does not belong to this user" });

        const buffer = Buffer.from(input.base64Data, "base64");
        const storageKey = `${userId}/projects/${input.projectId}/assets/${input.fileName}`;
        const { key, url } = await storagePut(storageKey, buffer, input.mimeType);

        // Extract video metadata for video files
        let duration = 0, width = 0, height = 0, fps = 30, hasAudio = false;
        if (isVideoFile(input.mimeType)) {
          try {
            const meta = extractVideoMetadata(buffer);
            duration = meta.duration;
            width = meta.width;
            height = meta.height;
            fps = meta.fps || 30;
            hasAudio = meta.hasAudio;
          } catch {
            // Metadata extraction failed, use defaults
          }
        }

        const asset = await createAsset({
          projectId: input.projectId,
          userId,
          name: input.fileName,
          storageKey: key,
          url,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          duration,
          width,
          height,
          fps,
          hasAudio,
        });

        return asset;
      }),
  }),

  /* ─── Clips ─── */
  clip: router({
    list: protectedProcedure
      .input(z.object({ projectId: z.number() }))
      .query(async ({ ctx, input }) => {
        const project = await getProject(input.projectId, ctx.user.id);
        if (!project) throw new TRPCError({ code: "FORBIDDEN", message: "Unauthorized: project does not belong to this user" });
        return getProjectClips(input.projectId);
      }),
    create: protectedProcedure
      .input(z.object({
        projectId: z.number(),
        assetId: z.number(),
        trackId: z.number().default(0),
        trackType: z.enum(["video", "audio"]).default("video"),
        sourceStart: z.number(),
        duration: z.number(),
        timelineStart: z.number(),
        sortIndex: z.number().default(0),
      }))
      .mutation(async ({ ctx, input }) => {
        // Verify project ownership
        const project = await getProject(input.projectId, ctx.user.id);
        if (!project) throw new TRPCError({ code: "FORBIDDEN", message: "Unauthorized: project does not belong to this user" });
        // Verify asset ownership - must belong to the same project and user
        const asset = await getAsset(input.assetId);
        if (!asset) throw new TRPCError({ code: "NOT_FOUND", message: "Asset not found" });
        if (asset.projectId !== input.projectId || asset.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Unauthorized: asset does not belong to this project" });
        }
        return createClip(input);
      }),
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        sourceStart: z.number().optional(),
        duration: z.number().optional(),
        timelineStart: z.number().optional(),
        sortIndex: z.number().optional(),
        trackId: z.number().optional(),
        trackType: z.enum(["video", "audio"]).optional(),
        locked: z.boolean().optional(),
        visible: z.boolean().optional(),
        muted: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { id, ...updates } = input;
        const clip = await getClip(id);
        if (!clip) throw new TRPCError({ code: "NOT_FOUND", message: "Clip not found" });
        const project = await getProject(clip.projectId, ctx.user.id);
        if (!project) throw new TRPCError({ code: "FORBIDDEN", message: "Unauthorized: clip does not belong to this user" });
        await updateClip(id, updates);
        return { success: true };
      }),
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await deleteClip(input.id, ctx.user.id);
        return { success: true };
      }),
    trim: protectedProcedure
      .input(z.object({
        id: z.number(),
        sourceStart: z.number(),
        duration: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        const clip = await getClip(input.id);
        if (!clip) throw new TRPCError({ code: "NOT_FOUND", message: "Clip not found" });
        const project = await getProject(clip.projectId, ctx.user.id);
        if (!project) throw new TRPCError({ code: "FORBIDDEN", message: "Unauthorized: clip does not belong to this user" });
        await updateClip(input.id, {
          sourceStart: input.sourceStart,
          duration: input.duration,
        });
        return { success: true };
      }),
    split: protectedProcedure
      .input(z.object({
        id: z.number(),
        splitAt: z.number(), // relative to sourceStart
        projectId: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        // Verify project ownership
        const project = await getProject(input.projectId, ctx.user.id);
        if (!project) throw new TRPCError({ code: "FORBIDDEN", message: "Unauthorized: project does not belong to this user" });
        const clip = (await getProjectClips(input.projectId)).find((c) => c.id === input.id);
        if (!clip) throw new TRPCError({ code: "NOT_FOUND", message: "Clip not found" });

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
        });

        return { success: true, newClipId: newClip?.id };
      }),
  }),

  /* ─── Markers ─── */
  marker: router({
    list: protectedProcedure
      .input(z.object({ projectId: z.number() }))
      .query(async ({ input }) => {
        return getProjectMarkers(input.projectId);
      }),
    create: protectedProcedure
      .input(z.object({
        projectId: z.number(),
        time: z.number(),
        label: z.string().optional(),
        color: z.string().default("#f97316"),
      }))
      .mutation(async ({ input }) => {
        return createMarker(input);
      }),
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await deleteMarker(input.id);
        return { success: true };
      }),
  }),

  /* ─── Captions ─── */
  caption: router({
    list: protectedProcedure
      .input(z.object({ projectId: z.number() }))
      .query(async ({ input }) => {
        return getProjectCaptions(input.projectId);
      }),
    getByAsset: protectedProcedure
      .input(z.object({ assetId: z.number() }))
      .query(async ({ input }) => {
        return getAssetCaptions(input.assetId);
      }),
    create: protectedProcedure
      .input(z.object({
        projectId: z.number(),
        assetId: z.number(),
        text: z.string(),
        startTime: z.number(),
        endTime: z.number(),
      }))
      .mutation(async ({ input }) => {
        return createCaption(input);
      }),
  }),

  /* ─── Exports ─── */
  export: router({
    list: protectedProcedure
      .input(z.object({ projectId: z.number() }))
      .query(async ({ input }) => {
        return getProjectExports(input.projectId);
      }),
    create: protectedProcedure
      .input(z.object({
        projectId: z.number(),
        resolution: z.string(),
        format: z.string().default("mp4"),
      }))
      .mutation(async ({ ctx, input }) => {
        // Export creation placeholder - real rendering in Phase 7
        const exportRow = await createExport({
          projectId: input.projectId,
          userId: ctx.user.id,
          storageKey: "",
          url: "",
          resolution: input.resolution,
          format: input.format,
          duration: 0,
          status: "processing",
        });
        return exportRow;
      }),
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        status: z.string().optional(),
        errorMessage: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        await updateExport(input.id, input);
        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
