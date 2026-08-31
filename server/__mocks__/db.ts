/**
 * In-memory mock for server/db.ts.
 *
 * Used by Vitest when DATABASE_URL is absent so the server-side router tests
 * can run without a live MySQL instance. The interface mirrors the real module
 * exactly — any mismatch will surface as a TypeScript error on `import type`.
 *
 * Data is stored in plain JS arrays that are reset between test files via the
 * afterEach block exported at the bottom of this file. Each table is a Map
 * keyed by auto-increment id.
 */

import type {
  InsertAsset,
  InsertCaption,
  InsertClip,
  InsertExport,
  InsertMarker,
  InsertUser,
  Asset,
  Caption,
  Clip,
  ExportRow,
  Marker,
  User,
  Project,
} from "../../drizzle/schema";

/* ─── In-memory stores ─── */

let nextId = 1;
const autoId = () => nextId++;

const store = {
  users: new Map<number, User>(),
  projects: new Map<number, Project>(),
  assets: new Map<number, Asset>(),
  clips: new Map<number, Clip>(),
  markers: new Map<number, Marker>(),
  captions: new Map<number, Caption>(),
  exports: new Map<number, ExportRow>(),
};

/** Reset all in-memory tables between tests. Call from beforeEach/afterEach. */
export function resetStore() {
  nextId = 1;
  for (const table of Object.values(store)) table.clear();
}

/* ─── getDb (unused in mock — routers call the named helpers) ─── */
export async function getDb() {
  return null;
}

/* ─── User helpers ─── */

export async function upsertUser(user: InsertUser): Promise<void> {
  const existing = [...store.users.values()].find((u) => u.openId === user.openId);
  if (existing) {
    Object.assign(existing, user);
  } else {
    const id = autoId();
    store.users.set(id, {
      id,
      openId: user.openId,
      name: user.name ?? null,
      email: user.email ?? null,
      loginMethod: user.loginMethod ?? null,
      role: (user.role ?? "user") as "user" | "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: user.lastSignedIn ?? new Date(),
    });
  }
}

export async function getUserByOpenId(openId: string): Promise<User | undefined> {
  return [...store.users.values()].find((u) => u.openId === openId);
}

/* ─── Project helpers ─── */

