import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import {
  createAgentSession,
  createAgentSessionRuntime,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSessionRuntime,
  type CreateAgentSessionRuntimeFactory,
} from "@earendil-works/pi-coding-agent";
import {
  formatAssistantMemoryRecall,
  listAssistantMemories,
  resolveStandaloneFileGrantAccess,
  standaloneTaskSessionRoot,
  type FileGrantV1,
} from "@linguist-agent/cat-data";
import { createAssistantLibraryTools, createAssistantMemoryTools, createStandaloneDocumentTools } from "@linguist-agent/cat-tools";
import { applySharedPiRuntimeOverrides } from "./piRuntimeOverrides.js";
import { normalizePiRuntimeModel } from "./modelCompat.js";
import { createGeneralRuntimeExtension } from "./generalRuntimeExtension.js";
import { createGeneralDelegationTool, type GeneralDelegationRequest, type GeneralDelegationResult } from "./generalDelegation.js";
import {
  CAPABILITY_SEARCH_TOOL,
  createDynamicToolLoadingExtension,
  type CapabilityActivation,
} from "./dynamicToolLoading.js";
import { createGeneralSandboxedBashTool } from "./generalSandbox.js";
import {
  buildGeneralResourceSnapshot,
  verifyGeneralResourceSnapshot,
  type GeneralResourceSnapshot,
  type GeneralResourceSnapshotEntry,
} from "./generalResourceSnapshot.js";
import type {
  AgentPermissionContract,
  AgentPermissionRequest,
  AgentPermissionUserDecision,
} from "./agentPermissions.js";

