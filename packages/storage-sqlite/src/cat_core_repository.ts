import { createHash } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { batchPath, catCoreReadCachePath, createWorkspace, type CatBatch, type CatCorePersistence, type CatCoreSourceRef, type CatCoreTermbaseState, projectManifestPath, type ProjectManifest, type TmEntry } from "@linguist-agent/cat-data";
import {
  ContentBlobStore,
  SqliteEventProjectionStore,
  SqliteRevisionConflictError,
  type SqliteJsonObject,
  type SqliteStorageAuthority,
} from "./index.js";

export const SQLITE_CAT_CORE_REPOSITORY_READINESS = Object.freeze({
  schemaVersion: 1,
  authority: "sqlite",
  semanticIndexes: "rebuildable",
  sourceBytes: "content-addressed-blob-store",
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

function digest(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function streamId(kind: "batch" | "tm" | "termbase" | "manifest" | "source", projectId: string, id = "root"): string {
  const suffix = createHash("sha256").update(`${projectId}\u0000${id}`).digest("hex").slice(0, 48);
  return `cat-core-${kind}-${suffix}`;
}

function projectionValue<T>(value: SqliteJsonObject, label: string): T {
  const candidate = value.value;
  if (candidate === undefined) throw new Error(`${label} projection has no value.`);
  return candidate as T;
}

function sameJson(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

function isEmptyInitialValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return Array.isArray(row.entries) && row.entries.length === 0 && Array.isArray(row.overrides) && row.overrides.length === 0;
}

function sourceOwnerId(ownerKind: CatCoreSourceRef["ownerKind"], ownerId: string): string {
  return `${ownerKind}:${ownerId}`;
}

export interface SqliteCatCoreRepositoryInput {
  root: string;
  store: SqliteEventProjectionStore;
  blobStore: ContentBlobStore;
  authority: SqliteStorageAuthority;
}

export class SqliteCatCoreRepository implements CatCorePersistence {
  readonly root: string;

  constructor(private readonly input: SqliteCatCoreRepositoryInput) {
    this.root = input.root;
  }

  private read<T>(kind: "batch" | "tm" | "termbase" | "manifest" | "source", projectId: string, id = "root"): T | null {
    const stored = this.input.store.readProjection(streamId(kind, projectId, id));
    return stored ? projectionValue<T>(stored.value, `CAT-core ${kind}`) : null;
  }

  private async writeReadCache(
    kind: "batch" | "tm" | "termbase" | "manifest",
    projectId: string,
    id: string,
    value: unknown,
  ): Promise<void> {
    const path = catCoreReadCachePath(this.root, kind, projectId, id);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
    try {
      await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  private async write<T>(
    kind: "batch" | "tm" | "termbase" | "manifest" | "source",
    projectId: string,
    id: string,
    value: T,
    expected: T | null,
    eventType: string,
  ): Promise<void> {
    await this.input.authority.assertOwned();
    const idForStream = streamId(kind, projectId, id);
    const current = this.input.store.readProjection(idForStream);
    const projection = jsonObject({ schemaVersion: 1, projectId, id, value: jsonObject(value) });
    if (!current) {
      if (expected !== null && !isEmptyInitialValue(expected)) throw new SqliteRevisionConflictError(idForStream, 0, 0);
      this.input.store.initializeProjection({
        commandId: `cat-core-init-${digest({ kind, projectId, id, value }).slice(0, 48)}`,
        streamId: idForStream,
        projection,
      });
      if (kind !== "source") await this.writeReadCache(kind, projectId, id, value);
      return;
    }
    const currentValue = projectionValue<T>(current.value, `CAT-core ${kind}`);
    if (expected === null || !sameJson(currentValue, expected)) {
      throw new SqliteRevisionConflictError(idForStream, expected ? current.revision : 0, current.revision);
    }
    this.input.store.append({
        commandId: `cat-core-write-${digest({ kind, projectId, id, revision: current.revision, value }).slice(0, 48)}`,
        streamId: idForStream,
        expectedRevision: current.revision,
        events: [{
          id: digest({ kind, projectId, id, revision: current.revision + 1, value }).slice(0, 48),
          type: eventType,
          occurredAt: new Date().toISOString(),
          payload: jsonObject({ projectId, id, revision: current.revision + 1 }),
        }],
        projection,
      });
    if (kind !== "source") await this.writeReadCache(kind, projectId, id, value);
  }

  async readBatch(projectId: string, batchId: string): Promise<CatBatch | null> {
    return this.read<CatBatch>("batch", projectId, batchId);
  }

  async writeBatch(projectId: string, batchId: string, value: CatBatch, expected: CatBatch | null): Promise<void> {
    if (value.projectId !== projectId || value.batchId !== batchId) throw new Error("CAT-core batch identity does not match its storage key.");
    await this.write("batch", projectId, batchId, value, expected, "cat_core.batch.updated");
  }

  async listBatches(projectId: string): Promise<Array<{ batchId: string; path: string }>> {
    return this.input.store.listProjections()
      .filter((projection) => projection.streamId.startsWith("cat-core-batch-"))
      .map((projection) => projectionValue<CatBatch>(projection.value, "CAT-core batch"))
      .filter((batch) => batch.projectId === projectId)
      .sort((left, right) => left.batchId.localeCompare(right.batchId))
      .map((batch) => ({ batchId: batch.batchId, path: batchPath(createWorkspace(this.root, projectId), batch.batchId) }));
  }

  async readTm(projectId: string): Promise<TmEntry[]> {
    return this.read<TmEntry[]>("tm", projectId) ?? [];
  }

  async writeTm(projectId: string, entries: TmEntry[], expected: TmEntry[] | null): Promise<void> {
    await this.write("tm", projectId, "root", entries, expected, "cat_core.tm.updated");
  }

  async readTermbase(projectId: string): Promise<CatCoreTermbaseState> {
    return this.read<CatCoreTermbaseState>("termbase", projectId) ?? { entries: [], overrides: [] };
  }

  async writeTermbase(projectId: string, value: CatCoreTermbaseState, expected: CatCoreTermbaseState | null): Promise<void> {
    await this.write("termbase", projectId, "root", value, expected, "cat_core.termbase.updated");
  }

  async readProjectManifest(projectId: string): Promise<ProjectManifest | null> {
    return this.read<ProjectManifest>("manifest", projectId);
  }

  async writeProjectManifest(projectId: string, value: ProjectManifest, expected: ProjectManifest | null): Promise<void> {
    if (value.projectId !== projectId) throw new Error("CAT-core Project manifest identity does not match its storage key.");
    await this.write("manifest", projectId, "root", value, expected, "cat_core.project_manifest.updated");
  }

  async readSourceRefs(projectId: string, ownerKind: CatCoreSourceRef["ownerKind"], ownerId: string): Promise<CatCoreSourceRef[]> {
    return this.read<CatCoreSourceRef[]>("source", projectId, sourceOwnerId(ownerKind, ownerId)) ?? [];
  }

  async writeSourceRefs(projectId: string, ownerKind: CatCoreSourceRef["ownerKind"], ownerId: string, refs: CatCoreSourceRef[]): Promise<void> {
    await this.write("source", projectId, sourceOwnerId(ownerKind, ownerId), refs, this.read<CatCoreSourceRef[]>("source", projectId, sourceOwnerId(ownerKind, ownerId)), "cat_core.source_refs.updated");
  }

  async publishSourceRef(input: {
    projectId: string;
    ownerKind: CatCoreSourceRef["ownerKind"];
    ownerId: string;
    path: string;
    bytes: Uint8Array;
    expectedSha256?: string;
  }): Promise<CatCoreSourceRef> {
    const published = await this.input.blobStore.putBytes(input.bytes, { expectedSha256: input.expectedSha256 });
    const ref: CatCoreSourceRef = {
      id: `${input.ownerKind}-${digest({ projectId: input.projectId, ownerId: input.ownerId, path: input.path, sha256: published.ref.sha256 }).slice(0, 32)}`,
      projectId: input.projectId,
      ownerKind: input.ownerKind,
      ownerId: input.ownerId,
      path: input.path,
      sha256: published.ref.sha256,
      bytes: published.ref.bytes,
      blobRefId: published.ref.sha256,
    };
    const existing = await this.readSourceRefs(input.projectId, input.ownerKind, input.ownerId);
    const next = existing.filter((candidate) => candidate.path !== ref.path);
    next.push(ref);
    await this.writeSourceRefs(input.projectId, input.ownerKind, input.ownerId, next);
    return ref;
  }

  legacyPath(projectId: string): string {
    return projectManifestPath(this.root, projectId);
  }

  close(): void {
    this.input.store.close();
  }
}
