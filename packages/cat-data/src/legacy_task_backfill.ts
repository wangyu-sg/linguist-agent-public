import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import {
  createVerifiedRuntimeDataBackup,
  executeRuntimeDataRollback,
  previewRuntimeDataSnapshot,
  previewRuntimeDataRollback,
  type RuntimeDataBackupResult,
} from "./runtime_migrations.js";
import {
  createTaskWorkspace,
  TaskWorkspaceConflictError,
  TaskWorkspaceNotFoundError,
  type TaskRunEventDraft,
} from "./task_workspace.js";
import type {
  TaskActivity,
  TaskArtifact,
  TaskKind,
  TaskRunStatus,
  TaskScope,
  TaskUsage,
} from "./task_workspace_contract.js";
import { DETERMINISTIC_TEAM_ROLE_IDS, teamRoleDisplayName, type TeamRolePass } from "./team_workflow.js";
import type { WorkflowArtifacts } from "./workflow_artifacts.js";
import { workflowArtifactsPath } from "./workflow_artifacts.js";
import {
  CAT_WORKFLOW_INTENTS,
  linkCatWorkflowTask,
  type CatWorkflowIntent,
  type CatWorkflowRun,
  type CatWorkflowRunStatus,
} from "./workflow_plan.js";
import { readJsonFile } from "./workspace.js";

type LegacyChatKind = "user" | "assistant" | "tool" | "system" | "error";

interface LegacyChatEvent {
  ts: string;
  kind: LegacyChatKind;
  text: string;
  sessionId?: string;
  sessionFile?: string;
  toolCallId?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    costUsd?: number;
    modelCalls?: number;
  };
}

interface LegacyTurn {
  ordinal: number;
  user: LegacyChatEvent;
  events: LegacyChatEvent[];
}

export type LegacyTaskBackfillCandidateStatus = "eligible" | "already_imported" | "conflict";

export interface LegacyTaskBackfillCandidate {
  candidateId: string;
  taskId: string;
  sourceKind: "project_chat" | "workflow";
  projectId: string;
  sourcePath: string;
  sourceSha256: string;
  sessionSha256?: string;
  workflowSha256?: string;
  workflowId?: string;
  batchId?: string;
  workflowIntent?: CatWorkflowIntent;
  workflowStatus?: CatWorkflowRunStatus;
  status: LegacyTaskBackfillCandidateStatus;
  reason: string;
  title: string;
  startedAt: string;
  updatedAt: string;
  turnCount: number;
  userMessages: number;
  assistantMessages: number;
  errorMessages: number;
  toolCalls: number;
  rolePasses: number;
  artifacts: number;
  decisions: number;
}

export type LegacyTaskBackfillObservationKind =
  | "hidden_reasoning_trace"
  | "unlinked_eval"
  | "internal_pi_session"
  | "malformed_chat_session"
  | "malformed_workflow";

export interface LegacyTaskBackfillObservation {
  kind: LegacyTaskBackfillObservationKind;
  path: string;
  sizeBytes: number;
  sha256: string;
  records: number;
  disposition: "excluded" | "supporting_only";
  reason: string;
}

export interface LegacyTaskBackfillPlan {
  formatVersion: 1;
  mode: "preview";
  planHash: string;
  runtimeManifestHash: string;
  backupFiles: number;
  backupBytes: number;
  candidates: LegacyTaskBackfillCandidate[];
  observations: LegacyTaskBackfillObservation[];
  recommendedCandidateIds: string[];
  summary: {
    eligible: number;
    alreadyImported: number;
    conflicts: number;
    turns: number;
    workflows: number;
    excludedObservations: number;
  };
}

export interface LegacyTaskBackfillResult {
  mode: "execute";
  planHash: string;
  backup?: RuntimeDataBackupResult;
  importedTaskIds: string[];
  alreadyImportedTaskIds: string[];
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function hashFile(path: string): Promise<string> {
  return digest(await readFile(path, "utf8"));
}

function safeTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

function parseChatEvents(value: unknown): LegacyChatEvent[] {
  if (!Array.isArray(value)) throw new Error("legacy chat must be an array");
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`legacy chat row ${index + 1} must be an object`);
    const row = entry as Record<string, unknown>;
    const ts = safeTimestamp(row.ts);
    if (!ts) throw new Error(`legacy chat row ${index + 1} has an invalid timestamp`);
    if (!(["user", "assistant", "tool", "system", "error"] as unknown[]).includes(row.kind)) {
      throw new Error(`legacy chat row ${index + 1} has unsupported kind ${String(row.kind)}`);
    }
    if (typeof row.text !== "string") throw new Error(`legacy chat row ${index + 1} text must be a string`);
    const usage = row.usage && typeof row.usage === "object" && !Array.isArray(row.usage)
      ? row.usage as LegacyChatEvent["usage"]
      : undefined;
    return {
      ts,
      kind: row.kind as LegacyChatKind,
      text: row.text,
      sessionId: typeof row.sessionId === "string" && row.sessionId.trim() ? row.sessionId : undefined,
      sessionFile: typeof row.sessionFile === "string" && row.sessionFile.trim() ? row.sessionFile : undefined,
      toolCallId: typeof row.toolCallId === "string" && row.toolCallId.trim() ? row.toolCallId : undefined,
      usage,
    };
  });
}

function turnsForSession(events: LegacyChatEvent[]): { turns: LegacyTurn[]; orphanRows: number } {
  const turns: LegacyTurn[] = [];
  let current: LegacyTurn | undefined;
  let orphanRows = 0;
  for (const event of events) {
    if (event.kind === "user") {
      current = { ordinal: turns.length + 1, user: event, events: [] };
      turns.push(current);
    } else if (current) {
      current.events.push(event);
    } else {
      orphanRows += 1;
    }
  }
  return { turns, orphanRows };
}

