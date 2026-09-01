import {
  bigint,
  boolean,
  double,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
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
export const projects = mysqlTable(
  "projects",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 256 }).notNull(),
    description: text("description"),
    status: mysqlEnum("status", ["draft", "editing", "exporting", "done"])
      .default("draft")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("projects_user_idx").on(table.userId)]
);

export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;

/* ─── Assets (uploaded media) ─── */
export const assets = mysqlTable(
  "assets",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: int("projectId")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
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
  },
  table => [
    index("assets_project_idx").on(table.projectId),
    index("assets_user_idx").on(table.userId),
  ]
);

export type Asset = typeof assets.$inferSelect;
export type InsertAsset = typeof assets.$inferInsert;

/* ─── Clips (timeline entries) ─── */
export const clips = mysqlTable(
  "clips",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: int("projectId")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    assetId: int("assetId")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    trackId: int("trackId").notNull().default(0),
    trackType: mysqlEnum("trackType", ["video", "audio"])
      .default("video")
      .notNull(),
    sourceStart: double("sourceStart").notNull(),
    duration: double("duration").notNull(),
    timelineStart: double("timelineStart").notNull(),
    sortIndex: int("sortIndex").notNull().default(0),
    zIndex: int("zIndex").notNull().default(0),
    volume: double("volume").notNull().default(1),
    trackVolume: double("trackVolume").notNull().default(1),
    positionX: double("positionX").notNull().default(0),
    positionY: double("positionY").notNull().default(0),
    scale: double("scale").notNull().default(1),
    cropLeft: double("cropLeft").notNull().default(0),
    cropTop: double("cropTop").notNull().default(0),
    cropRight: double("cropRight").notNull().default(0),
    cropBottom: double("cropBottom").notNull().default(0),
    locked: boolean("locked").notNull().default(false),
    visible: boolean("visible").notNull().default(true),
    muted: boolean("muted").notNull().default(false),
    videoFx: varchar("videoFx", { length: 64 }),
    transition: varchar("transition", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("clips_project_timeline_idx").on(
      table.projectId,
      table.timelineStart,
      table.trackId
    ),
    index("clips_asset_idx").on(table.assetId),
  ]
);

export type Clip = typeof clips.$inferSelect;
export type InsertClip = typeof clips.$inferInsert;

/* ─── Timeline markers ─── */
export const markers = mysqlTable("markers", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  time: double("time").notNull(),
  label: varchar("label", { length: 256 }),
  color: varchar("color", { length: 32 }).default("#7c5cff").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Marker = typeof markers.$inferSelect;
export type InsertMarker = typeof markers.$inferInsert;

/* ─── Captions ─── */
export const captions = mysqlTable(
  "captions",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: int("projectId")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    assetId: int("assetId")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    startTime: double("startTime").notNull(),
    endTime: double("endTime").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("captions_project_time_idx").on(table.projectId, table.startTime),
    index("captions_asset_idx").on(table.assetId),
  ]
);

export type Caption = typeof captions.$inferSelect;
export type InsertCaption = typeof captions.$inferInsert;

/* ─── Export history ─── */
export const exports = mysqlTable(
  "exports",
  {
    id: int("id").autoincrement().primaryKey(),
    requestId: varchar("requestId", { length: 64 }).notNull(),
    projectId: int("projectId")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    storageKey: varchar("storageKey", { length: 512 }).notNull(),
    url: varchar("url", { length: 512 }).notNull(),
    resolution: varchar("resolution", { length: 32 }).notNull(),
    format: varchar("format", { length: 16 }).default("mp4").notNull(),
    includeCaptions: boolean("includeCaptions").default(false).notNull(),
    duration: double("duration").notNull(),
    status: mysqlEnum("status", [
      "queued",
      "processing",
      "done",
      "failed",
      "cancelled",
    ])
      .default("queued")
      .notNull(),
    progress: int("progress").default(0).notNull(),
    attempt: int("attempt").default(0).notNull(),
    errorMessage: text("errorMessage"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    uniqueIndex("exports_user_request_unique").on(table.userId, table.requestId),
    index("exports_project_created_idx").on(table.projectId, table.createdAt),
    index("exports_status_idx").on(table.status, table.createdAt),
  ]
);

export type ExportRow = typeof exports.$inferSelect;
export type InsertExport = typeof exports.$inferInsert;

/* ─── AI edit proposals ─── */
export const aiEditProposals = mysqlTable(
  "ai_edit_proposals",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    requestId: varchar("requestId", { length: 64 }).notNull(),
    projectId: int("projectId")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    instructionHash: varchar("instructionHash", { length: 64 }).notNull(),
    baseRevision: varchar("baseRevision", { length: 64 }).notNull(),
    planJson: text("planJson").notNull(),
    provenanceJson: text("provenanceJson").notNull(),
    provider: varchar("provider", { length: 64 }).notNull(),
    status: mysqlEnum("status", [
      "pending",
      "applied",
      "rejected",
      "cancelled",
      "no_action",
    ])
      .default("pending")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    uniqueIndex("ai_edit_proposals_user_request_unique").on(
      table.userId,
      table.requestId
    ),
    index("ai_edit_proposals_project_status_idx").on(
      table.projectId,
      table.status,
      table.createdAt
    ),
  ]
);

export type AIEditProposalRow = typeof aiEditProposals.$inferSelect;
export type InsertAIEditProposal = typeof aiEditProposals.$inferInsert;

/* ─── Durable media-analysis jobs and measured results ─── */
export const mediaAnalyses = mysqlTable(
  "media_analyses",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    requestId: varchar("requestId", { length: 64 }).notNull(),
    projectId: int("projectId")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    assetId: int("assetId")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: mysqlEnum("kind", ["transcription", "scene"])
      .notNull(),
    status: mysqlEnum("status", [
      "queued",
      "processing",
      "done",
      "failed",
      "cancelled",
    ])
      .default("queued")
      .notNull(),
    progress: int("progress").default(0).notNull(),
    attempt: int("attempt").default(0).notNull(),
    provider: varchar("provider", { length: 64 }).notNull(),
    resultJson: text("resultJson"),
    errorMessage: text("errorMessage"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    uniqueIndex("media_analyses_user_request_unique").on(
      table.userId,
      table.requestId
    ),
    index("media_analyses_asset_kind_idx").on(table.assetId, table.kind),
    index("media_analyses_status_idx").on(table.status, table.createdAt),
  ]
);

export type MediaAnalysis = typeof mediaAnalyses.$inferSelect;
export type InsertMediaAnalysis = typeof mediaAnalyses.$inferInsert;
