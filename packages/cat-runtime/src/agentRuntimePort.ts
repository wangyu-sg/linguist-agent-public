import { VERSION, type AgentSession, type ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { FileGrantV1 } from "@linguist-agent/cat-data";
import type { AgentPermissionContract, AgentPermissionRequest, AgentPermissionUserDecision } from "./agentPermissions.js";
import {
  createGeneralAgentSession,
  type CreateGeneralAgentSessionOptions,
  type GeneralResourceInventory,
} from "./createGeneralAgentSession.js";
import type { CapabilityActivation } from "./dynamicToolLoading.js";
import type { GeneralDelegationRequest, GeneralDelegationResult } from "./generalDelegation.js";
import type { GeneralAgentSessionPlanV1 } from "./generalSessionPlan.js";
import { normalizePiRuntimeEvent, type AgentRuntimeEvent } from "./runtimeEventNormalizer.js";
import { createRuntimeEventPipeline, type RuntimeEventPipeline } from "./runtimeEventPipeline.js";
import { renderRuntimeCompactionInstructions, type RuntimeCompactionRequest } from "./runtimeCompaction.js";

export interface AgentRuntimeImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export interface AgentRuntimeSession {
  readonly sessionId: string;
  readonly sessionFile: string | undefined;
  readonly systemPrompt: string;
  readonly isStreaming: boolean;
  subscribe(listener: (event: AgentRuntimeEvent) => void): () => void;
  prompt(text: string, options?: { images?: AgentRuntimeImageContent[] }): Promise<void>;
  waitForIdle(): Promise<void>;
  steer(text: string): Promise<void>;
  followUp(text: string): Promise<void>;
  clearQueue(): { steering: string[]; followUp: string[] };
  getSteeringMessages(): readonly string[];
  getFollowUpMessages(): readonly string[];
  compact(request: RuntimeCompactionRequest): Promise<unknown>;
  abort(): Promise<void>;
  leafEntryId(): string | undefined;
  hasEntry(entryId: string): boolean;
}

export interface CreateAgentRuntimeSessionInput {
  runtimeRoot: string;
  taskId: string;
  runId?: string;
  rootAgentThreadId?: string;
  sessionIdSuffix?: string;
  readOnlyChild?: boolean;
  agentDir?: string;
  modelProvider?: string;
  modelId?: string;
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  permissionContract: AgentPermissionContract;
  requestPermissionDecision?: (request: AgentPermissionRequest) => Promise<AgentPermissionUserDecision>;
  projectTrusted?: boolean;
  authorizeExecutableExtensions?: CreateGeneralAgentSessionOptions["authorizeExecutableExtensions"];
  sessionFile?: string;
  contextHandoffs?: string[];
  onCapabilityActivation?: (activation: CapabilityActivation) => void;
  managedResources?: {
    extensions: string[];
    skills: string[];
    prompts: string[];
    themes: string[];
  };
  delegate?: (request: GeneralDelegationRequest, signal?: AbortSignal) => Promise<GeneralDelegationResult>;
  preparedPlan?: GeneralAgentSessionPlanV1;
  /** Host-only injection for confirmed-memory persistence; never serialized into a plan. */
  assistantMemoryStore?: CreateGeneralAgentSessionOptions["assistantMemoryStore"];
  /** Host-only injection for Library metadata/blob persistence; never serialized into a plan. */
  libraryPersistence?: CreateGeneralAgentSessionOptions["libraryPersistence"];
  /** Host-only injection for the canonical agent_plan writer; never serialized into a plan. */
  submitAgentPlan?: CreateGeneralAgentSessionOptions["submitAgentPlan"];
  /** Host-only injection for the canonical agent_present writer; never serialized into a plan. */
  submitAgentPresent?: CreateGeneralAgentSessionOptions["submitAgentPresent"];
}

export interface AgentRuntimeSessionCreation {
  session: AgentRuntimeSession;
  runtimeVersion: string;
  access: {
    workspaceRoot: string;
    workingDirectory: string;
    grants: FileGrantV1[];
  };
  resources: GeneralResourceInventory;
  fork?: (
    entryId: string,
    options?: { position?: "before" | "at" },
  ) => Promise<{ cancelled: boolean; session: AgentRuntimeSession }>;
  dispose(): Promise<void>;
}

export interface AgentRuntimePort {
  supportsInput(provider: string, modelId: string, input: "text" | "image"): Promise<boolean>;
  createGeneralSession(input: CreateAgentRuntimeSessionInput): Promise<AgentRuntimeSessionCreation>;
}

function wrapPiSession(session: AgentSession): AgentRuntimeSession {
  const pipelines = new Set<RuntimeEventPipeline>();
  return {
    get sessionId() { return session.sessionId; },
    get sessionFile() { return session.sessionFile; },
    get systemPrompt() { return typeof session.systemPrompt === "string" ? session.systemPrompt : ""; },
    get isStreaming() { return session.isStreaming; },
    subscribe: (listener) => {
      const pipeline = createRuntimeEventPipeline({ emit: listener });
      pipelines.add(pipeline);
      const unsubscribe = session.subscribe((event) => pipeline.accept(normalizePiRuntimeEvent(event)));
      return () => {
        pipeline.cancel();
        pipelines.delete(pipeline);
        unsubscribe();
      };
    },
    prompt: (text, options) => session.prompt(text, options),
    waitForIdle: async () => {
      await session.waitForIdle();
      for (const pipeline of pipelines) pipeline.settle();
    },
    steer: (text) => session.steer(text),
    followUp: (text) => session.followUp(text),
    clearQueue: () => session.clearQueue(),
    getSteeringMessages: () => session.getSteeringMessages(),
    getFollowUpMessages: () => session.getFollowUpMessages(),
    compact: (request) => session.compact(renderRuntimeCompactionInstructions(request.handoff)),
    abort: async () => {
      for (const pipeline of pipelines) pipeline.cancel();
      await session.abort();
    },
    leafEntryId: () => session.sessionManager.getLeafId() ?? undefined,
    hasEntry: (entryId) => Boolean(session.sessionManager.getEntry(entryId)),
  };
}

export function createPiAgentRuntimePort(input: {
  modelRuntime: () => Promise<ModelRuntime>;
}): AgentRuntimePort {
  return {
    async supportsInput(provider, modelId, requestedInput) {
      return input.modelRuntime().then((runtime) => runtime.getModel(provider, modelId)?.input.includes(requestedInput) === true);
    },
    async createGeneralSession(options) {
      const created = await createGeneralAgentSession({
        ...options,
        modelRuntime: await input.modelRuntime(),
      });
      const runtime = created.runtime;
      return {
        session: wrapPiSession(created.session),
        runtimeVersion: VERSION,
        access: created.access,
        resources: created.resources,
        ...(runtime ? {
          fork: async (entryId: string, options?: { position?: "before" | "at" }) => {
            const result = await runtime.fork(entryId, options);
            return { cancelled: result.cancelled, session: wrapPiSession(runtime.session) };
          },
        } : {}),
        dispose: async () => {
          if (runtime) await runtime.dispose();
          else created.session.dispose();
        },
      };
    },
  };
}
