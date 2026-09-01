import { and, desc, eq, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  assets,
  aiEditProposals,
  captions,
  clips,
  exports as exportsTable,
  markers,
  mediaAnalyses,
  projects,
  users,
  InsertAsset,
  InsertCaption,
  InsertClip,
  InsertExport,
  InsertMarker,
  InsertMediaAnalysis,
  InsertProject,
  InsertUser,
  InsertAIEditProposal,
  type Asset,
  type Clip,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!process.env.DATABASE_URL && ENV.isProduction) {
    throw new Error("DATABASE_URL is required in production");
  }
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// Empty in-memory development store. Production is required to use MySQL.
const memUsers: any[] = [
  {
    id: 1,
    openId: "local-dev-user",
    name: "Local Creator",
    email: null,
    role: "admin",
    loginMethod: "local",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  },
];

const memProjects: any[] = [];
const memAssets: any[] = [];
const memClips: any[] = [];

const memMarkers: any[] = [];
const memCaptions: any[] = [];
const memExports: any[] = [];
const memAIEditProposals: any[] = [];
const memMediaAnalyses: any[] = [];

let nextProjectId = 1;
let nextAssetId = 1;
let nextClipId = 1;
let nextMarkerId = 1;
let nextCaptionId = 1;
let nextExportId = 1;

/* ─── User helpers ─── */
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) {
    const existing = memUsers.find(u => u.openId === user.openId);
    if (existing) {
      if (user.name !== undefined) existing.name = user.name;
      if (user.email !== undefined) existing.email = user.email;
      if (user.lastSignedIn !== undefined)
        existing.lastSignedIn = user.lastSignedIn;
    } else {
      memUsers.push({
        id: memUsers.length + 1,
        ...user,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    return;
  }
  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};
    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];
    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      values[field] = value ?? null;
      updateSet[field] = value ?? null;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }
    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0)
      updateSet.lastSignedIn = new Date();
    await db
      .insert(users)
      .values(values)
      .onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return memUsers.find(u => u.openId === openId);
  const result = await db
    .select()
    .from(users)
    .where(eq(users.openId, openId))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

/* ─── Project helpers ─── */
export async function createProject(
  userId: number,
  name: string,
  description?: string
) {
  const db = await getDb();
  if (!db) {
    const proj = {
      id: nextProjectId++,
      userId,
      name,
      status: "draft",
      description: description || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    memProjects.unshift(proj);
    return proj;
  }
  const result = await db
    .insert(projects)
    .values({ userId, name, description });
  const id = Number(result[0]?.insertId ?? 0);
  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  return rows[0];
}

export async function getUserProjects(userId: number) {
  const db = await getDb();
  if (!db) return memProjects.filter(p => p.userId === userId);
  return db
    .select()
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.updatedAt));
}

export async function getProject(id: number, userId: number) {
  const db = await getDb();
  if (!db) return memProjects.find(p => p.id === id && p.userId === userId);
  const result = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId)))
    .limit(1);
  return result[0];
}

export async function updateProject(
  id: number,
  userId: number,
  name?: string,
  status?: string,
  description?: string | null
) {
  const db = await getDb();
  if (!db) {
    const proj = memProjects.find(p => p.id === id && p.userId === userId);
    if (proj) {
      if (name !== undefined) proj.name = name;
      if (status !== undefined) proj.status = status;
      if (description !== undefined) proj.description = description;
      proj.updatedAt = new Date();
    }
    return;
  }
  const updateSet: Record<string, unknown> = {};
  if (name !== undefined) updateSet.name = name;
  if (status !== undefined) updateSet.status = status;
  if (description !== undefined) updateSet.description = description;
  await db
    .update(projects)
    .set(updateSet)
    .where(and(eq(projects.id, id), eq(projects.userId, userId)));
}