function toolName(text: string): string {
  const match = text.match(/^tool_(?:start|end)\s+([^\s]+)/);
  return match?.[1] ?? "legacy_tool";
}

interface MergedTool {
  key: string;
  name: string;
  ts: string;
  text: string;
  failed: boolean;
}

function mergeTools(events: LegacyChatEvent[]): MergedTool[] {
  const merged: MergedTool[] = [];
  const byCallId = new Map<string, MergedTool>();
  const openByName = new Map<string, MergedTool[]>();
  for (const [index, event] of events.entries()) {
    if (event.kind !== "tool") continue;
    const name = toolName(event.text);
    const isEnd = event.text.startsWith("tool_end ");
    let item = event.toolCallId ? byCallId.get(event.toolCallId) : undefined;
    if (!item && isEnd) item = openByName.get(name)?.shift();
    if (!item) {
      item = {
        key: event.toolCallId ?? `${index + 1}-${digest(`${event.ts}\0${event.text}`).slice(0, 12)}`,
        name,
        ts: event.ts,
        text: event.text,
        failed: /(?:\berror\b|\bfailed\b)/i.test(event.text),
      };
      merged.push(item);
      if (event.toolCallId) byCallId.set(event.toolCallId, item);
      if (!isEnd) openByName.set(name, [...(openByName.get(name) ?? []), item]);
    } else {
      item.text = `${item.text}\n${event.text}`;
      item.failed ||= /(?:\berror\b|\bfailed\b)/i.test(event.text);
    }
  }
  return merged;
}

function candidateTaskId(projectId: string, sessionId: string): string {
  return `legacy-chat-${digest(`${projectId}\0${sessionId}`).slice(0, 24)}`;
}

function candidateIntent(sourceSha256: string, sessionSha256: string): string {
  return `Read-only archive imported from the legacy project Agent chat. source=${sourceSha256}; session=${sessionSha256}`;
}

function candidateTitle(startedAt: string): string {
  return `历史 Agent 对话 · ${startedAt.slice(0, 10)}`;
}

async function chatCandidateStatus(
  root: string,
  projectId: string,
  taskId: string,
  intent: string,
  expectedRuns: number,
): Promise<{ status: LegacyTaskBackfillCandidateStatus; reason: string }> {
  try {
    const snapshot = await createTaskWorkspace(root).open({ projectId, taskId });
    if (snapshot.task.intent === intent && snapshot.task.status === "archived" && snapshot.runs.length === expectedRuns) {
      return { status: "already_imported", reason: "The deterministic archived Task already matches this source session." };
    }
    return { status: "conflict", reason: "The deterministic Task id exists but does not match this source session." };
  } catch (error) {
    if (error instanceof TaskWorkspaceNotFoundError) return { status: "eligible", reason: "Complete user-visible legacy chat session with deterministic scope." };
    throw error;
  }
}

function workflowCandidateTaskId(projectId: string, workflowId: string): string {
  return `legacy-workflow-${digest(`${projectId}\0${workflowId}`).slice(0, 24)}`;
}

function workflowArchiveValue(run: CatWorkflowRun): unknown {
  const { taskId: _taskId, plan, ...rest } = run;
  const { taskId: _planTaskId, ...planRest } = plan;
  return { ...rest, plan: planRest };
}

function workflowArchiveDigest(run: CatWorkflowRun): string {
  return digest(JSON.stringify(workflowArchiveValue(run)));
}

function workflowIntent(workflowId: string, workflowSha256: string): string {
  return `Read-only archive imported from legacy Workflow ${workflowId}. source=${workflowSha256}`;
}

const WORKFLOW_TITLES: Record<CatWorkflowIntent, string> = {
  onboard_project: "项目接入",
  check_assets: "检查资产",
  import_terminology: "导入术语",
  translate_batch: "翻译批次",
  edit_batch: "审校批次",
  proof_batch: "终校批次",
  review_batch: "审阅批次",
  show_proposals: "查看提案",
  prepare_delivery: "准备交付",
  game_localization_team_run: "Team 本地化",
};

function workflowTitle(run: CatWorkflowRun): string {
  const request = run.plan.userRequest?.trim().replace(/\s+/g, " ");
  if (request) return request.length > 80 ? `${request.slice(0, 77)}...` : request;
  return `${WORKFLOW_TITLES[run.plan.intent]} · ${run.createdAt.slice(0, 10)}`;
}

function parseLegacyWorkflow(value: unknown, projectId: string): CatWorkflowRun | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const run = value as Partial<CatWorkflowRun>;
  if (
    run.schemaVersion !== 1 ||
    typeof run.workflowId !== "string" || !run.workflowId.trim() ||
    run.projectId !== projectId ||
    typeof run.status !== "string" ||
    !(["blocked", "waiting_approval", "ready", "in_progress", "completed", "cancelled", "stopping", "stopped", "failed"] as string[]).includes(run.status) ||
    typeof run.createdAt !== "string" || !Number.isFinite(Date.parse(run.createdAt)) ||
    typeof run.updatedAt !== "string" || !Number.isFinite(Date.parse(run.updatedAt)) ||
    !run.plan || typeof run.plan !== "object" ||
    !(CAT_WORKFLOW_INTENTS as readonly string[]).includes(run.plan.intent) ||
    !Array.isArray(run.history) ||
    run.history.some((event) => !event || typeof event.ts !== "string" || !Number.isFinite(Date.parse(event.ts)) || typeof event.kind !== "string" || typeof event.message !== "string")
  ) return undefined;
  return run as CatWorkflowRun;
}

