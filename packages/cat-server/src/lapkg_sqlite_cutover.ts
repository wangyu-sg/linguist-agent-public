import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { writeDurableFileAtomic } from "@linguist-agent/cat-data";
import {
  ContentBlobStore,
  SqliteEventProjectionStore,
  type ContentBlobRefV1,
  type SqliteJsonObject,
} from "@linguist-agent/storage-sqlite";
import {
  hashLapkgRegistry,
  lapkgV2Root,
  listActivatedLapkgPackages,
  parseLapkgRegistry,
  type ActivatedLapkgRecordV2,
  type LapkgRegistryV2,
} from "./lapkg_activation.js";
import { parseLapkgActivationJournal, type LapkgActivationJournalV1, type LapkgRecoveryBlockedV1 } from "./lapkg_activation_journal.js";
import {
  lapkgContentRefId,
  lapkgSqliteMarkerPath,
  lapkgSqliteStorageRoot,
  type LapkgPackageContentResource,
  type LapkgPackageContentInspection,
  type LapkgPackageStorage,
  type LapkgPackageStorageAuthority,
} from "./lapkg_package_storage.js";

const REGISTRY_STREAM = "lapkg.registry.v2";
const JOURNAL_STREAM = "lapkg.activation-journal.v1";
const RECOVERY_STREAM = "lapkg.recovery-block.v1";
const SQLITE_DATABASE_NAME = "package-registry.sqlite";
const BLOB_ROOT_RELATIVE = "data/assistant/capabilities/packages-v2/blob-store";
const BACKUP_ROOT_NAME = "legacy-v2-backup";

export interface LapkgSqliteAuthorityMarkerV1 {
  schemaVersion: 1;
  authority: "sqlite";
  databaseRelativePath: string;
  blobRootRelativePath: string;
  backupRootRelativePath: string;
  cutoverAt: string;
  sourceRegistrySha256: string;
  packageCount: number;
}

export interface PreparedLapkgSqliteCutover {
  status: "cutover" | "already-sqlite";
  marker: LapkgSqliteAuthorityMarkerV1;
  storage: LapkgPackageStorage;
  close(): void;
}

function jsonObject(value: unknown, label: string): SqliteJsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be a JSON object.`);
  return value as SqliteJsonObject;
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function exactKeys(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} has unknown or missing fields.`);
}

function withinRoot(root: string, candidate: string, label: string): string {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const rel = relative(resolvedRoot, resolvedCandidate);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`${label} must remain inside the repository root.`);
  return rel.split("\\").join("/");
}

function parseMarker(value: unknown, repoRoot: string): LapkgSqliteAuthorityMarkerV1 {
  exactKeys(value, [
    "schemaVersion",
    "authority",
    "databaseRelativePath",
    "blobRootRelativePath",
    "backupRootRelativePath",
    "cutoverAt",
    "sourceRegistrySha256",
    "packageCount",
  ], "Package SQLite authority marker");
  if (value.schemaVersion !== 1 || value.authority !== "sqlite" || typeof value.databaseRelativePath !== "string"
    || typeof value.blobRootRelativePath !== "string" || typeof value.backupRootRelativePath !== "string"
    || typeof value.cutoverAt !== "string" || typeof value.sourceRegistrySha256 !== "string"
    || !Number.isSafeInteger(value.packageCount) || Number(value.packageCount) < 0
    || !/^[a-f0-9]{64}$/u.test(value.sourceRegistrySha256)) {
    throw new Error("Package SQLite authority marker values are invalid.");
  }
  const timestamp = new Date(value.cutoverAt);
  if (!Number.isFinite(timestamp.getTime()) || timestamp.toISOString() !== value.cutoverAt) {
    throw new Error("Package SQLite authority marker timestamp is invalid.");
  }
  const databaseRelativePath = withinRoot(repoRoot, join(repoRoot, value.databaseRelativePath), "Package SQLite database path");
  const blobRootRelativePath = withinRoot(repoRoot, join(repoRoot, value.blobRootRelativePath), "Package blob root path");
  const backupRootRelativePath = withinRoot(repoRoot, join(repoRoot, value.backupRootRelativePath), "Package backup root path");
  return {
    schemaVersion: 1,
    authority: "sqlite",
    databaseRelativePath,
    blobRootRelativePath,
    backupRootRelativePath,
    cutoverAt: value.cutoverAt,
    sourceRegistrySha256: value.sourceRegistrySha256,
    packageCount: Number(value.packageCount),
  };
}

