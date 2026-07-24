import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import {
  parseTaskRunEvent,
  parseTaskRunEventPage,
  parseTaskWorkspaceSnapshot,
} from "./task_workspace_contract.js";
import { createTaskWorkspace, type TaskRunEventDraft } from "./task_workspace.js";
import { readJsonFile, writeJsonFile } from "./workspace.js";

export const RUNTIME_DATA_SCHEMA_VERSION = 2;
const RUNTIME_DATA_SCHEMA_FILE = ".schema.json";

interface RuntimeDataManifestEntry {
  relPath: string;
  sizeBytes: number;
  sha256: string;
}

interface RuntimeDataBackupManifest {
  formatVersion: 1;
  schemaVersion: number;
  manifestHash: string;
  files: number;
  bytes: number;
  entries: RuntimeDataManifestEntry[];
}

export interface RuntimeDataSnapshot {
  manifestHash: string;
  files: number;
  bytes: number;
}

export interface RuntimeDataRollbackPlan {
  mode: "preview";
  backupId: string;
  backupPath: string;
  planHash: string;
  currentManifestHash: string;
  restoreManifestHash: string;
  files: number;
  bytes: number;
}

export interface RuntimeDataRollbackResult extends Omit<RuntimeDataRollbackPlan, "mode"> {
  mode: "execute";
}

export interface RuntimeDataBackupResult {
  backupId: string;
  backupPath: string;
  manifestHash: string;
  schemaVersion: number;
  files: number;
  bytes: number;
}

export interface RuntimeDataMigrationResult {
  status: "blocked" | "already_current" | "migrated";
  schemaVersion: typeof RUNTIME_DATA_SCHEMA_VERSION;
  blockers: string[];
  backup?: RuntimeDataBackupResult;
  sourceManifestHash?: string;
  migratedManifestHash?: string;
  legacyHomeTaskId?: string;
}

export interface RuntimeDataMigrationOptions {
  activeRuns?: number | ReadonlyArray<{ turnId?: string }>;
  beforeSwap?: (stagedRuntimeRoot: string) => Promise<void>;
  healthCheck?: (runtimeRoot: string) => Promise<void>;
  now?: () => string;
}

interface RuntimeDataSchemaMarker {
  schemaVersion: typeof RUNTIME_DATA_SCHEMA_VERSION;
  migratedAt: string;
  sourceManifestHash: string;
  backupId: string;
  legacyHomeTaskId?: string;
}

function dataRoot(runtimeRoot: string): string {
  return join(runtimeRoot, "data");
}

export function runtimeDataBackupRoot(runtimeRoot: string): string {
  return join(runtimeRoot, ".la-runtime-data-backups");
}

function backupPath(runtimeRoot: string, backupId: string): string {
  if (!/^(?:schema-\d+-to-\d+)-(?:[a-f0-9]{12}|[a-f0-9]{64})$/.test(backupId)
    && !/^legacy-task-backfill-[a-f0-9]{12}$/.test(backupId)) {
    throw new Error("Invalid runtime data backup id.");
  }
  const root = resolve(runtimeDataBackupRoot(runtimeRoot));
  const path = resolve(root, backupId);
  if (dirname(path) !== root) throw new Error("Runtime data backup path escaped its root.");
  return path;
}

async function walkFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  await walk(root);
  return files.sort();
}

