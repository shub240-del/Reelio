/**
 * Guest Mode implementation of the tRPC procedure surface.
 *
 * Every handler here mirrors the shape of its server counterpart in
 * server/routers.ts, so the existing pages work unchanged whether they are
 * talking to MySQL over HTTP or to IndexedDB in the same tab. Where the server
 * returns a Drizzle row, we return the same fields with the same types.
 *
 * Clip geometry is delegated to shared/timeline.ts rather than reimplemented:
 * trim/split semantics must be identical in both modes or a project would edit
 * differently depending on whether the user happened to be signed in.
 */
import { clampClipToAsset, type TimelineClip } from "@shared/timeline";
import { probeMedia } from "@/editor/media";
import { blobUrl, del, delAllBy, get, getAllBy, getAll, getBlob, put, putBlob, revokeBlobUrl } from "./db";

export interface GuestUser {
  id: number;
  openId: string;
  name: string;
  email: string | null;
  loginMethod: string;
  role: "user" | "admin";
  createdAt: Date;
  updatedAt: Date;
  lastSignedIn: Date;
  isGuest: true;
}

export interface GuestProject {
  id: number;
  userId: number;
  name: string;
  description: string | null;
  status: "draft" | "editing" | "exporting" | "done";
  createdAt: Date;
  updatedAt: Date;
}

export interface GuestAsset {
  id: number;
  projectId: number;
  userId: number;
  name: string;
  storageKey: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  thumbnailKey: string | null;
  thumbnailUrl: string | null;
  createdAt: Date;
}

export interface GuestClip {
  id: number;
  projectId: number;
  assetId: number;
  trackId: number;
  trackType: "video" | "audio";
  sourceStart: number;
  duration: number;
  timelineStart: number;
  sortIndex: number;
  locked: boolean;
  visible: boolean;
  muted: boolean;
  createdAt: Date;
}

const GUEST_USER_ID = 1;

export const guestUser: GuestUser = {
  id: GUEST_USER_ID,
  openId: "guest-local",
  name: "Guest",
  email: null,
  loginMethod: "guest",
  role: "user",
  createdAt: new Date(0),
  updatedAt: new Date(0),
  lastSignedIn: new Date(),
  isGuest: true,
};

const now = () => new Date();

function notFound(what: string): never {
  throw new Error(`${what} not found`);
}

/* ────────────────────────── projects ────────────────────────── */

async function projectCreate(input: { name: string; description?: string }): Promise<GuestProject> {
  const row: Omit<GuestProject, "id"> & { id?: number } = {
    userId: GUEST_USER_ID,
    name: input.name,
    description: input.description ?? null,
    status: "draft",
    createdAt: now(),
    updatedAt: now(),
  };
  await put("projects", row);
  return row as GuestProject;
}

async function projectList(): Promise<GuestProject[]> {
  const rows = await getAll<GuestProject>("projects");
  // Newest first, matching the server's ordering.
  return rows.sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
}

async function projectGet(input: { id: number }): Promise<GuestProject> {
  return (await get<GuestProject>("projects", input.id)) ?? notFound("Project");
}

async function projectUpdate(input: { id: number; name?: string; status?: string; description?: string }): Promise<GuestProject> {
  const row = (await get<GuestProject>("projects", input.id)) ?? notFound("Project");
  if (input.name !== undefined) row.name = input.name;
  if (input.status !== undefined) row.status = input.status as GuestProject["status"];
  if (input.description !== undefined) row.description = input.description || null;
  row.updatedAt = now();
  await put("projects", row);
  return row;
}

async function projectDuplicate(input: { id: number; name?: string }): Promise<GuestProject> {
  const source = (await get<GuestProject>("projects", input.id)) ?? notFound("Project");
  const copy = await projectCreate({
    name: input.name?.trim() || `${source.name} Copy`,
    description: source.description ?? undefined,
  });
  const assets = await getAllBy<GuestAsset>("assets", "projectId", source.id);
  const assetIdMap = new Map<number, number>();
  for (const asset of assets) {
    const nextKey = `guest/${copy.id}/${Date.now()}-${asset.name}`;
    const blob = await getBlob(asset.storageKey);
    if (blob) await putBlob(nextKey, blob);
    const cloned: Omit<GuestAsset, "id"> & { id?: number } = {
      ...asset,
      id: undefined,
      projectId: copy.id,
      storageKey: blob ? nextKey : asset.storageKey,
      url: blob ? `guest-blob:${nextKey}` : asset.url,
      createdAt: now(),
    };
    await put("assets", cloned);
    assetIdMap.set(asset.id, cloned.id!);
  }
  const clips = await getAllBy<GuestClip>("clips", "projectId", source.id);
  for (const clip of clips) {
    const cloned: Omit<GuestClip, "id"> & { id?: number } = {
      ...clip,
      id: undefined,
      projectId: copy.id,
      assetId: assetIdMap.get(clip.assetId) ?? clip.assetId,
      createdAt: now(),
    };
    await put("clips", cloned);
  }
  return copy;
}

