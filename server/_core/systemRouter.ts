import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router } from "./trpc";
import { ENV } from "./env";
import { getAIProvider } from "./nvidia";
import { checkDatabaseConnection } from "../db";
import { checkFfmpegAvailable } from "../renderExport";
import { checkCoordinationConnection } from "../coordination";

export async function getReadinessStatus() {
  const checks = {
    databaseConfigured: Boolean(ENV.databaseUrl),
    databaseReachable: false,
    coordinationConfigured: Boolean(ENV.redisUrl),
    coordinationReachable: false,
    oauthConfigured: Boolean(
      ENV.appId && ENV.oAuthServerUrl && ENV.cookieSecret.length >= 32
    ),
    storageConfigured: Boolean(ENV.forgeApiUrl && ENV.forgeApiKey),
    aiProviderConfigured: getAIProvider().isAvailable(),
    ffmpegAvailable: false,
  };
  checks.databaseReachable = checks.databaseConfigured
    ? await checkDatabaseConnection()
    : false;
  checks.coordinationReachable = checks.coordinationConfigured
    ? await checkCoordinationConnection()
    : false;
  checks.ffmpegAvailable = await checkFfmpegAvailable();
  return {
    ready: Object.values(checks).every(Boolean),
    checks,
  };
}

export const systemRouter = router({
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(() => ({
      ok: true,
      service: "reelio",
    })),

  readiness: publicProcedure.query(() => getReadinessStatus()),

  notifyOwner: adminProcedure
    .input(
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      })
    )
    .mutation(async ({ input }) => {
      const delivered = await notifyOwner(input);
      return {
        success: delivered,
      } as const;
    }),
});
