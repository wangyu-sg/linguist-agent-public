import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import {
  createLocalE5Embedder,
  inspectLocalEmbeddingPack,
  type LocalTextEmbedder,
} from "./local_embeddings.js";
import { readJsonFile, writeJsonFile } from "./workspace.js";

export type AssistantMemoryScope =
  | { kind: "personal" }
  | { kind: "client"; clientId: string }
  | { kind: "franchise"; franchiseId: string }
  | { kind: "project"; projectId: string }
  | { kind: "locale"; locale: string };
export type AssistantMemoryKind = "preference" | "fact" | "guidance";
export type AssistantMemoryStatus = "proposed" | "active" | "revoked" | "superseded";
export type AssistantMemoryHistoryAction = "proposed" | "confirmed" | "edited" | "revoked" | "superseded" | "validity_changed";

export interface AssistantMemorySource {
  taskId: string;
  activityId?: string;
  artifactId?: string;
}

export interface AssistantMemoryHistoryEntry {
  revision: number;
  action: AssistantMemoryHistoryAction;
  actor: "agent" | "user" | "system";
  at: string;
  text: string;
  kind: AssistantMemoryKind;
  previousText?: string;
  previousKind?: AssistantMemoryKind;
}

export interface AssistantMemoryEntry {
  id: string;
  scope: AssistantMemoryScope;
  kind: AssistantMemoryKind;
  text: string;
  status: AssistantMemoryStatus;
  source: AssistantMemorySource;
  revision: number;
  createdAt: string;
  updatedAt: string;
  /** Inclusive lower bound for recall. Missing v1 values mean createdAt. */
  validFrom?: string;
  /** Exclusive upper bound for recall. Expiry never silently reactivates a revoked/superseded record. */
  validUntil?: string;
  /** User-authored deterministic grouping key. LA does not infer contradictions from model output. */
  conflictKey?: string;
  confirmedAt?: string;
  revokedAt?: string;
  supersededAt?: string;
  supersededBy?: string;
  /** Read-only presentation metadata; never persisted as a second authority. */
  conflictsWith?: string[];
  history: AssistantMemoryHistoryEntry[];
}

export interface AssistantMemoryFileV1 {
  schemaVersion: 1;
  scope: AssistantMemoryScope;
  entries: AssistantMemoryEntry[];
  updatedAt: string;
}

/**
 * Storage seam for confirmed memory.  The legacy JSON adapter remains the
 * default only before the SQLite authority marker is published.  Production
 * callers must inject the SQLite implementation after cutover.
 */
export interface AssistantMemoryPersistence {
  read(scope: AssistantMemoryScope): Promise<AssistantMemoryFileV1 | null>;
  write(scope: AssistantMemoryScope, file: AssistantMemoryFileV1, expected: AssistantMemoryFileV1 | null): Promise<void>;
}

export class AssistantMemoryNotFoundError extends Error {
  constructor(id: string) {
    super(`Memory ${id} does not exist in this scope.`);
    this.name = "AssistantMemoryNotFoundError";
  }
}

export class AssistantMemoryConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssistantMemoryConflictError";
  }
}

function validateScopeIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 128 || normalized === "." || normalized === ".." || normalized.includes("/") || normalized.includes("\\") || normalized.includes("\0")) {
    throw new Error(`${label} requires a safe identifier.`);
  }
  return normalized;
}

function sameScope(left: AssistantMemoryScope, right: AssistantMemoryScope): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "personal") return true;
  if (left.kind === "client" && right.kind === "client") return left.clientId === right.clientId;
  if (left.kind === "franchise" && right.kind === "franchise") return left.franchiseId === right.franchiseId;
  if (left.kind === "project" && right.kind === "project") return left.projectId === right.projectId;
  return left.kind === "locale" && right.kind === "locale" && left.locale === right.locale;
}

function scopeDescription(scope: AssistantMemoryScope): string {
  if (scope.kind === "personal") return "personal";
  if (scope.kind === "project") return `project:${scope.projectId}`;
  if (scope.kind === "client") return `client:${scope.clientId}`;
  if (scope.kind === "franchise") return `franchise:${scope.franchiseId}`;
  return `locale:${scope.locale}`;
}

