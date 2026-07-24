import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createTaskWorkspace,
  canonicalLocale,
  localesMatch,
  readBatch,
  readProjectManifest,
  requireProjectTaskScope,
  TaskWorkspaceConflictError,
  TaskWorkspaceNotFoundError,
  type TaskKind,
  type TaskRun,
  type TaskScope,
} from "@linguist-agent/cat-data";
import { taskRunApplicationPort, type TaskComposerCapabilityId } from "../application/task_run_application_port.js";
import { executeTaskDecision, TaskDecisionExecutionError } from "../task_decision_executor.js";
import { commitTaskExtensionInteraction } from "../task_extension_interactions.js";
import {
  TaskPackageProfileError,
  type TaskPackageExecutableApproval,
  type TaskPackageProfile,
  type TaskPackageProfilePreview,
  type TaskPackageSelection,
} from "../task_package_profile.js";
import {
  StrictApiInputError,
  strictApiArray,
  strictApiJsonValue,
  strictApiObject,
  strictApiOptional,
  strictApiString,
} from "../strict_api_contract.js";
import { streamCanonicalTaskEvents, taskListResponse, validatedTaskTitle } from "./task_route_shared.js";
import { handleTaskMessageQueueRoute, type TaskMessageQueueRouteService } from "./task_message_queue_routes.js";

const TASK_KINDS = new Set<TaskKind>(["translation", "review", "qa", "delivery", "eval", "general"]);
const TASK_THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const optionalText = () => strictApiOptional(strictApiString());
const optionalJson = () => strictApiOptional(strictApiJsonValue());

const createTaskSchema = strictApiObject({
  taskId: optionalText(),
  title: strictApiString(),
  intent: strictApiString(),
  kind: strictApiString(),
  initialMessage: optionalText(),
  segmentIds: strictApiOptional(strictApiArray(strictApiString())),
  sourceLocale: optionalText(),
  targetLocale: optionalText(),
  batchId: optionalText(),
  assetPaths: strictApiOptional(strictApiArray(strictApiString(), { maxItems: 12 })),
}, { name: "Project Task creation" });

const resourceProfilePreviewSchema = strictApiObject({
  expectedRevision: strictApiJsonValue(),
  selections: strictApiJsonValue(),
  executableApprovals: optionalJson(),
}, { name: "Task Package profile preview" });

const resourceProfileApplySchema = strictApiObject({
  expectedRevision: strictApiJsonValue(),
  planHash: strictApiString(),
  selections: strictApiJsonValue(),
  executableApprovals: optionalJson(),
}, { name: "Task Package profile apply" });

const renameTaskSchema = strictApiObject({ title: strictApiString() }, { name: "Project Task rename" });
const followUpSchema = strictApiObject({
  message: strictApiString(),
  artifactId: optionalText(),
  activityId: optionalText(),
}, { name: "specialist follow-up" });
const taskChatSchema = strictApiObject({
  message: strictApiString(),
  runId: optionalText(),
  segmentId: optionalText(),
  // Legacy clients may still send this forged field; it is deliberately
  // accepted for compatibility and never becomes canonical source context.
  segmentSource: optionalJson(),
  modelProvider: optionalText(),
  modelId: optionalText(),
  thinkingLevel: optionalText(),
  assetPaths: strictApiOptional(strictApiArray(strictApiString(), { maxItems: 12 })),
  capabilityIds: strictApiOptional(strictApiArray(strictApiString(), { maxItems: 12 })),
}, { name: "Project Task chat" });
const projectMessageSchema = strictApiObject({
  message: strictApiString(),
  delivery: strictApiString(),
}, { name: "Project Task message" });
const projectCompactionSchema = strictApiObject({ customInstructions: optionalText() }, { name: "Project Task compaction" });
const projectStopSchema = strictApiObject({ reason: optionalText(), turnId: optionalText() }, { name: "Project Task stop" });
const projectDecisionSchema = strictApiObject({ optionId: strictApiString(), reason: strictApiString() }, { name: "Project Task decision" });
const interactionAnswerSchema = strictApiObject({
  decisionId: strictApiString(),
  selectedOptionIds: strictApiOptional(strictApiArray(strictApiString())),
  responseText: optionalText(),
}, { name: "Task interaction answer" });
const taskInteractionSchema = strictApiObject({
  action: strictApiString(),
  reason: optionalText(),
  answers: strictApiOptional(strictApiArray(interactionAnswerSchema)),
}, { name: "Task decision interaction" });

