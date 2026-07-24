import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import {
  createAgentSession,
  createAgentSessionRuntime,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSessionRuntime,
  type CreateAgentSessionRuntimeFactory,
} from "@earendil-works/pi-coding-agent";
import {
  standaloneTaskSessionRoot,
  type AssistantMemoryPersistence,
  type FileGrantV1,
  type LibraryPersistence,
} from "@linguist-agent/cat-data";
import { createAssistantLibraryTools, createAssistantMemoryTools, createPresentAnswerTool, createStandaloneDocumentTools, createUpdatePlanTool } from "@linguist-agent/cat-tools";
import { applySharedPiRuntimeOverrides } from "./piRuntimeOverrides.js";
import { normalizePiRuntimeModel } from "./modelCompat.js";
import { createGeneralRuntimeExtension } from "./generalRuntimeExtension.js";
import { createGeneralDelegationTool, type GeneralDelegationRequest, type GeneralDelegationResult } from "./generalDelegation.js";
import { routeDocumentWithPolicy } from "./documentRouter.js";
import {
  CAPABILITY_SEARCH_TOOL,
  createDynamicToolLoadingExtension,
  type CapabilityActivation,
} from "./dynamicToolLoading.js";
import { createGeneralSandboxedBashTool } from "./generalSandbox.js";
import {
  assertGeneralAgentSessionPlan,
  GENERAL_BUILTIN_TOOL_NAMES,
  GENERAL_READ_ONLY_TOOL_NAMES,
  prepareGeneralAgentSessionPlan,
  resolveGeneralSessionPlanAccess,
  type GeneralAgentSessionPlanV1,
} from "./generalSessionPlan.js";
import {
  verifyGeneralResourceSnapshot,
  type AuthorizedExtensionStage,
  type GeneralResourceSnapshot,
  type GeneralResourceSnapshotEntry,
} from "./generalResourceSnapshot.js";
import type {
  AgentPermissionContract,
  AgentPermissionRequest,
  AgentPermissionUserDecision,
} from "./agentPermissions.js";
import { assertProductionToolCapabilities } from "./toolCapabilities.js";

const builtinModelCatalog = builtinModels();
export interface GeneralResourceInventory {
  extensions: Array<{
    path: string;
    tools: string[];
    commands: string[];
    sha256?: string;
    source?: string;
    scope?: "user" | "project" | "temporary";
  }>;
  skills: Array<{ name: string; description: string; filePath: string }>;
  prompts: Array<{ name: string; description: string; filePath: string }>;
  contextFiles: string[];
  activeToolNames: string[];
  entries: GeneralResourceSnapshotEntry[];
  conflicts: Array<{
    kind: "tool" | "flag";
    name: string;
    winnerPath: string;
    shadowedPath: string;
  }>;
  resourceSetHash: string;
}

export interface GeneralExecutableExtensionAuthorizationRequest {
  extensions: GeneralResourceSnapshotEntry[];
  resourceSetHash: string;
}

export interface CreateGeneralAgentSessionOptions {
  runtimeRoot: string;
  taskId: string;
  /** Active canonical Run identity; omitted for read-only resume/compact/fork sessions. */
  runId?: string;
  rootAgentThreadId?: string;
  /** Server-owned child identity. Children use a distinct Pi session and a read-only surface. */
  sessionIdSuffix?: string;
  readOnlyChild?: boolean;
  /** Test/managed-runtime override; production defaults to Pi's canonical agent dir. */
  agentDir?: string;
  modelRuntime: ModelRuntime;
  modelProvider?: string;
  modelId?: string;
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  permissionContract: AgentPermissionContract;
  requestPermissionDecision?: (request: AgentPermissionRequest) => Promise<AgentPermissionUserDecision>;
  /** Pi project trust resolved by the server before any working-directory resource is loaded. */
  projectTrusted?: boolean;
  /** Required before previously unknown user/global Extension bytes may be evaluated. */
  authorizeExecutableExtensions?: (request: GeneralExecutableExtensionAuthorizationRequest) => Promise<AuthorizedExtensionStage[] | void>;
  /** Server-authored Pi session file selected by a canonical AgentThread. */
  sessionFile?: string;
  /** Server-authored context copied explicitly through a context_handoff Artifact. */
  contextHandoffs?: string[];
  /** Canonical Run projection hook for Pi-native additive tool activation. */
  onCapabilityActivation?: (activation: CapabilityActivation) => void;
  /** Server-approved Package Center resources; catalog entries alone never reach this list. */
  managedResources?: {
    extensions: string[];
    skills: string[];
    prompts: string[];
    themes: string[];
  };
  delegate?: (request: GeneralDelegationRequest, signal?: AbortSignal) => Promise<GeneralDelegationResult>;
  /** Host-authored immutable preflight. Supplying it prevents resource/settings rediscovery. */
  preparedPlan?: GeneralAgentSessionPlanV1;
  assistantMemoryStore?: AssistantMemoryPersistence;
  libraryPersistence?: LibraryPersistence;
  /** Host-owned canonical agent_plan writer crossing the Worker bridge; unavailable sessions reject at execution time. */
  submitAgentPlan?: (payload: unknown) => Promise<unknown>;
  /** Host-owned canonical agent_present writer crossing the Worker bridge; unavailable sessions reject at execution time. */
  submitAgentPresent?: (payload: unknown) => Promise<unknown>;
}