function parseScope(value: unknown, label: string): AssistantMemoryScope {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid.`);
  const row = value as Record<string, unknown>;
  if (row.kind === "personal") return { kind: "personal" };
  if (row.kind === "client" && typeof row.clientId === "string") return { kind: "client", clientId: validateScopeIdentifier(row.clientId, "Client memory") };
  if (row.kind === "franchise" && typeof row.franchiseId === "string") return { kind: "franchise", franchiseId: validateScopeIdentifier(row.franchiseId, "Franchise memory") };
  if (row.kind === "project" && typeof row.projectId === "string") {
    return { kind: "project", projectId: validateScopeIdentifier(row.projectId, "Project memory") };
  }
  if (row.kind === "locale" && typeof row.locale === "string") return { kind: "locale", locale: validateScopeIdentifier(row.locale, "Locale memory") };
  throw new Error(`${label} is invalid.`);
}

function isoTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO timestamp.`);
  return value;
}

function parseSource(value: unknown, label: string): AssistantMemorySource {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid.`);
  const source = value as Record<string, unknown>;
  if (typeof source.taskId !== "string" || !source.taskId.trim()) throw new Error(`${label}.taskId is invalid.`);
  for (const key of ["activityId", "artifactId"] as const) {
    if (source[key] !== undefined && (typeof source[key] !== "string" || !source[key].trim())) throw new Error(`${label}.${key} is invalid.`);
  }
  return {
    taskId: source.taskId.trim(),
    ...(typeof source.activityId === "string" && source.activityId.trim() ? { activityId: source.activityId.trim() } : {}),
    ...(typeof source.artifactId === "string" && source.artifactId.trim() ? { artifactId: source.artifactId.trim() } : {}),
  };
}

function parseHistory(value: unknown, label: string): AssistantMemoryHistoryEntry[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error(`${label}[${index}] is invalid.`);
    const row = candidate as Record<string, unknown>;
    if (!Number.isSafeInteger(row.revision) || Number(row.revision) < 1
      || !["proposed", "confirmed", "edited", "revoked", "superseded", "validity_changed"].includes(String(row.action))
      || !["agent", "user", "system"].includes(String(row.actor))
      || typeof row.text !== "string" || !row.text.trim()
      || !["preference", "fact", "guidance"].includes(String(row.kind))) {
      throw new Error(`${label}[${index}] has invalid fields.`);
    }
    for (const key of ["previousText"] as const) {
      if (row[key] !== undefined && typeof row[key] !== "string") throw new Error(`${label}[${index}].${key} is invalid.`);
    }
    if (row.previousKind !== undefined && !["preference", "fact", "guidance"].includes(String(row.previousKind))) {
      throw new Error(`${label}[${index}].previousKind is invalid.`);
    }
    return {
      revision: Number(row.revision),
      action: row.action as AssistantMemoryHistoryAction,
      actor: row.actor as AssistantMemoryHistoryEntry["actor"],
      at: isoTimestamp(row.at, `${label}[${index}].at`),
      text: row.text,
      kind: row.kind as AssistantMemoryKind,
      ...(typeof row.previousText === "string" ? { previousText: row.previousText } : {}),
      ...(row.previousKind !== undefined ? { previousKind: row.previousKind as AssistantMemoryKind } : {}),
    };
  });
}

/** Strict parser shared by SQLite cutover and the legacy read-only adapter. */
export function parseAssistantMemoryFile(value: unknown, label = "Assistant memory file"): AssistantMemoryFileV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid.`);
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== 1 || !row.scope || typeof row.updatedAt !== "string" || !Array.isArray(row.entries)) {
    throw new Error(`${label} schema is invalid.`);
  }
  const scope = parseScope(row.scope, `${label}.scope`);
  const entries = row.entries.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error(`${label}.entries[${index}] is invalid.`);
    const entry = candidate as Record<string, unknown>;
    if (typeof entry.id !== "string" || !entry.id.trim()
      || !["preference", "fact", "guidance"].includes(String(entry.kind))
      || typeof entry.text !== "string" || !entry.text.trim()
      || !["proposed", "active", "revoked", "superseded"].includes(String(entry.status))
      || !Number.isSafeInteger(entry.revision) || Number(entry.revision) < 1) {
      throw new Error(`${label}.entries[${index}] has invalid fields.`);
    }
    if (!sameScope(scope, parseScope(entry.scope, `${label}.entries[${index}].scope`))) throw new Error(`${label}.entries[${index}].scope is invalid.`);
    const createdAt = isoTimestamp(entry.createdAt, `${label}.entries[${index}].createdAt`);
    const validFrom = entry.validFrom === undefined ? undefined : isoTimestamp(entry.validFrom, `${label}.entries[${index}].validFrom`);
    const validUntil = entry.validUntil === undefined ? undefined : isoTimestamp(entry.validUntil, `${label}.entries[${index}].validUntil`);
    if (validUntil !== undefined && Date.parse(validUntil) <= Date.parse(validFrom ?? createdAt)) {
      throw new Error(`${label}.entries[${index}].validUntil must be after validFrom.`);
    }
    const conflictKey = entry.conflictKey === undefined
      ? undefined
      : typeof entry.conflictKey === "string" && entry.conflictKey.trim() && entry.conflictKey.trim().length <= 256
        ? entry.conflictKey.trim()
        : (() => { throw new Error(`${label}.entries[${index}].conflictKey is invalid.`); })();
    const supersededBy = entry.supersededBy === undefined
      ? undefined
      : typeof entry.supersededBy === "string" && entry.supersededBy.trim()
        ? entry.supersededBy.trim()
        : (() => { throw new Error(`${label}.entries[${index}].supersededBy is invalid.`); })();
    if (entry.status === "superseded" && !supersededBy) throw new Error(`${label}.entries[${index}].supersededBy is required.`);
    return {
      id: entry.id,
      scope,
      kind: entry.kind as AssistantMemoryKind,
      text: entry.text,
      status: entry.status as AssistantMemoryStatus,
      source: parseSource(entry.source, `${label}.entries[${index}].source`),
      revision: Number(entry.revision),
      createdAt,
      updatedAt: isoTimestamp(entry.updatedAt, `${label}.entries[${index}].updatedAt`),
      ...(validFrom === undefined ? {} : { validFrom }),
      ...(validUntil === undefined ? {} : { validUntil }),
      ...(conflictKey === undefined ? {} : { conflictKey }),
      ...(entry.confirmedAt === undefined ? {} : { confirmedAt: isoTimestamp(entry.confirmedAt, `${label}.entries[${index}].confirmedAt`) }),
      ...(entry.revokedAt === undefined ? {} : { revokedAt: isoTimestamp(entry.revokedAt, `${label}.entries[${index}].revokedAt`) }),
      ...(entry.supersededAt === undefined ? {} : { supersededAt: isoTimestamp(entry.supersededAt, `${label}.entries[${index}].supersededAt`) }),
      ...(supersededBy === undefined ? {} : { supersededBy }),
      history: parseHistory(entry.history, `${label}.entries[${index}].history`),
    } satisfies AssistantMemoryEntry;
  });
  return { schemaVersion: 1, scope, entries, updatedAt: isoTimestamp(row.updatedAt, `${label}.updatedAt`) };
}

