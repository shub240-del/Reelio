import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { randomUUID } from "node:crypto";

const freshUrl = process.env.TEST_DATABASE_URL;
const upgradeUrl = process.env.TEST_UPGRADE_DATABASE_URL;
if (!freshUrl || !upgradeUrl) {
  throw new Error(
    "TEST_DATABASE_URL and TEST_UPGRADE_DATABASE_URL are required. Values are intentionally never logged."
  );
}

const migrationFiles = fs
  .readdirSync(path.resolve("drizzle"))
  .filter(file => /^\d{4}_.+\.sql$/.test(file))
  .sort();
assert.deepEqual(migrationFiles.slice(0, 4).map(file => file.slice(0, 4)), [
  "0000",
  "0001",
  "0002",
  "0003",
]);

function migrationStatements(file: string) {
  return fs
    .readFileSync(path.join("drizzle", file), "utf8")
    .split("--> statement-breakpoint")
    .map(statement => statement.trim())
    .filter(Boolean);
}

async function applyMigration(
  connection: mysql.Connection,
  file: string
) {
  for (const statement of migrationStatements(file)) {
    await connection.query(statement);
  }
}

async function freshMigration() {
  const connection = await mysql.createConnection(freshUrl!);
  try {
    for (const file of migrationFiles) await applyMigration(connection, file);
    const [[version]] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT VERSION() AS version"
    );
    const [tables] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()"
    );
    assert.match(String(version.version), /^8\./);
    assert.equal(tables.length, 9);
  } finally {
    await connection.end();
  }
}

async function upgradeMigration() {
  const connection = await mysql.createConnection(upgradeUrl!);
  try {
    for (const file of migrationFiles.slice(0, 3))
      await applyMigration(connection, file);
    await connection.query(
      "INSERT INTO users (openId, name) VALUES ('legacy-user', 'Legacy User')"
    );
    await connection.query(
      "INSERT INTO projects (userId, name) VALUES (1, 'Legacy Project')"
    );
    await connection.query(
      "INSERT INTO assets (projectId,userId,name,storageKey,url,mimeType,sizeBytes,duration,width,height,fps,hasAudio) VALUES (1,1,'legacy.mp4','legacy-key','/legacy','video/mp4',100,10,320,180,30,true)"
    );
    await connection.query(
      "INSERT INTO clips (projectId,assetId,sourceStart,duration,timelineStart) VALUES (1,1,0,5,0)"
    );
    await connection.query(
      "INSERT INTO captions (projectId,assetId,text,startTime,endTime) VALUES (1,1,'Legacy caption',0,1)"
    );
    await connection.query(
      "INSERT INTO markers (projectId,time,label) VALUES (1,1,'Legacy marker')"
    );
    await connection.query(
      "INSERT INTO exports (projectId,userId,storageKey,url,resolution,duration,status,progress) VALUES (1,1,'','','720p',5,'done',100),(1,1,'','','720p',5,'failed',0)"
    );
    await connection.query(
      "INSERT INTO ai_edit_proposals (id,requestId,projectId,userId,instructionHash,baseRevision,planJson,provenanceJson,provider,status) VALUES ('00000000-0000-4000-8000-000000000001','legacy-request',1,1,REPEAT('a',64),REPEAT('b',64),'{\"summary\":\"legacy\",\"operations\":[]}','{}','deterministic','no_action')"
    );
    await applyMigration(connection, migrationFiles[3]);

    const [exports] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT requestId FROM exports ORDER BY id"
    );
    assert.equal(exports.length, 2);
    assert.equal(new Set(exports.map(row => row.requestId)).size, 2);
    assert.ok(exports.every(row => String(row.requestId).startsWith("legacy-")));
    const [[constraints]] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE()"
    );
    const [[indexes]] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(DISTINCT INDEX_NAME) AS count FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND INDEX_NAME <> 'PRIMARY'"
    );
    assert.ok(Number(constraints.count) >= 14);
    assert.ok(Number(indexes.count) >= 12);

    await assert.rejects(
      connection.query(
        "INSERT INTO clips (projectId,assetId,sourceStart,duration,timelineStart) VALUES (999999,999999,0,1,0)"
      ),
      /foreign key constraint/i
    );
    await connection.query("DELETE FROM projects WHERE id = 1");
    for (const table of [
      "assets",
      "clips",
      "captions",
      "markers",
      "exports",
      "ai_edit_proposals",
      "media_analyses",
    ]) {
      const [[row]] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) AS count FROM \`${table}\``
      );
      assert.equal(Number(row.count), 0, `${table} did not cascade`);
    }
  } finally {
    await connection.end();
  }
}

await freshMigration();
await upgradeMigration();