async function validatedTaskAssetPaths(repoRoot: string, projectId: string, value: unknown): Promise<{ paths: string[]; refs: string[] }> {
  if (value === undefined) return { paths: [], refs: [] };
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string" && entry.trim())) {
    throw new TaskWorkspaceConflictError("assetPaths must be an array of non-empty Project asset paths.");
  }
  const paths = [...new Set(value.map((entry) => (entry as string).trim()))];
  if (paths.length > 12) throw new TaskWorkspaceConflictError("A Task message can attach at most 12 Project assets.");
  const manifest = await readProjectManifest(repoRoot, projectId);
  const known = new Set(manifest.scan.assets.map((asset) => asset.relPath));
  const unknown = paths.filter((path) => !known.has(path));
  if (unknown.length) throw new TaskWorkspaceConflictError(`Unknown Project asset attachment: ${unknown.join(", ")}.`);
  return { paths, refs: paths.map((path) => `asset:${path}`) };
}

export interface TaskAgentRuntimeRouteDeps {
  requireString: (value: unknown, label: string) => string;
  optionalString: (value: unknown) => string | undefined;
  sseHeaders: (res: ServerResponse) => void;
  writeSse: (res: ServerResponse, event: unknown) => void;
  runAgentStreaming: (
    projectId: string,
    message: string,
    emit: (event: unknown) => void,
    options: {
      expectedRunId?: string;
      segmentId?: string;
      segmentSource?: string;
      modelProvider?: string;
      modelId?: string;
      thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
      sessionId: string;
      taskId: string;
      taskScope: TaskScope;
      attachmentPaths?: string[];
      attachmentRefs?: string[];
      capabilityIds?: TaskComposerCapabilityId[];
    },
  ) => Promise<unknown[]>;
  stopAgent: (input: {
    projectId: string;
    taskId: string;
    reason?: string;
    runId?: string;
    mode?: TaskRun["mode"];
  }) => Promise<unknown>;
  projectSessionInfo: (projectId: string, sessionId: string) => Promise<unknown>;
  compactProjectAgentSession: (projectId: string, taskId: string, customInstructions: string | undefined, sessionId: string) => Promise<unknown>;
  deliverMessage: (input: {
    projectId: string;
    taskId: string;
    runId?: string;
    message: string;
    delivery: "steer" | "follow_up";
  }) => Promise<unknown>;
  messageQueue: TaskMessageQueueRouteService;
}

export interface TaskSpecialistFollowUpRouteDeps {
  start: (input: {
    projectId: string;
    taskId: string;
    sourceThreadId: string;
    message: string;
    artifactId?: string;
    activityId?: string;
  }) => Promise<unknown>;
}

export function taskAgentSessionId(taskId: string): string {
  return `la-task-${taskId}`;
}

export function formatTaskRuntimeScope(scope: TaskScope): string[] {
  const projectScope = requireProjectTaskScope(scope, "CAT Task");
  const segments = projectScope.segmentIds.length
    ? projectScope.segmentIds.join(", ")
    : projectScope.batchId
      ? "all segments in the selected batch"
      : "not specified";
  return [
    `Task batch: ${projectScope.batchId ?? "project-level"}`,
    `Task locale: ${projectScope.sourceLocale ?? "unscoped"} -> ${projectScope.targetLocale ?? "unscoped"}`,
    `Task segments: ${segments}`,
  ];
}

