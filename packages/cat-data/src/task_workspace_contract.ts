export const TASK_WORKSPACE_SCHEMA_VERSION = 2 as const;

export type TaskKind = "translation" | "review" | "qa" | "delivery" | "eval" | "general";
export type TaskStatus = "draft" | "active" | "awaiting_input" | "stopped" | "failed" | "complete" | "archived";
export type TaskTitleGenerationStatus = "pending" | "generated" | "failed";
export type TaskRunMode = "single" | "team" | "pipeline" | "eval";
export type TaskRunStatus = "pending" | "active" | "awaiting_input" | "waiting" | "stopping" | "stopped" | "failed" | "stale" | "complete";
export type TaskAgentKind = "main" | "specialist" | "deterministic";
export type TaskActivityActorKind = "human" | "agent" | "system";
export type TaskActivityType =
  | "message"
  | "acknowledgement"
  | "plan"
  | "progress"
  | "evidence_read"
  | "tool_action"
  | "artifact_update"
  | "handoff"
  | "elicitation"
  | "decision"
  | "usage"
  | "error"
  | "final_response";
export type TaskActivityStatus = "pending" | "running" | "done" | "blocked" | "stale" | "error";
export type TaskToolEffect = "read" | "write" | "execute";
export type TaskArtifactType =
  | "segment_proposal"
  | "segment_diff"
  | "evidence_pack"
  | "agent_query"
  | "qa_finding"
  | "qa_report"
  | "delivery_readiness"
  | "delivery_export"
  | "eval_output"
  | "eval_scorecard"
  | "eval_comparison"
  | "context_handoff"
  | "memory"
  | "guidance"
  | "document_evidence"
  | "rich_document"
  | "maintenance_plan"
  | "package_audit"
  | "file"
  | "preview";
export type TaskArtifactStatus = "draft" | "reviewable" | "accepted" | "rejected" | "superseded" | "final";
export type TaskDecisionKind = "answer" | "approval" | "proposal_review" | "waiver" | "apply" | "delivery_authorization";
export type TaskDecisionStatus = "required" | "recorded" | "cancelled" | "superseded";
export type TaskDecisionAction = "answer" | "approve" | "reject" | "request_change" | "waive" | "apply" | "authorize_delivery";
export type TaskDecisionSelectionMode = "single" | "multiple" | "freeform";
export type TaskRunEventType = "run_upsert" | "thread_upsert" | "activity_append" | "artifact_upsert" | "decision_upsert" | "usage_update";
const TASK_PACKAGE_RESOURCE_TYPES = ["extension", "skill", "prompt"] as const;

export type TaskOwner =
  | { kind: "standalone" }
  | { kind: "project"; projectId: string };

export type TaskLocator =
  | { kind: "standalone"; taskId: string }
  | { kind: "project"; projectId: string; taskId: string };

export interface StandaloneTaskScope {
  kind: "standalone";
  workingDirectoryGrantId?: string;
  fileGrantIds: string[];
}

export interface ProjectTaskScope {
  kind: "project";
  batchId?: string | null;
  segmentIds: string[];
  sourceLocale?: string | null;
  targetLocale?: string | null;
}

export type TaskScope = StandaloneTaskScope | ProjectTaskScope;

export interface TaskRecord {
  id: string;
  owner: TaskOwner;
  scope: TaskScope;
  title: string;
  intent: string;
  kind: TaskKind;
  status: TaskStatus;
  titleGeneration?: TaskTitleGeneration;
  createdAt: string;
  updatedAt: string;
}

export function taskLocator(task: TaskRecord): TaskLocator {
  return task.owner.kind === "standalone"
    ? { kind: "standalone", taskId: task.id }
    : { kind: "project", projectId: task.owner.projectId, taskId: task.id };
}

export function projectIdForTask(task: TaskRecord): string | undefined {
  return task.owner.kind === "project" ? task.owner.projectId : undefined;
}

export function isProjectTaskScope(scope: TaskScope): scope is ProjectTaskScope {
  return scope.kind === "project";
}

export function isStandaloneTaskScope(scope: TaskScope): scope is StandaloneTaskScope {
  return scope.kind === "standalone";
}

export function requireProjectTaskScope(scope: TaskScope, label = "Task"): ProjectTaskScope {
  if (scope.kind !== "project") throw new Error(`${label} requires project scope.`);
  return scope;
}

export interface TaskUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  costUSD?: number;
  modelCalls?: number;
}

/** Stable server-owned keys such as `main` or `specialist:translator`. */
export type TaskUsageBySource = Record<string, TaskUsage>;
export type TaskEstimatedCallsBySource = Record<string, number>;

export interface TaskTitleGeneration {
  status: TaskTitleGenerationStatus;
  requestedAt: string;
  attemptId?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  provider?: string | null;
  modelId?: string | null;
  usage?: TaskUsage;
  error?: string | null;
}

export interface TaskRunResourcePackage {
  name: string;
  source: string;
  version: string;
  integrity: string;
}

/**
 * Redacted request-shape facts captured when a Run's Pi surface is compiled.
 * This is deliberately metadata-only: prompt bodies and provider payloads
 * never enter the canonical Task snapshot.
 */
export interface TaskRunRequestShapeSummary {
  schemaVersion: number;
  systemPromptChars: number;
  activeToolCount: number;
  resourceCount: number;
}

/** Complete hash-only request shape retained when Main is promoted to Team. */
export interface TaskRunRequestShapeManifest {
  schemaVersion: 2;
  systemPromptHash: string;
  toolSurfaceHash: string;
  resourceIndexHash: string;
  requestShapeHash: string;
  systemPromptChars: number;
  activeToolCount: number;
  resourceCount: number;
  activeToolNames: string[];
}

export interface TaskRunMainResourceSurface {
  packageNames: string[];
  requestShape: TaskRunRequestShapeManifest;
}

export interface TaskRunResourceManifest {
  schemaVersion?: 2;
  profile: string;
  piRuntimeVersion?: string;
  cwd?: string;
  fileGrantIds?: string[];
  packages: TaskRunResourcePackage[];
  activeToolNames: string[];
  conflicts?: Array<{
    kind: "tool" | "flag";
    name: string;
    winnerPath: string;
    shadowedPath: string;
  }>;
  /** Task Package intent captured when this Run was compiled. */
  profileRevision?: number | null;
  profileHash?: string | null;
  resources?: Array<{
    packageSource: string;
    resourceType: "extension" | "skill" | "prompt";
    resourceId: string;
    enabled: boolean;
  }>;
  requestShapeHash?: string | null;
  systemPromptHash?: string | null;
  toolSurfaceHash?: string | null;
  resourceIndexHash?: string | null;
  requestShape?: TaskRunRequestShapeSummary;
  mainSurface?: TaskRunMainResourceSurface;
}

export interface TaskRun {
  id: string;
  taskId: string;
  mode: TaskRunMode;
  status: TaskRunStatus;
  rootAgentThreadId: string;
  planHash?: string | null;
  estimatedCalls?: number | null;
  estimatedCallsBySource?: TaskEstimatedCallsBySource;
  modelRoutes?: Record<string, string>;
  startedAt?: string | null;
  updatedAt: string;
  completedAt?: string | null;
  stopAvailable: boolean;
  resumeAvailable: boolean;
  /** Server-derived total. Clients must not add these values themselves. */
  usage?: TaskUsage;
  usageBySource?: TaskUsageBySource;
  resourceManifest?: TaskRunResourceManifest;
}

export interface TaskActiveRunSummary {
  taskId: string;
  runId: string;
  status: TaskRunStatus;
  updatedAt: string;
  stopAvailable: boolean;
}

export interface TaskAgentIdentity {
  kind: TaskAgentKind;
  roleId: string;
  displayName: string;
  roleLabel: string;
  disclosureLabel: "Agent" | "System";
}

export interface TaskAgentThread {
  id: string;
  taskId: string;
  runId: string;
  parentThreadId?: string | null;
  identity: TaskAgentIdentity;
  status: TaskRunStatus;
  canReceiveUserMessage: boolean;
  handoffSummary?: string | null;
  latestActivityId?: string | null;
  childThreadIds: string[];
  /** Pi session identity owned by the server; enables resume/fork without replaying prose. */
  piSessionId?: string;
  piSessionFile?: string;
  piEntryId?: string;
  /** Pi entry selected when this canonical thread was forked. */
  branchPointEntryId?: string;
  branchPosition?: "before" | "at";
  createdAt: string;
  updatedAt: string;
}

