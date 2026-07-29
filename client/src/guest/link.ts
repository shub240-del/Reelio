/**
 * A tRPC link that serves the app from IndexedDB when there is no backend.
 *
 * This is deliberately at the transport layer rather than in the pages. Every
 * screen already speaks tRPC, so intercepting here makes Guest Mode work across
 * the entire app without a single page changing, and keeps one code path for
 * both modes - the alternative, branching on `isGuest` in each component, is how
 * the two modes silently drift apart.
 */
import { TRPCClientError, httpBatchLink, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import type { AnyRouter } from "@trpc/server";
import { callGuestProcedure, hasGuestProcedure } from "./repo";

export type ReelioMode = "cloud" | "guest";

let resolvedMode: ReelioMode | null = null;
let probe: Promise<ReelioMode> | null = null;

const listeners = new Set<(mode: ReelioMode) => void>();

export function onModeResolved(fn: (mode: ReelioMode) => void): () => void {
  if (resolvedMode) fn(resolvedMode);
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Null until the probe finishes; components should treat that as "deciding". */
export function currentMode(): ReelioMode | null {
  return resolvedMode;
}

function settle(mode: ReelioMode): ReelioMode {
  resolvedMode = mode;
  try {
    localStorage.setItem("reelio-mode", mode);
  } catch {
    // Storage can be disabled; the mode is still held in memory.
  }
  for (const fn of listeners) fn(mode);
  return mode;
}

/**
 * Decides once per page load whether a backend is actually usable.
 *
 * We call auth.me rather than pinging a health route: a server can be up while
 * its database is unreachable, and that failure mode used to strand the user on
 * a login screen. What matters is whether a real session can be established, so
 * that is what we test. Any non-2xx, malformed body, or timeout means guest.
 */
async function detectMode(url: string): Promise<ReelioMode> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const query = encodeURIComponent(JSON.stringify({ 0: { json: null, meta: { values: ["undefined"] } } }));
    const res = await fetch(`${url}/auth.me?batch=1&input=${query}`, {
      credentials: "include",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
    });
    if (!res.ok) return settle("guest");
    // A proxy or SPA fallback can answer 200 with HTML; that is not a backend.
    const body = await res.text();
    try {
      JSON.parse(body);
    } catch {
      return settle("guest");
    }
    return settle("cloud");
  } catch {
    return settle("guest");
  } finally {
    clearTimeout(timer);
  }
}

export function ensureMode(url = "/api/trpc"): Promise<ReelioMode> {
  if (resolvedMode) return Promise.resolve(resolvedMode);
  probe ??= detectMode(url);
  return probe;
}

export interface HybridLinkOptions {
  url: string;
  /** The cloud link to delegate to when a backend is present. */
  cloud: ReturnType<typeof httpBatchLink>;
}

/**
 * Terminating link: resolves locally in guest mode, otherwise defers to the
 * cloud link. Falls back to guest if a cloud call fails outright, so losing the
 * network mid-session degrades to local editing instead of erroring.
 */
export function hybridLink<TRouter extends AnyRouter>(opts: HybridLinkOptions): TRPCLink<TRouter> {
  return (runtime) => {
    const cloud = opts.cloud(runtime);
    return ({ op, next }) =>
      observable((observer) => {
        let unsubscribe: (() => void) | undefined;
        let cancelled = false;

        const runLocal = async () => {
          try {
            const data = await callGuestProcedure(op.path, op.input);
            if (cancelled) return;
            observer.next({ result: { type: "data", data } });
            observer.complete();
          } catch (err) {
            if (cancelled) return;
            observer.error(TRPCClientError.from(err as Error));
          }
        };

        void (async () => {
          const mode = await ensureMode(opts.url);
          if (cancelled) return;

          if (mode === "guest") {
            if (!hasGuestProcedure(op.path)) {
              observer.error(
                TRPCClientError.from(
                  new Error(`"${op.path}" needs an account. Sign in to use this feature.`),
                ),
              );
              return;
            }
            await runLocal();
            return;
          }

          const sub = cloud({ op, next }).subscribe({
            next: (value) => observer.next(value),
            error: (err) => {
              // The backend was reachable at boot but this call failed. If the
              // operation exists locally, serve it rather than surfacing an
              // error - an editor that dies on a flaky request is unusable.
              if (hasGuestProcedure(op.path)) void runLocal();
              else observer.error(err);
            },
            complete: () => observer.complete(),
          });
          unsubscribe = () => sub.unsubscribe();
        })();

        return () => {
          cancelled = true;
          unsubscribe?.();
        };
      });
  };
}