const builtinModelCatalog = builtinModels();
const GENERAL_BUILTIN_TOOLS = ["read", "grep", "find", "ls", "edit", "write", "bash"] as const;
const GENERAL_READ_ONLY_TOOLS = ["read", "grep", "find", "ls"] as const;

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
  authorizeExecutableExtensions?: (request: GeneralExecutableExtensionAuthorizationRequest) => Promise<void>;
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
  const access = await resolveStandaloneFileGrantAccess(options.runtimeRoot, options.taskId);
  const confirmedMemory = formatAssistantMemoryRecall(await listAssistantMemories(options.runtimeRoot, { kind: "personal" }));
  const agentDir = options.agentDir ?? getAgentDir();
  const sessionIdSuffix = options.sessionIdSuffix?.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 64);
  const sessionId = `${generalAgentSessionId(options.taskId, access.workingDirectory)}${sessionIdSuffix ? `-${sessionIdSuffix}` : ""}`;
  const model = normalizePiRuntimeModel(
    options.modelProvider && options.modelId
      ? options.modelRuntime.getModel(options.modelProvider, options.modelId)
        ?? builtinModelCatalog.getModel(options.modelProvider, options.modelId)
      : undefined,
  );
  let activeSessionId: string | undefined = sessionId;
  const sessionManager = await openOrCreateSession(
    access.workingDirectory,
    standaloneTaskSessionRoot(options.runtimeRoot, options.taskId),
    sessionId,
    options.sessionFile,
  );
  let inventory: GeneralResourceInventory | undefined;
  let resourceSnapshot: GeneralResourceSnapshot | undefined;
  const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager: nextSessionManager, sessionStartEvent }) => {
    if (cwd !== access.workingDirectory) throw new Error(`General Chat runtime cannot switch outside its authorized working directory: ${cwd}`);
    const nextSettings = SettingsManager.create(cwd, agentDir, { projectTrusted: options.projectTrusted === true });
    applySharedPiRuntimeOverrides(nextSettings);
    if (!resourceSnapshot) {
      const candidate = await buildGeneralResourceSnapshot({
        cwd,
        agentDir,
        settingsManager: nextSettings,
        projectTrusted: options.projectTrusted === true,
        includeExecutableExtensions: options.readOnlyChild !== true,
        managedResources: options.managedResources,
      });
      const executableExtensions = candidate.entries.filter((entry) => entry.type === "extension" && entry.scope === "user");
      if (executableExtensions.length) {
        if (!options.authorizeExecutableExtensions) {
          throw new Error("General Chat found executable user Pi Extensions, but no pre-execution trust channel is available.");
        }
        await options.authorizeExecutableExtensions({ extensions: executableExtensions, resourceSetHash: candidate.resourceSetHash });
      }
      resourceSnapshot = candidate;
    }
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
      additionalExtensionPaths: resourceSnapshot.extensionPaths,
      additionalSkillPaths: resourceSnapshot.skillPaths,
      additionalPromptTemplatePaths: resourceSnapshot.promptPaths,
      additionalThemePaths: resourceSnapshot.themePaths,
      agentsFilesOverride: () => ({ agentsFiles: resourceSnapshot!.contextFiles }),
      systemPrompt: resourceSnapshot.systemPrompt,
      appendSystemPrompt: resourceSnapshot.appendSystemPrompt,
      extensionFactories: [
        createGeneralRuntimeExtension({
          access: () => resolveStandaloneFileGrantAccess(options.runtimeRoot, options.taskId),
          contract: options.permissionContract,
          sessionId: () => activeSessionId,
          requestDecision: options.requestPermissionDecision,
        }),
        ...(options.readOnlyChild ? [] : [createDynamicToolLoadingExtension({
          initialToolNames: [
            ...GENERAL_BUILTIN_TOOLS,
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
          options.readOnlyChild
            ? "- You are a delegated child Agent. You may only read explicitly granted local material and return analysis. File writes, shell/process execution, network/bridge use, UI requests, further delegation, and external side effects are forbidden."
            : "- Use delegate_agent for a bounded independent read-only subtask when delegation adds real leverage; verify and synthesize the child result yourself.",
          confirmedMemory || "- No explicitly confirmed Personal memory is active for this Chat.",
          options.contextHandoffs?.length
            ? `- Explicit context handoff(s) accepted by the user:\n${options.contextHandoffs.join("\n\n---\n\n")}`
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
    const memoryTools = createAssistantMemoryTools({ runtimeRoot: options.runtimeRoot, scope: { kind: "personal" }, sourceTaskId: options.taskId, personalOnly: true })
      .filter((tool) => !options.readOnlyChild || tool.name === "assistant_memory_search");
    const libraryTools = createAssistantLibraryTools({ runtimeRoot: options.runtimeRoot, scope: { kind: "personal" } });
    const documentTools = options.runId && options.rootAgentThreadId
      && !options.readOnlyChild
      ? createStandaloneDocumentTools({ runtimeRoot: options.runtimeRoot, taskId: options.taskId, runId: options.runId, agentThreadId: options.rootAgentThreadId })
      : [];
    const delegationTools = options.delegate && !options.readOnlyChild ? [createGeneralDelegationTool(options.delegate)] : [];
    const builtinTools = options.readOnlyChild ? GENERAL_READ_ONLY_TOOLS : GENERAL_BUILTIN_TOOLS;
    const result = await createAgentSession({
      cwd,
      modelRuntime: options.modelRuntime,
      model,
      thinkingLevel: options.thinkingLevel,
      sessionManager: nextSessionManager,
      settingsManager: nextSettings,
      resourceLoader,
      customTools: [
        ...(options.readOnlyChild ? [] : [createGeneralSandboxedBashTool(access)]),
        ...memoryTools,
        ...libraryTools,
        ...documentTools,
        ...delegationTools,
      ],
      sessionStartEvent,
    });
    result.session.setActiveToolsByName([
      ...new Set([
        ...builtinTools,
        ...(options.readOnlyChild ? [] : [CAPABILITY_SEARCH_TOOL]),
        ...memoryTools.map((tool) => tool.name),
        ...libraryTools.map((tool) => tool.name),
        ...delegationTools.map((tool) => tool.name),
      ]),
    ]);
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
      resourceSetHash: resourceSnapshot?.resourceSetHash ?? createHash("sha256").update("[]").digest("hex"),
    },
  };
}