export async function createProject(
  userId: number,
  name: string,
  description?: string | null,
): Promise<Project> {
  const id = autoId();
  const row: Project = {
    id,
    userId,
    name,
    description: description ?? null,
    status: "draft",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  store.projects.set(id, row);
  return row;
}

export async function getUserProjects(userId: number): Promise<Project[]> {
  return [...store.projects.values()]
    .filter((p) => p.userId === userId)
    .sort((a, b) => +b.updatedAt - +a.updatedAt);
}

export async function getProject(id: number, userId: number): Promise<Project | undefined> {
  const p = store.projects.get(id);
  return p && p.userId === userId ? p : undefined;
}

export async function updateProject(
  id: number,
  userId: number,
  name?: string,
  status?: string,
  description?: string,
): Promise<void> {
  const row = store.projects.get(id);
  if (!row || row.userId !== userId) return;
  if (name !== undefined) row.name = name;
  if (status !== undefined) row.status = status as Project["status"];
  if (description !== undefined) row.description = description;
  row.updatedAt = new Date();
}

export async function duplicateProject(
  id: number,
  userId: number,
  name?: string,
): Promise<Project | undefined> {
  const source = await getProject(id, userId);
  if (!source) return undefined;
  const copy = await createProject(userId, name ?? `${source.name} Copy`, source.description ?? undefined);
  const assetIds = new Map<number, number>();
  for (const asset of await getProjectAssets(id)) {
    const cloned = await createAsset({ ...asset, id: undefined, projectId: copy.id } as unknown as InsertAsset);
    assetIds.set(asset.id, cloned.id);
  }
  for (const clip of await getProjectClips(id)) {
    await createClip({ ...clip, id: undefined, projectId: copy.id, assetId: assetIds.get(clip.assetId) ?? clip.assetId } as unknown as InsertClip);
  }
  for (const marker of await getProjectMarkers(id)) {
    await createMarker({ ...marker, id: undefined, projectId: copy.id } as unknown as InsertMarker);
  }
  for (const caption of await getProjectCaptions(id)) {
    await createCaption({ ...caption, id: undefined, projectId: copy.id, assetId: assetIds.get(caption.assetId) ?? caption.assetId } as unknown as InsertCaption);
  }
  return copy;
}

export async function deleteProject(id: number, userId: number): Promise<void> {
  const row = store.projects.get(id);
  if (!row || row.userId !== userId) throw new Error("Project not found or unauthorized");
  for (const table of [store.assets, store.clips, store.markers, store.captions, store.exports]) {
    for (const [rowId, value] of table as Map<number, { projectId: number }>) {
      if (value.projectId === id) table.delete(rowId);
    }
  }
  store.projects.delete(id);
}

/* ─── Asset helpers ─── */

export async function createAsset(data: InsertAsset): Promise<Asset> {
  const id = autoId();
  const row: Asset = {
    id,
    projectId: data.projectId,
    userId: data.userId,
    name: data.name,
    storageKey: data.storageKey,
    url: data.url,
    mimeType: data.mimeType,
    sizeBytes: data.sizeBytes,
    duration: data.duration ?? 0,
    width: data.width ?? 0,
    height: data.height ?? 0,
    fps: data.fps ?? 0,
    hasAudio: data.hasAudio ?? false,
    thumbnailKey: data.thumbnailKey ?? null,
    thumbnailUrl: data.thumbnailUrl ?? null,
    createdAt: new Date(),
  };
  store.assets.set(id, row);
  return row;
}

export async function getProjectAssets(projectId: number): Promise<Asset[]> {
  return [...store.assets.values()]
    .filter((a) => a.projectId === projectId)
    .sort((a, b) => +a.createdAt - +b.createdAt);
}

export async function getAsset(id: number): Promise<Asset | undefined> {
  return store.assets.get(id);
}

export async function isStorageKeyReferenced(storageKey: string): Promise<boolean> {
  return [...store.assets.values()].some((asset) => asset.storageKey === storageKey);
}

export async function deleteAsset(id: number, userId: number): Promise<void> {
  const asset = store.assets.get(id);
  if (!asset) throw new Error("Asset not found");
  const project = store.projects.get(asset.projectId);
  if (!project || project.userId !== userId)
    throw new Error("Unauthorized: asset does not belong to this user");
  // Cascade clips
  for (const [cid, clip] of store.clips) {
    if (clip.assetId === id) store.clips.delete(cid);
  }
  for (const [captionId, caption] of store.captions) {
    if (caption.assetId === id) store.captions.delete(captionId);
  }
  store.assets.delete(id);
}

/* ─── Clip helpers ─── */

export async function createClip(data: InsertClip): Promise<Clip> {
  const id = autoId();
  const row: Clip = {
    id,
    projectId: data.projectId,
    assetId: data.assetId,
    trackId: data.trackId ?? 0,
    trackType: (data.trackType ?? "video") as "video" | "audio",
    sourceStart: data.sourceStart,
    duration: data.duration,
    timelineStart: data.timelineStart,
    sortIndex: data.sortIndex ?? 0,
    locked: data.locked ?? false,
    visible: data.visible ?? true,
    muted: data.muted ?? false,
    videoFx: data.videoFx ?? null,
    transition: data.transition ?? null,
    createdAt: new Date(),
  };
  store.clips.set(id, row);
  return row;
}

export async function getProjectClips(projectId: number): Promise<Clip[]> {
  return [...store.clips.values()]
    .filter((c) => c.projectId === projectId)
    .sort((a, b) => a.sortIndex - b.sortIndex);
}

export async function updateClip(id: number, updates: Partial<InsertClip>): Promise<void> {
  const row = store.clips.get(id);
  if (!row) return;
  const fields = [
    "sourceStart",
    "duration",
    "timelineStart",
    "sortIndex",
    "trackId",
    "trackType",
    "locked",
    "visible",
    "muted",
  ] as const;
  for (const key of fields) {
    const val = updates[key];
    if (val !== undefined) (row as Record<string, unknown>)[key] = val;
  }
}

export async function getClip(id: number): Promise<Clip | undefined> {
  return store.clips.get(id);
}

export async function deleteClip(id: number, userId: number): Promise<void> {
  const clip = store.clips.get(id);
  if (!clip) throw new Error("Clip not found");
  const project = store.projects.get(clip.projectId);
  if (!project || project.userId !== userId)
    throw new Error("Unauthorized: clip does not belong to this user");
  store.clips.delete(id);
}

export async function batchCommitTimeline(
  projectId: number,
  userId: number,
  ops: {
    creates: InsertClip[];
    updates: Array<{ id: number; patch: Partial<InsertClip> }>;
    deletes: number[];
  }
): Promise<Clip[]> {
  const project = store.projects.get(projectId);
  if (!project || project.userId !== userId)
    throw new Error("Unauthorized: project does not belong to this user");

  for (const delId of ops.deletes) {
    store.clips.delete(delId);
  }
  for (const up of ops.updates) {
    const clip = store.clips.get(up.id);
    if (clip) Object.assign(clip, up.patch);
  }
  for (const cr of ops.creates) {
    const id = autoId();
    store.clips.set(id, {
      id,
      projectId,
      assetId: cr.assetId,
      trackId: cr.trackId ?? 0,
      trackType: (cr.trackType ?? "video") as "video" | "audio",
      sourceStart: cr.sourceStart,
      duration: cr.duration,
      timelineStart: cr.timelineStart,
      sortIndex: cr.sortIndex ?? 0,
      locked: cr.locked ?? false,
      visible: cr.visible ?? true,
      muted: cr.muted ?? false,
      videoFx: cr.videoFx ?? null,
      transition: cr.transition ?? null,
      createdAt: new Date(),
    });
  }
  return getProjectClips(projectId);
}

export async function trimClip(id: number, sourceStart: number, duration: number): Promise<void> {
  const row = store.clips.get(id);
  if (!row) throw new Error("Clip not found");
  row.sourceStart = sourceStart;
  row.duration = duration;
}

export async function splitClip(
  id: number,
  splitAt: number,
  userId: number,
): Promise<{ newClipId: number }> {
  const clip = store.clips.get(id);
  if (!clip) throw new Error("Clip not found");
  if (splitAt <= 0 || splitAt >= clip.duration) throw new Error("splitAt is outside clip duration");
  const project = store.projects.get(clip.projectId);
  if (!project || project.userId !== userId) throw new Error("Unauthorized");

  const newId = autoId();
  const rightClip: Clip = {
    ...clip,
    id: newId,
    sourceStart: clip.sourceStart + splitAt,
    duration: clip.duration - splitAt,
    timelineStart: clip.timelineStart + splitAt,
    sortIndex: clip.sortIndex + 1,
    createdAt: new Date(),
  };
  clip.duration = splitAt;
  store.clips.set(newId, rightClip);
  return { newClipId: newId };
}

/* ─── Marker helpers ─── */

export async function createMarker(data: InsertMarker): Promise<Marker> {
  const id = autoId();
  const row: Marker = {
    id,
    projectId: data.projectId,
    time: data.time,
    label: data.label ?? null,
    color: data.color ?? "#7c5cff",
    createdAt: new Date(),
  };
  store.markers.set(id, row);
  return row;
}

export async function getProjectMarkers(projectId: number): Promise<Marker[]> {
  return [...store.markers.values()]
    .filter((m) => m.projectId === projectId)
    .sort((a, b) => a.time - b.time);
}

export async function getMarker(id: number): Promise<Marker | undefined> {
  return store.markers.get(id);
}

export async function deleteMarker(id: number): Promise<void> {
  store.markers.delete(id);
}

/* ─── Caption helpers ─── */

export async function createCaption(data: InsertCaption): Promise<Caption> {
  const id = autoId();
  const row: Caption = {
    id,
    projectId: data.projectId,
    assetId: data.assetId,
    text: data.text,
    startTime: data.startTime,
    endTime: data.endTime,
    createdAt: new Date(),
  };
  store.captions.set(id, row);
  return row;
}

export async function getProjectCaptions(projectId: number): Promise<Caption[]> {
  return [...store.captions.values()]
    .filter((c) => c.projectId === projectId)
    .sort((a, b) => a.startTime - b.startTime);
}

export async function getAssetCaptions(assetId: number): Promise<Caption[]> {
  return [...store.captions.values()]
    .filter((c) => c.assetId === assetId)
    .sort((a, b) => a.startTime - b.startTime);
}

export async function getCaption(id: number): Promise<Caption | undefined> {
  return store.captions.get(id);
}

/* ─── Export helpers ─── */

export async function createExport(data: InsertExport): Promise<ExportRow> {
  const id = autoId();
  const row: ExportRow = {
    id,
    projectId: data.projectId,
    userId: data.userId,
    storageKey: data.storageKey,
    url: data.url,
    resolution: data.resolution,
    format: (data.format ?? "mp4") as ExportRow["format"],
    duration: data.duration,
    status: (data.status ?? "processing") as ExportRow["status"],
    errorMessage: data.errorMessage ?? null,
    createdAt: new Date(),
  };
  store.exports.set(id, row);
  return row;
}

export async function getProjectExports(projectId: number): Promise<ExportRow[]> {
  return [...store.exports.values()]
    .filter((e) => e.projectId === projectId)
    .sort((a, b) => +b.createdAt - +a.createdAt);
}

export async function getExport(id: number): Promise<ExportRow | undefined> {
  return store.exports.get(id);
}

export async function updateExport(
  id: number,
  updates: { status?: string; errorMessage?: string },
): Promise<void> {
  const row = store.exports.get(id);
  if (!row) return;
  if (updates.status !== undefined) row.status = updates.status as ExportRow["status"];
  if (updates.errorMessage !== undefined) row.errorMessage = updates.errorMessage;
}
