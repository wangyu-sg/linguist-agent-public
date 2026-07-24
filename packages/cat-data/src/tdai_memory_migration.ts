import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  confirmAssistantMemory,
  proposeAssistantMemory,
  type AssistantMemoryEntry,
  type AssistantMemoryKind,
  type AssistantMemoryPersistence,
  type AssistantMemoryScope,
} from "./assistant_memory.js";

const TDAI_MEMORY_MIGRATION_SCHEMA_VERSION = 1 as const;
const LEGACY_TDAI_SOURCE = "tencentdb-agent-memory" as const;

export interface TdaiLegacyMemoryRecord {
  recordId: string;
  text: string;
  kind?: AssistantMemoryKind;
  /**
   * An adapter-supplied, stable subject identifier.  It is intentionally not
   * inferred from prose: distinct values under one identity require review.
   */
  identityKey?: string;
}

export interface TdaiLegacyMemorySnapshot {
  sourceId: string;
  rawBytes: Uint8Array;
  records: readonly TdaiLegacyMemoryRecord[];
}

export interface TdaiMemoryCandidateSource {
  system: typeof LEGACY_TDAI_SOURCE;
  sourceId: string;
  recordId: string;
  sourceDigest: string;
}

export interface TdaiMemoryCandidate {
  id: string;
  scope: Extract<AssistantMemoryScope, { kind: "project" }>;
  kind: AssistantMemoryKind;
  proposedText: string;
  source: TdaiMemoryCandidateSource;
  confidenceSignals: readonly ["legacy_tdai_read_only_import"];
  conflictsWith?: string[];
  status: "pending";
}

export type TdaiMemoryExclusionReason = "secret_or_pii" | "low_value" | "duplicate";

export interface TdaiMemoryCandidateExclusion {
  recordId: string;
  recordDigest: string;
  reason: TdaiMemoryExclusionReason;
  duplicateOf?: string;
}

export interface TdaiMemoryMigrationReport {
  sourceRecordCount: number;
  pendingCandidateCount: number;
  excludedSecretOrPiiCount: number;
  excludedLowValueCount: number;
  duplicateCount: number;
  conflictCount: number;
  exclusions: TdaiMemoryCandidateExclusion[];
  requiresUserConfirmation: true;
  backupRequiredBeforeConfirmation: true;
}

export interface TdaiMemoryCandidatePlan {
  schemaVersion: typeof TDAI_MEMORY_MIGRATION_SCHEMA_VERSION;
  scope: Extract<AssistantMemoryScope, { kind: "project" }>;
  source: {
    system: typeof LEGACY_TDAI_SOURCE;
    sourceId: string;
    sourceDigest: string;
  };
  candidates: TdaiMemoryCandidate[];
  report: TdaiMemoryMigrationReport;
  planHash: string;
}

export interface TdaiMemoryMigrationBackupReceipt {
  planHash: string;
  sourceId: string;
  sourceDigest: string;
  sourcePath: string;
  reportPath: string;
}

interface ExistingMemoryForMigration {
  id: string;
  text: string;
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 512 || /[\u0000-\u001f]/.test(normalized)) throw new Error(`${label} is invalid.`);
  return normalized;
}

function normalizedMemoryText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizedKey(value: string): string {
  return normalizedMemoryText(value).toLocaleLowerCase();
}

function containsSecretOrPii(value: string): boolean {
  return [
    /\b(?:api[_ -]?key|access[_ -]?token|auth(?:orization)?|client[_ -]?secret|password|private[_ -]?key|secret|token)\s*[:=]\s*[^\s]+/i,
    /\bbearer\s+[a-z0-9._~+\/-]+/i,
    /\b(?:sk|rk|pk)_[a-z0-9_-]{8,}\b/i,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /(?:^|\s)(?:\+?\d[\d(). -]{7,}\d)(?:$|\s)/,
  ].some((pattern) => pattern.test(value));
}

function candidateId(sourceDigest: string, recordId: string, text: string): string {
  return `tdai_candidate_${sha256(`${sourceDigest}\u0000${recordId}\u0000${normalizedKey(text)}`).slice(0, 32)}`;
}

function recordDigest(sourceDigest: string, recordId: string): string {
  return sha256(`${sourceDigest}\u0000${recordId}`);
}

