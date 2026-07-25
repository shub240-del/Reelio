import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  assets,
  captions,
  clips,
  exports as exportsTable,
  markers,
  projects,
  users,
  InsertAsset,
  InsertCaption,
  InsertClip,
  InsertExport,
  InsertMarker,
  InsertProject,
  InsertUser,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
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

/* ─── User helpers ─── */
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot upsert user: database not available"); return; }
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
    if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
    if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
    else if (user.openId === ENV.ownerOpenId) { values.role = "admin"; updateSet.role = "admin"; }
    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) { console.error("[Database] Failed to upsert user:", error); throw error; }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

/* ─── Project helpers ─── */
export async function createProject(userId: number, name: string, description?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(projects).values({ userId, name, description });
  const id = Number(result[0]?.insertId ?? 0);
  const rows = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  return rows[0];
}

export async function getUserProjects(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(projects).where(eq(projects.userId, userId)).orderBy(desc(projects.updatedAt));
}

export async function getProject(id: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(projects).where(and(eq(projects.id, id), eq(projects.userId, userId))).limit(1);
  return result[0];
}

export async function updateProject(id: number, userId: number, name?: string, status?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const updateSet: Record<string, unknown> = {};
  if (name !== undefined) updateSet.name = name;
  if (status !== undefined) updateSet.status = status;
  await db.update(projects).set(updateSet).where(and(eq(projects.id, id), eq(projects.userId, userId)));
}

export async function deleteProject(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(projects).where(and(eq(projects.id, id), eq(projects.userId, userId)));
}

/* ─── Asset helpers ─── */
export async function createAsset(data: InsertAsset) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(assets).values(data);
  const id = Number(result[0]?.insertId ?? 0);
  const rows = await db.select().from(assets).where(eq(assets.id, id)).limit(1);
  return rows[0];
}

export async function getProjectAssets(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(assets).where(eq(assets.projectId, projectId)).orderBy(assets.createdAt);
}

export async function getAsset(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(assets).where(eq(assets.id, id)).limit(1);
  return result[0];
}

/* ─── Clip helpers ─── */
export async function createClip(data: InsertClip) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(clips).values(data);
  const id = Number(result[0]?.insertId ?? 0);
  const rows = await db.select().from(clips).where(eq(clips.id, id)).limit(1);
  return rows[0];
}

export async function getProjectClips(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(clips).where(eq(clips.projectId, projectId)).orderBy(clips.sortIndex);
}

export async function updateClip(id: number, updates: Partial<InsertClip>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const updateSet: Record<string, unknown> = {};
  for (const key of ["sourceStart", "duration", "timelineStart", "sortIndex", "trackId", "trackType", "locked", "visible", "muted"] as const) {
    if (updates[key] !== undefined) updateSet[key] = updates[key];
  }
  await db.update(clips).set(updateSet).where(eq(clips.id, id));
}

export async function getClip(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(clips).where(eq(clips.id, id)).limit(1);
  return result[0];
}

export async function deleteClip(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Verify ownership via project
  const clip = await getClip(id);
  if (!clip) throw new Error("Clip not found");
  const project = await db.select().from(projects).where(eq(projects.id, clip.projectId)).limit(1);
  if (!project[0] || project[0].userId !== userId) throw new Error("Unauthorized: clip does not belong to this user");
  await db.delete(clips).where(eq(clips.id, id));
}

/* ─── Marker helpers ─── */
export async function createMarker(data: InsertMarker) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(markers).values(data);
  const id = Number(result[0]?.insertId ?? 0);
  const rows = await db.select().from(markers).where(eq(markers.id, id)).limit(1);
  return rows[0];
}

export async function getProjectMarkers(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(markers).where(eq(markers.projectId, projectId)).orderBy(markers.time);
}

export async function deleteMarker(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(markers).where(eq(markers.id, id));
}

/* ─── Caption helpers ─── */
export async function createCaption(data: InsertCaption) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(captions).values(data);
  const id = Number(result[0]?.insertId ?? 0);
  const rows = await db.select().from(captions).where(eq(captions.id, id)).limit(1);
  return rows[0];
}

export async function getProjectCaptions(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(captions).where(eq(captions.projectId, projectId)).orderBy(captions.startTime);
}

export async function getAssetCaptions(assetId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(captions).where(eq(captions.assetId, assetId)).orderBy(captions.startTime);
}

/* ─── Export helpers ─── */
export async function createExport(data: InsertExport) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(exportsTable).values(data);
  const id = Number(result[0]?.insertId ?? 0);
  const rows = await db.select().from(exportsTable).where(eq(exportsTable.id, id)).limit(1);
  return rows[0];
}

export async function getProjectExports(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(exportsTable).where(eq(exportsTable.projectId, projectId)).orderBy(desc(exportsTable.createdAt));
}

export async function updateExport(id: number, updates: { status?: string; errorMessage?: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const updateSet: Record<string, unknown> = {};
  if (updates.status !== undefined) updateSet.status = updates.status;
  if (updates.errorMessage !== undefined) updateSet.errorMessage = updates.errorMessage;
  await db.update(exportsTable).set(updateSet).where(eq(exportsTable.id, id));
}
