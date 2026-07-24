import { createHash, randomUUID } from "node:crypto";
import { copyFile, lstat, mkdir, open, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, posix } from "node:path";
import {
  ContentBlobStore,
  createSqliteStorageBackup,
  restoreSqliteStorageBackup,
  SQLITE_STORAGE_SCHEMA_VERSION,
  SqliteEventProjectionStore,
  type SqliteStorageAuthority,
  type SqliteStorageBackupFileV1,
  type SqliteStorageBackupManifestV1,
} from "@linguist-agent/storage-sqlite";

const SHA256 = /^[a-f0-9]{64}$/u;

const DOMAINS = [
  ["settings-grants-trust", "data/runtime/settings-grants-trust-sqlite-v1/authority-v1.json"],
  ["package-v2", "data/runtime/package-registry-sqlite-v1/authority-v1.json"],
  ["assistant-memory", "data/runtime/assistant-memory-sqlite-v1/authority-v1.json"],
  ["assistant-library", "data/runtime/assistant-library-sqlite-v1/authority-v1.json"],
  ["cat-core", "data/runtime/cat-core-sqlite-v1/authority-v1.json"],
  ["cat-governance", "data/runtime/cat-governance-sqlite-v1/authority-v1.json"],
  ["workflow-eval", "data/runtime/workflow-eval-sqlite-v1/authority-v1.json"],
] as const;

type CrossDomainSqliteBackupDomainId = typeof DOMAINS[number][0];

export const CROSS_DOMAIN_SQLITE_BACKUP_DOMAIN_IDS: readonly CrossDomainSqliteBackupDomainId[] = DOMAINS.map(([id]) => id);
const DOMAIN_ID_SET = new Set<string>(CROSS_DOMAIN_SQLITE_BACKUP_DOMAIN_IDS);

export interface CrossDomainSqliteBackupMarkerFileV1 extends SqliteStorageBackupFileV1 {
  relativePath: string;
}

export interface CrossDomainSqliteBackupDomainV1 {
  id: CrossDomainSqliteBackupDomainId;
  marker: CrossDomainSqliteBackupMarkerFileV1;
  markerBackupRelativePath: string;
  databaseRelativePath: string;
  blobRootRelativePath?: string;
  backupRelativePath: string;
  storage: SqliteStorageBackupManifestV1;
}

export interface CrossDomainSqliteBackupManifestV1 {
  schemaVersion: 1;
  createdAt: string;
  storageSchemaVersion: typeof SQLITE_STORAGE_SCHEMA_VERSION;
  domains: CrossDomainSqliteBackupDomainV1[];
}

interface AuthorityMarkerLocation {
  databaseRelativePath: string;
  blobRootRelativePath?: string;
}

function portableRelativePath(value: string, label: string): string {
  if (!value || value.includes("\\") || value.startsWith("/") || posix.normalize(value) !== value
    || value.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`${label} must be a normalized portable relative path.`);
  }
  return value;
}

function pathWithin(root: string, value: string, label: string): string {
  const resolved = resolve(root, portableRelativePath(value, label));
  const path = relative(root, resolved).split("\\").join("/");
  if (!path || path.startsWith("../") || isAbsolute(path)) throw new Error(`${label} escapes the runtime root.`);
  return portableRelativePath(path, label);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} has unknown or missing fields.`);
  }
}

function parseBackupFile(value: unknown, label: string): SqliteStorageBackupFileV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid.`);
  const row = value as Record<string, unknown>;
  exactKeys(row, ["relativePath", "sha256", "bytes"], label);
  if (typeof row.relativePath !== "string" || typeof row.sha256 !== "string" || !SHA256.test(row.sha256)
    || !Number.isSafeInteger(row.bytes) || Number(row.bytes) < 0) throw new Error(`${label} is invalid.`);
  return {
    relativePath: portableRelativePath(row.relativePath, `${label}.relativePath`),
    sha256: row.sha256,
    bytes: Number(row.bytes),
  };
}

