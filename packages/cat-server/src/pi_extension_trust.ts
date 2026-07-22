import { join, resolve } from "node:path";
import { readJsonFile, writeJsonFile } from "@linguist-agent/cat-data";
import type { GeneralResourceSnapshotEntry } from "@linguist-agent/cat-runtime";

export interface ApprovedPiExtensionEntry {
  resolvedPath: string;
  sha256: string;
  approvedAt: string;
}

interface PiExtensionTrustDocumentV1 {
  schemaVersion: 1;
  approvals: ApprovedPiExtensionEntry[];
}

const queues = new Map<string, Promise<void>>();

function documentPath(runtimeRoot: string): string {
  return join(resolve(runtimeRoot), "data", "runtime", "pi_extension_trust.v1.json");
}

function parseApproval(value: unknown, label: string): ApprovedPiExtensionEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  const row = value as Record<string, unknown>;
  if (typeof row.resolvedPath !== "string" || !row.resolvedPath) throw new Error(`${label}.resolvedPath is required.`);
  if (typeof row.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(row.sha256)) throw new Error(`${label}.sha256 is invalid.`);
  if (typeof row.approvedAt !== "string" || !Number.isFinite(Date.parse(row.approvedAt))) throw new Error(`${label}.approvedAt is invalid.`);
  return { resolvedPath: row.resolvedPath, sha256: row.sha256, approvedAt: row.approvedAt };
}

async function readDocument(runtimeRoot: string): Promise<PiExtensionTrustDocumentV1> {
  const value = await readJsonFile<unknown>(documentPath(runtimeRoot), { schemaVersion: 1, approvals: [] });
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Pi Extension trust document must be an object.");
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== 1 || !Array.isArray(row.approvals)) throw new Error("Pi Extension trust document schema is invalid.");
  const approvals = row.approvals.map((entry, index) => parseApproval(entry, `approvals[${index}]`));
  if (new Set(approvals.map((entry) => entry.resolvedPath)).size !== approvals.length) {
    throw new Error("Pi Extension trust approvals must have unique paths.");
  }
  return { schemaVersion: 1, approvals };
}

async function queued<T>(runtimeRoot: string, work: () => Promise<T>): Promise<T> {
  const path = documentPath(runtimeRoot);
  const previous = queues.get(path) ?? Promise.resolve();
  let result!: T;
  const next = previous.then(async () => { result = await work(); });
  const settled = next.catch(() => undefined);
  queues.set(path, settled);
  try { await next; }
  finally { if (queues.get(path) === settled) queues.delete(path); }
  return result;
}

export async function listApprovedPiExtensionEntries(runtimeRoot: string): Promise<ApprovedPiExtensionEntry[]> {
  return (await readDocument(runtimeRoot)).approvals;
}

export async function unknownPiExtensionEntries(
  runtimeRoot: string,
  entries: GeneralResourceSnapshotEntry[],
): Promise<GeneralResourceSnapshotEntry[]> {
  const approvals = new Map((await readDocument(runtimeRoot)).approvals.map((entry) => [entry.resolvedPath, entry.sha256]));
  return entries.filter((entry) => entry.type === "extension" && approvals.get(entry.resolvedPath) !== entry.sha256);
}

export async function approvePiExtensionEntries(
  runtimeRoot: string,
  entries: GeneralResourceSnapshotEntry[],
  options: { now?: Date } = {},
): Promise<ApprovedPiExtensionEntry[]> {
  return queued(runtimeRoot, async () => {
    const document = await readDocument(runtimeRoot);
    const byPath = new Map(document.approvals.map((entry) => [entry.resolvedPath, entry]));
    const approvedAt = (options.now ?? new Date()).toISOString();
    for (const entry of entries) {
      if (entry.type !== "extension") throw new Error(`Cannot approve non-executable Pi resource as an Extension: ${entry.path}`);
      byPath.set(entry.resolvedPath, { resolvedPath: entry.resolvedPath, sha256: entry.sha256, approvedAt });
    }
    const approvals = [...byPath.values()].sort((a, b) => a.resolvedPath.localeCompare(b.resolvedPath));
    await writeJsonFile(documentPath(runtimeRoot), { schemaVersion: 1, approvals } satisfies PiExtensionTrustDocumentV1);
    return approvals;
  });
}
