import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import {
  libraryScopeRoot,
  parseLibraryMetadataFile,
  type LibraryMetadataFileV1,
  type LibraryPersistence,
  type LibraryScope,
} from "@linguist-agent/cat-data";
import {
  ContentBlobStore,
  SqliteEventProjectionStore,
  SqliteRevisionConflictError,
  type SqliteJsonObject,
  type SqliteStorageAuthority,
} from "./index.js";

export const SQLITE_ASSISTANT_LIBRARY_REPOSITORY_READINESS = Object.freeze({
  schemaVersion: 1,
  authority: "sqlite",
  streamPrefix: "assistant-library-",
  contentAuthority: "content-addressed-blob-store",
  semanticIndex: "rebuildable-non-canonical",
} as const);

function jsonObject(value: unknown): SqliteJsonObject {
  return JSON.parse(JSON.stringify(value)) as SqliteJsonObject;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${stableJson(row[key])}`).join(",")}}`;
}

function sameJson(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

export function assistantLibraryStreamId(scope: LibraryScope): string {
  const digest = createHash("sha256").update(JSON.stringify(scope)).digest("hex").slice(0, 48);
  return `assistant-library-${digest}`;
}

function metadata(value: SqliteJsonObject): LibraryMetadataFileV1 {
  return parseLibraryMetadataFile(value, "SQLite Assistant Library projection");
}

function safeName(value: string): string {
  const clean = value.normalize("NFKC").replace(/[\0/\\]/g, "-").replace(/^\.+/, "").trim();
  return clean.slice(0, 180) || "document";
}

function managedRelPath(documentId: string, originalName: string): string {
  return join("sources", documentId, safeName(originalName)).split("\\").join("/");
}

function managedSourcePath(root: string, scope: LibraryScope, managedRelPath: string): string {
  const scopeRoot = resolve(libraryScopeRoot(root, scope));
  const path = resolve(scopeRoot, managedRelPath);
  const rel = relative(scopeRoot, path);
  if (!rel || rel.startsWith("..") || resolve(scopeRoot, rel) !== path) {
    throw new Error("SQLite Library managed source escapes its scope.");
  }
  return path;
}

async function syncFile(path: string): Promise<void> {
  const handle = await open(path, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

async function writeAtomicBytes(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, Buffer.from(bytes), { flag: "wx", mode: 0o600 });
    await syncFile(temporary);
    await rename(temporary, path);
    await syncDirectory(dirname(path));
  } finally {
    await rm(temporary, { force: true });
  }
}

/** SQLite projection plus content-addressed bytes for Library metadata. */
export function createSqliteAssistantLibraryPersistence(input: {
  root: string;
  store: SqliteEventProjectionStore;
  blobStore: ContentBlobStore;
  authority: SqliteStorageAuthority;
}): LibraryPersistence {
  const root = resolve(input.root);
  return {
    async read(scope) {
      const projection = input.store.readProjection(assistantLibraryStreamId(scope));
      return projection ? metadata(projection.value) : null;
    },
    async write(scope, value, expected) {
      await input.authority.assertOwned();
      if (value.scope.kind !== scope.kind || (scope.kind === "project" && value.scope.kind === "project" && value.scope.projectId !== scope.projectId)) {
        throw new Error("SQLite Library metadata scope does not match the requested scope.");
      }
      const id = assistantLibraryStreamId(scope);
      const projection = jsonObject(parseLibraryMetadataFile(value, "SQLite Library metadata"));
      const current = input.store.readProjection(id);
      if (!current) {
        if (expected !== null) throw new SqliteRevisionConflictError(id, 0, 0);
        input.store.initializeProjection({
          commandId: `assistant-library-init-${createHash("sha256").update(stableJson(projection)).digest("hex").slice(0, 40)}`,
          streamId: id,
          projection,
        });
        return;
      }
      if (!expected || !sameJson(metadata(current.value), expected)) {
        throw new SqliteRevisionConflictError(id, expected ? current.revision : 0, current.revision);
      }
      input.store.append({
        commandId: `assistant-library-write-${createHash("sha256").update(stableJson({ id, revision: current.revision, projection })).digest("hex").slice(0, 40)}`,
        streamId: id,
        expectedRevision: current.revision,
        events: [{
          id: createHash("sha256").update(stableJson({ id, revision: current.revision + 1, projection })).digest("hex").slice(0, 48),
          type: "assistant_library.snapshot.updated",
          occurredAt: value.updatedAt,
          payload: {
            scope: jsonObject(scope),
            documentCount: value.documents.length,
            blockCount: value.blocks.length,
            contentBlobRefs: value.documents.map((document) => document.contentBlobRefId).filter((ref): ref is string => Boolean(ref)).sort(),
          },
        }],
        projection,
      });
    },
    async putDocument(documentInput) {
      const published = await input.blobStore.putBytes(documentInput.bytes, { expectedSha256: documentInput.expectedSha256 });
      const managed = managedRelPath(documentInput.documentId, documentInput.originalName);
      const target = managedSourcePath(root, documentInput.scope, managed);
      const existing = await readFile(target).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      });
      if (existing && createHash("sha256").update(existing).digest("hex") !== documentInput.expectedSha256) {
        throw new Error(`SQLite Library managed source ${managed} does not match the approved digest.`);
      }
      if (!existing) await writeAtomicBytes(target, documentInput.bytes);
      return { managedRelPath: managed, contentBlobRefId: published.ref.sha256 };
    },
    async materializeDocument(_scope, document) {
      if (!document.contentBlobRefId) throw new Error(`SQLite Library document ${document.id} has no content blob reference.`);
      const bytes = await input.blobStore.readBytes(document.contentBlobRefId);
      if (bytes.byteLength !== document.sizeBytes) throw new Error(`SQLite Library document ${document.id} size does not match its blob.`);
      return { path: input.blobStore.pathFor(document.contentBlobRefId) };
    },
    async removeDocument(scope, document) {
      await input.authority.assertOwned();
      const source = managedSourcePath(root, scope, document.managedRelPath);
      await rm(dirname(source), { recursive: true, force: true });
      // Content blobs remain orphaned until an authority-gated GC decision proves they are unused.
    },
  };
}