export interface CreateGeneralAgentSessionResult {
  session: Awaited<ReturnType<typeof createAgentSession>>["session"];
  runtime?: AgentSessionRuntime;
  access: {
    workspaceRoot: string;
    workingDirectory: string;
    grants: FileGrantV1[];
  };
  resources: GeneralResourceInventory;
}

function generalExtensionConflicts(extensions: Array<{
  path: string;
  tools: ReadonlyMap<string, unknown>;
  flags: ReadonlyMap<string, unknown>;
}>): GeneralResourceInventory["conflicts"] {
  const conflicts: GeneralResourceInventory["conflicts"] = [];
  const toolOwners = new Map<string, string>();
  const flagOwners = new Map<string, string>();
  for (const extension of extensions) {
    for (const name of extension.tools.keys()) {
      const winnerPath = toolOwners.get(name);
      if (winnerPath && winnerPath !== extension.path) conflicts.push({ kind: "tool", name, winnerPath, shadowedPath: extension.path });
      else toolOwners.set(name, extension.path);
    }
    for (const name of extension.flags.keys()) {
      const winnerPath = flagOwners.get(name);
      if (winnerPath && winnerPath !== extension.path) conflicts.push({ kind: "flag", name, winnerPath, shadowedPath: extension.path });
      else flagOwners.set(name, extension.path);
    }
  }
  return conflicts;
}

function isPiConflictDiagnostic(error: string): boolean {
  return /^(?:Tool ".+"|Flag "--.+") conflicts with /u.test(error);
}

export function generalAgentSessionId(taskId: string, workingDirectory: string): string {
  const safeTask = taskId.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 48) || "chat";
  const cwdHash = createHash("sha256").update(workingDirectory).digest("hex").slice(0, 12);
  return `la-chat-${safeTask}-${cwdHash}`;
}

async function openOrCreateSession(
  cwd: string,
  sessionDir: string,
  sessionId: string,
  sessionFile?: string,
): Promise<SessionManager> {
  if (sessionFile) {
    const [resolvedFile, resolvedDir] = await Promise.all([realpath(sessionFile), realpath(sessionDir)]);
    const rel = relative(resolvedDir, resolvedFile);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("Selected Pi session file escapes this standalone Chat's session directory.");
    return SessionManager.open(resolvedFile, resolvedDir, cwd);
  }
  const sessions = await SessionManager.list(cwd, sessionDir);
  const existing = sessions.find((session) => session.id === sessionId);
  return existing
    ? SessionManager.open(existing.path, sessionDir, cwd)
    : SessionManager.create(cwd, sessionDir, { id: sessionId });
}