export async function duplicateProject(
  id: number,
  userId: number,
  name?: string
) {
  const source = await getProject(id, userId);
  if (!source) return undefined;
  const db = await getDb();
  if (db) {
    return db.transaction(async tx => {
      const insertedProject = await tx.insert(projects).values({
        userId,
        name: name ?? `${source.name} Copy`,
        description: source.description,
        status: "draft",
      });
      const copyId = Number(insertedProject[0]?.insertId ?? 0);
      if (!copyId) throw new Error("Could not create project copy.");
      const assetIdMap = new Map<number, number>();
      const sourceAssets = await tx
        .select()
        .from(assets)
        .where(eq(assets.projectId, id));
      for (const asset of sourceAssets) {
        const { id: sourceAssetId, createdAt: _createdAt, ...values } = asset;
        const insertedAsset = await tx.insert(assets).values({
          ...values,
          projectId: copyId,
          userId,
        });
        const copiedAssetId = Number(insertedAsset[0]?.insertId ?? 0);
        if (!copiedAssetId) throw new Error("Could not copy project media.");
        assetIdMap.set(sourceAssetId, copiedAssetId);
      }
      const sourceClips = await tx
        .select()
        .from(clips)
        .where(eq(clips.projectId, id));
      for (const clip of sourceClips) {
        const { id: _clipId, createdAt: _createdAt, ...values } = clip;
        const copiedAssetId = assetIdMap.get(clip.assetId);
        if (!copiedAssetId)
          throw new Error("A copied clip lost its media reference.");
        await tx.insert(clips).values({
          ...values,
          projectId: copyId,
          assetId: copiedAssetId,
        });
      }
      const sourceMarkers = await tx
        .select()
        .from(markers)
        .where(eq(markers.projectId, id));
      for (const marker of sourceMarkers) {
        const { id: _markerId, createdAt: _createdAt, ...values } = marker;
        await tx.insert(markers).values({ ...values, projectId: copyId });
      }
      const sourceCaptions = await tx
        .select()
        .from(captions)
        .where(eq(captions.projectId, id));
      for (const caption of sourceCaptions) {
        const { id: _captionId, createdAt: _createdAt, ...values } = caption;
        const copiedAssetId = assetIdMap.get(caption.assetId);
        if (!copiedAssetId)
          throw new Error("A copied caption lost its media reference.");
        await tx.insert(captions).values({
          ...values,
          projectId: copyId,
          assetId: copiedAssetId,
        });
      }
      const copiedRows = await tx
        .select()
        .from(projects)
        .where(eq(projects.id, copyId))
        .limit(1);
      return copiedRows[0];
    });
  }
  const copy = await createProject(
    userId,
    name ?? `${source.name} Copy`,
    source.description ?? undefined
  );
  const assetIdMap = new Map<number, number>();

  for (const asset of await getProjectAssets(id)) {
    const { id: _id, createdAt: _createdAt, ...values } = asset;
    const cloned = await createAsset({
      ...values,
      projectId: copy.id,
      userId,
    } as InsertAsset);
    if (cloned) assetIdMap.set(asset.id, cloned.id);
  }
  for (const clip of await getProjectClips(id)) {
    const { id: _id, createdAt: _createdAt, ...values } = clip;
    await createClip({
      ...values,
      projectId: copy.id,
      assetId: assetIdMap.get(clip.assetId) ?? clip.assetId,
    } as InsertClip);
  }
  for (const marker of await getProjectMarkers(id)) {
    const { id: _id, createdAt: _createdAt, ...values } = marker;
    await createMarker({ ...values, projectId: copy.id } as InsertMarker);
  }
  for (const caption of await getProjectCaptions(id)) {
    const { id: _id, createdAt: _createdAt, ...values } = caption;
    await createCaption({
      ...values,
      projectId: copy.id,
      assetId: assetIdMap.get(caption.assetId) ?? caption.assetId,
    } as InsertCaption);
  }
  return copy;
}

export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return false;
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

export async function deleteProject(id: number, userId: number) {
  const db = await getDb();
  if (!db) {
    const idx = memProjects.findIndex(p => p.id === id && p.userId === userId);
    if (idx === -1) return;
    for (const rows of [
      memClips,
      memMarkers,
      memCaptions,
      memExports,
      memAIEditProposals,
      memMediaAnalyses,
      memAssets,
    ]) {
      for (let rowIndex = rows.length - 1; rowIndex >= 0; rowIndex -= 1) {
        if (rows[rowIndex].projectId === id) rows.splice(rowIndex, 1);
      }
    }
    memProjects.splice(idx, 1);
    return;
  }
  const owned = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId)))
    .limit(1);
  if (!owned[0]) return;
  // The schema owns child cleanup through ON DELETE CASCADE, keeping project
  // deletion atomic even if the application process terminates mid-request.
  await db
    .delete(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId)));
}