export async function handleTaskWorkspaceRoute(req: IncomingMessage, res: ServerResponse, url: URL, parts: string[], projectId: string, deps: {
  repoRoot: string;
  json: (res: ServerResponse, status: number, data: unknown) => void;
  readBody: (req: IncomingMessage) => Promise<unknown>;
  scheduleAutoTitle?: (input: { projectId: string; taskId: string }) => void;
  agentRuntime?: TaskAgentRuntimeRouteDeps;
  specialistFollowUp?: TaskSpecialistFollowUpRouteDeps;
  taskPackageProfile?: {
    read: (input: { projectId: string; taskId: string }) => Promise<TaskPackageProfile>;
    preview: (input: { projectId: string; taskId: string; expectedRevision: number; selections: TaskPackageSelection[]; executableApprovals?: TaskPackageExecutableApproval[] }) => Promise<TaskPackageProfilePreview>;
    apply: (input: { projectId: string; taskId: string; expectedRevision: number; planHash: string; selections: TaskPackageSelection[]; executableApprovals?: TaskPackageExecutableApproval[] }) => Promise<TaskPackageProfile>;
  };
}): Promise<boolean> {
  if (parts[3] !== "tasks") return false;
  const workspace = createTaskWorkspace(deps.repoRoot);

  try {
    if (parts.length === 4 && req.method === "GET") {
      const snapshots = await workspace.listSnapshots({ projectId });
      deps.json(res, 200, taskListResponse(snapshots));
      return true;
    }
    if (parts.length === 4 && req.method === "POST") {
      const body = createTaskSchema.parse(await deps.readBody(req), "Project Task creation");
      const kind = typeof body.kind === "string" && TASK_KINDS.has(body.kind as TaskKind) ? body.kind as TaskKind : undefined;
      if (typeof body.title !== "string" || !body.title.trim() || typeof body.intent !== "string" || !body.intent.trim() || !kind) {
        deps.json(res, 400, { error: "title, intent, and a valid kind are required." });
        return true;
      }
      if (body.initialMessage !== undefined && (typeof body.initialMessage !== "string" || !body.initialMessage.trim())) {
        deps.json(res, 400, { error: "initialMessage must be a non-empty string when provided." });
        return true;
      }
      if (body.segmentIds !== undefined && (!Array.isArray(body.segmentIds) || !body.segmentIds.every((value) => typeof value === "string"))) {
        deps.json(res, 400, { error: "segmentIds must be an array of strings." });
        return true;
      }
      if ((body.sourceLocale !== undefined && typeof body.sourceLocale !== "string") || (body.targetLocale !== undefined && typeof body.targetLocale !== "string")) {
        deps.json(res, 400, { error: "sourceLocale and targetLocale must be strings." });
        return true;
      }
      if (body.batchId !== undefined && typeof body.batchId !== "string") {
        deps.json(res, 400, { error: "batchId must be a string." });
        return true;
      }
      const segmentIds = Array.isArray(body.segmentIds) ? body.segmentIds as string[] : [];
      const batchId = typeof body.batchId === "string" && body.batchId.trim() ? body.batchId.trim() : undefined;
      let sourceLocale = typeof body.sourceLocale === "string" && body.sourceLocale.trim() ? body.sourceLocale.trim() : undefined;
      let targetLocale = typeof body.targetLocale === "string" && body.targetLocale.trim() ? body.targetLocale.trim() : undefined;
      if (batchId) {
        let batch;
        try {
          batch = await readBatch(deps.repoRoot, projectId, batchId);
        } catch (error) {
          if (error instanceof Error && /not found/.test(error.message)) {
            deps.json(res, 404, { error: error.message });
            return true;
          }
          throw error;
        }
        const batchSegmentIds = new Set(batch.segments.map((segment) => segment.id));
        const unknownSegmentIds = segmentIds.filter((segmentId) => !batchSegmentIds.has(segmentId));
        if (unknownSegmentIds.length) {
          deps.json(res, 400, { error: `Task segmentIds are not in batch ${batchId}: ${unknownSegmentIds.join(", ")}.` });
          return true;
        }
        if ((sourceLocale && !localesMatch(sourceLocale, batch.sourceLanguage)) || (targetLocale && !localesMatch(targetLocale, batch.targetLanguage))) {
          deps.json(res, 400, { error: `Task locale must match batch ${batchId}: ${batch.sourceLanguage} -> ${batch.targetLanguage}.` });
          return true;
        }
        sourceLocale = batch.sourceLanguage;
        targetLocale = batch.targetLanguage;
      } else if (segmentIds.length) {
        deps.json(res, 400, { error: "segmentIds require batchId." });
        return true;
      } else if (Boolean(sourceLocale) !== Boolean(targetLocale)) {
        deps.json(res, 400, { error: "sourceLocale and targetLocale must be provided together." });
        return true;
      } else if (sourceLocale && targetLocale) {
        try {
          sourceLocale = canonicalLocale(sourceLocale, "sourceLocale");
          targetLocale = canonicalLocale(targetLocale, "targetLocale");
        } catch (error) {
          deps.json(res, 400, { error: error instanceof Error ? error.message : String(error) });
          return true;
        }
      }
      const snapshot = await workspace.create({
        projectId,
        taskId: typeof body.taskId === "string" ? body.taskId : undefined,
        title: body.title,
        intent: body.intent,
        kind,
        initialMessage: typeof body.initialMessage === "string" ? body.initialMessage : undefined,
        initialEvidenceRefs: (await validatedTaskAssetPaths(deps.repoRoot, projectId, body.assetPaths)).refs,
        autoTitle: Boolean(deps.scheduleAutoTitle),
        scope: {
          batchId,
          segmentIds,
          sourceLocale,
          targetLocale,
        },
      });
      deps.scheduleAutoTitle?.({ projectId, taskId: snapshot.task.id });
      deps.json(res, 201, snapshot);
      return true;
    }

    const taskId = parts[4];
    const agentRuntime = deps.agentRuntime;
    if (taskId && await handleTaskMessageQueueRoute({
      req,
      res,
      parts,
      queueIndex: 5,
      locator: { kind: "project", projectId, taskId },
      repoRoot: deps.repoRoot,
      json: deps.json,
      readBody: deps.readBody,
      service: agentRuntime?.messageQueue,
    })) return true;
    if (taskId && parts[5] === "resource-profile" && parts.length === 6 && req.method === "GET") {
      await workspace.open({ projectId, taskId });
      if (!deps.taskPackageProfile) throw new TaskWorkspaceConflictError("Task Package profile runtime is unavailable.");
      deps.json(res, 200, await deps.taskPackageProfile.read({ projectId, taskId }));
      return true;
    }
    if (taskId && parts[5] === "resource-profile" && parts[6] === "preview" && parts.length === 7 && req.method === "POST") {
      await workspace.open({ projectId, taskId });
      if (!deps.taskPackageProfile) throw new TaskWorkspaceConflictError("Task Package profile runtime is unavailable.");
      const body = resourceProfilePreviewSchema.parse(await deps.readBody(req), "Task Package profile preview");
      if (!Number.isInteger(body.expectedRevision) || (body.expectedRevision as number) < 0) {
        deps.json(res, 400, { error: "expectedRevision must be a non-negative integer." });
        return true;
      }
      if (!Array.isArray(body.selections)) {
        deps.json(res, 400, { error: "selections must be an array." });
        return true;
      }
      deps.json(res, 200, await deps.taskPackageProfile.preview({
        projectId,
        taskId,
        expectedRevision: body.expectedRevision as number,
        selections: body.selections as TaskPackageSelection[],
        executableApprovals: body.executableApprovals as TaskPackageExecutableApproval[] | undefined,
      }));
      return true;
    }
    if (taskId && parts[5] === "resource-profile" && parts.length === 6 && req.method === "PUT") {
      await workspace.open({ projectId, taskId });
      if (!deps.taskPackageProfile) throw new TaskWorkspaceConflictError("Task Package profile runtime is unavailable.");
      const body = resourceProfileApplySchema.parse(await deps.readBody(req), "Task Package profile apply");
      if (!Number.isInteger(body.expectedRevision) || (body.expectedRevision as number) < 0) {
        deps.json(res, 400, { error: "expectedRevision must be a non-negative integer." });
        return true;
      }
      if (typeof body.planHash !== "string" || !body.planHash.trim()) {
        deps.json(res, 400, { error: "planHash is required." });
        return true;
      }
      if (!Array.isArray(body.selections)) {
        deps.json(res, 400, { error: "selections must be an array." });
        return true;
      }
      deps.json(res, 200, await deps.taskPackageProfile.apply({
        projectId,
        taskId,
        expectedRevision: body.expectedRevision as number,
        planHash: body.planHash,
        selections: body.selections as TaskPackageSelection[],
        executableApprovals: body.executableApprovals as TaskPackageExecutableApproval[] | undefined,
      }));
      return true;
    }
    if (taskId && parts.length === 5 && req.method === "PATCH") {
      const body = renameTaskSchema.parse(await deps.readBody(req), "Project Task rename");
      let title: string;
      try { title = validatedTaskTitle(body.title); }
      catch (error) {
        deps.json(res, 400, { error: error instanceof Error ? error.message : String(error) });
        return true;
      }
      deps.json(res, 200, await workspace.updateTitle({ projectId, taskId, title }));
      return true;
    }
    if (taskId && parts[5] === "threads" && parts[6] && parts[7] === "follow-up" && parts.length === 8 && req.method === "POST") {
      await workspace.open({ projectId, taskId });
      if (!deps.specialistFollowUp) throw new TaskWorkspaceConflictError("Specialist follow-up runtime is unavailable.");
      const body = followUpSchema.parse(await deps.readBody(req), "specialist follow-up");
      if (typeof body.message !== "string" || !body.message.trim()) {
        deps.json(res, 400, { error: "message is required." });
        return true;
      }
      deps.json(res, 202, await deps.specialistFollowUp.start({
        projectId,
        taskId,
        sourceThreadId: decodeURIComponent(parts[6]),
        message: body.message,
        artifactId: typeof body.artifactId === "string" && body.artifactId.trim() ? body.artifactId : undefined,
        activityId: typeof body.activityId === "string" && body.activityId.trim() ? body.activityId : undefined,
      }));
      return true;
    }
    if (taskId && agentRuntime && parts[5] === "chat" && parts[6] === "stream" && parts.length === 7 && req.method === "POST") {
      const snapshot = await workspace.open({ projectId, taskId });
      let taskScope = requireProjectTaskScope(snapshot.task.scope, "CAT Task");
      let batch: Awaited<ReturnType<typeof readBatch>> | undefined;
      if (taskScope.batchId) {
        batch = await readBatch(deps.repoRoot, projectId, taskScope.batchId);
        taskScope = { ...taskScope, sourceLocale: batch.sourceLanguage, targetLocale: batch.targetLanguage };
      }
      const body = taskChatSchema.parse(await deps.readBody(req), "Project Task chat");
      const message = agentRuntime.requireString(body.message, "message");
      const expectedRunId = agentRuntime.optionalString(body.runId);
      const segmentId = agentRuntime.optionalString(body.segmentId);
      const modelProvider = agentRuntime.optionalString(body.modelProvider);
      const modelId = agentRuntime.optionalString(body.modelId);
      if (Boolean(modelProvider) !== Boolean(modelId)) {
        deps.json(res, 400, { error: "modelProvider and modelId must be supplied together." });
        return true;
      }
      const thinkingValue = agentRuntime.optionalString(body.thinkingLevel);
      if (thinkingValue && !TASK_THINKING_LEVELS.has(thinkingValue)) {
        deps.json(res, 400, { error: "thinkingLevel is invalid." });
        return true;
      }
      const thinkingLevel = thinkingValue as "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | undefined;
      const attachments = await validatedTaskAssetPaths(deps.repoRoot, projectId, body.assetPaths);
      const capabilityIds = taskRunApplicationPort.resolveComposerCapabilityIds(body.capabilityIds);
      let segmentSource: string | undefined;
      if (segmentId) {
        if (!batch || !taskScope.batchId) throw new TaskWorkspaceConflictError(`Focused segment ${segmentId} requires a batch-scoped Task.`);
        if (taskScope.segmentIds.length && !taskScope.segmentIds.includes(segmentId)) {
          throw new TaskWorkspaceConflictError(`Focused segment ${segmentId} is outside Task scope.`);
        }
        const segment = batch.segments.find((row) => row.id === segmentId);
        if (!segment) throw new TaskWorkspaceConflictError(`Focused segment ${segmentId} is not in canonical batch ${taskScope.batchId}.`);
        segmentSource = segment.source;
      }
      const sessionId = taskAgentSessionId(taskId);
      agentRuntime.sseHeaders(res);
      res.write(": connected\n\n");
      try {
        const chat = await agentRuntime.runAgentStreaming(projectId, message, (event) => agentRuntime.writeSse(res, event), {
          ...(expectedRunId ? { expectedRunId } : {}),
          segmentId,
          segmentSource,
          modelProvider,
          modelId,
          thinkingLevel,
          sessionId,
          taskId,
          taskScope,
          attachmentPaths: attachments.paths,
          attachmentRefs: attachments.refs,
          capabilityIds,
        });
        agentRuntime.writeSse(res, { type: "done", ts: new Date().toISOString(), chat });
      } catch (error) {
        agentRuntime.writeSse(res, {
          type: "error",
          ts: new Date().toISOString(),
          isError: true,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      } finally {
        res.end();
      }
      return true;
    }
    if (taskId && agentRuntime && parts[5] === "messages" && parts.length === 6 && req.method === "POST") {
      const snapshot = await workspace.open({ projectId, taskId });
      const body = projectMessageSchema.parse(await deps.readBody(req), "Project Task message");
      const message = body.message;
      if (typeof message !== "string" || !message.trim()) {
        deps.json(res, 400, { error: "message is required." });
        return true;
      }
      const delivery = body.delivery;
      if (delivery !== "steer" && delivery !== "follow_up") {
        deps.json(res, 400, { error: "delivery must be steer or follow_up." });
        return true;
      }
      deps.json(res, 202, await agentRuntime.deliverMessage({
        projectId,
        taskId,
        runId: snapshot.activeRunId ?? undefined,
        message,
        delivery,
      }));
      return true;
    }
    if (taskId && agentRuntime && parts[5] === "session" && parts.length === 6 && req.method === "GET") {
      await workspace.open({ projectId, taskId });
      deps.json(res, 200, await agentRuntime.projectSessionInfo(projectId, taskAgentSessionId(taskId)));
      return true;
    }
    if (taskId && agentRuntime && parts[5] === "compact" && parts.length === 6 && req.method === "POST") {
      await workspace.open({ projectId, taskId });
      const body = projectCompactionSchema.parse(await deps.readBody(req), "Project Task compaction");
      deps.json(res, 200, await agentRuntime.compactProjectAgentSession(
        projectId,
        taskId,
        agentRuntime.optionalString(body.customInstructions),
        taskAgentSessionId(taskId),
      ));
      return true;
    }
    if (taskId && agentRuntime && parts[5] === "stop" && parts.length === 6 && req.method === "POST") {
      const snapshot = await workspace.open({ projectId, taskId });
      const body = projectStopSchema.parse(await deps.readBody(req), "Project Task stop");
      const requestedRunId = agentRuntime.optionalString(body.turnId);
      const runId = requestedRunId ?? snapshot.activeRunId ?? undefined;
      deps.json(res, 200, await agentRuntime.stopAgent({
        projectId,
        taskId,
        reason: agentRuntime.optionalString(body.reason),
        runId,
        mode: snapshot.runs.find((run) => run.id === runId)?.mode,
      }));
      return true;
    }
    if (taskId && parts.length === 5 && req.method === "GET") {
      deps.json(res, 200, await workspace.open({ projectId, taskId }));
      return true;
    }
    if (taskId && parts[5] === "probe" && parts.length === 6 && req.method === "GET") {
      deps.json(res, 200, await workspace.probe({ projectId, taskId }));
      return true;
    }
    if (taskId && parts[5] === "events" && parts[6] === "stream" && parts.length === 7 && req.method === "GET") {
      await streamCanonicalTaskEvents({
        req,
        res,
        url,
        workspace,
        locator: { kind: "project", projectId, taskId },
      });
      return true;
    }
    if (taskId && parts[5] === "events" && parts.length === 6 && req.method === "GET") {
      const runId = url.searchParams.get("runId")?.trim();
      if (!runId) {
        deps.json(res, 400, { error: "runId is required." });
        return true;
      }
      const rawLimit = url.searchParams.get("limit");
      const limit = rawLimit === null ? undefined : Number(rawLimit);
      if (limit !== undefined && !Number.isFinite(limit)) {
        deps.json(res, 400, { error: "limit must be a finite number." });
        return true;
      }
      deps.json(res, 200, await workspace.events({
        projectId,
        taskId,
        runId,
        afterCursor: url.searchParams.get("after") ?? url.searchParams.get("afterCursor") ?? undefined,
        limit,
      }));
      return true;
    }
    if (taskId && parts[5] === "decision-interactions" && parts[6] && parts.length === 7 && req.method === "POST") {
      deps.json(res, 200, await commitTaskExtensionInteraction({
        repoRoot: deps.repoRoot,
        projectId,
        taskId,
        interactionId: decodeURIComponent(parts[6]),
        body: taskInteractionSchema.parse(await deps.readBody(req), "Task decision interaction"),
      }));
      return true;
    }
    if (taskId && parts[5] === "decisions" && parts[6] && parts.length === 7 && req.method === "POST") {
      const decisionId = decodeURIComponent(parts[6]);
      const body = projectDecisionSchema.parse(await deps.readBody(req), "Project Task decision");
      deps.json(res, 200, await executeTaskDecision({
        repoRoot: deps.repoRoot,
        projectId,
        taskId,
        decisionId,
        optionId: typeof body.optionId === "string" ? body.optionId : "",
        reason: typeof body.reason === "string" ? body.reason : "",
      }));
      return true;
    }
  } catch (error) {
    if (error instanceof StrictApiInputError) {
      deps.json(res, error.status, { error: error.message, code: error.code });
      return true;
    }
    if (error instanceof TaskWorkspaceNotFoundError) {
      deps.json(res, 404, { error: error.message });
      return true;
    }
    if (error instanceof TaskWorkspaceConflictError) {
      deps.json(res, 409, { error: error.message });
      return true;
    }
    if (error instanceof TaskDecisionExecutionError) {
      deps.json(res, error.status, { error: error.message, ...error.details });
      return true;
    }
    if (error instanceof TaskPackageProfileError) {
      deps.json(res, error.status, { error: error.message, code: error.code });
      return true;
    }
    if (error instanceof Error && /safe identifier/.test(error.message)) {
      deps.json(res, 400, { error: error.message });
      return true;
    }
    throw error;
  }

  deps.json(res, 404, { error: "Not found" });
  return true;
}