async function workflowCandidateStatus(
  root: string,
  run: CatWorkflowRun,
  taskId: string,
  archiveIntent: string,
): Promise<{ status: LegacyTaskBackfillCandidateStatus; reason: string }> {
  if (run.taskId && run.taskId !== taskId) return { status: "conflict", reason: `Workflow is already linked to Task ${run.taskId}.` };
  try {
    const snapshot = await createTaskWorkspace(root).open({ projectId: run.projectId, taskId });
    if (run.taskId === taskId && snapshot.task.intent === archiveIntent && snapshot.task.status === "archived" && snapshot.runs.length === 1) {
      return { status: "already_imported", reason: "The Workflow is linked to its matching deterministic archived Task." };
    }
    return { status: "conflict", reason: "The deterministic Task id exists but does not match this Workflow archive." };
  } catch (error) {
    if (error instanceof TaskWorkspaceNotFoundError) {
      return run.taskId
        ? { status: "conflict", reason: `Workflow points to missing archived Task ${run.taskId}.` }
        : { status: "eligible", reason: "Legacy Workflow has durable project scope and can be archived without reading its transcript." };
    }
    throw error;
  }
}

async function fileObservation(
  root: string,
  path: string,
  input: Omit<LegacyTaskBackfillObservation, "path" | "sizeBytes" | "sha256">,
): Promise<LegacyTaskBackfillObservation> {
  const info = await stat(path);
  return {
    ...input,
    path: relative(root, path),
    sizeBytes: info.size,
    sha256: await hashFile(path),
  };
}

async function childFiles(root: string, suffix: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(path: string): Promise<void> {
    for (const entry of await readdir(path, { withFileTypes: true }).catch(() => [])) {
      const next = join(path, entry.name);
      if (entry.isDirectory()) await walk(next);
      else if (entry.isFile() && next.endsWith(suffix)) files.push(next);
    }
  }
  await walk(root);
  return files.sort();
}

async function legacyObservations(root: string): Promise<LegacyTaskBackfillObservation[]> {
  const rows: LegacyTaskBackfillObservation[] = [];
  const projectsRoot = join(root, "data", "projects");
  for (const project of await readdir(projectsRoot, { withFileTypes: true }).catch(() => [])) {
    if (!project.isDirectory()) continue;
    const projectRoot = join(projectsRoot, project.name);
    const tracePath = join(projectRoot, "agent_events.jsonl");
    const trace = await readFile(tracePath, "utf8").catch(() => undefined);
    if (trace !== undefined) rows.push(await fileObservation(root, tracePath, {
      kind: "hidden_reasoning_trace",
      records: trace.split("\n").filter(Boolean).length,
      disposition: "excluded",
      reason: "Raw runtime trace contains hidden thinking and must never be imported into product history.",
    }));
    for (const path of await childFiles(join(projectRoot, "_pi_sessions"), ".jsonl")) {
      const text = await readFile(path, "utf8");
      rows.push(await fileObservation(root, path, {
        kind: "internal_pi_session",
        records: text.split("\n").filter(Boolean).length,
        disposition: "supporting_only",
        reason: "Pi JSONL remains internal recovery/audit state; the matching legacy chat candidate owns user-visible history.",
      }));
    }
  }
  for (const path of await childFiles(join(root, "data", "assistant", "_pi_sessions"), ".jsonl")) {
    const text = await readFile(path, "utf8");
    rows.push(await fileObservation(root, path, {
      kind: "internal_pi_session",
      records: text.split("\n").filter(Boolean).length,
      disposition: "excluded",
      reason: "Projectless Pi management session has no product Task scope and is never auto-imported.",
    }));
  }
  for (const path of await childFiles(join(root, "data", "evals", "private"), "run.json")) {
    const run = await readJsonFile<Record<string, unknown>>(path, {});
    if (typeof run.projectId === "string" && typeof run.taskId === "string") continue;
    rows.push(await fileObservation(root, path, {
      kind: "unlinked_eval",
      records: 1,
      disposition: "excluded",
      reason: "Eval run lacks canonical project/Task scope and cannot be assigned without inventing provenance.",
    }));
  }
  return rows.sort((left, right) => left.path.localeCompare(right.path));
}

type LegacyWorkflowArtifacts = Pick<WorkflowArtifacts,
  "teamRolePasses" |
  "teamFindings" |
  "teamDecisions" |
  "teamCandidateTargets" |
  "teamRoleArtifacts" |
  "deliveryQaReports"
>;