/* ─── Asset helpers ─── */
export async function createAsset(data: InsertAsset) {
  const db = await getDb();
  if (!db) {
    const asset = { id: nextAssetId++, ...data, createdAt: new Date() };
    memAssets.push(asset);
    return asset;
  }
  const result = await db.insert(assets).values(data);
  const id = Number(result[0]?.insertId ?? 0);
  const rows = await db.select().from(assets).where(eq(assets.id, id)).limit(1);
  return rows[0];
}

export async function getProjectAssets(projectId: number) {
  const db = await getDb();
  if (!db) return memAssets.filter(a => a.projectId === projectId);
  return db
    .select()
    .from(assets)
    .where(eq(assets.projectId, projectId))
    .orderBy(assets.createdAt);
}

export async function getAsset(id: number) {
  const db = await getDb();
  if (!db) return memAssets.find(a => a.id === id);
  const result = await db
    .select()
    .from(assets)
    .where(eq(assets.id, id))
    .limit(1);
  return result[0];
}

export async function isStorageKeyReferenced(
  storageKey: string
): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    return (
      memAssets.some(asset => asset.storageKey === storageKey) ||
      memExports.some(exportRow => exportRow.storageKey === storageKey)
    );
  }
  const [assetRows, exportRows] = await Promise.all([
    db
      .select({ id: assets.id })
      .from(assets)
      .where(eq(assets.storageKey, storageKey))
      .limit(1),
    db
      .select({ id: exportsTable.id })
      .from(exportsTable)
      .where(eq(exportsTable.storageKey, storageKey))
      .limit(1),
  ]);
  return assetRows.length > 0 || exportRows.length > 0;
}

export async function deleteAsset(id: number, userId: number) {
  const db = await getDb();
  if (!db) {
    const asset = memAssets.find(a => a.id === id);
    if (!asset) throw new Error("Asset not found");
    const proj = memProjects.find(p => p.id === asset.projectId);
    if (!proj || proj.userId !== userId)
      throw new Error("Unauthorized: asset does not belong to this user");
    const idx = memAssets.findIndex(a => a.id === id);
    if (idx !== -1) memAssets.splice(idx, 1);
    for (let clipIndex = memClips.length - 1; clipIndex >= 0; clipIndex -= 1) {
      if (memClips[clipIndex].assetId === id) memClips.splice(clipIndex, 1);
    }
    for (
      let captionIndex = memCaptions.length - 1;
      captionIndex >= 0;
      captionIndex -= 1
    ) {
      if (memCaptions[captionIndex].assetId === id)
        memCaptions.splice(captionIndex, 1);
    }
    return;
  }
  const asset = await getAsset(id);
  if (!asset) throw new Error("Asset not found");
  const project = await db
    .select()
    .from(projects)
    .where(eq(projects.id, asset.projectId))
    .limit(1);
  if (!project[0] || project[0].userId !== userId)
    throw new Error("Unauthorized: asset does not belong to this user");
  // Clips, captions and analysis rows cascade from the owned asset.
  await db.delete(assets).where(eq(assets.id, id));
}

/* ─── Clip helpers ─── */
export async function createClip(data: InsertClip) {
  const db = await getDb();
  if (!db) {
    const clip = {
      id: nextClipId++,
      ...data,
      trackId: data.trackId ?? 0,
      trackType: data.trackType ?? "video",
      sortIndex: data.sortIndex ?? 0,
      locked: data.locked ?? false,
      visible: data.visible ?? true,
      muted: data.muted ?? false,
      zIndex: data.zIndex ?? 0,
      volume: data.volume ?? 1,
      trackVolume: data.trackVolume ?? 1,
      positionX: data.positionX ?? 0,
      positionY: data.positionY ?? 0,
      scale: data.scale ?? 1,
      cropLeft: data.cropLeft ?? 0,
      cropTop: data.cropTop ?? 0,
      cropRight: data.cropRight ?? 0,
      cropBottom: data.cropBottom ?? 0,
      videoFx: data.videoFx ?? null,
      transition: data.transition ?? null,
      createdAt: new Date(),
    };
    memClips.push(clip);
    return clip;
  }
  const result = await db.insert(clips).values(data);
  const id = Number(result[0]?.insertId ?? 0);
  const rows = await db.select().from(clips).where(eq(clips.id, id)).limit(1);
  return rows[0];
}

export async function getProjectClips(projectId: number) {
  const db = await getDb();
  if (!db)
    return memClips
      .filter(c => c.projectId === projectId)
      .sort((a, b) => a.sortIndex - b.sortIndex);
  return db
    .select()
    .from(clips)
    .where(eq(clips.projectId, projectId))
    .orderBy(clips.sortIndex);
}