process.env.DATABASE_URL = freshUrl;
const db = await import("../server/db");
const { createTimelineRevision } = await import("../server/aiEdit");
const runId = randomUUID();
await db.upsertUser({
  openId: `mysql-integration-${runId}`,
  name: "MySQL integration",
  lastSignedIn: new Date(),
});
const user = await db.getUserByOpenId(`mysql-integration-${runId}`);
assert.ok(user);
const project = await db.createProject(user.id, `Integration ${runId}`);
const asset = await db.createAsset({
  projectId: project.id,
  userId: user.id,
  name: "fixture.mp4",
  storageKey: `integration/${runId}`,
  url: "/integration-fixture",
  mimeType: "video/mp4",
  sizeBytes: 100,
  duration: 10,
  width: 320,
  height: 180,
  fps: 30,
  hasAudio: true,
});
const clip = await db.createClip({
  projectId: project.id,
  assetId: asset.id,
  trackId: 0,
  trackType: "video",
  sourceStart: 0,
  duration: 10,
  timelineStart: 0,
  sortIndex: 0,
});
await db.createMarker({ projectId: project.id, time: 1, label: "test" });
await db.createCaption({
  projectId: project.id,
  assetId: asset.id,
  text: "test",
  startTime: 0,
  endTime: 1,
});

const canonicalClips = (await db.getProjectClips(project.id)).map(row => ({
  ...row,
  videoFx: row.videoFx ?? null,
  transition: row.transition ?? null,
}));
const canonicalAssets = (await db.getProjectAssets(project.id)).map(row => ({
  id: row.id,
  duration: row.duration,
  hasAudio: row.hasAudio,
  width: row.width,
  height: row.height,
  fps: row.fps,
}));
const revision = createTimelineRevision(canonicalClips, canonicalAssets);
const proposalId = randomUUID();
await db.createAIEditProposal({
  id: proposalId,
  requestId: randomUUID(),
  projectId: project.id,
  userId: user.id,
  instructionHash: "a".repeat(64),
  baseRevision: revision,
  planJson: JSON.stringify({ summary: "trim", operations: [] }),
  provenanceJson: "{}",
  provider: "integration",
  status: "pending",
});
const revisionOf = (clipRows: typeof canonicalClips, assetRows: typeof canonicalAssets) =>
  createTimelineRevision(
    clipRows.map(row => ({
      ...row,
      videoFx: row.videoFx ?? null,
      transition: row.transition ?? null,
    })),
    assetRows.map(row => ({
      id: row.id,
      duration: row.duration,
      hasAudio: row.hasAudio,
      width: row.width,
      height: row.height,
      fps: row.fps,
    }))
  );
const commits = await Promise.all([
  db.commitAIProposalTimeline(
    proposalId,
    project.id,
    user.id,
    revision,
    revisionOf,
    { creates: [], updates: [{ id: clip.id, patch: { duration: 5 } }], deletes: [] }
  ),
  db.commitAIProposalTimeline(
    proposalId,
    project.id,
    user.id,
    revision,
    revisionOf,
    { creates: [], updates: [{ id: clip.id, patch: { duration: 5 } }], deletes: [] }
  ),
]);
assert.deepEqual(
  commits.map(result => result.alreadyApplied).sort(),
  [false, true]
);
assert.equal((await db.getProjectClips(project.id))[0].duration, 5);

const exportRequest = randomUUID();
const exportInput = {
  requestId: exportRequest,
  projectId: project.id,
  userId: user.id,
  storageKey: "",
  url: "",
  resolution: "720p",
  duration: 0,
  status: "queued" as const,
};
const [firstExport, duplicateExport] = await Promise.all([
  db.createExport(exportInput),
  db.createExport(exportInput),
]);
assert.equal(firstExport.id, duplicateExport.id);
await db.updateExport(firstExport.id, { status: "processing", attempt: 1 });
await db.updateExport(firstExport.id, { status: "done", progress: 100 });
assert.equal((await db.getExport(firstExport.id))?.status, "done");

const copy = await db.duplicateProject(project.id, user.id);
assert.ok(copy);
assert.equal((await db.getProjectAssets(copy.id)).length, 1);
assert.equal((await db.getProjectClips(copy.id)).length, 1);
assert.equal((await db.getProjectCaptions(copy.id)).length, 1);
await db.deleteProject(copy.id, user.id);
assert.equal(await db.getProject(copy.id, user.id), undefined);

await db.deleteProject(project.id, user.id);
const cleanup = await mysql.createConnection(freshUrl);
await cleanup.query("DELETE FROM users WHERE id = ?", [user.id]);
await cleanup.end();

console.log(
  JSON.stringify({
    ok: true,
    mysql: "8.x",
    freshMigrations: migrationFiles.length,
    upgradeFrom: "0002",
    foreignKeys: "verified",
    indexes: "verified",
    cascades: "verified",
    concurrentProposalApply: "exactly-once",
    idempotentExport: "verified",
    cleanup: "isolated",
  })
);
// Drizzle's URL shorthand owns an internal pool. This standalone verifier has
// completed all awaited cleanup, so terminate explicitly instead of keeping the
// CI process alive on that pool.
process.exit(0);