async function legacyWorkflowArtifacts(root: string, projectId: string, workflowId: string): Promise<LegacyWorkflowArtifacts> {
  let stored: Partial<WorkflowArtifacts> = {};
  try {
    stored = JSON.parse(await readFile(workflowArtifactsPath(root, projectId), "utf8")) as Partial<WorkflowArtifacts>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const forWorkflow = <T extends { workflowId?: string }>(rows: T[] | undefined): T[] =>
    (rows ?? []).filter((row) => row.workflowId === workflowId);
  return {
    teamRolePasses: forWorkflow(stored.teamRolePasses),
    teamFindings: forWorkflow(stored.teamFindings),
    teamDecisions: forWorkflow(stored.teamDecisions),
    teamCandidateTargets: forWorkflow(stored.teamCandidateTargets),
    teamRoleArtifacts: forWorkflow(stored.teamRoleArtifacts),
    deliveryQaReports: forWorkflow(stored.deliveryQaReports),
  };
}

function workflowArtifactCount(artifacts: LegacyWorkflowArtifacts): number {
  return artifacts.teamFindings.length
    + artifacts.teamCandidateTargets.length
    + artifacts.teamRoleArtifacts.length
    + artifacts.deliveryQaReports.length;
}

export async function previewLegacyTaskBackfill(runtimeRoot: string): Promise<LegacyTaskBackfillPlan> {
  const root = resolve(runtimeRoot);
  const runtime = await previewRuntimeDataSnapshot(root);
  const candidates: LegacyTaskBackfillCandidate[] = [];
  const observations = await legacyObservations(root);
  const projectsRoot = join(root, "data", "projects");
  for (const project of await readdir(projectsRoot, { withFileTypes: true }).catch(() => [])) {
    if (!project.isDirectory()) continue;
    const projectId = project.name;
    const path = join(projectsRoot, projectId, "chat.json");
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") raw = undefined;
      else throw error;
    }
    if (raw !== undefined) {
      const sourceSha256 = await hashFile(path);
      const sourcePath = relative(root, path);
      const events = parseChatEvents(raw);
      const sessions = new Map<string, LegacyChatEvent[]>();
      for (const event of events) {
        if (!event.sessionId) {
          observations.push(await fileObservation(root, path, {
            kind: "malformed_chat_session",
            records: 1,
            disposition: "excluded",
            reason: "Legacy chat row has no session id and cannot be assigned without inventing provenance.",
          }));
          continue;
        }
        sessions.set(event.sessionId, [...(sessions.get(event.sessionId) ?? []), event]);
      }
      for (const [sessionId, sessionEvents] of sessions) {
        const { turns, orphanRows } = turnsForSession(sessionEvents);
        const terminalTurns = turns.filter((turn) => turn.events.some((event) => event.kind === "assistant" || event.kind === "error"));
        if (!turns.length || terminalTurns.length !== turns.length || orphanRows) {
          observations.push(await fileObservation(root, path, {
            kind: "malformed_chat_session",
            records: sessionEvents.length,
            disposition: "excluded",
            reason: "Legacy chat session is incomplete or contains rows before its first user turn; explicit review is required.",
          }));
          continue;
        }
        const sessionSha256 = digest(JSON.stringify(sessionEvents));
        const taskId = candidateTaskId(projectId, sessionId);
        const intent = candidateIntent(sourceSha256, sessionSha256);
        const status = await chatCandidateStatus(root, projectId, taskId, intent, turns.length);
        const startedAt = turns[0]!.user.ts;
        const updatedAt = sessionEvents.at(-1)!.ts;
        candidates.push({
          candidateId: taskId,
          taskId,
          sourceKind: "project_chat",
          projectId,
          sourcePath,
          sourceSha256,
          sessionSha256,
          status: status.status,
          reason: status.reason,
          title: candidateTitle(startedAt),
          startedAt,
          updatedAt,
          turnCount: turns.length,
          userMessages: turns.length,
          assistantMessages: sessionEvents.filter((event) => event.kind === "assistant").length,
          errorMessages: sessionEvents.filter((event) => event.kind === "error").length,
          toolCalls: turns.reduce((sum, turn) => sum + mergeTools(turn.events).length, 0),
          rolePasses: 0,
          artifacts: 0,
          decisions: 0,
        });
      }
    }

    for (const workflowPath of await childFiles(join(projectsRoot, projectId, "workflows"), ".json")) {
      let raw: unknown;
      try {
        raw = JSON.parse(await readFile(workflowPath, "utf8"));
      } catch {
        observations.push(await fileObservation(root, workflowPath, {
          kind: "malformed_workflow",
          records: 1,
          disposition: "excluded",
          reason: "Workflow JSON is malformed and cannot be archived without inventing structure.",
        }));
        continue;
      }
      const run = parseLegacyWorkflow(raw, projectId);
      if (!run) {
        observations.push(await fileObservation(root, workflowPath, {
          kind: "malformed_workflow",
          records: 1,
          disposition: "excluded",
          reason: "Workflow does not match the durable v1 contract and requires manual review.",
        }));
        continue;
      }
      const taskId = workflowCandidateTaskId(projectId, run.workflowId);
      if (run.taskId && run.taskId !== taskId) continue;
      const workflowSha256 = workflowArchiveDigest(run);
      const archiveIntent = workflowIntent(run.workflowId, workflowSha256);
      const status = await workflowCandidateStatus(root, run, taskId, archiveIntent);
      const workflowArtifacts = await legacyWorkflowArtifacts(root, projectId, run.workflowId);
      candidates.push({
        candidateId: taskId,
        taskId,
        sourceKind: "workflow",
        projectId,
        sourcePath: relative(root, workflowPath),
        sourceSha256: await hashFile(workflowPath),
        workflowSha256,
        workflowId: run.workflowId,
        batchId: run.batchId,
        workflowIntent: run.plan.intent,
        workflowStatus: run.status,
        status: status.status,
        reason: status.reason,
        title: workflowTitle(run),
        startedAt: run.createdAt,
        updatedAt: run.updatedAt,
        turnCount: 0,
        userMessages: run.plan.userRequest ? 1 : 0,
        assistantMessages: 0,
        errorMessages: run.status === "failed" ? 1 : 0,
        toolCalls: 0,
        rolePasses: workflowArtifacts.teamRolePasses.length,
        artifacts: workflowArtifactCount(workflowArtifacts),
        decisions: workflowArtifacts.teamDecisions.length,
      });
    }
  }
  candidates.sort((left, right) => left.projectId.localeCompare(right.projectId) || left.startedAt.localeCompare(right.startedAt));
  const mergedObservations = [...observations.reduce((rows, observation) => {
    const key = `${observation.kind}\0${observation.path}\0${observation.disposition}`;
    const previous = rows.get(key);
    rows.set(key, previous ? { ...previous, records: previous.records + observation.records } : observation);
    return rows;
  }, new Map<string, LegacyTaskBackfillObservation>()).values()]
    .sort((left, right) => left.path.localeCompare(right.path) || left.kind.localeCompare(right.kind));
  const summary = {
    eligible: candidates.filter((row) => row.status === "eligible").length,
    alreadyImported: candidates.filter((row) => row.status === "already_imported").length,
    conflicts: candidates.filter((row) => row.status === "conflict").length,
    turns: candidates.reduce((sum, row) => sum + row.turnCount, 0),
    workflows: candidates.filter((row) => row.sourceKind === "workflow").length,
    excludedObservations: mergedObservations.filter((row) => row.disposition !== "supporting_only").length,
  };
  const value = {
    formatVersion: 1 as const,
    runtimeManifestHash: runtime.manifestHash,
    backupFiles: runtime.files,
    backupBytes: runtime.bytes,
    candidates,
    observations: mergedObservations,
    recommendedCandidateIds: candidates.filter((row) => row.status === "eligible" && (
      row.sourceKind === "project_chat" ||
      (row.workflowStatus !== undefined && ["completed", "cancelled", "stopped", "failed"].includes(row.workflowStatus))
    )).map((row) => row.candidateId),
    summary,
  };
  return { mode: "preview", ...value, planHash: digest(JSON.stringify(value)) };
}

