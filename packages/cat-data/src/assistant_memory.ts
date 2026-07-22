import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { readJsonFile, writeJsonFile } from "./workspace.js";

export type AssistantMemoryScope = { kind: "personal" } | { kind: "project"; projectId: string };
export type AssistantMemoryKind = "preference" | "fact" | "guidance";
export type AssistantMemoryStatus = "proposed" | "active" | "revoked";
export type AssistantMemoryHistoryAction = "proposed" | "confirmed" | "edited" | "revoked";

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
  confirmedAt?: string;
  revokedAt?: string;
  history: AssistantMemoryHistoryEntry[];
}

interface AssistantMemoryFile {
  schemaVersion: 1;
  scope: AssistantMemoryScope;
  entries: AssistantMemoryEntry[];
  updatedAt: string;
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

function validateProjectId(projectId: string): string {
  const value = projectId.trim();
  if (!value || value === "." || value === ".." || value.includes("/") || value.includes("\\") || value.includes("\0")) {
    throw new Error("Project memory requires a safe projectId.");
  }
  return value;
}

function sameScope(left: AssistantMemoryScope, right: AssistantMemoryScope): boolean {
  return left.kind === right.kind && (left.kind === "personal" || (right.kind === "project" && left.projectId === right.projectId));
}

export function assistantMemoryPath(runtimeRoot: string, scope: AssistantMemoryScope): string {
  return scope.kind === "personal"
    ? join(runtimeRoot, "data", "assistant", "memory", "memories.json")
    : join(runtimeRoot, "data", "projects", validateProjectId(scope.projectId), "memory", "memories.json");
}

function defaultFile(scope: AssistantMemoryScope): AssistantMemoryFile {
  return { schemaVersion: 1, scope, entries: [], updatedAt: new Date(0).toISOString() };
}

async function readFile(runtimeRoot: string, scope: AssistantMemoryScope): Promise<AssistantMemoryFile> {
  const file = await readJsonFile<AssistantMemoryFile>(assistantMemoryPath(runtimeRoot, scope), defaultFile(scope));
  if (file.schemaVersion !== 1 || !sameScope(file.scope, scope) || !Array.isArray(file.entries)) {
    throw new Error("Memory file scope or schema does not match its managed storage root.");
  }
  return file;
}

async function writeFile(runtimeRoot: string, file: AssistantMemoryFile): Promise<void> {
  await writeJsonFile(assistantMemoryPath(runtimeRoot, file.scope), file);
}

function normalizedText(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) throw new Error("Memory text is required.");
  if (text.length > 20_000) throw new Error("Memory text exceeds the 20,000 character limit.");
  return text;
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

function findEntry(file: AssistantMemoryFile, id: string): AssistantMemoryEntry {
  const entry = file.entries.find((candidate) => candidate.id === id);
  if (!entry) throw new AssistantMemoryNotFoundError(id);
  return entry;
}

export async function listAssistantMemories(
  runtimeRoot: string,
  scope: AssistantMemoryScope,
  options: { status?: AssistantMemoryStatus; kind?: AssistantMemoryKind } = {},
): Promise<AssistantMemoryEntry[]> {
  const file = await readFile(runtimeRoot, scope);
  return file.entries
    .filter((entry) => options.status === undefined || entry.status === options.status)
    .filter((entry) => options.kind === undefined || entry.kind === options.kind)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
}

export async function proposeAssistantMemory(
  runtimeRoot: string,
  input: {
    scope: AssistantMemoryScope;
    kind: AssistantMemoryKind;
    text: string;
    source: AssistantMemorySource;
    now?: string;
  },
): Promise<AssistantMemoryEntry> {
  const file = await readFile(runtimeRoot, input.scope);
  const now = input.now ?? new Date().toISOString();
  const text = normalizedText(input.text);
  const kind = validateKind(input.kind);
  const entry: AssistantMemoryEntry = {
    id: `memory_${randomUUID()}`,
    scope: input.scope,
    kind,
    text,
    status: "proposed",
    source: validateSource(input.source),
    revision: 1,
    createdAt: now,
    updatedAt: now,
    history: [{ revision: 1, action: "proposed", actor: "agent", at: now, text, kind }],
  };
  file.entries.push(entry);
  file.updatedAt = now;
  await writeFile(runtimeRoot, file);
  return entry;
}

export async function confirmAssistantMemory(
  runtimeRoot: string,
  input: { scope: AssistantMemoryScope; id: string; actor: "user"; now?: string },
): Promise<AssistantMemoryEntry> {
  const file = await readFile(runtimeRoot, input.scope);
  const entry = findEntry(file, input.id);
  if (entry.status === "revoked") throw new AssistantMemoryConflictError("A revoked memory cannot be confirmed; create a new proposal instead.");
  if (entry.status === "active") return entry;
  const now = input.now ?? new Date().toISOString();
  entry.revision += 1;
  entry.status = "active";
  entry.confirmedAt = now;
  entry.updatedAt = now;
  entry.history.push({ revision: entry.revision, action: "confirmed", actor: input.actor, at: now, text: entry.text, kind: entry.kind });
  file.updatedAt = now;
  await writeFile(runtimeRoot, file);
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
    actor: "user";
    now?: string;
  },
): Promise<AssistantMemoryEntry> {
  const file = await readFile(runtimeRoot, input.scope);
  const entry = findEntry(file, input.id);
  if (entry.status === "revoked") throw new AssistantMemoryConflictError("A revoked memory cannot be edited; create a new proposal instead.");
  if (entry.revision !== input.expectedRevision) {
    throw new AssistantMemoryConflictError(`Memory revision changed from ${input.expectedRevision} to ${entry.revision}.`);
  }
  const nextText = input.text === undefined ? entry.text : normalizedText(input.text);
  const nextKind = input.kind === undefined ? entry.kind : validateKind(input.kind);
  if (nextText === entry.text && nextKind === entry.kind) return entry;
  const previousText = entry.text;
  const previousKind = entry.kind;
  const now = input.now ?? new Date().toISOString();
  entry.revision += 1;
  entry.text = nextText;
  entry.kind = nextKind;
  entry.updatedAt = now;
  entry.history.push({
    revision: entry.revision,
    action: "edited",
    actor: input.actor,
    at: now,
    text: nextText,
    kind: nextKind,
    previousText,
    previousKind,
  });
  file.updatedAt = now;
  await writeFile(runtimeRoot, file);
  return entry;
}

export async function revokeAssistantMemory(
  runtimeRoot: string,
  input: { scope: AssistantMemoryScope; id: string; actor: "user"; now?: string },
): Promise<AssistantMemoryEntry> {
  const file = await readFile(runtimeRoot, input.scope);
  const entry = findEntry(file, input.id);
  if (entry.status === "revoked") return entry;
  const now = input.now ?? new Date().toISOString();
  entry.revision += 1;
  entry.status = "revoked";
  entry.revokedAt = now;
  entry.updatedAt = now;
  entry.history.push({ revision: entry.revision, action: "revoked", actor: input.actor, at: now, text: entry.text, kind: entry.kind });
  file.updatedAt = now;
  await writeFile(runtimeRoot, file);
  return entry;
}

export function formatAssistantMemoryRecall(entries: AssistantMemoryEntry[], limit = 20): string {
  const active = entries.filter((entry) => entry.status === "active").slice(0, Math.max(1, limit));
  if (!active.length) return "";
  return [
    "Explicitly confirmed memory (recall context only; never citable project evidence):",
    ...active.map((entry) => `- [${entry.kind}] ${entry.text} (source task: ${entry.source.taskId}, memory: ${entry.id})`),
  ].join("\n");
}
