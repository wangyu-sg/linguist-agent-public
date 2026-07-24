import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  SqliteIdempotencyConflictError,
  SqliteRevisionConflictError,
  SqliteEventProjectionStore,
} from "../packages/storage-sqlite/src/index.js";

const root = await mkdtemp(join(tmpdir(), "la-sqlite-foundation-"));
const databasePath = join(root, "foundation.sqlite");

try {
  const store = new SqliteEventProjectionStore(databasePath);
  assert.equal(store.schemaVersion(), 2);
  assert.equal(store.journalMode(), "wal");

  const first = {
    commandId: "command-1",
    streamId: "task-1",
    expectedRevision: 0,
    events: [
      { id: "event-1", type: "run.started", occurredAt: "2026-07-23T00:00:00.000Z", payload: { runId: "run-1" } },
      { id: "event-2", type: "message.created", occurredAt: "2026-07-23T00:00:01.000Z", payload: { messageId: "message-1" } },
    ],
    projection: { status: "running", activeRunId: "run-1" },
  } as const;

  const firstResult = store.append(first);
  assert.deepEqual(firstResult, {
    streamId: "task-1",
    previousRevision: 0,
    revision: 2,
    eventIds: ["event-1", "event-2"],
  });
  assert.equal((await stat(`${databasePath}-wal`)).isFile(), true);
  assert.deepEqual(store.readProjection("task-1"), {
    streamId: "task-1",
    revision: 2,
    value: { status: "running", activeRunId: "run-1" },
  });
  assert.deepEqual(store.readEvents("task-1").map(({ sequence, id, type }) => ({ sequence, id, type })), [
    { sequence: 1, id: "event-1", type: "run.started" },
    { sequence: 2, id: "event-2", type: "message.created" },
  ]);

  assert.deepEqual(store.append(first), firstResult, "same command must return the original result");
  assert.equal(store.readEvents("task-1").length, 2, "idempotent retry must not append twice");
  assert.throws(
    () => store.append({ ...first, projection: { status: "changed" } }),
    SqliteIdempotencyConflictError,
    "a command ID must not be reused for different input",
  );

  const concurrent = new SqliteEventProjectionStore(databasePath);
  assert.throws(
    () => concurrent.append({
      commandId: "command-concurrent-stale",
      streamId: "task-1",
      expectedRevision: 0,
      events: [{ id: "event-concurrent", type: "stale", occurredAt: "2026-07-23T00:00:02.000Z", payload: {} }],
      projection: { status: "stale" },
    }),
    SqliteRevisionConflictError,
    "a second connection must observe the canonical revision under WAL",
  );
  concurrent.close();

  assert.throws(
    () => store.append({
      commandId: "command-stale",
      streamId: "task-1",
      expectedRevision: 1,
      events: [{ id: "event-stale", type: "stale", occurredAt: "2026-07-23T00:00:02.000Z", payload: {} }],
      projection: { status: "stale" },
    }),
    SqliteRevisionConflictError,
  );
  assert.equal(store.currentRevision("task-1"), 2);

  assert.throws(
    () => store.append({
      commandId: "command-rollback",
      streamId: "task-1",
      expectedRevision: 2,
      events: [
        { id: "event-duplicate", type: "first", occurredAt: "2026-07-23T00:00:03.000Z", payload: {} },
        { id: "event-duplicate", type: "second", occurredAt: "2026-07-23T00:00:04.000Z", payload: {} },
      ],
      projection: { status: "must-not-commit" },
    }),
    /UNIQUE constraint failed/,
    "a mid-transaction failure must roll back stream, event, projection and command rows",
  );
  assert.equal(store.currentRevision("task-1"), 2);
  assert.equal(store.readEvents("task-1").length, 2);
  assert.equal(store.readProjection("task-1")?.value.status, "running");
  assert.throws(
    () => store.append({
      commandId: "command-invalid-json",
      streamId: "task-1",
      expectedRevision: 2,
      events: [{
        id: "event-invalid-json",
        type: "invalid",
        occurredAt: "2026-07-23T00:00:05.000Z",
        payload: { value: Number.NaN },
      }],
      projection: { status: "invalid" },
    }),
    /non-finite number/,
  );
  assert.equal(store.quickCheck(), "ok");
  store.close();

  const reopened = new SqliteEventProjectionStore(databasePath);
  assert.equal(reopened.currentRevision("task-1"), 2);
  assert.equal(reopened.readEvents("task-1").length, 2);
  reopened.close();

  const unsupported = new DatabaseSync(databasePath);
  unsupported.exec("PRAGMA user_version = 3");
  unsupported.close();
  assert.throws(() => new SqliteEventProjectionStore(databasePath), /unsupported SQLite schema version 3/);

  const incomplete = new DatabaseSync(databasePath);
  incomplete.exec("PRAGMA user_version = 2; DROP TABLE commands");
  incomplete.close();
  assert.throws(() => new SqliteEventProjectionStore(databasePath), /no such table: commands/);

  const productionRoots = [
    "packages/cat-data",
    "packages/cat-runtime",
    "packages/cat-server",
    "packages/cat-tools",
    "apps/desktop/src",
  ];
  const productionFiles = (
    await Promise.all(productionRoots.map(async (relativeRoot) => (
      await readdir(join(process.cwd(), relativeRoot), { recursive: true })
    ).filter((entry) => /\.(?:[cm]?js|tsx?)$/.test(entry)).map((entry) => join(relativeRoot, entry))))
  ).flat();
  const nonAuthoritativeStorageHelpers = [
    "packages/cat-server/src/cross_domain_sqlite_backup.ts",
  ] as const;
  assert.deepEqual(
    [...nonAuthoritativeStorageHelpers],
    ["packages/cat-server/src/cross_domain_sqlite_backup.ts"],
    "only the named LA-100 aggregate backup/recovery helper may use storage primitives without being a domain cutover owner",
  );
  for (const relativePath of productionFiles) {
    const connectsStorage = (await readFile(join(process.cwd(), relativePath), "utf8"))
      .includes("storage-sqlite");
    const isCutoverOwner = [
      "packages/cat-server/src/task_aggregate_sqlite_cutover.ts",
      "packages/cat-server/src/task_aggregate_legacy_rollback.ts",
      "packages/cat-server/src/settings_grants_trust_sqlite_cutover.ts",
      "packages/cat-server/src/lapkg_sqlite_cutover.ts",
      "packages/cat-server/src/assistant_memory_sqlite_cutover.ts",
      "packages/cat-server/src/assistant_library_sqlite_cutover.ts",
      "packages/cat-server/src/cat_core_sqlite_cutover.ts",
      "packages/cat-server/src/cat_governance_sqlite_cutover.ts",
      "packages/cat-server/src/workflow_eval_sqlite_cutover.ts",
    ].includes(relativePath);
    const isNonAuthoritativeStorageHelper = nonAuthoritativeStorageHelpers.includes(relativePath as typeof nonAuthoritativeStorageHelpers[number]);
    assert.equal(
      connectsStorage,
      isCutoverOwner || isNonAuthoritativeStorageHelper,
      `${relativePath} must not bypass its domain-specific SQLite cutover owner`,
    );
  }
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("SQLite event/projection foundation tests passed");