function usage(events: LegacyChatEvent[]): TaskUsage | undefined {
  const rows = events.map((event) => event.usage).filter((row): row is NonNullable<LegacyChatEvent["usage"]> => Boolean(row));
  if (!rows.length) return undefined;
  return rows.reduce<TaskUsage>((sum, row) => ({
    inputTokens: (sum.inputTokens ?? 0) + (row.inputTokens ?? 0),
    outputTokens: (sum.outputTokens ?? 0) + (row.outputTokens ?? 0),
    totalTokens: (sum.totalTokens ?? 0) + (row.totalTokens ?? 0),
    costUSD: (sum.costUSD ?? 0) + (row.costUsd ?? 0),
    modelCalls: (sum.modelCalls ?? 0) + (row.modelCalls ?? 1),
  }), {});
}

function historicalActivity(input: {
  id: string;
  taskId: string;
  runId: string;
  threadId: string;
  ts: string;
  type: TaskActivity["type"];
  status: TaskActivity["status"];
  actor: TaskActivity["actor"];
  title: string;
  body: string;
  tool?: TaskActivity["tool"];
  refs?: TaskActivity["refs"];
}): TaskRunEventDraft {
  return {
    id: `${input.id}.event`,
    type: "activity_append",
    agentThreadId: input.threadId,
    occurredAt: input.ts,
    activity: {
      id: input.id,
      taskId: input.taskId,
      runId: input.runId,
      agentThreadId: input.threadId,
      seq: 1,
      type: input.type,
      status: input.status,
      actor: input.actor,
      title: input.title,
      body: input.body,
      tool: input.tool ?? null,
      refs: input.refs ?? { artifactIds: [], evidenceRefs: [], decisionIds: [] },
      createdAt: input.ts,
      updatedAt: input.ts,
    },
  };
}

async function loadCandidateSession(root: string, candidate: LegacyTaskBackfillCandidate): Promise<{ sessionId: string; turns: LegacyTurn[] }> {
  if (candidate.sourceKind !== "project_chat" || !candidate.sessionSha256) throw new Error(`Candidate ${candidate.candidateId} is not a project chat session.`);
  const events = parseChatEvents(JSON.parse(await readFile(join(root, candidate.sourcePath), "utf8")));
  const matching = [...new Map(events.filter((event) => event.sessionId).map((event) => [event.sessionId!, true])).keys()]
    .map((sessionId) => ({ sessionId, rows: events.filter((event) => event.sessionId === sessionId) }))
    .find(({ sessionId }) => candidateTaskId(candidate.projectId, sessionId) === candidate.taskId);
  if (!matching || digest(JSON.stringify(matching.rows)) !== candidate.sessionSha256) throw new Error(`Legacy source session changed for ${candidate.candidateId}.`);
  return { sessionId: matching.sessionId, turns: turnsForSession(matching.rows).turns };
}

