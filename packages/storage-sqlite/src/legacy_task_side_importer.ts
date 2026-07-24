import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  parseTaskMessageQueue,
  parseTaskWorkspaceSnapshot,
  type TaskLocator,
  type TaskMessageQueue,
  type TaskWorkspaceSnapshot,
} from "@linguist-agent/cat-data";
import {
  SqliteEventProjectionStore,
  type SqliteJsonObject,
  type SqliteStorageAuthority,
} from "./index.js";
import {
  legacyTaskStreamId,
} from "./legacy_task_importer.js";
import { requireMappedLegacyFields } from "./task_mapping_contract.js";

export interface ImportLegacyTaskSideStateInput {
  store: SqliteEventProjectionStore;
  authority: SqliteStorageAuthority;
  locator: TaskLocator;
  taskSourceDirectory: string;
  qualityDecisionLedgerPath?: string;
  backupDirectory: string;
}

export interface LegacyTaskSideImportReport {
  taskId: string;
  sourceDigest: string;
  taskDecisionCount: number;
  qualityDecisionCount: number;
  queueMessageCount: number;
  queueMessageIds: string[];
  resourceProfileRevision: number;
  resourceProfileHash: string;
  projectionParity: true;
  commandIds: string[];
}

interface SourceFile {
  name: string;
  path: string;
  required: boolean;
  bytes?: Buffer;
}

interface QualityDecisionEvent extends SqliteJsonObject {
  projectId: string;
  schemaVersion: 1;
  sequence: number;
  hash: string;
}

