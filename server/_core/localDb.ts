/**
 * Local development database driver.
 *
 * The production deployment runs Drizzle against MySQL. That is untouched.
 * This driver exists so the app is runnable — and therefore verifiable — with no
 * cloud credentials at all, using node:sqlite from the Node 22 standard library
 * (zero extra dependencies).
 *
 * It exposes exactly the same repository surface as server/db.ts; server/repo.ts
 * picks one at boot and the type system enforces that they stay in step.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

// node:sqlite is not exposed to ESM named imports in Node 22, and a bare
// `require` here throws "require is not defined" under tsx, silently disabling
// the whole database. createRequire is the only form that works in both.
const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

type Row = Record<string, any>;

let db: InstanceType<typeof DatabaseSync> | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  openId TEXT NOT NULL UNIQUE,
  name TEXT,
  email TEXT,
  loginMethod TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
  lastSignedIn TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  projectId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  name TEXT NOT NULL,
  storageKey TEXT NOT NULL,
  url TEXT NOT NULL,
  mimeType TEXT NOT NULL,
  sizeBytes INTEGER NOT NULL,
  duration REAL NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  fps REAL NOT NULL,
  hasAudio INTEGER NOT NULL DEFAULT 0,
  thumbnailKey TEXT,
  thumbnailUrl TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS clips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  projectId INTEGER NOT NULL,
  assetId INTEGER NOT NULL,
  trackId INTEGER NOT NULL DEFAULT 0,
  trackType TEXT NOT NULL DEFAULT 'video',
  sourceStart REAL NOT NULL,
  duration REAL NOT NULL,
  timelineStart REAL NOT NULL,
  sortIndex INTEGER NOT NULL DEFAULT 0,
  locked INTEGER NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 1,
  muted INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS markers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  projectId INTEGER NOT NULL,
  time REAL NOT NULL,
  label TEXT,
  color TEXT NOT NULL DEFAULT '#7c5cff',
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS captions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  projectId INTEGER NOT NULL,
  assetId INTEGER NOT NULL,
  text TEXT NOT NULL,
  startTime REAL NOT NULL,
  endTime REAL NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS exports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  projectId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  storageKey TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  resolution TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'mp4',
  duration REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'processing',
  errorMessage TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(userId);
CREATE INDEX IF NOT EXISTS idx_assets_project ON assets(projectId);
CREATE INDEX IF NOT EXISTS idx_clips_project ON clips(projectId);
CREATE INDEX IF NOT EXISTS idx_markers_project ON markers(projectId);
CREATE INDEX IF NOT EXISTS idx_captions_project ON captions(projectId);
CREATE INDEX IF NOT EXISTS idx_exports_project ON exports(projectId);
`;

export function getLocalDb() {
  if (db) return db;
  const file = process.env.LOCAL_DB_PATH ?? path.resolve(process.cwd(), ".data", "reelio.sqlite");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  return db;
}

/* ────────────────────────── row mapping ────────────────────────── */

const BOOL_COLUMNS = new Set(["hasAudio", "locked", "visible", "muted"]);
const DATE_COLUMNS = new Set(["createdAt", "updatedAt", "lastSignedIn"]);

/** Makes a SQLite row look like the Drizzle/MySQL row the rest of the app expects. */
function mapRow<T>(row: Row | undefined): T | null {
  if (!row) return null;
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) {
    if (BOOL_COLUMNS.has(key)) out[key] = Boolean(value);
    else if (DATE_COLUMNS.has(key) && typeof value === "string") out[key] = new Date(value.replace(" ", "T") + "Z");
    else out[key] = value;
  }
  return out as T;
}

function mapRows<T>(rows: Row[]): T[] {
  return rows.map((r) => mapRow<T>(r)!).filter(Boolean);
}

/** SQLite rejects booleans and undefined; normalize before binding. */
function bind(value: unknown): any {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString().slice(0, 19).replace("T", " ");
  return value;
}

function all<T>(sql: string, params: unknown[] = []): T[] {
  return mapRows<T>(getLocalDb().prepare(sql).all(...params.map(bind)) as Row[]);
}

