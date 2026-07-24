import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, posix } from "node:path";
import {
  SqliteEventProjectionStore,
  SqliteRevisionConflictError,
  type SqliteJsonObject,
  type SqliteStorageAuthority,
} from "./index.js";
import type { StructuredStorageBackend } from "@linguist-agent/cat-data";

export type StructuredDomainV1 = "settings" | "grants" | "trust";

export interface StructuredDomainAddressV1 {
  domain: StructuredDomainV1;
  key: string;
  scope: string;
}

export interface StructuredDomainStoredValueV1 extends StructuredDomainAddressV1 {
  revision: number;
  payload: SqliteJsonObject;
  payloadSha256: string;
}

export interface StructuredDomainSourceV1 extends StructuredDomainAddressV1 {
  sourceId: string;
  raw: Uint8Array;
  value: unknown;
}

interface StructuredDomainEnvelopeV1 extends StructuredDomainAddressV1 {
  schemaVersion: 1;
  payload: SqliteJsonObject;
  payloadSha256: string;
}

export interface ImportedStructuredDomainV1 extends StructuredDomainSourceV1 {
  sourceSha256: string;
  sourceBytes: number;
  envelope: StructuredDomainEnvelopeV1;
}

export interface StructuredDomainCutoverSourceReportV1 {
  sourceId: string;
  domain: StructuredDomainV1;
  key: string;
  scope: string;
  sourceSha256: string;
  sourceBytes: number;
  payloadSha256?: string;
  status: "valid" | "invalid";
  reason?: string;
}

export interface StructuredDomainImportReportV1 {
  schemaVersion: 1;
  valid: StructuredDomainCutoverSourceReportV1[];
  invalid: Array<StructuredDomainCutoverSourceReportV1 & { rawSha256: string }>;
  backupRootRelativePath?: string;
}

export interface StructuredDomainSqliteAuthorityMarkerV1 {
  schemaVersion: 1;
  authority: "sqlite";
  databaseRelativePath: string;
  backupRootRelativePath: string;
  cutoverAt: string;
  sources: StructuredDomainCutoverSourceReportV1[];
  excludes: ["provider-secrets", "pi-native-settings"];
}

export interface SqliteSettingsGrantsTrustRepository extends StructuredStorageBackend {
  readonly readiness: {
    schemaVersion: 1;
    authority: "sqlite";
    domains: readonly StructuredDomainV1[];
    excludes: readonly ["provider-secrets", "pi-native-settings"];
  };
  read(address: StructuredDomainAddressV1): StructuredDomainStoredValueV1 | null;
  list(domain?: StructuredDomainV1): StructuredDomainStoredValueV1[];
  initialize(input: {
    address: StructuredDomainAddressV1;
    value: SqliteJsonObject;
  }): Promise<StructuredDomainStoredValueV1>;
  write(input: {
    address: StructuredDomainAddressV1;
    expectedRevision: number;
    expectedValue: SqliteJsonObject;
    value: SqliteJsonObject;
  }): Promise<StructuredDomainStoredValueV1>;
  digestRecord(input: StructuredDomainSourceV1): ImportedStructuredDomainV1;
}

export type PreparedSqliteSettingsGrantsTrustCutover = {
  status: "cutover" | "already-sqlite";
  marker: StructuredDomainSqliteAuthorityMarkerV1;
  repository: SqliteSettingsGrantsTrustRepository;
  close(): void;
};

export class StructuredDomainImportBlockedError extends Error {
  readonly name = "StructuredDomainImportBlockedError";

  constructor(readonly report: StructuredDomainImportReportV1) {
    super("SQLite settings/grants/trust import is blocked by invalid legacy input.");
  }
}

const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;
const SECRET_KEY = /(?:secret|token|password|passwd|api[-_]?key|bearer|credential|private[-_]?key)/iu;
const DOMAINS = ["settings", "grants", "trust"] as const;

function safeId(value: string, label: string): string {
  if (!SAFE_ID.test(value)) throw new Error(`${label} must be a safe identifier.`);
  return value;
}

