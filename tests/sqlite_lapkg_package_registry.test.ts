import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as tar from "tar";
import {
  activateLapkg,
  lapkgV2Root,
  listActivatedLapkgPackages,
  makeLapkgTreeRemovable,
  resolveActivatedLapkgResources,
} from "../packages/cat-server/src/lapkg_activation.js";
import {
  createLapkgSignaturePayload,
  type LapkgTrustRootV1,
} from "../packages/cat-server/src/lapkg_signature.js";
import { inspectLapkgArchive, type LapkgManifestV1 } from "../packages/cat-server/src/lapkg_format.js";
import { previewLapkgInstall } from "../packages/cat-server/src/lapkg_preview.js";
import {
  createLapkgSqlitePackageStorage,
  prepareLapkgSqliteCutover,
} from "../packages/cat-server/src/lapkg_sqlite_cutover.js";
import { recoverLapkgActivation } from "../packages/cat-server/src/lapkg_activation_recovery.js";
import { SqliteEventProjectionStore } from "@linguist-agent/storage-sqlite";

const now = new Date("2026-07-23T12:00:00.000Z");
const fixtureRoot = await mkdtemp(join(tmpdir(), "la-lapkg-sqlite-fixture-"));
const runtimeRoot = await mkdtemp(join(tmpdir(), "la-lapkg-sqlite-runtime-"));
const keys = generateKeyPairSync("ed25519");
const trustRoot: LapkgTrustRootV1 = {
  schemaVersion: 1,
  keyId: "sqlite-package-2026",
  publisherId: "example",
  algorithm: "ed25519",
  publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
  status: "active",
};

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function signedPackage(id: string, text: string): Promise<Buffer> {
  const base = join(fixtureRoot, id.replaceAll(".", "-"));
  const tree = join(base, "tree");
  await mkdir(join(tree, "resources", "review"), { recursive: true });
  const manifest: LapkgManifestV1 = {
    schemaVersion: 1,
    id,
    version: "1.0.0",
    publisher: { id: "example" },
    license: "MIT",
    resources: [{
      id: "review",
      type: "skill",
      path: "resources/review/SKILL.md",
      sha256: sha256(text),
      mediaType: "text/markdown",
    }],
    signature: { algorithm: "ed25519", keyId: trustRoot.keyId, value: Buffer.alloc(64).toString("base64") },
  };
  const archive = async (name: string): Promise<string> => {
    await writeFile(join(tree, "lapkg.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(join(tree, "resources", "review", "SKILL.md"), text);
    const path = join(base, `${name}.lapkg`);
    await tar.c({ file: path, cwd: tree, portable: true }, ["lapkg.json", "resources"]);
    return path;
  };
  const draft = await inspectLapkgArchive(await archive("draft"));
  manifest.signature.value = sign(null, createLapkgSignaturePayload(draft), keys.privateKey).toString("base64");
  return readFile(await archive("signed"));
}

const authority = { assertOwned: async () => undefined };
const storageRoot = join(runtimeRoot, "data", "runtime", "package-registry-sqlite-v1");
const storage = await createLapkgSqlitePackageStorage({ root: runtimeRoot, authority });

try {
  const bytes = await signedPackage("example.sqlite-pack", "---\nname: review\ndescription: Review\n---\nSQLite.\n");
  const preview = await previewLapkgInstall({
    archiveBytes: bytes,
    source: {
      schemaVersion: 1,
      kind: "local_file",
      sourceId: "picker:sqlite-pack",
      acquiredAt: "2026-07-23T11:59:00.000Z",
      expectedArchiveSha256: sha256(bytes),
    },
    trustRoots: [trustRoot],
  }, { now, ttlMs: 60_000 });
  const activated = await activateLapkg({
    runtimeRoot,
    archiveBytes: bytes,
    preview,
    expectedPlanHash: preview.planHash,
    trustRoots: [trustRoot],
    storage,
  }, { now });
  assert.equal(activated.contentBlobRefId?.startsWith("lapkg:"), true);
  assert.equal((await listActivatedLapkgPackages(runtimeRoot, { storage })).packages.length, 1);
  assert.equal((await resolveActivatedLapkgResources(runtimeRoot, { storage })).skills.length, 1);
  assert.equal((await storage.readJournal()), null);
  assert.equal((await storage.inspectContent()).references.length, 1);
  await assert.rejects(
    stat(join(lapkgV2Root(runtimeRoot), "registry-v2.json")),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT",
  );

  storage.close();
  const reopened = await createLapkgSqlitePackageStorage({ root: runtimeRoot, authority });
  assert.equal((await listActivatedLapkgPackages(runtimeRoot, { storage: reopened })).packages[0]?.packageId, "example.sqlite-pack");
  reopened.close();

  const legacyRoot = await mkdtemp(join(tmpdir(), "la-lapkg-sqlite-legacy-"));
  try {
    const legacyBytes = await signedPackage("example.legacy-pack", "---\nname: legacy\ndescription: Legacy\n---\nLegacy.\n");
    const legacyPreview = await previewLapkgInstall({
      archiveBytes: legacyBytes,
      source: { schemaVersion: 1, kind: "local_file", sourceId: "picker:legacy", acquiredAt: now.toISOString(), expectedArchiveSha256: sha256(legacyBytes) },
      trustRoots: [trustRoot],
    }, { now, ttlMs: 60_000 });
    await activateLapkg({ runtimeRoot: legacyRoot, archiveBytes: legacyBytes, preview: legacyPreview, expectedPlanHash: legacyPreview.planHash, trustRoots: [trustRoot] }, { now });
    const prepared = await prepareLapkgSqliteCutover({ repoRoot: legacyRoot, authority, activeRunCount: 0, now: () => now });
    assert.equal(prepared.status, "cutover");
    assert.equal(prepared.marker.authority, "sqlite");
    assert.equal((await listActivatedLapkgPackages(legacyRoot, { storage: prepared.storage })).packages[0]?.contentBlobRefId?.startsWith("lapkg:"), true);
    prepared.close();
    await assert.rejects(
      listActivatedLapkgPackages(legacyRoot),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "LAPKG_RECOVERY_REQUIRED",
    );
    const reopenedPrepared = await prepareLapkgSqliteCutover({ repoRoot: legacyRoot, authority, activeRunCount: 0, now: () => now });
    assert.equal(reopenedPrepared.status, "already-sqlite");
    reopenedPrepared.close();
  } finally {
    await makeLapkgTreeRemovable(legacyRoot);
    await rm(legacyRoot, { recursive: true, force: true });
  }

  const crashRoot = await mkdtemp(join(tmpdir(), "la-lapkg-sqlite-crash-"));
  const crashStorage = await createLapkgSqlitePackageStorage({ root: crashRoot, authority });
  try {
    const crashBytes = await signedPackage("example.sqlite-crash", "---\nname: crash\ndescription: Crash\n---\nCrash.\n");
    const crashPreview = await previewLapkgInstall({
      archiveBytes: crashBytes,
      source: { schemaVersion: 1, kind: "local_file", sourceId: "picker:crash", acquiredAt: now.toISOString(), expectedArchiveSha256: sha256(crashBytes) },
      trustRoots: [trustRoot],
    }, { now, ttlMs: 60_000 });
    await assert.rejects(activateLapkg({ runtimeRoot: crashRoot, archiveBytes: crashBytes, preview: crashPreview, expectedPlanHash: crashPreview.planHash, trustRoots: [trustRoot], storage: crashStorage }, { now, faultInjectionCrashAfter: "registry_renamed" }));
    const recovered = await recoverLapkgActivation(crashRoot, { exclusiveStartup: true, now, storage: crashStorage });
    assert.equal(recovered.status, "finalized");
    assert.equal((await listActivatedLapkgPackages(crashRoot, { storage: crashStorage })).packages.length, 1);
  } finally {
    crashStorage.close();
    await makeLapkgTreeRemovable(crashRoot);
    await rm(crashRoot, { recursive: true, force: true });
  }

  console.log("SQLite .lapkg registry/content tests passed");
} finally {
  await makeLapkgTreeRemovable(runtimeRoot);
  await makeLapkgTreeRemovable(fixtureRoot);
  await rm(storageRoot, { recursive: true, force: true }).catch(() => undefined);
  await rm(fixtureRoot, { recursive: true, force: true });
  await rm(runtimeRoot, { recursive: true, force: true });
}