function one<T>(sql: string, params: unknown[] = []): T | null {
  return mapRow<T>(getLocalDb().prepare(sql).get(...params.map(bind)) as Row | undefined);
}

function run(sql: string, params: unknown[] = []) {
  return getLocalDb().prepare(sql).run(...params.map(bind));
}

/** Builds an INSERT from an object, skipping undefined fields. */
function insert(table: string, data: Record<string, unknown>): number {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined);
  const cols = entries.map(([k]) => `"${k}"`).join(", ");
  const holes = entries.map(() => "?").join(", ");
  const res = run(`INSERT INTO ${table} (${cols}) VALUES (${holes})`, entries.map(([, v]) => v));
  return Number(res.lastInsertRowid);
}

function update(table: string, id: number, data: Record<string, unknown>): void {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;
  const sets = entries.map(([k]) => `"${k}" = ?`).join(", ");
  run(`UPDATE ${table} SET ${sets} WHERE id = ?`, [...entries.map(([, v]) => v), id]);
}

export const localSql = { all, one, run, insert, update };

/* ────────────────────────── repository ────────────────────────── */

import type {
  Asset,
  Caption,
  Clip,
  ExportRow,
  InsertAsset,
  InsertCaption,
  InsertClip,
  InsertExport,
  InsertMarker,
  InsertProject,
  InsertUser,
  Marker,
  Project,
  User,
} from "../../drizzle/schema";

export async function getDb() {
  return getLocalDb();
}

/* users */
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const existing = one<User>(`SELECT * FROM users WHERE openId = ?`, [user.openId]);
  const role = user.role ?? (user.openId === process.env.OWNER_OPEN_ID ? "admin" : undefined);
  if (existing) {
    update("users", existing.id, {
      name: user.name,
      email: user.email,
      loginMethod: user.loginMethod,
      role,
      lastSignedIn: user.lastSignedIn ?? new Date(),
      updatedAt: new Date(),
    });
    return;
  }
  insert("users", {
    openId: user.openId,
    name: user.name,
    email: user.email,
    loginMethod: user.loginMethod,
    role: role ?? "user",
    lastSignedIn: user.lastSignedIn ?? new Date(),
  });
}

export async function getUserByOpenId(openId: string) {
  return one<User>(`SELECT * FROM users WHERE openId = ?`, [openId]) ?? undefined;
}

/* projects */
export async function createProject(userId: number, name: string, description?: string) {
  const id = insert("projects", { userId, name, description });
  return one<Project>(`SELECT * FROM projects WHERE id = ?`, [id])!;
}

export async function getUserProjects(userId: number) {
  return all<Project>(`SELECT * FROM projects WHERE userId = ? ORDER BY updatedAt DESC, id DESC`, [userId]);
}

export async function getProject(id: number, userId: number) {
  return one<Project>(`SELECT * FROM projects WHERE id = ? AND userId = ?`, [id, userId]) ?? undefined;
}

export async function updateProject(id: number, userId: number, name?: string, status?: string) {
  const owned = await getProject(id, userId);
  if (!owned) throw new Error("Project not found");
  update("projects", id, { name, status, updatedAt: new Date() });
}

/** Deletes the project and everything hanging off it; MySQL has no cascade here either. */
export async function deleteProject(id: number, userId: number) {
  const owned = await getProject(id, userId);
  if (!owned) throw new Error("Project not found");
  for (const table of ["clips", "assets", "markers", "captions", "exports"]) {
    run(`DELETE FROM ${table} WHERE projectId = ?`, [id]);
  }
  run(`DELETE FROM projects WHERE id = ? AND userId = ?`, [id, userId]);
}

/* assets */
export async function createAsset(data: InsertAsset) {
  const id = insert("assets", data as Record<string, unknown>);
  return one<Asset>(`SELECT * FROM assets WHERE id = ?`, [id])!;
}

export async function getProjectAssets(projectId: number) {
  return all<Asset>(`SELECT * FROM assets WHERE projectId = ? ORDER BY createdAt, id`, [projectId]);
}

export async function getAsset(id: number) {
  return one<Asset>(`SELECT * FROM assets WHERE id = ?`, [id]) ?? undefined;
}