async function hashFile(path: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

async function buildManifest(root: string, schemaVersion: number): Promise<RuntimeDataBackupManifest> {
  const entries: RuntimeDataManifestEntry[] = [];
  for (const path of await walkFiles(root)) {
    const info = await stat(path);
    entries.push({ relPath: relative(root, path), sizeBytes: info.size, sha256: await hashFile(path) });
  }
  const manifestHash = createHash("sha256").update(JSON.stringify(entries)).digest("hex");
  return {
    formatVersion: 1,
    schemaVersion,
    manifestHash,
    files: entries.length,
    bytes: entries.reduce((sum, entry) => sum + entry.sizeBytes, 0),
    entries,
  };
}

function jsonObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function upgradeProjectScope(value: unknown, projectId: string, label: string): Record<string, unknown> {
  const scope = jsonObject(value, label);
  if (scope.kind === "standalone") throw new Error(`${label} cannot change from standalone to project scope.`);
  if (scope.projectId !== undefined && scope.projectId !== projectId) {
    throw new Error(`${label}.projectId does not match its storage path.`);
  }
  const { projectId: _removedProjectId, ...projectScope } = scope;
  return { ...projectScope, kind: "project" };
}

function upgradeProjectEvent(value: unknown, projectId: string, label: string): Record<string, unknown> {
  const event = { ...jsonObject(value, label) };
  for (const key of ["artifact", "decision"] as const) {
    if (event[key] === undefined) continue;
    const payload = { ...jsonObject(event[key], `${label}.${key}`) };
    payload.scope = upgradeProjectScope(payload.scope, projectId, `${label}.${key}.scope`);
    event[key] = payload;
  }
  return event;
}

function upgradeProjectSnapshot(value: unknown, projectId: string, taskId: string): unknown {
  const snapshot = { ...jsonObject(value, `Task ${taskId} snapshot`) };
  if (snapshot.schemaVersion === RUNTIME_DATA_SCHEMA_VERSION) return parseTaskWorkspaceSnapshot(snapshot);
  if (snapshot.schemaVersion !== 1) throw new Error(`Task ${taskId} has unsupported schemaVersion ${String(snapshot.schemaVersion)}.`);
  const legacyTask = jsonObject(snapshot.task, `Task ${taskId}`);
  if (legacyTask.id !== taskId || legacyTask.projectId !== projectId) {
    throw new Error(`Task ${taskId} legacy scope does not match its storage path.`);
  }
  const { projectId: _removedProjectId, ...task } = legacyTask;
  snapshot.schemaVersion = RUNTIME_DATA_SCHEMA_VERSION;
  snapshot.task = {
    ...task,
    owner: { kind: "project", projectId },
    scope: upgradeProjectScope(legacyTask.scope ?? { projectId, segmentIds: [] }, projectId, `Task ${taskId}.scope`),
  };
  snapshot.artifacts = (Array.isArray(snapshot.artifacts) ? snapshot.artifacts : []).map((value, index) => {
    const artifact = { ...jsonObject(value, `Task ${taskId}.artifacts[${index}]`) };
    artifact.scope = upgradeProjectScope(artifact.scope, projectId, `Task ${taskId}.artifacts[${index}].scope`);
    return artifact;
  });
  snapshot.decisions = (Array.isArray(snapshot.decisions) ? snapshot.decisions : []).map((value, index) => {
    const decision = { ...jsonObject(value, `Task ${taskId}.decisions[${index}]`) };
    decision.scope = upgradeProjectScope(decision.scope, projectId, `Task ${taskId}.decisions[${index}].scope`);
    return decision;
  });
  return parseTaskWorkspaceSnapshot(snapshot);
}

function upgradeProjectEventRecord(value: unknown, projectId: string, label: string): unknown {
  const record = { ...jsonObject(value, label) };
  if (record.recordType === "task_run_event_page_v1") {
    const page = { ...jsonObject(record.page, `${label}.page`) };
    if (page.schemaVersion !== 1 && page.schemaVersion !== RUNTIME_DATA_SCHEMA_VERSION) {
      throw new Error(`${label}.page has unsupported schemaVersion ${String(page.schemaVersion)}.`);
    }
    page.schemaVersion = RUNTIME_DATA_SCHEMA_VERSION;
    page.events = (Array.isArray(page.events) ? page.events : []).map((event, index) =>
      upgradeProjectEvent(event, projectId, `${label}.page.events[${index}]`));
    return { ...record, page: parseTaskRunEventPage(page) };
  }
  return parseTaskRunEvent(upgradeProjectEvent(record, projectId, label), label);
}

interface DurableTaskPath {
  kind: "project" | "standalone";
  projectId?: string;
  taskId: string;
  snapshotPath: string;
  eventsPath: string;
}

async function durableTaskPaths(stagedDataRoot: string): Promise<DurableTaskPath[]> {
  const tasks: DurableTaskPath[] = [];
  for (const path of await walkFiles(stagedDataRoot)) {
    if (!path.endsWith("/snapshot.json")) continue;
    const relPath = relative(stagedDataRoot, path);
    const projectMatch = /^projects\/([^/]+)\/task_workspace\/tasks\/([^/]+)\/snapshot\.json$/.exec(relPath);
    if (projectMatch) {
      tasks.push({
        kind: "project",
        projectId: projectMatch[1],
        taskId: projectMatch[2],
        snapshotPath: path,
        eventsPath: join(dirname(path), "events.jsonl"),
      });
      continue;
    }
    const standaloneMatch = /^assistant\/tasks\/([^/]+)\/snapshot\.json$/.exec(relPath);
    if (standaloneMatch) {
      tasks.push({
        kind: "standalone",
        taskId: standaloneMatch[1],
        snapshotPath: path,
        eventsPath: join(dirname(path), "events.jsonl"),
      });
    }
  }
  return tasks.sort((left, right) => left.snapshotPath.localeCompare(right.snapshotPath));
}

async function upgradeProjectTaskFiles(stagedDataRoot: string): Promise<void> {
  for (const task of await durableTaskPaths(stagedDataRoot)) {
    if (task.kind !== "project") continue;
    const rawSnapshot = JSON.parse(await readFile(task.snapshotPath, "utf8")) as unknown;
    await writeJsonFile(task.snapshotPath, upgradeProjectSnapshot(rawSnapshot, task.projectId!, task.taskId), { durability: "critical" });
    const rawEvents = await readFile(task.eventsPath, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    const lines = rawEvents.split("\n").filter((line) => line.trim());
    const events = lines.map((line, index) => upgradeProjectEventRecord(
      JSON.parse(line) as unknown,
      task.projectId!,
      `Task ${task.taskId} events[${index}]`,
    ));
    if (lines.length) await writeFile(task.eventsPath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
  }
}

interface LegacyHomeChatRow {
  ts: string;
  kind: "user" | "assistant" | "tool" | "system" | "error";
  text: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    costUsd?: number;
    modelCalls?: number;
  };
}

function parseLegacyHomeChat(value: unknown, sourceName: string): LegacyHomeChatRow[] {
  if (!Array.isArray(value)) throw new Error(`Legacy Home ${sourceName} must contain an array.`);
  return value.map((entry, index) => {
    const row = jsonObject(entry, `Legacy Home chat[${index}]`);
    if (typeof row.ts !== "string" || !Number.isFinite(Date.parse(row.ts))) {
      throw new Error(`Legacy Home chat[${index}].ts must be an ISO timestamp.`);
    }
    if (!(["user", "assistant", "tool", "system", "error"] as unknown[]).includes(row.kind)) {
      throw new Error(`Legacy Home chat[${index}].kind is unsupported.`);
    }
    if (typeof row.text !== "string") throw new Error(`Legacy Home chat[${index}].text must be a string.`);
    const usage = row.usage === undefined ? undefined : jsonObject(row.usage, `Legacy Home chat[${index}].usage`);
    const number = (key: string): number | undefined => {
      const current = usage?.[key];
      if (current === undefined) return undefined;
      if (typeof current !== "number" || !Number.isFinite(current) || current < 0) {
        throw new Error(`Legacy Home chat[${index}].usage.${key} must be a non-negative number.`);
      }
      return current;
    };
    return {
      ts: new Date(row.ts).toISOString(),
      kind: row.kind as LegacyHomeChatRow["kind"],
      text: row.text,
      usage: usage ? {
        inputTokens: number("inputTokens"),
        outputTokens: number("outputTokens"),
        totalTokens: number("totalTokens"),
        costUsd: number("costUsd"),
        modelCalls: number("modelCalls"),
      } : undefined,
    };
  });
}

function legacyToolName(text: string): string {
  return /^tool_(?:start|end)\s+([^\s]+)/.exec(text)?.[1] ?? "legacy_tool";
}

async function legacyHomeSource(stagedDataRoot: string): Promise<{
  digest: string;
  chatRows: LegacyHomeChatRow[];
  sessionRoot: string;
  sessionFiles: string[];
} | undefined> {
  const assistantRoot = join(stagedDataRoot, "assistant");
  const chatPaths = (await Promise.all(["home_chat.json", "chat.json"].map(async (name) => {
    const path = join(assistantRoot, name);
    return await stat(path).catch(() => undefined) ? path : undefined;
  }))).filter((path): path is string => Boolean(path));
  const sessionRoot = join(assistantRoot, "_pi_sessions");
  const sessionFiles = (await walkFiles(sessionRoot)).filter((path) => path.endsWith(".jsonl"));
  if (!chatPaths.length && !sessionFiles.length) return undefined;
  const chatGroups = await Promise.all(chatPaths.map(async (path) =>
    parseLegacyHomeChat(JSON.parse(await readFile(path, "utf8")) as unknown, relative(assistantRoot, path))));
  const chatRows = chatGroups
    .flat()
    .sort((left, right) => left.ts.localeCompare(right.ts));
  const sourceFiles = [...chatPaths, ...sessionFiles].sort();
  const hash = createHash("sha256");
  for (const path of sourceFiles) hash.update(relative(assistantRoot, path)).update("\0").update(await hashFile(path)).update("\0");
  return { digest: hash.digest("hex"), chatRows, sessionRoot, sessionFiles };
}

async function importLegacyHomeTask(stagedRuntimeRoot: string, migratedAt: string): Promise<string | undefined> {
  const stagedDataRoot = dataRoot(stagedRuntimeRoot);
  const source = await legacyHomeSource(stagedDataRoot);
  if (!source) return undefined;
  const taskId = `legacy-home-${source.digest.slice(0, 24)}`;
  const workspace = createTaskWorkspace(stagedRuntimeRoot, { now: () => source.chatRows[0]?.ts ?? migratedAt });
  const locator = { kind: "standalone" as const, taskId };
  const migrationPath = join(stagedDataRoot, "assistant", "tasks", taskId, "migration.json");
  try {
    const existing = await workspace.open(locator);
    const marker = await readJsonFile<{ sourceDigest?: string }>(migrationPath, {});
    if (existing.task.intent.includes(source.digest) && marker.sourceDigest === source.digest) return taskId;
    throw new Error(`Standalone migration Task ${taskId} conflicts with legacy Home source ${source.digest}.`);
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "TaskWorkspaceNotFoundError") throw error;
  }

  const startedAt = source.chatRows[0]?.ts ?? migratedAt;
  const completedAt = source.chatRows.at(-1)?.ts ?? startedAt;
  await workspace.create({
    owner: { kind: "standalone" },
    taskId,
    title: `历史 Home 对话 · ${startedAt.slice(0, 10)}`,
    intent: `Read-only historical Chat imported from legacy Home. source=${source.digest}`,
    kind: "general",
  });
  const runId = `${taskId}.run`;
  const threadId = `${runId}.main`;
  const rows = source.chatRows.length ? source.chatRows : [{
    ts: startedAt,
    kind: "system" as const,
    text: "Legacy Home Pi session retained as internal recovery history; no user-visible chat rows were available.",
  }];
  const usage = source.chatRows.reduce((total, row) => ({
    inputTokens: total.inputTokens + (row.usage?.inputTokens ?? 0),
    outputTokens: total.outputTokens + (row.usage?.outputTokens ?? 0),
    totalTokens: total.totalTokens + (row.usage?.totalTokens ?? 0),
    costUSD: total.costUSD + (row.usage?.costUsd ?? 0),
    modelCalls: total.modelCalls + (row.usage?.modelCalls ?? 0),
  }), { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUSD: 0, modelCalls: 0 });
  const events: TaskRunEventDraft[] = [
    {
      type: "run_upsert",
      agentThreadId: threadId,
      occurredAt: startedAt,
      run: {
        id: runId,
        taskId,
        mode: "single",
        status: "complete",
        rootAgentThreadId: threadId,
        startedAt,
        updatedAt: completedAt,
        completedAt,
        stopAvailable: false,
        resumeAvailable: false,
      },
    },
    {
      type: "thread_upsert",
      agentThreadId: threadId,
      occurredAt: startedAt,
      thread: {
        id: threadId,
        taskId,
        runId,
        parentThreadId: null,
        identity: {
          kind: "main",
          roleId: "linguist-agent",
          displayName: "Linguist Agent",
          roleLabel: "Historical Home Agent",
          disclosureLabel: "Agent",
        },
        status: "complete",
        canReceiveUserMessage: false,
        handoffSummary: "Imported read-only from legacy Home.",
        latestActivityId: `${runId}.activity.${rows.length}`,
        childThreadIds: [],
        createdAt: startedAt,
        updatedAt: completedAt,
      },
    },
    ...rows.map((row, index): TaskRunEventDraft => {
      const activityId = `${runId}.activity.${index + 1}`;
      const actor = row.kind === "user"
        ? { kind: "human" as const, id: "user", displayName: "You", agentThreadId: threadId }
        : row.kind === "system" || row.kind === "error"
          ? { kind: "system" as const, id: "legacy-home", displayName: "Legacy Home", agentThreadId: threadId }
          : { kind: "agent" as const, id: "linguist-agent", displayName: "Linguist Agent", agentThreadId: threadId };
      return {
        type: "activity_append",
        agentThreadId: threadId,
        occurredAt: row.ts,
        activity: {
          id: activityId,
          taskId,
          runId,
          agentThreadId: threadId,
          seq: index + 1,
          type: row.kind === "user" ? "message"
            : row.kind === "assistant" ? "final_response"
              : row.kind === "tool" ? "tool_action"
                : row.kind === "error" ? "error"
                  : "acknowledgement",
          status: row.kind === "error" ? "error" : "done",
          actor,
          title: row.kind === "user" ? "You" : row.kind === "assistant" ? "Linguist Agent" : row.kind === "tool" ? legacyToolName(row.text) : "Legacy Home",
          body: row.text.trim() || "(empty legacy message)",
          tool: row.kind === "tool" ? { name: legacyToolName(row.text), effect: "execute", outcome: "historical" } : null,
          refs: { artifactIds: [], evidenceRefs: [], decisionIds: [] },
          createdAt: row.ts,
          updatedAt: row.ts,
        },
      };
    }),
    ...(Object.values(usage).some((value) => value > 0) ? [{
      type: "usage_update" as const,
      agentThreadId: threadId,
      occurredAt: completedAt,
      usageSource: "main",
      usage,
    }] : []),
  ];
  await workspace.appendGenerated({ ...locator, runId, events });
  await workspace.archive(locator);
  if (source.sessionFiles.length) {
    await cp(source.sessionRoot, join(stagedDataRoot, "assistant", "tasks", taskId, "_pi_sessions"), { recursive: true });
  }
  await writeJsonFile(migrationPath, {
    formatVersion: 1,
    sourceKind: "legacy_home",
    sourceDigest: source.digest,
    importedAt: migratedAt,
  }, { durability: "critical" });
  return taskId;
}

function hashPlan(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function readRuntimeDataSchemaMarker(runtimeRoot: string): Promise<RuntimeDataSchemaMarker | undefined> {
  const marker = await readJsonFile<RuntimeDataSchemaMarker | undefined>(
    join(dataRoot(runtimeRoot), RUNTIME_DATA_SCHEMA_FILE),
    undefined,
  );
  if (!marker) return undefined;
  if (marker.schemaVersion !== RUNTIME_DATA_SCHEMA_VERSION) {
    throw new Error(`Unsupported runtime data schema version ${String(marker.schemaVersion)}.`);
  }
  return marker;
}

export async function readRuntimeDataSchemaVersion(runtimeRoot: string): Promise<number> {
  return (await readRuntimeDataSchemaMarker(runtimeRoot))?.schemaVersion ?? 1;
}

export async function verifyRuntimeDataSchemaV2(runtimeRoot: string): Promise<void> {
  const marker = await readRuntimeDataSchemaMarker(runtimeRoot);
  if (!marker) throw new Error("Runtime data schema v2 marker is missing.");
  const workspace = createTaskWorkspace(runtimeRoot);
  for (const task of await durableTaskPaths(dataRoot(runtimeRoot))) {
    if (task.kind === "project") {
      await workspace.open({ kind: "project", projectId: task.projectId!, taskId: task.taskId });
    } else {
      await workspace.open({ kind: "standalone", taskId: task.taskId });
    }
  }
}

export async function migrateRuntimeDataSchemaV2(
  runtimeRootInput: string,
  options: RuntimeDataMigrationOptions = {},
): Promise<RuntimeDataMigrationResult> {
  const runtimeRoot = resolve(runtimeRootInput);
  const activeRuns = typeof options.activeRuns === "number" ? options.activeRuns : options.activeRuns?.length ?? 0;
  if (activeRuns > 0) {
    const runIds = Array.isArray(options.activeRuns)
      ? options.activeRuns.flatMap((run) => run.turnId ? [run.turnId] : [])
      : [];
    return {
      status: "blocked",
      schemaVersion: RUNTIME_DATA_SCHEMA_VERSION,
      blockers: [runIds.length
        ? `Runtime data migration is blocked by active Runs: ${runIds.join(", ")}.`
        : `Runtime data migration is blocked by ${activeRuns} active Run(s).`],
    };
  }

  const existingMarker = await readRuntimeDataSchemaMarker(runtimeRoot);
  if (existingMarker) {
    await verifyRuntimeDataSchemaV2(runtimeRoot);
    const current = await buildManifest(dataRoot(runtimeRoot), RUNTIME_DATA_SCHEMA_VERSION);
    return {
      status: "already_current",
      schemaVersion: RUNTIME_DATA_SCHEMA_VERSION,
      blockers: [],
      sourceManifestHash: existingMarker.sourceManifestHash,
      migratedManifestHash: current.manifestHash,
      legacyHomeTaskId: existingMarker.legacyHomeTaskId,
    };
  }

  const sourceManifest = await buildManifest(dataRoot(runtimeRoot), 1);
  const backupId = `schema-1-to-2-${sourceManifest.manifestHash}`;
  const verifiedBackupPath = backupPath(runtimeRoot, backupId);
  await ensureBackup(runtimeRoot, {
    backupPath: verifiedBackupPath,
    manifestHash: sourceManifest.manifestHash,
    schemaVersion: 1,
  });
  const backup: RuntimeDataBackupResult = {
    backupId,
    backupPath: verifiedBackupPath,
    manifestHash: sourceManifest.manifestHash,
    schemaVersion: 1,
    files: sourceManifest.files,
    bytes: sourceManifest.bytes,
  };

  const suffix = `${process.pid}-${Date.now()}`;
  const stagedRuntimeRoot = join(runtimeRoot, `.la-runtime-data-schema-2-${suffix}`);
  const stagedData = dataRoot(stagedRuntimeRoot);
  const currentData = dataRoot(runtimeRoot);
  const previousData = join(runtimeRoot, `.la-runtime-data-schema-1-${suffix}`);
  const migratedAt = options.now?.() ?? new Date().toISOString();
  const currentExists = Boolean(await stat(currentData).catch(() => undefined));
  let movedCurrent = false;
  let installedStaged = false;
  try {
    await rm(stagedRuntimeRoot, { recursive: true, force: true });
    await mkdir(stagedRuntimeRoot, { recursive: true, mode: 0o700 });
    if (currentExists) await cp(currentData, stagedData, { recursive: true, errorOnExist: true });
    else await mkdir(stagedData, { recursive: true, mode: 0o700 });
    await upgradeProjectTaskFiles(stagedData);
    const legacyHomeTaskId = await importLegacyHomeTask(stagedRuntimeRoot, migratedAt);
    const marker: RuntimeDataSchemaMarker = {
      schemaVersion: RUNTIME_DATA_SCHEMA_VERSION,
      migratedAt,
      sourceManifestHash: sourceManifest.manifestHash,
      backupId,
      ...(legacyHomeTaskId ? { legacyHomeTaskId } : {}),
    };
    await writeJsonFile(join(stagedData, RUNTIME_DATA_SCHEMA_FILE), marker, { durability: "critical" });
    await verifyRuntimeDataSchemaV2(stagedRuntimeRoot);
    const migratedManifest = await buildManifest(stagedData, RUNTIME_DATA_SCHEMA_VERSION);
    await options.beforeSwap?.(stagedRuntimeRoot);

    if (currentExists) {
      await rename(currentData, previousData);
      movedCurrent = true;
    }
    try {
      await rename(stagedData, currentData);
      installedStaged = true;
      await (options.healthCheck ?? verifyRuntimeDataSchemaV2)(runtimeRoot);
    } catch (error) {
      if (installedStaged) await rm(currentData, { recursive: true, force: true });
      if (movedCurrent) await rename(previousData, currentData);
      movedCurrent = false;
      throw error;
    }
    if (movedCurrent) await rm(previousData, { recursive: true, force: true });
    movedCurrent = false;
    return {
      status: "migrated",
      schemaVersion: RUNTIME_DATA_SCHEMA_VERSION,
      blockers: [],
      backup,
      sourceManifestHash: sourceManifest.manifestHash,
      migratedManifestHash: migratedManifest.manifestHash,
      legacyHomeTaskId,
    };
  } finally {
    if (movedCurrent) {
      await rm(currentData, { recursive: true, force: true }).catch(() => undefined);
      await rename(previousData, currentData).catch(() => undefined);
    }
    await rm(stagedRuntimeRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function previewRuntimeDataSnapshot(runtimeRoot: string): Promise<RuntimeDataSnapshot> {
  const manifest = await buildManifest(dataRoot(runtimeRoot), RUNTIME_DATA_SCHEMA_VERSION);
  return { manifestHash: manifest.manifestHash, files: manifest.files, bytes: manifest.bytes };
}

async function ensureBackup(runtimeRoot: string, input: {
  backupPath: string;
  manifestHash: string;
  schemaVersion: number;
}): Promise<void> {
  const path = input.backupPath;
  const manifestPath = join(path, "manifest.json");
  const existing = await readJsonFile<RuntimeDataBackupManifest | undefined>(manifestPath, undefined);
  if (existing) {
    if (existing.manifestHash !== input.manifestHash) throw new Error("Existing runtime data backup does not match the migration plan.");
    await chmod(runtimeDataBackupRoot(runtimeRoot), 0o700);
    await chmod(path, 0o700);
    return;
  }
  await rm(path, { recursive: true, force: true });
  await mkdir(path, { recursive: true });
  await chmod(runtimeDataBackupRoot(runtimeRoot), 0o700);
  await chmod(path, 0o700);
  const source = dataRoot(runtimeRoot);
  const sourceInfo = await stat(source).catch(() => undefined);
  if (sourceInfo?.isDirectory()) await cp(source, join(path, "data"), { recursive: true, errorOnExist: true });
  else await mkdir(join(path, "data"), { recursive: true });
  const copied = await buildManifest(join(path, "data"), input.schemaVersion);
  if (copied.manifestHash !== input.manifestHash) {
    await rm(path, { recursive: true, force: true });
    throw new Error("Runtime data backup verification failed.");
  }
  await writeJsonFile(manifestPath, copied, { durability: "critical" });
}

/**
 * Create or reuse a verified full-data snapshot for an explicit durable-data
 * operation. Callers never select paths: the complete runtime data root is the
 * rollback unit, and the manifest hash makes repeated calls idempotent.
 */
export async function createVerifiedRuntimeDataBackup(
  runtimeRoot: string,
): Promise<RuntimeDataBackupResult> {
  const schemaVersion = RUNTIME_DATA_SCHEMA_VERSION;
  const manifest = await buildManifest(dataRoot(runtimeRoot), schemaVersion);
  const backupId = `legacy-task-backfill-${manifest.manifestHash.slice(0, 12)}`;
  const path = backupPath(runtimeRoot, backupId);
  await ensureBackup(runtimeRoot, {
    backupPath: path,
    manifestHash: manifest.manifestHash,
    schemaVersion,
  });
  return {
    backupId,
    backupPath: path,
    manifestHash: manifest.manifestHash,
    schemaVersion,
    files: manifest.files,
    bytes: manifest.bytes,
  };
}

async function readBackupManifest(runtimeRoot: string, backupId: string): Promise<{ path: string; manifest: RuntimeDataBackupManifest }> {
  const path = backupPath(runtimeRoot, backupId);
  const manifest = await readJsonFile<RuntimeDataBackupManifest | undefined>(join(path, "manifest.json"), undefined);
  if (!manifest) throw new Error("Runtime data backup manifest not found.");
  const actual = await buildManifest(join(path, "data"), manifest.schemaVersion);
  if (actual.manifestHash !== manifest.manifestHash) throw new Error("Runtime data backup verification failed.");
  return { path, manifest };
}

export async function previewRuntimeDataRollback(runtimeRoot: string, backupId: string): Promise<RuntimeDataRollbackPlan> {
  const backup = await readBackupManifest(runtimeRoot, backupId);
  const current = await buildManifest(dataRoot(runtimeRoot), RUNTIME_DATA_SCHEMA_VERSION);
  const value = {
    backupId,
    currentManifestHash: current.manifestHash,
    restoreManifestHash: backup.manifest.manifestHash,
  };
  return {
    mode: "preview",
    ...value,
    backupPath: backup.path,
    planHash: hashPlan(value),
    files: backup.manifest.files,
    bytes: backup.manifest.bytes,
  };
}

export async function executeRuntimeDataRollback(runtimeRoot: string, input: { backupId: string; planHash: string }): Promise<RuntimeDataRollbackResult> {
  const plan = await previewRuntimeDataRollback(runtimeRoot, input.backupId);
  if (plan.planHash !== input.planHash) throw new Error("Runtime data rollback plan changed; preview again before executing.");

  const suffix = `${process.pid}-${Date.now()}`;
  const staged = join(runtimeRoot, `.la-runtime-data-restore-${suffix}`);
  const previous = join(runtimeRoot, `.la-runtime-data-previous-${suffix}`);
  const current = dataRoot(runtimeRoot);
  await rm(staged, { recursive: true, force: true });
  await cp(join(plan.backupPath, "data"), staged, { recursive: true, errorOnExist: true });
  await chmod(staged, 0o700);
  const stagedManifest = await buildManifest(staged, RUNTIME_DATA_SCHEMA_VERSION);
  if (stagedManifest.manifestHash !== plan.restoreManifestHash) {
    await rm(staged, { recursive: true, force: true });
    throw new Error("Runtime data rollback staging verification failed.");
  }

  const currentExists = Boolean(await stat(current).catch(() => undefined));
  try {
    if (currentExists) await rename(current, previous);
    await rename(staged, current);
    const restored = await buildManifest(current, RUNTIME_DATA_SCHEMA_VERSION);
    if (restored.manifestHash !== plan.restoreManifestHash) throw new Error("Runtime data rollback verification failed.");
    await rm(previous, { recursive: true, force: true });
  } catch (error) {
    await rm(current, { recursive: true, force: true }).catch(() => undefined);
    if (currentExists) await rename(previous, current).catch(() => undefined);
    await rm(staged, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  return { ...plan, mode: "execute" };
}
