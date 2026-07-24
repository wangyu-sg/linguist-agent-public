import { createHash } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  assistantMemoryPath,
  parseAssistantMemoryFile,
  type AssistantMemoryPersistence,
  type AssistantMemoryScope,
} from "@linguist-agent/cat-data";
import {
  createSqliteAssistantMemoryPersistence,
  SqliteEventProjectionStore,
  type SqliteStorageAuthority,
} from "@linguist-agent/storage-sqlite";

export type AssistantMemorySqliteAuthority = SqliteStorageAuthority;

export interface AssistantMemorySqliteSourceReportV1 {
  sourceId: string;
  scope: AssistantMemoryScope;
  sourceSha256: string;
  sourceBytes: number;
  entryCount: number;
  status: "valid";
}

export interface AssistantMemorySqliteAuthorityMarkerV1 {
  schemaVersion: 1;
  authority: "sqlite";
  databaseRelativePath: string;
  backupRootRelativePath: string;
  cutoverAt: string;
  scopes: AssistantMemorySqliteSourceReportV1[];
  excludes: ["tdai", "semantic-index"];
}

export interface PreparedAssistantMemorySqliteCutover {
  status: "cutover" | "already-sqlite";
  marker: AssistantMemorySqliteAuthorityMarkerV1;
  store: AssistantMemoryPersistence;
  close(): void;
}

const EXCLUDES: AssistantMemorySqliteAuthorityMarkerV1["excludes"] = ["tdai", "semantic-index"];
const SHA256 = /^[a-f0-9]{64}$/u;

function digestBytes(raw: Uint8Array): string {
  return createHash("sha256").update(raw).digest("hex");
}

function safeRelativePath(root: string, path: string, label: string): string {
  const value = relative(root, path);
  if (!value || value.startsWith("..") || isAbsolute(value)) throw new Error(`${label} must remain inside the runtime root.`);
  return value.split("\\").join("/");
}