interface ResourceProfile extends SqliteJsonObject {
  schemaVersion: 1;
  taskId: string;
  revision: number;
  selections: SqliteJsonObject[];
  executableApprovals: SqliteJsonObject[];
  updatedAt: string;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function jsonObject(value: unknown): SqliteJsonObject {
  return JSON.parse(JSON.stringify(value)) as SqliteJsonObject;
}

function exactMapped(source: Parameters<typeof requireMappedLegacyFields>[0], entity: string, value: unknown): void {
  requireMappedLegacyFields(source, entity, value);
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

function timestamp(value: unknown, label: string): string {
  const result = text(value, label);
  if (!Number.isFinite(Date.parse(result))) throw new Error(`${label} must be an ISO timestamp.`);
  return result;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${label} must be a non-negative integer.`);
  return value as number;
}

function parseQualityEvents(bytes: Buffer | undefined, locator: TaskLocator): QualityDecisionEvent[] {
  if (!bytes) return [];
  if (locator.kind !== "project") throw new Error("Standalone Task side import cannot include a Project quality decision ledger.");
  const events: QualityDecisionEvent[] = [];
  for (const [index, line] of bytes.toString("utf8").split(/\r?\n/u).filter(Boolean).entries()) {
    const raw = JSON.parse(line) as unknown;
    exactMapped("quality_decision_ledger", "event", raw);
    const row = object(raw, `quality decision event ${index + 1}`);
    if (row.schemaVersion !== 1 || row.sequence !== index + 1) {
      throw new Error(`quality decision ledger sequence is invalid at line ${index + 1}.`);
    }
    if (row.projectId !== locator.projectId) throw new Error("quality decision ledger belongs to another Project.");
    const previous = events.at(-1);
    if ((index === 0 && row.previousHash !== undefined)
      || (index > 0 && row.previousHash !== previous?.hash)) {
      throw new Error("quality decision ledger hash chain is broken.");
    }
    const { hash, ...withoutHash } = row;
    if (typeof hash !== "string" || hash !== sha256(JSON.stringify(withoutHash))) {
      throw new Error("quality decision ledger hash is invalid.");
    }
    events.push(jsonObject(row) as QualityDecisionEvent);
  }
  return events;
}

function parseQueue(bytes: Buffer | undefined, taskId: string): TaskMessageQueue | null {
  if (!bytes) return null;
  const raw = JSON.parse(bytes.toString("utf8")) as unknown;
  exactMapped("task_message_queue", "queue", raw);
  const row = object(raw, "Task message queue");
  if (!Array.isArray(row.messages)) throw new Error("Task message queue messages must be an array.");
  row.messages.forEach((message) => exactMapped("task_message_queue", "message", message));
  return parseTaskMessageQueue(raw, taskId);
}

function sortedSelections(rows: SqliteJsonObject[]): SqliteJsonObject[] {
  return [...rows].sort((left, right) =>
    [left.packageSource, left.resourceType, left.resourceId].join("\0")
      .localeCompare([right.packageSource, right.resourceType, right.resourceId].join("\0")));
}

function sortedApprovals(rows: SqliteJsonObject[]): SqliteJsonObject[] {
  return [...rows].sort((left, right) =>
    [left.packageSource, left.version, left.integrity].join("\0")
      .localeCompare([right.packageSource, right.version, right.integrity].join("\0")));
}

function dedupeSelections(rows: SqliteJsonObject[]): SqliteJsonObject[] {
  const unique = new Map<string, SqliteJsonObject>();
  for (const row of rows) {
    unique.set([row.packageSource, row.resourceType, row.resourceId].join("\0"), row);
  }
  return sortedSelections([...unique.values()]);
}

function dedupeApprovals(rows: SqliteJsonObject[]): SqliteJsonObject[] {
  const unique = new Map<string, SqliteJsonObject>();
  for (const row of rows) {
    unique.set([row.packageSource, row.version, row.integrity].join("\0"), row);
  }
  return sortedApprovals([...unique.values()]);
}

function parseResourceProfile(bytes: Buffer | undefined, taskId: string): ResourceProfile | null {
  if (!bytes) return null;
  const raw = JSON.parse(bytes.toString("utf8")) as unknown;
  exactMapped("task_package_profile", "profile", raw);
  const row = object(raw, "Task Package profile");
  if (row.schemaVersion !== 1 || row.taskId !== taskId) throw new Error("Task Package profile scope or schema is invalid.");
  if (!Array.isArray(row.selections) || !Array.isArray(row.executableApprovals)) {
    throw new Error("Task Package profile selections and approvals must be arrays.");
  }
  const selections = row.selections.map((value, index) => {
    exactMapped("task_package_profile", "selection", value);
    const selection = object(value, `selection ${index}`);
    const packageSource = text(selection.packageSource, `selection ${index}.packageSource`);
    if (!["extension", "skill", "prompt"].includes(String(selection.resourceType))) {
      throw new Error(`selection ${index}.resourceType is invalid.`);
    }
    const resourceId = text(selection.resourceId, `selection ${index}.resourceId`);
    if (typeof selection.enabled !== "boolean") throw new Error(`selection ${index}.enabled must be boolean.`);
    return {
      packageSource,
      resourceType: selection.resourceType as string,
      resourceId,
      enabled: selection.enabled,
    };
  });
  const approvals = row.executableApprovals.map((value, index) => {
    exactMapped("task_package_profile", "executable_approval", value);
    const approval = object(value, `approval ${index}`);
    return {
      packageSource: text(approval.packageSource, `approval ${index}.packageSource`),
      version: text(approval.version, `approval ${index}.version`),
      integrity: text(approval.integrity, `approval ${index}.integrity`),
      approvedAt: timestamp(approval.approvedAt, `approval ${index}.approvedAt`),
    };
  });
  return {
    schemaVersion: 1,
    taskId,
    revision: nonNegativeInteger(row.revision, "profile.revision"),
    selections: dedupeSelections(selections),
    executableApprovals: dedupeApprovals(approvals),
    updatedAt: timestamp(row.updatedAt, "profile.updatedAt"),
  };
}

function resourceProfileHash(profile: ResourceProfile | null): string {
  if (!profile) return "absent";
  return `sha256-${createHash("sha256").update(JSON.stringify({
    schemaVersion: profile.schemaVersion,
    taskId: profile.taskId,
    revision: profile.revision,
    selections: sortedSelections(profile.selections),
    executableApprovals: sortedApprovals(profile.executableApprovals),
  })).digest("base64")}`;
}

function sourceDigest(files: readonly SourceFile[]): string {
  const hash = createHash("sha256");
  for (const file of files.filter((candidate) => candidate.bytes).sort((left, right) => left.name.localeCompare(right.name))) {
    hash.update(file.name).update("\0").update(file.bytes!).update("\0");
  }
  return hash.digest("hex");
}

async function readSources(input: ImportLegacyTaskSideStateInput): Promise<SourceFile[]> {
  const files: SourceFile[] = [
    { name: "snapshot.json", path: join(input.taskSourceDirectory, "snapshot.json"), required: true },
    { name: "message_queue.json", path: join(input.taskSourceDirectory, "message_queue.json"), required: false },
    { name: "resource-profile.json", path: join(input.taskSourceDirectory, "resource-profile.json"), required: false },
    ...(input.qualityDecisionLedgerPath
      ? [{ name: "quality_decision_ledger.jsonl", path: input.qualityDecisionLedgerPath, required: false }]
      : []),
  ];
  for (const file of files) {
    try {
      file.bytes = await readFile(file.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || file.required) throw error;
    }
  }
  return files;
}

async function publishBackup(files: readonly SourceFile[], directory: string, digest: string): Promise<void> {
  const parent = dirname(directory);
  const staging = join(parent, `.${basename(directory)}.staging-${randomUUID()}`);
  await mkdir(parent, { recursive: true });
  await mkdir(staging);
  try {
    for (const file of files) {
      if (file.bytes) await writeFile(join(staging, file.name), file.bytes, { flag: "wx" });
    }
    await writeFile(join(staging, "manifest-v1.json"), `${JSON.stringify({
      schemaVersion: 1,
      sourceDigest: digest,
      files: files.filter((file) => file.bytes).map((file) => ({
        name: file.name,
        bytes: file.bytes!.byteLength,
        sha256: sha256(file.bytes!),
      })),
    }, null, 2)}\n`, { flag: "wx" });
    await rename(staging, directory);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

export function legacyTaskSideStreamIds(locator: TaskLocator): {
  qualityDecisions: string;
  messageQueue: string;
  resourceProfile: string;
} {
  const suffix = sha256(JSON.stringify(locator)).slice(0, 48);
  const qualitySuffix = locator.kind === "project"
    ? sha256(JSON.stringify({ kind: "project", projectId: locator.projectId })).slice(0, 48)
    : suffix;
  return {
    qualityDecisions: `legacy-quality-${qualitySuffix}`,
    messageQueue: `legacy-queue-${suffix}`,
    resourceProfile: `legacy-resource-${suffix}`,
  };
}

export async function importLegacyTaskSideState(
  input: ImportLegacyTaskSideStateInput,
): Promise<LegacyTaskSideImportReport> {
  await input.authority.assertOwned();
  if (!input.store.readProjection(legacyTaskStreamId(input.locator))) {
    throw new Error("Task aggregate must be imported first.");
  }
  const files = await readSources(input);
  const digest = sourceDigest(files);
  await publishBackup(files, input.backupDirectory, digest);

  const snapshotRaw = JSON.parse(files.find((file) => file.name === "snapshot.json")!.bytes!.toString("utf8")) as unknown;
  exactMapped("task_workspace", "snapshot", snapshotRaw);
  const snapshot: TaskWorkspaceSnapshot = parseTaskWorkspaceSnapshot(snapshotRaw);
  if (snapshot.task.id !== input.locator.taskId) throw new Error("Task side source belongs to another Task.");
  for (const decision of snapshot.decisions) {
    exactMapped("task_workspace", "decision", decision);
    decision.options.forEach((option) => exactMapped("task_workspace", "decision_option", option));
    if (decision.requestProvenance) {
      exactMapped("task_workspace", "decision_request_provenance", decision.requestProvenance);
    }
  }
  const storedTask = input.store.readProjection(legacyTaskStreamId(input.locator));
  const storedSnapshot = storedTask ? parseTaskWorkspaceSnapshot(storedTask.value) : null;
  if (!storedSnapshot || JSON.stringify(storedSnapshot.decisions) !== JSON.stringify(snapshot.decisions)) {
    throw new Error("Imported Task Decision projection does not match the legacy source.");
  }

  const importsProjectQualityLedger = input.qualityDecisionLedgerPath !== undefined;
  const quality = importsProjectQualityLedger
    ? parseQualityEvents(
      files.find((file) => file.name === "quality_decision_ledger.jsonl")?.bytes,
      input.locator,
    )
    : [];
  const queue = parseQueue(
    files.find((file) => file.name === "message_queue.json")?.bytes,
    input.locator.taskId,
  );
  const profile = parseResourceProfile(
    files.find((file) => file.name === "resource-profile.json")?.bytes,
    input.locator.taskId,
  );
  if (sourceDigest(await readSources(input)) !== digest) throw new Error("Task side source changed after backup.");
  await input.authority.assertOwned();

  const streamIds = legacyTaskSideStreamIds(input.locator);
  const commandIds = {
    quality: `side-quality-${digest}`,
    queue: `side-queue-${digest}`,
    profile: `side-profile-${digest}`,
  };
  const qualityProjection = jsonObject({ events: quality });
  if (importsProjectQualityLedger) {
    if (quality.length) {
      input.store.append({
        commandId: commandIds.quality,
        streamId: streamIds.qualityDecisions,
        expectedRevision: 0,
        events: quality.map((event) => ({
          id: `quality-${event.hash}`,
          type: "quality_decision",
          occurredAt: text(event.recordedAt, "quality decision recordedAt"),
          payload: { legacyEvent: event },
        })),
        projection: qualityProjection,
      });
    } else {
      input.store.initializeProjection({
        commandId: commandIds.quality,
        streamId: streamIds.qualityDecisions,
        projection: qualityProjection,
      });
    }
  }
  await input.authority.assertOwned();
  input.store.initializeProjection({
    commandId: commandIds.queue,
    streamId: streamIds.messageQueue,
    projection: jsonObject(queue === null ? { present: false } : queue),
  });
  await input.authority.assertOwned();
  input.store.initializeProjection({
    commandId: commandIds.profile,
    streamId: streamIds.resourceProfile,
    projection: jsonObject(profile === null ? { present: false } : profile),
  });

  const storedQuality = input.store.readProjection(streamIds.qualityDecisions)?.value;
  const storedQueue = input.store.readProjection(streamIds.messageQueue)?.value;
  const storedProfile = input.store.readProjection(streamIds.resourceProfile)?.value;
  if ((importsProjectQualityLedger
    ? JSON.stringify(storedQuality) !== JSON.stringify(qualityProjection)
    : storedQuality !== undefined)
    || JSON.stringify(storedQueue) !== JSON.stringify(queue === null ? { present: false } : jsonObject(queue))
    || JSON.stringify(storedProfile) !== JSON.stringify(profile === null ? { present: false } : jsonObject(profile))) {
    throw new Error("Task side SQLite projection parity failed.");
  }

  return {
    taskId: input.locator.taskId,
    sourceDigest: digest,
    taskDecisionCount: snapshot.decisions.length,
    qualityDecisionCount: quality.length,
    queueMessageCount: queue?.messages.length ?? 0,
    queueMessageIds: queue?.messages.map((message) => message.id) ?? [],
    resourceProfileRevision: profile?.revision ?? 0,
    resourceProfileHash: resourceProfileHash(profile),
    projectionParity: true,
    commandIds: [
      ...(importsProjectQualityLedger ? [commandIds.quality] : []),
      commandIds.queue,
      commandIds.profile,
    ],
  };
}
