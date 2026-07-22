import { randomUUID } from "node:crypto";
import { appendFile, mkdir, open as openFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  applyTaskRunEventPage,
  parseTaskRunEvent,
  parseTaskRunEventPage,
  parseTaskWorkspaceSnapshot,
  TASK_WORKSPACE_SCHEMA_VERSION,
  type TaskKind,
  type TaskLocator,
  type TaskOwner,
  type TaskArtifact,
  type TaskDecision,
  type TaskRecord,
  type TaskRun,
  type TaskRunStatus,
  type TaskStatus,
  type TaskTitleGeneration,
  type TaskRunEvent,
  type TaskRunEventPage,
  type TaskWorkspaceSnapshot,
} from "./task_workspace_contract.js";
import { readJsonFile, readJsonlFile, writeJsonFile } from "./workspace.js";

interface CreateTaskWorkspaceBase {
  taskId?: string;
  title: string;
  intent: string;
  kind: TaskKind;
  initialMessage?: string;
  initialEvidenceRefs?: string[];
  autoTitle?: boolean;
}

export type ProjectTaskScopeInput = {
  batchId?: string | null;
  segmentIds?: string[];
  sourceLocale?: string | null;
  targetLocale?: string | null;
};

export type StandaloneTaskScopeInput = {
  workingDirectoryGrantId?: string;
  fileGrantIds?: string[];
};

export type CreateTaskWorkspaceInput = CreateTaskWorkspaceBase & (
  | {
      projectId: string;
      owner?: { kind: "project"; projectId: string };
      scope?: ProjectTaskScopeInput;
    }
  | {
      projectId?: never;
      owner: { kind: "standalone" };
      scope?: StandaloneTaskScopeInput;
    }
);

export type TaskWorkspaceLocator =
  | TaskLocator
  | { projectId: string; taskId: string };

export type TaskWorkspaceListInput =
  | TaskOwner
  | { projectId: string };

/** Cheap revision metadata for native polling; it never reads the event log. */
export type TaskWorkspaceProbe = TaskLocator & {
  schemaVersion: typeof TASK_WORKSPACE_SCHEMA_VERSION;
  taskStatus: TaskStatus;
  taskUpdatedAt: string;
  eventCursor: string;
  projectedAt: string;
  activeRunId: string | null;
  activeRunStatus: TaskRunStatus | null;
  activeRunUpdatedAt: string | null;
};

export interface TaskWorkspaceEventBatch {
  afterCursor: string;
  nextCursor: string;
  hasMore: boolean;
  events: TaskRunEvent[];
}

export interface TaskWorkspaceOptions {
  now?: () => string;
  createTaskId?: () => string;
}

export type TaskRunEventDraft = Omit<
  TaskRunEvent,
  "id" | "cursor" | "seq" | "taskId" | "runId" | "occurredAt"
> & {
  id?: string;
  occurredAt?: string;
};

export interface TaskWorkspace {
  create(input: CreateTaskWorkspaceInput): Promise<TaskWorkspaceSnapshot>;
  updateTitle(input: TaskWorkspaceLocator & { title: string }): Promise<TaskWorkspaceSnapshot>;
  updateTitleGeneration(input: TaskWorkspaceLocator & {
    expectedStatus: "pending";
    expectedAttemptId: string | null;
    generation: TaskTitleGeneration;
    title?: string;
  }): Promise<TaskWorkspaceSnapshot | null>;
  archive(input: TaskWorkspaceLocator): Promise<TaskWorkspaceSnapshot>;
  restore(input: TaskWorkspaceLocator): Promise<TaskWorkspaceSnapshot>;
  updateStandaloneScope(input: {
    kind: "standalone";
    taskId: string;
    workingDirectoryGrantId?: string;
    fileGrantIds: string[];
  }): Promise<TaskWorkspaceSnapshot>;
  open(input: TaskWorkspaceLocator): Promise<TaskWorkspaceSnapshot>;
  probe(input: TaskWorkspaceLocator): Promise<TaskWorkspaceProbe>;
  listSnapshots(input: TaskWorkspaceListInput): Promise<TaskWorkspaceSnapshot[]>;
  list(input: TaskWorkspaceListInput): Promise<TaskRecord[]>;
  append(input: TaskWorkspaceLocator & { page: TaskRunEventPage | unknown }): Promise<TaskWorkspaceSnapshot>;
  appendGenerated(input: TaskWorkspaceLocator & {
    runId: string;
    expectedRequiredDecisionIds?: string[];
    expectedActiveRun?: { id: string; status: TaskRunStatus; startedAt?: string | null };
    beforeCommit?: () => Promise<void>;
    events: TaskRunEventDraft[];
  }): Promise<TaskWorkspaceSnapshot>;
  events(input: TaskWorkspaceLocator & { runId: string; afterCursor?: string; limit?: number }): Promise<TaskRunEventPage>;
  eventsAfter(input: TaskWorkspaceLocator & { afterCursor?: string; limit?: number }): Promise<TaskWorkspaceEventBatch>;
  subscribeEvents(input: TaskWorkspaceLocator, listener: (events: readonly TaskRunEvent[]) => void): () => void;
}

export class TaskWorkspaceNotFoundError extends Error {
  constructor(locator: TaskLocator) {
    super(locator.kind === "project"
      ? `Task ${locator.taskId} was not found in project ${locator.projectId}.`
      : `Standalone Task ${locator.taskId} was not found.`);
    this.name = "TaskWorkspaceNotFoundError";
  }
}