export async function updateClip(id: number, updates: Partial<InsertClip>) {
  const db = await getDb();
  if (!db) {
    const clip = memClips.find(c => c.id === id);
    if (clip) Object.assign(clip, updates);
    return;
  }
  const updateSet: Record<string, unknown> = {};
  for (const key of [
    "sourceStart",
    "duration",
    "timelineStart",
    "sortIndex",
    "trackId",
    "trackType",
    "locked",
    "visible",
    "muted",
    "zIndex",
    "volume",
    "trackVolume",
    "positionX",
    "positionY",
    "scale",
    "cropLeft",
    "cropTop",
    "cropRight",
    "cropBottom",
    "videoFx",
    "transition",
  ] as const) {
    if (updates[key] !== undefined) updateSet[key] = updates[key];
  }
  await db.update(clips).set(updateSet).where(eq(clips.id, id));
}

export async function getClip(id: number) {
  const db = await getDb();
  if (!db) return memClips.find(c => c.id === id);
  const result = await db.select().from(clips).where(eq(clips.id, id)).limit(1);
  return result[0];
}

export async function deleteClip(id: number, userId: number) {
  const db = await getDb();
  if (!db) {
    const clip = memClips.find(c => c.id === id);
    if (!clip) throw new Error("Clip not found");
    const proj = memProjects.find(p => p.id === clip.projectId);
    if (!proj || proj.userId !== userId)
      throw new Error("Unauthorized: clip does not belong to this user");
    const idx = memClips.findIndex(c => c.id === id);
    if (idx !== -1) memClips.splice(idx, 1);
    return;
  }
  const clip = await getClip(id);
  if (!clip) throw new Error("Clip not found");
  const project = await db
    .select()
    .from(projects)
    .where(eq(projects.id, clip.projectId))
    .limit(1);
  if (!project[0] || project[0].userId !== userId)
    throw new Error("Unauthorized: clip does not belong to this user");
  await db.delete(clips).where(eq(clips.id, id));
}

export interface TimelineCommitOp {
  creates: InsertClip[];
  updates: Array<{ id: number; patch: Partial<InsertClip> }>;
  deletes: number[];
}

type TimelineRevisionFactory = (clipRows: Clip[], assetRows: Asset[]) => string;

export async function batchCommitTimeline(
  projectId: number,
  userId: number,
  ops: TimelineCommitOp
) {
  const db = await getDb();
  if (!db) {
    const proj = memProjects.find(p => p.id === projectId);
    if (!proj || proj.userId !== userId)
      throw new Error("Unauthorized: project does not belong to this user");

    for (const delId of ops.deletes) {
      const idx = memClips.findIndex(
        c => c.id === delId && c.projectId === projectId
      );
      if (idx !== -1) memClips.splice(idx, 1);
    }
    for (const up of ops.updates) {
      const clip = memClips.find(
        c => c.id === up.id && c.projectId === projectId
      );
      if (clip) Object.assign(clip, up.patch);
    }
    for (const cr of ops.creates) {
      memClips.push({
        id: nextClipId++,
        ...cr,
        projectId,
        createdAt: new Date(),
      });
    }
    return getProjectClips(projectId);
  }

  const project = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);
  if (!project[0])
    throw new Error("Unauthorized: project does not belong to this user");

  await db.transaction(async tx => {
    for (const delId of ops.deletes) {
      await tx
        .delete(clips)
        .where(and(eq(clips.id, delId), eq(clips.projectId, projectId)));
    }
    for (const up of ops.updates) {
      const updateSet: Record<string, unknown> = {};
      for (const key of [
        "sourceStart",
        "duration",
        "timelineStart",
        "sortIndex",
        "trackId",
        "trackType",
        "locked",
        "visible",
        "muted",
        "zIndex",
        "volume",
        "trackVolume",
        "positionX",
        "positionY",
        "scale",
        "cropLeft",
        "cropTop",
        "cropRight",
        "cropBottom",
        "videoFx",
        "transition",
      ] as const) {
        if ((up.patch as any)[key] !== undefined)
          updateSet[key] = (up.patch as any)[key];
      }
      if (Object.keys(updateSet).length > 0) {
        await tx
          .update(clips)
          .set(updateSet)
          .where(and(eq(clips.id, up.id), eq(clips.projectId, projectId)));
      }
    }
    for (const cr of ops.creates) {
      await tx.insert(clips).values({ ...cr, projectId });
    }
  });

  return getProjectClips(projectId);
}