function parseStorageManifest(value: unknown, label: string): SqliteStorageBackupManifestV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid.`);
  const row = value as Record<string, unknown>;
  exactKeys(row, ["schemaVersion", "createdAt", "storageSchemaVersion", "database", "blobs"], label);
  if (row.schemaVersion !== 1 || typeof row.createdAt !== "string" || new Date(row.createdAt).toISOString() !== row.createdAt
    || row.storageSchemaVersion !== SQLITE_STORAGE_SCHEMA_VERSION || !Array.isArray(row.blobs)) {
    throw new Error(`${label} has an unsupported schema version.`);
  }
  const database = parseBackupFile(row.database, `${label}.database`);
  if (database.relativePath !== "database.sqlite") throw new Error(`${label}.database path is invalid.`);
  const blobs = row.blobs.map((blob, index) => parseBackupFile(blob, `${label}.blobs[${index}]`));
  if (new Set(blobs.map((blob) => blob.relativePath)).size !== blobs.length) throw new Error(`${label} has duplicate blob paths.`);
  return {
    schemaVersion: 1,
    createdAt: row.createdAt,
    storageSchemaVersion: SQLITE_STORAGE_SCHEMA_VERSION,
    database,
    blobs,
  };
}

function parseMarker(raw: Uint8Array, root: string, label: string): AuthorityMarkerLocation {
  let value: unknown;
  try { value = JSON.parse(Buffer.from(raw).toString("utf8")); } catch { throw new Error(`${label} is not valid JSON.`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid.`);
  const marker = value as Record<string, unknown>;
  if (marker.schemaVersion !== 1 || marker.authority !== "sqlite" || typeof marker.databaseRelativePath !== "string") {
    throw new Error(`${label} does not name a SQLite authority.`);
  }
  const databaseRelativePath = pathWithin(root, marker.databaseRelativePath, `${label}.databaseRelativePath`);
  const blobRootRelativePath = marker.blobRootRelativePath === undefined
    ? undefined
    : typeof marker.blobRootRelativePath === "string"
      ? pathWithin(root, marker.blobRootRelativePath, `${label}.blobRootRelativePath`)
      : (() => { throw new Error(`${label}.blobRootRelativePath is invalid.`); })();
  return { databaseRelativePath, blobRootRelativePath };
}

