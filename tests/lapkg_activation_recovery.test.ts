import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as tar from "tar";
import {
  activateLapkg,
  LapkgActivationError,
  lapkgRegistryPath,
  lapkgV2Root,
  LapkgSimulatedCrashError,
  listActivatedLapkgPackages,
  type LapkgActivationCrashPoint,
} from "../packages/cat-server/src/lapkg_activation.js";
import {
  readLapkgRecoveryBlock,
  recoverLapkgActivation,
} from "../packages/cat-server/src/lapkg_activation_recovery.js";
import { inspectLapkgArchive, type LapkgManifestV1 } from "../packages/cat-server/src/lapkg_format.js";
import { previewLapkgInstall, type LapkgInstallPreviewV1 } from "../packages/cat-server/src/lapkg_preview.js";
import { createLapkgSignaturePayload, type LapkgTrustRootV1 } from "../packages/cat-server/src/lapkg_signature.js";

const fixtures = await mkdtemp(join(tmpdir(), "la-lapkg-recovery-fixtures-"));
const now = new Date("2026-07-22T12:00:00.000Z");
const keys = generateKeyPairSync("ed25519");
const trustRoot: LapkgTrustRootV1 = {
  schemaVersion: 1,
  keyId: "example-recovery-2026",
  publisherId: "example",
  algorithm: "ed25519",
  publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
  status: "active",
};

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function makePackage(id: string): Promise<{ bytes: Buffer; preview: LapkgInstallPreviewV1 }> {
  const base = join(fixtures, id.replaceAll(".", "-"));
  const tree = join(base, "tree");
  const text = `---\nname: review\ndescription: Review\n---\n${id}\n`;
  await mkdir(join(tree, "resources", "review"), { recursive: true });
  const manifest: LapkgManifestV1 = {
    schemaVersion: 1,
    id,
    version: "1.0.0",
    publisher: { id: "example" },
    license: "MIT",
    resources: [{ id: "review", type: "skill", path: "resources/review/SKILL.md", sha256: sha256(text) }],
    signature: { algorithm: "ed25519", keyId: trustRoot.keyId, value: Buffer.alloc(64).toString("base64") },
  };
  const archive = async (name: string): Promise<string> => {
    await writeFile(join(tree, "lapkg.json"), JSON.stringify(manifest));
    await writeFile(join(tree, "resources", "review", "SKILL.md"), text);
    const path = join(base, `${name}.lapkg`);
    await tar.c({ file: path, cwd: tree, portable: true }, ["lapkg.json", "resources"]);
    return path;
  };
  const draft = await inspectLapkgArchive(await archive("draft"));
  manifest.signature.value = sign(null, createLapkgSignaturePayload(draft), keys.privateKey).toString("base64");
  const bytes = await readFile(await archive("signed"));
  const preview = await previewLapkgInstall({
    archiveBytes: bytes,
    source: {
      schemaVersion: 1,
      kind: "local_file",
      sourceId: `picker:${id}`,
      acquiredAt: "2026-07-22T11:59:00.000Z",
      expectedArchiveSha256: sha256(bytes),
    },
    trustRoots: [trustRoot],
  }, { now, ttlMs: 60_000 });
  return { bytes, preview };
}

async function makeRemovable(directory: string): Promise<void> {
  await chmod(directory, 0o755).catch(() => undefined);
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => makeRemovable(join(directory, entry.name))));
}

