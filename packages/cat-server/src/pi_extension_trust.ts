import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { readJsonFile, resolveStructuredStorageBackend, writeJsonFile } from "@linguist-agent/cat-data";
import type { GeneralResourceSnapshotEntry } from "@linguist-agent/cat-runtime";

export interface ApprovedPiExtensionEntry {
  originalResolvedPath: string;
  sourceSha256: string;
  stagedPath: string;
  stagedSha256: string;
  sizeBytes: number;
  approvedAt: string;
}

interface PiExtensionTrustDocumentV2 {
  schemaVersion: 2;
  approvals: ApprovedPiExtensionEntry[];
}

interface PiExtensionTrustDocumentStateV2 {
  document: PiExtensionTrustDocumentV2;
  revision: number;
}

interface StagedPiExtensionManifestV1 {
  schemaVersion: 1;
  originalResolvedPath: string;
  sourceSha256: string;
  stagedFile: string;
  stagedSha256: string;
  sizeBytes: number;
  stagedAt: string;
}

const queues = new Map<string, Promise<void>>();
const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_EXTENSION = /^\.(?:cjs|js|mjs|ts)$/u;
const STORAGE_ADDRESS = { domain: "trust" as const, key: "extensions", scope: "runtime" };

function documentPath(runtimeRoot: string): string {
  return join(resolve(runtimeRoot), "data", "runtime", "pi_extension_trust.v2.json");
}

function stageRoot(runtimeRoot: string): string {
  return join(resolve(runtimeRoot), "data", "runtime", "trusted-extensions");
}

function parseApproval(value: unknown, label: string): ApprovedPiExtensionEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  const row = value as Record<string, unknown>;
  if (typeof row.originalResolvedPath !== "string" || !row.originalResolvedPath) throw new Error(`${label}.originalResolvedPath is required.`);
  if (typeof row.sourceSha256 !== "string" || !SHA256.test(row.sourceSha256)) throw new Error(`${label}.sourceSha256 is invalid.`);
  if (typeof row.stagedPath !== "string" || !row.stagedPath) throw new Error(`${label}.stagedPath is required.`);
  if (typeof row.stagedSha256 !== "string" || !SHA256.test(row.stagedSha256)) throw new Error(`${label}.stagedSha256 is invalid.`);
  if (row.sourceSha256 !== row.stagedSha256) throw new Error(`${label} must stage the exact approved source digest.`);
  if (!Number.isSafeInteger(row.sizeBytes) || (row.sizeBytes as number) < 0) throw new Error(`${label}.sizeBytes is invalid.`);
  if (typeof row.approvedAt !== "string" || !Number.isFinite(Date.parse(row.approvedAt))) throw new Error(`${label}.approvedAt is invalid.`);
  return {
    originalResolvedPath: row.originalResolvedPath,
    sourceSha256: row.sourceSha256,
    stagedPath: row.stagedPath,
    stagedSha256: row.stagedSha256,
    sizeBytes: row.sizeBytes as number,
    approvedAt: row.approvedAt,
  };
}

function parseDocument(value: unknown): PiExtensionTrustDocumentV2 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Pi Extension trust document must be an object.");
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== 2 || !Array.isArray(row.approvals)) throw new Error("Pi Extension trust document schema is invalid.");
  const approvals = row.approvals.map((entry, index) => parseApproval(entry, `approvals[${index}]`));
  if (new Set(approvals.map((entry) => entry.originalResolvedPath)).size !== approvals.length) {
    throw new Error("Pi Extension trust approvals must have unique original paths.");
  }
  return { schemaVersion: 2, approvals };
}

async function readDocumentState(runtimeRoot: string): Promise<PiExtensionTrustDocumentStateV2> {
  const backend = resolveStructuredStorageBackend(runtimeRoot);
  const stored = backend?.read(STORAGE_ADDRESS);
  if (stored) {
    const document = parseDocument(stored.payload);
    for (const approval of document.approvals) await assertApprovalWithinStageRoot(runtimeRoot, approval);
    return { document, revision: stored.revision };
  }
  if (backend) return { document: { schemaVersion: 2, approvals: [] }, revision: 0 };
  const value = await readJsonFile<unknown>(documentPath(runtimeRoot), { schemaVersion: 2, approvals: [] });
  const document = parseDocument(value);
  for (const approval of document.approvals) await assertApprovalWithinStageRoot(runtimeRoot, approval);
  return { document, revision: 0 };
}

async function readDocument(runtimeRoot: string): Promise<PiExtensionTrustDocumentV2> {
  return (await readDocumentState(runtimeRoot)).document;
}