function candidatePlanHash(plan: Omit<TdaiMemoryCandidatePlan, "planHash">): string {
  return sha256(stableJson(plan));
}

function assertProjectScope(scope: AssistantMemoryScope): Extract<AssistantMemoryScope, { kind: "project" }> {
  if (scope.kind !== "project") throw new Error("Legacy TDAI memory migration only supports an explicit project scope.");
  const projectId = requiredText(scope.projectId, "Legacy TDAI projectId");
  if (projectId === "." || projectId === ".." || /[\\/]/.test(projectId)) throw new Error("Legacy TDAI projectId is invalid.");
  return { kind: "project", projectId };
}

function validatedMemoryKind(value: AssistantMemoryKind | undefined): AssistantMemoryKind {
  const kind = value ?? "guidance";
  if (!["preference", "fact", "guidance"].includes(kind)) throw new Error("Legacy TDAI memory kind is invalid.");
  return kind;
}

/**
 * Converts an adapter-provided legacy TDAI snapshot to inert review candidates.
 * It does not access a filesystem, call a gateway, write a backup, or create
 * Confirmed Memory.  An adapter must supply its exact, user-approved export;
 * unknown upstream TDAI layouts are therefore fail-closed rather than guessed.
 */
export function createTdaiMemoryCandidatePlan(input: {
  scope: AssistantMemoryScope;
  source: TdaiLegacyMemorySnapshot;
  existingMemories?: readonly ExistingMemoryForMigration[];
}): TdaiMemoryCandidatePlan {
  const scope = assertProjectScope(input.scope);
  const sourceId = requiredText(input.source.sourceId, "Legacy TDAI sourceId");
  const sourceDigest = sha256(input.source.rawBytes);
  const existingByText = new Map<string, string>();
  for (const entry of input.existingMemories ?? []) {
    const id = requiredText(entry.id, "Existing memory id");
    const text = normalizedMemoryText(entry.text);
    if (text) existingByText.set(normalizedKey(text), id);
  }

  const candidates: TdaiMemoryCandidate[] = [];
  const exclusions: TdaiMemoryCandidateExclusion[] = [];
  const candidateByText = new Map<string, string>();
  const candidateIdsByIdentity = new Map<string, string[]>();
  let excludedSecretOrPiiCount = 0;
  let excludedLowValueCount = 0;
  let duplicateCount = 0;

  for (const rawRecord of input.source.records) {
    const recordId = requiredText(rawRecord.recordId, "Legacy TDAI recordId");
    const text = normalizedMemoryText(rawRecord.text);
    if (text.length > 20_000) throw new Error("Legacy TDAI record text exceeds the MemoryCandidate limit.");
    const digest = recordDigest(sourceDigest, recordId);
    if (containsSecretOrPii(text)) {
      excludedSecretOrPiiCount += 1;
      exclusions.push({ recordId, recordDigest: digest, reason: "secret_or_pii" });
      continue;
    }
    if (text.length < 12) {
      excludedLowValueCount += 1;
      exclusions.push({ recordId, recordDigest: digest, reason: "low_value" });
      continue;
    }
    const normalized = normalizedKey(text);
    const duplicateOf = existingByText.get(normalized) ?? candidateByText.get(normalized);
    if (duplicateOf) {
      duplicateCount += 1;
      exclusions.push({ recordId, recordDigest: digest, reason: "duplicate", duplicateOf });
      continue;
    }
    const candidate: TdaiMemoryCandidate = {
      id: candidateId(sourceDigest, recordId, text),
      scope,
      kind: validatedMemoryKind(rawRecord.kind),
      proposedText: text,
      source: { system: LEGACY_TDAI_SOURCE, sourceId, recordId, sourceDigest },
      confidenceSignals: ["legacy_tdai_read_only_import"],
      status: "pending",
    };
    candidates.push(candidate);
    candidateByText.set(normalized, candidate.id);
    if (rawRecord.identityKey?.trim()) {
      const identity = requiredText(rawRecord.identityKey, "Legacy TDAI identityKey");
      const ids = candidateIdsByIdentity.get(identity) ?? [];
      ids.push(candidate.id);
      candidateIdsByIdentity.set(identity, ids);
    }
  }

  let conflictCount = 0;
  for (const ids of candidateIdsByIdentity.values()) {
    if (ids.length < 2) continue;
    conflictCount += 1;
    for (const id of ids) {
      const candidate = candidates.find((entry) => entry.id === id);
      if (candidate) candidate.conflictsWith = ids.filter((candidateId) => candidateId !== id);
    }
  }

  const withoutHash = {
    schemaVersion: TDAI_MEMORY_MIGRATION_SCHEMA_VERSION,
    scope,
    source: { system: LEGACY_TDAI_SOURCE, sourceId, sourceDigest },
    candidates,
    report: {
      sourceRecordCount: input.source.records.length,
      pendingCandidateCount: candidates.length,
      excludedSecretOrPiiCount,
      excludedLowValueCount,
      duplicateCount,
      conflictCount,
      exclusions,
      requiresUserConfirmation: true as const,
      backupRequiredBeforeConfirmation: true as const,
    },
  } satisfies Omit<TdaiMemoryCandidatePlan, "planHash">;
  return { ...withoutHash, planHash: candidatePlanHash(withoutHash) };
}