export interface TaskActivityActor {
  kind: TaskActivityActorKind;
  id: string;
  displayName: string;
  agentThreadId?: string | null;
}

export interface TaskToolActivity {
  name: string;
  effect: TaskToolEffect;
  target?: string | null;
  outcome?: string | null;
}

export interface TaskActivityRefs {
  artifactIds: string[];
  evidenceRefs: string[];
  decisionIds: string[];
  /** Canonical segment scope for this individual activity, when narrower than the Task. */
  segmentIds?: string[];
}

export interface TaskActivity {
  id: string;
  taskId: string;
  runId: string;
  agentThreadId: string;
  seq: number;
  type: TaskActivityType;
  status: TaskActivityStatus;
  actor: TaskActivityActor;
  title: string;
  body?: string | null;
  tool?: TaskToolActivity | null;
  refs: TaskActivityRefs;
  createdAt: string;
  updatedAt: string;
}

export interface TaskArtifactProvenance {
  agentThreadId: string;
  activityId?: string | null;
  evidenceRefs: string[];
  parentArtifactIds: string[];
}

export interface TaskArtifact {
  id: string;
  taskId: string;
  runId: string;
  type: TaskArtifactType;
  status: TaskArtifactStatus;
  title: string;
  summary?: string | null;
  scope: TaskScope;
  version: number;
  provenance: TaskArtifactProvenance;
  availableDecisions: TaskDecisionAction[];
  content: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface TaskDecisionOption {
  id: string;
  label: string;
  action: TaskDecisionAction;
  destructive: boolean;
  description?: string | null;
  preview?: string | null;
}

/** Exact native caller identity for a Decision requested across a child bridge. */
export interface TaskDecisionRequestProvenance {
  kind: "package_extension";
  transport: "pi-rpc-v1";
  packageSource: string;
  packageName: string;
  packageVersion: string;
  resourceId: string;
  integrity: string;
}

export interface TaskDecision {
  id: string;
  taskId: string;
  runId: string;
  requestedByThreadId: string;
  requestProvenance?: TaskDecisionRequestProvenance;
  artifactId?: string | null;
  kind: TaskDecisionKind;
  status: TaskDecisionStatus;
  prompt: string;
  options: TaskDecisionOption[];
  interactionId?: string | null;
  questionIndex?: number | null;
  selectionMode?: TaskDecisionSelectionMode | null;
  selectedOptionId?: string | null;
  selectedOptionIds?: string[];
  responseText?: string | null;
  reason?: string | null;
  scope: TaskScope;
  createdAt: string;
  decidedAt?: string | null;
}

export interface TaskWorkspaceSnapshot {
  schemaVersion: typeof TASK_WORKSPACE_SCHEMA_VERSION;
  task: TaskRecord;
  activeRunId?: string | null;
  eventCursor: string;
  projectedAt: string;
  /** Server-derived total across title generation and every Run. */
  usage?: TaskUsage;
  runs: TaskRun[];
  agentThreads: TaskAgentThread[];
  activities: TaskActivity[];
  artifacts: TaskArtifact[];
  decisions: TaskDecision[];
}

/** Derived only from the snapshot's canonical active Run pointer. */
export function taskActiveRunSummary(snapshot: TaskWorkspaceSnapshot): TaskActiveRunSummary | null {
  if (!snapshot.activeRunId) return null;
  const run = snapshot.runs.find((candidate) => candidate.id === snapshot.activeRunId);
  return run ? {
    taskId: snapshot.task.id,
    runId: run.id,
    status: run.status,
    updatedAt: run.updatedAt,
    stopAvailable: run.stopAvailable,
  } : null;
}

export interface PendingInitialTaskRun {
  run: TaskRun;
  thread: TaskAgentThread;
  message: TaskActivity;
}

/**
 * The only recoverable pre-execution state created with a Task: one pending
 * Main Run and its exact durable human message. Callers may use the returned
 * Run id to claim or cancel that work, but must never infer a second chat
 * record from the Pi session.
 */
export function pendingInitialTaskRun(
  snapshot: TaskWorkspaceSnapshot,
  expectedMessage?: string,
  expectedRunId?: string,
): PendingInitialTaskRun | undefined {
  if (!snapshot.activeRunId) return undefined;
  const run = snapshot.runs.find((candidate) => candidate.id === snapshot.activeRunId);
  if (!run
    || run.mode !== "single"
    || run.status !== "pending"
    || run.startedAt != null
    || (expectedRunId !== undefined && run.id !== expectedRunId)) return undefined;
  const thread = snapshot.agentThreads.find((candidate) => candidate.id === run.rootAgentThreadId);
  if (!thread || thread.identity.kind !== "main" || thread.status !== "pending") return undefined;
  const activities = snapshot.activities.filter((activity) => activity.runId === run.id);
  const message = activities.length === 1 ? activities[0] : undefined;
  if (!message
    || message.type !== "message"
    || message.actor.kind !== "human"
    || message.body == null
    || (expectedMessage !== undefined && message.body !== expectedMessage.trim())) return undefined;
  return { run, thread, message };
}

export interface TaskRunEvent {
  id: string;
  cursor: string;
  seq: number;
  taskId: string;
  runId: string;
  agentThreadId?: string | null;
  type: TaskRunEventType;
  occurredAt: string;
  run?: TaskRun;
  thread?: TaskAgentThread;
  activity?: TaskActivity;
  artifact?: TaskArtifact;
  decision?: TaskDecision;
  /** Replaces one stable contribution instead of overwriting the Run total. */
  usageSource?: string;
  usage?: TaskUsage;
}

export interface TaskRunEventPage {
  schemaVersion: typeof TASK_WORKSPACE_SCHEMA_VERSION;
  taskId: string;
  runId: string;
  afterCursor?: string | null;
  nextCursor: string;
  hasMore: boolean;
  events: TaskRunEvent[];
}

type JsonObject = Record<string, unknown>;

const TASK_KINDS = ["translation", "review", "qa", "delivery", "eval", "general"] as const;
const TASK_STATUSES = ["draft", "active", "awaiting_input", "stopped", "failed", "complete", "archived"] as const;
const TITLE_GENERATION_STATUSES = ["pending", "generated", "failed"] as const;
const RUN_MODES = ["single", "team", "pipeline", "eval"] as const;
const RUN_STATUSES = ["pending", "active", "awaiting_input", "waiting", "stopping", "stopped", "failed", "stale", "complete"] as const;
const AGENT_KINDS = ["main", "specialist", "deterministic"] as const;
const ACTOR_KINDS = ["human", "agent", "system"] as const;
const ACTIVITY_TYPES = ["message", "acknowledgement", "plan", "progress", "evidence_read", "tool_action", "artifact_update", "handoff", "elicitation", "decision", "usage", "error", "final_response"] as const;
const ACTIVITY_STATUSES = ["pending", "running", "done", "blocked", "stale", "error"] as const;
const TOOL_EFFECTS = ["read", "write", "execute"] as const;
const ARTIFACT_TYPES = ["segment_proposal", "segment_diff", "evidence_pack", "agent_query", "qa_finding", "qa_report", "delivery_readiness", "delivery_export", "eval_output", "eval_scorecard", "eval_comparison", "context_handoff", "memory", "guidance", "document_evidence", "rich_document", "maintenance_plan", "package_audit", "file", "preview"] as const;
const ARTIFACT_STATUSES = ["draft", "reviewable", "accepted", "rejected", "superseded", "final"] as const;
const DECISION_KINDS = ["answer", "approval", "proposal_review", "waiver", "apply", "delivery_authorization"] as const;
const DECISION_STATUSES = ["required", "recorded", "cancelled", "superseded"] as const;
const DECISION_ACTIONS = ["answer", "approve", "reject", "request_change", "waive", "apply", "authorize_delivery"] as const;
const DECISION_SELECTION_MODES = ["single", "multiple", "freeform"] as const;
const EVENT_TYPES = ["run_upsert", "thread_upsert", "activity_append", "artifact_upsert", "decision_upsert", "usage_update"] as const;

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as JsonObject;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function optionalString(value: unknown, label: string): string | null | undefined {
  if (value === undefined || value === null) return value;
  return string(value, label);
}

function bool(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`);
  return value;
}

function integer(value: unknown, label: string, min = 0): number {
  const parsed = finiteNumber(value, label);
  if (!Number.isInteger(parsed) || parsed < min) throw new Error(`${label} must be an integer >= ${min}`);
  return parsed;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  return array(value, label).map((entry, index) => string(entry, `${label}[${index}]`));
}

function stringRecord(value: unknown, label: string): Record<string, string> {
  return Object.fromEntries(Object.entries(object(value, label)).map(([key, entry]) => [key, string(entry, `${label}.${key}`)]));
}

function enumValue<const T extends readonly string[]>(value: unknown, allowed: T, label: string): T[number] {
  const parsed = string(value, label);
  if (!allowed.includes(parsed)) throw new Error(`${label} has unsupported value ${parsed}`);
  return parsed as T[number];
}

function isoDate(value: unknown, label: string): string {
  const parsed = string(value, label);
  if (!Number.isFinite(Date.parse(parsed))) throw new Error(`${label} must be an ISO-8601 timestamp`);
  return parsed;
}

function optionalFiniteNumber(value: unknown, label: string): number | undefined {
  return value === undefined ? undefined : finiteNumber(value, label);
}

function parseScope(value: unknown, label: string): TaskScope {
  const row = object(value, label);
  const kind = enumValue(row.kind, ["standalone", "project"] as const, `${label}.kind`);
  if (kind === "standalone") {
    if (row.projectId !== undefined || row.batchId !== undefined || row.segmentIds !== undefined) {
      throw new Error(`${label}.standalone cannot contain project or CAT scope`);
    }
    return {
      kind,
      workingDirectoryGrantId: row.workingDirectoryGrantId === undefined
        ? undefined
        : string(row.workingDirectoryGrantId, `${label}.workingDirectoryGrantId`),
      fileGrantIds: stringArray(row.fileGrantIds, `${label}.fileGrantIds`),
    };
  }
  if (row.projectId !== undefined) throw new Error(`${label}.projectId was removed in schema v2; use Task owner`);
  return {
    kind,
    batchId: optionalString(row.batchId, `${label}.batchId`),
    segmentIds: stringArray(row.segmentIds, `${label}.segmentIds`),
    sourceLocale: optionalString(row.sourceLocale, `${label}.sourceLocale`),
    targetLocale: optionalString(row.targetLocale, `${label}.targetLocale`),
  };
}

function parseOwner(value: unknown, label: string): TaskOwner {
  const row = object(value, label);
  const kind = enumValue(row.kind, ["standalone", "project"] as const, `${label}.kind`);
  if (kind === "standalone") {
    if (row.projectId !== undefined) throw new Error(`${label}.standalone cannot contain projectId`);
    return { kind };
  }
  return { kind, projectId: string(row.projectId, `${label}.projectId`) };
}

function parseUsage(value: unknown, label: string): TaskUsage {
  const row = object(value, label);
  return {
    inputTokens: optionalFiniteNumber(row.inputTokens, `${label}.inputTokens`),
    outputTokens: optionalFiniteNumber(row.outputTokens, `${label}.outputTokens`),
    cacheReadTokens: optionalFiniteNumber(row.cacheReadTokens, `${label}.cacheReadTokens`),
    cacheWriteTokens: optionalFiniteNumber(row.cacheWriteTokens, `${label}.cacheWriteTokens`),
    totalTokens: optionalFiniteNumber(row.totalTokens, `${label}.totalTokens`),
    costUSD: optionalFiniteNumber(row.costUSD, `${label}.costUSD`),
    modelCalls: optionalFiniteNumber(row.modelCalls, `${label}.modelCalls`),
  };
}

const USAGE_KEYS = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "totalTokens", "costUSD", "modelCalls"] as const;

function usageSourceKey(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw new Error(`${label} must be a stable usage source key`);
  return value;
}

function parseUsageBySource(value: unknown, label: string): TaskUsageBySource {
  return Object.fromEntries(Object.entries(object(value, label)).map(([key, usage]) => [
    usageSourceKey(key, `${label} key`),
    parseUsage(usage, `${label}.${key}`),
  ]));
}

function parseEstimatedCallsBySource(value: unknown, label: string): TaskEstimatedCallsBySource {
  return Object.fromEntries(Object.entries(object(value, label)).map(([key, calls]) => [
    usageSourceKey(key, `${label} key`),
    integer(calls, `${label}.${key}`),
  ]));
}

function sumUsage(rows: Array<TaskUsage | undefined>): TaskUsage | undefined {
  const present = rows.filter((row): row is TaskUsage => row !== undefined);
  if (!present.length) return undefined;
  return Object.fromEntries(USAGE_KEYS.flatMap((key) => {
    const values = present.flatMap((row) => row[key] === undefined ? [] : [row[key]]);
    return values.length ? [[key, values.reduce((sum, value) => sum + value, 0)]] : [];
  })) as TaskUsage;
}

function parseTitleGeneration(value: unknown, label: string): TaskTitleGeneration {
  const row = object(value, label);
  const status = enumValue(row.status, TITLE_GENERATION_STATUSES, `${label}.status`);
  const attemptId = optionalString(row.attemptId, `${label}.attemptId`);
  const startedAt = row.startedAt === undefined || row.startedAt === null ? row.startedAt : isoDate(row.startedAt, `${label}.startedAt`);
  const completedAt = row.completedAt === undefined || row.completedAt === null ? row.completedAt : isoDate(row.completedAt, `${label}.completedAt`);
  const error = optionalString(row.error, `${label}.error`);
  if (status === "pending" && completedAt) throw new Error(`${label}.pending generation cannot be completed`);
  if (status !== "pending" && !completedAt) throw new Error(`${label}.${status} generation requires completedAt`);
  if (status === "generated" && error) throw new Error(`${label}.generated generation cannot contain an error`);
  if (status === "failed" && !error) throw new Error(`${label}.failed generation requires an error`);
  if (attemptId && !startedAt) throw new Error(`${label}.attemptId requires startedAt`);
  return {
    status,
    requestedAt: isoDate(row.requestedAt, `${label}.requestedAt`),
    attemptId,
    startedAt,
    completedAt,
    provider: optionalString(row.provider, `${label}.provider`),
    modelId: optionalString(row.modelId, `${label}.modelId`),
    usage: row.usage === undefined ? undefined : parseUsage(row.usage, `${label}.usage`),
    error,
  };
}

function parseResourceManifest(value: unknown, label: string): TaskRunResourceManifest {
  const row = object(value, label);
  const packages = array(row.packages, `${label}.packages`).map((entry, index): TaskRunResourcePackage => {
    const itemLabel = `${label}.packages[${index}]`;
    const item = object(entry, itemLabel);
    const source = string(item.source, `${itemLabel}.source`);
    if (!/^(?:npm:|git:|https:\/\/|ssh:\/\/|git@)/.test(source)) {
      throw new Error(`${itemLabel}.source must be an npm or git source`);
    }
    const integrity = string(item.integrity, `${itemLabel}.integrity`);
    if (!/^sha(?:256|512)-[A-Za-z0-9+/_=-]+$/.test(integrity)) {
      throw new Error(`${itemLabel}.integrity must be a verified hash`);
    }
    return {
      name: string(item.name, `${itemLabel}.name`),
      source,
      version: string(item.version, `${itemLabel}.version`),
      integrity,
    };
  });
  const packageNames = packages.map((entry) => entry.name);
  if (new Set(packageNames).size !== packageNames.length) throw new Error(`${label}.packages names must be unique`);
  const activeToolNames = stringArray(row.activeToolNames, `${label}.activeToolNames`);
  if (new Set(activeToolNames).size !== activeToolNames.length) throw new Error(`${label}.activeToolNames must be unique`);
  const requestShape = row.requestShape === undefined
    ? undefined
    : (() => {
        const shape = object(row.requestShape, `${label}.requestShape`);
        const parsed = {
          schemaVersion: integer(shape.schemaVersion, `${label}.requestShape.schemaVersion`, 1),
          systemPromptChars: integer(shape.systemPromptChars, `${label}.requestShape.systemPromptChars`),
          activeToolCount: integer(shape.activeToolCount, `${label}.requestShape.activeToolCount`),
          resourceCount: integer(shape.resourceCount, `${label}.requestShape.resourceCount`),
        };
        if (parsed.activeToolCount !== activeToolNames.length) {
          throw new Error(`${label}.requestShape.activeToolCount must match activeToolNames.length`);
        }
        return parsed;
      })();
  const profileRevision = row.profileRevision === undefined || row.profileRevision === null
    ? row.profileRevision
    : integer(row.profileRevision, `${label}.profileRevision`);
  const resources = row.resources === undefined
    ? undefined
    : array(row.resources, `${label}.resources`).map((entry, index) => {
        const itemLabel = `${label}.resources[${index}]`;
        const item = object(entry, itemLabel);
        const type = enumValue(item.resourceType, TASK_PACKAGE_RESOURCE_TYPES, `${itemLabel}.resourceType`);
        return {
          packageSource: string(item.packageSource, `${itemLabel}.packageSource`),
          resourceType: type as "extension" | "skill" | "prompt",
          resourceId: string(item.resourceId, `${itemLabel}.resourceId`),
          enabled: item.enabled === true,
        };
      });
  if (resources && new Set(resources.map((entry) => `${entry.packageSource}\u0000${entry.resourceType}\u0000${entry.resourceId}`)).size !== resources.length) {
    throw new Error(`${label}.resources must be unique`);
  }
  const parseRequestShape = (value: unknown, shapeLabel: string): TaskRunRequestShapeManifest => {
    const shape = object(value, shapeLabel);
    const hash = (key: string) => {
      const result = string(shape[key], `${shapeLabel}.${key}`);
      if (!/^[a-f0-9]{64}$/.test(result)) throw new Error(`${shapeLabel}.${key} must be a 64-character lowercase SHA-256 hash`);
      return result;
    };
    const count = (key: string) => {
      return integer(shape[key], `${shapeLabel}.${key}`);
    };
    const tools = stringArray(shape.activeToolNames, `${shapeLabel}.activeToolNames`);
    if (new Set(tools).size !== tools.length) throw new Error(`${shapeLabel}.activeToolNames must be unique`);
    const activeToolCount = count("activeToolCount");
    if (activeToolCount !== tools.length) throw new Error(`${shapeLabel}.activeToolCount must match activeToolNames`);
    if (shape.schemaVersion !== 2) throw new Error(`${shapeLabel}.schemaVersion must be 2`);
    return {
      schemaVersion: 2,
      systemPromptHash: hash("systemPromptHash"),
      toolSurfaceHash: hash("toolSurfaceHash"),
      resourceIndexHash: hash("resourceIndexHash"),
      requestShapeHash: hash("requestShapeHash"),
      systemPromptChars: count("systemPromptChars"),
      activeToolCount,
      resourceCount: count("resourceCount"),
      activeToolNames: tools,
    };
  };
  const mainSurface = row.mainSurface === undefined ? undefined : (() => {
    const surfaceLabel = `${label}.mainSurface`;
    const surface = object(row.mainSurface, surfaceLabel);
    const names = stringArray(surface.packageNames, `${surfaceLabel}.packageNames`);
    if (new Set(names).size !== names.length) throw new Error(`${surfaceLabel}.packageNames must be unique`);
    if (names.some((name) => !packageNames.includes(name))) throw new Error(`${surfaceLabel}.packageNames must reference manifest packages`);
    return { packageNames: names, requestShape: parseRequestShape(surface.requestShape, `${surfaceLabel}.requestShape`) };
  })();
  const manifest: TaskRunResourceManifest = {
    ...(row.schemaVersion === undefined ? {} : {
      schemaVersion: (() => {
        if (row.schemaVersion !== 2) throw new Error(`${label}.schemaVersion must be 2`);
        return 2 as const;
      })(),
    }),
    profile: string(row.profile, `${label}.profile`),
    ...(row.piRuntimeVersion === undefined ? {} : { piRuntimeVersion: string(row.piRuntimeVersion, `${label}.piRuntimeVersion`) }),
    ...(row.cwd === undefined ? {} : { cwd: string(row.cwd, `${label}.cwd`) }),
    ...(row.fileGrantIds === undefined ? {} : { fileGrantIds: stringArray(row.fileGrantIds, `${label}.fileGrantIds`) }),
    packages,
    activeToolNames,
    ...(row.conflicts === undefined ? {} : {
      conflicts: array(row.conflicts, `${label}.conflicts`).map((entry, index) => {
        const conflictLabel = `${label}.conflicts[${index}]`;
        const conflict = object(entry, conflictLabel);
        if (conflict.kind !== "tool" && conflict.kind !== "flag") throw new Error(`${conflictLabel}.kind is invalid`);
        return {
          kind: conflict.kind,
          name: string(conflict.name, `${conflictLabel}.name`),
          winnerPath: string(conflict.winnerPath, `${conflictLabel}.winnerPath`),
          shadowedPath: string(conflict.shadowedPath, `${conflictLabel}.shadowedPath`),
        };
      }),
    }),
    ...(profileRevision !== undefined ? { profileRevision } : {}),
    ...(row.profileHash !== undefined ? { profileHash: optionalString(row.profileHash, `${label}.profileHash`) } : {}),
    ...(resources !== undefined ? { resources } : {}),
    ...(row.requestShapeHash !== undefined ? { requestShapeHash: optionalString(row.requestShapeHash, `${label}.requestShapeHash`) } : {}),
    ...(row.systemPromptHash !== undefined ? { systemPromptHash: optionalString(row.systemPromptHash, `${label}.systemPromptHash`) } : {}),
    ...(row.toolSurfaceHash !== undefined ? { toolSurfaceHash: optionalString(row.toolSurfaceHash, `${label}.toolSurfaceHash`) } : {}),
    ...(row.resourceIndexHash !== undefined ? { resourceIndexHash: optionalString(row.resourceIndexHash, `${label}.resourceIndexHash`) } : {}),
    ...(requestShape !== undefined ? { requestShape } : {}),
    ...(mainSurface ? { mainSurface } : {}),
  };
  if (manifest.profile === "main+team" && !mainSurface) throw new Error(`${label}.main+team requires mainSurface`);
  if (manifest.profile === "team" && mainSurface) throw new Error(`${label}.team cannot contain mainSurface`);
  if (manifest.profile === "main" && mainSurface) {
    const shape = mainSurface.requestShape;
    if (JSON.stringify(activeToolNames) !== JSON.stringify(shape.activeToolNames)
      || manifest.requestShapeHash !== shape.requestShapeHash
      || manifest.systemPromptHash !== shape.systemPromptHash
      || manifest.toolSurfaceHash !== shape.toolSurfaceHash
      || manifest.resourceIndexHash !== shape.resourceIndexHash
      || (manifest.requestShape !== undefined && (
        manifest.requestShape.schemaVersion !== shape.schemaVersion
        || manifest.requestShape.systemPromptChars !== shape.systemPromptChars
        || manifest.requestShape.activeToolCount !== shape.activeToolCount
        || manifest.requestShape.resourceCount !== shape.resourceCount
      ))
      || JSON.stringify(packageNames) !== JSON.stringify(mainSurface.packageNames)) {
      throw new Error(`${label}.main must match mainSurface`);
    }
  }
  return manifest;
}

function parseTask(value: unknown, label: string): TaskRecord {
  const row = object(value, label);
  if (row.projectId !== undefined) throw new Error(`${label}.projectId was removed in schema v2; use owner`);
  const owner = parseOwner(row.owner, `${label}.owner`);
  const scope = parseScope(row.scope, `${label}.scope`);
  const kind = enumValue(row.kind, TASK_KINDS, `${label}.kind`);
  if (owner.kind !== scope.kind) throw new Error(`${label}.owner and scope kinds must match`);
  if (owner.kind === "standalone" && kind !== "general") throw new Error(`${label}.standalone kind must be general`);
  return {
    id: string(row.id, `${label}.id`),
    owner,
    scope,
    title: string(row.title, `${label}.title`),
    intent: string(row.intent, `${label}.intent`),
    kind,
    status: enumValue(row.status, TASK_STATUSES, `${label}.status`),
    titleGeneration: row.titleGeneration === undefined ? undefined : parseTitleGeneration(row.titleGeneration, `${label}.titleGeneration`),
    createdAt: isoDate(row.createdAt, `${label}.createdAt`),
    updatedAt: isoDate(row.updatedAt, `${label}.updatedAt`),
  };
}

function parseRun(value: unknown, label: string): TaskRun {
  const row = object(value, label);
  const estimatedCallsBySource = row.estimatedCallsBySource === undefined
    ? undefined
    : parseEstimatedCallsBySource(row.estimatedCallsBySource, `${label}.estimatedCallsBySource`);
  const usageBySource = row.usageBySource === undefined
    ? undefined
    : parseUsageBySource(row.usageBySource, `${label}.usageBySource`);
  return {
    id: string(row.id, `${label}.id`),
    taskId: string(row.taskId, `${label}.taskId`),
    mode: enumValue(row.mode, RUN_MODES, `${label}.mode`),
    status: enumValue(row.status, RUN_STATUSES, `${label}.status`),
    rootAgentThreadId: string(row.rootAgentThreadId, `${label}.rootAgentThreadId`),
    planHash: optionalString(row.planHash, `${label}.planHash`),
    estimatedCalls: estimatedCallsBySource === undefined
      ? (row.estimatedCalls === undefined || row.estimatedCalls === null ? row.estimatedCalls : integer(row.estimatedCalls, `${label}.estimatedCalls`))
      : Object.values(estimatedCallsBySource).reduce((sum, calls) => sum + calls, 0),
    estimatedCallsBySource,
    modelRoutes: row.modelRoutes === undefined ? undefined : stringRecord(row.modelRoutes, `${label}.modelRoutes`),
    startedAt: row.startedAt === undefined || row.startedAt === null ? row.startedAt : isoDate(row.startedAt, `${label}.startedAt`),
    updatedAt: isoDate(row.updatedAt, `${label}.updatedAt`),
    completedAt: row.completedAt === undefined || row.completedAt === null ? row.completedAt : isoDate(row.completedAt, `${label}.completedAt`),
    stopAvailable: bool(row.stopAvailable, `${label}.stopAvailable`),
    resumeAvailable: bool(row.resumeAvailable, `${label}.resumeAvailable`),
    usage: usageBySource === undefined
      ? (row.usage === undefined ? undefined : parseUsage(row.usage, `${label}.usage`))
      : sumUsage(Object.values(usageBySource)),
    usageBySource,
    resourceManifest: row.resourceManifest === undefined ? undefined : parseResourceManifest(row.resourceManifest, `${label}.resourceManifest`),
  };
}

function parseIdentity(value: unknown, label: string): TaskAgentIdentity {
  const row = object(value, label);
  const disclosureLabel = enumValue(row.disclosureLabel, ["Agent", "System"] as const, `${label}.disclosureLabel`);
  const kind = enumValue(row.kind, AGENT_KINDS, `${label}.kind`);
  if (kind === "deterministic" && disclosureLabel !== "System") throw new Error(`${label}.deterministic identity must disclose as System`);
  if (kind !== "deterministic" && disclosureLabel !== "Agent") throw new Error(`${label}.${kind} identity must disclose as Agent`);
  return {
    kind,
    roleId: string(row.roleId, `${label}.roleId`),
    displayName: string(row.displayName, `${label}.displayName`),
    roleLabel: string(row.roleLabel, `${label}.roleLabel`),
    disclosureLabel,
  };
}

function parseThread(value: unknown, label: string): TaskAgentThread {
  const row = object(value, label);
  return {
    id: string(row.id, `${label}.id`),
    taskId: string(row.taskId, `${label}.taskId`),
    runId: string(row.runId, `${label}.runId`),
    parentThreadId: optionalString(row.parentThreadId, `${label}.parentThreadId`),
    identity: parseIdentity(row.identity, `${label}.identity`),
    status: enumValue(row.status, RUN_STATUSES, `${label}.status`),
    canReceiveUserMessage: bool(row.canReceiveUserMessage, `${label}.canReceiveUserMessage`),
    handoffSummary: optionalString(row.handoffSummary, `${label}.handoffSummary`),
    latestActivityId: optionalString(row.latestActivityId, `${label}.latestActivityId`),
    childThreadIds: stringArray(row.childThreadIds, `${label}.childThreadIds`),
    piSessionId: optionalString(row.piSessionId, `${label}.piSessionId`) ?? undefined,
    piSessionFile: optionalString(row.piSessionFile, `${label}.piSessionFile`) ?? undefined,
    piEntryId: optionalString(row.piEntryId, `${label}.piEntryId`) ?? undefined,
    branchPointEntryId: optionalString(row.branchPointEntryId, `${label}.branchPointEntryId`) ?? undefined,
    branchPosition: row.branchPosition === undefined ? undefined : enumValue(row.branchPosition, ["before", "at"] as const, `${label}.branchPosition`),
    createdAt: isoDate(row.createdAt, `${label}.createdAt`),
    updatedAt: isoDate(row.updatedAt, `${label}.updatedAt`),
  };
}

function parseActor(value: unknown, label: string): TaskActivityActor {
  const row = object(value, label);
  return {
    kind: enumValue(row.kind, ACTOR_KINDS, `${label}.kind`),
    id: string(row.id, `${label}.id`),
    displayName: string(row.displayName, `${label}.displayName`),
    agentThreadId: optionalString(row.agentThreadId, `${label}.agentThreadId`),
  };
}

function parseTool(value: unknown, label: string): TaskToolActivity {
  const row = object(value, label);
  return {
    name: string(row.name, `${label}.name`),
    effect: enumValue(row.effect, TOOL_EFFECTS, `${label}.effect`),
    target: optionalString(row.target, `${label}.target`),
    outcome: optionalString(row.outcome, `${label}.outcome`),
  };
}

function parseActivity(value: unknown, label: string): TaskActivity {
  const row = object(value, label);
  const type = enumValue(row.type, ACTIVITY_TYPES, `${label}.type`);
  const tool = row.tool === undefined || row.tool === null ? row.tool : parseTool(row.tool, `${label}.tool`);
  if ((type === "tool_action" || type === "evidence_read") && !tool) throw new Error(`${label}.tool is required for ${type}`);
  const refs = object(row.refs, `${label}.refs`);
  return {
    id: string(row.id, `${label}.id`),
    taskId: string(row.taskId, `${label}.taskId`),
    runId: string(row.runId, `${label}.runId`),
    agentThreadId: string(row.agentThreadId, `${label}.agentThreadId`),
    seq: integer(row.seq, `${label}.seq`, 1),
    type,
    status: enumValue(row.status, ACTIVITY_STATUSES, `${label}.status`),
    actor: parseActor(row.actor, `${label}.actor`),
    title: string(row.title, `${label}.title`),
    body: optionalString(row.body, `${label}.body`),
    tool,
    refs: {
      artifactIds: stringArray(refs.artifactIds, `${label}.refs.artifactIds`),
      evidenceRefs: stringArray(refs.evidenceRefs, `${label}.refs.evidenceRefs`),
      decisionIds: stringArray(refs.decisionIds, `${label}.refs.decisionIds`),
      segmentIds: refs.segmentIds === undefined ? [] : stringArray(refs.segmentIds, `${label}.refs.segmentIds`),
    },
    createdAt: isoDate(row.createdAt, `${label}.createdAt`),
    updatedAt: isoDate(row.updatedAt, `${label}.updatedAt`),
  };
}

function parseArtifact(value: unknown, label: string): TaskArtifact {
  const row = object(value, label);
  const provenance = object(row.provenance, `${label}.provenance`);
  return {
    id: string(row.id, `${label}.id`),
    taskId: string(row.taskId, `${label}.taskId`),
    runId: string(row.runId, `${label}.runId`),
    type: enumValue(row.type, ARTIFACT_TYPES, `${label}.type`),
    status: enumValue(row.status, ARTIFACT_STATUSES, `${label}.status`),
    title: string(row.title, `${label}.title`),
    summary: optionalString(row.summary, `${label}.summary`),
    scope: parseScope(row.scope, `${label}.scope`),
    version: integer(row.version, `${label}.version`, 1),
    provenance: {
      agentThreadId: string(provenance.agentThreadId, `${label}.provenance.agentThreadId`),
      activityId: optionalString(provenance.activityId, `${label}.provenance.activityId`),
      evidenceRefs: stringArray(provenance.evidenceRefs, `${label}.provenance.evidenceRefs`),
      parentArtifactIds: stringArray(provenance.parentArtifactIds, `${label}.provenance.parentArtifactIds`),
    },
    availableDecisions: array(row.availableDecisions, `${label}.availableDecisions`).map((entry, index) => enumValue(entry, DECISION_ACTIONS, `${label}.availableDecisions[${index}]`)),
    content: object(row.content, `${label}.content`),
    createdAt: isoDate(row.createdAt, `${label}.createdAt`),
    updatedAt: isoDate(row.updatedAt, `${label}.updatedAt`),
  };
}

/** Parse one canonical Task artifact at API and fixture boundaries. */
export function parseTaskArtifact(value: unknown): TaskArtifact {
  return parseArtifact(value, "artifact");
}

function parseDecision(value: unknown, label: string): TaskDecision {
  const row = object(value, label);
  const options = array(row.options, `${label}.options`).map((entry, index): TaskDecisionOption => {
    const option = object(entry, `${label}.options[${index}]`);
    return {
      id: string(option.id, `${label}.options[${index}].id`),
      label: string(option.label, `${label}.options[${index}].label`),
      action: enumValue(option.action, DECISION_ACTIONS, `${label}.options[${index}].action`),
      destructive: bool(option.destructive, `${label}.options[${index}].destructive`),
      description: optionalString(option.description, `${label}.options[${index}].description`),
      preview: optionalString(option.preview, `${label}.options[${index}].preview`),
    };
  });
  if (!options.length) throw new Error(`${label}.options must not be empty`);
  const optionIds = options.map((option) => option.id);
  if (new Set(optionIds).size !== optionIds.length) throw new Error(`${label}.options ids must be unique`);
  const interactionId = optionalString(row.interactionId, `${label}.interactionId`);
  const questionIndex = row.questionIndex === undefined || row.questionIndex === null
    ? row.questionIndex
    : integer(row.questionIndex, `${label}.questionIndex`);
  if (questionIndex !== undefined && questionIndex !== null && (questionIndex < 0 || questionIndex > 3)) {
    throw new Error(`${label}.questionIndex must be between 0 and 3`);
  }
  const selectionMode = row.selectionMode === undefined || row.selectionMode === null
    ? row.selectionMode
    : enumValue(row.selectionMode, DECISION_SELECTION_MODES, `${label}.selectionMode`);
  if ((questionIndex !== undefined && questionIndex !== null) || selectionMode) {
    if (!interactionId) throw new Error(`${label}.interactionId is required for a grouped interaction`);
  }
  if (selectionMode === "freeform" && !optionIds.includes("freeform")) {
    throw new Error(`${label}.freeform selection requires the freeform option`);
  }
  const selectedOptionId = optionalString(row.selectedOptionId, `${label}.selectedOptionId`);
  const selectedOptionIds = row.selectedOptionIds === undefined
    ? undefined
    : stringArray(row.selectedOptionIds, `${label}.selectedOptionIds`);
  if (selectedOptionIds && new Set(selectedOptionIds).size !== selectedOptionIds.length) {
    throw new Error(`${label}.selectedOptionIds must be unique`);
  }
  if (selectedOptionIds?.some((id) => !optionIds.includes(id))) {
    throw new Error(`${label}.selectedOptionIds must reference options`);
  }
  const status = enumValue(row.status, DECISION_STATUSES, `${label}.status`);
  if (status === "recorded" && !selectedOptionId) throw new Error(`${label}.selectedOptionId is required when recorded`);
  if (selectedOptionId && !options.some((option) => option.id === selectedOptionId)) throw new Error(`${label}.selectedOptionId must reference an option`);
  if (status === "recorded" && selectionMode && !selectedOptionIds) {
    throw new Error(`${label}.selectedOptionIds is required for a recorded grouped interaction`);
  }
  if (status === "recorded" && selectedOptionIds && selectedOptionIds.length === 0) throw new Error(`${label}.selectedOptionIds must not be empty when recorded`);
  if (selectedOptionIds?.length && selectedOptionId !== selectedOptionIds[0]) throw new Error(`${label}.selectedOptionId must equal the first selectedOptionIds entry`);
  if (status === "recorded" && selectionMode === "single" && selectedOptionIds && selectedOptionIds.length !== 1) {
    throw new Error(`${label}.single selection must contain exactly one option`);
  }
  const responseText = optionalString(row.responseText, `${label}.responseText`);
  if (selectionMode === "freeform" && status === "recorded") {
    if (selectedOptionId !== "freeform" || selectedOptionIds?.length !== 1 || selectedOptionIds[0] !== "freeform") {
      throw new Error(`${label}.freeform selection must use the freeform option`);
    }
    if (!responseText) throw new Error(`${label}.responseText is required for freeform selection`);
  }
  const provenanceRow = row.requestProvenance === undefined
    ? undefined
    : object(row.requestProvenance, `${label}.requestProvenance`);
  const requestProvenance = provenanceRow ? {
    kind: enumValue(provenanceRow.kind, ["package_extension"] as const, `${label}.requestProvenance.kind`),
    transport: enumValue(provenanceRow.transport, ["pi-rpc-v1"] as const, `${label}.requestProvenance.transport`),
    packageSource: string(provenanceRow.packageSource, `${label}.requestProvenance.packageSource`),
    packageName: string(provenanceRow.packageName, `${label}.requestProvenance.packageName`),
    packageVersion: string(provenanceRow.packageVersion, `${label}.requestProvenance.packageVersion`),
    resourceId: string(provenanceRow.resourceId, `${label}.requestProvenance.resourceId`),
    integrity: string(provenanceRow.integrity, `${label}.requestProvenance.integrity`),
  } satisfies TaskDecisionRequestProvenance : undefined;
  return {
    id: string(row.id, `${label}.id`),
    taskId: string(row.taskId, `${label}.taskId`),
    runId: string(row.runId, `${label}.runId`),
    requestedByThreadId: string(row.requestedByThreadId, `${label}.requestedByThreadId`),
    ...(requestProvenance ? { requestProvenance } : {}),
    artifactId: optionalString(row.artifactId, `${label}.artifactId`),
    kind: enumValue(row.kind, DECISION_KINDS, `${label}.kind`),
    status,
    prompt: string(row.prompt, `${label}.prompt`),
    options,
    interactionId,
    questionIndex,
    selectionMode,
    selectedOptionId,
    selectedOptionIds,
    responseText,
    reason: optionalString(row.reason, `${label}.reason`),
    scope: parseScope(row.scope, `${label}.scope`),
    createdAt: isoDate(row.createdAt, `${label}.createdAt`),
    decidedAt: row.decidedAt === undefined || row.decidedAt === null ? row.decidedAt : isoDate(row.decidedAt, `${label}.decidedAt`),
  };
}

function assertUniqueIds(rows: Array<{ id: string }>, label: string): void {
  const ids = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.id)) throw new Error(`${label} contains duplicate id ${row.id}`);
    ids.add(row.id);
  }
}

function validateSnapshotReferences(snapshot: TaskWorkspaceSnapshot): void {
  assertUniqueIds(snapshot.runs, "runs");
  assertUniqueIds(snapshot.agentThreads, "agentThreads");
  assertUniqueIds(snapshot.activities, "activities");
  assertUniqueIds(snapshot.artifacts, "artifacts");
  assertUniqueIds(snapshot.decisions, "decisions");
  const runIds = new Set(snapshot.runs.map((row) => row.id));
  const threadIds = new Set(snapshot.agentThreads.map((row) => row.id));
  const threadsById = new Map(snapshot.agentThreads.map((row) => [row.id, row]));
  const activityIds = new Set(snapshot.activities.map((row) => row.id));
  const artifactIds = new Set(snapshot.artifacts.map((row) => row.id));
  const decisionIds = new Set(snapshot.decisions.map((row) => row.id));
  const taskScope = snapshot.task.scope;
  if (snapshot.activeRunId && !runIds.has(snapshot.activeRunId)) throw new Error("activeRunId must reference runs");
  for (const run of snapshot.runs) {
    if (run.taskId !== snapshot.task.id) throw new Error(`run ${run.id} taskId mismatch`);
    if (!threadIds.has(run.rootAgentThreadId)) throw new Error(`run ${run.id} rootAgentThreadId must reference agentThreads`);
  }
  for (const thread of snapshot.agentThreads) {
    if (thread.taskId !== snapshot.task.id || !runIds.has(thread.runId)) throw new Error(`thread ${thread.id} scope mismatch`);
    if (thread.parentThreadId && !threadIds.has(thread.parentThreadId)) throw new Error(`thread ${thread.id} parentThreadId must reference agentThreads`);
    for (const childId of thread.childThreadIds) if (!threadIds.has(childId)) throw new Error(`thread ${thread.id} childThreadIds must reference agentThreads`);
    if (thread.latestActivityId && !activityIds.has(thread.latestActivityId)) throw new Error(`thread ${thread.id} latestActivityId must reference activities`);
  }
  for (const activity of snapshot.activities) {
    if (activity.taskId !== snapshot.task.id || !runIds.has(activity.runId) || !threadIds.has(activity.agentThreadId)) throw new Error(`activity ${activity.id} scope mismatch`);
    if (threadsById.get(activity.agentThreadId)?.runId !== activity.runId) throw new Error(`activity ${activity.id} agent thread run mismatch`);
    for (const id of activity.refs.artifactIds) if (!artifactIds.has(id)) throw new Error(`activity ${activity.id} references unknown artifact ${id}`);
    for (const id of activity.refs.decisionIds) if (!decisionIds.has(id)) throw new Error(`activity ${activity.id} references unknown decision ${id}`);
  }
  for (const artifact of snapshot.artifacts) {
    if (artifact.taskId !== snapshot.task.id || !runIds.has(artifact.runId) || !threadIds.has(artifact.provenance.agentThreadId)) throw new Error(`artifact ${artifact.id} scope mismatch`);
    if (threadsById.get(artifact.provenance.agentThreadId)?.runId !== artifact.runId) throw new Error(`artifact ${artifact.id} agent thread run mismatch`);
    if (artifact.scope.kind !== taskScope.kind) throw new Error(`artifact ${artifact.id} owner scope mismatch`);
    if (artifact.provenance.activityId && !activityIds.has(artifact.provenance.activityId)) throw new Error(`artifact ${artifact.id} activityId must reference activities`);
    for (const id of artifact.provenance.parentArtifactIds) if (!artifactIds.has(id)) throw new Error(`artifact ${artifact.id} references unknown parent artifact ${id}`);
  }
  for (const decision of snapshot.decisions) {
    if (decision.taskId !== snapshot.task.id || !runIds.has(decision.runId) || !threadIds.has(decision.requestedByThreadId)) throw new Error(`decision ${decision.id} scope mismatch`);
    if (threadsById.get(decision.requestedByThreadId)?.runId !== decision.runId) throw new Error(`decision ${decision.id} agent thread run mismatch`);
    if (decision.artifactId && !artifactIds.has(decision.artifactId)) throw new Error(`decision ${decision.id} artifactId must reference artifacts`);
    if (decision.scope.kind !== taskScope.kind) throw new Error(`decision ${decision.id} owner scope mismatch`);
  }
  const interactions = new Map<string, TaskDecision[]>();
  for (const decision of snapshot.decisions) {
    if (!decision.interactionId) continue;
    if (decision.questionIndex === undefined || decision.questionIndex === null || !decision.selectionMode) {
      throw new Error(`decision ${decision.id} grouped interaction requires questionIndex and selectionMode`);
    }
    const group = interactions.get(decision.interactionId) ?? [];
    group.push(decision);
    interactions.set(decision.interactionId, group);
  }
  for (const [interactionId, decisions] of interactions) {
    if (decisions.length > 4) throw new Error(`decision interaction ${interactionId} must contain at most 4 questions`);
    if (new Set(decisions.map((decision) => decision.runId)).size !== 1) throw new Error(`decision interaction ${interactionId} must belong to one run`);
    if (new Set(decisions.map((decision) => decision.requestedByThreadId)).size !== 1) throw new Error(`decision interaction ${interactionId} must belong to one agent thread`);
    const indexes = decisions.map((decision) => decision.questionIndex!).sort((left, right) => left - right);
    if (new Set(indexes).size !== indexes.length) throw new Error(`decision interaction ${interactionId} questionIndex must be unique`);
    if (indexes.some((index, position) => index !== position)) throw new Error(`decision interaction ${interactionId} questionIndex must be contiguous from 0`);
  }
}

export function parseTaskWorkspaceSnapshot(value: unknown): TaskWorkspaceSnapshot {
  const row = object(value, "taskWorkspace");
  if (row.schemaVersion !== TASK_WORKSPACE_SCHEMA_VERSION) throw new Error(`taskWorkspace.schemaVersion must be ${TASK_WORKSPACE_SCHEMA_VERSION}`);
  const task = parseTask(row.task, "taskWorkspace.task");
  const runs = array(row.runs, "taskWorkspace.runs").map((entry, index) => parseRun(entry, `taskWorkspace.runs[${index}]`));
  const snapshot: TaskWorkspaceSnapshot = {
    schemaVersion: TASK_WORKSPACE_SCHEMA_VERSION,
    task,
    activeRunId: optionalString(row.activeRunId, "taskWorkspace.activeRunId"),
    eventCursor: string(row.eventCursor, "taskWorkspace.eventCursor"),
    projectedAt: isoDate(row.projectedAt, "taskWorkspace.projectedAt"),
    usage: sumUsage([task.titleGeneration?.usage, ...runs.map((run) => run.usage)]),
    runs,
    agentThreads: array(row.agentThreads, "taskWorkspace.agentThreads").map((entry, index) => parseThread(entry, `taskWorkspace.agentThreads[${index}]`)),
    activities: array(row.activities, "taskWorkspace.activities").map((entry, index) => parseActivity(entry, `taskWorkspace.activities[${index}]`)),
    artifacts: array(row.artifacts, "taskWorkspace.artifacts").map((entry, index) => parseArtifact(entry, `taskWorkspace.artifacts[${index}]`)),
    decisions: array(row.decisions, "taskWorkspace.decisions").map((entry, index) => parseDecision(entry, `taskWorkspace.decisions[${index}]`)),
  };
  validateSnapshotReferences(snapshot);
  return snapshot;
}

export function parseTaskRunEvent(value: unknown, label = "runEvent"): TaskRunEvent {
  const row = object(value, label);
  const type = enumValue(row.type, EVENT_TYPES, `${label}.type`);
  const event: TaskRunEvent = {
    id: string(row.id, `${label}.id`),
    cursor: string(row.cursor, `${label}.cursor`),
    seq: integer(row.seq, `${label}.seq`, 1),
    taskId: string(row.taskId, `${label}.taskId`),
    runId: string(row.runId, `${label}.runId`),
    agentThreadId: optionalString(row.agentThreadId, `${label}.agentThreadId`),
    type,
    occurredAt: isoDate(row.occurredAt, `${label}.occurredAt`),
    run: row.run === undefined ? undefined : parseRun(row.run, `${label}.run`),
    thread: row.thread === undefined ? undefined : parseThread(row.thread, `${label}.thread`),
    activity: row.activity === undefined ? undefined : parseActivity(row.activity, `${label}.activity`),
    artifact: row.artifact === undefined ? undefined : parseArtifact(row.artifact, `${label}.artifact`),
    decision: row.decision === undefined ? undefined : parseDecision(row.decision, `${label}.decision`),
    usageSource: row.usageSource === undefined ? undefined : usageSourceKey(string(row.usageSource, `${label}.usageSource`), `${label}.usageSource`),
    usage: row.usage === undefined ? undefined : parseUsage(row.usage, `${label}.usage`),
  };
  if (type !== "usage_update" && event.usageSource !== undefined) throw new Error(`${label}.usageSource is only valid for usage_update`);
  const expectedPayload: Record<TaskRunEventType, keyof TaskRunEvent> = {
    run_upsert: "run",
    thread_upsert: "thread",
    activity_append: "activity",
    artifact_upsert: "artifact",
    decision_upsert: "decision",
    usage_update: "usage",
  };
  const payloadKeys: Array<keyof TaskRunEvent> = ["run", "thread", "activity", "artifact", "decision", "usage"];
  const present = payloadKeys.filter((key) => event[key] !== undefined);
  if (present.length !== 1 || present[0] !== expectedPayload[type]) throw new Error(`${label} must contain exactly the ${expectedPayload[type]} payload for ${type}`);
  const scopedPayloads = [event.thread, event.activity, event.artifact, event.decision]
    .filter((payload): payload is NonNullable<typeof payload> => payload !== undefined);
  for (const payload of scopedPayloads) {
    if (payload.taskId !== event.taskId || payload.runId !== event.runId) throw new Error(`${label} payload scope must match event taskId and runId`);
  }
  if (event.run && (event.run.taskId !== event.taskId || event.run.id !== event.runId)) throw new Error(`${label}.run scope must match event taskId and runId`);
  const payloadThreadId = event.thread?.id ?? event.activity?.agentThreadId ?? event.artifact?.provenance.agentThreadId ?? event.decision?.requestedByThreadId ?? event.run?.rootAgentThreadId;
  if (event.agentThreadId && payloadThreadId && event.agentThreadId !== payloadThreadId) throw new Error(`${label} agentThreadId must match its payload`);
  return event;
}

export function parseTaskRunEventPage(value: unknown): TaskRunEventPage {
  const row = object(value, "runEventPage");
  if (row.schemaVersion !== TASK_WORKSPACE_SCHEMA_VERSION) throw new Error(`runEventPage.schemaVersion must be ${TASK_WORKSPACE_SCHEMA_VERSION}`);
  const events = array(row.events, "runEventPage.events").map((entry, index) => parseTaskRunEvent(entry, `runEventPage.events[${index}]`));
  assertUniqueIds(events, "runEventPage.events");
  const cursors = new Set<string>();
  for (let index = 1; index < events.length; index += 1) {
    if (events[index]!.seq <= events[index - 1]!.seq) throw new Error("runEventPage.events seq must be strictly increasing");
  }
  for (const event of events) {
    if (cursors.has(event.cursor)) throw new Error(`runEventPage.events contains duplicate cursor ${event.cursor}`);
    cursors.add(event.cursor);
  }
  const page: TaskRunEventPage = {
    schemaVersion: TASK_WORKSPACE_SCHEMA_VERSION,
    taskId: string(row.taskId, "runEventPage.taskId"),
    runId: string(row.runId, "runEventPage.runId"),
    afterCursor: optionalString(row.afterCursor, "runEventPage.afterCursor"),
    nextCursor: string(row.nextCursor, "runEventPage.nextCursor"),
    hasMore: bool(row.hasMore, "runEventPage.hasMore"),
    events,
  };
  for (const event of page.events) {
    if (event.taskId !== page.taskId || event.runId !== page.runId) throw new Error(`event ${event.id} page scope mismatch`);
  }
  if (events.length && page.nextCursor !== events.at(-1)!.cursor) throw new Error("runEventPage.nextCursor must equal the final event cursor");
  if (!events.length && page.nextCursor !== page.afterCursor) throw new Error("runEventPage.nextCursor must equal afterCursor when events is empty");
  return page;
}

function upsertById<T extends { id: string }>(rows: T[], value: T): T[] {
  const index = rows.findIndex((row) => row.id === value.id);
  if (index < 0) return [...rows, value];
  const next = [...rows];
  next[index] = value;
  return next;
}

function taskStatusFromRun(status: TaskRunStatus): TaskStatus {
  if (status === "awaiting_input") return "awaiting_input";
  if (status === "stopped") return "stopped";
  if (status === "failed" || status === "stale") return "failed";
  if (status === "complete") return "complete";
  return "active";
}

/**
 * Canonical event projector shared by durable storage and future transports.
 * Callers append one validated cursor page and receive the next complete
 * snapshot; they never reimplement lifecycle/artifact/decision projection.
 */
export function applyTaskRunEventPage(
  current: TaskWorkspaceSnapshot,
  input: TaskRunEventPage | unknown,
): TaskWorkspaceSnapshot {
  const snapshot = parseTaskWorkspaceSnapshot(current);
  const page = parseTaskRunEventPage(input);
  if (page.taskId !== snapshot.task.id) throw new Error("runEventPage task does not match TaskWorkspace snapshot");
  if (page.afterCursor !== snapshot.eventCursor) throw new Error(`runEventPage cursor conflict: expected ${snapshot.eventCursor}`);

  let runs = [...snapshot.runs];
  let threads = [...snapshot.agentThreads];
  let activities = [...snapshot.activities];
  let artifacts = [...snapshot.artifacts];
  let decisions = [...snapshot.decisions];
  let activeRunId = snapshot.activeRunId;
  let taskStatus = snapshot.task.status;

  for (const event of page.events) {
    if (event.type === "run_upsert" && event.run) {
      const previous = runs.find((run) => run.id === event.run!.id);
      const run = {
        ...event.run,
        ...(previous?.usageBySource
          ? { usage: previous.usage, usageBySource: previous.usageBySource }
          : previous?.usage && event.run.usage === undefined ? { usage: previous.usage } : {}),
        ...(previous?.estimatedCallsBySource && event.run.estimatedCallsBySource === undefined
          ? { estimatedCalls: previous.estimatedCalls, estimatedCallsBySource: previous.estimatedCallsBySource }
          : {}),
      };
      runs = upsertById(runs, run);
      taskStatus = taskStatusFromRun(run.status);
      activeRunId = ["stopped", "failed", "complete"].includes(run.status)
        ? (activeRunId === run.id ? null : activeRunId)
        : run.id;
    } else if (event.type === "thread_upsert" && event.thread) {
      threads = upsertById(threads, event.thread);
    } else if (event.type === "activity_append" && event.activity) {
      if (activities.some((row) => row.id === event.activity!.id)) throw new Error(`activity_append duplicate id ${event.activity.id}`);
      activities.push(event.activity);
      threads = threads.map((thread) => thread.id === event.activity!.agentThreadId
        ? { ...thread, latestActivityId: event.activity!.id, updatedAt: event.activity!.updatedAt }
        : thread);
    } else if (event.type === "artifact_upsert" && event.artifact) {
      const previous = artifacts.find((row) => row.id === event.artifact!.id);
      if (previous && event.artifact.version < previous.version) throw new Error(`artifact ${event.artifact.id} version cannot go backwards`);
      artifacts = upsertById(artifacts, event.artifact);
    } else if (event.type === "decision_upsert" && event.decision) {
      decisions = upsertById(decisions, event.decision);
    } else if (event.type === "usage_update" && event.usage) {
      if (!runs.some((row) => row.id === event.runId)) throw new Error(`usage_update references unknown run ${event.runId}`);
      runs = runs.map((run) => {
        if (run.id !== event.runId) return run;
        if (!event.usageSource) return { ...run, usage: event.usage, usageBySource: undefined, updatedAt: event.occurredAt };
        const usageBySource = { ...run.usageBySource, [event.usageSource]: event.usage! };
        return { ...run, usage: sumUsage(Object.values(usageBySource)), usageBySource, updatedAt: event.occurredAt };
      });
    }
  }

  const projectedAt = page.events.at(-1)?.occurredAt ?? snapshot.projectedAt;
  return parseTaskWorkspaceSnapshot({
    ...snapshot,
    task: {
      ...snapshot.task,
      status: taskStatus,
      updatedAt: projectedAt,
    },
    activeRunId,
    eventCursor: page.nextCursor,
    projectedAt,
    runs,
    agentThreads: threads,
    activities,
    artifacts,
    decisions,
  });
}
