import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createStandaloneFileGrant,
  createTaskWorkspace,
  listStandaloneFileGrants,
  revokeStandaloneFileGrant,
  setStandaloneWorkingDirectory,
  TaskWorkspaceConflictError,
  TaskWorkspaceNotFoundError,
  type TaskMessageQueue,
  type TaskWorkspaceSnapshot,
} from "@linguist-agent/cat-data";
import { streamCanonicalTaskEvents, taskListResponse, validatedTaskTitle } from "./task_route_shared.js";
import { handleTaskMessageQueueRoute, type TaskMessageQueueRouteService } from "./task_message_queue_routes.js";
import {
  StrictApiInputError,
  strictApiArray,
  strictApiBoolean,
  strictApiJsonValue,
  strictApiObject,
  strictApiOptional,
  strictApiString,
} from "../strict_api_contract.js";

export interface AcceptedStandaloneMessage {
  messageId: string;
  runId: string;
  delivery: "start" | "steer" | "follow_up";
  queuePosition?: number;
}

type StandaloneThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
type StandaloneExecutionProfile = "fast" | "balanced" | "best";

interface StandaloneMessageInput {
  message: string;
  delivery: "auto" | "steer" | "follow_up";
  agentThreadId?: string;
  modelProvider?: string;
  modelId?: string;
  thinkingLevel?: StandaloneThinkingLevel;
  executionProfile?: StandaloneExecutionProfile;
  attachmentGrantIds?: string[];
}

const optionalJson = () => strictApiOptional(strictApiJsonValue());
const optionalText = () => strictApiOptional(strictApiString());

const createChatSchema = strictApiObject({
  taskId: optionalText(),
  title: optionalText(),
  intent: optionalText(),
  kind: optionalText(),
  projectId: optionalJson(),
  batchId: optionalJson(),
  segmentIds: optionalJson(),
  sourceLocale: optionalJson(),
  targetLocale: optionalJson(),
  owner: optionalJson(),
  scope: optionalJson(),
  initialMessage: optionalJson(),
}, { name: "standalone Chat creation" });

const renameChatSchema = strictApiObject({
  title: strictApiString(),
}, { name: "standalone Chat rename" });

const fileGrantSchema = strictApiObject({
  path: strictApiString(),
  kind: strictApiString(),
  access: strictApiString(),
  recursive: strictApiOptional(strictApiBoolean()),
}, { name: "standalone file grant" });

const workingDirectorySchema = strictApiObject({
  grantId: strictApiString(),
}, { name: "standalone working directory" });

const standaloneMessageSchema = strictApiObject({
  message: strictApiString(),
  delivery: optionalText(),
  agentThreadId: optionalText(),
  modelProvider: optionalText(),
  modelId: optionalText(),
  thinkingLevel: optionalText(),
  executionProfile: optionalText(),
  attachmentGrantIds: strictApiOptional(strictApiArray(strictApiString(), { maxItems: 12 })),
}, { name: "standalone message" });

const stopChatSchema = strictApiObject({
  reason: optionalText(),
}, { name: "standalone stop" });

const compactChatSchema = strictApiObject({
  customInstructions: optionalText(),
  agentThreadId: optionalText(),
}, { name: "standalone compaction" });

const forkChatSchema = strictApiObject({
  sourceThreadId: optionalText(),
  entryId: optionalText(),
  position: optionalText(),
}, { name: "standalone fork" });

const handoffChatSchema = strictApiObject({
  title: optionalText(),
  throughActivityId: optionalText(),
}, { name: "standalone handoff" });

/**
 * Ephemeral Pi output for the active standalone turn. Durable Task events stay
 * on the canonical /events stream; these payloads exist only to paint the
 * actual model tokens while that canonical projection catches up.
 */
export interface StandaloneAgentStreamEvent {
  type: "accepted" | "turn_start" | "assistant_delta" | "assistant_thinking_started" | "assistant_final" | "permission_request" | "queue_update" | "done" | "error" | "stopped";
  taskId: string;
  runId: string;
  ts: string;
  text?: string;
  errorMessage?: string;
  permissionRequest?: unknown;
  delivery?: AcceptedStandaloneMessage["delivery"];
  queuePosition?: number;
  messageQueue?: TaskMessageQueue;
}