export function assistantMemoryPath(runtimeRoot: string, scope: AssistantMemoryScope): string {
  if (scope.kind === "personal") return join(runtimeRoot, "data", "assistant", "memory", "memories.json");
  if (scope.kind === "project") return join(runtimeRoot, "data", "projects", validateScopeIdentifier(scope.projectId, "Project memory"), "memory", "memories.json");
  if (scope.kind === "client") return join(runtimeRoot, "data", "assistant", "memory", "scopes", "client", validateScopeIdentifier(scope.clientId, "Client memory"), "memories.json");
  if (scope.kind === "franchise") return join(runtimeRoot, "data", "assistant", "memory", "scopes", "franchise", validateScopeIdentifier(scope.franchiseId, "Franchise memory"), "memories.json");
  return join(runtimeRoot, "data", "assistant", "memory", "scopes", "locale", validateScopeIdentifier(scope.locale, "Locale memory"), "memories.json");
}

function defaultFile(scope: AssistantMemoryScope): AssistantMemoryFileV1 {
  return { schemaVersion: 1, scope, entries: [], updatedAt: new Date(0).toISOString() };
}

async function assertLegacyAuthorityAvailable(runtimeRoot: string): Promise<void> {
  try {
    await stat(join(runtimeRoot, "data", "runtime", "assistant-memory-sqlite-v1", "authority-v1.json"));
    throw new Error("SQLite assistant memory storage is authoritative; legacy JSON memory access is read-only and must use the injected store.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function readFileState(runtimeRoot: string, scope: AssistantMemoryScope, store?: AssistantMemoryPersistence): Promise<{ file: AssistantMemoryFileV1; exists: boolean }> {
  if (store) {
    const file = await store.read(scope);
    return { file: file ?? defaultFile(scope), exists: file !== null };
  }
  await assertLegacyAuthorityAvailable(runtimeRoot);
  const path = assistantMemoryPath(runtimeRoot, scope);
  let exists = true;
  try { await stat(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") exists = false;
    else throw error;
  }
  const value = await readJsonFile<AssistantMemoryFileV1>(path, defaultFile(scope));
  return { file: parseAssistantMemoryFile(value), exists };
}

async function writeFile(runtimeRoot: string, file: AssistantMemoryFileV1, expected: AssistantMemoryFileV1 | null, store?: AssistantMemoryPersistence): Promise<void> {
  if (store) {
    await store.write(file.scope, file, expected);
    return;
  }
  await assertLegacyAuthorityAvailable(runtimeRoot);
  await writeJsonFile(assistantMemoryPath(runtimeRoot, file.scope), file, { durability: "critical" });
}

function cloneFile(file: AssistantMemoryFileV1): AssistantMemoryFileV1 {
  return JSON.parse(JSON.stringify(file)) as AssistantMemoryFileV1;
}

function normalizedText(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) throw new Error("Memory text is required.");
  if (text.length > 20_000) throw new Error("Memory text exceeds the 20,000 character limit.");
  return text;
}

function normalizedConflictKey(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const key = value.trim();
  if (!key || key.length > 256) throw new Error("Memory conflictKey must contain at most 256 characters.");
  return key;
}

function normalizedValidity(input: { validFrom?: string; validUntil?: string | null }, fallbackFrom: string): { validFrom: string; validUntil?: string } {
  const validFrom = input.validFrom === undefined ? fallbackFrom : isoTimestamp(input.validFrom, "Memory validFrom");
  const validUntil = input.validUntil === undefined
    ? undefined
    : input.validUntil === null
      ? undefined
      : isoTimestamp(input.validUntil, "Memory validUntil");
  if (validUntil !== undefined && Date.parse(validUntil) <= Date.parse(validFrom)) throw new Error("Memory validUntil must be after validFrom.");
  return { validFrom, ...(validUntil === undefined ? {} : { validUntil }) };
}

function normalizedScope(scope: AssistantMemoryScope): AssistantMemoryScope {
  return parseScope(scope, "Memory scope");
}

function isRecallActive(entry: AssistantMemoryEntry, now: string): boolean {
  return entry.status === "active"
    && Date.parse(entry.validFrom ?? entry.createdAt) <= Date.parse(now)
    && (entry.validUntil === undefined || Date.parse(now) < Date.parse(entry.validUntil));
}

function conflictIds(file: AssistantMemoryFileV1, entry: AssistantMemoryEntry, now: string): string[] | undefined {
  if (!entry.conflictKey) return undefined;
  const ids = file.entries
    .filter((candidate) => candidate.id !== entry.id && candidate.conflictKey === entry.conflictKey && isRecallActive(candidate, now))
    .map((candidate) => candidate.id)
    .sort((left, right) => left.localeCompare(right));
  return ids.length ? ids : undefined;
}

function presentationEntry(file: AssistantMemoryFileV1, entry: AssistantMemoryEntry, now: string): AssistantMemoryEntry {
  const conflictsWith = conflictIds(file, entry, now);
  return { ...entry, ...(conflictsWith ? { conflictsWith } : {}) };
}

function validateKind(value: AssistantMemoryKind): AssistantMemoryKind {
  if (!(["preference", "fact", "guidance"] as string[]).includes(value)) throw new Error(`Unsupported memory kind: ${value}`);
  return value;
}

function validateSource(source: AssistantMemorySource): AssistantMemorySource {
  if (!source?.taskId?.trim()) throw new Error("Memory proposals require a source Task.");
  return {
    taskId: source.taskId.trim(),
    ...(source.activityId?.trim() ? { activityId: source.activityId.trim() } : {}),
    ...(source.artifactId?.trim() ? { artifactId: source.artifactId.trim() } : {}),
  };
}

function findEntry(file: AssistantMemoryFileV1, id: string): AssistantMemoryEntry {
  const entry = file.entries.find((candidate) => candidate.id === id);
  if (!entry) throw new AssistantMemoryNotFoundError(id);
  return entry;
}

export async function listAssistantMemories(
  runtimeRoot: string,
  scope: AssistantMemoryScope,
  options: { status?: AssistantMemoryStatus; kind?: AssistantMemoryKind; store?: AssistantMemoryPersistence } = {},
): Promise<AssistantMemoryEntry[]> {
  const normalized = normalizedScope(scope);
  const { file } = await readFileState(runtimeRoot, normalized, options.store);
  const now = new Date().toISOString();
  return file.entries
    .filter((entry) => options.status === undefined || entry.status === options.status)
    .filter((entry) => options.kind === undefined || entry.kind === options.kind)
    .map((entry) => presentationEntry(file, entry, now))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
}

export async function proposeAssistantMemory(
  runtimeRoot: string,
  input: {
    scope: AssistantMemoryScope;
    kind: AssistantMemoryKind;
    text: string;
    source: AssistantMemorySource;
    validFrom?: string;
    validUntil?: string;
    conflictKey?: string;
    now?: string;
    store?: AssistantMemoryPersistence;
  },
): Promise<AssistantMemoryEntry> {
  const scope = normalizedScope(input.scope);
  const before = await readFileState(runtimeRoot, scope, input.store);
  const file = before.file;
  const expected = before.exists ? cloneFile(before.file) : null;
  const now = input.now ?? new Date().toISOString();
  const text = normalizedText(input.text);
  const kind = validateKind(input.kind);
  const validity = normalizedValidity({ validFrom: input.validFrom, validUntil: input.validUntil }, now);
  const entry: AssistantMemoryEntry = {
    id: `memory_${randomUUID()}`,
    scope,
    kind,
    text,
    status: "proposed",
    source: validateSource(input.source),
    revision: 1,
    createdAt: now,
    updatedAt: now,
    ...validity,
    ...(normalizedConflictKey(input.conflictKey) === undefined ? {} : { conflictKey: normalizedConflictKey(input.conflictKey) }),
    history: [{ revision: 1, action: "proposed", actor: "agent", at: now, text, kind }],
  };
  file.entries.push(entry);
  file.updatedAt = now;
  await writeFile(runtimeRoot, file, expected, input.store);
  return entry;
}

export async function confirmAssistantMemory(
  runtimeRoot: string,
  input: { scope: AssistantMemoryScope; id: string; actor: "user"; supersedes?: string[]; now?: string; store?: AssistantMemoryPersistence },
): Promise<AssistantMemoryEntry> {
  const scope = normalizedScope(input.scope);
  const before = await readFileState(runtimeRoot, scope, input.store);
  const file = before.file;
  const expected = before.exists ? cloneFile(before.file) : null;
  const entry = findEntry(file, input.id);
  if (entry.status === "revoked" || entry.status === "superseded") throw new AssistantMemoryConflictError("A revoked or superseded memory cannot be confirmed; create a new proposal instead.");
  if (entry.status === "active") return entry;
  const now = input.now ?? new Date().toISOString();
  const supersedes = [...new Set(input.supersedes ?? [])].sort((left, right) => left.localeCompare(right));
  if (supersedes.includes(entry.id)) throw new AssistantMemoryConflictError("A memory cannot supersede itself.");
  const predecessors = supersedes.map((id) => findEntry(file, id));
  for (const predecessor of predecessors) {
    if (predecessor.status !== "active") throw new AssistantMemoryConflictError(`Memory ${predecessor.id} is not active and cannot be superseded.`);
    if (!entry.conflictKey || predecessor.conflictKey !== entry.conflictKey) {
      throw new AssistantMemoryConflictError("Superseded memories must share the proposed memory's explicit conflictKey.");
    }
  }
  entry.revision += 1;
  entry.status = "active";
  entry.confirmedAt = now;
  entry.updatedAt = now;
  entry.history.push({ revision: entry.revision, action: "confirmed", actor: input.actor, at: now, text: entry.text, kind: entry.kind });
  for (const predecessor of predecessors) {
    predecessor.revision += 1;
    predecessor.status = "superseded";
    predecessor.supersededAt = now;
    predecessor.supersededBy = entry.id;
    predecessor.updatedAt = now;
    predecessor.history.push({ revision: predecessor.revision, action: "superseded", actor: input.actor, at: now, text: predecessor.text, kind: predecessor.kind });
  }
  file.updatedAt = now;
  await writeFile(runtimeRoot, file, expected, input.store);
  return entry;
}

export async function editAssistantMemory(
  runtimeRoot: string,
  input: {
    scope: AssistantMemoryScope;
    id: string;
    expectedRevision: number;
    text?: string;
    kind?: AssistantMemoryKind;
    validFrom?: string;
    validUntil?: string | null;
    conflictKey?: string | null;
    actor: "user";
    now?: string;
    store?: AssistantMemoryPersistence;
  },
): Promise<AssistantMemoryEntry> {
  const scope = normalizedScope(input.scope);
  const before = await readFileState(runtimeRoot, scope, input.store);
  const file = before.file;
  const expected = before.exists ? cloneFile(before.file) : null;
  const entry = findEntry(file, input.id);
  if (entry.status === "revoked" || entry.status === "superseded") throw new AssistantMemoryConflictError("A revoked or superseded memory cannot be edited; create a new proposal instead.");
  if (entry.revision !== input.expectedRevision) {
    throw new AssistantMemoryConflictError(`Memory revision changed from ${input.expectedRevision} to ${entry.revision}.`);
  }
  const nextText = input.text === undefined ? entry.text : normalizedText(input.text);
  const nextKind = input.kind === undefined ? entry.kind : validateKind(input.kind);
  const contentChanged = nextText !== entry.text || nextKind !== entry.kind;
  const validity = normalizedValidity({
    validFrom: input.validFrom ?? entry.validFrom ?? entry.createdAt,
    validUntil: input.validUntil === undefined ? entry.validUntil : input.validUntil,
  }, entry.validFrom ?? entry.createdAt);
  const conflictKey = input.conflictKey === undefined
    ? entry.conflictKey
    : input.conflictKey === null
      ? undefined
      : normalizedConflictKey(input.conflictKey);
  if (nextText === entry.text && nextKind === entry.kind && validity.validFrom === (entry.validFrom ?? entry.createdAt) && validity.validUntil === entry.validUntil && conflictKey === entry.conflictKey) return entry;
  const previousText = entry.text;
  const previousKind = entry.kind;
  const now = input.now ?? new Date().toISOString();
  entry.revision += 1;
  entry.text = nextText;
  entry.kind = nextKind;
  entry.validFrom = validity.validFrom;
  entry.validUntil = validity.validUntil;
  if (conflictKey === undefined) delete entry.conflictKey;
  else entry.conflictKey = conflictKey;
  entry.updatedAt = now;
  entry.history.push({
    revision: entry.revision,
    action: contentChanged ? "edited" : "validity_changed",
    actor: input.actor,
    at: now,
    text: nextText,
    kind: nextKind,
    previousText,
    previousKind,
  });
  file.updatedAt = now;
  await writeFile(runtimeRoot, file, expected, input.store);
  return entry;
}

export async function revokeAssistantMemory(
  runtimeRoot: string,
  input: { scope: AssistantMemoryScope; id: string; actor: "user"; now?: string; store?: AssistantMemoryPersistence },
): Promise<AssistantMemoryEntry> {
  const scope = normalizedScope(input.scope);
  const before = await readFileState(runtimeRoot, scope, input.store);
  const file = before.file;
  const expected = before.exists ? cloneFile(before.file) : null;
  const entry = findEntry(file, input.id);
  if (entry.status === "revoked") return entry;
  const now = input.now ?? new Date().toISOString();
  entry.revision += 1;
  entry.status = "revoked";
  entry.revokedAt = now;
  entry.updatedAt = now;
  entry.history.push({ revision: entry.revision, action: "revoked", actor: input.actor, at: now, text: entry.text, kind: entry.kind });
  file.updatedAt = now;
  await writeFile(runtimeRoot, file, expected, input.store);
  return entry;
}

export function formatAssistantMemoryRecall(entries: AssistantMemoryEntry[], limit = 20): string {
  const now = new Date().toISOString();
  const active = entries.filter((entry) => isRecallActive(entry, now)).slice(0, Math.max(1, limit));
  if (!active.length) return "";
  return [
    "Explicitly confirmed memory (recall context only; never citable project evidence):",
    ...active.map((entry) => `- [${entry.kind}] ${entry.text} (scope: ${scopeDescription(entry.scope)}, source task: ${entry.source.taskId}, memory: ${entry.id}, revision: ${entry.revision})`),
  ].join("\n");
}

export interface AssistantMemoryRecallContext {
  projectId?: string;
  clientId?: string;
  franchiseId?: string;
  locale?: string;
  includePersonal?: boolean;
}

export interface AssistantMemorySemanticState {
  state: "ready" | "lexical_only";
  embeddingModel?: string;
  message?: string;
}

export interface AssistantMemoryRecallHit {
  memory: AssistantMemoryEntry;
  score: number;
  lexicalScore: number;
  semanticScore?: number;
  retrievalMode: "lexical" | "vector" | "hybrid";
  scopeRank: number;
  reason: string;
}

export interface AssistantMemoryConflictGroup {
  scope: AssistantMemoryScope;
  conflictKey: string;
  memoryIds: string[];
}

export interface AssistantMemoryRecallReport {
  query: string;
  context: AssistantMemoryRecallContext;
  semantic: AssistantMemorySemanticState;
  hits: AssistantMemoryRecallHit[];
  conflicts: AssistantMemoryConflictGroup[];
}

/**
 * Formats the immutable host-selected recall snapshot that is carried in a
 * Run plan. It deliberately includes provenance and selection reason, while
 * preserving Memory's non-Evidence status.
 */
export function formatAssistantMemoryRecallReport(report: AssistantMemoryRecallReport, limit = 20): string {
  const hits = report.hits.slice(0, Math.max(1, limit));
  if (!hits.length && !report.conflicts.length) return "";
  const semantic = report.semantic.state === "ready"
    ? `local ${report.semantic.embeddingModel ?? "embedding"}`
    : `lexical-only${report.semantic.message ? ` (${report.semantic.message})` : ""}`;
  const conflicts = report.conflicts.map((group) => `- withheld conflict group ${scopeDescription(group.scope)}/${group.conflictKey}: ${group.memoryIds.join(", ")}`);
  return [
    "Explicitly confirmed memory (recall context only; never citable project evidence):",
    `- semantic: ${semantic}`,
    ...(conflicts.length ? ["- conflict policy: explicit unresolved groups are withheld and cannot alter this Run.", ...conflicts] : []),
    ...(hits.length
      ? hits.map((hit) => {
        const entry = hit.memory;
        const validity = `from ${entry.validFrom ?? entry.createdAt}; ${entry.validUntil ? `until ${entry.validUntil}` : "no expiry"}`;
        return `- [${entry.kind}] ${entry.text} (scope: ${scopeDescription(entry.scope)}, source task: ${entry.source.taskId}, memory: ${entry.id}, revision: ${entry.revision}, validity: ${validity}, selection: ${hit.reason})`;
      })
      : ["- no memory matched this scoped recall request."]),
  ].join("\n");
}

function lexicalScore(query: string, text: string): number {
  const normalizedQuery = query.normalize("NFKC").toLocaleLowerCase().trim();
  const normalizedText = text.normalize("NFKC").toLocaleLowerCase();
  if (!normalizedQuery) return 0;
  if (normalizedText.includes(normalizedQuery)) return 1;
  const terms = normalizedQuery.split(/[\s,.;:!?，。！？、；：]+/u).filter(Boolean);
  if (!terms.length) return 0;
  return terms.filter((term) => normalizedText.includes(term)).length / terms.length;
}

function cosine(left: number[], right: number[]): number {
  if (left.length !== right.length || !left.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index]! * right[index]!;
    leftNorm += left[index]! ** 2;
    rightNorm += right[index]! ** 2;
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}

function recallScopes(context: AssistantMemoryRecallContext): Array<{ scope: AssistantMemoryScope; rank: number }> {
  const scopes: Array<{ scope: AssistantMemoryScope; rank: number }> = [];
  if (context.projectId) scopes.push({ scope: { kind: "project", projectId: validateScopeIdentifier(context.projectId, "Project memory") }, rank: 5 });
  if (context.clientId) scopes.push({ scope: { kind: "client", clientId: validateScopeIdentifier(context.clientId, "Client memory") }, rank: 4 });
  if (context.franchiseId) scopes.push({ scope: { kind: "franchise", franchiseId: validateScopeIdentifier(context.franchiseId, "Franchise memory") }, rank: 4 });
  if (context.locale) scopes.push({ scope: { kind: "locale", locale: validateScopeIdentifier(context.locale, "Locale memory") }, rank: 3 });
  if (context.includePersonal !== false) scopes.push({ scope: { kind: "personal" }, rank: 1 });
  if (!scopes.length) scopes.push({ scope: { kind: "personal" }, rank: 1 });
  return scopes;
}

function scopeTieBreak(scope: AssistantMemoryScope): number {
  return scope.kind === "project" ? 5 : scope.kind === "client" ? 4 : scope.kind === "franchise" ? 3 : scope.kind === "locale" ? 2 : 1;
}

/**
 * Searches only active, in-validity Confirmed Memory.  Scope ordering is an
 * authority rule, not a score boost: lower scopes can never outrank an equal
 * or lower-quality Project result solely because the embedding score is high.
 * A missing/corrupt managed pack is explicitly lexical-only.
 */
export async function searchAssistantMemories(
  runtimeRoot: string,
  options: {
    query: string;
    context?: AssistantMemoryRecallContext;
    limit?: number;
    retrievalMode?: "lexical" | "vector" | "hybrid";
    embedder?: LocalTextEmbedder;
    now?: string;
    store?: AssistantMemoryPersistence;
  },
): Promise<AssistantMemoryRecallReport> {
  const query = options.query.trim();
  if (!query) throw new Error("Memory recall query is required.");
  const context = options.context ?? {};
  const now = options.now ?? new Date().toISOString();
  const scopes = recallScopes(context);
  const files = await Promise.all(scopes.map(async ({ scope, rank }) => ({
    scope,
    rank,
    file: (await readFileState(runtimeRoot, scope, options.store)).file,
  })));
  const rows = files.flatMap(({ scope, rank, file }) => file.entries
    .filter((entry) => isRecallActive(entry, now))
    .map((entry) => ({ scope, rank, file, entry: presentationEntry(file, entry, now) })));
  const conflictGroups = new Map<string, { scope: AssistantMemoryScope; conflictKey: string; memoryIds: string[] }>();
  for (const row of rows) {
    if (!row.entry.conflictKey) continue;
    const key = `${JSON.stringify(row.scope)}:${row.entry.conflictKey}`;
    const group = conflictGroups.get(key) ?? { scope: row.scope, conflictKey: row.entry.conflictKey, memoryIds: [] };
    group.memoryIds.push(row.entry.id);
    conflictGroups.set(key, group);
  }
  const conflicts = [...conflictGroups.values()]
    .filter((group) => group.memoryIds.length > 1)
    .map((group) => ({ ...group, memoryIds: [...group.memoryIds].sort((left, right) => left.localeCompare(right)) }))
    .sort((left, right) => scopeTieBreak(right.scope) - scopeTieBreak(left.scope) || left.conflictKey.localeCompare(right.conflictKey));
  const conflictIds = new Set(conflicts.flatMap((group) => group.memoryIds));
  const eligible = rows.filter((row) => !conflictIds.has(row.entry.id));
  const lexical = new Map(eligible.map((row) => [row.entry.id, lexicalScore(query, row.entry.text)]));
  let semantic: AssistantMemorySemanticState = { state: "lexical_only" };
  let semanticScores = new Map<string, number>();
  if (options.retrievalMode !== "lexical" && eligible.length) {
    try {
      const embedder = options.embedder ?? await createLocalE5Embedder(runtimeRoot);
      const vectors = await embedder.embed([query, ...eligible.map((row) => row.entry.text)]);
      const queryVector = vectors[0];
      if (!queryVector || vectors.length !== eligible.length + 1 || vectors.some((vector) => vector.length !== embedder.dim)) {
        throw new Error("Local memory embedding response has an unexpected shape.");
      }
      semanticScores = new Map(eligible.map((row, index) => [row.entry.id, cosine(queryVector, vectors[index + 1]!)]));
      semantic = { state: "ready", embeddingModel: embedder.model };
    } catch (error) {
      const pack = options.embedder ? undefined : await inspectLocalEmbeddingPack(runtimeRoot).catch(() => undefined);
      semantic = {
        state: "lexical_only",
        message: pack?.message ?? (error instanceof Error ? error.message : String(error)),
      };
    }
  } else if (options.retrievalMode !== "lexical") {
    const pack = options.embedder ? undefined : await inspectLocalEmbeddingPack(runtimeRoot).catch(() => undefined);
    semantic = { state: "lexical_only", ...(pack?.message ? { message: pack.message } : {}) };
  }
  const hits = eligible.flatMap((row): AssistantMemoryRecallHit[] => {
    const lexicalValue = lexical.get(row.entry.id) ?? 0;
    const semanticValue = semanticScores.get(row.entry.id);
    const vectorReady = semantic.state === "ready" && semanticValue !== undefined;
    const score = options.retrievalMode === "vector" && vectorReady
      ? semanticValue
      : options.retrievalMode === "hybrid" && vectorReady
        ? lexicalValue + semanticValue
        : lexicalValue;
    if (!score || score <= 0) return [];
    const retrievalMode = vectorReady && lexicalValue > 0 ? "hybrid" : vectorReady ? "vector" : "lexical";
    return [{
      memory: row.entry,
      score,
      lexicalScore: lexicalValue,
      ...(semanticValue === undefined ? {} : { semanticScore: semanticValue }),
      retrievalMode,
      scopeRank: row.rank,
      reason: `scope:${row.entry.scope.kind}; retrieval:${retrievalMode}; ${semantic.state === "ready" ? `embedding:${semantic.embeddingModel}` : "semantic:lexical-only"}`,
    }];
  }).sort((left, right) => right.scopeRank - left.scopeRank
    || scopeTieBreak(right.memory.scope) - scopeTieBreak(left.memory.scope)
    || right.score - left.score
    || left.memory.id.localeCompare(right.memory.id))
    .slice(0, Math.max(1, Math.min(options.limit ?? 8, 50)));
  return { query, context, semantic, hits, conflicts };
}
