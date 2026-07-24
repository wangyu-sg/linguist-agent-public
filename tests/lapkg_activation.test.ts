import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as tar from "tar";
import {
  activateLapkg,
  LapkgActivationError,
  listActivatedLapkgPackages,
  resolveActivatedLapkgResources,
} from "../packages/cat-server/src/lapkg_activation.js";
import { inspectLapkgArchive, type LapkgManifestV1 } from "../packages/cat-server/src/lapkg_format.js";
import { previewLapkgInstall } from "../packages/cat-server/src/lapkg_preview.js";
import { createLapkgSignaturePayload, type LapkgTrustRootV1 } from "../packages/cat-server/src/lapkg_signature.js";

const fixtureRoot = await mkdtemp(join(tmpdir(), "la-lapkg-activation-fixtures-"));
const runtimeRoot = await mkdtemp(join(tmpdir(), "la-lapkg-activation-runtime-"));
const now = new Date("2026-07-22T12:00:00.000Z");
const keys = generateKeyPairSync("ed25519");
const trustRoot: LapkgTrustRootV1 = {
  schemaVersion: 1,
  keyId: "example-activation-2026",
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
  const directory = join(base, "tree");
  await mkdir(join(directory, "resources", "review"), { recursive: true });
  const manifest: LapkgManifestV1 = {
    schemaVersion: 1,
    id,
    version: "1.0.0",
    publisher: { id: "example" },
    license: "MIT",
    resources: [{
      id: "review-skill",
      type: "skill",
      path: "resources/review/SKILL.md",
      sha256: sha256(text),
      mediaType: "text/markdown",
    }],
    signature: {
      algorithm: "ed25519",
      keyId: trustRoot.keyId,
      value: Buffer.alloc(64).toString("base64"),
    },
  };
  const writeArchive = async (name: string): Promise<string> => {
    await writeFile(join(directory, "lapkg.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(join(directory, "resources", "review", "SKILL.md"), text);
    const archive = join(base, `${name}.lapkg`);
    await tar.c({ file: archive, cwd: directory, portable: true }, ["lapkg.json", "resources"]);
    return archive;
  };
  const draft = await inspectLapkgArchive(await writeArchive("draft"));
  manifest.signature.value = sign(null, createLapkgSignaturePayload(draft), keys.privateKey).toString("base64");
  return readFile(await writeArchive("signed"));
}

async function rejectsActivation(action: () => unknown | Promise<unknown>, code: LapkgActivationError["code"]): Promise<void> {
  await assert.rejects(Promise.resolve().then(action), (error: unknown) => error instanceof LapkgActivationError && error.code === code);
}

async function makeRemovable(directory: string): Promise<void> {
  await chmod(directory, 0o755).catch(() => undefined);
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => makeRemovable(join(directory, entry.name))));
}