async function importChatCandidate(root: string, candidate: LegacyTaskBackfillCandidate): Promise<void> {
  if (!candidate.sessionSha256) throw new Error(`Candidate ${candidate.candidateId} has no project-chat session hash.`);
  const loaded = await loadCandidateSession(root, candidate);
  const times = [candidate.startedAt, candidate.updatedAt];
  const workspace = createTaskWorkspace(root, { now: () => times.shift() ?? candidate.updatedAt });
  await workspace.create({
    projectId: candidate.projectId,
    taskId: candidate.taskId,
    title: candidate.title,
    intent: candidateIntent(candidate.sourceSha256, candidate.sessionSha256),
    kind: "general",
  });
  for (const turn of loaded.turns) {
    const runId = `legacy-run-${digest(`${candidate.taskId}\0${turn.ordinal}\0${turn.user.ts}`).slice(0, 24)}`;
    const threadId = `${runId}.main`;
    const terminalEvent = [...turn.events].reverse().find((event) => event.kind === "assistant" || event.kind === "error");
    const runStatus: TaskRunStatus = terminalEvent?.kind === "error" ? "failed" : "complete";
    const completedAt = terminalEvent?.ts ?? turn.user.ts;
    const runUsage = usage(turn.events);
    const events: TaskRunEventDraft[] = [{
      id: `${runId}.run`,
      type: "run_upsert",
      agentThreadId: threadId,
      occurredAt: turn.user.ts,
      run: {
        id: runId,
        taskId: candidate.taskId,
        mode: "single",
        status: runStatus,
        rootAgentThreadId: threadId,
        planHash: null,
        estimatedCalls: 1,
        startedAt: turn.user.ts,
        updatedAt: completedAt,
        completedAt,
        stopAvailable: false,
        resumeAvailable: false,
        usage: runUsage,
      },
    }, {
      id: `${runId}.thread`,
      type: "thread_upsert",
      agentThreadId: threadId,
      occurredAt: turn.user.ts,
      thread: {
        id: threadId,
        taskId: candidate.taskId,
        runId,
        parentThreadId: null,
        identity: { kind: "main", roleId: "linguist-agent", displayName: "Linguist Agent", roleLabel: "Main Agent", disclosureLabel: "Agent" },
        status: runStatus,
        canReceiveUserMessage: false,
        handoffSummary: "Read-only history imported from the legacy project Agent chat.",
        latestActivityId: null,
        childThreadIds: [],
        createdAt: turn.user.ts,
        updatedAt: completedAt,
      },
    }, historicalActivity({
      id: `${runId}.message`,
      taskId: candidate.taskId,
      runId,
      threadId,
      ts: turn.user.ts,
      type: "message",
      status: "done",
      actor: { kind: "human", id: "user", displayName: "You", agentThreadId: null },
      title: "You",
      body: turn.user.text,
    })];
    for (const [index, tool] of mergeTools(turn.events).entries()) {
      events.push(historicalActivity({
        id: `${runId}.tool.${index + 1}.${digest(tool.key).slice(0, 10)}`,
        taskId: candidate.taskId,
        runId,
        threadId,
        ts: tool.ts,
        type: "tool_action",
        status: tool.failed ? "error" : "done",
        actor: { kind: "agent", id: "linguist-agent", displayName: "Linguist Agent", agentThreadId: threadId },
        title: `Historical tool · ${tool.name}`,
        body: tool.text,
        tool: { name: tool.name, effect: "execute", target: null, outcome: tool.failed ? "error" : "completed" },
      }));
    }
    for (const [index, event] of turn.events.filter((row) => row.kind === "assistant" || row.kind === "error").entries()) {
      events.push(historicalActivity({
        id: `${runId}.${event.kind}.${index + 1}`,
        taskId: candidate.taskId,
        runId,
        threadId,
        ts: event.ts,
        type: event.kind === "error" ? "error" : "final_response",
        status: event.kind === "error" ? "error" : "done",
        actor: event.kind === "error"
          ? { kind: "system", id: "legacy-runtime", displayName: "Legacy Runtime", agentThreadId: threadId }
          : { kind: "agent", id: "linguist-agent", displayName: "Linguist Agent", agentThreadId: threadId },
        title: event.kind === "error" ? "Legacy run failed" : "Linguist Agent",
        body: event.text,
      }));
    }
    await workspace.appendGenerated({ projectId: candidate.projectId, taskId: candidate.taskId, runId, events });
  }
  await workspace.archive({ projectId: candidate.projectId, taskId: candidate.taskId });
}

async function loadWorkflowCandidate(root: string, candidate: LegacyTaskBackfillCandidate): Promise<CatWorkflowRun> {
  if (candidate.sourceKind !== "workflow" || !candidate.workflowId || !candidate.workflowSha256) {
    throw new Error(`Candidate ${candidate.candidateId} is not a Workflow archive.`);
  }
  const raw = JSON.parse(await readFile(join(root, candidate.sourcePath), "utf8"));
  const run = parseLegacyWorkflow(raw, candidate.projectId);
  if (!run || run.workflowId !== candidate.workflowId || workflowArchiveDigest(run) !== candidate.workflowSha256) {
    throw new Error(`Legacy Workflow source changed for ${candidate.candidateId}.`);
  }
  return run;
}

function taskKindForWorkflow(intent: CatWorkflowIntent): TaskKind {
  if (intent === "translate_batch" || intent === "game_localization_team_run") return "translation";
  if (["edit_batch", "proof_batch", "review_batch", "show_proposals"].includes(intent)) return "review";
  if (intent === "prepare_delivery") return "delivery";
  if (intent === "check_assets") return "qa";
  return "general";
}

function archivedRunStatus(status: CatWorkflowRunStatus): TaskRunStatus {
  if (status === "completed") return "complete";
  if (status === "failed") return "failed";
  return "stopped";
}

function archivedRoleStatus(pass: TeamRolePass): TaskRunStatus {
  if (pass.status === "completed" || pass.status === "skipped") return "complete";
  if (pass.status === "failed") return "failed";
  return "stopped";
}

function workflowUsage(passes: TeamRolePass[]): TaskUsage | undefined {
  const withUsage = passes.filter((pass) => pass.usage);
  if (!withUsage.length) return undefined;
  return withUsage.reduce<TaskUsage>((total, pass) => ({
    inputTokens: (total.inputTokens ?? 0) + (pass.usage?.inputTokens ?? 0),
    outputTokens: (total.outputTokens ?? 0) + (pass.usage?.outputTokens ?? 0),
    totalTokens: (total.totalTokens ?? 0) + (pass.usage?.totalTokens ?? 0),
    costUSD: (total.costUSD ?? 0) + (pass.usage?.costUsd ?? 0),
    modelCalls: (total.modelCalls ?? 0) + (DETERMINISTIC_TEAM_ROLE_IDS.has(pass.roleId) ? 0 : 1),
  }), {});
}

