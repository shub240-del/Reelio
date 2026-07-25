import { describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type CookieCall = {
  name: string;
  options: Record<string, unknown>;
};

function createAuthContext(userOverrides: Partial<NonNullable<TrpcContext["user"]>> = {}): {
  ctx: TrpcContext;
  clearedCookies: CookieCall[];
} {
  const clearedCookies: CookieCall[] = [];

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

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: (name: string, options: Record<string, unknown>) => {
        clearedCookies.push({ name, options });
      },
    } as TrpcContext["res"],
  };

  return { ctx, clearedCookies };
}

describe("ownership validation", () => {
  it("asset.list returns FORBIDDEN for unauthorized project access", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    await expect(caller.asset.list({ projectId: 99999 })).rejects.toThrow();
  });

  it("clip.list returns FORBIDDEN for unauthorized project access", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    await expect(caller.clip.list({ projectId: 99999 })).rejects.toThrow();
  });

  it("project.get returns FORBIDDEN for unauthorized project", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    await expect(caller.project.get({ id: 99999 })).rejects.toThrow();
  });

  it("clip.delete returns FORBIDDEN for unauthorized clip access", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    await expect(caller.clip.delete({ id: 99999 })).rejects.toThrow();
  });
});