export class TaskWorkspaceConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskWorkspaceConflictError";
  }
}

// The resident runtime is the single writer process. Keep serialization at
// module scope so independently constructed route/module instances still share
// one compare-and-append queue for each durable task.
const taskAppendQueues = new Map<string, Promise<void>>();
const taskEventListeners = new Map<string, Set<(events: readonly TaskRunEvent[]) => void>>();
const terminalThreadStatusByRunStatus = new Map([
  ["complete", "complete"],
  ["failed", "failed"],
  ["stopped", "stopped"],
] as const);
const terminalThreadStatuses = new Set(["complete", "failed", "stopped"]);

function reconcileTerminalAgentThreads(snapshot: TaskWorkspaceSnapshot): TaskWorkspaceSnapshot {
  const runs = new Map(snapshot.runs.map((run) => [run.id, run]));
  let changed = false;
  const agentThreads = snapshot.agentThreads.map((thread) => {
    const run = runs.get(thread.runId);
    const status = run ? terminalThreadStatusByRunStatus.get(run.status as "complete" | "failed" | "stopped") : undefined;
    if (!status || terminalThreadStatuses.has(thread.status)) return thread;
    changed = true;
    return { ...thread, status, updatedAt: run!.updatedAt };
  });
  return changed ? { ...snapshot, agentThreads } : snapshot;
}

function sameGeneratedArtifact(left: TaskArtifact, right: TaskArtifact): boolean {
  const { version: _leftVersion, createdAt: _leftCreatedAt, updatedAt: _leftUpdatedAt, ...leftValue } = left;
  const { version: _rightVersion, createdAt: _rightCreatedAt, updatedAt: _rightUpdatedAt, ...rightValue } = right;
  return isDeepStrictEqual(leftValue, rightValue);
}

function sameDecisionDefinition(left: TaskDecision, right: TaskDecision): boolean {
  const {
    status: _leftStatus,
    selectedOptionId: _leftSelectedOptionId,
    selectedOptionIds: _leftSelectedOptionIds,
    responseText: _leftResponseText,
    reason: _leftReason,
    decidedAt: _leftDecidedAt,
    ...leftDefinition
  } = left;
  const {
    status: _rightStatus,
    selectedOptionId: _rightSelectedOptionId,
    selectedOptionIds: _rightSelectedOptionIds,
    responseText: _rightResponseText,
    reason: _rightReason,
    decidedAt: _rightDecidedAt,
    ...rightDefinition
  } = right;
  return isDeepStrictEqual(leftDefinition, rightDefinition);
}

function isMainToTeamResourcePromotion(previous: TaskRun, next: TaskRun): boolean {
  const before = previous.resourceManifest;
  const after = next.resourceManifest;
  if (!before || !after || before.profile !== "main" || after.profile !== "main+team") return false;
  if (previous.mode !== "team" || next.mode !== "team" || !["awaiting_input", "waiting", "active"].includes(next.status)) return false;
  if (!before.mainSurface || !isDeepStrictEqual(before.mainSurface, after.mainSurface)) return false;
  if (!before.packages.every((entry) => after.packages.some((candidate) => isDeepStrictEqual(candidate, entry)))) return false;
  if (after.packages.length <= before.packages.length) return false;
  if (!before.activeToolNames.every((name) => after.activeToolNames.includes(name))) return false;
  if (![after.requestShapeHash, after.systemPromptHash, after.toolSurfaceHash, after.resourceIndexHash]
    .every((hash) => typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash))) return false;
  return before.packages.every(({ name }) => before.mainSurface!.packageNames.includes(name));
}

function safeId(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) throw new Error(`${label} must be a safe identifier.`);
  return value;
}

function projectTasksRoot(repoRoot: string, projectId: string): string {
  return join(resolve(repoRoot), "data", "projects", safeId(projectId, "projectId"), "task_workspace");
}

function normalizeTaskLocator(input: TaskWorkspaceLocator): TaskLocator {
  if ("kind" in input) {
    if (input.kind === "standalone") return { kind: "standalone", taskId: safeId(input.taskId, "taskId") };
    return {
      kind: "project",
      projectId: safeId(input.projectId, "projectId"),
      taskId: safeId(input.taskId, "taskId"),
    };
  }
  return {
    kind: "project",
    projectId: safeId(input.projectId, "projectId"),
    taskId: safeId(input.taskId, "taskId"),
  };
}

function normalizeTaskOwner(input: TaskWorkspaceListInput): TaskOwner {
  if ("kind" in input) {
    return input.kind === "standalone"
      ? { kind: "standalone" }
      : { kind: "project", projectId: safeId(input.projectId, "projectId") };
  }
  return { kind: "project", projectId: safeId(input.projectId, "projectId") };
}

function tasksRoot(repoRoot: string, owner: TaskOwner): string {
  return owner.kind === "standalone"
    ? join(resolve(repoRoot), "data", "assistant", "tasks")
    : join(projectTasksRoot(repoRoot, owner.projectId), "tasks");
}

function taskDirectory(repoRoot: string, locator: TaskLocator): string {
  return join(tasksRoot(repoRoot, locator), safeId(locator.taskId, "taskId"));
}

