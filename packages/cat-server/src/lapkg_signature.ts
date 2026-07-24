import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import type { InspectedLapkgV1 } from "./lapkg_format.js";

const SIGNATURE_DOMAIN = "LINGUIST-AGENT-LAPKG-SIGNATURE-V1";

export interface LapkgTrustRootV1 {
  schemaVersion: 1;
  keyId: string;
  publisherId: string;
  algorithm: "ed25519";
  publicKeyPem: string;
  status: "active" | "revoked";
  validFrom?: string;
  validUntil?: string;
}

export interface VerifiedLapkgSignatureV1 {
  schemaVersion: 1;
  packageId: string;
  packageVersion: string;
  publisherId: string;
  keyId: string;
  payloadSha256: string;
  treeHash: string;
  verifiedAt: string;
}

export type LapkgSignatureErrorCode =
  | "LAPKG_TRUST_ROOT_INVALID"
  | "LAPKG_SIGNATURE_UNKNOWN_KEY"
  | "LAPKG_SIGNATURE_REVOKED"
  | "LAPKG_SIGNATURE_PUBLISHER_MISMATCH"
  | "LAPKG_SIGNATURE_NOT_YET_VALID"
  | "LAPKG_SIGNATURE_EXPIRED"
  | "LAPKG_SIGNATURE_INVALID";

export class LapkgSignatureError extends Error {
  constructor(
    public readonly code: LapkgSignatureErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LapkgSignatureError";
  }
}

function fail(code: LapkgSignatureErrorCode, message: string): never {
  throw new LapkgSignatureError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("LAPKG_SIGNATURE_INVALID", "Signature payload contains a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  fail("LAPKG_SIGNATURE_INVALID", "Signature payload contains an unsupported value.");
}

export function createLapkgSignaturePayload(inspected: InspectedLapkgV1): Buffer {
  const manifest = inspected.manifest;
  const normalized = {
    schemaVersion: 1,
    package: {
      id: manifest.id,
      version: manifest.version,
      publisher: manifest.publisher,
      license: manifest.license,
    },
    resources: inspected.resources.map((resource) => ({
      id: resource.id,
      type: resource.type,
      path: resource.path,
      sha256: resource.sha256,
      size: resource.size,
      ...(resource.mediaType === undefined ? {} : { mediaType: resource.mediaType }),
    })),
    signature: {
      algorithm: manifest.signature.algorithm,
      keyId: manifest.signature.keyId,
    },
    treeHash: inspected.treeHash,
    totalResourceBytes: inspected.totalResourceBytes,
  };
  return Buffer.from(`${SIGNATURE_DOMAIN}\0${canonicalJson(normalized)}`, "utf8");
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}

function parseTime(value: string | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    fail("LAPKG_TRUST_ROOT_INVALID", `${label} must be an exact ISO timestamp.`);
  }
  return parsed;
}

function validateTrustRoots(input: readonly LapkgTrustRootV1[]): Map<string, LapkgTrustRootV1> {
  if (!Array.isArray(input)) fail("LAPKG_TRUST_ROOT_INVALID", "Trust roots must be an array.");
  const roots = new Map<string, LapkgTrustRootV1>();
  for (const candidate of input as readonly unknown[]) {
    if (!isRecord(candidate) || !exactKeys(candidate, [
      "schemaVersion", "keyId", "publisherId", "algorithm", "publicKeyPem", "status", "validFrom", "validUntil",
    ]) || candidate.schemaVersion !== 1 || candidate.algorithm !== "ed25519" ||
      (candidate.status !== "active" && candidate.status !== "revoked") ||
      typeof candidate.keyId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(candidate.keyId) ||
      typeof candidate.publisherId !== "string" || !/^[a-z0-9][a-z0-9._-]*$/u.test(candidate.publisherId) ||
      typeof candidate.publicKeyPem !== "string" || candidate.publicKeyPem.length > 16_384 ||
      (candidate.validFrom !== undefined && typeof candidate.validFrom !== "string") ||
      (candidate.validUntil !== undefined && typeof candidate.validUntil !== "string")) {
      fail("LAPKG_TRUST_ROOT_INVALID", "A trust root has invalid or unknown fields.");
    }
    if (roots.has(candidate.keyId)) fail("LAPKG_TRUST_ROOT_INVALID", `Duplicate trust-root keyId ${candidate.keyId}.`);
    const validFrom = parseTime(candidate.validFrom, `${candidate.keyId}.validFrom`);
    const validUntil = parseTime(candidate.validUntil, `${candidate.keyId}.validUntil`);
    if (validFrom !== undefined && validUntil !== undefined && validUntil <= validFrom) {
      fail("LAPKG_TRUST_ROOT_INVALID", `Trust root ${candidate.keyId} has an invalid validity interval.`);
    }
    try {
      const key = createPublicKey(candidate.publicKeyPem);
      if (key.asymmetricKeyType !== "ed25519") fail("LAPKG_TRUST_ROOT_INVALID", `Trust root ${candidate.keyId} is not Ed25519.`);
    } catch (error) {
      if (error instanceof LapkgSignatureError) throw error;
      fail("LAPKG_TRUST_ROOT_INVALID", `Trust root ${candidate.keyId} has invalid public key material.`);
    }
    roots.set(candidate.keyId, candidate as unknown as LapkgTrustRootV1);
  }
  return roots;
}

export function verifyLapkgSignature(
  inspected: InspectedLapkgV1,
  trustRoots: readonly LapkgTrustRootV1[],
  options: { now?: Date } = {},
): VerifiedLapkgSignatureV1 {
  const roots = validateTrustRoots(trustRoots);
  const signature = inspected.manifest.signature;
  const root = roots.get(signature.keyId);
  if (!root) fail("LAPKG_SIGNATURE_UNKNOWN_KEY", `No trust root exists for keyId ${signature.keyId}.`);
  if (root.publisherId !== inspected.manifest.publisher.id) {
    fail("LAPKG_SIGNATURE_PUBLISHER_MISMATCH", "The signing key is not bound to this publisher.");
  }
  if (root.status === "revoked") fail("LAPKG_SIGNATURE_REVOKED", `Signing key ${root.keyId} is revoked.`);
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) fail("LAPKG_TRUST_ROOT_INVALID", "Signature verification time is invalid.");
  const nowMillis = now.getTime();
  const validFrom = parseTime(root.validFrom, `${root.keyId}.validFrom`);
  const validUntil = parseTime(root.validUntil, `${root.keyId}.validUntil`);
  if (validFrom !== undefined && nowMillis < validFrom) {
    fail("LAPKG_SIGNATURE_NOT_YET_VALID", `Signing key ${root.keyId} is not valid yet.`);
  }
  if (validUntil !== undefined && nowMillis >= validUntil) {
    fail("LAPKG_SIGNATURE_EXPIRED", `Signing key ${root.keyId} has expired.`);
  }
  const payload = createLapkgSignaturePayload(inspected);
  const signatureBytes = Buffer.from(signature.value, "base64");
  const key = createPublicKey(root.publicKeyPem);
  if (!verifySignature(null, payload, key, signatureBytes)) {
    fail("LAPKG_SIGNATURE_INVALID", "The .lapkg signature does not match its manifest and complete resource tree.");
  }
  return Object.freeze({
    schemaVersion: 1,
    packageId: inspected.manifest.id,
    packageVersion: inspected.manifest.version,
    publisherId: inspected.manifest.publisher.id,
    keyId: root.keyId,
    payloadSha256: createHash("sha256").update(payload).digest("hex"),
    treeHash: inspected.treeHash,
    verifiedAt: now.toISOString(),
  });
}
