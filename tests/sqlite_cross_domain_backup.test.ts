import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  ContentBlobStore,
  SqliteEventProjectionStore,
} from "../packages/storage-sqlite/src/index.js";
import {
  createCrossDomainSqliteBackup,
  restoreCrossDomainSqliteBackup,
} from "../packages/cat-server/src/cross_domain_sqlite_backup.js";

const root = await mkdtemp(join(tmpdir(), "la-cross-domain-sqlite-"));
const authority = { assertOwned: async () => undefined };

const domains = [
  ["settings-grants-trust", "data/runtime/settings-grants-trust-sqlite-v1/authority-v1.json"],
  ["package-v2", "data/runtime/package-registry-sqlite-v1/authority-v1.json"],
  ["assistant-memory", "data/runtime/assistant-memory-sqlite-v1/authority-v1.json"],
  ["assistant-library", "data/runtime/assistant-library-sqlite-v1/authority-v1.json"],
  ["cat-core", "data/runtime/cat-core-sqlite-v1/authority-v1.json"],
  ["cat-governance", "data/runtime/cat-governance-sqlite-v1/authority-v1.json"],
  ["workflow-eval", "data/runtime/workflow-eval-sqlite-v1/authority-v1.json"],
] as const;
const blobDomains = new Set(["package-v2", "assistant-library", "cat-core"]);

async function seedDomain(domainId: string, markerRelativePath: string): Promise<void> {
  const runtimeDirectory = join(root, markerRelativePath, "..");
  const databasePath = join(runtimeDirectory, `${domainId}.sqlite`);
  const store = new SqliteEventProjectionStore(databasePath);
  store.append({
    commandId: `seed-${domainId}`,
    streamId: `domain-${domainId}`,
    expectedRevision: 0,
    events: [{
      id: `event-${domainId}`,
      type: "synthetic.seeded",
      occurredAt: "2026-07-23T00:00:00.000Z",
      payload: { domainId },
    }],
    projection: { domainId, state: "before-backup" },
  });

  const marker: Record<string, unknown> = {
    schemaVersion: 1,
    authority: "sqlite",
    databaseRelativePath: relative(root, databasePath).replaceAll("\\", "/"),
    backupRootRelativePath: "data/backups/synthetic",
    cutoverAt: "2026-07-23T00:00:00.000Z",
  };
  if (blobDomains.has(domainId)) {
    const blobRoot = join(runtimeDirectory, "blob-store");
    const blobs = new ContentBlobStore(blobRoot, { authority });
    const published = await blobs.putBytes(Buffer.from(`blob-${domainId}`, "utf8"));
    await blobs.publishReference({
      refId: `synthetic:${domainId}`,
      expectedRevision: 0,
      blobs: [published.ref],
      now: () => new Date("2026-07-23T00:00:00.000Z"),
    });
    store.append({
      commandId: `blob-ref-${domainId}`,
      streamId: `blob-${domainId}`,
      expectedRevision: 0,
      events: [{
        id: `blob-event-${domainId}`,
        type: "synthetic.blob_referenced",
        occurredAt: "2026-07-23T00:00:00.000Z",
        payload: { sha256: published.ref.sha256 },
      }],
      projection: domainId === "assistant-library"
        ? { contentBlobRefId: published.ref.sha256 }
        : { blobRefId: published.ref.sha256 },
    });
    marker.blobRootRelativePath = relative(root, blobRoot).replaceAll("\\", "/");
  }
  store.close();
  await mkdir(runtimeDirectory, { recursive: true });
  await writeFile(join(root, markerRelativePath), `${JSON.stringify(marker, null, 2)}\n`);
}

