import { createHash, randomUUID } from "node:crypto";
import { createReadStream, mkdirSync } from "node:fs";
import { copyFile, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, posix, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import {
  legacyTaskSqliteMappingContractJson,
  parseLegacyTaskSqliteMappingContract,
} from "./task_mapping_contract.js";
export {
  LEGACY_TASK_SQLITE_MAPPING_CONTRACT,
  LEGACY_TASK_SQLITE_MAPPING_SCHEMA_VERSION,
  legacyTaskSqliteMappingContractJson,
  parseLegacyTaskSqliteMappingContract,
  requireMappedLegacyFields,
} from "./task_mapping_contract.js";
export type {
  LegacyTaskMappingEntity,
  LegacyTaskMappingSource,
  LegacyTaskMappingSourceId,
  LegacyTaskSqliteMappingContractV1,
} from "./task_mapping_contract.js";
export {
  importLegacyTaskWorkspace,
  legacyTaskStreamId,
} from "./legacy_task_importer.js";
export {
  importLegacyTaskSideState,
  legacyTaskSideStreamIds,
} from "./legacy_task_side_importer.js";
export type {
  ImportLegacyTaskSideStateInput,
  LegacyTaskSideImportReport,
} from "./legacy_task_side_importer.js";
export {
  createSqliteTaskWorkspacePersistence,
  createSqliteTaskWorkspaceRepository,
  SQLITE_TASK_WORKSPACE_REPOSITORY_READINESS,
} from "./task_workspace_repository.js";
export type {
  SqliteTaskWorkspaceRepositoryInput,
} from "./task_workspace_repository.js";
export {
  createSqliteTaskAggregateBackend,
  createSqliteTaskMessageQueuePersistence,
  createSqliteTaskPackageProfilePersistence,
  SQLITE_TASK_AGGREGATE_BACKEND_READINESS,
} from "./task_aggregate_backend.js";
export type {
  CreateSqliteTaskAggregateBackendInput,
  SqliteTaskAggregateBackend,
  SqliteTaskPackageProfilePersistence,
  SqliteTaskPackageProfileStoreInput,
} from "./task_aggregate_backend.js";
export type {
  ImportLegacyTaskWorkspaceInput,
  LegacyTaskBackupFileV1,
  LegacyTaskBackupManifestV1,
  LegacyTaskImportReport,
} from "./legacy_task_importer.js";
export {
  executeSqliteAuditCommand,
  exportSqliteAuditJsonl,
  verifySqliteAuditJsonl,
} from "./sqlite_audit_export.js";
export type {
  SqliteAuditExportResult,
  SqliteAuditVerificationResult,
} from "./sqlite_audit_export.js";
export {
  BlobDigestMismatchError,
  BlobReferenceBusyError,
  BlobReferenceRevisionConflictError,
  ContentBlobStore,
} from "./blob_store.js";
export type {
  ContentBlobInspectionV1,
  ContentBlobPublishResult,
  ContentBlobRefV1,
  ContentBlobReferenceManifestV1,
  ContentBlobStoreAuthority,
} from "./blob_store.js";
export {
  StructuredDomainImportBlockedError,
  createSqliteSettingsGrantsTrustRepository,
  prepareSqliteSettingsGrantsTrustCutover,
  structuredPayloadSha256,
} from "./settings_grants_trust_repository.js";
export {
  assistantMemoryStreamId,
  createSqliteAssistantMemoryPersistence,
  SQLITE_ASSISTANT_MEMORY_REPOSITORY_READINESS,
} from "./assistant_memory_repository.js";
export {
  assistantLibraryStreamId,
  createSqliteAssistantLibraryPersistence,
  SQLITE_ASSISTANT_LIBRARY_REPOSITORY_READINESS,
} from "./assistant_library_repository.js";
export {
  SqliteCatCoreRepository,
  SQLITE_CAT_CORE_REPOSITORY_READINESS,
} from "./cat_core_repository.js";
export type { SqliteCatCoreRepositoryInput } from "./cat_core_repository.js";
export {
  SqliteCatGovernanceRepository,
  SQLITE_CAT_GOVERNANCE_REPOSITORY_READINESS,
} from "./cat_governance_repository.js";
export type { SqliteCatGovernanceRepositoryInput } from "./cat_governance_repository.js";
export { SqliteWorkflowEvalRepository, SQLITE_WORKFLOW_EVAL_REPOSITORY_READINESS } from "./workflow_eval_repository.js";
export type {
  PreparedSqliteSettingsGrantsTrustCutover,
  SqliteSettingsGrantsTrustRepository,
  StructuredDomainAddressV1,
  StructuredDomainCutoverSourceReportV1,
  StructuredDomainImportReportV1,
  StructuredDomainSourceV1,
  StructuredDomainSqliteAuthorityMarkerV1,
  StructuredDomainStoredValueV1,
  StructuredDomainV1,
} from "./settings_grants_trust_repository.js";

export const SQLITE_STORAGE_SCHEMA_VERSION = 2 as const;

export type SqliteJsonValue = null | boolean | number | string | SqliteJsonValue[] | SqliteJsonObject;
export type SqliteJsonObject = { [key: string]: SqliteJsonValue };

export interface SqliteEventInput {
  id: string;
  type: string;
  occurredAt: string;
  payload: SqliteJsonObject;
}

export interface SqliteAppendInput {
  commandId: string;
  streamId: string;
  expectedRevision: number;
  events: readonly SqliteEventInput[];
  projection: SqliteJsonObject;
}

export interface SqliteAppendResult {
  streamId: string;
  previousRevision: number;
  revision: number;
  eventIds: string[];
}

export interface SqliteInitializeProjectionInput {
  commandId: string;
  streamId: string;
  projection: SqliteJsonObject;
}

export interface SqliteInitializeProjectionResult {
  streamId: string;
  revision: 0;
}

export interface SqliteReplaceProjectionInput {
  commandId: string;
  streamId: string;
  expectedRevision: number;
  expectedProjection: SqliteJsonObject;
  projection: SqliteJsonObject;
}

export interface SqliteStoredEvent extends SqliteEventInput {
  streamId: string;
  sequence: number;
}

export interface SqliteStoredProjection {
  streamId: string;
  revision: number;
  value: SqliteJsonObject;
}

export interface SqliteStoredMappingContract {
  domain: string;
  contractVersion: number;
  maxSourceSchemaVersion: number;
  contractHash: string;
  contract: unknown;
}

export interface SqliteStorageAuthority {
  assertOwned(): Promise<void>;
}

export interface SqliteStorageBackupFileV1 {
  relativePath: string;
  sha256: string;
  bytes: number;
}

export interface SqliteStorageBackupManifestV1 {
  schemaVersion: 1;
  createdAt: string;
  storageSchemaVersion: number;
  database: SqliteStorageBackupFileV1;
  blobs: SqliteStorageBackupFileV1[];
}

export interface SqliteStorageBackupBlobInput {
  sourcePath: string;
  relativePath: string;
}

export class SqliteRevisionConflictError extends Error {
  constructor(
    readonly streamId: string,
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(`SQLite stream ${streamId} revision ${actualRevision} does not match expected ${expectedRevision}.`);
    this.name = "SqliteRevisionConflictError";
  }
}

export class SqliteIdempotencyConflictError extends Error {
  constructor(readonly commandId: string) {
    super(`SQLite command ${commandId} was already used for different input.`);
    this.name = "SqliteIdempotencyConflictError";
  }
}

const IDENTIFIER = /^[A-Za-z0-9_.:-]{1,128}$/u;

function requiredIdentifier(value: string, label: string): string {
  if (!IDENTIFIER.test(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function requiredRevision(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer.`);
  return value;
}

function encodeJson(value: SqliteJsonObject, label: string): string {
  const encoded = JSON.stringify(value, (_key, candidate: unknown) => {
    if (typeof candidate === "number" && !Number.isFinite(candidate)) throw new Error(`${label} contains a non-finite number.`);
    if (candidate === undefined || typeof candidate === "function" || typeof candidate === "symbol" || typeof candidate === "bigint") {
      throw new Error(`${label} contains a non-JSON value.`);
    }
    return candidate;
  });
  if (encoded === undefined) throw new Error(`${label} is not JSON serializable.`);
  return encoded;
}

function decodeObject(value: unknown, label: string): SqliteJsonObject {
  if (typeof value !== "string") throw new Error(`${label} is not stored JSON.`);
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${label} must be a JSON object.`);
  return parsed as SqliteJsonObject;
}

function rowNumber(row: Record<string, unknown> | undefined, key: string, fallback?: number): number {
  const value = row?.[key];
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`SQLite row ${key} is invalid.`);
  return value;
}

function rowString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`SQLite row ${key} is invalid.`);
  return value;
}

