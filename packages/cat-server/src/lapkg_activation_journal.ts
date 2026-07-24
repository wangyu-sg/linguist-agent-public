import { lstat, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { writeDurableFileAtomic } from "@linguist-agent/cat-data";
import type { ActivatedLapkgRecordV2 } from "./lapkg_activation.js";

export type LapkgActivationJournalPhase =
  | "prepared"
  | "staging_verified"
  | "content_published"
  | "registry_committed";

export interface LapkgActivationJournalV1 {
  schemaVersion: 1;
  activationId: string;
  phase: LapkgActivationJournalPhase;
  previousRegistryRevision: number;
  previousRegistryHash: string;
  targetRegistryRevision: number;
  targetRegistryHash: string;
  stageDirectory: string;
  contentExistedBefore: boolean;
  record: ActivatedLapkgRecordV2;
  createdAt: string;
  updatedAt: string;
}

export interface LapkgRecoveryBlockedV1 {
  schemaVersion: 1;
  activationId: string | null;
  reason: string;
  blockedAt: string;
}

export class LapkgJournalError extends Error {
  constructor(
    public readonly code: "LAPKG_JOURNAL_INVALID" | "LAPKG_RECOVERY_REQUIRED" | "LAPKG_RECOVERY_BLOCKED",
    message: string,
  ) {
    super(message);
    this.name = "LapkgJournalError";
  }
}

export function journalPath(v2Root: string): string {
  return join(v2Root, "activation-journal-v1.json");
}

export function recoveryBlockedPath(v2Root: string): string {
  return join(v2Root, "recovery-blocked-v1.json");
}

async function writeAtomic(path: string, value: unknown): Promise<void> {
  await writeDurableFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

function exactTime(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseLapkgActivationJournal(value: unknown): LapkgActivationJournalV1 {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.activationId !== "string" ||
    !["prepared", "staging_verified", "content_published", "registry_committed"].includes(String(value.phase)) ||
    !Number.isSafeInteger(value.previousRegistryRevision) || Number(value.previousRegistryRevision) < 0 ||
    typeof value.previousRegistryHash !== "string" || !/^[a-f0-9]{64}$/u.test(value.previousRegistryHash) ||
    !Number.isSafeInteger(value.targetRegistryRevision) || Number(value.targetRegistryRevision) !== Number(value.previousRegistryRevision) + 1 ||
    typeof value.targetRegistryHash !== "string" || !/^[a-f0-9]{64}$/u.test(value.targetRegistryHash) ||
    typeof value.stageDirectory !== "string" || !/^\.staging\/[0-9a-f-]{36}$/u.test(value.stageDirectory) ||
    typeof value.contentExistedBefore !== "boolean" || !isRecord(value.record) ||
    typeof value.record.packageId !== "string" || typeof value.record.packageVersion !== "string" ||
    typeof value.record.treeHash !== "string" || !/^[a-f0-9]{64}$/u.test(value.record.treeHash) ||
    value.record.contentDirectory !== `content/${value.record.treeHash}` ||
    !exactTime(value.createdAt) || !exactTime(value.updatedAt)) {
    throw new LapkgJournalError("LAPKG_JOURNAL_INVALID", "The v2 Package activation journal is invalid.");
  }
  return value as unknown as LapkgActivationJournalV1;
}

export async function readLapkgActivationJournal(v2Root: string): Promise<LapkgActivationJournalV1 | null> {
  const path = journalPath(v2Root);
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new LapkgJournalError("LAPKG_JOURNAL_INVALID", "The activation journal must be a regular file.");
    return parseLapkgActivationJournal(JSON.parse(await readFile(path, "utf8")) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (error instanceof LapkgJournalError) throw error;
    throw new LapkgJournalError("LAPKG_JOURNAL_INVALID", "The activation journal cannot be read.");
  }
}

export async function assertLapkgActivationWritable(v2Root: string): Promise<void> {
  const blocked = await lstat(recoveryBlockedPath(v2Root)).then(() => true, (error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return false;
    throw error;
  });
  if (blocked) throw new LapkgJournalError("LAPKG_RECOVERY_BLOCKED", "Package activation is blocked pending explicit recovery.");
  if (await readLapkgActivationJournal(v2Root)) {
    throw new LapkgJournalError("LAPKG_RECOVERY_REQUIRED", "An incomplete Package activation must be recovered before another write.");
  }
}

export async function writeLapkgActivationJournal(v2Root: string, journal: LapkgActivationJournalV1): Promise<void> {
  parseLapkgActivationJournal(journal);
  await writeAtomic(journalPath(v2Root), journal);
}

export async function advanceLapkgActivationJournal(
  v2Root: string,
  journal: LapkgActivationJournalV1,
  phase: LapkgActivationJournalPhase,
  now: Date,
): Promise<LapkgActivationJournalV1> {
  const next = { ...journal, phase, updatedAt: now.toISOString() };
  await writeLapkgActivationJournal(v2Root, next);
  return next;
}

export async function removeLapkgActivationJournal(v2Root: string): Promise<void> {
  await rm(journalPath(v2Root), { force: true });
}

export async function writeLapkgRecoveryBlocked(v2Root: string, value: LapkgRecoveryBlockedV1): Promise<void> {
  await writeAtomic(recoveryBlockedPath(v2Root), value);
}

export async function removeLapkgRecoveryBlocked(v2Root: string): Promise<void> {
  await rm(recoveryBlockedPath(v2Root), { force: true });
}