function parseManifest(value: unknown): CrossDomainSqliteBackupManifestV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Cross-domain SQLite backup manifest is invalid.");
  const row = value as Record<string, unknown>;
  exactKeys(row, ["schemaVersion", "createdAt", "storageSchemaVersion", "domains"], "Cross-domain SQLite backup manifest");
  if (row.schemaVersion !== 1 || typeof row.createdAt !== "string" || new Date(row.createdAt).toISOString() !== row.createdAt
    || row.storageSchemaVersion !== SQLITE_STORAGE_SCHEMA_VERSION || !Array.isArray(row.domains)) {
    throw new Error("Cross-domain SQLite backup manifest has an unsupported schema version.");
  }
  const domains = row.domains.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Cross-domain SQLite backup domain ${index} is invalid.`);
    const domain = value as Record<string, unknown>;
    exactKeys(domain, ["id", "marker", "markerBackupRelativePath", "databaseRelativePath", "blobRootRelativePath", "backupRelativePath", "storage"].filter((key) => domain[key] !== undefined), `Cross-domain SQLite backup domain ${index}`);
    if (typeof domain.id !== "string" || !DOMAIN_ID_SET.has(domain.id)) throw new Error(`Cross-domain SQLite backup domain ${index} has an unknown id.`);
    if (typeof domain.databaseRelativePath !== "string" || typeof domain.backupRelativePath !== "string" || typeof domain.markerBackupRelativePath !== "string") throw new Error(`Cross-domain SQLite backup domain ${index} paths are invalid.`);
    const databaseRelativePath = portableRelativePath(domain.databaseRelativePath, `Cross-domain SQLite backup domain ${index}.databaseRelativePath`);
    const backupRelativePath = portableRelativePath(domain.backupRelativePath, `Cross-domain SQLite backup domain ${index}.backupRelativePath`);
    const markerBackupRelativePath = portableRelativePath(domain.markerBackupRelativePath, `Cross-domain SQLite backup domain ${index}.markerBackupRelativePath`);
    const blobRootRelativePath = domain.blobRootRelativePath === undefined ? undefined
      : typeof domain.blobRootRelativePath === "string"
        ? portableRelativePath(domain.blobRootRelativePath, `Cross-domain SQLite backup domain ${index}.blobRootRelativePath`)
        : (() => { throw new Error(`Cross-domain SQLite backup domain ${index}.blobRootRelativePath is invalid.`); })();
    const marker = parseBackupFile(domain.marker, `Cross-domain SQLite backup domain ${index}.marker`);
    const storage = parseStorageManifest(domain.storage, `Cross-domain SQLite backup domain ${index}.storage`);
    return { id: domain.id as CrossDomainSqliteBackupDomainId, marker, markerBackupRelativePath, databaseRelativePath, blobRootRelativePath, backupRelativePath, storage };
  });
  if (JSON.stringify(domains.map((domain) => domain.id)) !== JSON.stringify(CROSS_DOMAIN_SQLITE_BACKUP_DOMAIN_IDS)) {
    throw new Error("Cross-domain SQLite backup manifest must contain every LA-025 domain exactly once.");
  }
  const paths = [
    ...domains.map((domain) => domain.marker.relativePath),
    ...domains.map((domain) => domain.markerBackupRelativePath),
    ...domains.map((domain) => domain.databaseRelativePath),
    ...domains.map((domain) => domain.backupRelativePath),
    ...domains.flatMap((domain) => domain.blobRootRelativePath ? [domain.blobRootRelativePath] : []),
  ];
  if (new Set(paths).size !== paths.length) throw new Error("Cross-domain SQLite backup manifest has overlapping domain paths.");
  return { schemaVersion: 1, createdAt: row.createdAt, storageSchemaVersion: SQLITE_STORAGE_SCHEMA_VERSION, domains };
}

async function syncPath(path: string): Promise<void> {
  const handle = await open(path, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

async function assertAbsent(path: string, label: string): Promise<void> {
  try { await lstat(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error(`${label} already exists.`);
}

async function regularFile(path: string, label: string): Promise<Buffer> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`${label} must be a regular file.`);
  return readFile(path);
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function digestFile(path: string, relativePath: string, label: string): Promise<SqliteStorageBackupFileV1> {
  const bytes = await regularFile(path, label);
  return { relativePath: portableRelativePath(relativePath, `${label}.relativePath`), sha256: digest(bytes), bytes: bytes.byteLength };
}

async function copyVerified(source: string, target: string, expected: SqliteStorageBackupFileV1, label: string): Promise<void> {
  const actual = await digestFile(source, expected.relativePath, label);
  if (actual.sha256 !== expected.sha256 || actual.bytes !== expected.bytes) throw new Error(`${label} digest mismatch.`);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await copyFile(source, target);
  await syncPath(target);
  const copied = await digestFile(target, expected.relativePath, label);
  if (copied.sha256 !== expected.sha256 || copied.bytes !== expected.bytes) throw new Error(`${label} copy verification failed.`);
}

function collectBlobRefs(value: unknown, refs: Set<string>): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectBlobRefs(item, refs));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if ((key === "blobRefId" || key === "contentBlobRefId" || key.endsWith("BlobRefId")) && typeof child === "string") {
      if (!SHA256.test(child)) throw new Error(`SQLite blob reference ${key} is invalid.`);
      refs.add(child);
    }
    collectBlobRefs(child, refs);
  }
}

async function collectBlobFiles(root: string, directory = root): Promise<Array<{ sourcePath: string; relativePath: string }>> {
  try {
    const metadata = await lstat(directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error(`Blob root is not a directory: ${directory}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const files: Array<{ sourcePath: string; relativePath: string }> = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const sourcePath = join(directory, entry.name);
    const relativePath = relative(root, sourcePath).split("\\").join("/");
    if (entry.isSymbolicLink()) throw new Error(`Blob root contains a symbolic link: ${relativePath}`);
    if (entry.isDirectory()) files.push(...await collectBlobFiles(root, sourcePath));
    else if (entry.isFile()) files.push({ sourcePath, relativePath: portableRelativePath(relativePath, "blob relative path") });
    else throw new Error(`Blob root contains an unsupported entry: ${relativePath}`);
  }
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function contentAddressedBlobFiles(blobRoot: string): Promise<Array<{ sourcePath: string; relativePath: string }>> {
  try {
    const metadata = await lstat(blobRoot);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error(`Blob root is not a directory: ${blobRoot}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const files: Array<{ sourcePath: string; relativePath: string }> = [];
  for (const entry of await readdir(blobRoot, { withFileTypes: true })) {
    const path = join(blobRoot, entry.name);
    if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error(`Blob root has an invalid top-level entry: ${entry.name}`);
    if (entry.name === "blobs" || entry.name === "refs") {
      files.push(...await collectBlobFiles(blobRoot, path));
      continue;
    }
    if (entry.name === ".staging" || entry.name === ".locks") {
      if ((await readdir(path)).length > 0) throw new Error(`Blob root has unfinished ${entry.name} content.`);
      continue;
    }
    throw new Error(`Blob root has an unsupported top-level entry: ${entry.name}`);
  }
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function verifyBlobDomain(blobRoot: string | undefined, store: SqliteEventProjectionStore, domainId: string): Promise<Array<{ sourcePath: string; relativePath: string }>> {
  if (!blobRoot) return [];
  const blobStore = new ContentBlobStore(blobRoot, { authority: { assertOwned: async () => undefined } });
  const inspection = await blobStore.inspect();
  if (inspection.invalidBlobs.length > 0 || inspection.invalidReferences.length > 0 || inspection.orphanStaging.length > 0) {
    throw new Error(`${domainId} blob store has invalid or unfinished content.`);
  }
  const referenced = new Set(inspection.references.flatMap((reference) => reference.blobs.map((blob) => blob.sha256)));
  for (const projection of store.listProjections()) collectBlobRefs(projection.value, referenced);
  const existing = new Set(inspection.blobs.map((blob) => blob.sha256));
  const missing = [...referenced].filter((sha256) => !existing.has(sha256));
  if (missing.length > 0) throw new Error(`${domainId} blob reference is missing: ${missing[0]}.`);
  const orphan = inspection.blobs.find((blob) => !referenced.has(blob.sha256));
  if (orphan) throw new Error(`${domainId} blob is orphaned: ${orphan.sha256}.`);
  return contentAddressedBlobFiles(blobRoot);
}

function assertStoreHealthy(store: SqliteEventProjectionStore, domainId: string): void {
  if (store.schemaVersion() !== SQLITE_STORAGE_SCHEMA_VERSION) throw new Error(`${domainId} SQLite schema upgrade or downgrade is not supported.`);
  if (store.quickCheck() !== "ok") throw new Error(`${domainId} SQLite quick_check failed.`);
  const foreignKeyViolations = store.foreignKeyViolations();
  if (foreignKeyViolations.length > 0) throw new Error(`${domainId} SQLite foreign-key check failed.`);
}

async function openVerifiedStore(databasePath: string, domainId: string): Promise<SqliteEventProjectionStore> {
  try {
    const store = new SqliteEventProjectionStore(databasePath, { readOnly: true });
    assertStoreHealthy(store, domainId);
    return store;
  } catch (error) {
    throw new Error(`${domainId} SQLite schema cannot be snapshotted: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function markerBackupPath(domainId: string): string {
  return `markers/${domainId}/authority-v1.json`;
}

function domainBackupPath(domainId: string): string {
  return `domains/${domainId}`;
}

/**
 * Captures all LA-025 SQLite authorities beneath one manifest.  The writer
 * lease is checked before work and before publication; this module has no
 * route or server registration, so it never becomes a business writer.
 */
export async function createCrossDomainSqliteBackup(input: {
  root: string;
  authority: SqliteStorageAuthority;
  backupDirectory: string;
  now?: () => Date;
}): Promise<CrossDomainSqliteBackupManifestV1> {
  const root = resolve(input.root);
  if (!isAbsolute(input.backupDirectory)) throw new Error("backupDirectory must be absolute.");
  const backupDirectory = resolve(input.backupDirectory);
  const now = input.now?.() ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("backup timestamp is invalid.");
  await input.authority.assertOwned();
  await assertAbsent(backupDirectory, "backupDirectory");
  const parent = dirname(backupDirectory);
  const staging = join(parent, `.${basename(backupDirectory)}.staging-${randomUUID()}`);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await mkdir(staging, { mode: 0o700 });
  try {
    const domains: CrossDomainSqliteBackupDomainV1[] = [];
    for (const [id, markerRelativePath] of DOMAINS) {
      const markerPath = join(root, markerRelativePath);
      const markerBytes = await regularFile(markerPath, `${id} authority marker`);
      const marker = parseMarker(markerBytes, root, `${id} authority marker`);
      const databasePath = join(root, marker.databaseRelativePath);
      await regularFile(databasePath, `${id} SQLite database`);
      const store = await openVerifiedStore(databasePath, id);
      try {
        const blobFiles = await verifyBlobDomain(
          marker.blobRootRelativePath ? join(root, marker.blobRootRelativePath) : undefined,
          store,
          id,
        );
        const backupRelativePath = domainBackupPath(id);
        const storage = await createSqliteStorageBackup({
          store,
          authority: input.authority,
          backupDirectory: join(staging, backupRelativePath),
          blobs: blobFiles,
          now: () => now,
        });
        const markerRelativeBackupPath = markerBackupPath(id);
        const markerFile = await digestFile(markerPath, markerRelativePath, `${id} authority marker`);
        await copyVerified(markerPath, join(staging, markerRelativeBackupPath), markerFile, `${id} authority marker`);
        domains.push({
          id,
          marker: markerFile,
          markerBackupRelativePath: markerRelativeBackupPath,
          databaseRelativePath: marker.databaseRelativePath,
          backupRelativePath,
          storage,
          ...(marker.blobRootRelativePath ? { blobRootRelativePath: marker.blobRootRelativePath } : {}),
        });
      } finally {
        store.close();
      }
    }
    const manifest: CrossDomainSqliteBackupManifestV1 = {
      schemaVersion: 1,
      createdAt: now.toISOString(),
      storageSchemaVersion: SQLITE_STORAGE_SCHEMA_VERSION,
      domains,
    };
    const manifestPath = join(staging, "manifest-v1.json");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await syncPath(manifestPath);
    await syncPath(staging);
    await input.authority.assertOwned();
    await assertAbsent(backupDirectory, "backupDirectory");
    await rename(staging, backupDirectory);
    await syncPath(parent);
    return manifest;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

/** Restores a manifest only into a fresh synthetic root; it never overwrites authority data. */
export async function restoreCrossDomainSqliteBackup(input: {
  authority: SqliteStorageAuthority;
  backupDirectory: string;
  targetRoot: string;
}): Promise<CrossDomainSqliteBackupManifestV1> {
  if (!isAbsolute(input.backupDirectory) || !isAbsolute(input.targetRoot)) throw new Error("backupDirectory and targetRoot must be absolute.");
  const backupDirectory = resolve(input.backupDirectory);
  const targetRoot = resolve(input.targetRoot);
  await input.authority.assertOwned();
  const manifest = parseManifest(JSON.parse((await regularFile(join(backupDirectory, "manifest-v1.json"), "Cross-domain SQLite backup manifest")).toString("utf8")) as unknown);
  await assertAbsent(targetRoot, "targetRoot");
  const parent = dirname(targetRoot);
  const staging = join(parent, `.${basename(targetRoot)}.restore-${randomUUID()}`);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await mkdir(staging, { mode: 0o700 });
  try {
    for (const domain of manifest.domains) {
      const markerPath = join(backupDirectory, domain.markerBackupRelativePath);
      const markerBytes = await regularFile(markerPath, `${domain.id} backup authority marker`);
      const copiedMarker = await digestFile(markerPath, domain.marker.relativePath, `${domain.id} backup authority marker`);
      if (copiedMarker.sha256 !== domain.marker.sha256 || copiedMarker.bytes !== domain.marker.bytes) {
        throw new Error(`${domain.id} backup authority marker digest mismatch.`);
      }
      const marker = parseMarker(markerBytes, staging, `${domain.id} backup authority marker`);
      if (marker.databaseRelativePath !== domain.databaseRelativePath || marker.blobRootRelativePath !== domain.blobRootRelativePath) {
        throw new Error(`${domain.id} backup authority marker does not match its manifest.`);
      }
      const backupPath = join(backupDirectory, domain.backupRelativePath);
      const restored = await restoreSqliteStorageBackup({
        authority: input.authority,
        backupDirectory: backupPath,
        targetDatabasePath: join(staging, domain.databaseRelativePath),
        targetBlobRoot: domain.blobRootRelativePath ? join(staging, domain.blobRootRelativePath) : undefined,
      });
      if (JSON.stringify(restored) !== JSON.stringify(domain.storage)) throw new Error(`${domain.id} nested backup manifest does not match the aggregate manifest.`);
      await copyVerified(markerPath, join(staging, domain.marker.relativePath), domain.marker, `${domain.id} backup authority marker`);
      const store = await openVerifiedStore(join(staging, domain.databaseRelativePath), domain.id);
      try {
        await verifyBlobDomain(domain.blobRootRelativePath ? join(staging, domain.blobRootRelativePath) : undefined, store, domain.id);
      } finally {
        store.close();
      }
    }
    await syncPath(staging);
    await input.authority.assertOwned();
    await assertAbsent(targetRoot, "targetRoot");
    await rename(staging, targetRoot);
    await syncPath(parent);
    return manifest;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}
