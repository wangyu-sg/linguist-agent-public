import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  applyTaskRunEventPage,
  parseTaskRunEvent,
  parseTaskRunEventPage,
  parseTaskWorkspaceSnapshot,
  TASK_WORKSPACE_SCHEMA_VERSION,
  type TaskLocator,
  type TaskRunEvent,
  type TaskRunEventPage,
  type TaskWorkspaceSnapshot,
} from "@linguist-agent/cat-data";
import type {
  SqliteEventProjectionStore,
  SqliteJsonObject,
  SqliteStorageAuthority,
} from "./index.js";
import { requireMappedLegacyFields } from "./task_mapping_contract.js";

export interface LegacyTaskBackupFileV1 {
  relativePath: "snapshot.json" | "events.jsonl";
  sha256: string;
  bytes: number;
}

export interface LegacyTaskBackupManifestV1 {
  schemaVersion: 1;
  createdAt: string;
  sourceDigest: string;
  files: LegacyTaskBackupFileV1[];
}

export interface LegacyTaskImportReport {
  schemaVersion: 1;
  taskId: string;
  streamId: string;
  commandId: string;
  sourceDigest: string;
  eventCount: number;
  lastSequence: number;
  nextCursor: string;
  tornTrailingRecordIgnored: boolean;
  storedSnapshotWasCurrent: boolean;
  projectionParity: true;
  projection: SqliteJsonObject;
}

export interface ImportLegacyTaskWorkspaceInput {
  store: SqliteEventProjectionStore;
  authority: SqliteStorageAuthority;
  sourceDirectory: string;
  locator: TaskLocator;
  backupDirectory: string;
  now?: () => Date;
}

interface ReadLegacyTaskSource {
  snapshotBytes: Buffer;
  eventsBytes: Buffer;
  manifest: LegacyTaskBackupManifestV1;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertAbsolute(path: string, label: string): string {
  if (!isAbsolute(path)) throw new Error(`${label} must be absolute.`);
  return resolve(path);
}

function isInside(root: string, candidate: string): boolean {
  const candidateRelative = relative(root, candidate);
  return candidateRelative === "" || (!candidateRelative.startsWith("..") && !isAbsolute(candidateRelative));
}

async function readRegularFileWithin(root: string, name: "snapshot.json" | "events.jsonl"): Promise<Buffer> {
  const path = join(root, name);
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (name === "events.jsonl" && (error as NodeJS.ErrnoException).code === "ENOENT") return Buffer.alloc(0);
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`legacy Task ${name} must be a regular file.`);
  const canonicalPath = await realpath(path);
  if (!isInside(root, canonicalPath)) throw new Error(`legacy Task ${name} escapes sourceDirectory.`);
  return readFile(canonicalPath);
}

function sourceManifest(snapshotBytes: Buffer, eventsBytes: Buffer, now: Date): LegacyTaskBackupManifestV1 {
  const files: LegacyTaskBackupFileV1[] = [
    { relativePath: "snapshot.json", sha256: sha256(snapshotBytes), bytes: snapshotBytes.byteLength },
    { relativePath: "events.jsonl", sha256: sha256(eventsBytes), bytes: eventsBytes.byteLength },
  ];
  return {
    schemaVersion: 1,
    createdAt: now.toISOString(),
    sourceDigest: sha256(JSON.stringify(files)),
    files,
  };
}

async function readLegacyTaskSource(sourceDirectory: string, now: Date): Promise<ReadLegacyTaskSource> {
  const root = await realpath(assertAbsolute(sourceDirectory, "sourceDirectory"));
  const snapshotBytes = await readRegularFileWithin(root, "snapshot.json");
  const eventsBytes = await readRegularFileWithin(root, "events.jsonl");
  return { snapshotBytes, eventsBytes, manifest: sourceManifest(snapshotBytes, eventsBytes, now) };
}

