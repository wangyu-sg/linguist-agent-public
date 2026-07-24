import { createHash, randomUUID } from "node:crypto";
import { ModelRuntime, type AgentSessionEvent, type ExtensionUIContext, type ExtensionUIDialogOptions, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { parseLibraryMetadataFile } from "@linguist-agent/cat-data";
import type { LibraryPersistence, LibraryScope, StoredLibraryDocumentV1, TaskExecutionSnapshot } from "@linguist-agent/cat-data";
import {
  createCatAgentSession,
  type AgentPermissionRequest,
  type AgentPermissionUserDecision,
  type CatRequestShapeManifest,
} from "@linguist-agent/cat-runtime";
import type {
  CatWorkerServerToolPlan,
  CatWorkerSessionPlanV1,
  CatWorkerSessionProxy,
  CatWorkerToolDefinition,
} from "./cat_worker_runtime.js";
import type { RunWorkerApplicationTransport } from "./run_worker_supervisor.js";

type RpcMethod = "prepare" | "activate" | "prompt" | "steer" | "follow_up" | "clear_queue" | "compact" | "abort" | "dispose" | "extension_emit";

interface RpcRequest { schemaVersion: 1; type: "request"; requestId: string; method: RpcMethod; payload: unknown }
interface RpcResponse { schemaVersion: 1; type: "response"; requestId: string; ok: boolean; result?: unknown; error?: { code: string; message: string } }
interface RpcEvent { schemaVersion: 1; type: "event"; event: AgentSessionEvent }
interface RpcExtensionEvent { schemaVersion: 1; type: "extension_event"; channel: string; data: unknown }
interface RpcBridgeRequest { schemaVersion: 1; type: "bridge_request"; requestId: string; bridge: "permission" | "server_tool" | "ui" | "ui_notify" | "library"; payload: unknown }
interface RpcBridgeCancel { schemaVersion: 1; type: "bridge_cancel"; requestId: string }
interface RpcBridgeResponse { schemaVersion: 1; type: "bridge_response"; requestId: string; ok: boolean; result?: unknown; error?: { code: string; message: string } }

interface RpcSessionState { isStreaming: boolean; steering: string[]; followUp: string[] }
interface PreparedResult {
  planHash: string;
  sessionId: string;
  sessionFile: string | null;
  systemPrompt: string;
  requestShape: CatRequestShapeManifest;
  tools: CatWorkerToolDefinition[];
  state: RpcSessionState;
}

export interface CatWorkerExecutionIdentity {
  executionId: string;
  threadId: string;
  turnId: string;
  runtimeEpochId: string;
  configRevision: number;
  executionProfile: TaskExecutionSnapshot["executionProfile"];
  createdAt: string;
}

export interface CatWorkerUiRequest {
  method: "select" | "confirm" | "input" | "editor";
  title: string;
  message?: string;
  options?: string[];
  dialog?: ExtensionUIDialogOptions;
}

export interface PreparedCatWorkerRuntime {
  session: CatWorkerSessionProxy;
  requestShape: CatRequestShapeManifest;
  tools: CatWorkerToolDefinition[];
  executionSnapshot: TaskExecutionSnapshot;
  emitExtensionEvent(channel: string, data: unknown): void;
  onExtensionEvent(listener: (channel: string, data: unknown) => void): () => void;
  dispose(): Promise<void>;
}

function row(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, fields: readonly string[], label: string): void {
  const allowed = new Set(fields);
  const extra = Object.keys(value).find((field) => !allowed.has(field));
  if (extra) throw new Error(`${label} has unknown field: ${extra}`);
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function parseLibraryBridgeRequest(value: unknown): { operation: "read" | "materialize"; scope: LibraryScope; document?: StoredLibraryDocumentV1 } {
  const input = row(value, "CAT worker Library bridge request");
  exact(input, ["operation", "scope", "document"], "CAT worker Library bridge request");
  if (input.operation !== "read" && input.operation !== "materialize") throw new Error("CAT worker Library bridge operation is invalid.");
  const scopeValue = row(input.scope, "CAT worker Library scope");
  exact(scopeValue, ["kind", "projectId"], "CAT worker Library scope");
  const scope: LibraryScope = scopeValue.kind === "personal"
    ? { kind: "personal" }
    : scopeValue.kind === "project" && typeof scopeValue.projectId === "string" && scopeValue.projectId.trim()
      ? { kind: "project", projectId: scopeValue.projectId }
      : (() => { throw new Error("CAT worker Library scope is invalid."); })();
  if (input.operation === "read") return { operation: "read", scope };
  const document = parseLibraryMetadataFile({ schemaVersion: 1, scope, documents: [input.document], blocks: [], updatedAt: "1970-01-01T00:00:00.000Z" }, "CAT worker Library bridge document").documents[0];
  if (!document) throw new Error("CAT worker Library bridge document is invalid.");
  return { operation: "materialize", scope, document };
}

function publicError(error: unknown): { code: string; message: string } {
  const raw = error instanceof Error ? error.message : String(error);
  return {
    code: "CAT_WORKER_RPC_FAILED",
    message: raw
      .replace(/\bBearer\s+[^\s,;]+/giu, "Bearer [REDACTED]")
      .replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|credential)\s*[=:]\s*[^\s,;]+/giu, "$1=[REDACTED]")
      .slice(0, 1_000),
  };
}

