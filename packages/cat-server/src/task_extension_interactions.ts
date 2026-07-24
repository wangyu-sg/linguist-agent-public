import { randomUUID } from "node:crypto";
import type {
  EventBus,
  ExtensionUIContext,
  ExtensionUIDialogOptions,
} from "@earendil-works/pi-coding-agent";
import {
  createTaskWorkspace,
  type TaskDecision,
  type TaskDecisionRequestProvenance,
  type TaskRunEventDraft,
  type TaskRunStatus,
  type TaskScope,
  TaskWorkspaceConflictError,
  type TaskWorkspaceSnapshot,
} from "@linguist-agent/cat-data";
import { bindTaskDecision } from "./task_decision_binding.js";
import { executeTaskDecisionInteraction } from "./task_decision_interactions.js";
import { TaskDecisionExecutionError } from "./task_decision_executor.js";

export const PI_ASK_STARTED_EVENT = "@eko24ive/pi-ask:started";
export const PI_ASK_SUBMIT_EVENT = "@eko24ive/pi-ask:submit";
export const PI_ASK_SUBMIT_RESULT_EVENT = "@eko24ive/pi-ask:submit-result";

export interface TaskExtensionInteractionHostInput {
  repoRoot: string;
  projectId: string;
  taskId: string;
  runId: string;
  agentThreadId: string;
  /** Static caller identity attested by the server-owned child transport. */
  requestProvenance?: TaskDecisionRequestProvenance;
  now?: () => string;
  createInteractionId?: () => string;
  piAskSubmitTimeoutMs?: number;
  fatalContainmentTimeoutMs?: number;
  onFatalError?: (error: Error) => void | Promise<void>;
}

export interface TaskExtensionFatalPersistenceResult {
  canonicalFailurePersisted: boolean;
  error?: Error;
}

export class TaskExtensionFatalPersistenceError extends AggregateError {
  constructor(hostError: Error | undefined, fallbackError: unknown) {
    super([
      hostError ?? new Error("The Package interaction host did not confirm canonical failure persistence."),
      fallbackError instanceof Error ? fallbackError : new Error(String(fallbackError)),
    ], "Task Run failure could not be persisted by either the Package interaction host or the canonical fallback.");
    this.name = "TaskExtensionFatalPersistenceError";
  }
}

export async function completeTaskExtensionFatalFailure(input: {
  fatalPersistence: TaskExtensionFatalPersistenceResult | undefined;
  emitRaw: () => void;
  persistFallback: () => Promise<void>;
}): Promise<"canonical" | "fallback"> {
  if (input.fatalPersistence?.canonicalFailurePersisted) {
    input.emitRaw();
    return "canonical";
  }
  try {
    await input.persistFallback();
  } catch (error) {
    throw new TaskExtensionFatalPersistenceError(input.fatalPersistence?.error, error);
  }
  input.emitRaw();
  return "fallback";
}

export interface TaskExtensionInteractionHost {
  uiContext: ExtensionUIContext;
  bindEvents(events: EventBus): void;
  flush(): Promise<void>;
  fatalPersistence(): Promise<TaskExtensionFatalPersistenceResult | undefined>;
  prepareStop(reason?: string): Promise<void>;
  dispose(): Promise<void>;
}

type InteractionAction = "submit" | "elaborate" | "cancel";
type GenericKind = "select" | "confirm" | "input" | "editor";

interface PendingInteraction {
  kind: GenericKind | "pi-ask";
  settle(snapshot: TaskWorkspaceSnapshot, action: InteractionAction): Promise<TaskWorkspaceSnapshot | undefined>;
  cancel(reason: string): Promise<void>;
  abandon(): void;
}

interface PiAskOption {
  value: string;
  label: string;
  description?: string;
  preview?: string;
}

interface PiAskQuestion {
  id: string;
  prompt: string;
  type: "single" | "multi" | "preview";
  options: PiAskOption[];
}

interface PiAskStartedEvent {
  version: 1;
  flowId: string;
  questions: PiAskQuestion[];
}

interface HostState {
  pendingKeys: Set<string>;
  stopping: boolean;
  stopRequested: boolean;
  disposed: boolean;
}

const pendingInteractions = new Map<string, PendingInteraction>();
const TERMINAL_RUN_STATUSES = new Set<TaskRunStatus>(["stopped", "failed", "stale", "complete"]);
const PACKAGE_BRIDGE_FAILURE_TITLE = "Package interaction failed";
const PACKAGE_BRIDGE_FAILURE_BODY = "The native Package response bridge did not acknowledge the committed answer.";
const PACKAGE_BRIDGE_FAILURE_REASON = "Package interaction failed before the Run could continue.";
const PACKAGE_FATAL_FALLBACK_BODY = "The native Package interaction host could not persist its failure. Retry starts a new Run; this Run is preserved as failed.";
const DEFAULT_FATAL_CONTAINMENT_TIMEOUT_MS = 1_000;
const NATIVE_INTERACTION_PREFIXES = ["native-ui:", "pi-ask:"] as const;

function pendingKey(projectId: string, taskId: string, runId: string, interactionId: string): string {
  return `${projectId}\u0000${taskId}\u0000${runId}\u0000${interactionId}`;
}

function activeInteraction(snapshot: TaskWorkspaceSnapshot, interactionId: string): TaskDecision[] {
  return snapshot.decisions.filter((decision) => decision.interactionId === interactionId);
}