export async function createGeneralAgentSession(
  options: CreateGeneralAgentSessionOptions,
): Promise<CreateGeneralAgentSessionResult> {
  const preparedPlan = options.preparedPlan ?? await prepareGeneralAgentSessionPlan({
    runtimeRoot: options.runtimeRoot,
    taskId: options.taskId,
    runId: options.runId,
    rootAgentThreadId: options.rootAgentThreadId,
    sessionIdSuffix: options.sessionIdSuffix,
    readOnlyChild: options.readOnlyChild,
    agentDir: options.agentDir,
    modelProvider: options.modelProvider,
    modelId: options.modelId,
    thinkingLevel: options.thinkingLevel,
    permissionContract: options.permissionContract,
    projectTrusted: options.projectTrusted,
    sessionFile: options.sessionFile,
    contextHandoffs: options.contextHandoffs,
    delegationEnabled: Boolean(options.delegate),
    managedResources: options.managedResources,
    assistantMemoryStore: options.assistantMemoryStore,
  });
  assertGeneralAgentSessionPlan(preparedPlan);
  if (preparedPlan.runtimeRoot !== options.runtimeRoot
    || preparedPlan.taskId !== options.taskId
    || preparedPlan.runId !== options.runId
    || preparedPlan.rootAgentThreadId !== options.rootAgentThreadId
    || preparedPlan.sessionIdSuffix !== options.sessionIdSuffix
    || preparedPlan.readOnlyChild !== (options.readOnlyChild === true)
    || preparedPlan.agentDir !== (options.agentDir ?? preparedPlan.agentDir)
    || preparedPlan.modelProvider !== options.modelProvider
    || preparedPlan.modelId !== options.modelId
    || preparedPlan.thinkingLevel !== options.thinkingLevel
    || JSON.stringify(preparedPlan.permissionContract) !== JSON.stringify(options.permissionContract)
    || preparedPlan.projectTrusted !== (options.projectTrusted === true)
    || preparedPlan.sessionFile !== options.sessionFile
    || JSON.stringify(preparedPlan.contextHandoffs) !== JSON.stringify(options.contextHandoffs ?? [])
    || preparedPlan.delegationEnabled !== Boolean(options.delegate)) {
    throw new Error("General session preparation plan does not match the requested session identity or capabilities.");
  }
  const access = preparedPlan.access;
  const confirmedMemory = preparedPlan.confirmedMemory;
  const agentDir = preparedPlan.agentDir;
  const sessionIdSuffix = preparedPlan.sessionIdSuffix?.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 64);
  const sessionId = `${generalAgentSessionId(preparedPlan.taskId, access.workingDirectory)}${sessionIdSuffix ? `-${sessionIdSuffix}` : ""}`;
  const model = normalizePiRuntimeModel(
    preparedPlan.modelProvider && preparedPlan.modelId
      ? options.modelRuntime.getModel(preparedPlan.modelProvider, preparedPlan.modelId)
        ?? builtinModelCatalog.getModel(preparedPlan.modelProvider, preparedPlan.modelId)
      : undefined,
  );
  let activeSessionId: string | undefined = sessionId;
  const sessionManager = await openOrCreateSession(
    access.workingDirectory,
    standaloneTaskSessionRoot(preparedPlan.runtimeRoot, preparedPlan.taskId),
    sessionId,
    preparedPlan.sessionFile,
  );
  let inventory: GeneralResourceInventory | undefined;
  const resourceSnapshot: GeneralResourceSnapshot = preparedPlan.resourceSnapshot;
  if (resourceSnapshot.extensionPaths.length > 0) {
    throw new Error("External executable Extensions must use the isolated Extension Host; direct Pi loader execution is disabled.");
  }
  const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager: nextSessionManager, sessionStartEvent }) => {
    if (cwd !== access.workingDirectory) throw new Error(`General Chat runtime cannot switch outside its authorized working directory: ${cwd}`);
    const nextSettings = SettingsManager.create(cwd, agentDir, { projectTrusted: preparedPlan.projectTrusted });
    applySharedPiRuntimeOverrides(nextSettings);
    await verifyGeneralResourceSnapshot(resourceSnapshot);
    // Resource discovery is resolved above without evaluating code. The loader
    // receives only the exact, approved snapshot paths so Settings/package
    // changes cannot expand this Run's surface during runtime replacement.
    const resourceSettings = SettingsManager.inMemory({}, { projectTrusted: false });
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager: resourceSettings,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      additionalSkillPaths: resourceSnapshot.skillPaths,
      additionalPromptTemplatePaths: resourceSnapshot.promptPaths,
      additionalThemePaths: resourceSnapshot.themePaths,
      agentsFilesOverride: () => ({ agentsFiles: resourceSnapshot!.contextFiles }),
      systemPrompt: resourceSnapshot.systemPrompt,
      appendSystemPrompt: resourceSnapshot.appendSystemPrompt,
      extensionFactories: [
        createGeneralRuntimeExtension({
          access: () => resolveGeneralSessionPlanAccess(preparedPlan),
          contract: preparedPlan.permissionContract,
          taskId: preparedPlan.taskId,
          runId: preparedPlan.runId,
          sessionId: () => activeSessionId,
          requestDecision: options.requestPermissionDecision,
        }),
        ...(preparedPlan.readOnlyChild ? [] : [createDynamicToolLoadingExtension({
          initialToolNames: [
            ...GENERAL_BUILTIN_TOOL_NAMES,
            "assistant_memory_search",
            "assistant_memory_propose",
            "assistant_library_search",
            "assistant_library_list",
          ],
          // Child execution must enter LA's canonical server-owned Team bridge
          // so it can become an AgentThread/Run with bounded permissions.
          blockedToolNames: ["subagent", "wait"],
          onActivation: options.onCapabilityActivation,
        })]),
      ],
      appendSystemPromptOverride: (base) => [
        ...base,
        [
          "Linguist Agent General Core:",
          "- You are a general local work Agent with strong localization workflows, evidence handling, and deliverable production.",
          "- This is a standalone Chat. It has no Project, Batch, locale pair, CAT segment authority, or delivery authority unless the user explicitly enters a Project Task.",
          `- Current working directory: ${access.workingDirectory}`,
          `- Private Chat workspace: ${access.workspaceRoot}`,
          `- Active file grants: ${access.grants.length ? access.grants.map((grant) => `${grant.access}:${grant.realPath}`).join(", ") : "none"}`,
          "- Never probe outside these roots. Ask the host for a file or directory grant when more access is needed.",
          "- Use inherited Pi Extensions, Skills, Prompts, context files, and Package tools when relevant; obey host permission Decisions and never route around a denial.",
          "- Produce inspectable files and Artifacts for durable work instead of claiming completion from prose alone.",
          preparedPlan.runId && preparedPlan.rootAgentThreadId && !preparedPlan.readOnlyChild
            ? "- For multi-step work, keep one visible work plan current with agent_plan_update (activate it via capability_search first); users watch that plan in the timeline."
            : undefined,
          preparedPlan.runId && preparedPlan.rootAgentThreadId && !preparedPlan.readOnlyChild
            ? "- When an answer is easier to scan as a table, chart, or diff, present it with agent_present (activate it via capability_search first) so it renders as a card in the timeline."
            : undefined,
          preparedPlan.readOnlyChild
            ? "- You are a delegated child Agent. You may only read explicitly granted local material and return analysis. File writes, shell/process execution, network/bridge use, UI requests, further delegation, and external side effects are forbidden."
            : "- Use delegate_agent for a bounded independent read-only subtask when delegation adds real leverage; verify and synthesize the child result yourself.",
          confirmedMemory || "- No host-selected Confirmed Memory was attached to this Run. Use assistant_memory_search for scoped recall.",
          preparedPlan.contextHandoffs.length
            ? `- Explicit context handoff(s) accepted by the user:\n${preparedPlan.contextHandoffs.join("\n\n---\n\n")}`
            : undefined,
        ].filter(Boolean).join("\n"),
      ],
    });
    await resourceLoader.reload();
    const extensionResult = resourceLoader.getExtensions();
    const fatalExtensionErrors = extensionResult.errors.filter(({ error }) => !isPiConflictDiagnostic(error));
    if (fatalExtensionErrors.length) {
      throw new Error(`Pi Extension loading failed: ${fatalExtensionErrors.map(({ path, error }) => `${path}: ${error}`).join("; ")}`);
    }
    const memoryTools = createAssistantMemoryTools({ runtimeRoot: preparedPlan.runtimeRoot, scope: { kind: "personal" }, sourceTaskId: preparedPlan.taskId, personalOnly: true, store: options.assistantMemoryStore })
      .filter((tool) => !preparedPlan.readOnlyChild || tool.name === "assistant_memory_search");
    const libraryTools = createAssistantLibraryTools({ runtimeRoot: preparedPlan.runtimeRoot, scope: { kind: "personal" }, persistence: options.libraryPersistence });
    const documentTools = preparedPlan.runId && preparedPlan.rootAgentThreadId
      && !preparedPlan.readOnlyChild
      ? createStandaloneDocumentTools({
        runtimeRoot: preparedPlan.runtimeRoot,
        taskId: preparedPlan.taskId,
        runId: preparedPlan.runId,
        agentThreadId: preparedPlan.rootAgentThreadId,
        routeDocument: ({ sourcePath, useOrientation }) => routeDocumentWithPolicy({ runtimeRoot: preparedPlan.runtimeRoot, taskId: preparedPlan.taskId, sourcePath, useOrientation }),
      })
      : [];
    const delegationTools = options.delegate && !preparedPlan.readOnlyChild ? [createGeneralDelegationTool(options.delegate)] : [];
    const planTools = preparedPlan.runId && preparedPlan.rootAgentThreadId && !preparedPlan.readOnlyChild
      ? [createUpdatePlanTool({
          submitPlan: options.submitAgentPlan ?? (async () => { throw new Error("Agent plan updates are unavailable in this Session."); }),
        })]
      : [];
    const presentTools = preparedPlan.runId && preparedPlan.rootAgentThreadId && !preparedPlan.readOnlyChild
      ? [createPresentAnswerTool({
          submitPresentation: options.submitAgentPresent ?? (async () => { throw new Error("Agent presentations are unavailable in this Session."); }),
        })]
      : [];
    const builtinTools = preparedPlan.readOnlyChild ? GENERAL_READ_ONLY_TOOL_NAMES : GENERAL_BUILTIN_TOOL_NAMES;
    const result = await createAgentSession({
      cwd,
      modelRuntime: options.modelRuntime,
      model,
      thinkingLevel: preparedPlan.thinkingLevel,
      sessionManager: nextSessionManager,
      settingsManager: nextSettings,
      resourceLoader,
      customTools: [
        ...(preparedPlan.readOnlyChild ? [] : [createGeneralSandboxedBashTool(access)]),
        ...memoryTools,
        ...libraryTools,
        ...documentTools,
        ...delegationTools,
        ...planTools,
        ...presentTools,
      ],
      sessionStartEvent,
    });
    try {
      assertProductionToolCapabilities(result.session.getAllTools().map((tool) => tool.name));
    } catch (error) {
      result.session.dispose();
      throw error;
    }
    result.session.setActiveToolsByName([
      ...new Set([
        ...builtinTools,
        ...(preparedPlan.readOnlyChild ? [] : [CAPABILITY_SEARCH_TOOL]),
        ...memoryTools.map((tool) => tool.name),
        ...libraryTools.map((tool) => tool.name),
        ...delegationTools.map((tool) => tool.name),
      ]),
    ]);
    const actualActiveToolNames = result.session.getActiveToolNames();
    if (JSON.stringify(actualActiveToolNames) !== JSON.stringify(preparedPlan.initialActiveToolNames)) {
      result.session.dispose();
      throw new Error("General session active tool surface differs from its immutable preparation plan.");
    }
    const actualRegisteredToolNames = result.session.getAllTools().map((tool) => tool.name).sort();
    if (JSON.stringify(actualRegisteredToolNames) !== JSON.stringify(preparedPlan.registeredToolNames)) {
      result.session.dispose();
      throw new Error(`General session registered tool surface differs from its immutable preparation plan: expected ${JSON.stringify(preparedPlan.registeredToolNames)}, received ${JSON.stringify(actualRegisteredToolNames)}.`);
    }
    activeSessionId = result.session.sessionId;
    const entryByPath = new Map(resourceSnapshot.entries.map((entry) => [resolve(entry.resolvedPath), entry]));
    inventory = {
      extensions: extensionResult.extensions.map((extension) => ({
        path: extension.path,
        tools: [...extension.tools.keys()].sort(),
        commands: [...extension.commands.keys()].sort(),
        ...(() => {
          const entry = entryByPath.get(resolve(extension.resolvedPath));
          return entry ? { sha256: entry.sha256, source: entry.source, scope: entry.scope } : {};
        })(),
      })),
      skills: resourceLoader.getSkills().skills.map(({ name, description, filePath }) => ({ name, description, filePath })),
      prompts: resourceLoader.getPrompts().prompts.map(({ name, description, filePath }) => ({ name, description, filePath })),
      contextFiles: resourceLoader.getAgentsFiles().agentsFiles.map(({ path }) => path),
      activeToolNames: result.session.getActiveToolNames(),
      entries: resourceSnapshot.entries,
      conflicts: generalExtensionConflicts(extensionResult.extensions),
      resourceSetHash: resourceSnapshot.resourceSetHash,
    };
    return {
      ...result,
      services: {
        cwd,
        agentDir,
        modelRuntime: options.modelRuntime,
        settingsManager: nextSettings,
        resourceLoader,
        diagnostics: [],
      },
      diagnostics: [],
    };
  };
  const runtime = await createAgentSessionRuntime(createRuntime, {
    cwd: access.workingDirectory,
    agentDir,
    sessionManager,
  });
  const session = runtime.session;
  return {
    session,
    runtime,
    access,
    resources: inventory ?? {
      extensions: [],
      skills: [],
      prompts: [],
      contextFiles: [],
      activeToolNames: session.getActiveToolNames(),
      entries: resourceSnapshot?.entries ?? [],
      conflicts: [],
      resourceSetHash: resourceSnapshot.resourceSetHash,
    },
  };
}