export interface StandaloneTaskRouteDeps {
  repoRoot: string;
  json: (res: ServerResponse, status: number, data: unknown) => void;
  readBody: (req: IncomingMessage) => Promise<unknown>;
  acceptMessage?: (input: {
    taskId: string;
    message: string;
    delivery?: "auto" | "steer" | "follow_up";
    agentThreadId?: string;
    modelProvider?: string;
    modelId?: string;
    thinkingLevel?: StandaloneThinkingLevel;
    executionProfile?: StandaloneExecutionProfile;
    attachmentGrantIds?: string[];
  }) => Promise<AcceptedStandaloneMessage>;
  subscribeMessageStream?: (taskId: string, listener: (event: StandaloneAgentStreamEvent) => void) => () => void;
  stop?: (input: { taskId: string; reason?: string }) => Promise<unknown>;
  compact?: (input: { taskId: string; customInstructions?: string; agentThreadId?: string }) => Promise<unknown>;
  fork?: (input: { taskId: string; sourceThreadId?: string; entryId?: string; position?: "before" | "at" }) => Promise<unknown>;
  hasActiveRun?: (taskId: string) => boolean;
  messageQueue?: TaskMessageQueueRouteService;
}

function handoffText(snapshot: TaskWorkspaceSnapshot, throughActivityId?: string): {
  sourceThreadId?: string;
  sourceActivityId?: string;
  transcript: string;
  artifactIds: string[];
} {
  const through = throughActivityId ? snapshot.activities.find((activity) => activity.id === throughActivityId) : undefined;
  if (throughActivityId && !through) throw new TaskWorkspaceConflictError(`Activity ${throughActivityId} does not belong to this Chat.`);
  const eligible = snapshot.activities
    .filter((activity) => !through || activity.createdAt <= through.createdAt)
    .filter((activity) => activity.body?.trim())
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-40);
  const transcript = eligible
    .map((activity) => `${activity.actor.displayName}: ${activity.body!.trim()}`)
    .join("\n\n")
    .slice(-20_000);
  const artifactIds = Array.from(new Set(eligible.flatMap((activity) => activity.refs.artifactIds)));
  const sourceThreadId = through?.agentThreadId ?? eligible.at(-1)?.agentThreadId;
  return { sourceThreadId, sourceActivityId: through?.id ?? eligible.at(-1)?.id, transcript, artifactIds };
}

async function copyChatWithHandoff(
  workspace: ReturnType<typeof createTaskWorkspace>,
  source: TaskWorkspaceSnapshot,
  input: { title?: string; throughActivityId?: string },
): Promise<TaskWorkspaceSnapshot> {
  if (source.activeRunId) throw new TaskWorkspaceConflictError("Stop or finish the active Run before copying this Chat.");
  const handoff = handoffText(source, input.throughActivityId);
  const title = input.title ?? `Copy of ${source.task.title}`;
  const target = await workspace.create({
    owner: { kind: "standalone" },
    title,
    intent: `Continue an explicit handoff from ${source.task.title}`,
    kind: "general",
  });
  const now = new Date().toISOString();
  const runId = `handoff_${randomUUID()}`;
  const threadId = `${runId}.main`;
  const activityId = `${runId}.received`;
  const artifactId = `${runId}.context`;
  await workspace.appendGenerated({
    kind: "standalone",
    taskId: target.task.id,
    runId,
    events: [{
      type: "run_upsert",
      agentThreadId: threadId,
      occurredAt: now,
      run: {
        id: runId,
        taskId: target.task.id,
        mode: "single",
        status: "complete",
        rootAgentThreadId: threadId,
        planHash: null,
        estimatedCalls: 0,
        estimatedCallsBySource: {},
        startedAt: now,
        updatedAt: now,
        completedAt: now,
        stopAvailable: false,
        resumeAvailable: false,
      },
    }, {
      type: "thread_upsert",
      agentThreadId: threadId,
      occurredAt: now,
      thread: {
        id: threadId,
        taskId: target.task.id,
        runId,
        parentThreadId: null,
        identity: { kind: "main", roleId: "linguist-agent", displayName: "Linguist Agent", roleLabel: "General Agent", disclosureLabel: "Agent" },
        status: "complete",
        canReceiveUserMessage: true,
        handoffSummary: `Context copied explicitly from ${source.task.title}.`,
        latestActivityId: activityId,
        childThreadIds: [],
        createdAt: now,
        updatedAt: now,
      },
    }, {
      type: "artifact_upsert",
      agentThreadId: threadId,
      occurredAt: now,
      artifact: {
        id: artifactId,
        taskId: target.task.id,
        runId,
        type: "context_handoff",
        status: "accepted",
        title: `Context from ${source.task.title}`,
        summary: handoff.transcript ? `Explicit handoff containing ${handoff.transcript.length} characters of selected conversation context.` : "Explicit handoff with no message transcript.",
        scope: { kind: "standalone", fileGrantIds: [] },
        version: 1,
        provenance: { agentThreadId: threadId, activityId, evidenceRefs: [], parentArtifactIds: [] },
        availableDecisions: [],
        content: {
          schemaVersion: 1,
          sourceTaskId: source.task.id,
          sourceTaskTitle: source.task.title,
          sourceThreadId: handoff.sourceThreadId,
          sourceActivityId: handoff.sourceActivityId,
          sourceEventCursor: source.eventCursor,
          sourceArtifactIds: handoff.artifactIds,
          transcript: handoff.transcript,
        },
        createdAt: now,
        updatedAt: now,
      },
    }, {
      type: "activity_append",
      agentThreadId: threadId,
      occurredAt: now,
      activity: {
        id: activityId,
        taskId: target.task.id,
        runId,
        agentThreadId: threadId,
        seq: 1,
        type: "handoff",
        status: "done",
        actor: { kind: "system", id: "handoff", displayName: "Context Handoff", agentThreadId: threadId },
        title: "Context copied into this Chat",
        body: `Explicitly copied from ${source.task.title}; the source Chat remains unchanged.`,
        tool: null,
        refs: { artifactIds: [artifactId], evidenceRefs: [], decisionIds: [], segmentIds: [] },
        createdAt: now,
        updatedAt: now,
      },
    }],
  });
  return workspace.open({ kind: "standalone", taskId: target.task.id });
}