/**
 * Canonical directory for Task-owned auxiliary state. Callers may add a
 * dedicated, server-owned projection beside snapshot.json, but must never
 * duplicate the standalone/Project routing rules or accept unvalidated ids.
 */
export function taskWorkspaceDirectory(repoRoot: string, input: TaskLocator): string {
  return taskDirectory(resolve(repoRoot), normalizeTaskLocator(input));
}

function taskSnapshotPath(repoRoot: string, locator: TaskLocator): string {
  return join(taskDirectory(repoRoot, locator), "snapshot.json");
}

function taskEventsPath(repoRoot: string, locator: TaskLocator): string {
  return join(taskDirectory(repoRoot, locator), "events.jsonl");
}

/**
 * Read only the tail of the append-only event log. This lets a lightweight
 * probe detect an event append that raced a snapshot write without parsing a
 * multi-megabyte history on every poll. A torn trailing line is ignored; the
 * next full open() still performs the strict replay/validation path.
 */
async function readLastEventCursor(path: string): Promise<string | null> {
  let handle: Awaited<ReturnType<typeof openFile>> | undefined;
  try {
    handle = await openFile(path, "r");
    const { size } = await handle.stat();
    if (size <= 0) return null;
    let length = Math.min(size, 64 * 1024);
    while (true) {
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, size - length);
      const text = buffer.toString("utf8");
      const lines = text.split("\n");
      // A crash can leave a partial final line. Only inspect complete records.
      lines.pop();
      const lastLine = lines.at(-1)?.trim();
      if (lastLine) {
        try {
          const record = JSON.parse(lastLine) as Record<string, unknown>;
          if (record.recordType === "task_run_event_page_v1" && record.page && typeof record.page === "object") {
            const page = record.page as Record<string, unknown>;
            return typeof page.nextCursor === "string" ? page.nextCursor : null;
          }
          return typeof record.cursor === "string" ? record.cursor : null;
        } catch {
          // The complete record may begin before this read window; grow it.
        }
      }
      if (length >= size || length >= 8 * 1024 * 1024) return null;
      length = Math.min(size, length * 2);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  } finally {
    await handle?.close();
  }
}

function nonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} must not be empty.`);
  return normalized;
}

export function createTaskWorkspace(repoRoot: string, options: TaskWorkspaceOptions = {}): TaskWorkspace {
  const root = resolve(repoRoot);
  const now = options.now ?? (() => new Date().toISOString());
  const createTaskId = options.createTaskId ?? (() => `task_${randomUUID()}`);

  const readEvents = async (locator: TaskLocator): Promise<TaskRunEvent[]> => {
    const rows = await readJsonlFile<unknown>(taskEventsPath(root, locator));
    const events = rows.flatMap((row, index) => {
      if (row && typeof row === "object" && !Array.isArray(row) && (row as Record<string, unknown>).recordType === "task_run_event_page_v1") {
        return parseTaskRunEventPage((row as Record<string, unknown>).page).events;
      }
      return [parseTaskRunEvent(row, `events.jsonl[${index}]`)];
    });
    const ids = new Set<string>();
    const cursors = new Set<string>();
    for (const [index, event] of events.entries()) {
      if (index > 0 && event.seq <= events[index - 1]!.seq) throw new Error(`Task ${locator.taskId} event sequence is not strictly increasing.`);
      if (ids.has(event.id)) throw new Error(`Task ${locator.taskId} event id ${event.id} is duplicated.`);
      if (cursors.has(event.cursor)) throw new Error(`Task ${locator.taskId} event cursor ${event.cursor} is duplicated.`);
      ids.add(event.id);
      cursors.add(event.cursor);
    }
    return events;
  };

  const open = async (input: TaskWorkspaceLocator): Promise<TaskWorkspaceSnapshot> => {
    const locator = normalizeTaskLocator(input);
    const taskId = locator.taskId;
    const path = taskSnapshotPath(root, locator);
    const raw = await readJsonFile<unknown | null>(path, null);
    if (raw === null) throw new TaskWorkspaceNotFoundError(locator);
    let snapshot = parseTaskWorkspaceSnapshot(raw);
    const ownerMatches = locator.kind === "standalone"
      ? snapshot.task.owner.kind === "standalone"
      : snapshot.task.owner.kind === "project" && snapshot.task.owner.projectId === locator.projectId;
    if (!ownerMatches || snapshot.task.id !== taskId) {
      throw new Error(`Task ${taskId} durable scope does not match its storage path.`);
    }

    // The event log is the durable source of truth. A process can terminate
    // after appending an event page but before atomically replacing the derived
    // snapshot. Reconcile that narrow crash window whenever the task is opened
    // so callers never have to understand or repair partial projection state.
    const events = await readEvents(locator);
    const initialCursor = `${taskId}:0`;
    const snapshotCursorIndex = snapshot.eventCursor === initialCursor
      ? -1
      : events.findIndex((event) => event.cursor === snapshot.eventCursor);
    if (snapshot.eventCursor !== initialCursor && snapshotCursorIndex < 0) {
      throw new TaskWorkspaceConflictError(`Snapshot cursor ${snapshot.eventCursor} is not present in the durable event log for task ${taskId}.`);
    }
    const pendingEvents = events.slice(snapshotCursorIndex + 1);
    const pendingPages: TaskRunEvent[][] = [];
    for (const event of pendingEvents) {
      const currentPage = pendingPages.at(-1);
      if (currentPage?.at(-1)?.runId === event.runId) currentPage.push(event);
      else pendingPages.push([event]);
    }
    for (const eventsForRun of pendingPages) {
      const finalEvent = eventsForRun.at(-1)!;
      snapshot = applyTaskRunEventPage(snapshot, {
        schemaVersion: TASK_WORKSPACE_SCHEMA_VERSION,
        taskId,
        runId: finalEvent.runId,
        afterCursor: snapshot.eventCursor,
        nextCursor: finalEvent.cursor,
        hasMore: false,
        events: eventsForRun,
      });
    }
    const reconciled = reconcileTerminalAgentThreads(snapshot);
    if (pendingEvents.length || reconciled !== snapshot) await writeJsonFile(path, reconciled);
    snapshot = reconciled;
    return snapshot;
  };

  const probe = async (input: TaskWorkspaceLocator): Promise<TaskWorkspaceProbe> => {
    const locator = normalizeTaskLocator(input);
    const taskId = locator.taskId;
    const path = taskSnapshotPath(root, locator);
    const raw = await readJsonFile<unknown | null>(path, null);
    if (raw === null) throw new TaskWorkspaceNotFoundError(locator);
    // The derived snapshot is written atomically after every event page. A
    // poll only needs this small JSON projection; open() remains the recovery
    // path that replays the event log after an interrupted write.
    const snapshot = parseTaskWorkspaceSnapshot(raw);
    const ownerMatches = locator.kind === "standalone"
      ? snapshot.task.owner.kind === "standalone"
      : snapshot.task.owner.kind === "project" && snapshot.task.owner.projectId === locator.projectId;
    if (!ownerMatches || snapshot.task.id !== taskId) {
      throw new Error(`Task ${taskId} durable scope does not match its storage path.`);
    }
    const activeRun = snapshot.activeRunId
      ? snapshot.runs.find((run) => run.id === snapshot.activeRunId) ?? null
      : null;
    const logCursor = await readLastEventCursor(taskEventsPath(root, locator));
    return {
      schemaVersion: TASK_WORKSPACE_SCHEMA_VERSION,
      ...locator,
      taskStatus: snapshot.task.status,
      taskUpdatedAt: snapshot.task.updatedAt,
      eventCursor: logCursor ?? snapshot.eventCursor,
      projectedAt: snapshot.projectedAt,
      activeRunId: activeRun?.id ?? snapshot.activeRunId ?? null,
      activeRunStatus: activeRun?.status ?? null,
      activeRunUpdatedAt: activeRun?.updatedAt ?? null,
    };
  };

  const commitPage = async (
    locator: TaskLocator,
    page: TaskRunEventPage,
  ): Promise<TaskWorkspaceSnapshot> => {
    const taskId = locator.taskId;
    const current = await open(locator);
    const runs = new Map(current.runs.map((run) => [run.id, run]));
    const decisions = new Map(current.decisions.map((decision) => [decision.id, decision]));
    const existingInteractionIds = new Set(current.decisions.flatMap((decision) => decision.interactionId ? [decision.interactionId] : []));
    const durablePage = parseTaskRunEventPage({
      ...page,
      events: page.events.map((event) => {
        if (event.type !== "run_upsert" || !event.run) return event;
        const previous = runs.get(event.run.id);
        if (previous?.resourceManifest && event.run.resourceManifest
          && !isDeepStrictEqual(previous.resourceManifest, event.run.resourceManifest)
          && !isMainToTeamResourcePromotion(previous, event.run)) {
          throw new TaskWorkspaceConflictError(`Run ${event.run.id} resourceManifest cannot change after it is recorded.`);
        }
        const run = {
          ...event.run,
          ...(previous?.resourceManifest && !isMainToTeamResourcePromotion(previous, event.run)
            ? { resourceManifest: previous.resourceManifest }
            : {}),
        };
        runs.set(run.id, run);
        return { ...event, run };
      }).map((event) => {
        if (event.type !== "decision_upsert" || !event.decision) return event;
        const previous = decisions.get(event.decision.id);
        if (previous && !sameDecisionDefinition(previous, event.decision)) {
          throw new TaskWorkspaceConflictError(`Decision ${event.decision.id} definition cannot change after it is recorded.`);
        }
        if (previous?.status !== undefined && previous.status !== "required" && event.decision.status === "required") {
          throw new TaskWorkspaceConflictError(`Decision ${event.decision.id} cannot return to required.`);
        }
        if (!previous && event.decision.interactionId && existingInteractionIds.has(event.decision.interactionId)) {
          throw new TaskWorkspaceConflictError(`Decision interaction ${event.decision.interactionId} cannot add questions after it is recorded.`);
        }
        decisions.set(event.decision.id, event.decision);
        return event;
      }),
    });
    let result: TaskWorkspaceSnapshot;
    try {
      result = applyTaskRunEventPage(current, durablePage);
    } catch (error) {
      if (error instanceof Error && /cursor conflict/.test(error.message)) throw new TaskWorkspaceConflictError(error.message);
      throw error;
    }
    const durableEvents = await readEvents(locator);
    const knownIds = new Set(durableEvents.map((event) => event.id));
    const knownCursors = new Set(durableEvents.map((event) => event.cursor));
    let expectedSeq = (durableEvents.at(-1)?.seq ?? 0) + 1;
    for (const event of durablePage.events) {
      if (event.seq !== expectedSeq) throw new TaskWorkspaceConflictError(`Task ${taskId} expected event seq ${expectedSeq}, received ${event.seq}.`);
      if (knownIds.has(event.id)) throw new TaskWorkspaceConflictError(`Task ${taskId} event id ${event.id} already exists.`);
      if (knownCursors.has(event.cursor)) throw new TaskWorkspaceConflictError(`Task ${taskId} event cursor ${event.cursor} already exists.`);
      knownIds.add(event.id);
      knownCursors.add(event.cursor);
      expectedSeq += 1;
    }
    const eventPath = taskEventsPath(root, locator);
    await mkdir(dirname(eventPath), { recursive: true });
    // One JSONL record per page makes a torn trailing append discard the whole
    // transaction instead of replaying a valid-but-referentially-incomplete prefix.
    if (durablePage.events.length) await appendFile(eventPath, `${JSON.stringify({ recordType: "task_run_event_page_v1", page: durablePage })}\n`, "utf8");
    await writeJsonFile(taskSnapshotPath(root, locator), result);
    if (durablePage.events.length) {
      for (const listener of taskEventListeners.get(taskSnapshotPath(root, locator)) ?? []) {
        try { listener(durablePage.events); } catch { /* A disconnected client cannot invalidate a durable commit. */ }
      }
    }
    return result;
  };

  const queued = async <T>(path: string, work: () => Promise<T>): Promise<T> => {
    const previous = taskAppendQueues.get(path) ?? Promise.resolve();
    let result!: T;
    const next = previous.then(async () => { result = await work(); });
    const settled = next.catch(() => undefined);
    taskAppendQueues.set(path, settled);
    try {
      await next;
    } finally {
      if (taskAppendQueues.get(path) === settled) taskAppendQueues.delete(path);
    }
    return result;
  };

  const listSnapshots = async (input: TaskWorkspaceListInput): Promise<TaskWorkspaceSnapshot[]> => {
    const owner = normalizeTaskOwner(input);
    const ownerTasksRoot = tasksRoot(root, owner);
    let entries;
    try {
      entries = await readdir(ownerTasksRoot, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const snapshots = await Promise.all(entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => open(owner.kind === "standalone"
        ? { kind: "standalone", taskId: entry.name }
        : { kind: "project", projectId: owner.projectId, taskId: entry.name })));
    return snapshots.sort((left, right) => right.task.updatedAt.localeCompare(left.task.updatedAt) || left.task.id.localeCompare(right.task.id));
  };

  return {
    async create(input) {
      const owner: TaskOwner = input.owner?.kind === "standalone"
        ? { kind: "standalone" }
        : {
            kind: "project",
            projectId: safeId(input.projectId as string, "projectId"),
          };
      if (owner.kind === "project" && input.owner?.kind === "project"
        && safeId(input.owner.projectId, "owner.projectId") !== owner.projectId) {
        throw new Error("owner.projectId must match projectId.");
      }
      if (owner.kind === "standalone" && input.kind !== "general") {
        throw new Error("Standalone Tasks must use kind general.");
      }
      const taskId = safeId(input.taskId?.trim() || createTaskId(), "taskId");
      const locator: TaskLocator = owner.kind === "standalone"
        ? { kind: "standalone", taskId }
        : { kind: "project", projectId: owner.projectId, taskId };
      const path = taskSnapshotPath(root, locator);
      return queued(path, async () => {
        if (await readJsonFile<unknown | null>(path, null) !== null) {
          throw new TaskWorkspaceConflictError(owner.kind === "project"
            ? `Task ${taskId} already exists in project ${owner.projectId}.`
            : `Standalone Task ${taskId} already exists.`);
        }
        const createdAt = now();
        const initialMessage = input.initialMessage === undefined
          ? undefined
          : nonEmpty(input.initialMessage, "initialMessage");
        const scope = owner.kind === "standalone"
          ? {
              kind: "standalone" as const,
              workingDirectoryGrantId: (input.scope as StandaloneTaskScopeInput | undefined)?.workingDirectoryGrantId,
              fileGrantIds: (input.scope as StandaloneTaskScopeInput | undefined)?.fileGrantIds ?? [],
            }
          : {
              kind: "project" as const,
              batchId: (input.scope as ProjectTaskScopeInput | undefined)?.batchId,
              segmentIds: (input.scope as ProjectTaskScopeInput | undefined)?.segmentIds ?? [],
              sourceLocale: (input.scope as ProjectTaskScopeInput | undefined)?.sourceLocale,
              targetLocale: (input.scope as ProjectTaskScopeInput | undefined)?.targetLocale,
            };
        const draft = parseTaskWorkspaceSnapshot({
          schemaVersion: TASK_WORKSPACE_SCHEMA_VERSION,
          task: {
            id: taskId,
            owner,
            scope,
            title: nonEmpty(input.title, "title"),
            intent: nonEmpty(input.intent, "intent"),
            kind: input.kind,
            status: "draft",
            titleGeneration: input.autoTitle ? { status: "pending", requestedAt: createdAt } : undefined,
            createdAt,
            updatedAt: createdAt,
          },
          activeRunId: null,
          eventCursor: `${taskId}:0`,
          projectedAt: createdAt,
          runs: [],
          agentThreads: [],
          activities: [],
          artifacts: [],
          decisions: [],
        });
        if (initialMessage === undefined) {
          await writeJsonFile(path, draft);
          if (owner.kind === "standalone") await mkdir(join(dirname(path), "workspace", "attachments"), { recursive: true });
          return draft;
        }

        const runId = `turn_${randomUUID()}`;
        const threadId = `${runId}.main`;
        const events = [
          parseTaskRunEvent({
            id: `${runId}.created`,
            cursor: `${taskId}:1`,
            seq: 1,
            taskId,
            runId,
            agentThreadId: threadId,
            type: "run_upsert",
            occurredAt: createdAt,
            run: {
              id: runId,
              taskId,
              mode: "single",
              status: "pending",
              rootAgentThreadId: threadId,
              planHash: null,
              estimatedCalls: 1,
              estimatedCallsBySource: { main: 1 },
              startedAt: null,
              updatedAt: createdAt,
              completedAt: null,
              stopAvailable: true,
              resumeAvailable: false,
            },
          }),
          parseTaskRunEvent({
            id: `${runId}.main.created`,
            cursor: `${taskId}:2`,
            seq: 2,
            taskId,
            runId,
            agentThreadId: threadId,
            type: "thread_upsert",
            occurredAt: createdAt,
            thread: {
              id: threadId,
              taskId,
              runId,
              parentThreadId: null,
              identity: {
                kind: "main",
                roleId: "linguist-agent",
                displayName: "Linguist Agent",
                roleLabel: "Main Agent",
                disclosureLabel: "Agent",
              },
              status: "pending",
              canReceiveUserMessage: true,
              handoffSummary: null,
              latestActivityId: null,
              childThreadIds: [],
              createdAt,
              updatedAt: createdAt,
            },
          }),
          parseTaskRunEvent({
            id: `${runId}.message`,
            cursor: `${taskId}:3`,
            seq: 3,
            taskId,
            runId,
            agentThreadId: threadId,
            type: "activity_append",
            occurredAt: createdAt,
            activity: {
              id: `${runId}.message`,
              taskId,
              runId,
              agentThreadId: threadId,
              seq: 1,
              type: "message",
              status: "done",
              actor: { kind: "human", id: "user", displayName: "You", agentThreadId: threadId },
              title: "You",
              body: initialMessage,
              tool: null,
              refs: {
                artifactIds: [],
                evidenceRefs: [...new Set(input.initialEvidenceRefs ?? [])],
                decisionIds: [],
                segmentIds: scope.kind === "project" ? scope.segmentIds : [],
              },
              createdAt,
              updatedAt: createdAt,
            },
          }),
        ];
        const page = parseTaskRunEventPage({
          schemaVersion: TASK_WORKSPACE_SCHEMA_VERSION,
          taskId,
          runId,
          afterCursor: draft.eventCursor,
          nextCursor: events.at(-1)!.cursor,
          hasMore: false,
          events,
        });
        const snapshot = applyTaskRunEventPage(draft, page);

        // Stage the complete first-turn Task beside its final directory, then
        // publish it with one directory rename. A crash can reveal either no
        // Task or the Task + pending Main Run + full human message, never a
        // half-created conversation.
        const taskDirectory = dirname(path);
        const tasksDirectory = dirname(taskDirectory);
        const stagingDirectory = join(tasksDirectory, `.${taskId}.tmp-${process.pid}-${randomUUID()}`);
        await mkdir(tasksDirectory, { recursive: true });
        await mkdir(stagingDirectory);
        try {
          await writeJsonFile(join(stagingDirectory, "snapshot.json"), snapshot);
          await writeFile(
            join(stagingDirectory, "events.jsonl"),
            `${JSON.stringify({ recordType: "task_run_event_page_v1", page })}\n`,
            "utf8",
          );
          await rename(stagingDirectory, taskDirectory);
          if (owner.kind === "standalone") await mkdir(join(taskDirectory, "workspace", "attachments"), { recursive: true });
        } catch (error) {
          await rm(stagingDirectory, { recursive: true, force: true });
          throw error;
        }
        return snapshot;
      });
    },
    async updateTitle(input) {
      const locator = normalizeTaskLocator(input);
      const title = nonEmpty(input.title, "title");
      const path = taskSnapshotPath(root, locator);
      return queued(path, async () => {
        const current = await open(locator);
        if (current.task.title === title) return current;
        const updatedAt = now();
        const titleGeneration = current.task.titleGeneration?.status === "pending"
          ? {
              ...current.task.titleGeneration,
              status: "failed" as const,
              completedAt: updatedAt,
              error: "Cancelled by manual Task rename.",
            }
          : current.task.titleGeneration;
        const updated = parseTaskWorkspaceSnapshot({
          ...current,
          task: { ...current.task, title, titleGeneration, updatedAt },
          projectedAt: updatedAt,
        });
        await writeJsonFile(path, updated);
        return updated;
      });
    },
    async updateTitleGeneration(input) {
      const locator = normalizeTaskLocator(input);
      const path = taskSnapshotPath(root, locator);
      return queued(path, async () => {
        const current = await open(locator);
        const generation = current.task.titleGeneration;
        if (!generation
          || generation.status !== input.expectedStatus
          || (generation.attemptId ?? null) !== input.expectedAttemptId) return null;
        if (input.generation.status === "generated" && !input.title?.trim()) {
          throw new Error("Generated Task title is required.");
        }
        const updatedAt = now();
        const updated = parseTaskWorkspaceSnapshot({
          ...current,
          task: {
            ...current.task,
            ...(input.title?.trim() ? { title: input.title.trim() } : {}),
            titleGeneration: input.generation,
            updatedAt,
          },
          projectedAt: updatedAt,
        });
        await writeJsonFile(path, updated);
        return updated;
      });
    },
    async archive(input) {
      const locator = normalizeTaskLocator(input);
      const taskId = locator.taskId;
      const path = taskSnapshotPath(root, locator);
      return queued(path, async () => {
        const current = await open(locator);
        if (current.task.status === "archived") return current;
        if (current.activeRunId) throw new TaskWorkspaceConflictError(`Task ${taskId} cannot be archived while run ${current.activeRunId} is active.`);
        const updatedAt = now();
        const updated = parseTaskWorkspaceSnapshot({
          ...current,
          task: { ...current.task, status: "archived", updatedAt },
          projectedAt: updatedAt,
        });
        await writeJsonFile(path, updated);
        return updated;
      });
    },
    async restore(input) {
      const locator = normalizeTaskLocator(input);
      const path = taskSnapshotPath(root, locator);
      return queued(path, async () => {
        const current = await open(locator);
        if (current.task.status !== "archived") return current;
        const latestRun = [...current.runs]
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
        const status: TaskStatus = latestRun?.status === "complete"
          ? "complete"
          : latestRun?.status === "failed"
            ? "failed"
            : latestRun?.status === "stopped"
              ? "stopped"
              : "draft";
        const updatedAt = now();
        const updated = parseTaskWorkspaceSnapshot({
          ...current,
          task: { ...current.task, status, updatedAt },
          projectedAt: updatedAt,
        });
        await writeJsonFile(path, updated);
        return updated;
      });
    },
    async updateStandaloneScope(input) {
      const locator = normalizeTaskLocator(input);
      const path = taskSnapshotPath(root, locator);
      return queued(path, async () => {
        const current = await open(locator);
        if (current.task.owner.kind !== "standalone" || current.task.scope.kind !== "standalone") {
          throw new TaskWorkspaceConflictError(`Task ${locator.taskId} is not standalone.`);
        }
        if (current.activeRunId
          && current.task.scope.workingDirectoryGrantId !== input.workingDirectoryGrantId) {
          throw new TaskWorkspaceConflictError(`Standalone Task ${locator.taskId} working directory cannot change while run ${current.activeRunId} is active.`);
        }
        const updatedAt = now();
        const updated = parseTaskWorkspaceSnapshot({
          ...current,
          task: {
            ...current.task,
            scope: {
              kind: "standalone",
              workingDirectoryGrantId: input.workingDirectoryGrantId,
              fileGrantIds: [...new Set(input.fileGrantIds)],
            },
            updatedAt,
          },
          projectedAt: updatedAt,
        });
        await writeJsonFile(path, updated);
        return updated;
      });
    },
    open,
    probe,
    listSnapshots,
    async list(input) {
      return (await listSnapshots(input)).map((snapshot) => snapshot.task);
    },
    async append(input) {
      const locator = normalizeTaskLocator(input);
      const taskId = locator.taskId;
      const page = parseTaskRunEventPage(input.page);
      if (page.taskId !== taskId) throw new TaskWorkspaceConflictError("Event page taskId does not match the TaskWorkspace locator.");
      const path = taskSnapshotPath(root, locator);
      return queued(path, () => commitPage(locator, page));
    },
    async appendGenerated(input) {
      const locator = normalizeTaskLocator(input);
      const taskId = locator.taskId;
      const runId = safeId(input.runId, "runId");
      const expectedRequiredDecisionIds = (input.expectedRequiredDecisionIds ?? []).map((id) => nonEmpty(id, "decisionId"));
      const path = taskSnapshotPath(root, locator);
      return queued(path, async () => {
        const current = await open(locator);
        if (input.expectedActiveRun) {
          const expected = input.expectedActiveRun;
          const active = current.activeRunId === expected.id
            ? current.runs.find((run) => run.id === expected.id)
            : undefined;
          if (!active
            || active.status !== expected.status
            || (Object.hasOwn(expected, "startedAt") && (active.startedAt ?? null) !== (expected.startedAt ?? null))) {
            throw new TaskWorkspaceConflictError(
              `Task ${taskId} active Run no longer matches expected ${expected.id} (${expected.status}).`,
            );
          }
        }
        const requiredDecisionIds = new Set(current.decisions.filter((decision) => decision.status === "required").map((decision) => decision.id));
        const staleDecisionId = expectedRequiredDecisionIds.find((id) => !requiredDecisionIds.has(id));
        if (staleDecisionId) throw new TaskWorkspaceConflictError(`Decision ${staleDecisionId} is no longer required.`);
        const nextActiveRun = input.events.find((draft) => draft.type === "run_upsert" && draft.run && !["stopped", "failed", "stale", "complete"].includes(draft.run.status))?.run;
        if (current.activeRunId && nextActiveRun && nextActiveRun.id !== current.activeRunId) {
          throw new TaskWorkspaceConflictError(`Task ${taskId} already has active run ${current.activeRunId}.`);
        }
        const existing = await readEvents(locator);
        const firstSeq = (existing.at(-1)?.seq ?? 0) + 1;
        const activityIds = new Set(current.activities.map((activity) => activity.id));
        const artifacts = new Map(current.artifacts.map((artifact) => [artifact.id, artifact]));
        const threads = new Map(current.agentThreads.map((thread) => [thread.id, thread]));
        const decisions = new Map(current.decisions.map((decision) => [decision.id, decision]));
        let nextActivitySeq = Math.max(0, ...current.activities.filter((activity) => activity.runId === runId).map((activity) => activity.seq)) + 1;
        const drafts = input.events.flatMap((draft): TaskRunEventDraft[] => {
          if (draft.type === "thread_upsert" && draft.thread) {
            const previous = threads.get(draft.thread.id);
            const thread = previous ? {
              ...draft.thread,
              latestActivityId: previous.latestActivityId ?? draft.thread.latestActivityId,
              childThreadIds: Array.from(new Set([...previous.childThreadIds, ...draft.thread.childThreadIds])),
              createdAt: previous.createdAt,
            } : draft.thread;
            threads.set(thread.id, thread);
            return [{ ...draft, thread }];
          }
          if (draft.type === "activity_append" && draft.activity) {
            if (activityIds.has(draft.activity.id)) return [];
            activityIds.add(draft.activity.id);
            return [{ ...draft, activity: { ...draft.activity, seq: nextActivitySeq++ } }];
          }
          if (draft.type === "artifact_upsert" && draft.artifact) {
            const previous = artifacts.get(draft.artifact.id);
            if (previous && sameGeneratedArtifact(previous, draft.artifact)) return [];
            const artifact = {
              ...draft.artifact,
              version: (previous?.version ?? 0) + 1,
              createdAt: previous?.createdAt ?? draft.artifact.createdAt,
            };
            artifacts.set(artifact.id, artifact);
            return [{ ...draft, artifact }];
          }
          if (draft.type === "decision_upsert" && draft.decision) {
            const previous = decisions.get(draft.decision.id);
            if (previous && previous.status !== "required" && draft.decision.status === "required") return [];
            decisions.set(draft.decision.id, draft.decision);
          }
          return [draft];
        });
        if (!drafts.length) return current;
        const events = drafts.map((draft, index) => parseTaskRunEvent({
          ...draft,
          id: draft.id ?? `event_${randomUUID()}`,
          cursor: `${taskId}:${firstSeq + index}`,
          seq: firstSeq + index,
          taskId,
          runId,
          occurredAt: draft.occurredAt ?? now(),
        }));
        const page = parseTaskRunEventPage({
          schemaVersion: TASK_WORKSPACE_SCHEMA_VERSION,
          taskId,
          runId,
          afterCursor: current.eventCursor,
          nextCursor: events.at(-1)?.cursor ?? current.eventCursor,
          hasMore: false,
          events,
        });
        await input.beforeCommit?.();
        return commitPage(locator, page);
      });
    },
    async events(input) {
      const locator = normalizeTaskLocator(input);
      const taskId = locator.taskId;
      const runId = safeId(input.runId, "runId");
      await open(locator);
      const rows = await readEvents(locator);
      const afterCursor = input.afterCursor ?? `${taskId}:0`;
      let start = 0;
      if (afterCursor !== `${taskId}:0`) {
        const cursorIndex = rows.findIndex((event) => event.cursor === afterCursor);
        if (cursorIndex < 0) throw new TaskWorkspaceConflictError(`Event cursor ${afterCursor} is not available for task ${taskId}.`);
        start = cursorIndex + 1;
      }
      const matching = rows.slice(start).filter((event) => event.runId === runId);
      const limit = Number.isFinite(input.limit) ? Math.max(1, Math.min(1_000, Math.floor(input.limit!))) : 200;
      const events = matching.slice(0, limit);
      return parseTaskRunEventPage({
        schemaVersion: TASK_WORKSPACE_SCHEMA_VERSION,
        taskId,
        runId,
        afterCursor,
        nextCursor: events.at(-1)?.cursor ?? afterCursor,
        hasMore: matching.length > events.length,
        events,
      });
    },
    async eventsAfter(input) {
      const locator = normalizeTaskLocator(input);
      const taskId = locator.taskId;
      await open(locator);
      const rows = await readEvents(locator);
      const afterCursor = input.afterCursor ?? `${taskId}:0`;
      let start = 0;
      if (afterCursor !== `${taskId}:0`) {
        const cursorIndex = rows.findIndex((event) => event.cursor === afterCursor);
        if (cursorIndex < 0) throw new TaskWorkspaceConflictError(`Event cursor ${afterCursor} is not available for task ${taskId}.`);
        start = cursorIndex + 1;
      }
      const limit = Number.isFinite(input.limit) ? Math.max(1, Math.min(1_000, Math.floor(input.limit!))) : 1_000;
      const matching = rows.slice(start);
      const events = matching.slice(0, limit);
      return {
        afterCursor,
        nextCursor: events.at(-1)?.cursor ?? afterCursor,
        hasMore: matching.length > events.length,
        events,
      };
    },
    subscribeEvents(input, listener) {
      const locator = normalizeTaskLocator(input);
      const path = taskSnapshotPath(root, locator);
      const listeners = taskEventListeners.get(path) ?? new Set();
      listeners.add(listener);
      taskEventListeners.set(path, listeners);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) taskEventListeners.delete(path);
      };
    },
  };
}
