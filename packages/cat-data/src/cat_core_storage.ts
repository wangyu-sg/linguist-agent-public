import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import type { BatchSegment, CatBatch } from "./batch_workspace.js";
import type { ProjectManifest } from "./project_manifest.js";
import type { TermbaseEntry, TermbaseOverride } from "./termbase.js";
import type { TmEntry } from "./tm.js";

/**
 * The CAT-core storage boundary deliberately lives in cat-data so CAT callers
 * do not import the SQLite implementation.  The SQLite package implements
 * this interface and is installed once by the server composition root.
 */
export interface CatCoreSourceRef {
  id: string;
  projectId: string;
  ownerKind: "batch" | "asset";
  ownerId: string;
  path: string;
  sha256: string;
  bytes: number;
  blobRefId: string;
}

export interface CatCoreTermbaseState {
  entries: TermbaseEntry[];
  overrides: TermbaseOverride[];
}

export interface CatCorePersistence {
  readonly root: string;
  readBatch(projectId: string, batchId: string): Promise<CatBatch | null>;
  writeBatch(projectId: string, batchId: string, value: CatBatch, expected: CatBatch | null): Promise<void>;
  listBatches(projectId: string): Promise<Array<{ batchId: string; path: string }>>;
  readTm(projectId: string): Promise<TmEntry[]>;
  writeTm(projectId: string, entries: TmEntry[], expected: TmEntry[] | null): Promise<void>;
  readTermbase(projectId: string): Promise<CatCoreTermbaseState>;
  writeTermbase(projectId: string, value: CatCoreTermbaseState, expected: CatCoreTermbaseState | null): Promise<void>;
  readProjectManifest(projectId: string): Promise<ProjectManifest | null>;
  writeProjectManifest(projectId: string, value: ProjectManifest, expected: ProjectManifest | null): Promise<void>;
  readSourceRefs(projectId: string, ownerKind: CatCoreSourceRef["ownerKind"], ownerId: string): Promise<CatCoreSourceRef[]>;
  writeSourceRefs(projectId: string, ownerKind: CatCoreSourceRef["ownerKind"], ownerId: string, refs: CatCoreSourceRef[]): Promise<void>;
}

const persistenceByRoot = new Map<string, CatCorePersistence>();

export function catCoreAuthorityMarkerPath(root: string): string {
  return resolve(root, "data", "runtime", "cat-core-sqlite-v1", "authority-v1.json");
}

function safeCachePart(value: string): string {
  return encodeURIComponent(value).replace(/%/gu, "_");
}

export function catCoreReadCachePath(
  root: string,
  kind: "manifest" | "batch" | "tm" | "termbase",
  projectId: string,
  id = "root",
): string {
  const filename = kind === "manifest" ? "manifest.json" : kind === "tm" ? "tm.json" : kind === "termbase" ? "termbase.json" : `${safeCachePart(id)}.json`;
  const directory = kind === "batch" ? "batches" : "";
  return join(resolve(root), "data", "runtime", "cat-core-sqlite-v1", "read-cache", safeCachePart(projectId), directory, filename);
}

/** Read-only cross-process projection for callers that cannot own SQLite. */
export async function readCatCoreReadCache<T>(
  root: string,
  kind: "manifest" | "batch" | "tm" | "termbase",
  projectId: string,
  id = "root",
): Promise<T | null> {
  try {
    await readFile(catCoreAuthorityMarkerPath(root), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    return JSON.parse(await readFile(catCoreReadCachePath(root, kind, projectId, id), "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`SQLite CAT-core read projection is missing for ${kind}/${projectId}/${id}.`);
    }
    throw error;
  }
}

export function installCatCorePersistence(root: string, persistence: CatCorePersistence): void {
  const key = resolve(root);
  if (resolve(persistence.root) !== key) throw new Error("CAT-core persistence root does not match the installation root.");
  const current = persistenceByRoot.get(key);
  if (current && current !== persistence) throw new Error(`CAT-core persistence is already installed for ${key}.`);
  persistenceByRoot.set(key, persistence);
}

export function catCorePersistenceFor(root: string): CatCorePersistence | undefined {
  return persistenceByRoot.get(resolve(root));
}

export async function assertCatCoreLegacyAllowed(root: string): Promise<void> {
  if (catCorePersistenceFor(root)) return;
  try {
    await readFile(catCoreAuthorityMarkerPath(root), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error("SQLite CAT-core storage is authoritative; legacy CAT JSON writers are disabled.");
}

export function resetCatCorePersistenceForTests(root: string): void {
  persistenceByRoot.delete(resolve(root));
}

export type CatCoreSegmentFacts = Pick<BatchSegment, "id" | "source" | "target" | "locked" | "updatedAt">;

export function catCoreOwnerId(ownerKind: CatCoreSourceRef["ownerKind"], ownerId: string): string {
  return `${ownerKind}:${ownerId}`;
}