function archivedRolePass(pass: TeamRolePass): Record<string, unknown> {
  return JSON.parse(JSON.stringify({
    roleId: pass.roleId,
    status: pass.status,
    modelProvider: pass.modelProvider,
    modelId: pass.modelId,
    thinking: pass.thinking,
    startedAt: pass.startedAt,
    completedAt: pass.completedAt,
    inputArtifactRefs: pass.inputArtifactRefs,
    outputArtifactRefs: pass.outputArtifactRefs,
    usage: pass.usage,
    contextManifestRef: pass.contextManifestRef,
    contextManifest: pass.contextManifest,
    summary: pass.summary,
  })) as Record<string, unknown>;
}

async function importWorkflowCandidate(root: string, candidate: LegacyTaskBackfillCandidate): Promise<void> {
  const run = await loadWorkflowCandidate(root, candidate);
  const artifacts = await legacyWorkflowArtifacts(root, candidate.projectId, run.workflowId);
  const scope: TaskScope = { kind: "project", batchId: run.batchId, segmentIds: [] };
  const runId = `legacy-run-${digest(`${candidate.taskId}\0${run.workflowId}`).slice(0, 24)}`;
  const rootThreadId = `${runId}.main`;
  const runStatus = archivedRunStatus(run.status);
  const rolePasses = [...artifacts.teamRolePasses].sort((left, right) =>
    (left.startedAt ?? left.completedAt ?? "").localeCompare(right.startedAt ?? right.completedAt ?? "") || left.roleId.localeCompare(right.roleId));
  const roleThreadIds = new Map(rolePasses.map((pass) => [pass.roleId, `${runId}.${pass.roleId}`]));
  const archiveArtifactId = `${runId}.workflow-archive`;
  const archiveActivityId = `${runId}.workflow-archive.activity`;
  const times = [run.createdAt, run.updatedAt];
  const workspace = createTaskWorkspace(root, { now: () => times.shift() ?? run.updatedAt });
  await workspace.create({
    projectId: candidate.projectId,
    taskId: candidate.taskId,
    title: candidate.title,
    intent: workflowIntent(run.workflowId, candidate.workflowSha256!),
    kind: taskKindForWorkflow(run.plan.intent),
    scope: { batchId: run.batchId },
  });

  const modelRoutes = Object.fromEntries(rolePasses.flatMap((pass) =>
    pass.modelId ? [[pass.roleId, pass.modelProvider ? `${pass.modelProvider}/${pass.modelId}` : pass.modelId]] : []));
  const events: TaskRunEventDraft[] = [{
    id: `${runId}.run`,
    type: "run_upsert",
    agentThreadId: rootThreadId,
    occurredAt: run.createdAt,
    run: {
      id: runId,
      taskId: candidate.taskId,
      mode: run.plan.intent === "game_localization_team_run" || rolePasses.length ? "team" : "pipeline",
      status: runStatus,
      rootAgentThreadId: rootThreadId,
      planHash: run.teamPlanHash ?? null,
      estimatedCalls: rolePasses.filter((pass) => !DETERMINISTIC_TEAM_ROLE_IDS.has(pass.roleId)).length,
      modelRoutes,
      startedAt: run.createdAt,
      updatedAt: run.updatedAt,
      completedAt: run.updatedAt,
      stopAvailable: false,
      resumeAvailable: false,
      usage: workflowUsage(rolePasses),
    },
  }, {
    id: `${runId}.thread`,
    type: "thread_upsert",
    agentThreadId: rootThreadId,
    occurredAt: run.createdAt,
    thread: {
      id: rootThreadId,
      taskId: candidate.taskId,
      runId,
      parentThreadId: null,
      identity: { kind: "main", roleId: "linguist-agent", displayName: "Linguist Agent", roleLabel: "Main Agent", disclosureLabel: "Agent" },
      status: runStatus,
      canReceiveUserMessage: false,
      handoffSummary: `Read-only Workflow archive; original status: ${run.status}.`,
      latestActivityId: null,
      childThreadIds: [...roleThreadIds.values()],
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    },
  }];

  for (const pass of rolePasses) {
    const threadId = roleThreadIds.get(pass.roleId)!;
    const deterministic = DETERMINISTIC_TEAM_ROLE_IDS.has(pass.roleId);
    events.push({
      id: `${threadId}.thread`,
      type: "thread_upsert",
      agentThreadId: threadId,
      occurredAt: pass.startedAt ?? run.createdAt,
      thread: {
        id: threadId,
        taskId: candidate.taskId,
        runId,
        parentThreadId: rootThreadId,
        identity: {
          kind: deterministic ? "deterministic" : "specialist",
          roleId: pass.roleId,
          displayName: teamRoleDisplayName(pass.roleId),
          roleLabel: deterministic ? "System" : "Specialist",
          disclosureLabel: deterministic ? "System" : "Agent",
        },
        status: archivedRoleStatus(pass),
        canReceiveUserMessage: false,
        handoffSummary: pass.summary || null,
        latestActivityId: null,
        childThreadIds: [],
        createdAt: pass.startedAt ?? run.createdAt,
        updatedAt: pass.completedAt ?? run.updatedAt,
      },
    }, historicalActivity({
      id: `${threadId}.summary`,
      taskId: candidate.taskId,
      runId,
      threadId,
      ts: pass.completedAt ?? pass.startedAt ?? run.updatedAt,
      type: pass.status === "failed" ? "error" : "handoff",
      status: pass.status === "failed" ? "error" : ["queued", "running", "waiting", "stopping"].includes(pass.status) ? "stale" : "done",
      actor: deterministic
        ? { kind: "system", id: pass.roleId, displayName: teamRoleDisplayName(pass.roleId), agentThreadId: threadId }
        : { kind: "agent", id: pass.roleId, displayName: teamRoleDisplayName(pass.roleId), agentThreadId: threadId },
      title: `${teamRoleDisplayName(pass.roleId)} · ${pass.status}`,
      body: pass.summary,
    }));
  }

  for (const [index, item] of run.history.entries()) {
    events.push(historicalActivity({
      id: `${runId}.history.${index + 1}`,
      taskId: candidate.taskId,
      runId,
      threadId: rootThreadId,
      ts: item.ts,
      type: item.kind === "failed" ? "error" : item.kind === "approved" ? "decision" : item.kind === "created" || item.kind === "readiness" ? "plan" : "progress",
      status: item.kind === "failed" ? "error" : "done",
      actor: { kind: "system", id: "legacy-workflow", displayName: "Workflow", agentThreadId: rootThreadId },
      title: `Workflow · ${item.kind}`,
      body: item.message,
    }));
  }

  const evidenceRefs = [...new Set([
    ...artifacts.teamFindings.flatMap((row) => row.evidenceRefs),
    ...artifacts.teamCandidateTargets.flatMap((row) => row.evidenceRefs),
    ...artifacts.teamDecisions.flatMap((row) => row.evidenceRefs ?? []),
  ])];
  const archiveArtifact: TaskArtifact = {
    id: archiveArtifactId,
    taskId: candidate.taskId,
    runId,
    type: "evidence_pack",
    status: "final",
    title: "Historical Workflow archive",
    summary: `${run.plan.intent} · ${run.status} · ${rolePasses.length} role pass(es)`,
    scope,
    version: 1,
    provenance: { agentThreadId: rootThreadId, activityId: archiveActivityId, evidenceRefs, parentArtifactIds: [] },
    availableDecisions: [],
    content: {
      archiveSchemaVersion: 1,
      transcriptImported: false,
      originalWorkflow: workflowArchiveValue(run),
      rolePasses: rolePasses.map(archivedRolePass),
      roleArtifacts: artifacts.teamRoleArtifacts,
      findings: artifacts.teamFindings,
      decisions: artifacts.teamDecisions,
      candidateTargets: artifacts.teamCandidateTargets,
      deliveryQaReports: artifacts.deliveryQaReports,
    },
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
  events.push(historicalActivity({
    id: archiveActivityId,
    taskId: candidate.taskId,
    runId,
    threadId: rootThreadId,
    ts: run.updatedAt,
    type: "artifact_update",
    status: "done",
    actor: { kind: "system", id: "legacy-workflow", displayName: "Workflow", agentThreadId: rootThreadId },
    title: "Workflow archive preserved",
    body: "Structured history and typed artifacts were preserved. Raw transcript and hidden reasoning were not imported.",
    refs: { artifactIds: [archiveArtifactId], evidenceRefs, decisionIds: [] },
  }), {
    id: `${archiveArtifactId}.event`,
    type: "artifact_upsert",
    agentThreadId: rootThreadId,
    occurredAt: run.updatedAt,
    artifact: archiveArtifact,
  });

  await workspace.appendGenerated({ projectId: candidate.projectId, taskId: candidate.taskId, runId, events });
  await workspace.archive({ projectId: candidate.projectId, taskId: candidate.taskId });
  await linkCatWorkflowTask(root, candidate.projectId, run.workflowId, candidate.taskId);
}

export async function executeLegacyTaskBackfill(
  runtimeRoot: string,
  input: { planHash: string; selectedCandidateIds: string[] },
): Promise<LegacyTaskBackfillResult> {
  const root = resolve(runtimeRoot);
  const plan = await previewLegacyTaskBackfill(root);
  if (plan.planHash !== input.planHash) throw new Error("Legacy Task backfill plan changed; preview again before executing.");
  const selectedIds = [...new Set(input.selectedCandidateIds)];
  if (!selectedIds.length) throw new Error("Legacy Task backfill requires at least one explicitly selected candidate.");
  const candidates = new Map(plan.candidates.map((candidate) => [candidate.candidateId, candidate]));
  const selected = selectedIds.map((id) => {
    const candidate = candidates.get(id);
    if (!candidate) throw new Error(`Legacy Task backfill candidate ${id} is not in the current plan.`);
    if (candidate.status === "conflict") throw new Error(`Legacy Task backfill candidate ${id} conflicts with existing Task data.`);
    return candidate;
  });
  const pending = selected.filter((candidate) => candidate.status === "eligible");
  const alreadyImportedTaskIds = selected.filter((candidate) => candidate.status === "already_imported").map((candidate) => candidate.taskId);
  if (!pending.length) return { mode: "execute", planHash: plan.planHash, importedTaskIds: [], alreadyImportedTaskIds };

  const backup = await createVerifiedRuntimeDataBackup(root);
  if (backup.manifestHash !== plan.runtimeManifestHash) throw new Error("Runtime data changed before the verified backfill backup completed.");
  const importedTaskIds: string[] = [];
  try {
    for (const candidate of pending) {
      if (candidate.sourceKind === "workflow") await importWorkflowCandidate(root, candidate);
      else await importChatCandidate(root, candidate);
      importedTaskIds.push(candidate.taskId);
    }
  } catch (error) {
    const rollback = await previewRuntimeDataRollback(root, backup.backupId);
    await executeRuntimeDataRollback(root, { backupId: backup.backupId, planHash: rollback.planHash });
    const message = error instanceof Error ? error.message : String(error);
    throw new TaskWorkspaceConflictError(`Legacy Task backfill failed and runtime data was restored: ${message}`);
  }
  return { mode: "execute", planHash: plan.planHash, backup, importedTaskIds, alreadyImportedTaskIds };
}
