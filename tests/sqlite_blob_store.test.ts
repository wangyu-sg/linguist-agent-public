import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, stat, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ContentBlobStore,
  BlobDigestMismatchError,
  BlobReferenceRevisionConflictError,
  createSqliteStorageBackup,
  restoreSqliteStorageBackup,
  SqliteEventProjectionStore,
} from "../packages/storage-sqlite/src/index.js";

const root = await mkdtemp(join(tmpdir(), "la-sqlite-blob-store-"));
const authority = { assertOwned: async () => undefined };

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

try {
  const store = new ContentBlobStore(join(root, "blobs"), { authority });
  const bytes = Buffer.from("immutable-content-v1");
  const sha256 = digest(bytes);
  const first = await store.putBytes(bytes, { expectedSha256: sha256 });
  assert.equal(first.status, "published");
  const second = await store.putBytes(bytes, { expectedSha256: sha256 });
  assert.equal(second.status, "deduplicated");
  assert.deepEqual(second.ref, first.ref);
  assert.equal((await store.readBytes(first.ref)).toString("utf8"), "immutable-content-v1");
  assert.equal((await stat(store.pathFor(first.ref.sha256))).mode & 0o222, 0, "published bytes must be read-only");
  await assert.rejects(
    store.putBytes(bytes, { expectedSha256: "0".repeat(64) }),
    BlobDigestMismatchError,
  );

  const ref = await store.publishReference({
    refId: "asset:one",
    expectedRevision: 0,
    blobs: [first.ref],
  });
  assert.equal(ref.revision, 1);
  assert.deepEqual((await store.readReference("asset:one"))?.blobs, [first.ref]);
  await assert.rejects(
    store.publishReference({
      refId: "asset:one",
      expectedRevision: 0,
      blobs: [first.ref],
    }),
    BlobReferenceRevisionConflictError,
  );
  assert.deepEqual((await store.inspect()).orphanBlobs, [], "referenced blob is not orphaned");
  const concurrent = await Promise.allSettled([
    store.publishReference({ refId: "asset:one", expectedRevision: 1, blobs: [] }),
    store.publishReference({ refId: "asset:one", expectedRevision: 1, blobs: [] }),
  ]);
  assert.equal(concurrent.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(concurrent.filter(({ status }) => status === "rejected").length, 1);
  assert.deepEqual((await store.inspect()).orphanBlobs, [first.ref.sha256], "removed refs are reported as orphaned");

  await mkdir(join(root, "blobs", ".staging", "stray"), { recursive: true });
  await writeFile(join(root, "blobs", ".staging", "stray", "partial"), "partial");
  const invalidRefPath = store.referencePathFor("invalid:ref");
  await mkdir(join(invalidRefPath, ".."), { recursive: true });
  await writeFile(invalidRefPath, "not-json", "utf8");
  const missingBlobRef = {
    schemaVersion: 1 as const,
    refId: "orphan:ref",
    revision: 1,
    createdAt: "2026-07-23T22:00:00.000Z",
    blobs: [{ schemaVersion: 1 as const, sha256: "1".repeat(64), bytes: 7 }],
  };
  const missingBlobRefPath = store.referencePathFor(missingBlobRef.refId);
  await mkdir(join(missingBlobRefPath, ".."), { recursive: true });
  await writeFile(
    missingBlobRefPath,
    `${JSON.stringify({ ...missingBlobRef, manifestSha256: digest(Buffer.from(JSON.stringify(missingBlobRef))) }, null, 2)}\n`,
    "utf8",
  );
  const recovery = await store.inspect();
  assert.deepEqual(recovery.orphanStaging, ["stray"]);
  assert.ok(recovery.invalidReferences.includes("orphan:ref"));
  assert.equal(recovery.invalidReferences.length, 2);
  assert.deepEqual(recovery.orphanBlobs, [first.ref.sha256], "removed refs remain detectable as orphaned");
  await store.recover({ pruneStaging: true });
  assert.deepEqual((await store.inspect()).orphanStaging, []);

  const failureRoot = join(root, "failure");
  let checks = 0;
  const failingStore = new ContentBlobStore(failureRoot, {
    authority: {
      assertOwned: async () => {
        checks += 1;
        if (checks === 3) throw new Error("writer lease lost");
      },
    },
  });
  const orphanBytes = Buffer.from("orphan-after-metadata-failure");
  await assert.rejects(
    failingStore.putBytes(orphanBytes, { expectedSha256: digest(orphanBytes) }),
    /writer lease lost/,
  );
  const failedRecovery = await failingStore.inspect();
  assert.deepEqual(failedRecovery.orphanBlobs, [digest(orphanBytes)]);

  const databasePath = join(root, "live.sqlite");
  const sqlite = new SqliteEventProjectionStore(databasePath);
  const backupDirectory = join(root, "backup-v1");
  const manifest = await createSqliteStorageBackup({
    store: sqlite,
    authority,
    backupDirectory,
    blobs: [{ sourcePath: store.pathFor(first.ref.sha256), relativePath: `sha256/${first.ref.sha256.slice(0, 2)}/${first.ref.sha256}` }],
  });
  assert.deepEqual(manifest.blobs.map(({ relativePath }) => relativePath), [
    `sha256/${first.ref.sha256.slice(0, 2)}/${first.ref.sha256}`,
  ]);
  sqlite.close();
  const restoredDatabasePath = join(root, "restored.sqlite");
  const restoredBlobRoot = join(root, "restored-blobs");
  await restoreSqliteStorageBackup({
    authority,
    backupDirectory,
    targetDatabasePath: restoredDatabasePath,
    targetBlobRoot: restoredBlobRoot,
  });
  assert.equal(
    await readFile(join(restoredBlobRoot, "sha256", first.ref.sha256.slice(0, 2), first.ref.sha256), "utf8"),
    "immutable-content-v1",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("sqlite_blob_store.test.ts passed");
