import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  libraryBlocksPath,
  libraryCatalogPath,
  libraryScopeRoot,
  libraryVectorsPath,
  parseLibraryMetadataFile,
  type LibraryMetadataFileV1,
  type LibraryPersistence,
  type LibraryScope,
  type StoredLibraryDocumentV1,
} from "@linguist-agent/cat-data";
import {
  ContentBlobStore,
  createSqliteAssistantLibraryPersistence,
  SqliteEventProjectionStore,
  type SqliteStorageAuthority,
} from "@linguist-agent/storage-sqlite";

export type AssistantLibrarySqliteAuthority = SqliteStorageAuthority;

export interface AssistantLibrarySqliteSourceReportV1 {
  sourceId: string;
  scope: LibraryScope;
  catalogSha256: string;
  catalogBytes: number;
  blockCount: number;
  documentCount: number;
  blobCount: number;
  status: "valid";
}

export interface AssistantLibrarySqliteAuthorityMarkerV1 {
  schemaVersion: 1;
  authority: "sqlite";
  databaseRelativePath: string;
  blobRootRelativePath: string;
  backupRootRelativePath: string;
  cutoverAt: string;
  scopes: AssistantLibrarySqliteSourceReportV1[];
  excludes: ["semantic-index"];
}

export interface PreparedAssistantLibrarySqliteCutover {
  status: "cutover" | "already-sqlite";
  marker: AssistantLibrarySqliteAuthorityMarkerV1;
  persistence: LibraryPersistence;
  store: SqliteEventProjectionStore;
  blobStore: ContentBlobStore;
  close(): void;
}

const EXCLUDES: AssistantLibrarySqliteAuthorityMarkerV1["excludes"] = ["semantic-index"];
const SHA256 = /^[a-f0-9]{64}$/u;

function digestBytes(raw: Uint8Array): string {
  return createHash("sha256").update(raw).digest("hex");
}

function safeRelativePath(root: string, path: string, label: string): string {
  const value = relative(root, resolve(path));
  if (!value || value.startsWith("..") || isAbsolute(value)) throw new Error(`${label} must remain inside the runtime root.`);
  return value.split("\\").join("/");
}

async function syncFile(path: string): Promise<void> {
  const handle = await open(path, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

async function writeAtomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await syncFile(temporary);
    await rename(temporary, path);
    await syncDirectory(dirname(path));
  } finally {
    await rm(temporary, { force: true });
  }
}