export async function deleteAsset(id: number) {
  run(`DELETE FROM clips WHERE assetId = ?`, [id]);
  run(`DELETE FROM captions WHERE assetId = ?`, [id]);
  run(`DELETE FROM assets WHERE id = ?`, [id]);
}

/* clips */
export async function createClip(data: InsertClip) {
  const id = insert("clips", data as Record<string, unknown>);
  return one<Clip>(`SELECT * FROM clips WHERE id = ?`, [id])!;
}

export async function getProjectClips(projectId: number) {
  return all<Clip>(`SELECT * FROM clips WHERE projectId = ? ORDER BY trackId, timelineStart, sortIndex`, [projectId]);
}

export async function updateClip(id: number, updates: Partial<InsertClip>) {
  update("clips", id, updates as Record<string, unknown>);
}

export async function getClip(id: number) {
  return one<Clip>(`SELECT * FROM clips WHERE id = ?`, [id]) ?? undefined;
}

export async function deleteClip(id: number, userId: number) {
  const clip = await getClip(id);
  if (!clip) throw new Error("Clip not found");
  const project = await getProject(clip.projectId, userId);
  if (!project) throw new Error("Unauthorized: clip does not belong to this user");
  run(`DELETE FROM clips WHERE id = ?`, [id]);
}

export async function deleteProjectClips(projectId: number) {
  run(`DELETE FROM clips WHERE projectId = ?`, [projectId]);
}

/* markers */
export async function createMarker(data: InsertMarker) {
  const id = insert("markers", data as Record<string, unknown>);
  return one<Marker>(`SELECT * FROM markers WHERE id = ?`, [id])!;
}

export async function getProjectMarkers(projectId: number) {
  return all<Marker>(`SELECT * FROM markers WHERE projectId = ? ORDER BY time`, [projectId]);
}

export async function getMarker(id: number) {
  return one<Marker>(`SELECT * FROM markers WHERE id = ?`, [id]) ?? undefined;
}

export async function deleteMarker(id: number) {
  run(`DELETE FROM markers WHERE id = ?`, [id]);
}

export async function deleteProjectMarkers(projectId: number) {
  run(`DELETE FROM markers WHERE projectId = ?`, [projectId]);
}

/* captions */
export async function createCaption(data: InsertCaption) {
  const id = insert("captions", data as Record<string, unknown>);
  return one<Caption>(`SELECT * FROM captions WHERE id = ?`, [id])!;
}

export async function getProjectCaptions(projectId: number) {
  return all<Caption>(`SELECT * FROM captions WHERE projectId = ? ORDER BY startTime`, [projectId]);
}

export async function getAssetCaptions(assetId: number) {
  return all<Caption>(`SELECT * FROM captions WHERE assetId = ? ORDER BY startTime`, [assetId]);
}

export async function getCaption(id: number) {
  return one<Caption>(`SELECT * FROM captions WHERE id = ?`, [id]) ?? undefined;
}

export async function deleteCaption(id: number) {
  run(`DELETE FROM captions WHERE id = ?`, [id]);
}

export async function deleteProjectCaptions(projectId: number) {
  run(`DELETE FROM captions WHERE projectId = ?`, [projectId]);
}

/* exports */
export async function createExport(data: InsertExport) {
  const id = insert("exports", data as Record<string, unknown>);
  return one<ExportRow>(`SELECT * FROM exports WHERE id = ?`, [id])!;
}

export async function getProjectExports(projectId: number) {
  return all<ExportRow>(`SELECT * FROM exports WHERE projectId = ? ORDER BY createdAt DESC, id DESC`, [projectId]);
}

export async function getExport(id: number) {
  return one<ExportRow>(`SELECT * FROM exports WHERE id = ?`, [id]) ?? undefined;
}

/** Returns the updated row: the client needs the download url after a render. */
export async function updateExport(
  id: number,
  updates: { status?: string; errorMessage?: string | null; storageKey?: string; url?: string; duration?: number },
) {
  update("exports", id, updates as Record<string, unknown>);
  return one<ExportRow>(`SELECT * FROM exports WHERE id = ?`, [id]) ?? undefined;
}

export async function deleteExport(id: number) {
  run(`DELETE FROM exports WHERE id = ?`, [id]);
}