const roots: string[] = [];
try {
  const points: Array<[LapkgActivationCrashPoint, "rolled_back" | "finalized"]> = [
    ["journal_prepared", "rolled_back"],
    ["staging_verified", "rolled_back"],
    ["content_published", "rolled_back"],
    ["registry_renamed", "finalized"],
    ["registry_committed", "finalized"],
  ];
  for (const [point, expected] of points) {
    const runtimeRoot = await mkdtemp(join(tmpdir(), `la-lapkg-recovery-${point}-`));
    roots.push(runtimeRoot);
    const fixture = await makePackage(`example.${point.replaceAll("_", "-")}`);
    await assert.rejects(activateLapkg({
      runtimeRoot,
      archiveBytes: fixture.bytes,
      preview: fixture.preview,
      expectedPlanHash: fixture.preview.planHash,
      trustRoots: [trustRoot],
    }, { now, faultInjectionCrashAfter: point }), (error: unknown) => error instanceof LapkgSimulatedCrashError && error.point === point);
    const recovered = await recoverLapkgActivation(runtimeRoot, { exclusiveStartup: true, now });
    assert.equal(recovered.status, expected, point);
    assert.equal((await recoverLapkgActivation(runtimeRoot, { exclusiveStartup: true, now })).status, "clean", `${point} recovery must be idempotent`);
    assert.equal((await listActivatedLapkgPackages(runtimeRoot)).packages.length, expected === "finalized" ? 1 : 0);
  }

  const orphanRoot = await mkdtemp(join(tmpdir(), "la-lapkg-recovery-orphan-"));
  roots.push(orphanRoot);
  await mkdir(join(lapkgV2Root(orphanRoot), ".staging", "11111111-1111-4111-8111-111111111111"), { recursive: true });
  await writeFile(join(lapkgV2Root(orphanRoot), ".staging", "11111111-1111-4111-8111-111111111111", "partial"), "partial");
  const orphan = await recoverLapkgActivation(orphanRoot, { exclusiveStartup: true, now });
  assert.equal(orphan.status, "clean");
  assert.equal(orphan.removedOrphanStaging, 1);

  const rollbackRoot = await mkdtemp(join(tmpdir(), "la-lapkg-recovery-blocked-"));
  roots.push(rollbackRoot);
  const rollbackFixture = await makePackage("example.rollback-failure");
  await assert.rejects(activateLapkg({
    runtimeRoot: rollbackRoot,
    archiveBytes: rollbackFixture.bytes,
    preview: rollbackFixture.preview,
    expectedPlanHash: rollbackFixture.preview.planHash,
    trustRoots: [trustRoot],
  }, { now, faultInjectionCrashAfter: "content_published" }), LapkgSimulatedCrashError);
  const blocked = await recoverLapkgActivation(rollbackRoot, {
    exclusiveStartup: true,
    now,
    onBeforeRollbackRemove: () => { throw new Error("synthetic rollback failure"); },
  });
  assert.equal(blocked.status, "blocked");
  assert.equal((await recoverLapkgActivation(rollbackRoot, { exclusiveStartup: true, now })).status, "blocked");
  assert.notEqual(await readLapkgRecoveryBlock(rollbackRoot), null);
  await assert.rejects(activateLapkg({
    runtimeRoot: rollbackRoot,
    archiveBytes: rollbackFixture.bytes,
    preview: rollbackFixture.preview,
    expectedPlanHash: rollbackFixture.preview.planHash,
    trustRoots: [trustRoot],
  }, { now }), (error: unknown) => error instanceof LapkgActivationError && error.code === "LAPKG_RECOVERY_BLOCKED");

  const revisionRoot = await mkdtemp(join(tmpdir(), "la-lapkg-recovery-revision-"));
  roots.push(revisionRoot);
  const first = await makePackage("example.revision-first");
  await activateLapkg({ runtimeRoot: revisionRoot, archiveBytes: first.bytes, preview: first.preview, expectedPlanHash: first.preview.planHash, trustRoots: [trustRoot] }, { now });
  const second = await makePackage("example.revision-second");
  await assert.rejects(activateLapkg({ runtimeRoot: revisionRoot, archiveBytes: second.bytes, preview: second.preview, expectedPlanHash: second.preview.planHash, trustRoots: [trustRoot] }, { now, faultInjectionCrashAfter: "journal_prepared" }), LapkgSimulatedCrashError);
  const registry = JSON.parse(await readFile(lapkgRegistryPath(revisionRoot), "utf8")) as { packages: Array<{ license: string }> };
  registry.packages[0]!.license = "changed-without-revision";
  await writeFile(lapkgRegistryPath(revisionRoot), JSON.stringify(registry));
  const ambiguous = await recoverLapkgActivation(revisionRoot, { exclusiveStartup: true, now });
  assert.equal(ambiguous.status, "blocked");
  assert.equal(ambiguous.reason, "registry_revision_or_hash_ambiguous");

  await assert.rejects(
    recoverLapkgActivation(revisionRoot, { exclusiveStartup: false, now }),
    /exclusive startup/u,
  );

  console.log(".lapkg activation recovery tests passed");
} finally {
  await Promise.all(roots.map(async (root) => {
    await makeRemovable(root);
    await rm(root, { recursive: true, force: true });
  }));
  await rm(fixtures, { recursive: true, force: true });
}
