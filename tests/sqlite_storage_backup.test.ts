import assert from "node:assert/strict";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import {
  createSqliteStorageBackup,
  restoreSqliteStorageBackup,
  SqliteEventProjectionStore,
} from "../packages/storage-sqlite/src/index.js";

const root = await mkdtemp(join(tmpdir(), "la-sqlite-backup-"));

try {
  const databasePath = join(root, "live.sqlite");
  const blobPath = join(root, "source-blob.bin");
  await writeFile(blobPath, Buffer.from("immutable-blob-v1"));
  const store = new SqliteEventProjectionStore(databasePath);
  store.append({
    commandId: "command-before-backup",
    streamId: "task-backup",
    expectedRevision: 0,
    events: [{
      id: "event-before-backup",
      type: "run.started",
      occurredAt: "2026-07-23T01:00:00.000Z",
      payload: { runId: "run-backup" },
    }],
    projection: { status: "running" },
  });

  let authorityChecks = 0;
  const authority = {
    assertOwned: async () => {
      authorityChecks += 1;
    },
  };
  const backupDirectory = join(root, "backup-v1");
  const manifest = await createSqliteStorageBackup({
    store,
    authority,
    backupDirectory,
    blobs: [{ sourcePath: blobPath, relativePath: "sha256/ab/blob.bin" }],
    now: () => new Date("2026-07-23T01:01:00.000Z"),
  });
  assert.equal(authorityChecks, 2, "authority must be checked before snapshot work and before publish");
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.storageSchemaVersion, 2);
  assert.equal(manifest.database.relativePath, "database.sqlite");
  assert.match(manifest.database.sha256, /^[a-f0-9]{64}$/u);
  assert.deepEqual(manifest.blobs.map(({ relativePath, bytes }) => ({ relativePath, bytes })), [
    { relativePath: "sha256/ab/blob.bin", bytes: 17 },
  ]);
  assert.deepEqual(
    JSON.parse(await readFile(join(backupDirectory, "manifest-v1.json"), "utf8")),
    manifest,
  );

  store.append({
    commandId: "command-after-backup",
    streamId: "task-backup",
    expectedRevision: 1,
    events: [{
      id: "event-after-backup",
      type: "run.completed",
      occurredAt: "2026-07-23T01:02:00.000Z",
      payload: {},
    }],
    projection: { status: "completed" },
  });
  store.close();

  const restoredDatabasePath = join(root, "restored", "storage.sqlite");
  const restoredBlobRoot = join(root, "restored-blobs");
  const restored = await restoreSqliteStorageBackup({
    authority,
    backupDirectory,
    targetDatabasePath: restoredDatabasePath,
    targetBlobRoot: restoredBlobRoot,
  });
  assert.deepEqual(restored, manifest);
  const restoredStore = new SqliteEventProjectionStore(restoredDatabasePath);
  assert.equal(restoredStore.currentRevision("task-backup"), 1, "backup must be a consistent pre-mutation snapshot");
  assert.equal(restoredStore.readProjection("task-backup")?.value.status, "running");
  restoredStore.close();
  assert.equal(await readFile(join(restoredBlobRoot, "sha256/ab/blob.bin"), "utf8"), "immutable-blob-v1");
  await assert.rejects(
    restoreSqliteStorageBackup({
      authority,
      backupDirectory,
      targetDatabasePath: restoredDatabasePath,
      targetBlobRoot: restoredBlobRoot,
    }),
    /targetDatabasePath already exists/,
    "restore must never overwrite an existing canonical target",
  );

  const tamperedBackup = join(root, "tampered-backup");
  const tamperedStore = new SqliteEventProjectionStore(databasePath);
  await createSqliteStorageBackup({
    store: tamperedStore,
    authority,
    backupDirectory: tamperedBackup,
  });
  tamperedStore.close();
  await writeFile(join(tamperedBackup, "database.sqlite"), "tampered", "utf8");
  const tamperedTarget = join(root, "tampered-target.sqlite");
  await assert.rejects(
    restoreSqliteStorageBackup({
      authority,
      backupDirectory: tamperedBackup,
      targetDatabasePath: tamperedTarget,
    }),
    /digest mismatch/,
  );
  await assert.rejects(stat(tamperedTarget), { code: "ENOENT" });

  const missingBackup = join(root, "missing-backup");
  const missingStore = new SqliteEventProjectionStore(databasePath);
  await createSqliteStorageBackup({
    store: missingStore,
    authority,
    backupDirectory: missingBackup,
    blobs: [{ sourcePath: blobPath, relativePath: "sha256/ab/blob.bin" }],
  });
  missingStore.close();
  await rm(join(missingBackup, "blobs/sha256/ab/blob.bin"));
  await assert.rejects(
    restoreSqliteStorageBackup({
      authority,
      backupDirectory: missingBackup,
      targetDatabasePath: join(root, "missing-target.sqlite"),
      targetBlobRoot: join(root, "missing-target-blobs"),
    }),
    /backup blob is missing or invalid/,
  );

  const deniedDirectory = join(root, "denied-backup");
  let deniedChecks = 0;
  const deniedStore = new SqliteEventProjectionStore(databasePath);
  try {
    await assert.rejects(createSqliteStorageBackup({
      store: deniedStore,
      authority: {
        assertOwned: async () => {
          deniedChecks += 1;
          if (deniedChecks === 2) throw new Error("writer lease lost");
        },
      },
      backupDirectory: deniedDirectory,
    }), /writer lease lost/);
  } finally {
    deniedStore.close();
  }
  await assert.rejects(stat(deniedDirectory), { code: "ENOENT" });
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("SQLite backup and restore tests passed");