try {
  for (const [domainId, markerRelativePath] of domains) await seedDomain(domainId, markerRelativePath);

  const backupDirectory = join(root, "backup");
  const manifest = await createCrossDomainSqliteBackup({
    root,
    authority,
    backupDirectory,
    now: () => new Date("2026-07-23T00:01:00.000Z"),
  });
  assert.deepEqual(manifest.domains.map((domain) => domain.id), domains.map(([id]) => id));
  assert.equal(manifest.createdAt, "2026-07-23T00:01:00.000Z");
  assert.deepEqual(JSON.parse(await readFile(join(backupDirectory, "manifest-v1.json"), "utf8")), manifest);

  const restoredRoot = join(root, "restored");
  await restoreCrossDomainSqliteBackup({ authority, backupDirectory, targetRoot: restoredRoot });
  for (const [domainId, markerRelativePath] of domains) {
    const marker = JSON.parse(await readFile(join(restoredRoot, markerRelativePath), "utf8")) as { databaseRelativePath: string };
    const restored = new SqliteEventProjectionStore(join(restoredRoot, marker.databaseRelativePath), { readOnly: true });
    assert.equal(restored.schemaVersion(), 2, `${domainId} must retain the current SQLite schema version`);
    assert.equal(restored.currentRevision(`domain-${domainId}`), 1, `${domainId} must restore its pre-mutation event stream`);
    assert.equal(restored.readProjection(`domain-${domainId}`)?.value.state, "before-backup");
    assert.deepEqual(restored.readEvents(`domain-${domainId}`).map((event) => event.id), [`event-${domainId}`], `${domainId} event replay must remain intact`);
    restored.close();
  }

  await assert.rejects(
    restoreCrossDomainSqliteBackup({ authority, backupDirectory, targetRoot: restoredRoot }),
    /targetRoot already exists/,
    "recovery must never overwrite an existing authority root",
  );

  const packageDomain = manifest.domains.find((domain) => domain.id === "package-v2")!;
  const missingBlob = packageDomain.storage.blobs.find((file) => file.relativePath.startsWith("blobs/sha256/"))!;
  await rm(join(backupDirectory, packageDomain.backupRelativePath, "blobs", missingBlob.relativePath));
  await assert.rejects(
    restoreCrossDomainSqliteBackup({ authority, backupDirectory, targetRoot: join(root, "missing-blob-restore") }),
    /missing or invalid/,
    "restore must reject a manifest with a missing blob",
  );

  const catCoreMarker = JSON.parse(await readFile(join(root, domains.find(([id]) => id === "cat-core")![1]), "utf8")) as { blobRootRelativePath: string };
  const catCoreBlobs = new ContentBlobStore(join(root, catCoreMarker.blobRootRelativePath), { authority });
  const orphan = await catCoreBlobs.putBytes(Buffer.from("orphan", "utf8"));
  await assert.rejects(
    createCrossDomainSqliteBackup({ root, authority, backupDirectory: join(root, "orphan-backup") }),
    /cat-core blob is orphaned/,
    "backup must reject an orphaned blob rather than silently preserving it",
  );
  await rm(catCoreBlobs.pathFor(orphan.ref.sha256));

  const memoryMarker = JSON.parse(await readFile(join(root, domains.find(([id]) => id === "assistant-memory")![1]), "utf8")) as { databaseRelativePath: string };
  const invalidForeignKeyDatabase = new DatabaseSync(join(root, memoryMarker.databaseRelativePath));
  invalidForeignKeyDatabase.exec("PRAGMA foreign_keys = OFF; DELETE FROM streams WHERE stream_id = 'domain-assistant-memory';");
  invalidForeignKeyDatabase.close();
  await assert.rejects(
    createCrossDomainSqliteBackup({ root, authority, backupDirectory: join(root, "foreign-key-backup") }),
    /foreign-key/,
    "backup must reject a SQLite domain with broken foreign keys",
  );

  const settingsMarker = JSON.parse(await readFile(join(root, domains[0][1]), "utf8")) as { databaseRelativePath: string };
  const schemaDatabase = new DatabaseSync(join(root, settingsMarker.databaseRelativePath));
  schemaDatabase.exec("PRAGMA user_version = 3;");
  schemaDatabase.close();
  await assert.rejects(
    createCrossDomainSqliteBackup({ root, authority, backupDirectory: join(root, "future-schema-backup") }),
    /schema/,
    "backup must refuse an unrecognized schema upgrade",
  );
  const downgradedDatabase = new DatabaseSync(join(root, settingsMarker.databaseRelativePath));
  downgradedDatabase.exec("PRAGMA user_version = 1;");
  downgradedDatabase.close();
  await assert.rejects(
    createCrossDomainSqliteBackup({ root, authority, backupDirectory: join(root, "old-schema-backup") }),
    /schema/,
    "backup must refuse a schema downgrade",
  );
  console.log("Cross-domain SQLite backup and restore passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
