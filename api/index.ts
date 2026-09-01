import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../server/routers";
import { createContext } from "../server/_core/context";
import { registerOAuthRoutes } from "../server/_core/oauth";
import { registerStorageProxy } from "../server/_core/storageProxy";
import { assertServerConfiguration } from "../server/_core/env";
import { getReadinessStatus } from "../server/_core/systemRouter";

assertServerConfiguration();
const app = express();

app.use(express.json({ limit: "70mb" }));
app.use(express.urlencoded({ limit: "70mb", extended: true }));

registerStorageProxy(app);
registerOAuthRoutes(app);
app.get("/healthz", (_req, res) => res.json({ ok: true, service: "reelio" }));
app.get("/readyz", async (_req, res) => {
  const readiness = await getReadinessStatus();
  res.status(readiness.ready ? 200 : 503).json(readiness);
});

app.use(
  "/api/trpc",
  createExpressMiddleware({
    router: appRouter,
    createContext,
  })
);

export default app;