async function projectDelete(input: { id: number }): Promise<{ success: true }> {
  // Cascade by hand: IndexedDB has no foreign keys. Remove media bytes too so
  // deleting a project does not leave orphaned blobs consuming local quota.
  const assets = await getAllBy<GuestAsset>("assets", "projectId", input.id);
  await delAllBy("clips", "projectId", input.id);
  for (const asset of assets) {
    revokeBlobUrl(asset.storageKey);
    await del("blobs", asset.storageKey);
  }
  await delAllBy("assets", "projectId", input.id);
  await del("projects", input.id);
  return { success: true };
}

/* ────────────────────────── assets ────────────────────────── */

/**
 * Swaps the stored `guest-blob:` marker for a real object URL.
 *
 * The row cannot hold a blob: URL because those die with the page, so playback
 * resolves one on read instead. blobUrl caches per key, which matters: handing
 * <video> a fresh URL on every query would reload the element and restart
 * playback on each refetch.
 */
async function withPlayableUrl(row: GuestAsset): Promise<GuestAsset> {
  if (!row.url.startsWith("guest-blob:")) return row;
  const url = await blobUrl(row.storageKey);
  return { ...row, url: url ?? "" };
}

async function assetList(input: { projectId: number }): Promise<GuestAsset[]> {
  const rows = await getAllBy<GuestAsset>("assets", "projectId", input.projectId);
  return Promise.all(rows.sort((a, b) => a.id - b.id).map(withPlayableUrl));
}

/** Decodes a base64 payload without blowing the call stack on large files. */
function base64ToBlob(base64: string, mimeType: string): Blob {
  const clean = base64.includes(",") ? base64.slice(base64.indexOf(",") + 1) : base64;
  const binary = atob(clean);
  const CHUNK = 32 * 1024;
  const parts: Uint8Array[] = [];
  for (let offset = 0; offset < binary.length; offset += CHUNK) {
    const slice = binary.slice(offset, offset + CHUNK);
    const bytes = new Uint8Array(slice.length);
    for (let i = 0; i < slice.length; i += 1) bytes[i] = slice.charCodeAt(i);
    parts.push(bytes);
  }
  return new Blob(parts as BlobPart[], { type: mimeType });
}

export interface AssetUploadInput {
  projectId: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  base64Data?: string;
  /** Preferred path: hand us the File directly and skip base64 entirely. */
  blob?: Blob;
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
  hasAudio?: boolean;
}

async function assetUpload(input: AssetUploadInput): Promise<GuestAsset> {
  const blob = input.blob ?? (input.base64Data ? base64ToBlob(input.base64Data, input.mimeType) : null);
  if (!blob) throw new Error("No media payload supplied");

  const storageKey = `guest/${input.projectId}/${Date.now()}-${input.fileName}`;
  await putBlob(storageKey, blob);

  // Measure the media in the browser when the caller did not.
  //
  // The upload call carries no metadata, and the server's fallback is a partial
  // MP4 box parser with fps hardcoded to 30 that reports 0 for MOV and WebM. A
  // duration of 0 makes the clip zero-length, so the timeline looks empty after
  // a successful import. Decoding the real file is both more accurate and the
  // only option that works offline.
  let probed: Partial<Pick<GuestAsset, "duration" | "width" | "height" | "fps" | "hasAudio">> = {};
  if (input.duration === undefined || input.duration <= 0) {
    try {
      const probe = await probeMedia(new File([blob], input.fileName, { type: input.mimeType }));
      probed = {
        duration: probe.duration,
        width: probe.width,
        height: probe.height,
        fps: probe.fps,
        hasAudio: probe.hasAudio,
      };
    } catch {
      // Undecodable media still imports; it simply lands with zeroed metadata
      // rather than failing the whole upload.
      probed = {};
    }
  }

  const row: Omit<GuestAsset, "id"> & { id?: number } = {
    projectId: input.projectId,
    userId: GUEST_USER_ID,
    name: input.fileName,
    storageKey,
    // Resolved to an object URL on read; the row itself must stay serialisable.
    url: `guest-blob:${storageKey}`,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes || blob.size,
    // Browser-measured metadata is authoritative. Callers that have probed the
    // media pass it in; anything missing stays 0 rather than being invented.
    duration: input.duration ?? probed.duration ?? 0,
    width: input.width ?? probed.width ?? 0,
    height: input.height ?? probed.height ?? 0,
    fps: input.fps ?? probed.fps ?? 0,
    hasAudio: input.hasAudio ?? probed.hasAudio ?? false,
    thumbnailKey: null,
    thumbnailUrl: null,
    createdAt: now(),
  };
  await put("assets", row);
  return withPlayableUrl(row as GuestAsset);
}

