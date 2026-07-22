import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type CreateAgentSessionOptions,
  type CreateAgentSessionResult,
  type EventBus,
  type ExtensionUIContext,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import type { CatWorkspace, MemoryConfig } from "@linguist-agent/cat-data";
import { workspacePath } from "@linguist-agent/cat-data";
import { buildCatTools } from "@linguist-agent/cat-tools";
import { applyCatSessionExtensionsOverride } from "./catResourceInheritance.js";
import {
  BROWSER_SESSION_POLICY,
  CAT_SESSION_PRESETS,
  DEFAULT_PROJECT_SESSION_MODE,
  DEFAULT_SESSION_PRESET,
  type CatSessionPreset,
} from "./catAgentDefaults.js";
import { createCatRuntimeExtension } from "./catRuntimeExtension.js";
import { createSandboxedBashTool } from "./catSandbox.js";
import { applySharedPiRuntimeOverrides } from "./piRuntimeOverrides.js";
import { applyAgentRunToolOptions, type AgentRunOptions } from "./agentRunOptions.js";
import type { AgentPermissionContract, AgentPermissionRequest, AgentPermissionUserDecision } from "./agentPermissions.js";
import { normalizePiRuntimeModel } from "./modelCompat.js";
import { buildCatRequestShape, type CatRequestShapeManifest, type CatRequestShapeResource } from "./catRequestShape.js";

const DEV_TOOLS = ["read", "edit", "write", "bash", "grep", "find", "ls"];
const CAT_FORBIDDEN_SESSION_TOOLS = [
  "edit",
  "write",
  // Product CAT work never needs a general-purpose shell. Even sandboxed bash
  // can launch another Agent/LLM CLI and create a second Session/Run truth, so
  // it stays available only to the explicit dev preset rather than the
  // canonical Task surface.
  "bash",
  // Specialist execution is server-owned canonical Run/thread state. The
  // Package stays pinned as a runtime building block, but its standalone
  // supervisor tools must never create a parallel Task/Run truth in a normal
  // product Session.
  "subagent",
  "wait",
  "subagent_supervisor",
  "intercom",
  "contact_supervisor",
];
const builtinModelCatalog = builtinModels();

export type PiEventBusLike = EventBus;

export type CreateCatAgentSessionResult = CreateAgentSessionResult & {
  eventBus?: EventBus;
  requestShape: CatRequestShapeManifest;
};

export interface CatIsolatedResources {
  extensionPaths?: string[];
  skillPaths?: string[];
  promptTemplatePaths?: string[];
  themePaths?: string[];
}

export interface CatExtensionBinding {
  uiContext: ExtensionUIContext;
  mode: "rpc";
}

export interface CreateCatAgentSessionOptions {
  workspace: CatWorkspace;
  /** Process-owned Pi model/auth runtime. The server injects one shared instance. */
  modelRuntime?: ModelRuntime;
  modelProvider?: string;
  modelId?: string;
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  sessionMode?: "memory" | "new" | "continue" | "project";
  sessionId?: string;
  branchEntryId?: string;
  memoryConfig?: MemoryConfig;
  /** Session preset: cat (full CAT tools, default) | dev (LA self-edit) | scratch (conversational). */
  preset?: CatSessionPreset;
  /** Tool names the user disabled at runtime (Settings → Tools). Filtered out of the CAT surface. */
  disabledTools?: string[];
  runOptions?: AgentRunOptions;
  /** Server-owned resources for a Task Run. Never merge these with client-authored resource paths. */
  isolatedResources?: CatIsolatedResources;
  /** Native host UI bridge. Binding completes before the request-shape manifest is captured. */
  extensionBinding?: CatExtensionBinding;
  /** Server-owned host actions for the canonical Task Run. Never populated from client input or Pi settings. */
  serverTools?: ToolDefinition[];
  /** Disable LA CAT lifecycle hooks for fully compiled, isolated adapters such as Private Eval. */
  runtimeExtension?: boolean;
  /** Agent-autonomy policy for inherited/builtin/general tools. CAT-domain tools remain CAT-governed. */
  permissionContract?: AgentPermissionContract;
  requestPermissionDecision?: (request: AgentPermissionRequest) => Promise<AgentPermissionUserDecision>;
}

export function catAgentSessionDir(workspace: CatWorkspace): string {
  return workspacePath(workspace, "_pi_sessions");
}