/**
 * Atomically commits a validated AI timeline mutation and marks its proposal
 * applied. The revision is recomputed under row locks so a concurrent editor
 * write cannot slip between the workflow's validation and persistence.
 */
export async function commitAIProposalTimeline(
  proposalId: string,
  projectId: number,
  userId: number,
  expectedRevision: string,
  revisionOf: TimelineRevisionFactory,
  ops: TimelineCommitOp
): Promise<{ alreadyApplied: boolean }> {
  const db = await getDb();
  if (!db) {
    const proposal = memAIEditProposals.find(
      row => row.id === proposalId && row.userId === userId
    );
    if (!proposal) throw new Error("AI proposal not found.");
    if (proposal.status === "applied") return { alreadyApplied: true };
    if (proposal.status !== "pending")
      throw new Error(`AI proposal is ${proposal.status}.`);
    const project = memProjects.find(
      row => row.id === projectId && row.userId === userId
    );
    if (!project)
      throw new Error("Project not found or not owned by this user.");
    const clipRows = memClips
      .filter(row => row.projectId === projectId)
      .sort((a, b) => a.sortIndex - b.sortIndex) as Clip[];
    const assetRows = memAssets.filter(
      row => row.projectId === projectId
    ) as Asset[];
    if (revisionOf(clipRows, assetRows) !== expectedRevision) {
      throw new Error(
        "The timeline changed after this proposal was created. Generate a new proposal."
      );
    }
    await batchCommitTimeline(projectId, userId, ops);
    proposal.status = "applied";
    proposal.updatedAt = new Date();
    return { alreadyApplied: false };
  }

  return db.transaction(async tx => {
    const proposalRows = await tx
      .select()
      .from(aiEditProposals)
      .where(
        and(
          eq(aiEditProposals.id, proposalId),
          eq(aiEditProposals.userId, userId)
        )
      )
      .limit(1)
      .for("update");
    const proposal = proposalRows[0];
    if (!proposal) throw new Error("AI proposal not found.");
    if (proposal.status === "applied") return { alreadyApplied: true };
    if (proposal.status !== "pending")
      throw new Error(`AI proposal is ${proposal.status}.`);

    const projectRows = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
      .limit(1)
      .for("update");
    if (!projectRows[0])
      throw new Error("Project not found or not owned by this user.");
    const clipRows = await tx
      .select()
      .from(clips)
      .where(eq(clips.projectId, projectId))
      .orderBy(clips.sortIndex)
      .for("update");
    const assetRows = await tx
      .select()
      .from(assets)
      .where(eq(assets.projectId, projectId))
      .for("update");
    if (revisionOf(clipRows, assetRows) !== expectedRevision) {
      throw new Error(
        "The timeline changed after this proposal was created. Generate a new proposal."
      );
    }

    for (const delId of ops.deletes) {
      await tx
        .delete(clips)
        .where(and(eq(clips.id, delId), eq(clips.projectId, projectId)));
    }
    for (const update of ops.updates) {
      const updateSet: Record<string, unknown> = {};
      for (const key of [
        "sourceStart",
        "duration",
        "timelineStart",
        "sortIndex",
        "trackId",
        "trackType",
        "locked",
        "visible",
        "muted",
        "zIndex",
        "volume",
        "trackVolume",
        "positionX",
        "positionY",
        "scale",
        "cropLeft",
        "cropTop",
        "cropRight",
        "cropBottom",
        "videoFx",
        "transition",
      ] as const) {
        if (update.patch[key] !== undefined) updateSet[key] = update.patch[key];
      }
      if (Object.keys(updateSet).length > 0) {
        await tx
          .update(clips)
          .set(updateSet)
          .where(and(eq(clips.id, update.id), eq(clips.projectId, projectId)));
      }
    }
    for (const create of ops.creates) {
      await tx.insert(clips).values({ ...create, projectId });
    }
    await tx
      .update(aiEditProposals)
      .set({ status: "applied" })
      .where(
        and(
          eq(aiEditProposals.id, proposalId),
          eq(aiEditProposals.userId, userId),
          eq(aiEditProposals.status, "pending")
        )
      );
    return { alreadyApplied: false };
  });
}