async function assetUpdate(input: {
  id: number;
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
  hasAudio?: boolean;
}): Promise<GuestAsset> {
  const row = (await get<GuestAsset>("assets", input.id)) ?? notFound("Asset");
  for (const field of ["duration", "width", "height", "fps", "hasAudio"] as const) {
    const value = input[field];
    if (value !== undefined) (row as unknown as Record<string, unknown>)[field] = value;
  }
  await put("assets", row);
  return withPlayableUrl(row);
}

async function assetDelete(input: { id: number }): Promise<{ success: true }> {
  const asset = await get<GuestAsset>("assets", input.id);
  await delAllBy("clips", "assetId", input.id);
  if (asset) {
    revokeBlobUrl(asset.storageKey);
    await del("blobs", asset.storageKey);
  }
  await del("assets", input.id);
  return { success: true };
}

/* ────────────────────────── clips ────────────────────────── */

async function clipList(input: { projectId: number }): Promise<GuestClip[]> {
  const rows = await getAllBy<GuestClip>("clips", "projectId", input.projectId);
  return rows.sort((a, b) => a.sortIndex - b.sortIndex || a.timelineStart - b.timelineStart);
}

async function clipCreate(input: {
  projectId: number;
  assetId: number;
  trackId?: number;
  trackType?: "video" | "audio";
  sourceStart: number;
  duration: number;
  timelineStart: number;
  sortIndex?: number;
  /**
   * Undo restores a deleted clip by re-creating it. Without the ability to ask
   * for the original id, the restored clip would get a fresh one and the redo
   * that follows would target a row that no longer exists. IndexedDB honours an
   * explicit key on put even for autoIncrement stores, so history can round-trip
   * exactly. Normal creates leave these unset.
   */
  id?: number;
  locked?: boolean;
  visible?: boolean;
  muted?: boolean;
}): Promise<GuestClip> {
  const existing = await clipList({ projectId: input.projectId });
  const row: Omit<GuestClip, "id"> & { id?: number } = {
    projectId: input.projectId,
    assetId: input.assetId,
    trackId: input.trackId ?? 0,
    trackType: input.trackType ?? "video",
    sourceStart: input.sourceStart,
    duration: input.duration,
    timelineStart: input.timelineStart,
    sortIndex: input.sortIndex ?? existing.length,
    locked: input.locked ?? false,
    visible: input.visible ?? true,
    muted: input.muted ?? false,
    createdAt: now(),
  };
  if (input.id !== undefined) row.id = input.id;
  await put("clips", row);
  return row as GuestClip;
}

async function clipUpdate(input: {
  id: number;
  sourceStart?: number;
  duration?: number;
  timelineStart?: number;
  sortIndex?: number;
  locked?: boolean;
  visible?: boolean;
  muted?: boolean;
  trackId?: number;
}): Promise<GuestClip> {
  const row = (await get<GuestClip>("clips", input.id)) ?? notFound("Clip");
  const fields = [
    "sourceStart",
    "duration",
    "timelineStart",
    "sortIndex",
    "locked",
    "visible",
    "muted",
    "trackId",
  ] as const;
  for (const field of fields) {
    const value = input[field];
    if (value !== undefined) (row as unknown as Record<string, unknown>)[field] = value;
  }
  await put("clips", row);
  return row;
}

async function clipDelete(input: { id: number }): Promise<{ success: true }> {
  await del("clips", input.id);
  return { success: true };
}

/** Shapes a stored clip for the shared timeline engine. */
function toTimelineClip(row: GuestClip): TimelineClip {
  return {
    id: row.id,
    assetId: row.assetId,
    trackId: row.trackId,
    trackType: row.trackType,
    sourceStart: row.sourceStart,
    duration: row.duration,
    timelineStart: row.timelineStart,
    sortIndex: row.sortIndex,
    locked: row.locked,
    visible: row.visible,
    muted: row.muted,
  };
}

/**
 * Returns { success: true } like the server does, rather than the row, so a page
 * cannot come to depend on a richer response in Guest Mode and then break when
 * it is signed in.
 */