async function readOptional(path: string): Promise<Buffer | null> {
  try { return await readFile(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function markerPath(root: string): string {
  return join(root, "data", "runtime", "assistant-library-sqlite-v1", "authority-v1.json");
}

function databasePath(root: string): string {
  return join(root, "data", "runtime", "assistant-library-sqlite-v1", "assistant-library.sqlite");
}

function blobRoot(root: string): string {
  return join(root, "data", "runtime", "assistant-library-sqlite-v1", "blob-store");
}

function backupRoot(root: string): string {
  return join(root, "data", "backups", "assistant-library-cutover-v1", `attempt-${Date.now()}-${process.pid}`);
}

function scopeSourceId(scope: LibraryScope): string {
  return scope.kind === "personal" ? "assistant/library/personal" : `projects/${scope.projectId}/library`;
}

function parseScope(value: unknown, label: string): LibraryScope {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid.`);
  const row = value as Record<string, unknown>;
  if (row.kind === "personal") return { kind: "personal" };
  if (row.kind === "project" && typeof row.projectId === "string" && row.projectId.trim() && !row.projectId.includes("/") && !row.projectId.includes("\\")) {
    return { kind: "project", projectId: row.projectId };
  }
  throw new Error(`${label} is invalid.`);
}

function parseMarker(value: unknown, root: string): AssistantLibrarySqliteAuthorityMarkerV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("SQLite Assistant Library authority marker is invalid.");
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== 1 || row.authority !== "sqlite" || JSON.stringify(row.excludes) !== JSON.stringify(EXCLUDES)
    || typeof row.databaseRelativePath !== "string" || typeof row.blobRootRelativePath !== "string"
    || typeof row.backupRootRelativePath !== "string" || typeof row.cutoverAt !== "string"
    || !Number.isFinite(Date.parse(row.cutoverAt)) || !Array.isArray(row.scopes)) {
    throw new Error("SQLite Assistant Library authority marker is invalid.");
  }
  const scopes = row.scopes.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error(`SQLite Assistant Library marker scope ${index} is invalid.`);
    const item = candidate as Record<string, unknown>;
    if (typeof item.sourceId !== "string" || !item.sourceId.trim()
      || typeof item.catalogSha256 !== "string" || !SHA256.test(item.catalogSha256)
      || !Number.isSafeInteger(item.catalogBytes) || Number(item.catalogBytes) < 0
      || !Number.isSafeInteger(item.blockCount) || Number(item.blockCount) < 0
      || !Number.isSafeInteger(item.documentCount) || Number(item.documentCount) < 0
      || !Number.isSafeInteger(item.blobCount) || Number(item.blobCount) < 0
      || item.status !== "valid" || !item.scope) {
      throw new Error(`SQLite Assistant Library marker scope ${index} is invalid.`);
    }
    return {
      sourceId: item.sourceId,
      scope: parseScope(item.scope, `SQLite Assistant Library marker scope ${index}.scope`),
      catalogSha256: item.catalogSha256,
      catalogBytes: Number(item.catalogBytes),
      blockCount: Number(item.blockCount),
      documentCount: Number(item.documentCount),
      blobCount: Number(item.blobCount),
      status: "valid" as const,
    };
  });
  if (new Set(scopes.map((entry) => entry.sourceId)).size !== scopes.length) throw new Error("SQLite Assistant Library marker has duplicate scopes.");
  return {
    schemaVersion: 1,
    authority: "sqlite",
    databaseRelativePath: safeRelativePath(root, resolve(root, row.databaseRelativePath), "SQLite Assistant Library database path"),
    blobRootRelativePath: safeRelativePath(root, resolve(root, row.blobRootRelativePath), "SQLite Assistant Library blob root"),
    backupRootRelativePath: safeRelativePath(root, resolve(root, row.backupRootRelativePath), "SQLite Assistant Library backup root"),
    cutoverAt: new Date(row.cutoverAt).toISOString(),
    scopes,
    excludes: EXCLUDES,
  };
}

async function readMarker(path: string, root: string): Promise<AssistantLibrarySqliteAuthorityMarkerV1 | null> {
  try { return parseMarker(JSON.parse(await readFile(path, "utf8")) as unknown, root); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function discoverScopes(root: string): Promise<LibraryScope[]> {
  const scopes: LibraryScope[] = [];
  if (await readOptional(libraryCatalogPath(root, { kind: "personal" }))) scopes.push({ kind: "personal" });
  const projectsRoot = join(root, "data", "projects");
  const entries = await readdir(projectsRoot, { withFileTypes: true }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  for (const entry of entries.filter((candidate) => candidate.isDirectory()).sort((left, right) => left.name.localeCompare(right.name))) {
    const scope: LibraryScope = { kind: "project", projectId: entry.name };
    if (await readOptional(libraryCatalogPath(root, scope))) scopes.push(scope);
  }
  return scopes;
}

function parseLegacyBlocks(raw: Buffer | null): unknown[] {
  if (!raw || raw.length === 0) return [];
  return raw.toString("utf8").split(/\r?\n/u).filter((line) => line.trim()).map((line, index) => {
    try { return JSON.parse(line) as unknown; } catch (error) { throw new Error(`Legacy Library blocks line ${index + 1} is invalid: ${error instanceof Error ? error.message : String(error)}`); }
  });
}

async function copyExact(source: string, target: string): Promise<void> {
  const metadata = await lstat(source);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`Library migration source must be a regular file: ${source}`);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await copyFile(source, target);
  await syncFile(target);
}

async function backupScope(root: string, attempt: string, scope: LibraryScope, metadata: LibraryMetadataFileV1): Promise<void> {
  const sourceRoot = libraryScopeRoot(root, scope);
  const targetRoot = join(attempt, scopeSourceId(scope));
  await copyExact(libraryCatalogPath(root, scope), join(targetRoot, "catalog.json"));
  const blocks = libraryBlocksPath(root, scope);
  if (await readOptional(blocks)) await copyExact(blocks, join(targetRoot, "blocks.jsonl"));
  const vectors = libraryVectorsPath(root, scope);
  if (await readOptional(vectors)) await copyExact(vectors, join(targetRoot, "vectors.jsonl"));
  for (const document of metadata.documents) {
    const source = resolve(sourceRoot, document.managedRelPath);
    const rel = relative(resolve(sourceRoot), source);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`Library managed source escapes its scope: ${document.id}`);
    await copyExact(source, join(targetRoot, "managed", rel));
  }
}

async function readLegacyMetadata(root: string, scope: LibraryScope): Promise<{ rawCatalog: Buffer; metadata: LibraryMetadataFileV1 }> {
  const rawCatalog = await readFile(libraryCatalogPath(root, scope));
  const catalog = JSON.parse(rawCatalog.toString("utf8")) as unknown;
  const blocks = parseLegacyBlocks(await readOptional(libraryBlocksPath(root, scope)));
  const metadata = parseLibraryMetadataFile({ ...(catalog as object), blocks }, `Legacy Library ${scopeSourceId(scope)}`);
  return { rawCatalog, metadata };
}

export async function prepareAssistantLibrarySqliteCutover(input: {
  root: string;
  authority: AssistantLibrarySqliteAuthority;
  activeRunCount: number;
  now?: () => Date;
}): Promise<PreparedAssistantLibrarySqliteCutover> {
  if (!Number.isSafeInteger(input.activeRunCount) || input.activeRunCount < 0) throw new Error("activeRunCount must be non-negative.");
  if (input.activeRunCount !== 0) throw new Error("Assistant Library cutover is blocked while Agent Runs are active.");
  const root = resolve(input.root);
  await input.authority.assertOwned();
  const existing = await readMarker(markerPath(root), root);
  const database = existing ? resolve(root, existing.databaseRelativePath) : databasePath(root);
  const blobRootPath = existing ? resolve(root, existing.blobRootRelativePath) : blobRoot(root);
  const store = new SqliteEventProjectionStore(database);
  const blobStore = new ContentBlobStore(blobRootPath, { authority: input.authority });
  const persistence = createSqliteAssistantLibraryPersistence({ root, store, blobStore, authority: input.authority });
  if (existing) {
    await input.authority.assertOwned();
    return { status: "already-sqlite", marker: existing, persistence, store, blobStore, close: () => store.close() };
  }

  const attempt = backupRoot(root);
  const reports: AssistantLibrarySqliteSourceReportV1[] = [];
  let markerPublished = false;
  try {
    await mkdir(attempt, { recursive: true, mode: 0o700 });
    for (const scope of await discoverScopes(root)) {
      const { rawCatalog, metadata } = await readLegacyMetadata(root, scope);
      await backupScope(root, attempt, scope, metadata);
      const blobRefs = new Set<string>();
      const documents: StoredLibraryDocumentV1[] = [];
      for (const document of metadata.documents) {
        const source = resolve(libraryScopeRoot(root, scope), document.managedRelPath);
        const sourceStat = await lstat(source);
        if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
          throw new Error(`Library managed source must be a regular file: ${scopeSourceId(scope)}/${document.id}.`);
        }
        const sourceBytes = await readFile(source);
        const sourceDigest = digestBytes(sourceBytes);
        if (sourceDigest !== document.sourceDigest || sourceBytes.byteLength !== document.sizeBytes) {
          throw new Error(`Library source parity failed for ${scopeSourceId(scope)}/${document.id}.`);
        }
        const published = await blobStore.putBytes(sourceBytes, { expectedSha256: document.sourceDigest });
        blobRefs.add(published.ref.sha256);
        documents.push({ ...document, contentBlobRefId: published.ref.sha256 });
      }
      const imported: LibraryMetadataFileV1 = { ...metadata, documents };
      if (await persistence.read(scope)) throw new Error(`Duplicate SQLite Library scope ${scopeSourceId(scope)}.`);
      await persistence.write(scope, imported, null);
      const roundTrip = await persistence.read(scope);
      if (!roundTrip || !JSON.stringify(roundTrip) || JSON.stringify(roundTrip) !== JSON.stringify(imported)) {
        throw new Error(`SQLite Library metadata parity failed for ${scopeSourceId(scope)}.`);
      }
      reports.push({
        sourceId: scopeSourceId(scope),
        scope,
        catalogSha256: digestBytes(rawCatalog),
        catalogBytes: rawCatalog.byteLength,
        blockCount: metadata.blocks.length,
        documentCount: metadata.documents.length,
        blobCount: blobRefs.size,
        status: "valid",
      });
    }
    const backupRootRelativePath = safeRelativePath(root, attempt, "SQLite Assistant Library backup root");
    await writeAtomicJson(join(attempt, "import-report-v1.json"), { schemaVersion: 1, valid: reports, invalid: [], backupRootRelativePath });
    const marker: AssistantLibrarySqliteAuthorityMarkerV1 = {
      schemaVersion: 1,
      authority: "sqlite",
      databaseRelativePath: safeRelativePath(root, database, "SQLite Assistant Library database path"),
      blobRootRelativePath: safeRelativePath(root, blobRootPath, "SQLite Assistant Library blob root"),
      backupRootRelativePath,
      cutoverAt: (input.now?.() ?? new Date()).toISOString(),
      scopes: reports,
      excludes: EXCLUDES,
    };
    await input.authority.assertOwned();
    await writeAtomicJson(markerPath(root), marker);
    markerPublished = true;
    return { status: "cutover", marker, persistence, store, blobStore, close: () => store.close() };
  } catch (error) {
    store.close();
    if (!markerPublished) {
      await Promise.all([
        rm(database, { force: true }),
        rm(`${database}-wal`, { force: true }),
        rm(`${database}-shm`, { force: true }),
        rm(blobRootPath, { recursive: true, force: true }),
      ]);
    }
    throw error;
  }
}