async function syncPath(path: string): Promise<void> {
  const handle = await open(path, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

async function writeAtomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await syncPath(temporary);
    await rename(temporary, path);
    await syncPath(dirname(path));
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function readOptional(path: string): Promise<Buffer | null> {
  try { return await readFile(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function markerPath(root: string): string {
  return join(root, "data", "runtime", "assistant-memory-sqlite-v1", "authority-v1.json");
}

function databasePath(root: string): string {
  return join(root, "data", "runtime", "assistant-memory-sqlite-v1", "assistant-memory.sqlite");
}

function backupRoot(root: string): string {
  return join(root, "data", "backups", "assistant-memory-cutover-v1", `attempt-${Date.now()}-${process.pid}`);
}

function sourceIdFor(scope: AssistantMemoryScope): string {
  if (scope.kind === "personal") return "assistant/memory/memories.json";
  if (scope.kind === "project") return `projects/${scope.projectId}/memory/memories.json`;
  throw new Error(`Legacy Assistant Memory has no ${scope.kind} scope source.`);
}

async function discoverSources(root: string): Promise<Array<{ sourceId: string; scope: AssistantMemoryScope; raw: Buffer }>> {
  const sources: Array<{ sourceId: string; scope: AssistantMemoryScope; raw: Buffer }> = [];
  const personal: AssistantMemoryScope = { kind: "personal" };
  const personalRaw = await readOptional(assistantMemoryPath(root, personal));
  if (personalRaw) sources.push({ sourceId: sourceIdFor(personal), scope: personal, raw: personalRaw });
  const projectsRoot = join(root, "data", "projects");
  const entries = await readdir(projectsRoot, { withFileTypes: true }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  for (const entry of entries.filter((candidate) => candidate.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const scope: AssistantMemoryScope = { kind: "project", projectId: entry.name };
    const raw = await readOptional(assistantMemoryPath(root, scope));
    if (raw) sources.push({ sourceId: sourceIdFor(scope), scope, raw });
  }
  return sources;
}

function parseMarker(value: unknown, root: string): AssistantMemorySqliteAuthorityMarkerV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("SQLite Assistant Memory authority marker is invalid.");
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== 1 || row.authority !== "sqlite" || JSON.stringify(row.excludes) !== JSON.stringify(EXCLUDES)
    || typeof row.databaseRelativePath !== "string" || typeof row.backupRootRelativePath !== "string"
    || typeof row.cutoverAt !== "string" || !Number.isFinite(Date.parse(row.cutoverAt)) || !Array.isArray(row.scopes)) {
    throw new Error("SQLite Assistant Memory authority marker is invalid.");
  }
  const scopes = row.scopes.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error(`SQLite Assistant Memory marker scope ${index} is invalid.`);
    const item = candidate as Record<string, unknown>;
    if (typeof item.sourceId !== "string" || !item.sourceId.trim()
      || typeof item.sourceSha256 !== "string" || !SHA256.test(item.sourceSha256)
      || !Number.isSafeInteger(item.sourceBytes) || Number(item.sourceBytes) < 0
      || !Number.isSafeInteger(item.entryCount) || Number(item.entryCount) < 0
      || item.status !== "valid" || !item.scope || typeof item.scope !== "object") {
      throw new Error(`SQLite Assistant Memory marker scope ${index} is invalid.`);
    }
    const scopeValue = item.scope as Record<string, unknown>;
    const scope: AssistantMemoryScope = scopeValue.kind === "personal"
      ? { kind: "personal" }
      : scopeValue.kind === "project" && typeof scopeValue.projectId === "string"
        ? { kind: "project", projectId: scopeValue.projectId }
        : (() => { throw new Error(`SQLite Assistant Memory marker scope ${index}.scope is invalid.`); })();
    return {
      sourceId: item.sourceId,
      scope,
      sourceSha256: item.sourceSha256,
      sourceBytes: Number(item.sourceBytes),
      entryCount: Number(item.entryCount),
      status: "valid" as const,
    };
  });
  if (new Set(scopes.map((entry) => entry.sourceId)).size !== scopes.length) throw new Error("SQLite Assistant Memory marker has duplicate sources.");
  const databaseRelativePath = safeRelativePath(root, resolve(root, row.databaseRelativePath), "SQLite Assistant Memory database path");
  const backupRootRelativePath = safeRelativePath(root, resolve(root, row.backupRootRelativePath), "SQLite Assistant Memory backup root");
  return {
    schemaVersion: 1,
    authority: "sqlite",
    databaseRelativePath,
    backupRootRelativePath,
    cutoverAt: new Date(row.cutoverAt).toISOString(),
    scopes,
    excludes: EXCLUDES,
  };
}

async function readMarker(path: string, root: string): Promise<AssistantMemorySqliteAuthorityMarkerV1 | null> {
  try { return parseMarker(JSON.parse(await readFile(path, "utf8")) as unknown, root); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function prepareAssistantMemorySqliteCutover(input: {
  root: string;
  authority: AssistantMemorySqliteAuthority;
  activeRunCount: number;
  now?: () => Date;
}): Promise<PreparedAssistantMemorySqliteCutover> {
  if (!Number.isSafeInteger(input.activeRunCount) || input.activeRunCount < 0) throw new Error("activeRunCount must be non-negative.");
  if (input.activeRunCount !== 0) throw new Error("Assistant Memory cutover is blocked while Agent Runs are active.");
  const root = resolve(input.root);
  await input.authority.assertOwned();
  const markerFile = markerPath(root);
  const database = databasePath(root);
  const existing = await readMarker(markerFile, root);
  const store = new SqliteEventProjectionStore(existing ? resolve(root, existing.databaseRelativePath) : database);
  const persistence = createSqliteAssistantMemoryPersistence({ store, authority: input.authority });
  if (existing) {
    await input.authority.assertOwned();
    return { status: "already-sqlite", marker: existing, store: persistence, close: () => store.close() };
  }

  const attempt = backupRoot(root);
  const sources = await discoverSources(root);
  const reports: AssistantMemorySqliteSourceReportV1[] = [];
  let markerPublished = false;
  try {
    await mkdir(attempt, { recursive: true, mode: 0o700 });
    for (const source of sources.sort((left, right) => left.sourceId.localeCompare(right.sourceId))) {
      const target = join(attempt, source.sourceId);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, source.raw, { flag: "wx", mode: 0o600 });
      await syncPath(target);
      const parsed = parseAssistantMemoryFile(JSON.parse(source.raw.toString("utf8")) as unknown, `Legacy Assistant Memory ${source.sourceId}`);
      if (await persistence.read(source.scope)) throw new Error(`Duplicate Assistant Memory scope ${source.sourceId}.`);
      await persistence.write(source.scope, parsed, null);
      const roundTrip = await persistence.read(source.scope);
      if (!roundTrip || JSON.stringify(roundTrip) !== JSON.stringify(parsed)) throw new Error(`Assistant Memory parity failed for ${source.sourceId}.`);
      reports.push({
        sourceId: source.sourceId,
        scope: source.scope,
        sourceSha256: digestBytes(source.raw),
        sourceBytes: source.raw.byteLength,
        entryCount: parsed.entries.length,
        status: "valid",
      });
    }
    const report = { schemaVersion: 1, valid: reports, invalid: [], backupRootRelativePath: safeRelativePath(root, attempt, "backup root") };
    await writeAtomicJson(join(attempt, "import-report-v1.json"), report);
    const marker: AssistantMemorySqliteAuthorityMarkerV1 = {
      schemaVersion: 1,
      authority: "sqlite",
      databaseRelativePath: safeRelativePath(root, database, "database path"),
      backupRootRelativePath: safeRelativePath(root, attempt, "backup root"),
      cutoverAt: (input.now?.() ?? new Date()).toISOString(),
      scopes: reports,
      excludes: EXCLUDES,
    };
    await input.authority.assertOwned();
    await writeAtomicJson(markerFile, marker);
    markerPublished = true;
    return { status: "cutover", marker, store: persistence, close: () => store.close() };
  } catch (error) {
    store.close();
    if (!markerPublished) {
      await Promise.all([
        rm(database, { force: true }),
        rm(`${database}-wal`, { force: true }),
        rm(`${database}-shm`, { force: true }),
      ]);
    }
    throw error;
  }
}
