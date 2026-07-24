import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  LEGACY_TASK_SQLITE_MAPPING_CONTRACT,
  parseLegacyTaskSqliteMappingContract,
  requireMappedLegacyFields,
  SqliteEventProjectionStore,
} from "../packages/storage-sqlite/src/index.js";

const root = await mkdtemp(join(tmpdir(), "la-sqlite-task-mapping-"));

try {
  assert.equal(LEGACY_TASK_SQLITE_MAPPING_CONTRACT.schemaVersion, 1);
  assert.equal(LEGACY_TASK_SQLITE_MAPPING_CONTRACT.storageSchemaVersion, 2);
  assert.deepEqual(
    LEGACY_TASK_SQLITE_MAPPING_CONTRACT.sources.map(({ id, sourceSchemaVersion }) => ({ id, sourceSchemaVersion })),
    [
      { id: "task_workspace", sourceSchemaVersion: 2 },
      { id: "task_run_event", sourceSchemaVersion: 2 },
      { id: "quality_decision_ledger", sourceSchemaVersion: 1 },
      { id: "task_message_queue", sourceSchemaVersion: 1 },
      { id: "task_package_profile", sourceSchemaVersion: 1 },
    ],
  );

  for (const source of LEGACY_TASK_SQLITE_MAPPING_CONTRACT.sources) {
    assert.ok(source.entities.length > 0, `${source.id} must enumerate persisted entities`);
    assert.ok(source.ordering.length > 0, `${source.id} must declare ordering semantics`);
    assert.ok(source.revisions.length > 0, `${source.id} must declare revision/cursor semantics`);
    assert.ok(source.blobBoundaries.length > 0, `${source.id} must declare blob boundaries`);
    for (const entity of source.entities) {
      assert.ok(entity.fields.length > 0, `${source.id}/${entity.id} must enumerate fields`);
      assert.equal(new Set(entity.fields).size, entity.fields.length, `${source.id}/${entity.id} fields must be unique`);
    }
  }

  const parsed = parseLegacyTaskSqliteMappingContract(
    JSON.parse(JSON.stringify(LEGACY_TASK_SQLITE_MAPPING_CONTRACT)),
  );
  assert.deepEqual(parsed, LEGACY_TASK_SQLITE_MAPPING_CONTRACT);
  assert.throws(
    () => parseLegacyTaskSqliteMappingContract({
      ...JSON.parse(JSON.stringify(LEGACY_TASK_SQLITE_MAPPING_CONTRACT)),
      schemaVersion: 2,
    }),
    /schemaVersion must be 1/,
  );
  assert.throws(
    () => parseLegacyTaskSqliteMappingContract({
      ...JSON.parse(JSON.stringify(LEGACY_TASK_SQLITE_MAPPING_CONTRACT)),
      unexpected: true,
    }),
    /unknown field: unexpected/,
  );

  requireMappedLegacyFields("task_workspace", "task", {
    id: "task-1",
    owner: { kind: "standalone" },
    scope: { kind: "standalone", fileGrantIds: [] },
    title: "Synthetic",
    intent: "Synthetic",
    kind: "general",
    status: "active",
    createdAt: "2026-07-23T00:00:00.000Z",
    updatedAt: "2026-07-23T00:00:00.000Z",
  });
  requireMappedLegacyFields("task_workspace", "project_scope", {
    kind: "project",
    batchId: "batch-1",
    segmentIds: ["segment-1"],
    sourceLocale: "en",
    targetLocale: "zh-CN",
  });
  assert.throws(
    () => requireMappedLegacyFields("task_workspace", "task", {
      id: "task-1",
      owner: { kind: "standalone" },
      scope: { kind: "standalone", fileGrantIds: [] },
      title: "Synthetic",
      intent: "Synthetic",
      kind: "general",
      status: "active",
      createdAt: "2026-07-23T00:00:00.000Z",
      updatedAt: "2026-07-23T00:00:00.000Z",
      guessedLegacyField: "must not be imported",
    }),
    /unmapped field: guessedLegacyField/,
  );

  const databasePath = join(root, "mapping.sqlite");
  const store = new SqliteEventProjectionStore(databasePath);
  assert.equal(store.schemaVersion(), 2);
  const storedContract = store.readMappingContract("legacy_task");
  assert.equal(storedContract?.contractVersion, 1);
  assert.match(storedContract?.contractHash ?? "", /^[a-f0-9]{64}$/u);
  assert.deepEqual(storedContract?.contract, LEGACY_TASK_SQLITE_MAPPING_CONTRACT);
  store.close();

  const migrationLedger = new DatabaseSync(databasePath);
  assert.deepEqual(
    migrationLedger.prepare("SELECT version FROM schema_migrations ORDER BY version").all()
      .map((row) => Number((row as Record<string, unknown>).version)),
    [1, 2],
  );
  migrationLedger.close();

  const legacyPath = join(root, "legacy-v1.sqlite");
  const legacy = new DatabaseSync(legacyPath);
  legacy.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT;
    CREATE TABLE streams (stream_id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK (revision >= 0)) STRICT;
    CREATE TABLE events (
      stream_id TEXT NOT NULL REFERENCES streams(stream_id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL CHECK (sequence > 0),
      event_id TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
      PRIMARY KEY (stream_id, sequence)
    ) STRICT;
    CREATE TABLE projections (
      stream_id TEXT PRIMARY KEY REFERENCES streams(stream_id) ON DELETE CASCADE,
      revision INTEGER NOT NULL CHECK (revision >= 0),
      projection_json TEXT NOT NULL CHECK (json_valid(projection_json))
    ) STRICT;
    CREATE TABLE commands (
      command_id TEXT PRIMARY KEY,
      stream_id TEXT NOT NULL REFERENCES streams(stream_id) ON DELETE CASCADE,
      request_json TEXT NOT NULL CHECK (json_valid(request_json)),
      result_json TEXT NOT NULL CHECK (json_valid(result_json))
    ) STRICT;
    INSERT INTO schema_migrations(version, applied_at) VALUES (1, '2026-07-23T00:00:00.000Z');
    PRAGMA user_version = 1;
  `);
  legacy.close();
  const upgraded = new SqliteEventProjectionStore(legacyPath);
  assert.equal(upgraded.schemaVersion(), 2);
  assert.equal(upgraded.readMappingContract("legacy_task")?.contractVersion, 1);
  upgraded.close();
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("SQLite Task mapping contract tests passed");