function safeSourceId(value: string): string {
  if (!value || value.includes("\\") || value.startsWith("/") || posix.normalize(value) !== value
    || value.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error("sourceId must be a normalized portable relative path.");
  }
  return value;
}

function safeRelativePath(value: string, label: string): string {
  if (!value || value.includes("\\") || value.startsWith("/") || posix.normalize(value) !== value
    || value.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`${label} must be a normalized portable relative path.`);
  }
  return value;
}

function exactKeys(value: unknown, expected: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) {
    throw new Error(`${label} has unknown or missing fields.`);
  }
}

function jsonObject(value: unknown, label: string): SqliteJsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be a JSON object.`);
  const encoded = JSON.stringify(value, (_key, candidate: unknown) => {
    if (candidate === undefined || typeof candidate === "function" || typeof candidate === "symbol" || typeof candidate === "bigint") {
      throw new Error(`${label} contains a non-JSON value.`);
    }
    if (typeof candidate === "number" && !Number.isFinite(candidate)) throw new Error(`${label} contains a non-finite number.`);
    return candidate;
  });
  if (encoded === undefined) throw new Error(`${label} is not JSON serializable.`);
  return JSON.parse(encoded) as SqliteJsonObject;
}

function digestBytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function structuredPayloadSha256(value: SqliteJsonObject): string {
  return digestBytes(Buffer.from(JSON.stringify(value), "utf8"));
}

function assertNoSecrets(value: unknown, path = "payload"): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecrets(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) throw new Error(`${path}.${key} must be a Keychain/reference field, not a secret value.`);
    assertNoSecrets(child, `${path}.${key}`);
  }
}

function parseEnvelope(input: StructuredDomainSourceV1): ImportedStructuredDomainV1 {
  safeSourceId(input.sourceId);
  if (!DOMAINS.includes(input.domain)) throw new Error("domain is invalid.");
  safeId(input.key, "key");
  safeId(input.scope, "scope");
  if (!(input.raw instanceof Uint8Array)) throw new Error("raw must be bytes.");
  const rawSha256 = digestBytes(input.raw);
  const value = input.value;
  exactKeys(value, ["schemaVersion", "domain", "key", "scope", "revision", "payload", "payloadSha256", "secretRefs"], "structured domain record");
  if (value.schemaVersion !== 1 || value.domain !== input.domain || value.key !== input.key || value.scope !== input.scope) {
    throw new Error("structured domain record identity is inconsistent.");
  }
  if (value.revision !== 0) throw new Error("legacy structured domain record revision must be zero.");
  const payload = jsonObject(value.payload, "structured domain payload");
  assertNoSecrets(payload);
  if (typeof value.payloadSha256 !== "string" || !SHA256.test(value.payloadSha256)
    || value.payloadSha256 !== structuredPayloadSha256(payload)) {
    throw new Error("structured domain payload digest is invalid.");
  }
  if (!Array.isArray(value.secretRefs) || !value.secretRefs.every((entry) => typeof entry === "string" && entry.startsWith("keychain:"))) {
    throw new Error("structured domain secretRefs must contain only Keychain references.");
  }
  return {
    ...input,
    sourceSha256: rawSha256,
    sourceBytes: input.raw.byteLength,
    envelope: {
      schemaVersion: 1,
      domain: input.domain,
      key: input.key,
      scope: input.scope,
      payload,
      payloadSha256: value.payloadSha256,
    },
  };
}

function streamId(address: StructuredDomainAddressV1): string {
  safeId(address.key, "key");
  safeId(address.scope, "scope");
  const value = `structured-${address.domain}-${address.scope}-${address.key}`;
  if (value.length > 128) throw new Error("structured domain address is too long.");
  return value;
}

function parseStoredProjection(value: SqliteJsonObject, address: StructuredDomainAddressV1, revision: number): StructuredDomainStoredValueV1 {
  exactKeys(value, ["schemaVersion", "domain", "key", "scope", "payload", "payloadSha256"], "SQLite structured domain projection");
  if (value.schemaVersion !== 1 || value.domain !== address.domain || value.key !== address.key || value.scope !== address.scope) {
    throw new Error("SQLite structured domain projection identity is invalid.");
  }
  const payload = jsonObject(value.payload, "SQLite structured domain payload");
  assertNoSecrets(payload);
  if (typeof value.payloadSha256 !== "string" || !SHA256.test(value.payloadSha256)
    || value.payloadSha256 !== structuredPayloadSha256(payload)) throw new Error("SQLite structured domain projection digest is invalid.");
  return { ...address, revision, payload, payloadSha256: value.payloadSha256 };
}

function envelope(address: StructuredDomainAddressV1, payload: SqliteJsonObject): SqliteJsonObject {
  assertNoSecrets(payload);
  return {
    schemaVersion: 1,
    domain: address.domain,
    key: address.key,
    scope: address.scope,
    payload,
    payloadSha256: structuredPayloadSha256(payload),
  };
}

function sameValue(left: SqliteJsonObject, right: SqliteJsonObject): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createSqliteSettingsGrantsTrustRepository(input: {
  root?: string;
  store: SqliteEventProjectionStore;
  authority: SqliteStorageAuthority;
}): SqliteSettingsGrantsTrustRepository {
  const readiness = Object.freeze({
    schemaVersion: 1 as const,
    authority: "sqlite" as const,
    domains: DOMAINS,
    excludes: ["provider-secrets", "pi-native-settings"] as const,
  });
  const repository: SqliteSettingsGrantsTrustRepository = {
    root: resolve(input.root ?? "."),
    readiness,
    read(address) {
      const stored = input.store.readProjection(streamId(address));
      return stored ? parseStoredProjection(stored.value, address, stored.revision) : null;
    },
    list(domain) {
      return input.store.listProjections()
        .filter((projection) => projection.streamId.startsWith("structured-"))
        .map((projection) => {
          const value = projection.value;
          if (!DOMAINS.includes(value.domain as StructuredDomainV1)) throw new Error("SQLite structured domain has an unknown domain.");
          const address = {
            domain: value.domain as StructuredDomainV1,
            key: String(value.key),
            scope: String(value.scope),
          };
          return parseStoredProjection(value, address, projection.revision);
        })
        .filter((entry) => domain === undefined || entry.domain === domain)
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    },
    async initialize({ address, value }) {
      await input.authority.assertOwned();
      const id = streamId(address);
      if (input.store.readProjection(id)) throw new Error(`SQLite structured domain ${id} is already initialized.`);
      input.store.initializeProjection({
        commandId: `structured-init-${randomUUID()}`,
        streamId: id,
        projection: envelope(address, jsonObject(value, "structured domain value")),
      });
      return repository.read(address)!;
    },
    async write({ address, expectedRevision, expectedValue, value }) {
      await input.authority.assertOwned();
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error("expectedRevision must be non-negative.");
      const id = streamId(address);
      const current = repository.read(address);
      if (!current) {
        if (expectedRevision !== 0) throw new SqliteRevisionConflictError(id, expectedRevision, 0);
        return repository.initialize({ address, value });
      }
      if (current.revision !== expectedRevision || !sameValue(current.payload, expectedValue)) {
        throw new SqliteRevisionConflictError(id, expectedRevision, current.revision);
      }
      await input.authority.assertOwned();
      input.store.append({
        commandId: `structured-write-${randomUUID()}`,
        streamId: id,
        expectedRevision,
        events: [{
          id: randomUUID(),
          type: `structured.${address.domain}.updated`,
          occurredAt: new Date().toISOString(),
          payload: { address: { ...address }, payloadSha256: structuredPayloadSha256(jsonObject(value, "structured domain value")) },
        }],
        projection: envelope(address, jsonObject(value, "structured domain value")),
      });
      return repository.read(address)!;
    },
    digestRecord(inputRecord) {
      return parseEnvelope(inputRecord);
    },
  };
  return repository;
}

function relativeWithin(root: string, path: string, label: string): string {
  const value = relative(root, path);
  if (!value || value.startsWith("..") || isAbsolute(value)) throw new Error(`${label} must be within root.`);
  return value;
}

async function syncPath(path: string): Promise<void> {
  const handle = await open(path, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

async function writeAtomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.tmp-${randomUUID()}`;
  try {
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await syncPath(temp);
    await rename(temp, path);
    await syncPath(dirname(path));
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

async function readMarker(path: string): Promise<StructuredDomainSqliteAuthorityMarkerV1 | null> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    exactKeys(value, ["schemaVersion", "authority", "databaseRelativePath", "backupRootRelativePath", "cutoverAt", "sources", "excludes"], "SQLite structured domain authority marker");
    const marker = value as Record<string, unknown>;
    if (marker.schemaVersion !== 1 || marker.authority !== "sqlite" || !Array.isArray(marker.sources)
      || JSON.stringify(marker.excludes) !== JSON.stringify(["provider-secrets", "pi-native-settings"])) {
      throw new Error("SQLite structured domain authority marker is invalid.");
    }
    if (typeof marker.databaseRelativePath !== "string" || typeof marker.backupRootRelativePath !== "string"
      || typeof marker.cutoverAt !== "string" || !Number.isFinite(Date.parse(marker.cutoverAt))) {
      throw new Error("SQLite structured domain authority marker values are invalid.");
    }
    if (new Date(marker.cutoverAt).toISOString() !== marker.cutoverAt) {
      throw new Error("SQLite structured domain authority marker timestamp must be canonical ISO-8601.");
    }
    safeRelativePath(String(marker.databaseRelativePath), "marker database path");
    safeRelativePath(String(marker.backupRootRelativePath), "marker backup path");
    const sources = marker.sources.map((entry, index) => {
      exactKeys(entry, ["sourceId", "domain", "key", "scope", "sourceSha256", "sourceBytes", "status", "payloadSha256"], `SQLite structured domain marker source ${index}`);
      const row = entry as Record<string, unknown>;
      if (!DOMAINS.includes(row.domain as StructuredDomainV1) || typeof row.sourceId !== "string") {
        throw new Error("SQLite structured domain marker source identity is invalid.");
      }
      safeSourceId(row.sourceId);
      safeId(String(row.key), "marker source key");
      safeId(String(row.scope), "marker source scope");
      if (typeof row.sourceSha256 !== "string" || !SHA256.test(row.sourceSha256)
        || !Number.isSafeInteger(row.sourceBytes) || Number(row.sourceBytes) < 0
        || row.status !== "valid" || typeof row.payloadSha256 !== "string" || !SHA256.test(row.payloadSha256)) {
        throw new Error("SQLite structured domain marker source values are invalid.");
      }
      return row as unknown as StructuredDomainCutoverSourceReportV1;
    });
    const sourceIds = new Set(sources.map((source) => source.sourceId));
    if (sourceIds.size !== sources.length) throw new Error("SQLite structured domain authority marker has duplicate sources.");
    if (typeof marker.databaseRelativePath !== "string" || typeof marker.backupRootRelativePath !== "string") {
      throw new Error("SQLite structured domain marker paths are invalid.");
    }
    return {
      schemaVersion: 1,
      authority: "sqlite",
      databaseRelativePath: marker.databaseRelativePath,
      backupRootRelativePath: marker.backupRootRelativePath,
      cutoverAt: marker.cutoverAt,
      sources,
      excludes: ["provider-secrets", "pi-native-settings"],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function prepareSqliteSettingsGrantsTrustCutover(input: {
  root: string;
  authority: SqliteStorageAuthority;
  activeRunCount: number;
  sources: readonly StructuredDomainSourceV1[];
  now?: () => Date;
}): Promise<PreparedSqliteSettingsGrantsTrustCutover> {
  if (!Number.isSafeInteger(input.activeRunCount) || input.activeRunCount < 0) throw new Error("activeRunCount must be non-negative.");
  if (input.activeRunCount !== 0) throw new Error("Settings/grants/trust cutover is blocked while Agent Runs are active.");
  const root = resolve(input.root);
  await input.authority.assertOwned();
  const storageRoot = join(root, "data", "runtime", "settings-grants-trust-sqlite-v1");
  const markerPath = join(storageRoot, "authority-v1.json");
  const existing = await readMarker(markerPath);
  const databasePath = existing ? resolve(root, existing.databaseRelativePath) : join(storageRoot, "settings-grants-trust.sqlite");
  const store = new SqliteEventProjectionStore(databasePath);
  const repository = createSqliteSettingsGrantsTrustRepository({ root, store, authority: input.authority });
  if (existing) {
    await input.authority.assertOwned();
    return { status: "already-sqlite", marker: existing, repository, close: () => store.close() };
  }

  const attempt = join(root, "data", "backups", "settings-grants-trust-cutover-v1", `attempt-${randomUUID()}`);
  const reports: StructuredDomainCutoverSourceReportV1[] = [];
  const invalid: Array<StructuredDomainCutoverSourceReportV1 & { rawSha256: string }> = [];
  const sourceIds = new Set<string>();
  let markerPublished = false;
  try {
    await mkdir(attempt, { recursive: true, mode: 0o700 });
    for (const source of [...input.sources].sort((left, right) => left.sourceId.localeCompare(right.sourceId))) {
      const sourceSha256 = digestBytes(source.raw);
      const base: StructuredDomainCutoverSourceReportV1 = {
        sourceId: safeSourceId(source.sourceId),
        domain: source.domain,
        key: source.key,
        scope: source.scope,
        sourceSha256,
        sourceBytes: source.raw.byteLength,
        status: "valid",
      };
      if (sourceIds.has(base.sourceId)) throw new Error(`Duplicate structured domain source ${base.sourceId}.`);
      sourceIds.add(base.sourceId);
      const target = join(attempt, base.sourceId);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, source.raw, { flag: "wx", mode: 0o600 });
      await syncPath(target);
      try {
        const imported = repository.digestRecord(source);
        const report = { ...base, payloadSha256: imported.envelope.payloadSha256 };
        if (repository.read(source) !== null) throw new Error(`Duplicate structured domain record ${streamId(source)}.`);
        await repository.initialize({ address: source, value: imported.envelope.payload });
        const stored = repository.read(source);
        if (!stored || stored.revision !== 0 || stored.payloadSha256 !== imported.envelope.payloadSha256
          || JSON.stringify(stored.payload) !== JSON.stringify(imported.envelope.payload)) {
          throw new Error(`Structured domain parity failed for ${base.sourceId}.`);
        }
        reports.push(report);
      } catch (error) {
        const invalidReport = {
          ...base,
          status: "invalid" as const,
          reason: error instanceof Error ? error.message : String(error),
          rawSha256: sourceSha256,
        };
        invalid.push(invalidReport);
      }
    }
    const report: StructuredDomainImportReportV1 = {
      schemaVersion: 1,
      valid: reports,
      invalid,
      backupRootRelativePath: relativeWithin(root, attempt, "backup root"),
    };
    await writeAtomicJson(join(attempt, "import-report-v1.json"), report);
    if (invalid.length > 0) throw new StructuredDomainImportBlockedError(report);
    const marker: StructuredDomainSqliteAuthorityMarkerV1 = {
      schemaVersion: 1,
      authority: "sqlite",
      databaseRelativePath: relativeWithin(root, databasePath, "database path"),
      backupRootRelativePath: relativeWithin(root, attempt, "backup root"),
      cutoverAt: (input.now?.() ?? new Date()).toISOString(),
      sources: reports,
      excludes: ["provider-secrets", "pi-native-settings"],
    };
    await input.authority.assertOwned();
    await writeAtomicJson(markerPath, marker);
    markerPublished = true;
    await input.authority.assertOwned();
    return { status: "cutover", marker, repository, close: () => store.close() };
  } catch (error) {
    store.close();
    if (!markerPublished) {
      await Promise.all([
        rm(databasePath, { force: true }),
        rm(`${databasePath}-wal`, { force: true }),
        rm(`${databasePath}-shm`, { force: true }),
      ]);
    }
    throw error;
  }
}
