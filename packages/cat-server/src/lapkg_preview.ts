import { createHash } from "node:crypto";
import {
  inspectLapkgArchiveBytes,
  type InspectedLapkgV1,
  type LapkgResourceType,
} from "./lapkg_format.js";
import {
  LapkgSignatureError,
  verifyLapkgSignature,
  type LapkgTrustRootV1,
  type VerifiedLapkgSignatureV1,
} from "./lapkg_signature.js";

const PREVIEW_DOMAIN = "LINGUIST-AGENT-LAPKG-PREVIEW-V1";
const DEFAULT_PREVIEW_TTL_MS = 15 * 60 * 1000;
const MAX_PREVIEW_TTL_MS = 30 * 60 * 1000;

export type LapkgPreviewErrorCode =
  | "LAPKG_PREVIEW_INVALID"
  | "LAPKG_SOURCE_DIGEST_MISMATCH"
  | "LAPKG_SIGNATURE_REJECTED"
  | "LAPKG_PLAN_CHANGED"
  | "LAPKG_PREVIEW_EXPIRED";

export class LapkgPreviewError extends Error {
  constructor(
    public readonly code: LapkgPreviewErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LapkgPreviewError";
  }
}

export interface LapkgArchiveSourceV1 {
  schemaVersion: 1;
  kind: "local_file" | "catalog";
  sourceId: string;
  acquiredAt: string;
  expectedArchiveSha256: string;
}

export interface LapkgPreviewInput {
  archiveBytes: Buffer;
  source: LapkgArchiveSourceV1;
  trustRoots: readonly LapkgTrustRootV1[];
}

export type LapkgPreviewRiskId =
  | "language_assets"
  | "presentation_changes"
  | "project_behavior"
  | "skill_instructions";

export interface LapkgInstallPreviewV1 {
  schemaVersion: 1;
  mode: "preview";
  planHash: string;
  package: {
    id: string;
    version: string;
    publisherId: string;
    license: string;
  };
  source: LapkgArchiveSourceV1;
  archiveSha256: string;
  manifestSha256: string;
  treeHash: string;
  totalResourceBytes: number;
  signer: VerifiedLapkgSignatureV1;
  resources: InspectedLapkgV1["resources"];
  resourceTypeCounts: Partial<Record<LapkgResourceType, number>>;
  executable: false;
  requestedCapabilities: [];
  requiredRiskIds: LapkgPreviewRiskId[];
  createdAt: string;
  expiresAt: string;
}

function fail(code: LapkgPreviewErrorCode, message: string): never {
  throw new LapkgPreviewError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("LAPKG_PREVIEW_INVALID", "Preview plan contains a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  fail("LAPKG_PREVIEW_INVALID", "Preview plan contains an unsupported value.");
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseExactTime(value: unknown, label: string): Date {
  if (typeof value !== "string") fail("LAPKG_PREVIEW_INVALID", `${label} must be an exact ISO timestamp.`);
  const millis = Date.parse(value);
  if (!Number.isFinite(millis) || new Date(millis).toISOString() !== value) {
    fail("LAPKG_PREVIEW_INVALID", `${label} must be an exact ISO timestamp.`);
  }
  return new Date(millis);
}

function validateSource(input: unknown, now: Date): LapkgArchiveSourceV1 {
  if (!isRecord(input) || Object.keys(input).some((key) => ![
    "schemaVersion", "kind", "sourceId", "acquiredAt", "expectedArchiveSha256",
  ].includes(key)) || input.schemaVersion !== 1 ||
    (input.kind !== "local_file" && input.kind !== "catalog") ||
    typeof input.sourceId !== "string" || input.sourceId.length < 1 || input.sourceId.length > 256 ||
    input.sourceId !== input.sourceId.trim() || input.sourceId.startsWith("/") ||
    input.sourceId.includes("://") || /[\u0000-\u001f?#]/u.test(input.sourceId) ||
    typeof input.expectedArchiveSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(input.expectedArchiveSha256)) {
    fail("LAPKG_PREVIEW_INVALID", "The archive source descriptor is invalid or contains unknown fields.");
  }
  const acquiredAt = parseExactTime(input.acquiredAt, "source.acquiredAt");
  if (acquiredAt.getTime() > now.getTime()) fail("LAPKG_PREVIEW_INVALID", "The archive acquisition time cannot be in the future.");
  return {
    schemaVersion: 1,
    kind: input.kind,
    sourceId: input.sourceId,
    acquiredAt: input.acquiredAt as string,
    expectedArchiveSha256: input.expectedArchiveSha256,
  };
}

function validateNow(value: Date | undefined): Date {
  const now = value ?? new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    fail("LAPKG_PREVIEW_INVALID", "Preview time is invalid.");
  }
  return now;
}

function validateTtl(value: number | undefined): number {
  const ttl = value ?? DEFAULT_PREVIEW_TTL_MS;
  if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > MAX_PREVIEW_TTL_MS) {
    fail("LAPKG_PREVIEW_INVALID", "Preview TTL is outside the supported range.");
  }
  return ttl;
}

const RISK_ORDER: readonly LapkgPreviewRiskId[] = [
  "skill_instructions",
  "project_behavior",
  "language_assets",
  "presentation_changes",
];

function classifyRisks(resources: InspectedLapkgV1["resources"]): LapkgPreviewRiskId[] {
  const risks = new Set<LapkgPreviewRiskId>();
  for (const resource of resources) {
    if (["skill", "prompt", "role_recipe"].includes(resource.type)) risks.add("skill_instructions");
    if (["qa_profile", "format_mapping"].includes(resource.type)) risks.add("project_behavior");
    if (resource.type === "glossary") risks.add("language_assets");
    if (["theme", "template"].includes(resource.type)) risks.add("presentation_changes");
  }
  return RISK_ORDER.filter((risk) => risks.has(risk));
}

function countResourceTypes(resources: InspectedLapkgV1["resources"]): Partial<Record<LapkgResourceType, number>> {
  const counts: Partial<Record<LapkgResourceType, number>> = {};
  for (const resource of resources) counts[resource.type] = (counts[resource.type] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right))) as Partial<Record<LapkgResourceType, number>>;
}