/**
 * Stores exact source bytes only under an explicit caller-selected backup root.
 * It never writes to the legacy source and refuses to overwrite an old backup.
 */
export async function writeTdaiMemoryMigrationBackup(
  backupRoot: string,
  plan: TdaiMemoryCandidatePlan,
  source: Pick<TdaiLegacyMemorySnapshot, "sourceId" | "rawBytes">,
): Promise<TdaiMemoryMigrationBackupReceipt> {
  if (requiredText(source.sourceId, "Legacy TDAI sourceId") !== plan.source.sourceId) {
    throw new Error("Legacy TDAI backup source does not match the candidate plan.");
  }
  if (sha256(source.rawBytes) !== plan.source.sourceDigest) {
    throw new Error("Legacy TDAI backup bytes do not match the candidate plan source digest.");
  }
  const destination = join(backupRoot, `tdai-memory-${plan.planHash}`);
  const sourcePath = join(destination, "source.backup");
  const reportPath = join(destination, "migration-report.json");
  await mkdir(backupRoot, { recursive: true });
  await mkdir(destination);
  await writeFile(sourcePath, source.rawBytes, { flag: "wx" });
  await writeFile(reportPath, `${JSON.stringify(plan, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return { planHash: plan.planHash, sourceId: plan.source.sourceId, sourceDigest: plan.source.sourceDigest, sourcePath, reportPath };
}

/**
 * This is the only migration write path.  It requires an exact plan, a matching
 * immutable-backup receipt, and an explicit user confirmation.  Pending
 * candidates are otherwise never sent to the Confirmed Memory store or recall.
 */
export async function confirmTdaiMemoryCandidate(
  runtimeRoot: string,
  plan: TdaiMemoryCandidatePlan,
  input: {
    planHash: string;
    candidateId: string;
    confirmedBy: "user";
    sourceTaskId: string;
    backup: TdaiMemoryMigrationBackupReceipt;
    now?: string;
    store?: AssistantMemoryPersistence;
  },
): Promise<AssistantMemoryEntry> {
  if (input.confirmedBy !== "user") throw new Error("Legacy TDAI candidates require explicit user confirmation.");
  if (input.planHash !== plan.planHash) throw new Error("Legacy TDAI candidate plan hash does not match.");
  if (input.backup.planHash !== plan.planHash
    || input.backup.sourceId !== plan.source.sourceId
    || input.backup.sourceDigest !== plan.source.sourceDigest) {
    throw new Error("Legacy TDAI backup receipt does not match the candidate plan.");
  }
  const candidate = plan.candidates.find((entry) => entry.id === input.candidateId);
  if (!candidate || candidate.status !== "pending") throw new Error("Legacy TDAI candidate is unavailable for confirmation.");
  const proposed = await proposeAssistantMemory(runtimeRoot, {
    scope: plan.scope,
    kind: candidate.kind,
    text: candidate.proposedText,
    source: { taskId: requiredText(input.sourceTaskId, "Migration review Task id") },
    now: input.now,
    store: input.store,
  });
  return await confirmAssistantMemory(runtimeRoot, {
    scope: plan.scope,
    id: proposed.id,
    actor: "user",
    now: input.now,
    store: input.store,
  });
}