function isNativeInteractionId(value: string | null | undefined): boolean {
  return Boolean(value && NATIVE_INTERACTION_PREFIXES.some((prefix) => value.startsWith(prefix)));
}

/**
 * Last-resort containment for a fatal Extension UI bridge error. The primary
 * host normally persists this transition itself. If that append is not
 * confirmed, this path writes the failed lifecycle, native Decision
 * cancellations, and diagnostic Activity as one generated event page so a
 * reconnect can never present an answerable question on a failed Run.
 */
export async function persistTaskExtensionFatalFallback(input: {
  repoRoot: string;
  projectId: string;
  taskId: string;
  runId: string;
  failedAt?: string;
}): Promise<TaskWorkspaceSnapshot> {
  const workspace = createTaskWorkspace(input.repoRoot);
  const activityId = `${input.runId}.extension-fatal-fallback`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await workspace.open({ projectId: input.projectId, taskId: input.taskId });
    const run = snapshot.runs.find((candidate) => candidate.id === input.runId);
    if (!run) throw new Error(`Task Run ${input.runId} fatal fallback scope is unavailable.`);
    const thread = snapshot.agentThreads.find((candidate) => candidate.id === run.rootAgentThreadId);
    if (!thread || thread.runId !== run.id) {
      throw new Error(`Task Run ${input.runId} root Agent thread is unavailable.`);
    }
    const failedAt = input.failedAt ?? new Date().toISOString();
    const requiredNative = snapshot.decisions.filter((decision) => (
      decision.runId === input.runId
      && decision.status === "required"
      && isNativeInteractionId(decision.interactionId)
    ));
    const capturedCursor = snapshot.eventCursor;
    const events: TaskRunEventDraft[] = [{
      type: "run_upsert",
      agentThreadId: thread.id,
      run: {
        ...run,
        status: "failed",
        updatedAt: failedAt,
        completedAt: failedAt,
        stopAvailable: false,
        resumeAvailable: false,
      },
    }, {
      type: "thread_upsert",
      agentThreadId: thread.id,
      thread: { ...thread, status: "failed", updatedAt: failedAt },
    }, ...requiredNative.map((decision): TaskRunEventDraft => ({
      type: "decision_upsert",
      agentThreadId: decision.requestedByThreadId,
      decision: {
        ...decision,
        status: "cancelled",
        reason: PACKAGE_BRIDGE_FAILURE_REASON,
        decidedAt: failedAt,
      },
    })), {
      type: "activity_append",
      agentThreadId: thread.id,
      activity: {
        id: activityId,
        taskId: input.taskId,
        runId: input.runId,
        agentThreadId: thread.id,
        seq: 0,
        type: "error",
        status: "error",
        actor: { kind: "system", id: "pi-extension", displayName: "Pi Package", agentThreadId: thread.id },
        title: PACKAGE_BRIDGE_FAILURE_TITLE,
        body: PACKAGE_FATAL_FALLBACK_BODY,
        tool: null,
        refs: { artifactIds: [], evidenceRefs: [], decisionIds: requiredNative.map((decision) => decision.id) },
        createdAt: failedAt,
        updatedAt: failedAt,
      },
    }];
    try {
      return await workspace.appendGenerated({
        projectId: input.projectId,
        taskId: input.taskId,
        runId: input.runId,
        expectedRequiredDecisionIds: requiredNative.map((decision) => decision.id),
        beforeCommit: async () => {
          const latest = await workspace.open({ projectId: input.projectId, taskId: input.taskId });
          if (latest.eventCursor !== capturedCursor) {
            throw new TaskWorkspaceConflictError(`Task ${input.taskId} changed before fatal Package fallback persistence.`);
          }
        },
        events,
      });
    } catch (error) {
      if (!(error instanceof TaskWorkspaceConflictError) || attempt === 1) throw error;
    }
  }
  throw new Error(`Task Run ${input.runId} fatal Package fallback could not be persisted.`);
}

function lifecycleEvents(
  snapshot: TaskWorkspaceSnapshot,
  input: TaskExtensionInteractionHostInput,
  status: Extract<TaskRunStatus, "active" | "awaiting_input" | "stopping">,
  timestamp: string,
): TaskRunEventDraft[] {
  const run = snapshot.runs.find((candidate) => candidate.id === input.runId);
  const thread = snapshot.agentThreads.find((candidate) => candidate.id === input.agentThreadId);
  if (!run || !thread || thread.runId !== run.id) throw new Error(`Task Run ${input.runId} interaction scope is unavailable.`);
  return [{
    type: "run_upsert",
    agentThreadId: input.agentThreadId,
    run: {
      ...run,
      status,
      updatedAt: timestamp,
      stopAvailable: status !== "stopping",
    },
  }, {
    type: "thread_upsert",
    agentThreadId: input.agentThreadId,
    thread: { ...thread, status, updatedAt: timestamp },
  }];
}

function singleFlightSettlement(settle: PendingInteraction["settle"]): PendingInteraction["settle"] {
  let result: ReturnType<PendingInteraction["settle"]> | undefined;
  return (snapshot, action) => result ??= settle(snapshot, action);
}