async function writeDocument(
  runtimeRoot: string,
  document: PiExtensionTrustDocumentV2,
  state: PiExtensionTrustDocumentStateV2,
): Promise<void> {
  const backend = resolveStructuredStorageBackend(runtimeRoot);
  if (backend) {
    await backend.write({
      address: STORAGE_ADDRESS,
      expectedRevision: state.revision,
      expectedValue: state.document as unknown as Record<string, unknown>,
      value: document as unknown as Record<string, unknown>,
    });
    return;
  }
  await writeJsonFile(documentPath(runtimeRoot), document, { durability: "critical" });
}

async function assertApprovalWithinStageRoot(runtimeRoot: string, entry: ApprovedPiExtensionEntry): Promise<void> {
  const [canonicalRoot, canonicalParent] = await Promise.all([
    realpath(stageRoot(runtimeRoot)).catch(() => undefined),
    realpath(resolve(entry.stagedPath, "../..")).catch(() => undefined),
  ]);
  if (!canonicalRoot || canonicalParent !== canonicalRoot) {
    throw new Error(`Approved staged Extension escapes the managed content store: ${entry.stagedPath}`);
  }
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

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertSingleFileClosure(bytes: Uint8Array, sourcePath: string): void {
  const source = Buffer.from(bytes).toString("utf8");
  if (/\bimport\s*\(/u.test(source)) {
    throw new Error(`Pi Extension dynamic import is not part of the approved staged closure: ${sourcePath}`);
  }
  if (/\brequire\s*\(/u.test(source)) {
    throw new Error(`Pi Extension require dependency is not part of the approved staged closure: ${sourcePath}`);
  }
  if (/\b(?:import|export)\s+(?:[^;]*?\s+from\s+)?["'][./]/u.test(source)) {
    throw new Error(`Pi Extension relative module dependency is not part of the approved staged closure: ${sourcePath}`);
  }
}

function stagedFileName(sourcePath: string): string {
  const suffix = extname(sourcePath).toLowerCase();
  return `extension${SAFE_EXTENSION.test(suffix) ? suffix : ".js"}`;
}

async function stageApprovedBytes(
  runtimeRoot: string,
  entry: GeneralResourceSnapshotEntry,
  approvedAt: string,
): Promise<ApprovedPiExtensionEntry> {
  const canonicalSource = await realpath(entry.path);
  if (canonicalSource !== entry.resolvedPath) throw new Error(`Pi Extension canonical path changed before approval: ${entry.path}`);
  const bytes = await readFile(canonicalSource);
  const digest = sha256(bytes);
  if (digest !== entry.sha256 || bytes.byteLength !== entry.sizeBytes) {
    throw new Error(`Pi Extension bytes changed before approval: ${entry.path}`);
  }
  assertSingleFileClosure(bytes, canonicalSource);

  const directory = join(stageRoot(runtimeRoot), `sha256-${digest}`);
  const fileName = stagedFileName(canonicalSource);
  const existing = await stat(directory).catch(() => undefined);
  if (existing) {
    if (!existing.isDirectory()) throw new Error(`Pi Extension staged content path is not a directory: ${directory}`);
    const stagedPath = join(await realpath(directory), fileName);
    const approval: ApprovedPiExtensionEntry = {
      originalResolvedPath: canonicalSource,
      sourceSha256: digest,
      stagedPath,
      stagedSha256: digest,
      sizeBytes: bytes.byteLength,
      approvedAt,
    };
    await verifyApprovedPiExtensionStage(approval);
    return approval;
  }

  await mkdir(directory, { recursive: true, mode: 0o755 });
  const canonicalDirectory = await realpath(directory);
  const stagedPath = join(canonicalDirectory, fileName);
  const approval: ApprovedPiExtensionEntry = {
    originalResolvedPath: canonicalSource,
    sourceSha256: digest,
    stagedPath,
    stagedSha256: digest,
    sizeBytes: bytes.byteLength,
    approvedAt,
  };
  await writeFile(stagedPath, bytes, { flag: "wx", mode: 0o444 });
  const manifest: StagedPiExtensionManifestV1 = {
    schemaVersion: 1,
    originalResolvedPath: canonicalSource,
    sourceSha256: digest,
    stagedFile: fileName,
    stagedSha256: digest,
    sizeBytes: bytes.byteLength,
    stagedAt: approvedAt,
  };
  const manifestPath = join(directory, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o444 });
  await Promise.all([chmod(stagedPath, 0o444), chmod(manifestPath, 0o444)]);
  await chmod(directory, 0o555);
  await verifyApprovedPiExtensionStage(approval);
  return approval;
}

export async function verifyApprovedPiExtensionStage(entry: ApprovedPiExtensionEntry): Promise<void> {
  const expectedDirectory = `sha256-${entry.stagedSha256}`;
  const directory = resolve(entry.stagedPath, "..");
  if (basename(directory) !== expectedDirectory) {
    throw new Error(`Approved staged Extension path is not content-addressed: ${entry.stagedPath}`);
  }
  const manifestPath = join(directory, "manifest.json");
  const [canonicalPath, bytes, info, directoryInfo, names, manifestBytes, manifestInfo] = await Promise.all([
    realpath(entry.stagedPath).catch(() => undefined),
    readFile(entry.stagedPath).catch(() => undefined),
    stat(entry.stagedPath).catch(() => undefined),
    stat(directory).catch(() => undefined),
    readdir(directory).catch(() => undefined),
    readFile(manifestPath, "utf8").catch(() => undefined),
    stat(manifestPath).catch(() => undefined),
  ]);
  if (!canonicalPath || canonicalPath !== resolve(entry.stagedPath) || !bytes || !info?.isFile()) {
    throw new Error(`Approved staged Extension is unavailable: ${entry.stagedPath}`);
  }
  if (!directoryInfo?.isDirectory() || (directoryInfo.mode & 0o222) !== 0) {
    throw new Error(`Approved staged Extension directory is writable or unavailable: ${directory}`);
  }
  if (!names || names.sort().join("\n") !== `${basename(entry.stagedPath)}\nmanifest.json`) {
    throw new Error(`Approved staged Extension tree changed: ${directory}`);
  }
  if (sha256(bytes) !== entry.stagedSha256 || bytes.byteLength !== entry.sizeBytes) {
    throw new Error(`Approved staged Extension bytes changed: ${entry.stagedPath}`);
  }
  if ((info.mode & 0o222) !== 0) throw new Error(`Approved staged Extension is writable: ${entry.stagedPath}`);
  if (!manifestBytes || !manifestInfo?.isFile() || (manifestInfo.mode & 0o222) !== 0) {
    throw new Error(`Approved staged Extension manifest is writable or unavailable: ${manifestPath}`);
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestBytes);
  } catch (error) {
    throw new Error(`Approved staged Extension manifest is invalid: ${manifestPath}`, { cause: error });
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error(`Approved staged Extension manifest is invalid: ${manifestPath}`);
  }
  const row = manifest as Record<string, unknown>;
  if (
    row.schemaVersion !== 1
    || row.originalResolvedPath !== entry.originalResolvedPath
    || row.sourceSha256 !== entry.sourceSha256
    || row.stagedFile !== basename(entry.stagedPath)
    || row.stagedSha256 !== entry.stagedSha256
    || row.sizeBytes !== entry.sizeBytes
  ) {
    throw new Error(`Approved staged Extension manifest changed: ${manifestPath}`);
  }
}

export async function listApprovedPiExtensionEntries(runtimeRoot: string): Promise<ApprovedPiExtensionEntry[]> {
  return (await readDocument(runtimeRoot)).approvals;
}

export async function unknownPiExtensionEntries(
  runtimeRoot: string,
  entries: GeneralResourceSnapshotEntry[],
): Promise<GeneralResourceSnapshotEntry[]> {
  const approvals = new Map((await readDocument(runtimeRoot)).approvals.map((entry) => [entry.originalResolvedPath, entry]));
  const unknown: GeneralResourceSnapshotEntry[] = [];
  for (const entry of entries) {
    if (entry.type !== "extension") continue;
    const approval = approvals.get(entry.resolvedPath);
    if (!approval || approval.sourceSha256 !== entry.sha256) {
      unknown.push(entry);
      continue;
    }
    await verifyApprovedPiExtensionStage(approval);
  }
  return unknown;
}

export async function approvePiExtensionEntries(
  runtimeRoot: string,
  entries: GeneralResourceSnapshotEntry[],
  options: { now?: Date } = {},
): Promise<ApprovedPiExtensionEntry[]> {
  return queued(runtimeRoot, async () => {
    const state = await readDocumentState(runtimeRoot);
    const document = state.document;
    const byPath = new Map(document.approvals.map((entry) => [entry.originalResolvedPath, entry]));
    const approvedAt = (options.now ?? new Date()).toISOString();
    for (const entry of entries) {
      if (entry.type !== "extension") throw new Error(`Cannot approve non-executable Pi resource as an Extension: ${entry.path}`);
      const approval = await stageApprovedBytes(runtimeRoot, entry, approvedAt);
      byPath.set(approval.originalResolvedPath, approval);
    }
    const approvals = [...byPath.values()].sort((a, b) => a.originalResolvedPath.localeCompare(b.originalResolvedPath));
    await writeDocument(runtimeRoot, { schemaVersion: 2, approvals }, state);
    return approvals;
  });
}