async function clipTrim(input: {
  id: number;
  sourceStart: number;
  duration: number;
}): Promise<{ success: true }> {
  const row = (await get<GuestClip>("clips", input.id)) ?? notFound("Clip");
  if (row.locked) throw new Error("Clip is locked");
  const asset = await get<GuestAsset>("assets", row.assetId);

  const requested = { ...toTimelineClip(row), sourceStart: input.sourceStart, duration: input.duration };
  // The server writes trim values through unchecked, which lets a drag past the
  // end of the footage persist a clip that plays black. Clamp against the real
  // media instead; a trim that collapses the clip is rejected outright.
  const clamped = asset
    ? clampClipToAsset(requested, {
        id: asset.id,
        duration: asset.duration,
        hasAudio: asset.hasAudio,
        width: asset.width,
        height: asset.height,
        fps: asset.fps,
      })
    : requested;
  if (!clamped) throw new Error("Trim would leave an empty clip");

  row.sourceStart = clamped.sourceStart;
  row.duration = clamped.duration;
  await put("clips", row);
  return { success: true };
}

/** `splitAt` is an offset in seconds from the clip's start, as on the server. */
async function clipSplit(input: {
  id: number;
  splitAt: number;
  projectId: number;
}): Promise<{ success: true; newClipId: number }> {
  const row = (await get<GuestClip>("clips", input.id)) ?? notFound("Clip");
  if (row.locked) throw new Error("Clip is locked");

  const firstDuration = input.splitAt;
  const secondDuration = row.duration - input.splitAt;
  // Guard the degenerate cut the server allows: splitting at 0 or at the very
  // end produced a zero-length clip that rendered as an invisible timeline item.
  if (firstDuration <= 0 || secondDuration <= 0) {
    throw new Error("Split point is outside the clip");
  }

  // Everything after this clip shifts down one slot first, so the new right half
  // has a free sortIndex and ordering stays dense.
  const siblings = await clipList({ projectId: input.projectId });
  for (const sibling of siblings) {
    if (sibling.id !== row.id && sibling.sortIndex > row.sortIndex) {
      sibling.sortIndex += 1;
      await put("clips", sibling);
    }
  }

  const rightRow: Omit<GuestClip, "id"> & { id?: number } = {
    projectId: input.projectId,
    assetId: row.assetId,
    trackId: row.trackId,
    trackType: row.trackType,
    sourceStart: row.sourceStart + input.splitAt,
    duration: secondDuration,
    timelineStart: row.timelineStart + firstDuration,
    sortIndex: row.sortIndex + 1,
    locked: row.locked,
    visible: row.visible,
    muted: row.muted,
    createdAt: now(),
  };
  await put("clips", rightRow);

  row.duration = firstDuration;
  await put("clips", row);

  return { success: true, newClipId: (rightRow as GuestClip).id };
}

/* ────────────────────────── dispatch ────────────────────────── */

type Handler = (input: any) => Promise<unknown>;

/**
 * Procedure path -> local handler. Paths match server/routers.ts exactly; an
 * unlisted path throws rather than silently resolving to undefined, so a page
 * calling something Guest Mode cannot do fails loudly instead of rendering
 * empty state that looks like real data.
 */
export const guestProcedures: Record<string, Handler> = {
  "auth.me": async () => guestUser,
  "auth.logout": async () => ({ success: true }),

  "project.create": projectCreate,
  "project.list": projectList,
  "project.get": projectGet,
  "project.update": projectUpdate,
  "project.duplicate": projectDuplicate,
  "project.delete": projectDelete,

  "asset.list": assetList,
  "asset.upload": assetUpload,
  "asset.update": assetUpdate,
  "asset.delete": assetDelete,

  "clip.list": clipList,
  "clip.create": clipCreate,
  "clip.update": clipUpdate,
  "clip.delete": clipDelete,
  "clip.trim": clipTrim,
  "clip.split": clipSplit,

  // Features with no local implementation yet still need to resolve, or the
  // editor would surface an error banner for data it merely has none of.
  "marker.list": async () => [],
  "caption.list": async () => [],
  "export.list": async () => [],

  // AI health — in guest mode the AI provider is always unavailable
  // (NVIDIA_API_KEY lives on the server only)
  "ai.health": async () => ({ available: false, provider: null }),
};

export function hasGuestProcedure(path: string): boolean {
  return path in guestProcedures;
}

export async function callGuestProcedure(path: string, input: unknown): Promise<unknown> {
  const handler = guestProcedures[path];
  if (!handler) throw new Error(`Guest Mode does not implement "${path}"`);
  return handler(input ?? {});
}
