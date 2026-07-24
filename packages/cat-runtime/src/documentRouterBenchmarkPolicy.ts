import { createHash } from "node:crypto";

export interface DocumentRouterPolicy {
  schemaVersion: 1;
  maxInputBytes: number;
  maxPages: number;
  maxBlocks: number;
  maxOutputBytes: number;
  timeoutMs: number;
  stagingTtlMs: number;
  nativeTextCoverage: number;
}

/** Server-owned baseline used when no current benchmark profile is supplied. */
export const CONSERVATIVE_DOCUMENT_ROUTER_POLICY: Readonly<DocumentRouterPolicy> = Object.freeze({
  schemaVersion: 1,
  maxInputBytes: 64 * 1024 * 1024,
  maxPages: 500,
  maxBlocks: 20_000,
  maxOutputBytes: 32 * 1024 * 1024,
  timeoutMs: 5 * 60 * 1000,
  stagingTtlMs: 24 * 60 * 60 * 1000,
  nativeTextCoverage: 0.75,
});

export interface DocumentRouterBenchmarkPolicySelection {
  source: "conservative-default" | "benchmark-profile";
  policy: Readonly<DocumentRouterPolicy>;
  reason: string;
  profileSha256?: string;
  benchmarkReportSha256?: string;
}

interface DocumentRouterBenchmarkProfileV1 {
  schemaVersion: 1;
  id: string;
  issuedAt: string;
  expiresAt: string;
  benchmarkReportSha256: string;
  nativeTextCoverage: number;
}

export class DocumentRouterBenchmarkPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentRouterBenchmarkPolicyError";
  }
}

const SHA256 = /^[a-f0-9]{64}$/u;
const PROFILE_ID = /^[a-z0-9][a-z0-9-]{2,63}$/u;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DocumentRouterBenchmarkPolicyError("Document Router benchmark profile must be an object.");
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: string[]): void {
  const unknown = Object.keys(value).filter((key) => !expected.includes(key));
  if (unknown.length) throw new DocumentRouterBenchmarkPolicyError(`Document Router benchmark profile has unknown field ${unknown[0]}.`);
  for (const key of expected) if (!(key in value)) throw new DocumentRouterBenchmarkPolicyError(`Document Router benchmark profile is missing required field ${key}.`);
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || new Date(value).toISOString() !== value) throw new DocumentRouterBenchmarkPolicyError(`${label} must be a canonical ISO timestamp.`);
  return value;
}

function parseProfile(value: unknown): DocumentRouterBenchmarkProfileV1 {
  const profile = record(value);
  exactKeys(profile, ["schemaVersion", "id", "issuedAt", "expiresAt", "benchmarkReportSha256", "nativeTextCoverage"]);
  if (profile.schemaVersion !== 1) throw new DocumentRouterBenchmarkPolicyError("Document Router benchmark profile has an unsupported schema version.");
  if (typeof profile.id !== "string" || !PROFILE_ID.test(profile.id)) throw new DocumentRouterBenchmarkPolicyError("Document Router benchmark profile id is invalid.");
  const issuedAt = timestamp(profile.issuedAt, "Document Router benchmark profile issuedAt");
  const expiresAt = timestamp(profile.expiresAt, "Document Router benchmark profile expiresAt");
  if (Date.parse(expiresAt) <= Date.parse(issuedAt)) throw new DocumentRouterBenchmarkPolicyError("Document Router benchmark profile expiresAt must be after issuedAt.");
  if (typeof profile.benchmarkReportSha256 !== "string" || !SHA256.test(profile.benchmarkReportSha256)) throw new DocumentRouterBenchmarkPolicyError("Document Router benchmark profile benchmarkReportSha256 must be a lowercase SHA-256 digest.");
  if (typeof profile.nativeTextCoverage !== "number" || !Number.isFinite(profile.nativeTextCoverage) || profile.nativeTextCoverage <= 0 || profile.nativeTextCoverage > 1) throw new DocumentRouterBenchmarkPolicyError("Document Router benchmark profile nativeTextCoverage must be greater than zero and at most one.");
  return { schemaVersion: 1, id: profile.id, issuedAt, expiresAt, benchmarkReportSha256: profile.benchmarkReportSha256, nativeTextCoverage: profile.nativeTextCoverage };
}

function profileDigest(profile: DocumentRouterBenchmarkProfileV1): string {
  return createHash("sha256").update(JSON.stringify(profile)).digest("hex");
}

function conservative(reason: string): DocumentRouterBenchmarkPolicySelection {
  return { source: "conservative-default", policy: CONSERVATIVE_DOCUMENT_ROUTER_POLICY, reason };
}

/** Invalid profiles are refused; only absence or expiry may retain the conservative baseline. */
export function loadDocumentRouterBenchmarkPolicy(value: unknown | undefined, now = new Date()): DocumentRouterBenchmarkPolicySelection {
  if (value === undefined) return conservative("No benchmark profile is present; conservative server policy is in use.");
  const profile = parseProfile(value);
  if (Date.parse(profile.expiresAt) <= now.getTime()) return conservative(`Benchmark profile ${profile.id} expired at ${profile.expiresAt}; conservative server policy is in use.`);
  const digest = profileDigest(profile);
  return {
    source: "benchmark-profile",
    policy: Object.freeze({ ...CONSERVATIVE_DOCUMENT_ROUTER_POLICY, nativeTextCoverage: profile.nativeTextCoverage }),
    reason: `Benchmark profile ${profile.id} (${digest}) is current and sets the native-text threshold to ${profile.nativeTextCoverage.toFixed(2)}.`,
    profileSha256: digest,
    benchmarkReportSha256: profile.benchmarkReportSha256,
  };
}