async function settleWithinBudget(work: Promise<unknown>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      work.then(() => undefined, () => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, Math.max(1, timeoutMs));
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function observeFatalPersistenceWithinBudget(
  work: Promise<unknown>,
  timeoutMs: number,
): Promise<TaskExtensionFatalPersistenceResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work.then<TaskExtensionFatalPersistenceResult, TaskExtensionFatalPersistenceResult>(
        () => ({ canonicalFailurePersisted: true }),
        (error: unknown) => ({
          canonicalFailurePersisted: false,
          error: error instanceof Error ? error : new Error(String(error)),
        }),
      ),
      new Promise<TaskExtensionFatalPersistenceResult>((resolve) => {
        timer = setTimeout(() => resolve({
          canonicalFailurePersisted: false,
          error: new Error(`Canonical Package interaction failure persistence timed out after ${Math.max(1, timeoutMs)}ms.`),
        }), Math.max(1, timeoutMs));
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function interactionAction(body: unknown): InteractionAction {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const action = (body as Record<string, unknown>).action;
    if (action === "submit" || action === "elaborate" || action === "cancel") return action;
  }
  throw new Error("Task interaction action was not validated.");
}

export async function commitTaskExtensionInteraction(input: {
  repoRoot: string;
  projectId: string;
  taskId: string;
  interactionId: string;
  body: unknown;
}) {
  const before = await createTaskWorkspace(input.repoRoot).open({ projectId: input.projectId, taskId: input.taskId });
  const beforeInteraction = activeInteraction(before, input.interactionId);
  if (beforeInteraction.length) {
    const runIds = new Set(beforeInteraction.map((decision) => decision.runId));
    const runId = runIds.size === 1 ? [...runIds][0]! : "";
    if (!runId || !pendingInteractions.has(pendingKey(input.projectId, input.taskId, runId, input.interactionId))) {
      throw new TaskDecisionExecutionError(409, `Decision interaction ${input.interactionId} is not active in this runtime.`);
    }
  }
  let result = await executeTaskDecisionInteraction(input);
  const action = interactionAction(input.body);
  const decisions = activeInteraction(result.snapshot, result.interactionId);
  const runIds = new Set(decisions.map((decision) => decision.runId));
  if (runIds.size === 1) {
    const runId = [...runIds][0]!;
    const pending = pendingInteractions.get(pendingKey(input.projectId, input.taskId, runId, result.interactionId));
    if (pending && (result.pendingDecisionIds.length === 0 || (pending.kind === "pi-ask" && action === "elaborate"))) {
      const snapshot = await pending.settle(result.snapshot, action);
      if (snapshot) {
        result = {
          ...result,
          snapshot,
          pendingDecisionIds: activeInteraction(snapshot, result.interactionId)
            .filter((decision) => decision.status === "required")
            .map((decision) => decision.id),
        };
      }
    }
  }
  return result;
}

function questionDecision(input: TaskExtensionInteractionHostInput, scope: TaskScope, runPlanHash: string | null | undefined, interactionId: string, kind: GenericKind, title: string, detail: string | undefined, options: string[]): TaskDecision {
  const createdAt = (input.now ?? (() => new Date().toISOString()))();
  const choiceOptions = kind === "confirm"
    ? [
        { id: "yes", label: "Yes", action: "answer" as const, destructive: false },
        { id: "no", label: "No", action: "answer" as const, destructive: false },
      ]
    : kind === "select"
      ? options.map((label, index) => ({ id: `option-${index + 1}`, label, action: "answer" as const, destructive: false }))
      : [{ id: "freeform", label: "Response", action: "answer" as const, destructive: false, description: detail ?? null }];
  return bindTaskDecision({
    id: `${interactionId}.question-1`,
    taskId: input.taskId,
    runId: input.runId,
    requestedByThreadId: input.agentThreadId,
    ...(input.requestProvenance ? { requestProvenance: input.requestProvenance } : {}),
    artifactId: null,
    kind: "answer",
    status: "required",
    prompt: detail && kind === "confirm" ? `${title}\n\n${detail}` : title,
    options: choiceOptions,
    interactionId,
    questionIndex: 0,
    selectionMode: kind === "input" || kind === "editor" ? "freeform" : "single",
    selectedOptionId: null,
    selectedOptionIds: [],
    responseText: null,
    reason: null,
    scope,
    createdAt,
    decidedAt: null,
  }, { runPlanHash });
}

function cancellationValue(kind: GenericKind): string | boolean | undefined {
  return kind === "confirm" ? false : undefined;
}

function plainObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

function parsePiAskStarted(value: unknown): PiAskStartedEvent {
  const row = plainObject(value, "pi-ask started event");
  if (row.version !== 1) throw new Error("pi-ask started event version must be 1.");
  if (!Array.isArray(row.questions) || row.questions.length < 1 || row.questions.length > 4) {
    throw new Error("pi-ask started event must contain 1-4 questions.");
  }
  const questionIds = new Set<string>();
  const questions = row.questions.map((entry, questionIndex): PiAskQuestion => {
    const question = plainObject(entry, `pi-ask question ${questionIndex + 1}`);
    const id = requiredString(question.id, `pi-ask question ${questionIndex + 1} id`);
    if (questionIds.has(id)) throw new Error(`pi-ask question id ${id} must be unique.`);
    questionIds.add(id);
    const type = question.type;
    if (type !== "single" && type !== "multi" && type !== "preview") throw new Error(`pi-ask question ${id} type is invalid.`);
    if (!Array.isArray(question.options) || question.options.length === 0) throw new Error(`pi-ask question ${id} requires options.`);
    const values = new Set<string>();
    const options = question.options.map((optionEntry, optionIndex): PiAskOption => {
      const option = plainObject(optionEntry, `pi-ask question ${id} option ${optionIndex + 1}`);
      const value = requiredString(option.value, `pi-ask question ${id} option value`);
      if (values.has(value)) throw new Error(`pi-ask question ${id} option value ${value} must be unique.`);
      values.add(value);
      return {
        value,
        label: requiredString(option.label, `pi-ask question ${id} option label`),
        description: typeof option.description === "string" && option.description.trim() ? option.description.trim() : undefined,
        preview: typeof option.preview === "string" && option.preview.trim() ? option.preview : undefined,
      };
    });
    return { id, prompt: requiredString(question.prompt, `pi-ask question ${id} prompt`), type, options };
  });
  return { version: 1, flowId: requiredString(row.flowId, "pi-ask flowId"), questions };
}

export function createTaskExtensionInteractionHost(input: TaskExtensionInteractionHostInput): TaskExtensionInteractionHost {
  const workspace = createTaskWorkspace(input.repoRoot);
  const state: HostState = { pendingKeys: new Set(), stopping: false, stopRequested: false, disposed: false };
  let persistenceQueue = Promise.resolve();
  let persistenceError: unknown;
  let editorText = "";
  let eventBus: EventBus | undefined;
  const submitAcks = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
  const unsubscribers: Array<() => void> = [];
  const unsupportedUiMethods = new Set<string>();

  const rejectSubmitAcks = (reason: string): void => {
    const error = new Error(reason);
    for (const waiter of submitAcks.values()) waiter.reject(error);
    submitAcks.clear();
  };

  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const result = persistenceQueue.then(work);
    persistenceQueue = result.then(() => undefined, (error) => { persistenceError = error; });
    return result;
  };

  const restoreActive = async (_snapshot: TaskWorkspaceSnapshot): Promise<TaskWorkspaceSnapshot> => {
    // Tool completion and Activity projection can race the Package submit ack.
    // Re-evaluate the latest canonical snapshot after each cursor conflict:
    // unrelated events must not strand the Run in awaiting_input, while a new
    // required Decision must continue to own the waiting lifecycle.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const current = await workspace.open({ projectId: input.projectId, taskId: input.taskId });
      if (state.stopping || state.disposed || current.decisions.some((decision) => decision.runId === input.runId && decision.status === "required")) {
        return current;
      }
      const run = current.runs.find((candidate) => candidate.id === input.runId);
      if (!run || TERMINAL_RUN_STATUSES.has(run.status) || (run.status !== "awaiting_input" && run.status !== "waiting")) return current;
      const capturedCursor = current.eventCursor;
      const timestamp = (input.now ?? (() => new Date().toISOString()))();
      try {
        return await workspace.appendGenerated({
          projectId: input.projectId,
          taskId: input.taskId,
          runId: input.runId,
          beforeCommit: async () => {
            const latest = await workspace.open({ projectId: input.projectId, taskId: input.taskId });
            if (latest.eventCursor !== capturedCursor) {
              throw new TaskWorkspaceConflictError(`Task ${input.taskId} changed before the interaction could restore active lifecycle.`);
            }
          },
          events: lifecycleEvents(current, input, "active", timestamp),
        });
      } catch (error) {
        if (!(error instanceof TaskWorkspaceConflictError)) throw error;
        if (attempt === 7) {
          throw new TaskWorkspaceConflictError(`Task ${input.taskId} kept changing before the interaction could restore active lifecycle.`);
        }
      }
    }
    throw new TaskWorkspaceConflictError(`Task ${input.taskId} could not restore active lifecycle.`);
  };

  const appendNotification = async (message: string, type: "warning" | "error", title = `Package ${type}`) => {
    const timestamp = (input.now ?? (() => new Date().toISOString()))();
    await workspace.appendGenerated({
      projectId: input.projectId,
      taskId: input.taskId,
      runId: input.runId,
      events: [{
        type: "activity_append",
        agentThreadId: input.agentThreadId,
        activity: {
          id: `${input.runId}.extension-notification.${randomUUID()}`,
          taskId: input.taskId,
          runId: input.runId,
          agentThreadId: input.agentThreadId,
          seq: 0,
          type: type === "error" ? "error" : "progress",
          status: type === "error" ? "error" : "done",
          actor: { kind: "system", id: "pi-extension", displayName: "Pi Package", agentThreadId: input.agentThreadId },
          title,
          body: message,
          tool: null,
          refs: { artifactIds: [], evidenceRefs: [], decisionIds: [] },
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      }],
    });
  };

  const failRunForExtensionBridge = async (recordedDecisionIds: string[]): Promise<TaskWorkspaceSnapshot> => {
    const activityId = `${input.runId}.extension-response-bridge.${randomUUID()}`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const snapshot = await workspace.open({ projectId: input.projectId, taskId: input.taskId });
      const run = snapshot.runs.find((candidate) => candidate.id === input.runId);
      const thread = snapshot.agentThreads.find((candidate) => candidate.id === input.agentThreadId);
      if (!run || !thread || thread.runId !== run.id) {
        throw new Error(`Task Run ${input.runId} interaction scope is unavailable.`);
      }
      const timestamp = (input.now ?? (() => new Date().toISOString()))();
      const requiredNative = snapshot.decisions.filter((decision) => (
        decision.runId === input.runId
        && decision.status === "required"
        && isNativeInteractionId(decision.interactionId)
      ));
      const referencedDecisionIds = Array.from(new Set([
        ...recordedDecisionIds,
        ...requiredNative.map((decision) => decision.id),
      ]));
      const stopOwnsLifecycle = state.stopRequested || run.status === "stopping" || run.status === "stopped";
      const alreadyTerminal = TERMINAL_RUN_STATUSES.has(run.status);
      const events: TaskRunEventDraft[] = [
        ...(!stopOwnsLifecycle && !alreadyTerminal ? [{
          type: "run_upsert" as const,
          agentThreadId: input.agentThreadId,
          run: {
            ...run,
            status: "failed" as const,
            updatedAt: timestamp,
            completedAt: timestamp,
            stopAvailable: false,
            resumeAvailable: false,
          },
        }, {
          type: "thread_upsert" as const,
          agentThreadId: input.agentThreadId,
          thread: { ...thread, status: "failed" as const, updatedAt: timestamp },
        }] : []),
        ...requiredNative.map((decision): TaskRunEventDraft => ({
          type: "decision_upsert",
          agentThreadId: decision.requestedByThreadId,
          decision: {
            ...decision,
            status: "cancelled",
            reason: PACKAGE_BRIDGE_FAILURE_REASON,
            decidedAt: timestamp,
          },
        })),
        {
          type: "activity_append",
          agentThreadId: input.agentThreadId,
          activity: {
            id: activityId,
            taskId: input.taskId,
            runId: input.runId,
            agentThreadId: input.agentThreadId,
            seq: 0,
            type: "error",
            status: "error",
            actor: { kind: "system", id: "pi-extension", displayName: "Pi Package", agentThreadId: input.agentThreadId },
            title: PACKAGE_BRIDGE_FAILURE_TITLE,
            body: PACKAGE_BRIDGE_FAILURE_BODY,
            tool: null,
            refs: { artifactIds: [], evidenceRefs: [], decisionIds: referencedDecisionIds },
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        },
      ];
      try {
        return await workspace.appendGenerated({
          projectId: input.projectId,
          taskId: input.taskId,
          runId: input.runId,
          expectedRequiredDecisionIds: requiredNative.map((decision) => decision.id),
          events,
        });
      } catch (error) {
        if (!(error instanceof TaskWorkspaceConflictError) || attempt === 1) throw error;
      }
    }
    throw new Error(`Task Run ${input.runId} could not record the Package interaction failure.`);
  };

  let fatalContainmentPromise: Promise<TaskExtensionFatalPersistenceResult> | undefined;
  // EventBus callbacks are dispatched asynchronously by Pi. Keep their
  // registration work in a small host-owned lane so `flush()` cannot observe
  // the persistence queue as idle before a callback has entered the fatal
  // containment path.
  let eventHandlerQueue = Promise.resolve();
  const fatalOnce = (fatalError: Error, recordedDecisionIds: string[] = []): Promise<TaskExtensionFatalPersistenceResult> => {
    if (fatalContainmentPromise) return fatalContainmentPromise;
    state.stopping = true;
    rejectSubmitAcks(PACKAGE_BRIDGE_FAILURE_REASON);
    const timeoutMs = input.fatalContainmentTimeoutMs ?? DEFAULT_FATAL_CONTAINMENT_TIMEOUT_MS;
    const persistence = failRunForExtensionBridge(recordedDecisionIds);
    const abort = Promise.resolve().then(() => input.onFatalError?.(fatalError));
    fatalContainmentPromise = observeFatalPersistenceWithinBudget(
      persistence,
      timeoutMs,
    );
    void settleWithinBudget(abort, timeoutMs);
    return fatalContainmentPromise;
  };

  const request = (kind: GenericKind, title: string, detail: string | undefined, options: string[], dialog?: ExtensionUIDialogOptions): Promise<string | boolean | undefined> => {
    if (state.stopping || state.disposed || dialog?.signal?.aborted) return Promise.resolve(cancellationValue(kind));
    let resolveResult!: (value: string | boolean | undefined) => void;
    let rejectResult!: (error: unknown) => void;
    const response = new Promise<string | boolean | undefined>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    const ready = enqueue(async () => {
      const interactionId = (input.createInteractionId ?? (() => `native-ui:${randomUUID()}`))();
      const snapshot = await workspace.open({ projectId: input.projectId, taskId: input.taskId });
      const decision = questionDecision(input, snapshot.task.scope, snapshot.runs.find((run) => run.id === input.runId)?.planHash, interactionId, kind, title, detail, options);
      const key = pendingKey(input.projectId, input.taskId, input.runId, interactionId);
      if (pendingInteractions.has(key)) throw new Error(`Task interaction ${interactionId} is already pending.`);
      let timer: ReturnType<typeof setTimeout> | undefined;
      let abort: (() => void) | undefined;
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        if (abort) dialog?.signal?.removeEventListener("abort", abort);
        pendingInteractions.delete(key);
        state.pendingKeys.delete(key);
      };
      const pending: PendingInteraction = {
        kind,
        settle: singleFlightSettlement(async (snapshot, action) => {
          const committed = snapshot.decisions.find((candidate) => candidate.id === decision.id);
          const resumed = await restoreActive(snapshot);
          cleanup();
          if (!committed || action === "cancel" || committed.status === "cancelled") {
            resolveResult(cancellationValue(kind));
          } else if (kind === "select") {
            resolveResult(committed.options.find((option) => option.id === committed.selectedOptionId)?.label);
          } else if (kind === "confirm") {
            resolveResult(committed.selectedOptionId === "yes");
          } else {
            resolveResult(committed.responseText ?? undefined);
          }
          return resumed;
        }),
        async cancel(reason) {
          if (!pendingInteractions.has(key)) return;
          await commitTaskExtensionInteraction({
            repoRoot: input.repoRoot,
            projectId: input.projectId,
            taskId: input.taskId,
            interactionId,
            body: { action: "cancel", reason },
          });
        },
        abandon() {
          cleanup();
          resolveResult(cancellationValue(kind));
        },
      };
      pendingInteractions.set(key, pending);
      state.pendingKeys.add(key);
      try {
        await workspace.appendGenerated({
          projectId: input.projectId,
          taskId: input.taskId,
          runId: input.runId,
          events: [
            ...lifecycleEvents(snapshot, input, "awaiting_input", decision.createdAt),
            { type: "decision_upsert", agentThreadId: input.agentThreadId, decision },
          ],
        });
      } catch (error) {
        cleanup();
        throw error;
      }
      abort = () => { void pending.cancel("Extension interaction aborted.").catch(rejectResult); };
      dialog?.signal?.addEventListener("abort", abort, { once: true });
      if (dialog?.timeout && dialog.timeout > 0) {
        timer = setTimeout(() => { void pending.cancel("Extension interaction timed out.").catch(rejectResult); }, dialog.timeout);
      }
      if (state.stopping || state.disposed || dialog?.signal?.aborted) await pending.cancel("Extension interaction cancelled.");
    });
    void ready.catch(rejectResult);
    return response;
  };

  const registerPiAsk = async (value: unknown) => {
    const started = parsePiAskStarted(value);
    const events = eventBus;
    if (!events) throw new Error("pi-ask requires the Task Session event bus.");
    const interactionId = `pi-ask:${started.flowId}`;
    const key = pendingKey(input.projectId, input.taskId, input.runId, interactionId);
    if (pendingInteractions.has(key)) throw new Error(`Task interaction ${interactionId} is already pending.`);
    const snapshot = await workspace.open({ projectId: input.projectId, taskId: input.taskId });
    const createdAt = (input.now ?? (() => new Date().toISOString()))();
    const mapped = started.questions.map((question, questionIndex) => {
      const decisionId = `${interactionId}.question-${questionIndex + 1}`;
      const canonicalToValue = new Map(question.options.map((option, optionIndex) => [`choice-${optionIndex + 1}`, option.value]));
      const decision = bindTaskDecision({
        id: decisionId,
        taskId: input.taskId,
        runId: input.runId,
        requestedByThreadId: input.agentThreadId,
        ...(input.requestProvenance ? { requestProvenance: input.requestProvenance } : {}),
        artifactId: null,
        kind: "answer",
        status: "required",
        prompt: question.prompt,
        options: [
          ...question.options.map((option, optionIndex) => ({
            id: `choice-${optionIndex + 1}`,
            label: option.label,
            action: "answer" as const,
            destructive: false,
            description: option.description ?? null,
            preview: option.preview ?? null,
          })),
          { id: "freeform", label: "Other", action: "answer" as const, destructive: false },
        ],
        interactionId,
        questionIndex,
        selectionMode: question.type === "multi" ? "multiple" : "single",
        selectedOptionId: null,
        selectedOptionIds: [],
        responseText: null,
        reason: null,
        scope: snapshot.task.scope,
        createdAt,
        decidedAt: null,
      }, { runPlanHash: snapshot.runs.find((run) => run.id === input.runId)?.planHash });
      return { question, decision, canonicalToValue };
    });
    const cleanup = () => {
      pendingInteractions.delete(key);
      state.pendingKeys.delete(key);
    };
    const pending: PendingInteraction = {
      kind: "pi-ask",
      settle: singleFlightSettlement(async (snapshot, action) => {
        let committed = snapshot;
        if (action === "elaborate" && activeInteraction(committed, interactionId).some((decision) => decision.status === "required")) {
          committed = (await executeTaskDecisionInteraction({
            repoRoot: input.repoRoot,
            projectId: input.projectId,
            taskId: input.taskId,
            interactionId,
            body: { action: "cancel", reason: "Elaboration ends the current ask flow." },
          })).snapshot;
        }
        const response = action === "cancel"
          ? { kind: "cancel" as const }
          : {
              kind: "answer" as const,
              mode: action === "elaborate" ? "elaborate" as const : "submit" as const,
              answers: Object.fromEntries(mapped.flatMap(({ question, decision, canonicalToValue }) => {
                const answer = committed.decisions.find((candidate) => candidate.id === decision.id);
                if (!answer || answer.status !== "recorded") return [];
                const selected = answer.selectedOptionIds ?? (answer.selectedOptionId ? [answer.selectedOptionId] : []);
                const values = selected.flatMap((optionId) => canonicalToValue.get(optionId) ?? []);
                const freeform = selected.includes("freeform");
                return [[question.id, {
                  values,
                  ...(action === "elaborate" && answer.responseText ? { note: answer.responseText } : {}),
                  ...(action !== "elaborate" && freeform && answer.responseText ? { customText: answer.responseText } : {}),
                  ...(action !== "elaborate" && !freeform && answer.responseText ? { note: answer.responseText } : {}),
                }]];
              })),
            };
        if (state.stopping || state.disposed) {
          cleanup();
          return committed;
        }
        const requestId = `${interactionId}:${randomUUID()}`;
        const acknowledged = new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error(`pi-ask submit ${requestId} timed out.`)),
            input.piAskSubmitTimeoutMs ?? 5_000,
          );
          submitAcks.set(requestId, {
            resolve: () => { clearTimeout(timer); resolve(); },
            reject: (error) => { clearTimeout(timer); reject(error); },
          });
        });
        try {
          try {
            events.emit(PI_ASK_SUBMIT_EVENT, { version: 1, flowId: started.flowId, requestId, response });
          } catch (error) {
            submitAcks.get(requestId)?.reject(error instanceof Error ? error : new Error(String(error)));
          }
          await acknowledged;
          const resumed = await restoreActive(committed);
          cleanup();
          return resumed;
        } catch (error) {
          cleanup();
          if (state.stopping || state.disposed) return committed;
          const fatalError = error instanceof Error ? error : new Error(String(error));
          const recordedDecisionIds = mapped
            .map(({ decision }) => committed.decisions.find((candidate) => candidate.id === decision.id))
            .filter((decision): decision is TaskDecision => decision?.status === "recorded")
            .map((decision) => decision.id);
          await fatalOnce(fatalError, recordedDecisionIds);
          throw fatalError;
        } finally {
          submitAcks.delete(requestId);
        }
      }),
      async cancel(reason) {
        if (!pendingInteractions.has(key)) return;
        await commitTaskExtensionInteraction({
          repoRoot: input.repoRoot,
          projectId: input.projectId,
          taskId: input.taskId,
          interactionId,
          body: { action: "cancel", reason },
        });
      },
      abandon: cleanup,
    };
    pendingInteractions.set(key, pending);
    state.pendingKeys.add(key);
    try {
      await workspace.appendGenerated({
        projectId: input.projectId,
        taskId: input.taskId,
        runId: input.runId,
        events: [
          ...lifecycleEvents(snapshot, input, "awaiting_input", createdAt),
          ...mapped.map(({ decision }) => ({ type: "decision_upsert" as const, agentThreadId: input.agentThreadId, decision })),
        ],
      });
    } catch (error) {
      cleanup();
      throw error;
    }
    if (state.stopping || state.disposed) await pending.cancel("Task Session is stopping.");
  };

  const reportUnsupportedUiMethod = (method: string, detail = "This Task host exposes only typed blocking decisions and CAT-safe artifacts."): void => {
    if (state.stopping || state.disposed || unsupportedUiMethods.has(method)) return;
    unsupportedUiMethods.add(method);
    void enqueue(() => appendNotification(`Package UI method ${method} was not rendered. ${detail}`, "warning", "Package UI diagnostic"));
  };
  const noOp = (method: string) => (..._args: unknown[]): void => {
    reportUnsupportedUiMethod(method);
  };
  const notify = (message: string, type: "info" | "warning" | "error" = "info") => {
    const body = message.trim();
    if (!body) return;
    if (type === "info") {
      reportUnsupportedUiMethod("notify", body);
      return;
    }
    void enqueue(() => appendNotification(body, type));
  };
  const identity = (text: string) => text;
  const headlessTheme = {
    name: "native",
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: identity,
    italic: identity,
    underline: identity,
    inverse: identity,
    strikethrough: identity,
    getFgAnsi: () => "",
    getBgAnsi: () => "",
    getColorMode: () => "truecolor" as const,
    getThinkingBorderColor: () => identity,
    getBashModeBorderColor: () => identity,
  } as unknown as ExtensionUIContext["theme"];
  const uiContext = {
    select: (title: string, options: string[], dialog?: ExtensionUIDialogOptions) => request("select", title, undefined, options, dialog) as Promise<string | undefined>,
    confirm: (title: string, message: string, dialog?: ExtensionUIDialogOptions) => request("confirm", title, message, [], dialog) as Promise<boolean>,
    input: (title: string, placeholder?: string, dialog?: ExtensionUIDialogOptions) => request("input", title, placeholder, [], dialog) as Promise<string | undefined>,
    editor: (title: string, prefill?: string) => request("editor", title, prefill, []) as Promise<string | undefined>,
    notify,
    onTerminalInput: () => { reportUnsupportedUiMethod("onTerminalInput"); return () => undefined; },
    setStatus: noOp("setStatus"),
    setWorkingMessage: noOp("setWorkingMessage"),
    setWorkingVisible: noOp("setWorkingVisible"),
    setWorkingIndicator: noOp("setWorkingIndicator"),
    setHiddenThinkingLabel: noOp("setHiddenThinkingLabel"),
    setWidget: noOp("setWidget"),
    setFooter: noOp("setFooter"),
    setHeader: noOp("setHeader"),
    setTitle: noOp("setTitle"),
    custom: async <T>() => {
      reportUnsupportedUiMethod("custom", "Arbitrary Package UI components cannot be injected into the native host.");
      throw new Error("Task Package custom UI is not supported by the native host.") as T;
    },
    pasteToEditor: (text: string) => { reportUnsupportedUiMethod("pasteToEditor", "The native composer does not accept hidden Package writes."); editorText += text; },
    setEditorText: (text: string) => { reportUnsupportedUiMethod("setEditorText", "The native composer does not accept hidden Package writes."); editorText = text; },
    getEditorText: () => { reportUnsupportedUiMethod("getEditorText", "The value is only a host-local suggestion and is not an authoritative CAT edit."); return editorText; },
    addAutocompleteProvider: noOp("addAutocompleteProvider"),
    setEditorComponent: noOp("setEditorComponent"),
    getEditorComponent: () => undefined,
    get theme() { return headlessTheme; },
    getAllThemes: () => [{ name: "native", path: undefined }],
    getTheme: (name: string) => name === "native" ? headlessTheme : undefined,
    setTheme: (theme: string | unknown) => typeof theme !== "string" || theme === "native"
      ? { success: true }
      : { success: false, error: "Native Task sessions own appearance." },
    getToolsExpanded: () => false,
    setToolsExpanded: noOp("setToolsExpanded"),
  } as ExtensionUIContext;

  const bindEvents = (events: EventBus) => {
    if (state.disposed || state.stopping) throw new Error("Task Extension interaction host is no longer active.");
    if (eventBus === events) return;
    if (eventBus) throw new Error("Task Extension interaction host already has an EventBus.");
    eventBus = events;
    unsubscribers.push(events.on(PI_ASK_STARTED_EVENT, (value) => {
      if (!state.stopping && !state.disposed) {
        eventHandlerQueue = eventHandlerQueue.then(async () => {
          try {
            await enqueue(() => registerPiAsk(value));
          } catch (error) {
            await fatalOnce(error instanceof Error ? error : new Error(String(error)));
          }
        });
      }
    }));
    unsubscribers.push(events.on(PI_ASK_SUBMIT_RESULT_EVENT, (value) => {
      try {
        const row = plainObject(value, "pi-ask submit result");
        const requestId = requiredString(row.requestId, "pi-ask submit result requestId");
        const waiter = submitAcks.get(requestId);
        if (!waiter) return;
        if (row.ok === true) waiter.resolve();
        else waiter.reject(new Error(requiredString(row.message, "pi-ask submit result message")));
      } catch (error) {
        persistenceError = error;
      }
    }));
  };

  let stopPromise: Promise<void> | undefined;
  const prepareStop = (reason = "Task Run is stopping.") => stopPromise ??= (async () => {
    state.stopping = true;
    state.stopRequested = true;
    rejectSubmitAcks(reason);
    await persistenceQueue;
    const pending = [...state.pendingKeys].map((key) => pendingInteractions.get(key)).filter((value): value is PendingInteraction => Boolean(value));
    let stopped: TaskWorkspaceSnapshot | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const snapshot = await workspace.open({ projectId: input.projectId, taskId: input.taskId });
      const timestamp = (input.now ?? (() => new Date().toISOString()))();
      const required = snapshot.decisions.filter((decision) => decision.runId === input.runId && decision.status === "required");
      const run = snapshot.runs.find((candidate) => candidate.id === input.runId);
      if (!run) throw new Error(`Task Run ${input.runId} interaction scope is unavailable.`);
      if (TERMINAL_RUN_STATUSES.has(run.status) && required.length === 0) {
        stopped = snapshot;
        break;
      }
      const events: TaskRunEventDraft[] = [
        ...(TERMINAL_RUN_STATUSES.has(run.status) ? [] : lifecycleEvents(snapshot, input, "stopping", timestamp)),
        ...required.map((decision): TaskRunEventDraft => ({
          type: "decision_upsert",
          agentThreadId: decision.requestedByThreadId,
          decision: { ...decision, status: "cancelled", reason, decidedAt: timestamp },
        })),
        ...required.map((decision): TaskRunEventDraft => ({
          type: "activity_append",
          agentThreadId: decision.requestedByThreadId,
          activity: {
            id: `${decision.id}.cancelled-by-stop`,
            taskId: input.taskId,
            runId: input.runId,
            agentThreadId: decision.requestedByThreadId,
            seq: 0,
            type: "decision",
            status: "done",
            actor: { kind: "human", id: "user", displayName: "User", agentThreadId: decision.requestedByThreadId },
            title: "Question cancelled",
            body: reason,
            tool: null,
            refs: { artifactIds: [], evidenceRefs: [], decisionIds: [decision.id] },
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        })),
      ];
      try {
        stopped = await workspace.appendGenerated({
          projectId: input.projectId,
          taskId: input.taskId,
          runId: input.runId,
          expectedRequiredDecisionIds: required.map((decision) => decision.id),
          events,
        });
        break;
      } catch (error) {
        if (!(error instanceof TaskWorkspaceConflictError) || attempt === 1) throw error;
      }
    }
    if (!stopped) throw new Error(`Task Run ${input.runId} could not enter stopping state.`);
    await Promise.allSettled(pending.map((interaction) => interaction.settle(stopped!, "cancel")));
  })();

  return {
    uiContext,
    bindEvents,
    async flush() {
      await persistenceQueue;
      await eventHandlerQueue;
      if (fatalContainmentPromise) await fatalContainmentPromise;
      if (persistenceError) throw persistenceError;
    },
    async fatalPersistence() {
      return fatalContainmentPromise ? await fatalContainmentPromise : undefined;
    },
    prepareStop,
    async dispose() {
      state.disposed = true;
      if (fatalContainmentPromise) {
        rejectSubmitAcks("Task Session disposed after a fatal Package interaction.");
        const pending = [...state.pendingKeys]
          .map((key) => pendingInteractions.get(key))
          .filter((value): value is PendingInteraction => Boolean(value));
        for (const interaction of pending) interaction.abandon();
      } else if (state.pendingKeys.size) {
        await prepareStop("Task Session disposed.");
      }
      for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
      eventBus = undefined;
    },
  };
}