async function readMarker(repoRoot: string): Promise<LapkgSqliteAuthorityMarkerV1 | null> {
  try {
    return parseMarker(JSON.parse(await readFile(lapkgSqliteMarkerPath(repoRoot), "utf8")) as unknown, repoRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

class SqliteLapkgPackageStorage implements LapkgPackageStorage {
  readonly #store: SqliteEventProjectionStore;
  readonly #blobStore: ContentBlobStore;
  readonly #authority: LapkgPackageStorageAuthority;

  constructor(input: {
    databasePath: string;
    blobRoot: string;
    authority: LapkgPackageStorageAuthority;
  }) {
    this.#store = new SqliteEventProjectionStore(input.databasePath);
    this.#blobStore = new ContentBlobStore(input.blobRoot, { authority: input.authority });
    this.#authority = input.authority;
  }

  #ensureProjection(streamId: string, projection: SqliteJsonObject): { revision: number; value: SqliteJsonObject } {
    const current = this.#store.readProjection(streamId);
    if (current) return current;
    this.#store.initializeProjection({
      commandId: `lapkg.init.${streamId}`,
      streamId,
      projection,
    });
    return this.#store.readProjection(streamId)!;
  }

  async readRegistry(): Promise<{ registry: LapkgRegistryV2; storageRevision: number }> {
    const current = this.#ensureProjection(REGISTRY_STREAM, jsonObject({ schemaVersion: 2, revision: 0, packages: [] }, "registry"));
    return { registry: parseLapkgRegistry(current.value), storageRevision: current.revision };
  }

  async initializeRegistry(registry: LapkgRegistryV2): Promise<void> {
    parseLapkgRegistry(registry);
    if (this.#store.readProjection(REGISTRY_STREAM)) throw new Error("Package SQLite registry is already initialized.");
    this.#store.initializeProjection({
      commandId: "lapkg.init.lapkg.registry.v2",
      streamId: REGISTRY_STREAM,
      projection: jsonObject(registry, "registry"),
    });
  }

  async writeRegistry(input: { registry: LapkgRegistryV2; expectedStorageRevision: number }): Promise<void> {
    parseLapkgRegistry(input.registry);
    const current = this.#ensureProjection(REGISTRY_STREAM, jsonObject({ schemaVersion: 2, revision: 0, packages: [] }, "registry"));
    if (current.revision !== input.expectedStorageRevision) {
      throw new Error(`Package SQLite registry revision ${current.revision} does not match expected ${input.expectedStorageRevision}.`);
    }
    await this.#authority.assertOwned();
    this.#store.append({
      commandId: `lapkg.registry.${input.registry.revision}.${randomUUID()}`,
      streamId: REGISTRY_STREAM,
      expectedRevision: input.expectedStorageRevision,
      events: [{
        id: randomUUID(),
        type: "registry_updated",
        occurredAt: new Date().toISOString(),
        payload: jsonObject({ registrySha256: hashLapkgRegistry(input.registry) }, "registry event"),
      }],
      projection: jsonObject(input.registry, "registry"),
    });
  }

  async readJournal(): Promise<LapkgActivationJournalV1 | null> {
    const current = this.#store.readProjection(JOURNAL_STREAM);
    if (!current) return null;
    const value = current.value;
    if (value.present === false) return null;
    if (value.present !== true || !value.journal) throw new Error("Package SQLite activation journal projection is invalid.");
    return parseLapkgActivationJournal(value.journal);
  }

  async writeJournal(journal: LapkgActivationJournalV1): Promise<void> {
    parseLapkgActivationJournal(journal);
    const current = this.#ensureProjection(JOURNAL_STREAM, jsonObject({ schemaVersion: 1, present: false }, "journal"));
    await this.#authority.assertOwned();
    this.#store.append({
      commandId: `lapkg.journal.${journal.activationId}.${journal.updatedAt}.${randomUUID()}`,
      streamId: JOURNAL_STREAM,
      expectedRevision: current.revision,
      events: [{ id: randomUUID(), type: "journal_updated", occurredAt: journal.updatedAt, payload: jsonObject({ activationId: journal.activationId, phase: journal.phase }, "journal event") }],
      projection: jsonObject({ schemaVersion: 1, present: true, journal }, "journal"),
    });
  }

  async removeJournal(): Promise<void> {
    const current = this.#store.readProjection(JOURNAL_STREAM);
    if (!current || current.value.present === false) return;
    await this.#authority.assertOwned();
    this.#store.append({
      commandId: `lapkg.journal.remove.${randomUUID()}`,
      streamId: JOURNAL_STREAM,
      expectedRevision: current.revision,
      events: [{ id: randomUUID(), type: "journal_removed", occurredAt: new Date().toISOString(), payload: {} }],
      projection: jsonObject({ schemaVersion: 1, present: false }, "journal"),
    });
  }

  async readRecoveryBlock(): Promise<LapkgRecoveryBlockedV1 | null> {
    const current = this.#store.readProjection(RECOVERY_STREAM);
    if (!current || current.value.present === false) return null;
    const value = current.value;
    if (value.present !== true || !value.block) throw new Error("Package SQLite recovery block projection is invalid.");
    const block = value.block;
    if (!block || typeof block !== "object" || Array.isArray(block) || (block as Record<string, unknown>).schemaVersion !== 1
      || ((block as Record<string, unknown>).activationId !== null && typeof (block as Record<string, unknown>).activationId !== "string")
      || typeof (block as Record<string, unknown>).reason !== "string" || typeof (block as Record<string, unknown>).blockedAt !== "string") {
      throw new Error("Package SQLite recovery block is invalid.");
    }
    return block as unknown as LapkgRecoveryBlockedV1;
  }

  async writeRecoveryBlock(value: LapkgRecoveryBlockedV1): Promise<void> {
    const current = this.#ensureProjection(RECOVERY_STREAM, jsonObject({ schemaVersion: 1, present: false }, "recovery block"));
    await this.#authority.assertOwned();
    this.#store.append({
      commandId: `lapkg.recovery.${value.activationId ?? "none"}.${value.blockedAt}.${randomUUID()}`,
      streamId: RECOVERY_STREAM,
      expectedRevision: current.revision,
      events: [{ id: randomUUID(), type: "recovery_blocked", occurredAt: value.blockedAt, payload: jsonObject({ reason: value.reason }, "recovery event") }],
      projection: jsonObject({ schemaVersion: 1, present: true, block: value }, "recovery block"),
    });
  }

  async removeRecoveryBlock(): Promise<void> {
    const current = this.#store.readProjection(RECOVERY_STREAM);
    if (!current || current.value.present === false) return;
    await this.#authority.assertOwned();
    this.#store.append({
      commandId: `lapkg.recovery.remove.${randomUUID()}`,
      streamId: RECOVERY_STREAM,
      expectedRevision: current.revision,
      events: [{ id: randomUUID(), type: "recovery_unblocked", occurredAt: new Date().toISOString(), payload: {} }],
      projection: jsonObject({ schemaVersion: 1, present: false }, "recovery block"),
    });
  }

  async publishContent(input: {
    packageId: string;
    packageVersion: string;
    treeHash: string;
    archiveBytes?: Uint8Array;
    resources: readonly LapkgPackageContentResource[];
  }): Promise<{ refId: string }> {
    const refId = lapkgContentRefId(input.packageId, input.packageVersion, input.treeHash);
    const refs: ContentBlobRefV1[] = [];
    if (input.archiveBytes) refs.push((await this.#blobStore.putBytes(input.archiveBytes)).ref);
    for (const resource of input.resources) refs.push((await this.#blobStore.putBytes(resource.bytes, { expectedSha256: resource.sha256 })).ref);
    const existing = await this.#blobStore.readReference(refId);
    if (existing) {
      if (JSON.stringify(existing.blobs) !== JSON.stringify([...refs].sort((left, right) => left.sha256.localeCompare(right.sha256)))) {
        throw new Error(`Package content reference ${refId} already exists with different bytes.`);
      }
      for (const ref of existing.blobs) await this.#blobStore.readBytes(ref);
      return { refId };
    }
    const sorted = [...refs].sort((left, right) => left.sha256.localeCompare(right.sha256));
    await this.#blobStore.publishReference({ refId, expectedRevision: 0, blobs: sorted });
    return { refId };
  }

  async verifyContent(record: ActivatedLapkgRecordV2): Promise<void> {
    if (!record.contentBlobRefId) throw new Error(`Package ${record.packageId}@${record.packageVersion} has no content blob reference.`);
    const reference = await this.#blobStore.readReference(record.contentBlobRefId);
    if (!reference) throw new Error(`Package content reference ${record.contentBlobRefId} is missing.`);
    const byDigest = new Map(reference.blobs.map((ref) => [ref.sha256, ref]));
    for (const resource of record.resources) {
      const ref = byDigest.get(resource.sha256);
      if (!ref || ref.bytes !== resource.size) throw new Error(`Package resource ${resource.id} is missing from its content reference.`);
      await this.#blobStore.readBytes(ref);
    }
  }

  async inspectContent(): Promise<LapkgPackageContentInspection> {
    return this.#blobStore.inspect();
  }

  close(): void {
    this.#store.close();
  }
}

export async function createLapkgSqlitePackageStorage(input: {
  root: string;
  authority: LapkgPackageStorageAuthority;
}): Promise<LapkgPackageStorage> {
  await input.authority.assertOwned();
  const repoRoot = resolve(input.root);
  const storageRoot = lapkgSqliteStorageRoot(repoRoot);
  return new SqliteLapkgPackageStorage({
    databasePath: join(storageRoot, SQLITE_DATABASE_NAME),
    blobRoot: join(repoRoot, BLOB_ROOT_RELATIVE),
    authority: input.authority,
  });
}

async function readOptional(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function readLegacyResourceBytes(repoRoot: string, record: ActivatedLapkgRecordV2): Promise<LapkgPackageContentResource[]> {
  const root = lapkgV2Root(repoRoot);
  const contentRoot = resolve(root, record.contentDirectory);
  const rel = relative(resolve(root), contentRoot);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("Legacy Package content path escapes the v2 root.");
  const resources: LapkgPackageContentResource[] = [];
  for (const resource of record.resources) {
    const path = resolve(contentRoot, resource.path);
    const resourceRel = relative(contentRoot, path);
    if (!resourceRel || resourceRel.startsWith("..") || isAbsolute(resourceRel)) throw new Error("Legacy Package resource escapes its content root.");
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== resource.size) throw new Error(`Legacy Package resource ${resource.id} is invalid.`);
    const bytes = await readFile(path);
    if (sha256(bytes) !== resource.sha256) throw new Error(`Legacy Package resource ${resource.id} digest does not match the registry.`);
    resources.push({ sha256: resource.sha256, bytes });
  }
  return resources;
}

export async function prepareLapkgSqliteCutover(input: {
  repoRoot: string;
  authority: LapkgPackageStorageAuthority;
  activeRunCount: number;
  now?: () => Date;
}): Promise<PreparedLapkgSqliteCutover> {
  const repoRoot = resolve(input.repoRoot);
  if (!Number.isSafeInteger(input.activeRunCount) || input.activeRunCount < 0) throw new Error("activeRunCount is invalid.");
  const existingMarker = await readMarker(repoRoot);
  if (existingMarker) {
    const storage = await createLapkgSqlitePackageStorage({ root: repoRoot, authority: input.authority });
    const current = await storage.readRegistry();
    if (current.registry.packages.length !== existingMarker.packageCount) {
      storage.close();
      throw new Error("Package SQLite registry does not match its authority marker.");
    }
    return { status: "already-sqlite", marker: existingMarker, storage, close: () => storage.close() };
  }
  if (input.activeRunCount !== 0) throw new Error("Package SQLite cutover requires zero active Agent Runs.");

  const legacyRegistryPath = join(lapkgV2Root(repoRoot), "registry-v2.json");
  const legacyRaw = await readOptional(legacyRegistryPath);
  const legacyRegistry = await listActivatedLapkgPackages(repoRoot);
  const sourceRegistrySha256 = sha256(legacyRaw ?? JSON.stringify(legacyRegistry));
  const storageRoot = lapkgSqliteStorageRoot(repoRoot);
  const backupRoot = join(storageRoot, BACKUP_ROOT_NAME);
  const storage = await createLapkgSqlitePackageStorage({ root: repoRoot, authority: input.authority });
  try {
    const importedPackages: ActivatedLapkgRecordV2[] = [];
    for (const record of legacyRegistry.packages) {
      const resources = await readLegacyResourceBytes(repoRoot, record);
      const published = await storage.publishContent({
        packageId: record.packageId,
        packageVersion: record.packageVersion,
        treeHash: record.treeHash,
        resources,
      });
      importedPackages.push({ ...record, contentBlobRefId: published.refId });
    }
    const imported: LapkgRegistryV2 = {
      schemaVersion: 2,
      revision: legacyRegistry.revision,
      packages: importedPackages,
    };
    await storage.initializeRegistry(imported);
    if (legacyRaw) await writeDurableFileAtomic(join(backupRoot, "registry-v2.json"), legacyRaw);
    const now = (input.now?.() ?? new Date()).toISOString();
    const marker: LapkgSqliteAuthorityMarkerV1 = {
      schemaVersion: 1,
      authority: "sqlite",
      databaseRelativePath: relative(repoRoot, join(storageRoot, SQLITE_DATABASE_NAME)).split("\\").join("/"),
      blobRootRelativePath: BLOB_ROOT_RELATIVE,
      backupRootRelativePath: relative(repoRoot, backupRoot).split("\\").join("/"),
      cutoverAt: now,
      sourceRegistrySha256,
      packageCount: imported.packages.length,
    };
    await writeDurableFileAtomic(lapkgSqliteMarkerPath(repoRoot), `${JSON.stringify(marker, null, 2)}\n`);
    return { status: "cutover", marker, storage, close: () => storage.close() };
  } catch (error) {
    storage.close();
    await import("node:fs/promises").then(({ rm }) => rm(storageRoot, { recursive: true, force: true })).catch(() => undefined);
    throw error;
  }
}
