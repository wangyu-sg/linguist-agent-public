import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readFile, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import {
  SqliteEventProjectionStore,
  type SqliteJsonValue,
} from "./index.js";

const AUDIT_FORMAT = "la.sqlite.audit.v1" as const;

export interface SqliteAuditExportResult {
  destinationPath: string;
  sha256: string;
  eventCount: number;
  projectionCount: number;
  recordCount: number;
}

export interface SqliteAuditVerificationResult {
  valid: true;
  sha256: string;
  eventCount: number;
  projectionCount: number;
  recordCount: number;
}

interface AuditBuildResult extends Omit<SqliteAuditExportResult, "destinationPath"> {
  bytes: Buffer;
}

type AuditRecordBody = Record<string, null | boolean | number | string>;

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: SqliteJsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function opaqueRef(kind: "stream" | "event", value: string): string {
  return `${kind}-sha256-${sha256(value)}`;
}

function appendRecord(
  lines: string[],
  body: AuditRecordBody,
  previousHash: string | null,
): string {
  const unsigned = {
    schemaVersion: 1,
    ...body,
    previousHash,
  };
  const hash = sha256(JSON.stringify(unsigned));
  lines.push(`${JSON.stringify({ ...unsigned, hash })}\n`);
  return hash;
}

function buildAudit(store: SqliteEventProjectionStore): AuditBuildResult {
  if (store.quickCheck() !== "ok") throw new Error("SQLite audit source quick_check failed.");
  const projections = store.listProjections();
  const lines: string[] = [];
  let ordinal = 0;
  let previousHash: string | null = null;
  let eventCount = 0;
  previousHash = appendRecord(lines, {
    recordType: "header",
    format: AUDIT_FORMAT,
    ordinal: ordinal++,
    databaseSchemaVersion: store.schemaVersion(),
  }, previousHash);
  for (const projection of projections) {
    const streamRef = opaqueRef("stream", projection.streamId);
    const events = store.readEvents(projection.streamId);
    for (const event of events) {
      previousHash = appendRecord(lines, {
        recordType: "event",
        ordinal: ordinal++,
        streamRef,
        sequence: event.sequence,
        eventRef: opaqueRef("event", event.id),
        eventType: event.type,
        occurredAt: event.occurredAt,
        payloadSha256: sha256(canonicalJson(event.payload)),
      }, previousHash);
      eventCount += 1;
    }
    previousHash = appendRecord(lines, {
      recordType: "projection",
      ordinal: ordinal++,
      streamRef,
      revision: projection.revision,
      eventCount: events.length,
      projectionSha256: sha256(canonicalJson(projection.value)),
    }, previousHash);
  }
  previousHash = appendRecord(lines, {
    recordType: "trailer",
    ordinal: ordinal++,
    eventCount,
    projectionCount: projections.length,
  }, previousHash);
  const bytes = Buffer.from(lines.join(""), "utf8");
  return {
    bytes,
    sha256: sha256(bytes),
    eventCount,
    projectionCount: projections.length,
    recordCount: ordinal,
  };
}

function absolutePath(value: string, label: string): string {
  if (!isAbsolute(value)) throw new Error(`${label} must be absolute.`);
  return resolve(value);
}

async function assertDestinationAbsent(path: string): Promise<void> {
  try {
    await lstat(path);
    throw new Error("destinationPath already exists.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function defaultPublish(stagingPath: string, destinationPath: string): Promise<void> {
  await link(stagingPath, destinationPath);
  await rm(stagingPath);
}

export async function exportSqliteAuditJsonl(input: {
  store: SqliteEventProjectionStore;
  destinationPath: string;
}): Promise<SqliteAuditExportResult> {
  const destinationPath = absolutePath(input.destinationPath, "destinationPath");
  const parent = dirname(destinationPath);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await assertDestinationAbsent(destinationPath);
  const stagingPath = join(parent, `.${basename(destinationPath)}.staging-${randomUUID()}`);
  const built = buildAudit(input.store);
  try {
    const handle = await open(stagingPath, "wx", 0o600);
    try {
      await handle.writeFile(built.bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await syncDirectory(parent);
    await defaultPublish(stagingPath, destinationPath);
    const published = await lstat(destinationPath);
    if (!published.isFile() || published.isSymbolicLink()) {
      throw new Error("published SQLite audit destination must be a regular file.");
    }
    await syncDirectory(parent);
    return {
      destinationPath,
      sha256: built.sha256,
      eventCount: built.eventCount,
      projectionCount: built.projectionCount,
      recordCount: built.recordCount,
    };
  } catch (error) {
    await rm(stagingPath, { force: true });
    throw error;
  }
}

export async function verifySqliteAuditJsonl(input: {
  store: SqliteEventProjectionStore;
  auditPath: string;
}): Promise<SqliteAuditVerificationResult> {
  const auditPath = absolutePath(input.auditPath, "auditPath");
  const expected = buildAudit(input.store);
  const actual = await readFile(auditPath);
  if (!actual.equals(expected.bytes)) {
    throw new Error("SQLite audit JSONL does not match the canonical SQLite snapshot.");
  }
  return {
    valid: true,
    sha256: expected.sha256,
    eventCount: expected.eventCount,
    projectionCount: expected.projectionCount,
    recordCount: expected.recordCount,
  };
}

function parseCommand(
  args: readonly string[],
): { mode: "export" | "verify"; databasePath: string; auditPath: string } {
  const mode = args[0];
  if (mode !== "export" && mode !== "verify") {
    throw new Error("SQLite audit command must be export or verify.");
  }
  const requiredAuditFlag = mode === "export" ? "--output" : "--input";
  if ((args.length - 1) % 2 !== 0) {
    throw new Error(`${mode} requires exactly --database and ${requiredAuditFlag}.`);
  }
  const values = new Map<string, string>();
  for (let index = 1; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if ((flag !== "--database" && flag !== requiredAuditFlag)
      || values.has(flag) || typeof value !== "string" || !value.trim()) {
      throw new Error(`SQLite audit command has an unknown or duplicate option ${String(flag)}.`);
    }
    values.set(flag, value);
  }
  if (args.length !== 5 || !values.has("--database") || !values.has(requiredAuditFlag)) {
    throw new Error(`${mode} requires exactly --database and ${requiredAuditFlag}.`);
  }
  return {
    mode,
    databasePath: absolutePath(values.get("--database")!, "databasePath"),
    auditPath: absolutePath(values.get(requiredAuditFlag)!, mode === "export" ? "destinationPath" : "auditPath"),
  };
}

export async function executeSqliteAuditCommand(
  args: readonly string[],
): Promise<
  | ({ mode: "export" } & SqliteAuditExportResult)
  | ({ mode: "verify" } & SqliteAuditVerificationResult)
> {
  const command = parseCommand(args);
  const store = new SqliteEventProjectionStore(command.databasePath, { readOnly: true });
  try {
    if (command.mode === "export") {
      return {
        mode: "export",
        ...await exportSqliteAuditJsonl({
          store,
          destinationPath: command.auditPath,
        }),
      };
    }
    return {
      mode: "verify",
      ...await verifySqliteAuditJsonl({
        store,
        auditPath: command.auditPath,
      }),
    };
  } finally {
    store.close();
  }
}