function normalizedInput(input: SqliteAppendInput): SqliteAppendInput {
  requiredIdentifier(input.commandId, "commandId");
  requiredIdentifier(input.streamId, "streamId");
  requiredRevision(input.expectedRevision, "expectedRevision");
  if (input.events.length === 0) throw new Error("events must not be empty.");
  const events = input.events.map((event) => {
    requiredIdentifier(event.id, "event.id");
    requiredIdentifier(event.type, "event.type");
    if (Number.isNaN(Date.parse(event.occurredAt))) throw new Error("event.occurredAt must be an ISO timestamp.");
    encodeJson(event.payload, "event.payload");
    return { ...event };
  });
  encodeJson(input.projection, "projection");
  return { ...input, events, projection: { ...input.projection } };
}

function migrate(database: DatabaseSync): void {
  let version = rowNumber(database.prepare("PRAGMA user_version").get() as Record<string, unknown>, "user_version");
  if (version > SQLITE_STORAGE_SCHEMA_VERSION) throw new Error(`unsupported SQLite schema version ${version}`);
  if (version < 1) {
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(`
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE streams (
          stream_id TEXT PRIMARY KEY,
          revision INTEGER NOT NULL CHECK (revision >= 0)
        ) STRICT;
        CREATE TABLE events (
          stream_id TEXT NOT NULL REFERENCES streams(stream_id) ON DELETE CASCADE,
          sequence INTEGER NOT NULL CHECK (sequence > 0),
          event_id TEXT NOT NULL UNIQUE,
          event_type TEXT NOT NULL,
          occurred_at TEXT NOT NULL,
          payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
          PRIMARY KEY (stream_id, sequence)
        ) STRICT;
        CREATE TABLE projections (
          stream_id TEXT PRIMARY KEY REFERENCES streams(stream_id) ON DELETE CASCADE,
          revision INTEGER NOT NULL CHECK (revision >= 0),
          projection_json TEXT NOT NULL CHECK (json_valid(projection_json))
        ) STRICT;
        CREATE TABLE commands (
          command_id TEXT PRIMARY KEY,
          stream_id TEXT NOT NULL REFERENCES streams(stream_id) ON DELETE CASCADE,
          request_json TEXT NOT NULL CHECK (json_valid(request_json)),
          result_json TEXT NOT NULL CHECK (json_valid(result_json))
        ) STRICT;
        INSERT INTO schema_migrations(version, applied_at)
        VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
        PRAGMA user_version = 1;
      `);
      database.exec("COMMIT");
      version = 1;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  if (version < 2) {
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(`
        CREATE TABLE mapping_contracts (
          domain TEXT PRIMARY KEY,
          contract_version INTEGER NOT NULL CHECK (contract_version > 0),
          max_source_schema_version INTEGER NOT NULL CHECK (max_source_schema_version > 0),
          contract_hash TEXT NOT NULL CHECK (length(contract_hash) = 64),
          contract_json TEXT NOT NULL CHECK (json_valid(contract_json))
        ) STRICT;
      `);
      const contractJson = legacyTaskSqliteMappingContractJson();
      const contractHash = createHash("sha256").update(contractJson).digest("hex");
      database.prepare(`
        INSERT INTO mapping_contracts(
          domain, contract_version, max_source_schema_version, contract_hash, contract_json
        ) VALUES (?, ?, ?, ?, ?)
      `).run("legacy_task", 1, 2, contractHash, contractJson);
      database.exec(`
        INSERT INTO schema_migrations(version, applied_at)
        VALUES (2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
        PRAGMA user_version = 2;
      `);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}

function verifySchema(database: DatabaseSync): void {
  for (const table of ["schema_migrations", "streams", "events", "projections", "commands", "mapping_contracts"]) {
    database.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
  }
  const migration = database.prepare(
    "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1",
  ).get() as Record<string, unknown> | undefined;
  if (rowNumber(migration, "version") !== SQLITE_STORAGE_SCHEMA_VERSION) {
    throw new Error("SQLite schema migration ledger is inconsistent.");
  }
  const mapping = database.prepare(
    "SELECT contract_version, max_source_schema_version, contract_hash, contract_json FROM mapping_contracts WHERE domain = ?",
  ).get("legacy_task") as Record<string, unknown> | undefined;
  if (!mapping) throw new Error("SQLite legacy Task mapping contract is missing.");
  if (rowNumber(mapping, "contract_version") !== 1 || rowNumber(mapping, "max_source_schema_version") !== 2) {
    throw new Error("SQLite legacy Task mapping contract version is invalid.");
  }
  const contractJson = rowString(mapping, "contract_json");
  const contractHash = rowString(mapping, "contract_hash");
  if (createHash("sha256").update(contractJson).digest("hex") !== contractHash) {
    throw new Error("SQLite legacy Task mapping contract hash is invalid.");
  }
  parseLegacyTaskSqliteMappingContract(JSON.parse(contractJson));
}

const STORE_DATABASES = new WeakMap<SqliteEventProjectionStore, DatabaseSync>();

export class SqliteEventProjectionStore {
  readonly #database: DatabaseSync;
  readonly storageId: string;
  #closed = false;

  constructor(databasePath: string, options: { readOnly?: boolean } = {}) {
    if (!databasePath.trim()) throw new Error("databasePath is required.");
    const readOnly = options.readOnly ?? false;
    if (readOnly && databasePath === ":memory:") {
      throw new Error("readOnly SQLite storage requires a file database.");
    }
    if (!readOnly && databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
    this.storageId = databasePath === ":memory:"
      ? `memory:${randomUUID()}`
      : `file:${isAbsolute(databasePath) ? databasePath : resolve(databasePath)}`;
    const database = new DatabaseSync(databasePath, {
      readOnly,
      enableForeignKeyConstraints: true,
      enableDoubleQuotedStringLiterals: false,
      allowExtension: false,
    });
    try {
      if (readOnly) {
        database.exec(`
          PRAGMA foreign_keys = ON;
          PRAGMA busy_timeout = 5000;
        `);
      } else {
        database.exec(`
          PRAGMA journal_mode = WAL;
          PRAGMA synchronous = FULL;
          PRAGMA foreign_keys = ON;
          PRAGMA busy_timeout = 5000;
        `);
        migrate(database);
      }
      verifySchema(database);
    } catch (error) {
      database.close();
      throw error;
    }
    this.#database = database;
    STORE_DATABASES.set(this, database);
  }

  schemaVersion(): number {
    return rowNumber(this.#database.prepare("PRAGMA user_version").get() as Record<string, unknown>, "user_version");
  }

  journalMode(): string {
    return rowString(this.#database.prepare("PRAGMA journal_mode").get() as Record<string, unknown>, "journal_mode");
  }

  currentRevision(streamId: string): number {
    requiredIdentifier(streamId, "streamId");
    const row = this.#database.prepare("SELECT revision FROM streams WHERE stream_id = ?").get(streamId) as Record<string, unknown> | undefined;
    return rowNumber(row, "revision", 0);
  }

  readMappingContract(domain: string): SqliteStoredMappingContract | undefined {
    requiredIdentifier(domain, "domain");
    const row = this.#database.prepare(`
      SELECT domain, contract_version, max_source_schema_version, contract_hash, contract_json
      FROM mapping_contracts
      WHERE domain = ?
    `).get(domain) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    const contractJson = rowString(row, "contract_json");
    const contract: unknown = JSON.parse(contractJson);
    if (domain === "legacy_task") parseLegacyTaskSqliteMappingContract(contract);
    return {
      domain: rowString(row, "domain"),
      contractVersion: rowNumber(row, "contract_version"),
      maxSourceSchemaVersion: rowNumber(row, "max_source_schema_version"),
      contractHash: rowString(row, "contract_hash"),
      contract,
    };
  }

  initializeProjection(rawInput: SqliteInitializeProjectionInput): SqliteInitializeProjectionResult {
    requiredIdentifier(rawInput.commandId, "commandId");
    requiredIdentifier(rawInput.streamId, "streamId");
    encodeJson(rawInput.projection, "projection");
    const input = { ...rawInput, projection: { ...rawInput.projection } };
    const requestJson = JSON.stringify(input);
    const result: SqliteInitializeProjectionResult = { streamId: input.streamId, revision: 0 };
    const resultJson = JSON.stringify(result);
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.#database.prepare(
        "SELECT request_json, result_json FROM commands WHERE command_id = ?",
      ).get(input.commandId) as Record<string, unknown> | undefined;
      if (existing) {
        if (rowString(existing, "request_json") !== requestJson) {
          throw new SqliteIdempotencyConflictError(input.commandId);
        }
        const stored = JSON.parse(rowString(existing, "result_json")) as SqliteInitializeProjectionResult;
        this.#database.exec("COMMIT");
        return stored;
      }
      if (this.#database.prepare("SELECT 1 FROM streams WHERE stream_id = ?").get(input.streamId)) {
        throw new Error(`SQLite stream ${input.streamId} is already initialized.`);
      }
      this.#database.prepare("INSERT INTO streams(stream_id, revision) VALUES (?, 0)").run(input.streamId);
      this.#database.prepare(
        "INSERT INTO projections(stream_id, revision, projection_json) VALUES (?, 0, ?)",
      ).run(input.streamId, JSON.stringify(input.projection));
      this.#database.prepare(
        "INSERT INTO commands(command_id, stream_id, request_json, result_json) VALUES (?, ?, ?, ?)",
      ).run(input.commandId, input.streamId, requestJson, resultJson);
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  replaceProjection(rawInput: SqliteReplaceProjectionInput): SqliteStoredProjection {
    requiredIdentifier(rawInput.commandId, "commandId");
    requiredIdentifier(rawInput.streamId, "streamId");
    requiredRevision(rawInput.expectedRevision, "expectedRevision");
    const expectedProjectionJson = encodeJson(rawInput.expectedProjection, "expectedProjection");
    const projectionJson = encodeJson(rawInput.projection, "projection");
    const requestJson = JSON.stringify(rawInput);
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const existingCommand = this.#database.prepare(
        "SELECT request_json, result_json FROM commands WHERE command_id = ?",
      ).get(rawInput.commandId) as Record<string, unknown> | undefined;
      if (existingCommand) {
        if (rowString(existingCommand, "request_json") !== requestJson) {
          throw new SqliteIdempotencyConflictError(rawInput.commandId);
        }
        const stored = JSON.parse(rowString(existingCommand, "result_json")) as SqliteStoredProjection;
        this.#database.exec("COMMIT");
        return stored;
      }
      const row = this.#database.prepare(`
        SELECT s.revision, p.projection_json
        FROM streams s JOIN projections p ON p.stream_id = s.stream_id
        WHERE s.stream_id = ?
      `).get(rawInput.streamId) as Record<string, unknown> | undefined;
      const actualRevision = rowNumber(row, "revision", 0);
      if (!row || actualRevision !== rawInput.expectedRevision
        || rowString(row, "projection_json") !== expectedProjectionJson) {
        throw new SqliteRevisionConflictError(rawInput.streamId, rawInput.expectedRevision, actualRevision);
      }
      this.#database.prepare(
        "UPDATE projections SET projection_json = ? WHERE stream_id = ? AND revision = ?",
      ).run(projectionJson, rawInput.streamId, rawInput.expectedRevision);
      const result: SqliteStoredProjection = {
        streamId: rawInput.streamId,
        revision: rawInput.expectedRevision,
        value: rawInput.projection,
      };
      this.#database.prepare(
        "INSERT INTO commands(command_id, stream_id, request_json, result_json) VALUES (?, ?, ?, ?)",
      ).run(rawInput.commandId, rawInput.streamId, requestJson, JSON.stringify(result));
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  append(rawInput: SqliteAppendInput): SqliteAppendResult {
    const input = normalizedInput(rawInput);
    const requestJson = JSON.stringify(input);
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.#database.prepare(
        "SELECT request_json, result_json FROM commands WHERE command_id = ?",
      ).get(input.commandId) as Record<string, unknown> | undefined;
      if (existing) {
        if (rowString(existing, "request_json") !== requestJson) {
          throw new SqliteIdempotencyConflictError(input.commandId);
        }
        const result = JSON.parse(rowString(existing, "result_json")) as SqliteAppendResult;
        this.#database.exec("COMMIT");
        return result;
      }

      const actualRevision = this.currentRevision(input.streamId);
      if (actualRevision !== input.expectedRevision) {
        throw new SqliteRevisionConflictError(input.streamId, input.expectedRevision, actualRevision);
      }
      const revision = actualRevision + input.events.length;
      const streamExists = this.#database.prepare(
        "SELECT 1 FROM streams WHERE stream_id = ?",
      ).get(input.streamId) !== undefined;
      if (!streamExists) {
        this.#database.prepare("INSERT INTO streams(stream_id, revision) VALUES (?, ?)").run(input.streamId, revision);
      } else {
        const update = this.#database.prepare(
          "UPDATE streams SET revision = ? WHERE stream_id = ? AND revision = ?",
        ).run(revision, input.streamId, actualRevision);
        if (update.changes !== 1) {
          throw new SqliteRevisionConflictError(
            input.streamId,
            input.expectedRevision,
            this.currentRevision(input.streamId),
          );
        }
      }
      const insertEvent = this.#database.prepare(`
        INSERT INTO events(stream_id, sequence, event_id, event_type, occurred_at, payload_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      input.events.forEach((event, index) => {
        insertEvent.run(
          input.streamId,
          actualRevision + index + 1,
          event.id,
          event.type,
          event.occurredAt,
          encodeJson(event.payload, "event.payload"),
        );
      });
      this.#database.prepare(`
        INSERT INTO projections(stream_id, revision, projection_json)
        VALUES (?, ?, ?)
        ON CONFLICT(stream_id) DO UPDATE SET
          revision = excluded.revision,
          projection_json = excluded.projection_json
      `).run(input.streamId, revision, encodeJson(input.projection, "projection"));

      const result: SqliteAppendResult = {
        streamId: input.streamId,
        previousRevision: actualRevision,
        revision,
        eventIds: input.events.map((event) => event.id),
      };
      this.#database.prepare(`
        INSERT INTO commands(command_id, stream_id, request_json, result_json)
        VALUES (?, ?, ?, ?)
      `).run(input.commandId, input.streamId, requestJson, JSON.stringify(result));
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  readEvents(streamId: string, afterSequence = 0): SqliteStoredEvent[] {
    requiredIdentifier(streamId, "streamId");
    requiredRevision(afterSequence, "afterSequence");
    const rows = this.#database.prepare(`
      SELECT sequence, event_id, event_type, occurred_at, payload_json
      FROM events
      WHERE stream_id = ? AND sequence > ?
      ORDER BY sequence ASC
    `).all(streamId, afterSequence) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      streamId,
      sequence: rowNumber(row, "sequence"),
      id: rowString(row, "event_id"),
      type: rowString(row, "event_type"),
      occurredAt: rowString(row, "occurred_at"),
      payload: decodeObject(row.payload_json, "event.payload"),
    }));
  }

  readProjection(streamId: string): SqliteStoredProjection | null {
    requiredIdentifier(streamId, "streamId");
    const row = this.#database.prepare(
      "SELECT revision, projection_json FROM projections WHERE stream_id = ?",
    ).get(streamId) as Record<string, unknown> | undefined;
    return row ? {
      streamId,
      revision: rowNumber(row, "revision"),
      value: decodeObject(row.projection_json, "projection"),
    } : null;
  }

  listProjections(): SqliteStoredProjection[] {
    const rows = this.#database.prepare(
      "SELECT stream_id, revision, projection_json FROM projections ORDER BY stream_id ASC",
    ).all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      streamId: rowString(row, "stream_id"),
      revision: rowNumber(row, "revision"),
      value: decodeObject(row.projection_json, "projection"),
    }));
  }

  quickCheck(): string {
    return rowString(this.#database.prepare("PRAGMA quick_check").get() as Record<string, unknown>, "quick_check");
  }

  foreignKeyViolations(): string[] {
    return (this.#database.prepare("PRAGMA foreign_key_check").all() as Array<Record<string, unknown>>)
      .map((row) => JSON.stringify(row));
  }

  close(): void {
    if (this.#closed) return;
    this.#database.close();
    STORE_DATABASES.delete(this);
    this.#closed = true;
  }
}

const SHA256 = /^[a-f0-9]{64}$/u;

function portableRelativePath(value: string, label: string): string {
  if (!value || value.includes("\\") || value.startsWith("/") || posix.normalize(value) !== value ||
    value.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`${label} must be a normalized portable relative path.`);
  }
  return value;
}

function absolutePath(value: string, label: string): string {
  if (!value.trim() || !isAbsolute(value)) throw new Error(`${label} must be an absolute path.`);
  return value;
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} has unknown or missing fields.`);
  }
}

function parseBackupFile(value: unknown, label: string): SqliteStorageBackupFileV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid.`);
  const record = value as Record<string, unknown>;
  exactKeys(record, ["relativePath", "sha256", "bytes"], label);
  if (typeof record.relativePath !== "string" || typeof record.sha256 !== "string" ||
    !SHA256.test(record.sha256) || !Number.isSafeInteger(record.bytes) || Number(record.bytes) < 0) {
    throw new Error(`${label} is invalid.`);
  }
  return {
    relativePath: portableRelativePath(record.relativePath, `${label}.relativePath`),
    sha256: record.sha256,
    bytes: Number(record.bytes),
  };
}

function parseBackupManifest(value: unknown): SqliteStorageBackupManifestV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("SQLite backup manifest is invalid.");
  const record = value as Record<string, unknown>;
  exactKeys(record, ["schemaVersion", "createdAt", "storageSchemaVersion", "database", "blobs"], "SQLite backup manifest");
  const createdAt = typeof record.createdAt === "string" ? Date.parse(record.createdAt) : Number.NaN;
  if (record.schemaVersion !== 1 || typeof record.createdAt !== "string" || !Number.isFinite(createdAt) ||
    new Date(createdAt).toISOString() !== record.createdAt ||
    !Number.isSafeInteger(record.storageSchemaVersion) || Number(record.storageSchemaVersion) < 1 ||
    !Array.isArray(record.blobs)) {
    throw new Error("SQLite backup manifest is invalid.");
  }
  const database = parseBackupFile(record.database, "SQLite backup database");
  if (database.relativePath !== "database.sqlite") throw new Error("SQLite backup database path is invalid.");
  const blobs = record.blobs.map((entry, index) => parseBackupFile(entry, `SQLite backup blob ${index}`));
  const paths = new Set<string>();
  for (const blob of blobs) {
    if (paths.has(blob.relativePath)) throw new Error(`SQLite backup blob path is duplicated: ${blob.relativePath}`);
    paths.add(blob.relativePath);
  }
  return {
    schemaVersion: 1,
    createdAt: record.createdAt,
    storageSchemaVersion: Number(record.storageSchemaVersion),
    database,
    blobs,
  };
}

async function fileDigest(path: string): Promise<SqliteStorageBackupFileV1> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  const metadata = await stat(path);
  if (!metadata.isFile()) throw new Error(`SQLite backup file is missing or invalid: ${basename(path)}`);
  return { relativePath: "", sha256: hash.digest("hex"), bytes: metadata.size };
}

async function syncPath(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function assertAbsent(path: string, label: string): Promise<void> {
  try {
    await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error(`${label} already exists.`);
}

async function copyVerifiedFile(
  sourcePath: string,
  targetPath: string,
  relativePath: string,
  expected?: SqliteStorageBackupFileV1,
): Promise<SqliteStorageBackupFileV1> {
  const source = await fileDigest(sourcePath);
  if (expected && (source.sha256 !== expected.sha256 || source.bytes !== expected.bytes)) {
    throw new Error(`SQLite backup source digest mismatch: ${relativePath}`);
  }
  await mkdir(dirname(targetPath), { recursive: true, mode: 0o700 });
  await copyFile(sourcePath, targetPath);
  await syncPath(targetPath);
  const copied = await fileDigest(targetPath);
  if (source.sha256 !== copied.sha256 || source.bytes !== copied.bytes) {
    throw new Error(`SQLite backup copy verification failed: ${relativePath}`);
  }
  return { relativePath, sha256: copied.sha256, bytes: copied.bytes };
}

async function verifyManifestFile(
  root: string,
  file: SqliteStorageBackupFileV1,
  label: string,
): Promise<void> {
  let actual: SqliteStorageBackupFileV1;
  try {
    actual = await fileDigest(join(root, file.relativePath));
  } catch {
    throw new Error(`${label} is missing or invalid: ${file.relativePath}`);
  }
  if (actual.sha256 !== file.sha256 || actual.bytes !== file.bytes) {
    throw new Error(`${label} digest mismatch: ${file.relativePath}`);
  }
}

function verifyBackupDatabase(path: string, expectedSchemaVersion: number): void {
  const database = new DatabaseSync(path, {
    readOnly: true,
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
    allowExtension: false,
  });
  try {
    const quickCheck = rowString(database.prepare("PRAGMA quick_check").get() as Record<string, unknown>, "quick_check");
    if (quickCheck !== "ok") throw new Error(`SQLite backup quick check failed: ${quickCheck}`);
    const version = rowNumber(database.prepare("PRAGMA user_version").get() as Record<string, unknown>, "user_version");
    if (version !== expectedSchemaVersion || version !== SQLITE_STORAGE_SCHEMA_VERSION) {
      throw new Error(`SQLite backup schema version ${version} is unsupported.`);
    }
    verifySchema(database);
  } finally {
    database.close();
  }
}

export async function createSqliteStorageBackup(options: {
  store: SqliteEventProjectionStore;
  authority: SqliteStorageAuthority;
  backupDirectory: string;
  blobs?: readonly SqliteStorageBackupBlobInput[];
  now?: () => Date;
}): Promise<SqliteStorageBackupManifestV1> {
  const database = STORE_DATABASES.get(options.store);
  if (!database) throw new Error("SQLite storage is closed.");
  absolutePath(options.backupDirectory, "backupDirectory");
  const now = options.now?.() ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("backup timestamp is invalid.");
  const blobs = [...(options.blobs ?? [])]
    .map((blob) => ({
      sourcePath: absolutePath(blob.sourcePath, "backup blob sourcePath"),
      relativePath: portableRelativePath(blob.relativePath, "backup blob relativePath"),
    }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  if (new Set(blobs.map((blob) => blob.relativePath)).size !== blobs.length) {
    throw new Error("backup blob relativePath is duplicated.");
  }

  await options.authority.assertOwned();
  await assertAbsent(options.backupDirectory, "backupDirectory");
  const parent = dirname(options.backupDirectory);
  const staging = join(parent, `.${basename(options.backupDirectory)}.staging-${randomUUID()}`);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await mkdir(staging, { mode: 0o700 });
  try {
    const databasePath = join(staging, "database.sqlite");
    await backup(database, databasePath);
    await syncPath(databasePath);
    verifyBackupDatabase(databasePath, SQLITE_STORAGE_SCHEMA_VERSION);
    const databaseFile = await fileDigest(databasePath);
    const blobFiles: SqliteStorageBackupFileV1[] = [];
    for (const blob of blobs) {
      blobFiles.push(await copyVerifiedFile(
        blob.sourcePath,
        join(staging, "blobs", blob.relativePath),
        blob.relativePath,
      ));
    }
    const manifest: SqliteStorageBackupManifestV1 = {
      schemaVersion: 1,
      createdAt: now.toISOString(),
      storageSchemaVersion: SQLITE_STORAGE_SCHEMA_VERSION,
      database: { ...databaseFile, relativePath: "database.sqlite" },
      blobs: blobFiles,
    };
    const manifestPath = join(staging, "manifest-v1.json");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await syncPath(manifestPath);
    await syncPath(staging);
    await options.authority.assertOwned();
    await assertAbsent(options.backupDirectory, "backupDirectory");
    await rename(staging, options.backupDirectory);
    await syncPath(parent);
    return manifest;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

export async function restoreSqliteStorageBackup(options: {
  authority: SqliteStorageAuthority;
  backupDirectory: string;
  targetDatabasePath: string;
  targetBlobRoot?: string;
}): Promise<SqliteStorageBackupManifestV1> {
  absolutePath(options.backupDirectory, "backupDirectory");
  absolutePath(options.targetDatabasePath, "targetDatabasePath");
  if (options.targetBlobRoot) absolutePath(options.targetBlobRoot, "targetBlobRoot");
  await options.authority.assertOwned();
  const manifest = parseBackupManifest(JSON.parse(
    await readFile(join(options.backupDirectory, "manifest-v1.json"), "utf8"),
  ) as unknown);
  await verifyManifestFile(options.backupDirectory, manifest.database, "SQLite backup database");
  verifyBackupDatabase(join(options.backupDirectory, manifest.database.relativePath), manifest.storageSchemaVersion);
  for (const blob of manifest.blobs) {
    await verifyManifestFile(join(options.backupDirectory, "blobs"), blob, "SQLite backup blob");
  }
  if (manifest.blobs.length > 0 && !options.targetBlobRoot) throw new Error("targetBlobRoot is required.");
  await assertAbsent(options.targetDatabasePath, "targetDatabasePath");
  if (options.targetBlobRoot) await assertAbsent(options.targetBlobRoot, "targetBlobRoot");

  const databaseParent = dirname(options.targetDatabasePath);
  const databaseStage = join(databaseParent, `.${basename(options.targetDatabasePath)}.restore-${randomUUID()}`);
  const blobStage = options.targetBlobRoot
    ? join(dirname(options.targetBlobRoot), `.${basename(options.targetBlobRoot)}.restore-${randomUUID()}`)
    : null;
  let blobPublished = false;
  await mkdir(databaseParent, { recursive: true, mode: 0o700 });
  try {
    await copyVerifiedFile(
      join(options.backupDirectory, manifest.database.relativePath),
      databaseStage,
      manifest.database.relativePath,
      manifest.database,
    );
    if (blobStage) {
      await mkdir(blobStage, { recursive: true, mode: 0o700 });
      for (const blob of manifest.blobs) {
        await copyVerifiedFile(
          join(options.backupDirectory, "blobs", blob.relativePath),
          join(blobStage, blob.relativePath),
          blob.relativePath,
          blob,
        );
      }
      await syncPath(blobStage);
    }
    await options.authority.assertOwned();
    await assertAbsent(options.targetDatabasePath, "targetDatabasePath");
    if (blobStage && options.targetBlobRoot) {
      await assertAbsent(options.targetBlobRoot, "targetBlobRoot");
      await rename(blobStage, options.targetBlobRoot);
      blobPublished = true;
      await syncPath(dirname(options.targetBlobRoot));
    }
    await rename(databaseStage, options.targetDatabasePath);
    await syncPath(databaseParent);
    return manifest;
  } catch (error) {
    await rm(databaseStage, { force: true });
    if (blobStage) await rm(blobStage, { recursive: true, force: true });
    if (blobPublished && options.targetBlobRoot) await rm(options.targetBlobRoot, { recursive: true, force: true });
    throw error;
  }
}
