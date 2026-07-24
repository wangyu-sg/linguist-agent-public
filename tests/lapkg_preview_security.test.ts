import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as tar from "tar";
import {
  inspectLapkgArchive,
  type LapkgManifestV1,
} from "../packages/cat-server/src/lapkg_format.js";
import {
  assertLapkgPreviewCurrent,
  LapkgPreviewError,
  previewLapkgInstall,
  type LapkgInstallPreviewV1,
} from "../packages/cat-server/src/lapkg_preview.js";
import { createLapkgSignaturePayload, type LapkgTrustRootV1 } from "../packages/cat-server/src/lapkg_signature.js";

const root = await mkdtemp(join(tmpdir(), "la-lapkg-preview-"));
const fakeBin = await mkdtemp(join(tmpdir(), "la-lapkg-preview-bin-"));
const now = new Date("2026-07-22T12:00:00.000Z");

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function writeArchive(name: string, manifest: LapkgManifestV1, resourceText: string): Promise<string> {
  const directory = join(root, name);
  await mkdir(join(directory, "resources", "review"), { recursive: true });
  await writeFile(join(directory, "lapkg.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(directory, "resources", "review", "SKILL.md"), resourceText);
  const archive = join(root, `${name}.lapkg`);
  await tar.c({ file: archive, cwd: directory, portable: true }, ["lapkg.json", "resources"]);
  return archive;
}

async function createSignedBytes(): Promise<{
  bytes: Buffer;
  manifest: LapkgManifestV1;
  trustRoot: LapkgTrustRootV1;
}> {
  const keys = generateKeyPairSync("ed25519");
  const text = "---\nname: review\ndescription: Review files\n---\nReview every segment.\n";
  const manifest: LapkgManifestV1 = {
    schemaVersion: 1,
    id: "example.preview-pack",
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
      keyId: "example-preview-2026",
      value: Buffer.alloc(64).toString("base64"),
    },
  };
  const draft = await inspectLapkgArchive(await writeArchive("draft", manifest, text));
  manifest.signature.value = sign(null, createLapkgSignaturePayload(draft), keys.privateKey).toString("base64");
  const archive = await writeArchive("signed", manifest, text);
  return {
    bytes: await readFile(archive),
    manifest,
    trustRoot: {
      schemaVersion: 1,
      keyId: "example-preview-2026",
      publisherId: "example",
      algorithm: "ed25519",
      publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
      status: "active",
    },
  };
}

async function rejectsPreview(action: () => unknown | Promise<unknown>, code: LapkgPreviewError["code"]): Promise<void> {
  await assert.rejects(
    Promise.resolve().then(action),
    (error: unknown) => error instanceof LapkgPreviewError && error.code === code,
  );
}

try {
  const fixture = await createSignedBytes();
  const archiveSha256 = sha256(fixture.bytes);
  const npmMarker = join(root, "npm-started");
  const fakeNpm = join(fakeBin, "npm");
  await writeFile(fakeNpm, `#!/bin/sh\nprintf started > ${JSON.stringify(npmMarker)}\n`);
  await chmod(fakeNpm, 0o755);
  const originalPath = process.env.PATH;
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  process.env.PATH = `${fakeBin}:${originalPath ?? ""}`;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("Preview must not fetch");
  };
  let preview: LapkgInstallPreviewV1;
  try {
    preview = await previewLapkgInstall({
      archiveBytes: fixture.bytes,
      source: {
        schemaVersion: 1,
        kind: "local_file",
        sourceId: "picker:fixture-1",
        acquiredAt: "2026-07-22T11:59:00.000Z",
        expectedArchiveSha256: archiveSha256,
      },
      trustRoots: [fixture.trustRoot],
    }, { now, ttlMs: 60_000 });
  } finally {
    process.env.PATH = originalPath;
    globalThis.fetch = originalFetch;
  }
  assert.equal(fetchCalls, 0);
  await assert.rejects(readFile(npmMarker), /ENOENT/u);
  assert.equal(preview.package.id, "example.preview-pack");
  assert.equal(preview.executable, false);
  assert.deepEqual(preview.requestedCapabilities, []);
  assert.deepEqual(preview.requiredRiskIds, ["skill_instructions"]);
  assert.equal(preview.source.expectedArchiveSha256, preview.archiveSha256);
  assert.equal(preview.expiresAt, "2026-07-22T12:01:00.000Z");
  assert.equal(assertLapkgPreviewCurrent(preview, preview.planHash, new Date("2026-07-22T12:00:59.999Z")).planHash, preview.planHash);

  const repeated = await previewLapkgInstall({
    archiveBytes: fixture.bytes,
    source: preview.source,
    trustRoots: [fixture.trustRoot],
  }, { now, ttlMs: 60_000 });
  assert.deepEqual(repeated, preview, "Preview and planHash must be deterministic for identical approved inputs.");

  await rejectsPreview(
    () => previewLapkgInstall({
      archiveBytes: fixture.bytes,
      source: { ...preview.source, expectedArchiveSha256: "0".repeat(64) },
      trustRoots: [fixture.trustRoot],
    }, { now }),
    "LAPKG_SOURCE_DIGEST_MISMATCH",
  );

  const signatureMutation = structuredClone(fixture.manifest);
  const signatureBytes = Buffer.from(signatureMutation.signature.value, "base64");
  signatureBytes[0] = (signatureBytes[0] ?? 0) ^ 1;
  signatureMutation.signature.value = signatureBytes.toString("base64");
  const mutatedBytes = await readFile(await writeArchive("signature-mutation", signatureMutation, "---\nname: review\ndescription: Review files\n---\nReview every segment.\n"));
  await rejectsPreview(
    () => previewLapkgInstall({
      archiveBytes: mutatedBytes,
      source: { ...preview.source, expectedArchiveSha256: sha256(mutatedBytes) },
      trustRoots: [fixture.trustRoot],
    }, { now }),
    "LAPKG_SIGNATURE_REJECTED",
  );

  await rejectsPreview(
    () => assertLapkgPreviewCurrent(preview, `${preview.planHash.startsWith("0") ? "1" : "0"}${preview.planHash.slice(1)}`, now),
    "LAPKG_PLAN_CHANGED",
  );
  const changedPlan = structuredClone(preview);
  changedPlan.resources[0]!.sha256 = "f".repeat(64);
  await rejectsPreview(
    () => assertLapkgPreviewCurrent(changedPlan, changedPlan.planHash, now),
    "LAPKG_PLAN_CHANGED",
  );
  await rejectsPreview(
    () => assertLapkgPreviewCurrent(preview, preview.planHash, new Date(preview.expiresAt)),
    "LAPKG_PREVIEW_EXPIRED",
  );

  console.log(".lapkg preview security tests passed");
} finally {
  await Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(fakeBin, { recursive: true, force: true }),
  ]);
}