/* ─── Marker helpers ─── */
export async function createMarker(data: InsertMarker) {
  const db = await getDb();
  if (!db) {
    const marker = { id: nextMarkerId++, ...data, createdAt: new Date() };
    memMarkers.push(marker);
    return marker;
  }
  const result = await db.insert(markers).values(data);
  const id = Number(result[0]?.insertId ?? 0);
  const rows = await db
    .select()
    .from(markers)
    .where(eq(markers.id, id))
    .limit(1);
  return rows[0];
}

export async function getProjectMarkers(projectId: number) {
  const db = await getDb();
  if (!db)
    return memMarkers
      .filter(m => m.projectId === projectId)
      .sort((a, b) => a.time - b.time);
  return db
    .select()
    .from(markers)
    .where(eq(markers.projectId, projectId))
    .orderBy(markers.time);
}

export async function getMarker(id: number) {
  const db = await getDb();
  if (!db) return memMarkers.find(marker => marker.id === id);
  const rows = await db
    .select()
    .from(markers)
    .where(eq(markers.id, id))
    .limit(1);
  return rows[0];
}

export async function deleteMarker(id: number) {
  const db = await getDb();
  if (!db) {
    const idx = memMarkers.findIndex(m => m.id === id);
    if (idx !== -1) memMarkers.splice(idx, 1);
    return;
  }
  await db.delete(markers).where(eq(markers.id, id));
}

/* ─── Caption helpers ─── */
export async function createCaption(data: InsertCaption) {
  const db = await getDb();
  if (!db) {
    const cap = { id: nextCaptionId++, ...data, createdAt: new Date() };
    memCaptions.push(cap);
    return cap;
  }
  const result = await db.insert(captions).values(data);
  const id = Number(result[0]?.insertId ?? 0);
  const rows = await db
    .select()
    .from(captions)
    .where(eq(captions.id, id))
    .limit(1);
  return rows[0];
}

export async function getProjectCaptions(projectId: number) {
  const db = await getDb();
  if (!db)
    return memCaptions
      .filter(c => c.projectId === projectId)
      .sort((a, b) => a.startTime - b.startTime);
  return db
    .select()
    .from(captions)
    .where(eq(captions.projectId, projectId))
    .orderBy(captions.startTime);
}

export async function getAssetCaptions(assetId: number) {
  const db = await getDb();
  if (!db)
    return memCaptions
      .filter(c => c.assetId === assetId)
      .sort((a, b) => a.startTime - b.startTime);
  return db
    .select()
    .from(captions)
    .where(eq(captions.assetId, assetId))
    .orderBy(captions.startTime);
}

export async function getCaption(id: number) {
  const db = await getDb();
  if (!db) return memCaptions.find(caption => caption.id === id);
  const rows = await db
    .select()
    .from(captions)
    .where(eq(captions.id, id))
    .limit(1);
  return rows[0];
}

export async function updateCaption(
  id: number,
  updates: { text?: string; startTime?: number; endTime?: number }
) {
  const db = await getDb();
  if (!db) {
    const caption = memCaptions.find(row => row.id === id);
    if (caption) Object.assign(caption, updates);
    return;
  }
  await db.update(captions).set(updates).where(eq(captions.id, id));
}

export async function deleteCaption(id: number) {
  const db = await getDb();
  if (!db) {
    const index = memCaptions.findIndex(row => row.id === id);
    if (index >= 0) memCaptions.splice(index, 1);
    return;
  }
  await db.delete(captions).where(eq(captions.id, id));
}

/* ─── Export helpers ─── */
export async function createExport(data: InsertExport) {
  const db = await getDb();
  if (!db) {
    const existing = memExports.find(
      row => row.userId === data.userId && row.requestId === data.requestId
    );
    if (existing) return existing;
    const exp = { id: nextExportId++, ...data, createdAt: new Date() };
    memExports.push(exp);
    return exp;
  }
  const result = await db
    .insert(exportsTable)
    .values(data)
    .onDuplicateKeyUpdate({ set: { requestId: data.requestId } });
  const id = Number(result[0]?.insertId ?? 0);
  if (!id) {
    const existing = await getExportByRequest(data.userId, data.requestId);
    if (existing) return existing;
  }
  const rows = await db
    .select()
    .from(exportsTable)
    .where(eq(exportsTable.id, id))
    .limit(1);
  return rows[0];
}

