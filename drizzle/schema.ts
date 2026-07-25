import {
  bigint,
  boolean,
  double,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

/* ─── Users ─── */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/* ─── Projects ─── */
export const projects = mysqlTable("projects", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 256 }).notNull(),
  description: text("description"),
  status: mysqlEnum("status", ["draft", "editing", "exporting", "done"]).default("draft").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;

/* ─── Assets (uploaded media) ─── */
export const assets = mysqlTable("assets", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 512 }).notNull(),
  storageKey: varchar("storageKey", { length: 512 }).notNull(),
  url: varchar("url", { length: 512 }).notNull(),
  mimeType: varchar("mimeType", { length: 128 }).notNull(),
  sizeBytes: bigint("sizeBytes", { mode: "number" }).notNull(),
  duration: double("duration").notNull(),
  width: int("width").notNull(),
  height: int("height").notNull(),
  fps: double("fps").notNull(),
  hasAudio: boolean("hasAudio").notNull().default(false),
  thumbnailKey: varchar("thumbnailKey", { length: 512 }),
  thumbnailUrl: varchar("thumbnailUrl", { length: 512 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Asset = typeof assets.$inferSelect;
export type InsertAsset = typeof assets.$inferInsert;

/* ─── Clips (timeline entries) ─── */
export const clips = mysqlTable("clips", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  assetId: int("assetId").notNull(),
  trackId: int("trackId").notNull().default(0),
  trackType: mysqlEnum("trackType", ["video", "audio"]).default("video").notNull(),
  sourceStart: double("sourceStart").notNull(),
  duration: double("duration").notNull(),
  timelineStart: double("timelineStart").notNull(),
  sortIndex: int("sortIndex").notNull().default(0),
  locked: boolean("locked").notNull().default(false),
  visible: boolean("visible").notNull().default(true),
  muted: boolean("muted").notNull().default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Clip = typeof clips.$inferSelect;
export type InsertClip = typeof clips.$inferInsert;

/* ─── Timeline markers ─── */
export const markers = mysqlTable("markers", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  time: double("time").notNull(),
  label: varchar("label", { length: 256 }),
  color: varchar("color", { length: 32 }).default("#f97316").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Marker = typeof markers.$inferSelect;
export type InsertMarker = typeof markers.$inferInsert;

/* ─── Captions ─── */
export const captions = mysqlTable("captions", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  assetId: int("assetId").notNull(),
  text: text("text").notNull(),
  startTime: double("startTime").notNull(),
  endTime: double("endTime").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Caption = typeof captions.$inferSelect;
export type InsertCaption = typeof captions.$inferInsert;

/* ─── Export history ─── */
export const exports = mysqlTable("exports", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  storageKey: varchar("storageKey", { length: 512 }).notNull(),
  url: varchar("url", { length: 512 }).notNull(),
  resolution: varchar("resolution", { length: 32 }).notNull(),
  format: varchar("format", { length: 16 }).default("mp4").notNull(),
  duration: double("duration").notNull(),
  status: mysqlEnum("status", ["processing", "done", "failed"]).default("processing").notNull(),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ExportRow = typeof exports.$inferSelect;
export type InsertExport = typeof exports.$inferInsert;