function sha(value: unknown): string {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

function stable(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const input = value as Record<string, unknown>;
  return `{${Object.keys(input).sort().map((key) => `${JSON.stringify(key)}:${stable(input[key])}`).join(",")}}`;
}

function parseRequest(value: unknown): RpcRequest {
  const input = row(value, "CAT worker request");
  exact(input, ["schemaVersion", "type", "requestId", "method", "payload"], "CAT worker request");
  if (input.schemaVersion !== 1 || input.type !== "request") throw new Error("CAT worker request envelope is invalid.");
  const method = text(input.method, "CAT worker request.method");
  if (!["prepare", "activate", "prompt", "steer", "follow_up", "clear_queue", "compact", "abort", "dispose", "extension_emit"].includes(method)) {
    throw new Error("CAT worker request method is invalid.");
  }
  return { schemaVersion: 1, type: "request", requestId: text(input.requestId, "CAT worker request.requestId"), method: method as RpcMethod, payload: input.payload };
}

function parseResponse(value: unknown): RpcResponse {
  const input = row(value, "CAT worker response");
  exact(input, ["schemaVersion", "type", "requestId", "ok", "result", "error"], "CAT worker response");
  if (input.schemaVersion !== 1 || input.type !== "response" || typeof input.ok !== "boolean") throw new Error("CAT worker response envelope is invalid.");
  const requestId = text(input.requestId, "CAT worker response.requestId");
  if (input.ok) return { schemaVersion: 1, type: "response", requestId, ok: true, result: input.result };
  const error = row(input.error, "CAT worker response.error");
  exact(error, ["code", "message"], "CAT worker response.error");
  return { schemaVersion: 1, type: "response", requestId, ok: false, error: { code: text(error.code, "CAT worker response.error.code"), message: text(error.message, "CAT worker response.error.message") } };
}

function parseBridgeResponse(value: unknown): RpcBridgeResponse {
  const input = row(value, "CAT worker bridge response");
  exact(input, ["schemaVersion", "type", "requestId", "ok", "result", "error"], "CAT worker bridge response");
  if (input.schemaVersion !== 1 || input.type !== "bridge_response" || typeof input.ok !== "boolean") throw new Error("CAT worker bridge response envelope is invalid.");
  const requestId = text(input.requestId, "CAT worker bridge response.requestId");
  if (input.ok) return { schemaVersion: 1, type: "bridge_response", requestId, ok: true, result: input.result };
  const error = row(input.error, "CAT worker bridge response.error");
  return { schemaVersion: 1, type: "bridge_response", requestId, ok: false, error: { code: text(error.code, "CAT worker bridge response.error.code"), message: text(error.message, "CAT worker bridge response.error.message") } };
}

function parseState(value: unknown): RpcSessionState {
  const input = row(value, "CAT worker state");
  exact(input, ["isStreaming", "steering", "followUp"], "CAT worker state");
  if (typeof input.isStreaming !== "boolean" || !Array.isArray(input.steering) || !input.steering.every((item) => typeof item === "string") || !Array.isArray(input.followUp) || !input.followUp.every((item) => typeof item === "string")) {
    throw new Error("CAT worker state is invalid.");
  }
  return { isStreaming: input.isStreaming, steering: [...input.steering], followUp: [...input.followUp] };
}

function parsePrepared(value: unknown): PreparedResult {
  const input = row(value, "CAT worker prepared result");
  exact(input, ["planHash", "sessionId", "sessionFile", "systemPrompt", "requestShape", "tools", "state"], "CAT worker prepared result");
  const requestShape = row(input.requestShape, "CAT worker request shape") as unknown as CatRequestShapeManifest;
  if (input.sessionFile !== null && typeof input.sessionFile !== "string") throw new Error("CAT worker sessionFile is invalid.");
  if (!Array.isArray(input.tools)) throw new Error("CAT worker tool definitions are invalid.");
  const tools = input.tools.map((value, index): CatWorkerToolDefinition => {
    const tool = row(value, `CAT worker tool definition ${index}`);
    exact(tool, ["name", "description", "sourceInfo"], `CAT worker tool definition ${index}`);
    let sourceInfo: CatWorkerToolDefinition["sourceInfo"];
    if (tool.sourceInfo !== undefined) {
      const source = row(tool.sourceInfo, `CAT worker tool definition ${index}.sourceInfo`);
      exact(source, ["source"], `CAT worker tool definition ${index}.sourceInfo`);
      if (source.source !== undefined && typeof source.source !== "string") {
        throw new Error(`CAT worker tool definition ${index}.sourceInfo.source is invalid.`);
      }
      sourceInfo = source.source === undefined ? {} : { source: source.source };
    }
    return {
      name: text(tool.name, `CAT worker tool definition ${index}.name`),
      description: typeof tool.description === "string" ? tool.description : "",
      ...(sourceInfo ? { sourceInfo } : {}),
    };
  });
  return {
    planHash: text(input.planHash, "CAT worker planHash"),
    sessionId: text(input.sessionId, "CAT worker sessionId"),
    sessionFile: input.sessionFile as string | null,
    systemPrompt: typeof input.systemPrompt === "string" ? input.systemPrompt : "",
    requestShape,
    tools,
    state: parseState(input.state),
  };
}

function parsePlan(value: unknown): CatWorkerSessionPlanV1 {
  const input = row(value, "CAT worker plan");
  exact(input, [
    "schemaVersion", "planHash", "profile", "runtimeRoot", "workspace", "taskId", "runId", "modelProvider", "modelId",
    "thinkingLevel", "sessionMode", "sessionId", "branchEntryId", "preset", "disabledTools", "runOptions", "isolatedResources",
    "runtimeExtension", "permissionContract", "serverTools", "extensionBinding", "memoryRecall",
  ], "CAT worker plan");
  if (input.schemaVersion !== 1 || !["cat", "private_eval", "team"].includes(String(input.profile))) throw new Error("CAT worker plan identity is invalid.");
  if (typeof input.runtimeExtension !== "boolean" || typeof input.extensionBinding !== "boolean") throw new Error("CAT worker plan flags are invalid.");
  if (input.memoryRecall !== undefined && typeof input.memoryRecall !== "string") throw new Error("CAT worker plan memoryRecall is invalid.");
  if (!Array.isArray(input.disabledTools) || !input.disabledTools.every((item) => typeof item === "string") || !Array.isArray(input.serverTools)) throw new Error("CAT worker plan tools are invalid.");
  const workspace = row(input.workspace, "CAT worker plan.workspace");
  const plan = input as unknown as CatWorkerSessionPlanV1;
  text(workspace.root, "CAT worker plan.workspace.root");
  text(workspace.projectId, "CAT worker plan.workspace.projectId");
  text(plan.runId, "CAT worker plan.runId");
  if (!/^[a-f0-9]{64}$/u.test(plan.planHash)) throw new Error("CAT worker planHash is invalid.");
  const { planHash: _planHash, ...unsigned } = plan;
  const expected = createHash("sha256").update(stable(unsigned)).digest("hex");
  if (expected !== plan.planHash) throw new Error("CAT worker plan digest mismatch.");
  return plan;
}

function sessionState(session: { isStreaming: boolean; getSteeringMessages(): readonly string[]; getFollowUpMessages(): readonly string[] }): RpcSessionState {
  return { isStreaming: session.isStreaming, steering: [...session.getSteeringMessages()], followUp: [...session.getFollowUpMessages()] };
}

function bridgeTool(
  plan: CatWorkerServerToolPlan,
  request: (bridge: RpcBridgeRequest["bridge"], payload: unknown, signal?: AbortSignal) => Promise<unknown>,
): ToolDefinition {
  return {
    name: plan.name,
    label: plan.label,
    description: plan.description,
    ...(plan.promptSnippet ? { promptSnippet: plan.promptSnippet } : {}),
    ...(plan.promptGuidelines ? { promptGuidelines: plan.promptGuidelines } : {}),
    parameters: plan.parameters,
    ...(plan.executionMode ? { executionMode: plan.executionMode } : {}),
    execute: async (toolCallId: string, input: unknown, signal?: AbortSignal) => request("server_tool", { name: plan.name, toolCallId, input }, signal),
  } as unknown as ToolDefinition;
}

function bridgeUi(request: (bridge: RpcBridgeRequest["bridge"], payload: unknown) => Promise<unknown>, notify: (payload: unknown) => void): ExtensionUIContext {
  const unsupported = (method: string) => { throw new Error(`CAT worker UI method ${method} is not supported.`); };
  const noop = () => undefined;
  const theme = { name: "native" } as unknown as ExtensionUIContext["theme"];
  return {
    select: async (title, options, dialog) => request("ui", { method: "select", title, options, dialog }) as Promise<string | undefined>,
    confirm: async (title, message, dialog) => request("ui", { method: "confirm", title, message, dialog }) as Promise<boolean>,
    input: async (title, message, dialog) => request("ui", { method: "input", title, message, dialog }) as Promise<string | undefined>,
    editor: async (title, message) => request("ui", { method: "editor", title, message }) as Promise<string | undefined>,
    notify: (message, level = "info") => notify({ message, level }),
    onTerminalInput: () => noop,
    setStatus: noop,
    setWorkingMessage: noop,
    setWorkingVisible: noop,
    setWorkingIndicator: noop,
    setHiddenThinkingLabel: noop,
    setWidget: noop,
    setFooter: noop,
    setHeader: noop,
    setTitle: noop,
    custom: async () => unsupported("custom"),
    pasteToEditor: () => unsupported("pasteToEditor"),
    setEditorText: () => unsupported("setEditorText"),
    getEditorText: () => unsupported("getEditorText"),
    addAutocompleteProvider: () => unsupported("addAutocompleteProvider"),
    setEditorComponent: () => unsupported("setEditorComponent"),
    getEditorComponent: () => undefined,
    get theme() { return theme; },
    getAllThemes: () => [{ name: "native", path: undefined }],
    getTheme: (name) => name === "native" ? theme : undefined,
    setTheme: (value) => typeof value !== "string" || value === "native" ? { success: true } : { success: false, error: "Native Task sessions own appearance." },
    getToolsExpanded: () => false,
    setToolsExpanded: noop,
  } as ExtensionUIContext;
}

export function createCatWorkerRpcApplication(input: { transport: RunWorkerApplicationTransport }): { close(): Promise<void> } {
  let created: Awaited<ReturnType<typeof createCatAgentSession>> | undefined;
  let activated = false;
  let unsubscribeSession: (() => void) | undefined;
  let emitExtensionLocally: ((channel: string, data: unknown) => void) | undefined;
  const bridgePending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
  const bridge = (kind: RpcBridgeRequest["bridge"], payload: unknown, signal?: AbortSignal): Promise<unknown> => new Promise((resolve, reject) => {
    const requestId = randomUUID();
    const abort = () => input.transport.send({ schemaVersion: 1, type: "bridge_cancel", requestId } satisfies RpcBridgeCancel);
    bridgePending.set(requestId, {
      resolve(value) {
        signal?.removeEventListener("abort", abort);
        resolve(value);
      },
      reject(error) {
        signal?.removeEventListener("abort", abort);
        reject(error);
      },
    });
    input.transport.send({ schemaVersion: 1, type: "bridge_request", requestId, bridge: kind, payload } satisfies RpcBridgeRequest);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
  const notify = (payload: unknown): void => input.transport.send({ schemaVersion: 1, type: "bridge_request", requestId: randomUUID(), bridge: "ui_notify", payload } satisfies RpcBridgeRequest);
  const libraryPersistence: LibraryPersistence = {
    read: (scope) => bridge("library", { operation: "read", scope, document: null }) as Promise<Awaited<ReturnType<LibraryPersistence["read"]>>>,
    write: async () => { throw new Error("CAT worker Library tools cannot write Library metadata."); },
    putDocument: async () => { throw new Error("CAT worker Library tools cannot import Library documents."); },
    materializeDocument: async (scope, document) => {
      const result = await bridge("library", { operation: "materialize", scope, document }) as { path?: unknown };
      if (!result || typeof result.path !== "string" || !result.path.trim()) throw new Error("CAT worker Library materialization path is invalid.");
      return { path: result.path };
    },
    removeDocument: async () => { throw new Error("CAT worker Library tools cannot remove Library documents."); },
  };
  const respond = (requestId: string, result: unknown): void => input.transport.send({ schemaVersion: 1, type: "response", requestId, ok: true, result } satisfies RpcResponse);
  const fail = (requestId: string, error: unknown): void => input.transport.send({ schemaVersion: 1, type: "response", requestId, ok: false, error: publicError(error) } satisfies RpcResponse);
  const requireCreated = () => {
    if (!created) throw new Error("CAT worker Session is not prepared.");
    return created;
  };
  const requireActive = () => {
    if (!activated) throw new Error("CAT worker Session is not activated.");
    return requireCreated();
  };
  const onMessage = async (message: unknown): Promise<void> => {
    try {
      const envelope = row(message, "CAT worker message");
      if (envelope.type === "bridge_response") {
        const response = parseBridgeResponse(message);
        const pending = bridgePending.get(response.requestId);
        if (!pending) return;
        bridgePending.delete(response.requestId);
        if (response.ok) pending.resolve(response.result);
        else pending.reject(new Error(response.error?.message ?? "CAT worker bridge failed."));
        return;
      }
      const request = parseRequest(message);
      if (request.method === "prepare") {
        if (created) throw new Error("CAT worker Session is already prepared.");
        const plan = parsePlan(request.payload);
        const serverTools = plan.serverTools.map((tool) => bridgeTool(tool, bridge));
        const modelRuntime = await ModelRuntime.create();
        created = await createCatAgentSession({
          workspace: plan.workspace,
          modelRuntime,
          taskId: plan.taskId ?? undefined,
          runId: plan.runId,
          modelProvider: plan.modelProvider ?? undefined,
          modelId: plan.modelId ?? undefined,
          thinkingLevel: plan.thinkingLevel ?? undefined,
          sessionMode: plan.sessionMode,
          sessionId: plan.sessionId ?? undefined,
          branchEntryId: plan.branchEntryId ?? undefined,
          preset: plan.preset,
          disabledTools: plan.disabledTools,
          runOptions: plan.runOptions ?? undefined,
          isolatedResources: plan.isolatedResources,
          runtimeExtension: plan.runtimeExtension,
          permissionContract: plan.permissionContract ?? undefined,
          requestPermissionDecision: async (permission) => bridge("permission", permission) as Promise<AgentPermissionUserDecision>,
          memoryRecall: plan.memoryRecall,
          libraryPersistence,
          serverTools,
          ...(plan.extensionBinding ? { extensionBinding: { uiContext: bridgeUi(bridge, notify), mode: "rpc" as const } } : {}),
        });
        unsubscribeSession = created.session.subscribe((event) => input.transport.send({ schemaVersion: 1, type: "event", event } satisfies RpcEvent));
        if (created.eventBus) {
          const originalEmit = created.eventBus.emit.bind(created.eventBus);
          emitExtensionLocally = originalEmit;
          created.eventBus.emit = (channel, data) => {
            originalEmit(channel, data);
            input.transport.send({ schemaVersion: 1, type: "extension_event", channel, data } satisfies RpcExtensionEvent);
          };
        }
        respond(request.requestId, {
          planHash: plan.planHash,
          sessionId: created.session.sessionId,
          sessionFile: created.session.sessionFile ?? null,
          systemPrompt: created.session.systemPrompt,
          requestShape: created.requestShape,
          tools: created.session.getAllTools().map((tool) => ({
            name: tool.name,
            description: tool.description,
            ...(tool.sourceInfo?.source ? { sourceInfo: { source: tool.sourceInfo.source } } : {}),
          })),
          state: sessionState(created.session),
        } satisfies PreparedResult);
        return;
      }
      if (request.method === "activate") {
        requireCreated();
        activated = true;
        respond(request.requestId, { activated: true });
        return;
      }
      if (request.method === "extension_emit") {
        const payload = row(request.payload, "CAT worker extension event");
        requireActive();
        emitExtensionLocally?.(text(payload.channel, "CAT worker extension channel"), payload.data);
        respond(request.requestId, { delivered: true });
        return;
      }
      const session = requireActive().session;
      if (request.method === "prompt") {
        const payload = row(request.payload, "CAT worker prompt");
        await session.prompt(text(payload.text, "CAT worker prompt.text"), payload.options as Parameters<typeof session.prompt>[1]);
        respond(request.requestId, { state: sessionState(session) });
      } else if (request.method === "steer" || request.method === "follow_up") {
        const payload = row(request.payload, "CAT worker queued message");
        await (request.method === "steer" ? session.steer(text(payload.text, "CAT worker queued message.text")) : session.followUp(text(payload.text, "CAT worker queued message.text")));
        respond(request.requestId, { state: sessionState(session) });
      } else if (request.method === "clear_queue") {
        const cleared = session.clearQueue();
        respond(request.requestId, { cleared, state: sessionState(session) });
      } else if (request.method === "compact") {
        const payload = row(request.payload, "CAT worker compact");
        const result = await session.compact(typeof payload.instructions === "string" ? payload.instructions : undefined);
        respond(request.requestId, { result, state: sessionState(session) });
      } else if (request.method === "abort") {
        await session.abort();
        respond(request.requestId, { state: sessionState(session) });
      } else if (request.method === "dispose") {
        unsubscribeSession?.();
        session.dispose();
        respond(request.requestId, { disposed: true });
        input.transport.close("CAT worker disposed.");
      }
    } catch (error) {
      try {
        const requestId = row(message, "CAT worker failed message").requestId;
        if (typeof requestId === "string") fail(requestId, error);
      } catch { input.transport.close("CAT worker protocol failure."); }
    }
  };
  const unsubscribe = input.transport.onMessage((message) => { void onMessage(message); });
  return {
    async close() {
      unsubscribe();
      unsubscribeSession?.();
      created?.session.dispose();
      for (const pending of bridgePending.values()) pending.reject(new Error("CAT worker bridge closed."));
      bridgePending.clear();
      input.transport.close("CAT worker application closed.");
    },
  };
}

export async function prepareCatWorkerRuntime(input: {
  transport: RunWorkerApplicationTransport;
  plan: CatWorkerSessionPlanV1;
  timeoutMs: number;
  executionIdentity: CatWorkerExecutionIdentity;
  persistExecutionSnapshot(snapshot: TaskExecutionSnapshot, requestShape: CatRequestShapeManifest): Promise<void>;
  requestPermissionDecision(request: AgentPermissionRequest): Promise<AgentPermissionUserDecision>;
  executeServerTool(name: string, toolCallId: string, input: unknown, signal: AbortSignal): Promise<unknown>;
  requestUi(request: CatWorkerUiRequest): Promise<unknown>;
  notifyUi(message: string, level: "info" | "warning" | "error"): void;
  libraryPersistence?: LibraryPersistence;
}): Promise<PreparedCatWorkerRuntime> {
  const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  const listeners = new Set<(event: AgentSessionEvent) => void>();
  const extensionListeners = new Set<(channel: string, data: unknown) => void>();
  const bridgeAbortControllers = new Map<string, AbortController>();
  let state: RpcSessionState = { isStreaming: false, steering: [], followUp: [] };
  let closed = false;
  const request = (method: RpcMethod, payload: unknown): Promise<unknown> => new Promise((resolve, reject) => {
    if (closed) { reject(new Error("CAT worker transport is closed.")); return; }
    const requestId = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`CAT worker ${method} timed out.`));
    }, input.timeoutMs);
    pending.set(requestId, { resolve, reject, timer });
    input.transport.send({ schemaVersion: 1, type: "request", requestId, method, payload } satisfies RpcRequest);
  });
  const bridgeReply = (requestId: string, work: Promise<unknown>): void => {
    void work.then(
      (result) => input.transport.send({ schemaVersion: 1, type: "bridge_response", requestId, ok: true, result } satisfies RpcBridgeResponse),
      (error) => input.transport.send({ schemaVersion: 1, type: "bridge_response", requestId, ok: false, error: publicError(error) } satisfies RpcBridgeResponse),
    );
  };
  const unsubscribe = input.transport.onMessage((message) => {
    try {
      const envelope = row(message, "CAT worker host message");
      if (envelope.type === "event") {
        const event = envelope.event as AgentSessionEvent;
        if (event.type === "message_start") state = { ...state, isStreaming: true };
        if (event.type === "agent_end") state = { ...state, isStreaming: false };
        if (event.type === "queue_update") state = { ...state, steering: [...event.steering], followUp: [...event.followUp] };
        for (const listener of listeners) listener(event);
        return;
      }
      if (envelope.type === "extension_event") {
        const channel = text(envelope.channel, "CAT worker extension channel");
        for (const listener of extensionListeners) listener(channel, envelope.data);
        return;
      }
      if (envelope.type === "bridge_cancel") {
        const requestId = text(envelope.requestId, "CAT worker bridge cancel id");
        bridgeAbortControllers.get(requestId)?.abort();
        return;
      }
      if (envelope.type === "bridge_request") {
        const requestId = text(envelope.requestId, "CAT worker bridge request id");
        if (envelope.bridge === "permission") bridgeReply(requestId, input.requestPermissionDecision(envelope.payload as AgentPermissionRequest));
        else if (envelope.bridge === "server_tool") {
          const payload = row(envelope.payload, "CAT worker server tool request");
          const controller = new AbortController();
          bridgeAbortControllers.set(requestId, controller);
          const work = input.executeServerTool(
            text(payload.name, "server tool name"),
            text(payload.toolCallId, "server tool call id"),
            payload.input,
            controller.signal,
          ).finally(() => bridgeAbortControllers.delete(requestId));
          bridgeReply(requestId, work);
        } else if (envelope.bridge === "ui") bridgeReply(requestId, input.requestUi(envelope.payload as CatWorkerUiRequest));
        else if (envelope.bridge === "library") {
          if (!input.libraryPersistence) throw new Error("SQLite Library bridge is unavailable.");
          const request = parseLibraryBridgeRequest(envelope.payload);
          bridgeReply(requestId, request.operation === "read"
            ? input.libraryPersistence.read(request.scope).then((value) => value ? parseLibraryMetadataFile(value, "CAT worker Library read result") : null)
            : input.libraryPersistence.materializeDocument(request.scope, request.document!).then((result) => ({ path: result.path })));
        }
        else if (envelope.bridge === "ui_notify") {
          const payload = row(envelope.payload, "CAT worker UI notification");
          const level = ["info", "warning", "error"].includes(String(payload.level)) ? payload.level as "info" | "warning" | "error" : "info";
          input.notifyUi(text(payload.message, "CAT worker UI notification.message"), level);
          input.transport.send({ schemaVersion: 1, type: "bridge_response", requestId, ok: true, result: null } satisfies RpcBridgeResponse);
        }
        return;
      }
      const response = parseResponse(message);
      const waiter = pending.get(response.requestId);
      if (!waiter) return;
      pending.delete(response.requestId);
      clearTimeout(waiter.timer);
      if (response.ok) waiter.resolve(response.result);
      else waiter.reject(new Error(response.error?.message ?? "CAT worker request failed."));
    } catch (error) {
      closed = true;
      for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(error instanceof Error ? error : new Error(String(error))); }
      pending.clear();
    }
  });
  const unsubscribeClose = input.transport.onClose((reason) => {
    closed = true;
    for (const controller of bridgeAbortControllers.values()) controller.abort();
    bridgeAbortControllers.clear();
    for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error(reason)); }
    pending.clear();
  });
  const prepared = parsePrepared(await request("prepare", input.plan));
  if (prepared.planHash !== input.plan.planHash) throw new Error("CAT worker attestation plan hash mismatch.");
  state = prepared.state;
  const snapshot: TaskExecutionSnapshot = {
    schemaVersion: 1,
    executionId: input.executionIdentity.executionId,
    runId: input.plan.runId,
    threadId: input.executionIdentity.threadId,
    turnId: input.executionIdentity.turnId,
    runtimeEpochId: input.executionIdentity.runtimeEpochId,
    configRevision: input.executionIdentity.configRevision,
    providerId: input.plan.modelProvider,
    modelId: input.plan.modelId,
    reasoningEffort: input.plan.thinkingLevel,
    executionProfile: input.executionIdentity.executionProfile,
    promptHash: prepared.requestShape.systemPromptHash,
    toolManifestHash: prepared.requestShape.toolSurfaceHash,
    resourceSnapshotHash: prepared.requestShape.resourceIndexHash,
    capabilityGrantHash: sha(input.plan.permissionContract),
    contextInputHash: sha({ runOptions: input.plan.runOptions, serverTools: input.plan.serverTools.map((tool) => tool.name) }),
    createdAt: input.executionIdentity.createdAt,
  };
  await input.persistExecutionSnapshot(snapshot, prepared.requestShape);
  await request("activate", { executionId: snapshot.executionId });
  const applyState = (value: unknown): void => {
    const result = row(value, "CAT worker command result");
    if (result.state) state = parseState(result.state);
  };
  const session: CatWorkerSessionProxy = {
    sessionId: prepared.sessionId,
    sessionFile: prepared.sessionFile ?? undefined,
    systemPrompt: prepared.systemPrompt,
    get isStreaming() { return state.isStreaming; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async prompt(value, options) { applyState(await request("prompt", { text: value, options })); },
    async steer(value) { applyState(await request("steer", { text: value })); },
    async followUp(value) { applyState(await request("follow_up", { text: value })); },
    clearQueue() {
      const cleared = { steering: [...state.steering], followUp: [...state.followUp] };
      state = { ...state, steering: [], followUp: [] };
      void request("clear_queue", {}).then(applyState, () => undefined);
      return cleared;
    },
    getSteeringMessages: () => state.steering,
    getFollowUpMessages: () => state.followUp,
    async compact(instructions) {
      const result = row(await request("compact", { instructions }), "CAT worker compact result");
      if (result.state) state = parseState(result.state);
      return result.result as Awaited<ReturnType<CatWorkerSessionProxy["compact"]>>;
    },
    async abort() { applyState(await request("abort", {})); },
    dispose() { void request("dispose", {}).catch(() => undefined); },
  };
  return {
    session,
    requestShape: prepared.requestShape,
    tools: prepared.tools,
    executionSnapshot: snapshot,
    emitExtensionEvent(channel, data) { void request("extension_emit", { channel, data }).catch(() => undefined); },
    onExtensionEvent(listener) { extensionListeners.add(listener); return () => extensionListeners.delete(listener); },
    async dispose() {
      if (!closed) await request("dispose", {}).catch(() => undefined);
      closed = true;
      unsubscribe();
      unsubscribeClose();
      input.transport.close("CAT worker host disposed.");
    },
  };
}