export async function getProjectExports(projectId: number) {
  const db = await getDb();
  if (!db) return memExports.filter(e => e.projectId === projectId);
  return db
    .select()
    .from(exportsTable)
    .where(eq(exportsTable.projectId, projectId))
    .orderBy(desc(exportsTable.createdAt));
}

export async function getExportByRequest(userId: number, requestId: string) {
  const db = await getDb();
  if (!db) {
    return memExports.find(
      exportRow =>
        exportRow.userId === userId && exportRow.requestId === requestId
    );
  }
  const rows = await db
    .select()
    .from(exportsTable)
    .where(
      and(
        eq(exportsTable.userId, userId),
        eq(exportsTable.requestId, requestId)
      )
    )
    .limit(1);
  return rows[0];
}

export async function getExport(id: number) {
  const db = await getDb();
  if (!db) return memExports.find(exportRow => exportRow.id === id);
  const rows = await db
    .select()
    .from(exportsTable)
    .where(eq(exportsTable.id, id))
    .limit(1);
  return rows[0];
}

export async function getRecoverableExports(limit = 50) {
  const db = await getDb();
  if (!db) {
    return memExports
      .filter(row => row.status === "queued" || row.status === "processing")
      .slice(0, limit);
  }
  return db
    .select()
    .from(exportsTable)
    .where(
      or(
        eq(exportsTable.status, "queued"),
        eq(exportsTable.status, "processing")
      )
    )
    .orderBy(exportsTable.createdAt)
    .limit(limit);
}

export async function updateExport(
  id: number,
  updates: {
    status?: "queued" | "processing" | "done" | "failed" | "cancelled";
    errorMessage?: string | null;
    progress?: number;
    storageKey?: string;
    url?: string;
    duration?: number;
    attempt?: number;
  }
) {
  const db = await getDb();
  if (!db) {
    const exp = memExports.find(e => e.id === id);
    if (exp) Object.assign(exp, updates);
    return;
  }
  const updateSet: Record<string, unknown> = {};
  if (updates.status !== undefined) updateSet.status = updates.status;
  if (updates.errorMessage !== undefined)
    updateSet.errorMessage = updates.errorMessage;
  if (updates.progress !== undefined) updateSet.progress = updates.progress;
  if (updates.storageKey !== undefined)
    updateSet.storageKey = updates.storageKey;
  if (updates.url !== undefined) updateSet.url = updates.url;
  if (updates.duration !== undefined) updateSet.duration = updates.duration;
  if (updates.attempt !== undefined) updateSet.attempt = updates.attempt;
  await db.update(exportsTable).set(updateSet).where(eq(exportsTable.id, id));
}

