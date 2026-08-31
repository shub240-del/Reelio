export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  // NVIDIA NIM — accessed only in server/_core/nvidia.ts via process.env directly
  // Do NOT add this to VITE_* or expose it to the browser.
};

/**
 * Production must fail closed. Falling back to an in-memory database or a
 * development identity in production makes successful requests look durable
 * and authenticated when they are neither.
 */
export function assertServerConfiguration(): void {
  if (!ENV.isProduction) return;

  const missing: string[] = [];
  if (!ENV.databaseUrl) missing.push("DATABASE_URL");
  if (!ENV.appId) missing.push("VITE_APP_ID");
  if (!ENV.oAuthServerUrl) missing.push("OAUTH_SERVER_URL");
  if (ENV.cookieSecret.length < 32) missing.push("JWT_SECRET (at least 32 characters)");
  if (!ENV.forgeApiUrl) missing.push("BUILT_IN_FORGE_API_URL");
  if (!ENV.forgeApiKey) missing.push("BUILT_IN_FORGE_API_KEY");

  if (missing.length > 0) {
    throw new Error(`Production configuration is incomplete: ${missing.join(", ")}`);
  }
}