async function writeSynced(path: string, bytes: string | Uint8Array): Promise<void> {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function publishBackup(
  backupDirectory: string,
  source: ReadLegacyTaskSource,
): Promise<void> {
  const target = assertAbsolute(backupDirectory, "backupDirectory");
  try {
    await lstat(target);
    throw new Error("backupDirectory already exists.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const staging = `${target}.staging-${process.pid}-${randomUUID()}`;
  try {
    await mkdir(staging, { mode: 0o700 });
    await writeSynced(join(staging, "snapshot.json"), source.snapshotBytes);
    await writeSynced(join(staging, "events.jsonl"), source.eventsBytes);
    await writeSynced(join(staging, "manifest-v1.json"), `${JSON.stringify(source.manifest, null, 2)}\n`);
    const stagingHandle = await open(staging, "r");
    try { await stagingHandle.sync(); } finally { await stagingHandle.close(); }
    await rename(staging, target);
    const parentHandle = await open(dirname(target), "r");
    try { await parentHandle.sync(); } finally { await parentHandle.close(); }
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

function mapped(source: "task_workspace" | "task_run_event", entity: string, value: unknown): void {
  requireMappedLegacyFields(source, entity, value);
}

function validateUsage(value: unknown): void {
  if (value !== undefined) mapped("task_workspace", "usage", value);
}

function validateScope(value: unknown): void {
  const row = value as Record<string, unknown>;
  mapped("task_workspace", row.kind === "standalone" ? "standalone_scope" : "project_scope", value);
}

function validateResourceManifest(value: unknown): void {
  if (value === undefined) return;
  mapped("task_workspace", "resource_manifest", value);
  const row = value as Record<string, unknown>;
  for (const entry of (row.packages as unknown[] | undefined) ?? []) mapped("task_workspace", "resource_package", entry);
  for (const entry of (row.conflicts as unknown[] | undefined) ?? []) mapped("task_workspace", "resource_conflict", entry);
  for (const entry of (row.resources as unknown[] | undefined) ?? []) mapped("task_workspace", "resource_selection", entry);
  if (row.requestShape !== undefined) mapped("task_workspace", "request_shape_summary", row.requestShape);
  if (row.mainSurface !== undefined) {
    mapped("task_workspace", "main_resource_surface", row.mainSurface);
    const main = row.mainSurface as Record<string, unknown>;
    mapped("task_workspace", "request_shape_manifest", main.requestShape);
  }
}

function validateRun(value: unknown): void {
  mapped("task_workspace", "run", value);
  const row = value as Record<string, unknown>;
  validateUsage(row.usage);
  for (const usage of Object.values((row.usageBySource as Record<string, unknown> | undefined) ?? {})) validateUsage(usage);
  validateResourceManifest(row.resourceManifest);
  for (const snapshot of (row.executionSnapshots as unknown[] | undefined) ?? []) mapped("task_workspace", "execution_snapshot", snapshot);
  for (const change of (row.configChanges as unknown[] | undefined) ?? []) {
    mapped("task_workspace", "config_change", change);
    const changes = (change as Record<string, unknown>).changes;
    mapped("task_workspace", "config_change_fields", changes);
    for (const entry of Object.values(changes as Record<string, unknown>)) mapped("task_workspace", "config_change_value", entry);
  }
}

function validateThread(value: unknown): void {
  mapped("task_workspace", "thread", value);
  mapped("task_workspace", "agent_identity", (value as Record<string, unknown>).identity);
}

function validateActivity(value: unknown): void {
  mapped("task_workspace", "activity", value);
  const row = value as Record<string, unknown>;
  mapped("task_workspace", "activity_actor", row.actor);
  if (row.tool !== undefined && row.tool !== null) mapped("task_workspace", "tool_activity", row.tool);
  mapped("task_workspace", "activity_refs", row.refs);
}

function validateArtifact(value: unknown): void {
  mapped("task_workspace", "artifact", value);
  const row = value as Record<string, unknown>;
  validateScope(row.scope);
  mapped("task_workspace", "artifact_provenance", row.provenance);
}

function validateDecision(value: unknown): void {
  mapped("task_workspace", "decision", value);
  const row = value as Record<string, unknown>;
  validateScope(row.scope);
  for (const option of (row.options as unknown[] | undefined) ?? []) mapped("task_workspace", "decision_option", option);
  if (row.requestProvenance !== undefined) mapped("task_workspace", "decision_request_provenance", row.requestProvenance);
}

function validateSnapshotFields(value: unknown): void {
  mapped("task_workspace", "snapshot", value);
  const row = value as Record<string, unknown>;
  mapped("task_workspace", "task", row.task);
  const task = row.task as Record<string, unknown>;
  mapped("task_workspace", "owner", task.owner);
  validateScope(task.scope);
  if (task.titleGeneration !== undefined) {
    mapped("task_workspace", "title_generation", task.titleGeneration);
    validateUsage((task.titleGeneration as Record<string, unknown>).usage);
  }
  validateUsage(row.usage);
  for (const run of row.runs as unknown[]) validateRun(run);
  for (const thread of row.agentThreads as unknown[]) validateThread(thread);
  for (const activity of row.activities as unknown[]) validateActivity(activity);
  for (const artifact of row.artifacts as unknown[]) validateArtifact(artifact);
  for (const decision of row.decisions as unknown[]) validateDecision(decision);
}

function validateEventFields(value: unknown): void {
  mapped("task_run_event", "event", value);
  const row = value as Record<string, unknown>;
  if (row.run !== undefined) validateRun(row.run);
  if (row.thread !== undefined) validateThread(row.thread);
  if (row.activity !== undefined) validateActivity(row.activity);
  if (row.artifact !== undefined) validateArtifact(row.artifact);
  if (row.decision !== undefined) validateDecision(row.decision);
  validateUsage(row.usage);
}

function parseEventPages(bytes: Buffer): {
  pages: TaskRunEventPage[];
  events: TaskRunEvent[];
  tornTrailingRecordIgnored: boolean;
} {
  const raw = bytes.toString("utf8");
  const lines = raw.split(/\r?\n/).filter((line) => line.trim());
  const pages: TaskRunEventPage[] = [];
  const events: TaskRunEvent[] = [];
  let tornTrailingRecordIgnored = false;
  for (const [index, line] of lines.entries()) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      if (index === lines.length - 1) {
        tornTrailingRecordIgnored = true;
        continue;
      }
      throw new Error(`Invalid legacy Task JSONL at line ${index + 1}: ${(error as Error).message}`);
    }
    const row = value as Record<string, unknown>;
    let page: TaskRunEventPage;
    if (row.recordType === "task_run_event_page_v1") {
      const unknown = Object.keys(row).find((field) => !["recordType", "page"].includes(field));
      if (unknown) throw new Error(`legacy Task event-page record has unknown field: ${unknown}.`);
      mapped("task_run_event", "event_page", row.page);
      page = parseTaskRunEventPage(row.page);
    } else {
      const event = parseTaskRunEvent(value, `events.jsonl[${index}]`);
      const afterCursor = events.at(-1)?.cursor ?? `${event.taskId}:0`;
      page = parseTaskRunEventPage({
        schemaVersion: TASK_WORKSPACE_SCHEMA_VERSION,
        taskId: event.taskId,
        runId: event.runId,
        afterCursor,
        nextCursor: event.cursor,
        hasMore: false,
        events: [event],
      });
    }
    for (const event of page.events) validateEventFields(event);
    pages.push(page);
    events.push(...page.events);
  }
  const ids = new Set<string>();
  const cursors = new Set<string>();
  for (const [index, event] of events.entries()) {
    if (event.seq !== index + 1) throw new Error(`legacy Task event sequence is invalid at ${event.seq}.`);
    if (ids.has(event.id)) throw new Error(`legacy Task event id ${event.id} is duplicated.`);
    if (cursors.has(event.cursor)) throw new Error(`legacy Task event cursor ${event.cursor} is duplicated.`);
    ids.add(event.id);
    cursors.add(event.cursor);
  }
  return { pages, events, tornTrailingRecordIgnored };
}

function initialProjection(snapshot: TaskWorkspaceSnapshot): TaskWorkspaceSnapshot {
  const titleUsage = snapshot.task.titleGeneration?.usage;
  return parseTaskWorkspaceSnapshot({
    schemaVersion: TASK_WORKSPACE_SCHEMA_VERSION,
    task: snapshot.task,
    activeRunId: null,
    eventCursor: `${snapshot.task.id}:0`,
    projectedAt: snapshot.task.createdAt,
    ...(titleUsage ? { usage: titleUsage } : {}),
    runs: [],
    agentThreads: [],
    activities: [],
    artifacts: [],
    decisions: [],
  });
}

function replayProjection(snapshot: TaskWorkspaceSnapshot, pages: readonly TaskRunEventPage[]): TaskWorkspaceSnapshot {
  let projection = initialProjection(snapshot);
  for (const page of pages) projection = applyTaskRunEventPage(projection, page);
  return projection;
}

function scopeMatches(snapshot: TaskWorkspaceSnapshot, locator: TaskLocator): boolean {
  return locator.kind === "standalone"
    ? snapshot.task.owner.kind === "standalone" && snapshot.task.id === locator.taskId
    : snapshot.task.owner.kind === "project"
      && snapshot.task.owner.projectId === locator.projectId
      && snapshot.task.id === locator.taskId;
}

function jsonObject(value: unknown): SqliteJsonObject {
  return JSON.parse(JSON.stringify(value)) as SqliteJsonObject;
}

export function legacyTaskStreamId(locator: TaskLocator): string {
  return `legacy-task-${sha256(JSON.stringify(locator)).slice(0, 48)}`;
}

export async function importLegacyTaskWorkspace(
  input: ImportLegacyTaskWorkspaceInput,
): Promise<LegacyTaskImportReport> {
  await input.authority.assertOwned();
  const now = input.now?.() ?? new Date();
  const source = await readLegacyTaskSource(input.sourceDirectory, now);
  await publishBackup(input.backupDirectory, source);

  const rawSnapshot: unknown = JSON.parse(source.snapshotBytes.toString("utf8"));
  validateSnapshotFields(rawSnapshot);
  const snapshot = parseTaskWorkspaceSnapshot(rawSnapshot);
  if (!scopeMatches(snapshot, input.locator)) throw new Error("legacy Task scope does not match locator.");
  const parsedEvents = parseEventPages(source.eventsBytes);
  const replayed = replayProjection(snapshot, parsedEvents.pages);
  const lastEvent = parsedEvents.events.at(-1);
  if (replayed.eventCursor !== (lastEvent?.cursor ?? `${snapshot.task.id}:0`)) {
    throw new Error("legacy Task replay cursor is inconsistent.");
  }

  await input.authority.assertOwned();
  const currentSource = await readLegacyTaskSource(input.sourceDirectory, now);
  if (currentSource.manifest.sourceDigest !== source.manifest.sourceDigest) {
    throw new Error("legacy Task source changed after backup.");
  }
  await input.authority.assertOwned();

  const streamId = legacyTaskStreamId(input.locator);
  const commandId = `legacy-import-${source.manifest.sourceDigest.slice(0, 48)}`;
  const projection = jsonObject(replayed);
  if (parsedEvents.events.length) {
    input.store.append({
      commandId,
      streamId,
      expectedRevision: 0,
      events: parsedEvents.events.map((event) => ({
        id: `legacy-event-${sha256(`${streamId}\0${event.id}`).slice(0, 48)}`,
        type: `legacy.${event.type}`,
        occurredAt: event.occurredAt,
        payload: { legacyEvent: jsonObject(event) },
      })),
      projection,
    });
  } else {
    input.store.initializeProjection({ commandId, streamId, projection });
  }
  const stored = input.store.readProjection(streamId);
  if (!stored || !isDeepStrictEqual(stored.value, projection)) throw new Error("legacy Task SQLite projection parity failed.");
  return {
    schemaVersion: 1,
    taskId: snapshot.task.id,
    streamId,
    commandId,
    sourceDigest: source.manifest.sourceDigest,
    eventCount: parsedEvents.events.length,
    lastSequence: parsedEvents.events.at(-1)?.seq ?? 0,
    nextCursor: replayed.eventCursor,
    tornTrailingRecordIgnored: parsedEvents.tornTrailingRecordIgnored,
    storedSnapshotWasCurrent: isDeepStrictEqual(snapshot, replayed),
    projectionParity: true,
    projection,
  };
}