function sanitizeSessionPart(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 48);
  return slug || "project";
}

export function catAgentProjectSessionId(workspace: CatWorkspace): string {
  const slug = sanitizeSessionPart(workspace.projectId);
  const hash = createHash("sha1")
    .update(`${workspace.projectId}\0${workspace.root}`)
    .digest("hex")
    .slice(0, 10);
  return `la-${slug}-${hash}`;
}

async function openOrCreateSessionById(cwd: string, sessionDir: string, sessionId: string): Promise<SessionManager> {
  const sessions = await SessionManager.list(cwd, sessionDir);
  const existing = sessions.find((session) => session.id === sessionId);
  if (existing) return SessionManager.open(existing.path, sessionDir, cwd);
  return SessionManager.create(cwd, sessionDir, { id: sessionId });
}

export async function createCatAgentSession(
  options: CreateCatAgentSessionOptions,
): Promise<CreateCatAgentSessionResult> {
  const modelRuntime = options.modelRuntime ?? await ModelRuntime.create({ allowModelNetwork: false });
  const model = normalizePiRuntimeModel(
    options.modelProvider && options.modelId
      ? (modelRuntime.getModel(options.modelProvider, options.modelId) ??
        builtinModelCatalog.getModel(options.modelProvider, options.modelId))
      : undefined,
  );
  const runOptions = options.runOptions;
  const isolatedResources = options.isolatedResources;
  if (isolatedResources && [
    runOptions?.additionalExtensionPaths,
    runOptions?.additionalSkillPaths,
    runOptions?.additionalPromptTemplatePaths,
    runOptions?.additionalThemePaths,
  ].some((paths) => paths !== undefined)) {
    throw new Error("isolatedResources cannot be combined with runOptions additional resource paths");
  }
  const settingsManager = isolatedResources
    ? SettingsManager.inMemory({}, { projectTrusted: false })
    : SettingsManager.create(
        options.workspace.root,
        getAgentDir(),
        runOptions?.projectTrustOverride === undefined ? undefined : { projectTrusted: runOptions.projectTrustOverride },
      );
  applySharedPiRuntimeOverrides(settingsManager);
  const presetDef = CAT_SESSION_PRESETS[options.preset ?? DEFAULT_SESSION_PRESET];
  const inheritsProjectContext = presetDef.preset === "dev";
  const isolatesProductResources = isolatedResources !== undefined || !inheritsProjectContext;
  let activeSessionId: string | undefined = options.sessionId;
  const resourceLoader = new DefaultResourceLoader({
    cwd: options.workspace.root,
    agentDir: getAgentDir(),
    settingsManager,
    additionalExtensionPaths: isolatedResources?.extensionPaths ?? (inheritsProjectContext ? runOptions?.additionalExtensionPaths : undefined),
    additionalSkillPaths: isolatedResources?.skillPaths ?? (inheritsProjectContext ? runOptions?.additionalSkillPaths : undefined),
    additionalPromptTemplatePaths: isolatedResources?.promptTemplatePaths ?? (inheritsProjectContext ? runOptions?.additionalPromptTemplatePaths : undefined),
    additionalThemePaths: isolatedResources?.themePaths ?? (inheritsProjectContext ? runOptions?.additionalThemePaths : undefined),
    noExtensions: isolatesProductResources ? true : (runOptions?.noExtensions ?? BROWSER_SESSION_POLICY.noExtensions),
    noSkills: isolatesProductResources ? true : runOptions?.noSkills,
    noPromptTemplates: isolatesProductResources ? true : runOptions?.noPromptTemplates,
    noThemes: isolatesProductResources ? true : runOptions?.noThemes,
    noContextFiles: isolatedResources ? true : (inheritsProjectContext ? runOptions?.noContextFiles : true),
    extensionsOverride: applyCatSessionExtensionsOverride,
    extensionFactories: options.runtimeExtension === false ? [] : [createCatRuntimeExtension(options.workspace, {
      contract: options.permissionContract,
      sessionId: () => activeSessionId,
      requestDecision: options.requestPermissionDecision,
    })],
    systemPromptOverride: presetDef.preset === "dev"
      ? undefined
      : () => "Follow the Linguist Agent runtime constitution and the current typed task context.",
    appendSystemPromptOverride: (base) => {
      const inheritedAppendix = presetDef.preset === "dev" ? [] : base;
      return presetDef.systemAppendix ? [...inheritedAppendix, presetDef.systemAppendix] : inheritedAppendix;
    },
  });
  await resourceLoader.reload();
  const extensionErrors = resourceLoader.getExtensions().errors;
  if (extensionErrors.length) {
    throw new Error(`Pi Extension loading failed: ${extensionErrors.map(({ path, error }) => `${path}: ${error}`).join("; ")}`);
  }

  const sessionDir = catAgentSessionDir(options.workspace);
  const sessionMode = runOptions?.noSession ? "memory" : (options.sessionMode ?? DEFAULT_PROJECT_SESSION_MODE);
  const projectSessionId = options.sessionId ?? catAgentProjectSessionId(options.workspace);
  const sessionManager =
    sessionMode === "memory"
      ? SessionManager.inMemory(options.workspace.root)
      : sessionMode === "new"
        ? SessionManager.create(options.workspace.root, sessionDir)
        : sessionMode === "continue"
          ? SessionManager.continueRecent(options.workspace.root, sessionDir)
          : await openOrCreateSessionById(options.workspace.root, sessionDir, projectSessionId);
  if (options.branchEntryId) {
    if (!sessionManager.getEntry(options.branchEntryId)) {
      throw new Error(`Pi session entry not found: ${options.branchEntryId}`);
    }
    sessionManager.branch(options.branchEntryId);
  }

  // Preset shapes the tool surface (the native createAgentSession preset mechanism):
  // cat → isolated server-owned resources plus CAT custom tools; dev → explicit
  // development resources and coding tools; scratch/eval → no model tools.
  const disabled = new Set(options.disabledTools ?? []);
  const customTools =
    presetDef.toolMode === "cat"
      ? [
          createSandboxedBashTool(options.workspace),
          ...buildCatTools(options.workspace, options.memoryConfig, { includeWebBridges: false }),
        ].filter((tool) => !disabled.has(tool.name)).concat(options.serverTools ?? [])
      : [];
  const baseSessionOptions: CreateAgentSessionOptions =
    presetDef.toolMode === "conversational"
      ? {
          cwd: options.workspace.root,
          modelRuntime,
          model,
          thinkingLevel: options.thinkingLevel,
          sessionManager,
          settingsManager,
          resourceLoader,
          noTools: "all",
        }
      : presetDef.toolMode === "code"
        ? {
            cwd: options.workspace.root,
            modelRuntime,
            model,
            thinkingLevel: options.thinkingLevel,
            sessionManager,
            settingsManager,
            resourceLoader,
            tools: DEV_TOOLS,
          }
        : {
            cwd: options.workspace.root,
            modelRuntime,
            model,
            thinkingLevel: options.thinkingLevel,
            sessionManager,
            settingsManager,
            resourceLoader,
            customTools,
            excludeTools: [...CAT_FORBIDDEN_SESSION_TOOLS, ...(options.disabledTools ?? [])],
          };
  const sessionOptions = applyAgentRunToolOptions(baseSessionOptions, runOptions);

  const result = await createAgentSession(sessionOptions);
  activeSessionId = result.session.sessionId;
  if (options.extensionBinding) {
    try {
      await result.session.bindExtensions(options.extensionBinding);
    } catch (error) {
      result.session.dispose();
      throw error;
    }
  }
  const resourceEntry = (kind: CatRequestShapeResource["kind"], value: unknown): CatRequestShapeResource => {
    const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
    return {
      kind,
      name: typeof row.name === "string" ? row.name : typeof row.path === "string" ? row.path : "unknown",
      description: typeof row.description === "string" ? row.description : undefined,
      path: typeof row.path === "string" ? row.path : typeof row.filePath === "string" ? row.filePath : undefined,
    };
  };
  const requestShape = buildCatRequestShape({
    systemPrompt: result.session.systemPrompt,
    activeToolNames: result.session.getActiveToolNames(),
    tools: result.session.getAllTools(),
    resources: [
      ...resourceLoader.getSkills().skills.map((value) => resourceEntry("skill", value)),
      ...resourceLoader.getPrompts().prompts.map((value) => resourceEntry("prompt", value)),
      ...resourceLoader.getAgentsFiles().agentsFiles.map((value) => ({ kind: "context" as const, name: value.path, path: value.path })),
    ],
  });


  return {
    ...result,
    eventBus: (resourceLoader as unknown as { eventBus?: EventBus }).eventBus,
    requestShape,
  };
}