/* ─── Durable media-analysis helpers ─── */
export async function createMediaAnalysis(data: InsertMediaAnalysis) {
  const db = await getDb();
  if (!db) {
    const existing = memMediaAnalyses.find(
      row => row.userId === data.userId && row.requestId === data.requestId
    );
    if (existing) return existing;
    const row = {
      ...data,
      status: data.status ?? "queued",
      progress: data.progress ?? 0,
      attempt: data.attempt ?? 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    memMediaAnalyses.push(row);
    return row;
  }
  await db
    .insert(mediaAnalyses)
    .values(data)
    .onDuplicateKeyUpdate({ set: { requestId: data.requestId } });
  return getMediaAnalysisByRequest(data.userId, data.requestId);
}

export async function getMediaAnalysis(id: string, userId: number) {
  const db = await getDb();
  if (!db) {
    return memMediaAnalyses.find(row => row.id === id && row.userId === userId);
  }
  const rows = await db
    .select()
    .from(mediaAnalyses)
    .where(and(eq(mediaAnalyses.id, id), eq(mediaAnalyses.userId, userId)))
    .limit(1);
  return rows[0];
}

export async function getMediaAnalysisByRequest(
  userId: number,
  requestId: string
) {
  const db = await getDb();
  if (!db) {
    return memMediaAnalyses.find(
      row => row.userId === userId && row.requestId === requestId
    );
  }
  const rows = await db
    .select()
    .from(mediaAnalyses)
    .where(
      and(
        eq(mediaAnalyses.userId, userId),
        eq(mediaAnalyses.requestId, requestId)
      )
    )
    .limit(1);
  return rows[0];
}

export async function getProjectMediaAnalyses(
  projectId: number,
  userId: number
) {
  const db = await getDb();
  if (!db) {
    return memMediaAnalyses
      .filter(row => row.projectId === projectId && row.userId === userId)
      .sort((a, b) => +b.createdAt - +a.createdAt);
  }
  return db
    .select()
    .from(mediaAnalyses)
    .where(
      and(
        eq(mediaAnalyses.projectId, projectId),
        eq(mediaAnalyses.userId, userId)
      )
    )
    .orderBy(desc(mediaAnalyses.createdAt));
}

export async function getRecoverableMediaAnalyses(limit = 50) {
  const db = await getDb();
  if (!db) {
    return memMediaAnalyses
      .filter(row => row.status === "queued" || row.status === "processing")
      .slice(0, limit);
  }
  return db
    .select()
    .from(mediaAnalyses)
    .where(
      or(
        eq(mediaAnalyses.status, "queued"),
        eq(mediaAnalyses.status, "processing")
      )
    )
    .orderBy(mediaAnalyses.createdAt)
    .limit(limit);
}

export async function updateMediaAnalysis(
  id: string,
  userId: number,
  updates: {
    status?: "queued" | "processing" | "done" | "failed" | "cancelled";
    progress?: number;
    attempt?: number;
    resultJson?: string | null;
    errorMessage?: string | null;
  }
) {
  const db = await getDb();
  if (!db) {
    const row = memMediaAnalyses.find(
      candidate => candidate.id === id && candidate.userId === userId
    );
    if (row) {
      Object.assign(row, updates);
      row.updatedAt = new Date();
    }
    return;
  }
  await db
    .update(mediaAnalyses)
    .set(updates)
    .where(and(eq(mediaAnalyses.id, id), eq(mediaAnalyses.userId, userId)));
}

/* ─── AI proposal helpers ─── */
export async function createAIEditProposal(data: InsertAIEditProposal) {
  const db = await getDb();
  if (!db) {
    const row = {
      ...data,
      status: data.status ?? "pending",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    memAIEditProposals.push(row);
    return row;
  }
  await db.insert(aiEditProposals).values(data);
  const rows = await db
    .select()
    .from(aiEditProposals)
    .where(eq(aiEditProposals.id, data.id))
    .limit(1);
  return rows[0];
}

export async function getAIEditProposal(id: string, userId: number) {
  const db = await getDb();
  if (!db) {
    return memAIEditProposals.find(
      proposal => proposal.id === id && proposal.userId === userId
    );
  }
  const rows = await db
    .select()
    .from(aiEditProposals)
    .where(and(eq(aiEditProposals.id, id), eq(aiEditProposals.userId, userId)))
    .limit(1);
  return rows[0];
}

export async function getAIEditProposalByRequest(
  userId: number,
  requestId: string
) {
  const db = await getDb();
  if (!db) {
    return memAIEditProposals.find(
      proposal => proposal.userId === userId && proposal.requestId === requestId
    );
  }
  const rows = await db
    .select()
    .from(aiEditProposals)
    .where(
      and(
        eq(aiEditProposals.userId, userId),
        eq(aiEditProposals.requestId, requestId)
      )
    )
    .limit(1);
  return rows[0];
}

export async function getLatestPendingAIEditProposal(
  projectId: number,
  userId: number
) {
  const db = await getDb();
  if (!db) {
    return memAIEditProposals
      .filter(
        proposal =>
          proposal.projectId === projectId &&
          proposal.userId === userId &&
          proposal.status === "pending"
      )
      .sort((a, b) => +b.createdAt - +a.createdAt)[0];
  }
  const rows = await db
    .select()
    .from(aiEditProposals)
    .where(
      and(
        eq(aiEditProposals.projectId, projectId),
        eq(aiEditProposals.userId, userId),
        eq(aiEditProposals.status, "pending")
      )
    )
    .orderBy(desc(aiEditProposals.createdAt))
    .limit(1);
  return rows[0];
}

export async function updateAIEditProposalStatus(
  id: string,
  userId: number,
  status: "pending" | "applied" | "rejected" | "cancelled" | "no_action"
) {
  const db = await getDb();
  if (!db) {
    const proposal = memAIEditProposals.find(
      candidate => candidate.id === id && candidate.userId === userId
    );
    if (proposal) {
      proposal.status = status;
      proposal.updatedAt = new Date();
    }
    return;
  }
  await db
    .update(aiEditProposals)
    .set({ status })
    .where(and(eq(aiEditProposals.id, id), eq(aiEditProposals.userId, userId)));
}