function optionalFiniteLimit(url: URL): number | undefined {
  const raw = url.searchParams.get("limit");
  if (raw === null) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new TaskWorkspaceConflictError("limit must be a finite number.");
  return value;
}

function standaloneRuntimeUnavailable(action: string): {
  error: { code: "general_runtime_unavailable"; message: string };
} {
  return {
    error: {
      code: "general_runtime_unavailable",
      message: `Standalone ${action} is unavailable until the General Core runtime is ready.`,
    },
  };
}

function optionalIdentifier(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim() || value.trim().length > 512) {
    throw new Error(`${label} must be a non-empty string up to 512 characters.`);
  }
  return value.trim();
}

function messageInput(value: unknown): StandaloneMessageInput | null {
  const body = standaloneMessageSchema.parse(value, "standalone message");
  if (typeof body.message !== "string" || !body.message.trim()) return null;
  const delivery = body.delivery === undefined ? "auto" : body.delivery;
  if (!(["auto", "steer", "follow_up"] as unknown[]).includes(delivery)) {
    throw new Error("delivery must be auto, steer, or follow_up.");
  }
  const modelProvider = optionalIdentifier(body.modelProvider, "modelProvider");
  const modelId = optionalIdentifier(body.modelId, "modelId");
  if (Boolean(modelProvider) !== Boolean(modelId)) {
    throw new Error("modelProvider and modelId must be supplied together.");
  }
  const thinkingLevel = body.thinkingLevel === undefined
    ? undefined
    : (["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const).includes(body.thinkingLevel as StandaloneThinkingLevel)
      ? body.thinkingLevel as StandaloneThinkingLevel
      : (() => { throw new Error("thinkingLevel is invalid."); })();
  const executionProfile = body.executionProfile === undefined
    ? undefined
    : (["fast", "balanced", "best"] as const).includes(body.executionProfile as StandaloneExecutionProfile)
      ? body.executionProfile as StandaloneExecutionProfile
      : (() => { throw new Error("executionProfile is invalid."); })();
  if (executionProfile && (modelProvider || modelId || thinkingLevel)) {
    throw new Error("executionProfile cannot be combined with an explicit model or thinkingLevel.");
  }
  const attachmentGrantIds = body.attachmentGrantIds === undefined
    ? undefined
    : (() => {
      if (!Array.isArray(body.attachmentGrantIds)
        || !body.attachmentGrantIds.every((entry) => typeof entry === "string" && entry.trim() && entry.trim().length <= 160)) {
        throw new Error("attachmentGrantIds must be an array of non-empty grant ids up to 160 characters.");
      }
      const ids = Array.from(new Set(body.attachmentGrantIds.map((entry) => (entry as string).trim())));
      if (ids.length > 12) throw new Error("At most 12 file attachments can be selected for one Run.");
      return ids;
    })();
  return {
    message: body.message.trim(),
    delivery: delivery as "auto" | "steer" | "follow_up",
    ...(typeof body.agentThreadId === "string" && body.agentThreadId.trim() ? { agentThreadId: body.agentThreadId.trim() } : {}),
    ...(modelProvider ? { modelProvider } : {}),
    ...(modelId ? { modelId } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
    ...(executionProfile ? { executionProfile } : {}),
    ...(attachmentGrantIds?.length ? { attachmentGrantIds } : {}),
  };
}

function writeStandaloneStreamEvent(res: ServerResponse, event: StandaloneAgentStreamEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

export async function handleStandaloneTaskRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  parts: string[],
  deps: StandaloneTaskRouteDeps,
): Promise<boolean> {
  if (parts[0] !== "api" || parts[1] !== "tasks") return false;
  const workspace = createTaskWorkspace(deps.repoRoot);

  try {
    if (parts.length === 2 && req.method === "GET") {
      const snapshots = await workspace.listSnapshots({ kind: "standalone" });
      deps.json(res, 200, taskListResponse(snapshots));
      return true;
    }
    if (parts.length === 2 && req.method === "POST") {
      const body = createChatSchema.parse(await deps.readBody(req), "standalone Chat creation");
      if (body.kind !== undefined && body.kind !== "general") {
        deps.json(res, 400, { error: "Standalone Tasks must use kind general." });
        return true;
      }
      const forbidden = ["projectId", "batchId", "segmentIds", "sourceLocale", "targetLocale", "owner", "scope"]
        .filter((key) => body[key] !== undefined);
      if (forbidden.length) {
        deps.json(res, 400, { error: `Standalone Task creation cannot accept Project or authoritative scope fields: ${forbidden.join(", ")}.` });
        return true;
      }
      if (body.initialMessage !== undefined) {
        deps.json(res, 400, { error: "Create the Chat first, then send its first turn through /messages." });
        return true;
      }
      let title: string;
      try { title = body.title === undefined ? "New chat" : validatedTaskTitle(body.title); }
      catch (error) {
        deps.json(res, 400, { error: error instanceof Error ? error.message : String(error) });
        return true;
      }
      const intent = typeof body.intent === "string" && body.intent.trim() ? body.intent.trim() : "General assistance";
      deps.json(res, 201, await workspace.create({
        owner: { kind: "standalone" },
        taskId: typeof body.taskId === "string" ? body.taskId : undefined,
        title,
        intent,
        kind: "general",
      }));
      return true;
    }

    const taskId = parts[2] ? decodeURIComponent(parts[2]) : undefined;
    if (!taskId) {
      deps.json(res, 404, { error: "Not found" });
      return true;
    }
    const locator = { kind: "standalone" as const, taskId };

    if (await handleTaskMessageQueueRoute({
      req,
      res,
      parts,
      queueIndex: 3,
      locator,
      repoRoot: deps.repoRoot,
      json: deps.json,
      readBody: deps.readBody,
      service: deps.messageQueue,
    })) return true;

    if (parts.length === 3 && req.method === "GET") {
      deps.json(res, 200, await workspace.open(locator));
      return true;
    }
    if (parts.length === 3 && req.method === "PATCH") {
      const body = renameChatSchema.parse(await deps.readBody(req), "standalone Chat rename");
      let title: string;
      try { title = validatedTaskTitle(body.title); }
      catch (error) {
        deps.json(res, 400, { error: error instanceof Error ? error.message : String(error) });
        return true;
      }
      deps.json(res, 200, await workspace.updateTitle({ ...locator, title }));
      return true;
    }
    if (parts[3] === "probe" && parts.length === 4 && req.method === "GET") {
      deps.json(res, 200, await workspace.probe(locator));
      return true;
    }
    if (parts[3] === "archive" && parts.length === 4 && req.method === "POST") {
      deps.json(res, 200, await workspace.archive(locator));
      return true;
    }
    if (parts[3] === "restore" && parts.length === 4 && req.method === "POST") {
      deps.json(res, 200, await workspace.restore(locator));
      return true;
    }
    if (parts[3] === "file-grants" && parts.length === 4 && req.method === "GET") {
      deps.json(res, 200, { grants: await listStandaloneFileGrants(deps.repoRoot, taskId) });
      return true;
    }
    if (parts[3] === "file-grants" && parts.length === 4 && req.method === "POST") {
      const body = fileGrantSchema.parse(await deps.readBody(req), "standalone file grant");
      if (typeof body.path !== "string" || !body.path.trim()
        || (body.kind !== "file" && body.kind !== "directory")
        || (body.access !== "read" && body.access !== "read_write")
        || (body.recursive !== undefined && typeof body.recursive !== "boolean")) {
        deps.json(res, 400, { error: "path, kind (file|directory), access (read|read_write), and optional recursive are required." });
        return true;
      }
      try {
        deps.json(res, 201, await createStandaloneFileGrant(deps.repoRoot, {
          taskId,
          path: body.path,
          kind: body.kind,
          access: body.access,
          recursive: body.recursive as boolean | undefined,
        }));
      } catch (error) {
        if (error instanceof TaskWorkspaceConflictError || error instanceof TaskWorkspaceNotFoundError) throw error;
        deps.json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
      return true;
    }
    if (parts[3] === "file-grants" && parts[4] && parts.length === 5 && req.method === "DELETE") {
      try {
        deps.json(res, 200, await revokeStandaloneFileGrant(deps.repoRoot, {
          taskId,
          grantId: decodeURIComponent(parts[4]),
        }));
      } catch (error) {
        if (error instanceof TaskWorkspaceConflictError || error instanceof TaskWorkspaceNotFoundError) throw error;
        deps.json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
      return true;
    }
    if (parts[3] === "working-directory" && parts.length === 4 && req.method === "POST") {
      if (deps.hasActiveRun?.(taskId)) {
        throw new TaskWorkspaceConflictError("Stop the active Run before changing this Chat's working directory.");
      }
      const body = workingDirectorySchema.parse(await deps.readBody(req), "standalone working directory");
      if (typeof body.grantId !== "string" || !body.grantId.trim()) {
        deps.json(res, 400, { error: "grantId is required." });
        return true;
      }
      try {
        await setStandaloneWorkingDirectory(deps.repoRoot, { taskId, grantId: body.grantId });
        deps.json(res, 200, await workspace.open(locator));
      } catch (error) {
        if (error instanceof TaskWorkspaceConflictError || error instanceof TaskWorkspaceNotFoundError) throw error;
        deps.json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
      return true;
    }
    if (parts[3] === "messages" && parts[4] === "stream" && parts.length === 5 && req.method === "POST") {
      await workspace.open(locator);
      if (!deps.acceptMessage || !deps.subscribeMessageStream) {
        deps.json(res, 503, standaloneRuntimeUnavailable("message delivery"));
        return true;
      }
      const body = await deps.readBody(req);
      let input: NonNullable<ReturnType<typeof messageInput>>;
      try {
        input = messageInput(body) ?? (() => { throw new Error("message is required."); })();
      } catch (error) {
        deps.json(res, 400, { error: error instanceof Error ? error.message : String(error) });
        return true;
      }

      let closed = false;
      let unsubscribe: () => void = () => {};
      const close = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        if (!res.writableEnded) res.end();
      };
      const emit = (event: StandaloneAgentStreamEvent) => {
        if (closed) return;
        try {
          writeStandaloneStreamEvent(res, event);
          if (event.type === "done" || event.type === "error" || event.type === "stopped") close();
        } catch {
          close();
        }
      };

      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      });
      res.flushHeaders?.();
      res.write(": connected\n\n");
      unsubscribe = deps.subscribeMessageStream(taskId, emit);
      req.once("aborted", close);
      req.socket?.once("close", close);
      res.once?.("close", close);
      try {
        const accepted = await deps.acceptMessage({ taskId, ...input });
        emit({
          type: "accepted",
          taskId,
          runId: accepted.runId,
          ts: new Date().toISOString(),
          delivery: accepted.delivery,
          queuePosition: accepted.queuePosition,
        });
      } catch (error) {
        emit({
          type: "error",
          taskId,
          runId: "",
          ts: new Date().toISOString(),
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
      return true;
    }
    if (parts[3] === "messages" && parts.length === 4 && req.method === "POST") {
      await workspace.open(locator);
      if (!deps.acceptMessage) {
        deps.json(res, 503, standaloneRuntimeUnavailable("message delivery"));
        return true;
      }
      const body = await deps.readBody(req);
      let input: NonNullable<ReturnType<typeof messageInput>>;
      try {
        input = messageInput(body) ?? (() => { throw new Error("message is required."); })();
      } catch (error) {
        deps.json(res, 400, { error: error instanceof Error ? error.message : String(error) });
        return true;
      }
      deps.json(res, 202, await deps.acceptMessage({ taskId, ...input }));
      return true;
    }
    if (parts[3] === "stop" && parts.length === 4 && req.method === "POST") {
      await workspace.open(locator);
      if (!deps.stop) {
        deps.json(res, 503, standaloneRuntimeUnavailable("stop"));
        return true;
      }
      const body = stopChatSchema.parse(await deps.readBody(req), "standalone stop");
      deps.json(res, 200, await deps.stop({
        taskId,
        reason: typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : undefined,
      }));
      return true;
    }
    if (parts[3] === "compact" && parts.length === 4 && req.method === "POST") {
      await workspace.open(locator);
      if (!deps.compact) {
        deps.json(res, 503, standaloneRuntimeUnavailable("compaction"));
        return true;
      }
      const body = compactChatSchema.parse(await deps.readBody(req), "standalone compaction");
      deps.json(res, 200, await deps.compact({
        taskId,
        customInstructions: typeof body.customInstructions === "string" && body.customInstructions.trim()
          ? body.customInstructions.trim()
          : undefined,
        agentThreadId: typeof body.agentThreadId === "string" && body.agentThreadId.trim() ? body.agentThreadId.trim() : undefined,
      }));
      return true;
    }
    if (parts[3] === "forks" && parts.length === 4 && req.method === "POST") {
      await workspace.open(locator);
      if (!deps.fork) {
        deps.json(res, 503, standaloneRuntimeUnavailable("branching"));
        return true;
      }
      const body = forkChatSchema.parse(await deps.readBody(req), "standalone fork");
      if (body.position !== undefined && body.position !== "before" && body.position !== "at") {
        deps.json(res, 400, { error: "position must be before or at." });
        return true;
      }
      deps.json(res, 201, await deps.fork({
        taskId,
        sourceThreadId: typeof body.sourceThreadId === "string" && body.sourceThreadId.trim() ? body.sourceThreadId.trim() : undefined,
        entryId: typeof body.entryId === "string" && body.entryId.trim() ? body.entryId.trim() : undefined,
        position: body.position as "before" | "at" | undefined,
      }));
      return true;
    }
    if (parts[3] === "handoff" && parts.length === 4 && req.method === "POST") {
      const source = await workspace.open(locator);
      const body = handoffChatSchema.parse(await deps.readBody(req), "standalone handoff");
      let title: string | undefined;
      if (body.title !== undefined) {
        try { title = validatedTaskTitle(body.title); }
        catch (error) {
          deps.json(res, 400, { error: error instanceof Error ? error.message : String(error) });
          return true;
        }
      }
      deps.json(res, 201, await copyChatWithHandoff(workspace, source, {
        title,
        throughActivityId: typeof body.throughActivityId === "string" && body.throughActivityId.trim() ? body.throughActivityId.trim() : undefined,
      }));
      return true;
    }
    if (parts[3] === "events" && parts[4] === "stream" && parts.length === 5 && req.method === "GET") {
      await streamCanonicalTaskEvents({ req, res, url, workspace, locator });
      return true;
    }
    if (parts[3] === "events" && parts.length === 4 && req.method === "GET") {
      const runId = url.searchParams.get("runId")?.trim();
      const afterCursor = url.searchParams.get("after") ?? url.searchParams.get("afterCursor") ?? undefined;
      const limit = optionalFiniteLimit(url);
      deps.json(res, 200, runId
        ? await workspace.events({ ...locator, runId, afterCursor, limit })
        : await workspace.eventsAfter({ ...locator, afterCursor, limit }));
      return true;
    }
  } catch (error) {
    if (error instanceof StrictApiInputError) {
      deps.json(res, error.status, { error: error.message });
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
    if (error instanceof Error && /safe identifier/.test(error.message)) {
      deps.json(res, 400, { error: error.message });
      return true;
    }
    throw error;
  }

  deps.json(res, 404, { error: "Not found" });
  return true;
}