function planHashOf(plan: Omit<LapkgInstallPreviewV1, "planHash">): string {
  return sha256(`${PREVIEW_DOMAIN}\0${canonicalJson(plan)}`);
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value as Record<string, unknown>)) freezeDeep(item);
  }
  return value;
}

export async function previewLapkgInstall(
  input: LapkgPreviewInput,
  options: { now?: Date; ttlMs?: number } = {},
): Promise<LapkgInstallPreviewV1> {
  const now = validateNow(options.now);
  const ttlMs = validateTtl(options.ttlMs);
  if (!isRecord(input) || !Buffer.isBuffer(input.archiveBytes) || !Array.isArray(input.trustRoots)) {
    fail("LAPKG_PREVIEW_INVALID", "Preview input is invalid.");
  }
  const source = validateSource(input.source, now);
  const actualArchiveSha256 = sha256(input.archiveBytes);
  if (actualArchiveSha256 !== source.expectedArchiveSha256) {
    fail("LAPKG_SOURCE_DIGEST_MISMATCH", "The acquired archive does not match its source descriptor.");
  }
  const inspected = await inspectLapkgArchiveBytes(input.archiveBytes);
  let signer: VerifiedLapkgSignatureV1;
  try {
    signer = verifyLapkgSignature(inspected, input.trustRoots, { now });
  } catch (error) {
    if (error instanceof LapkgSignatureError) {
      fail("LAPKG_SIGNATURE_REJECTED", "The .lapkg publisher signature was not accepted.");
    }
    throw error;
  }
  const withoutHash: Omit<LapkgInstallPreviewV1, "planHash"> = {
    schemaVersion: 1,
    mode: "preview",
    package: {
      id: inspected.manifest.id,
      version: inspected.manifest.version,
      publisherId: inspected.manifest.publisher.id,
      license: inspected.manifest.license,
    },
    source,
    archiveSha256: inspected.archiveSha256,
    manifestSha256: inspected.manifestSha256,
    treeHash: inspected.treeHash,
    totalResourceBytes: inspected.totalResourceBytes,
    signer,
    resources: inspected.resources,
    resourceTypeCounts: countResourceTypes(inspected.resources),
    executable: false,
    requestedCapabilities: [],
    requiredRiskIds: classifyRisks(inspected.resources),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
  };
  return freezeDeep({ ...withoutHash, planHash: planHashOf(withoutHash) });
}

export function assertLapkgPreviewCurrent(
  preview: LapkgInstallPreviewV1,
  expectedPlanHash: string,
  nowInput: Date = new Date(),
): LapkgInstallPreviewV1 {
  const now = validateNow(nowInput);
  if (!isRecord(preview) || typeof preview.planHash !== "string" || !/^[a-f0-9]{64}$/u.test(preview.planHash) ||
    typeof expectedPlanHash !== "string" || !/^[a-f0-9]{64}$/u.test(expectedPlanHash)) {
    fail("LAPKG_PLAN_CHANGED", "The approved preview plan is invalid or has changed.");
  }
  const { planHash, ...withoutHash } = preview;
  let computed: string;
  try {
    computed = planHashOf(withoutHash as Omit<LapkgInstallPreviewV1, "planHash">);
  } catch {
    fail("LAPKG_PLAN_CHANGED", "The approved preview plan is invalid or has changed.");
  }
  if (planHash !== expectedPlanHash || computed !== planHash) {
    fail("LAPKG_PLAN_CHANGED", "The approved preview plan is invalid or has changed.");
  }
  const expiresAt = parseExactTime(preview.expiresAt, "preview.expiresAt");
  if (now.getTime() >= expiresAt.getTime()) fail("LAPKG_PREVIEW_EXPIRED", "The approved preview plan has expired.");
  return preview;
}