try {
  const bytes = await signedPackage("example.activation-pack", "---\nname: review\ndescription: Review\n---\nReview.\n");
  const preview = await previewLapkgInstall({
    archiveBytes: bytes,
    source: {
      schemaVersion: 1,
      kind: "local_file",
      sourceId: "picker:activation-1",
      acquiredAt: "2026-07-22T11:59:00.000Z",
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
  }, { now });
  assert.equal(activated.packageId, "example.activation-pack");
  assert.equal(activated.previewPlanHash, preview.planHash);
  assert.equal(activated.treeHash, preview.treeHash);
  assert.equal((await stat(activated.contentPath)).isDirectory(), true);
  assert.equal(sha256(await readFile(join(activated.contentPath, "resources", "review", "SKILL.md"))), preview.resources[0]?.sha256);
  assert.equal((await listActivatedLapkgPackages(runtimeRoot)).packages.length, 1);
  const resolved = await resolveActivatedLapkgResources(runtimeRoot);
  assert.deepEqual(resolved.extensions, []);
  assert.deepEqual(resolved.skills, [join(activated.contentPath, "resources", "review", "SKILL.md")]);
  assert.deepEqual(await readdir(join(runtimeRoot, "data", "assistant", "capabilities", "packages-v2", ".staging")), []);

  await rejectsActivation(() => activateLapkg({
    runtimeRoot,
    archiveBytes: bytes,
    preview,
    expectedPlanHash: preview.planHash,
    trustRoots: [trustRoot],
  }, { now }), "LAPKG_PACKAGE_EXISTS");

  const tampered = Buffer.from(bytes);
  tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1;
  await rejectsActivation(() => activateLapkg({
    runtimeRoot,
    archiveBytes: tampered,
    preview,
    expectedPlanHash: preview.planHash,
    trustRoots: [trustRoot],
  }, { now }), "LAPKG_APPROVAL_INVALID");

  await rejectsActivation(() => activateLapkg({
    runtimeRoot,
    archiveBytes: bytes,
    preview,
    expectedPlanHash: preview.planHash,
    trustRoots: [trustRoot],
  }, { now: new Date(preview.expiresAt) }), "LAPKG_APPROVAL_EXPIRED");

  const concurrentBytes = await signedPackage("example.concurrent-pack", "---\nname: review\ndescription: Review\n---\nConcurrent.\n");
  const concurrentPreview = await previewLapkgInstall({
    archiveBytes: concurrentBytes,
    source: {
      schemaVersion: 1,
      kind: "local_file",
      sourceId: "picker:activation-2",
      acquiredAt: "2026-07-22T11:59:00.000Z",
      expectedArchiveSha256: sha256(concurrentBytes),
    },
    trustRoots: [trustRoot],
  }, { now, ttlMs: 60_000 });
  let releaseLock!: () => void;
  const lockHeld = new Promise<void>((resolve) => { releaseLock = resolve; });
  let signalLock!: () => void;
  const lockAcquired = new Promise<void>((resolve) => { signalLock = resolve; });
  const first = activateLapkg({
    runtimeRoot,
    archiveBytes: concurrentBytes,
    preview: concurrentPreview,
    expectedPlanHash: concurrentPreview.planHash,
    trustRoots: [trustRoot],
  }, {
    now,
    onPhase: async (phase) => {
      if (phase === "lock_acquired") {
        signalLock();
        await lockHeld;
      }
    },
  });
  await lockAcquired;
  await rejectsActivation(() => activateLapkg({
    runtimeRoot,
    archiveBytes: concurrentBytes,
    preview: concurrentPreview,
    expectedPlanHash: concurrentPreview.planHash,
    trustRoots: [trustRoot],
  }, { now }), "LAPKG_ACTIVATION_BUSY");
  releaseLock();
  await first;

  const rollbackBytes = await signedPackage("example.rollback-pack", "---\nname: review\ndescription: Review\n---\nRollback.\n");
  const rollbackPreview = await previewLapkgInstall({
    archiveBytes: rollbackBytes,
    source: {
      schemaVersion: 1,
      kind: "local_file",
      sourceId: "picker:activation-3",
      acquiredAt: "2026-07-22T11:59:00.000Z",
      expectedArchiveSha256: sha256(rollbackBytes),
    },
    trustRoots: [trustRoot],
  }, { now, ttlMs: 60_000 });
  await assert.rejects(activateLapkg({
    runtimeRoot,
    archiveBytes: rollbackBytes,
    preview: rollbackPreview,
    expectedPlanHash: rollbackPreview.planHash,
    trustRoots: [trustRoot],
  }, {
    now,
    onPhase: async (phase) => {
      if (phase === "before_registry_commit") throw new Error("synthetic registry failure");
    },
  }), /synthetic registry failure/u);
  assert.equal((await listActivatedLapkgPackages(runtimeRoot)).packages.some((item) => item.packageId === "example.rollback-pack"), false);
  await assert.rejects(stat(join(runtimeRoot, "data", "assistant", "capabilities", "packages-v2", "content", rollbackPreview.treeHash)), /ENOENT/u);
  assert.deepEqual(await readdir(join(runtimeRoot, "data", "assistant", "capabilities", "packages-v2", ".staging")), []);

  console.log(".lapkg activation tests passed");
} finally {
  await makeRemovable(runtimeRoot);
  await Promise.all([
    rm(fixtureRoot, { recursive: true, force: true }),
    rm(runtimeRoot, { recursive: true, force: true }),
  ]);
}
