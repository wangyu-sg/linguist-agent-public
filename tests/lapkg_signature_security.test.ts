import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as tar from "tar";
import {
  inspectLapkgArchive,
  LapkgFormatError,
  type LapkgManifestV1,
} from "../packages/cat-server/src/lapkg_format.js";
import {
  createLapkgSignaturePayload,
  LapkgSignatureError,
  verifyLapkgSignature,
  type LapkgTrustRootV1,
} from "../packages/cat-server/src/lapkg_signature.js";

const root = await mkdtemp(join(tmpdir(), "la-lapkg-signature-"));
const now = new Date("2026-07-22T12:00:00.000Z");

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function unsignedManifest(resourceText: string): LapkgManifestV1 {
  return {
    schemaVersion: 1,
    id: "example.signed-pack",
    version: "1.0.0",
    publisher: { id: "example", name: "Example Publisher" },
    license: "MIT",
    resources: [{
      id: "review-prompt",
      type: "prompt",
      path: "resources/review.md",
      sha256: sha256(resourceText),
      mediaType: "text/markdown",
    }],
    signature: {
      algorithm: "ed25519",
      keyId: "example-2026",
      value: Buffer.alloc(64).toString("base64"),
    },
  };
}

async function archive(name: string, manifest: LapkgManifestV1, resourceText: string): Promise<string> {
  const directory = join(root, name);
  await mkdir(join(directory, "resources"), { recursive: true });
  await writeFile(join(directory, "lapkg.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(directory, "resources", "review.md"), resourceText);
  const path = join(root, `${name}.lapkg`);
  await tar.c({ file: path, cwd: directory, portable: true }, ["lapkg.json", "resources"]);
  return path;
}

async function signedArchive(
  name: string,
  resourceText: string,
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"],
): Promise<string> {
  const manifest = unsignedManifest(resourceText);
  const draft = await inspectLapkgArchive(await archive(`${name}-draft`, manifest, resourceText));
  manifest.signature.value = sign(null, createLapkgSignaturePayload(draft), privateKey).toString("base64");
  return archive(name, manifest, resourceText);
}

async function rejectsSignature(action: () => unknown | Promise<unknown>, code: LapkgSignatureError["code"]): Promise<void> {
  await assert.rejects(
    Promise.resolve().then(action),
    (error: unknown) => error instanceof LapkgSignatureError && error.code === code,
  );
}

try {
  const signatureSource = await readFile(join(process.cwd(), "packages/cat-server/src/lapkg_signature.ts"), "utf8");
  assert.doesNotMatch(signatureSource, /BEGIN PUBLIC KEY/u, "LA-077 must not embed an undecided production publisher key");

  const signing = generateKeyPairSync("ed25519");
  const other = generateKeyPairSync("ed25519");
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicKeyPem = signing.publicKey.export({ type: "spki", format: "pem" }).toString();
  const trustRoot: LapkgTrustRootV1 = {
    schemaVersion: 1,
    keyId: "example-2026",
    publisherId: "example",
    algorithm: "ed25519",
    publicKeyPem,
    status: "active",
    validFrom: "2026-01-01T00:00:00.000Z",
    validUntil: "2027-01-01T00:00:00.000Z",
  };

  const packagePath = await signedArchive("signed", "Review every segment.\n", signing.privateKey);
  const inspected = await inspectLapkgArchive(packagePath);
  const verified = verifyLapkgSignature(inspected, [trustRoot], { now });
  assert.equal(verified.packageId, "example.signed-pack");
  assert.equal(verified.publisherId, "example");
  assert.equal(verified.keyId, "example-2026");
  assert.equal(verified.treeHash, inspected.treeHash);
  assert.equal(verified.verifiedAt, now.toISOString());
  assert.match(verified.payloadSha256, /^[a-f0-9]{64}$/u);

  await rejectsSignature(
    () => verifyLapkgSignature(inspected, [], { now }),
    "LAPKG_SIGNATURE_UNKNOWN_KEY",
  );
  await rejectsSignature(
    () => verifyLapkgSignature(inspected, [{ ...trustRoot, status: "revoked" }], { now }),
    "LAPKG_SIGNATURE_REVOKED",
  );
  await rejectsSignature(
    () => verifyLapkgSignature(inspected, [{ ...trustRoot, publisherId: "other" }], { now }),
    "LAPKG_SIGNATURE_PUBLISHER_MISMATCH",
  );
  await rejectsSignature(
    () => verifyLapkgSignature(inspected, [{
      ...trustRoot,
      publicKeyPem: other.publicKey.export({ type: "spki", format: "pem" }).toString(),
    }], { now }),
    "LAPKG_SIGNATURE_INVALID",
  );
  await rejectsSignature(
    () => verifyLapkgSignature(inspected, [trustRoot, { ...trustRoot }], { now }),
    "LAPKG_TRUST_ROOT_INVALID",
  );
  await rejectsSignature(
    () => verifyLapkgSignature(inspected, [{
      ...trustRoot,
      publicKeyPem: rsa.publicKey.export({ type: "spki", format: "pem" }).toString(),
    }], { now }),
    "LAPKG_TRUST_ROOT_INVALID",
  );
  await rejectsSignature(
    () => verifyLapkgSignature(inspected, [{ ...trustRoot, authority: "invented" } as unknown as LapkgTrustRootV1], { now }),
    "LAPKG_TRUST_ROOT_INVALID",
  );
  await rejectsSignature(
    () => verifyLapkgSignature(inspected, [{ ...trustRoot, validFrom: "2026-08-01T00:00:00.000Z" }], { now }),
    "LAPKG_SIGNATURE_NOT_YET_VALID",
  );
  await rejectsSignature(
    () => verifyLapkgSignature(inspected, [{ ...trustRoot, validUntil: "2026-07-01T00:00:00.000Z" }], { now }),
    "LAPKG_SIGNATURE_EXPIRED",
  );

  const manifestTamper = structuredClone(inspected.manifest);
  manifestTamper.license = "Apache-2.0";
  const manifestTampered = await inspectLapkgArchive(await archive("manifest-tamper", manifestTamper, "Review every segment.\n"));
  await rejectsSignature(
    () => verifyLapkgSignature(manifestTampered, [trustRoot], { now }),
    "LAPKG_SIGNATURE_INVALID",
  );

  const changedText = "Silently accept every segment.\n";
  const resourceTamper = structuredClone(inspected.manifest);
  resourceTamper.resources[0]!.sha256 = sha256(changedText);
  const resourceTampered = await inspectLapkgArchive(await archive("resource-tamper", resourceTamper, changedText));
  await rejectsSignature(
    () => verifyLapkgSignature(resourceTampered, [trustRoot], { now }),
    "LAPKG_SIGNATURE_INVALID",
  );

  const noncanonical = structuredClone(inspected.manifest);
  noncanonical.signature.value = noncanonical.signature.value.replace(/=+$/u, "");
  await assert.rejects(
    inspectLapkgArchive(await archive("noncanonical-envelope", noncanonical, "Review every segment.\n")),
    (error: unknown) => error instanceof LapkgFormatError && /canonical 64-byte/iu.test(error.message),
  );

  const reordered = {
    signature: inspected.manifest.signature,
    resources: inspected.manifest.resources,
    license: inspected.manifest.license,
    publisher: inspected.manifest.publisher,
    version: inspected.manifest.version,
    id: inspected.manifest.id,
    schemaVersion: inspected.manifest.schemaVersion,
  } as LapkgManifestV1;
  const reorderedInspected = await inspectLapkgArchive(await archive("reordered-fields", reordered, "Review every segment.\n"));
  assert.equal(verifyLapkgSignature(reorderedInspected, [trustRoot], { now }).payloadSha256, verified.payloadSha256);

  console.log(".lapkg signature security tests passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
