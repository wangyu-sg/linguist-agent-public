import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { DefaultPackageManager, ProjectTrustStore, SessionManager, SettingsManager, getAgentDir, type EventBus } from "@earendil-works/pi-coding-agent";
import {
  appendTaskExecutionSnapshot,
  appendTaskSessionConfigChange,
  createProjectManifest,
  createTaskWorkspace,
  listPrivateEvalRuns,
  listPrivateEvalSets,
  TaskWorkspaceConflictError,
  buildMemoryStatus,
  auditTermbaseConflicts,
  importWorkbookAssetPlan,
  parseAsset,
  planWorkbookAssetImport,
  grepAssets,
  readAssetMappingProfiles,
  readAssetText,
  readWorkbookNativePreview,
  readWorkbookSheetPage,
  readProjectGuidance,
  isProjectGuidanceDecision,
  readTermbaseEntries,
  readTermbaseOverrides,
  readTermHistoryIndex,
  writeProjectGuidance,
  upsertTermbaseOverride,
  saveAssetMappingProfile,
  suggestAssetMappings,
  parseWorkbookTypedAsset,
  readAssetTypedIndex,
  confirmTypedAssetCandidates,
  type ProjectGuidanceDecision,
  type TaskRun,
  importCsvBatch,
  importGenericXliffBatch,
  importMqxliffBatch,
  importPhraseBatch,
  importSdlxliffBatch,
  importXlsxBatch,
  listSubagentAsyncStatuses,
  readSubagentAsyncStatus,
  readBatch,
  readCatWorkflowRun,
  appendDurableFile,
  readJsonFile,
  readProjectManifest,
  waitForSubagentAsyncStatus,
  readSourceContextIndex,
  readProjectTagRules,
  createManualProjectTagRuleCandidate,
  confirmProjectTagRule,
  disableProjectTagRule,
  declareNoProjectTagRules,
  buildProjectTagRuleEvidence,
  discoverTagRulesFromEvidence,
  writeProjectTagRuleCandidates,
  workspacePath,
  createWorkspace,
  inspectLegacyTdaiMemoryConfiguration,
  formatAssistantMemoryRecallReport,
  searchAssistantMemories,
  readAssetVectorIndexSummary,
  readProjectTagRuleContext,
  writeJsonFile,
  type MemoryStatus,
  type AssistantMemoryPersistence,
  type LibraryPersistence,
  type AskTagRuleModel,
  type AskAssetMappingModel,
  type TeamRoleId,
  type TeamRoleSettings,
  ModelContextRegistry,
  estimatePromptTokens,
  planExecutionProfile,
  type PromptRequestBudget,
  type TeamRoleSubagentSpawnRequest,
  type TaskMessageQueue,
  type TaskScope,
  DETERMINISTIC_TEAM_ROLE_IDS,
  RUNTIME_DATA_SCHEMA_VERSION,
  migrateRuntimeDataSchemaV2,
  readQualityChecklist,
  parseQualityChecklistEntries,
  parseMechanicalTextQaOptions,
  writeQualityChecklist,
  safeLogger,
  resolveStructuredStorageBackend,
} from "@linguist-agent/cat-data";
import {
  BROWSER_SESSION_POLICY,
  buildCatRuntimeHealthReport,
  buildCatSandboxHealthReport,
  CAT_PI_PACKAGE_RESOURCES,
  CAT_WEB_SESSION_BRIDGE_POLICIES,
  catAgentProjectSessionId,
  catAgentSessionDir,
  createPiAgentRuntimePort,
  createKeyedSerialQueue,
  cleanupExpiredDocumentRouterStages,
  assertCanonicalTeamProjectSettingsDocument,
  buildTeamEvidenceChildRequestShape,
  readTeamEvidenceChildScope,
  PROJECT_SESSION_STRATEGY,
  buildAgentPermissionContract,
  normalizeAgentPermissionMode,
  normalizeAgentPermissionRules,
  NATIVE_CAPABILITY_PACKAGES,
  type AgentPermissionAction,
  type AgentPermissionContract,
  type AgentPermissionMode,
  type AgentPermissionRequest,
  type AgentPermissionRules,
  type AgentPermissionUserDecision,
  type PiBridgePolicy,
  type NativeCapabilityPackageId,
} from "@linguist-agent/cat-runtime";
import { buildMcpBridgeCatalog, discoverMcpServerTools, readMcpServerConfigs, type McpBridgeCatalog, type McpToolDescriptor } from "@linguist-agent/cat-mcp";
import { listCatToolMetadata } from "@linguist-agent/cat-tools";
import { type AgentTraceEvent } from "./agent_events.js";
import { deleteProjectWorkspace, listProjects, listProjectsWithDiagnostics } from "./projects_index.js";
import { appendServerDiagnostics, createServerDiagnostic, readServerDiagnostics, type ServerDiagnostic } from "./server_diagnostics.js";
import { addPiMessageUsageTotals, emptySessionUsageTotals } from "./session_stats.js";
import {
  buildAgentToolMetadataCatalog,
  createLeasedAgentToolCatalog,
} from "./agent_tool_catalog.js";
import type { AgentPermissionSettings } from "./application/settings_permission_application_port.js";
import { handleAgentPermissionRoute } from "./routes/agent_permission_routes.js";
import { handleAgentCatalogRoute } from "./routes/agent_catalog_routes.js";
import { handleProjectAgentSettingsRoute } from "./routes/project_agent_settings_routes.js";
import { handleWorkflowArtifactRoute } from "./routes/workflow_artifact_routes.js";
import { handleWorkflowRoute, prepareTeamExecution, startSpecialistFollowUp, stopTeamWorkflowRun, type WorkflowRouteDeps } from "./routes/workflow_routes.js";
import {
  bindSubagentResultDeliveryAcknowledgement,
  callSubagentRpc,
  spawnSubagentViaRpc,
  teamRoleAgentName,
} from "./subagent_team_adapter.js";
import { runPrivateEvalCanonicalTeam } from "./private_eval_canonical_team.js";
import type {
  PrivateEvalCanonicalSingleGenerationInput,
  PrivateEvalCanonicalSingleGenerationResult,
} from "./private_eval_canonical_single.js";
import { promptPrivateEvalSession } from "./private_eval_session.js";
import { handleEvalRoute, stopPrivateEvalRun } from "./routes/eval_routes.js";
import { handleBatchRoute } from "./routes/batch_routes.js";
import { handleAssetRoute } from "./routes/asset_routes.js";
import { handleTagRuleRoute } from "./routes/tag_rule_routes.js";
import { handleQualityChecklistRoute } from "./routes/quality_checklist_routes.js";
import { handleStorageRoute } from "./routes/storage_routes.js";
import { formatTaskRuntimeScope, handleTaskWorkspaceRoute, taskAgentSessionId } from "./routes/task_workspace_routes.js";
import { handleStandaloneTaskRoute } from "./routes/standalone_task_routes.js";
import { handleHomeReplacementRoute } from "./routes/home_replacement_routes.js";
import { handleAssistantLibraryRoute } from "./routes/assistant_library_routes.js";
import { handlePackageCenterRoute } from "./routes/package_center_routes.js";
import { resolveActivatedLapkgResources } from "./lapkg_activation.js";
import { recoverLapkgActivation } from "./lapkg_activation_recovery.js";
import { prepareLapkgSqliteCutover } from "./lapkg_sqlite_cutover.js";
import { prepareAssistantMemorySqliteCutover } from "./assistant_memory_sqlite_cutover.js";
import { prepareAssistantLibrarySqliteCutover } from "./assistant_library_sqlite_cutover.js";
import { activateCatCoreSqliteCutover, prepareCatCoreSqliteCutover } from "./cat_core_sqlite_cutover.js";
import { activateCatGovernanceSqliteCutover, prepareCatGovernanceSqliteCutover } from "./cat_governance_sqlite_cutover.js";
import { activateWorkflowEvalSqliteCutover, prepareWorkflowEvalSqliteCutover } from "./workflow_eval_sqlite_cutover.js";
import type { LapkgPackageStorage } from "./lapkg_package_storage.js";
import { acquireDataRootWriterLease } from "./data_root_writer_lease.js";
import {
  activateTaskAggregateSqliteCutover,
  prepareTaskAggregateSqliteCutover,
} from "./task_aggregate_sqlite_cutover.js";
import {
  assertCanonicalAgentPermissionSettings,
  assertCanonicalAgentSettings,
  prepareSettingsGrantsTrustSqliteCutover,
} from "./settings_grants_trust_sqlite_cutover.js";
import { handleDocumentCapabilityRoute } from "./routes/document_capability_routes.js";
import { handleMaintainerRoute } from "./routes/maintainer_routes.js";
import { runMaintainerMigrationAgent } from "./maintainer_migration_agent.js";
import { stopPendingSingleTaskRun } from "./single_task_run_projection.js";
import { GeneralAgentRunCoordinator } from "./general_agent_runs.js";
import { ProjectTaskRunCoordinator } from "./application/project_task_run_coordinator.js";
import { SupervisorGeneralWorkerSessionAuthority } from "./general_worker_runtime.js";
import {
  SupervisorCatWorkerSessionAuthority,
  finalizeCatWorkerSessionPlan,
  type CatWorkerSessionCreation,
  type CatWorkerSessionPlanV1,
} from "./cat_worker_runtime.js";
import { NodeJsonlRunWorkerProcessAdapter, RunWorkerSupervisor } from "./run_worker_supervisor.js";
import { resolvePiAgentDir, resolveServerRepoRoot } from "./server_root.js";
import { TaskMessageQueueCoordinator } from "./task_message_queue.js";
import { createTaskExtensionInteractionHost } from "./task_extension_interactions.js";
import { reconcileInterruptedTaskExtensionInteractions } from "./task_extension_reconciliation.js";
import {
  composeTeamRunResourceManifest,
  invalidateTaskRunResourceCache,
  resolveTaskRunResources,
  serverOwnedRunDisabledTools,
} from "./task_run_resources.js";
import { bindVerifiedPiSubagentBinary } from "./verified_pi_binary.js";
import { resolveTeamChildPackageExecution } from "./team_child_rpc_adapter.js";
import { startWorkflowTeamChildRpc } from "./workflow_team_child_rpc.js";
import { handleVoiceRoute } from "./routes/voice_routes.js";
import { buildTagTokenContract } from "./tag_token_contract.js";
import { ambientCredentialStatusForProvider, apiKeyEnvVarsForProvider, buildKeychainCredentialCommand, keychainServiceForProvider, readKeychainGenericPassword, sanitizeProviderScopedEnv, writeKeychainGenericPassword } from "./keychain_credentials.js";
import { handlePiSettingsRoute } from "./routes/pi_settings_routes.js";
import {
  mergeCustomModelConfig,
  mergeCustomModelProviderConfig,
  type CustomModelsDocument,
} from "./customModelsDocument.js";
import { PI_SETTING_DEFINITIONS, findProjectRawGlobalOnlySettings, validatePiSettingDefinitionValue, type PiSettingDefinition } from "./piSettingsDefinitions.js";
import {
  readPiTrustStatus,
  writePiTrustDecision,
  type PiDefaultProjectTrust,
  type PiTrustDecision,
} from "./pi_trust.js";
import {
  buildPiPackageResourceVisibility,
  buildPiPackagesCatalog,
  deletePiPackageEntry,
  togglePiPackageResource,
  upsertPiPackageEntry,
  type PiPackageInput,
} from "./pi_packages.js";
import {
  applyTaskPackageProfile,
  mergeTaskPackageIsolatedResources,
  previewTaskPackageProfile,
  readTaskPackageProfile,
  resolveTaskPackageRunResources,
  TaskPackageProfileError,
  type TaskPackageExecutableApproval,
  type TaskPackageSelection,
} from "./task_package_profile.js";
import { previewPiPackageAction, runPiPackageAction, type PiPackageActionInput } from "./pi_package_executor.js";
import {
  buildPiKeybindingsCatalog,
  upsertPiKeybindingAction,
} from "./pi_keybindings.js";
import {
  readNotificationPreferences,
  writeNotificationPreferences,
} from "./notification_preferences.js";
import {
  buildPiThemesCatalog,
  writePiThemeFile,
} from "./pi_themes.js";
import {
  buildPiSessionsCatalog,
  clonePiSessionBranch,
  deletePiSession,
  exportPiSession,
  readPiSessionEntries,
  readPiSessionTree,
  renamePiSession,
  sharePiSession,
  validatePiSessionBranchTarget,
  type PiSessionExportFormat,
  type PiSessionBranchOperation,
  type PiSessionScope,
  type PiSessionSurface,
} from "./pi_sessions.js";
import { createPiAuthLoginCoordinator, logoutPiProviderAuth } from "./pi_auth_login.js";
import { getPiCredentialStore, getPiModelRuntime } from "./pi_model_runtime.js";
import { piProviderUsesOAuth } from "./pi_provider_auth.js";
import { handleUploadImportRoute } from "./routes/upload_import_route.js";
import { ActiveAgentRunRegistry, ActiveAgentRunResourceMutationError } from "./active_agent_runs.js";
import { readResidentRuntimeStatus, runResidentRuntimeAction, type ResidentRuntimeAction } from "./resident_runtime.js";
import { createPermissionDecisionRegistry } from "./permission_decisions.js";
import { readPiUsageParityCatalog } from "./pi_usage.js";
import { compactSessionTitle, generateAgentTitle } from "./session_titles.js";
import { createTaskAutoTitleCoordinator, syncExistingPiSessionTitle } from "./task_auto_title.js";
import {
  DEFAULT_LOCAL_BODY_BYTES,
  LOCAL_TRANSPORT_KEYCHAIN_SERVICE,
  LocalTransportError,
  createLocalTransportSecurity,
  resolveLocalTransportToken,
} from "./local_transport_security.js";
import { externalApiRequestSchema, readStrictApiJsonBody, StrictApiInputError } from "./strict_api_contract.js";
import { buildRuntimeHandshake, runtimeInstanceId } from "./runtime_compatibility.js";
import {
  createRuntimeRendezvous,
  deriveRuntimeSessionCredential,
  prepareRuntimeTransportRoot,
  publishRuntimeRendezvous,
  randomRuntimeSocketPath,
  runtimeTransportPaths,
  secureRuntimeSocket,
} from "./local_transport_rendezvous.js";

const sourceRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const repoRoot = resolveServerRepoRoot({ sourceRoot: sourceRepoRoot, env: process.env });
const piAgentDirOverride = resolvePiAgentDir({ env: process.env });
const piAuthLoginCoordinator = createPiAuthLoginCoordinator();
const piRuntimeVersion = readPinnedDependencyVersion("@earendil-works/pi-coding-agent");
const productVersion = readProductVersion();
const dataRootWriterLease = await acquireDataRootWriterLease(repoRoot, { productVersion });
let lapkgPackageStorage: LapkgPackageStorage | undefined;
let assistantMemoryStore: AssistantMemoryPersistence | undefined;
let assistantLibraryStore: LibraryPersistence | undefined;
let catCoreStorage: { close(): void } | undefined;
let catGovernanceStorage: { close(): void } | undefined;
let workflowEvalStorage: { close(): void } | undefined;
const legacyLoopbackTransport = process.env.LA_LOCAL_TRANSPORT_MODE === "loopback" || process.env.LA_SERVER_PORT !== undefined;
const port = Number(process.env.LA_SERVER_PORT ?? 8787);
const uploadMaxBytes = Number(process.env.LA_UPLOAD_MAX_BYTES ?? 100 * 1024 * 1024);
const configuredLocalBodyMaxBytes = Number(process.env.LA_LOCAL_BODY_MAX_BYTES ?? DEFAULT_LOCAL_BODY_BYTES);
const localBodyMaxBytes = Number.isFinite(configuredLocalBodyMaxBytes) && configuredLocalBodyMaxBytes > 0
  ? configuredLocalBodyMaxBytes
  : DEFAULT_LOCAL_BODY_BYTES;
const builtinModelCatalog = builtinModels();
const localTransportToken = await resolveLocalTransportToken({
  // Ad-hoc local builds cannot rely on an interactive Keychain ACL prompt.
  // Trust only the system `security` client used by both the native app and
  // the server; provider API-key items keep their stricter default ACL.
  readKeychain: () => readKeychainGenericPassword({
    service: LOCAL_TRANSPORT_KEYCHAIN_SERVICE,
    interactionNotAllowedAsMissing: true,
  }),
  writeKeychain: (password) => writeKeychainGenericPassword({
    service: LOCAL_TRANSPORT_KEYCHAIN_SERVICE,
    password,
    trustedApplicationPaths: ["/usr/bin/security"],
  }),
});
const unixTransportPaths = runtimeTransportPaths(process.env.LA_RUNTIME_TRANSPORT_ROOT);
const runtimeRendezvous = legacyLoopbackTransport ? undefined : createRuntimeRendezvous({
  bootstrapToken: localTransportToken,
  runtimeInstanceId: runtimeInstanceId(repoRoot),
  socketPath: randomRuntimeSocketPath(unixTransportPaths.root),
});
const localTransportSecurity = createLocalTransportSecurity({
  token: runtimeRendezvous
    ? deriveRuntimeSessionCredential(localTransportToken, runtimeRendezvous)
    : localTransportToken,
  publicHealth: legacyLoopbackTransport,
  allowedOrigins: (process.env.LA_LOCAL_ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean),
});
const runtimeHandshake = buildRuntimeHandshake({
  repoRoot,
  productVersion,
  piVersion: piRuntimeVersion,
  dataSchemaVersion: RUNTIME_DATA_SCHEMA_VERSION,
  capabilities: [
    "local-auth",
    "authenticated-unix-rendezvous-v1",
    "native-extension-ui-v1",
    "run-resource-profile-v1",
    "task-package-profile-v1",
    "runtime-compatibility",
    "runtime-migrations",
    "task-workspace-v2",
  ],
});

function readPinnedDependencyVersion(packageName: string): string {
  try {
    const rootPackage = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return rootPackage.dependencies?.[packageName] ?? rootPackage.devDependencies?.[packageName] ?? "missing";
  } catch {
    return "unknown";
  }
}

function readProductVersion(): string {
  try {
    return (JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { version?: string }).version ?? "unknown";
  } catch {
    return "unknown";
  }
}

// Read a YAML-frontmatter field (name/description) from a SKILL.md, without a YAML dep.
function frontmatterField(md: string, field: string): string | undefined {
  const fm = /^---\s*\n([\s\S]*?)\n---/.exec(md);
  if (!fm) return undefined;
  const line = new RegExp(`^${field}\\s*:\\s*(.+)$`, "m").exec(fm[1]);
  return line?.[1]?.trim().replace(/^["']|["']$/g, "");
}

interface AgentSkill {
  name: string;
  description: string;
  path: string;
  group: "cat" | "other";
}

// List the REAL skills on disk (.pi/skills/<name>/SKILL.md) — replaces the old hardcoded
// 4-item list. Pi auto-merges these into the system prompt at session start.
async function listAgentSkills(): Promise<AgentSkill[]> {
  const skillsDir = join(repoRoot, ".pi", "skills");
  let entries: string[];
  try {
    entries = (await readdir(skillsDir, { withFileTypes: true })).filter((e) => e.isDirectory() || e.isSymbolicLink()).map((e) => e.name);
  } catch {
    return [];
  }
  const skills: AgentSkill[] = [];
  for (const name of entries.sort()) {
    try {
      const md = await readFile(join(skillsDir, name, "SKILL.md"), "utf8");
      skills.push({
        name: frontmatterField(md, "name") ?? name,
        description: frontmatterField(md, "description") ?? "",
        path: `.pi/skills/${name}/`,
        group: name.startsWith("cat-") ? "cat" : "other",
      });
    } catch {
      // no SKILL.md → skip silently
    }
  }
  return skills;
}

async function listAgentPrompts(): Promise<Array<{ name: string; path: string }>> {
  const dir = join(repoRoot, ".pi", "prompts");
  try {
    return (await readdir(dir)).filter((f) => f.endsWith(".md")).sort().map((f) => ({ name: `/${f.replace(/\.md$/, "")}`, path: `.pi/prompts/${f}` }));
  } catch {
    return [];
  }
}

interface ChatEvent {
  ts: string;
  kind: "user" | "assistant" | "tool" | "system" | "error";
  text: string;
  sessionId?: string;
  sessionFile?: string;
  /** Links a tool chat line back to its Pi tool call (present on kind "tool"). */
  toolCallId?: string;
  usage?: { inputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; outputTokens?: number; totalTokens?: number; costUsd?: number; modelCalls?: number };
}

interface StreamEvent {
  type:
    | "turn_start"
    | "user"
    | "assistant_delta"
    | "assistant_thinking_started"
    | "assistant_final"
    | "tool_start"
    | "tool_end"
    | "compaction_start"
    | "compaction_end"
    | "retry_start"
    | "retry_end"
    | "stream_rule_violation"
    | "sandbox_denied"
    | "permission_request"
    | "queue_update"
    | "stopped"
    | "error"
    | "done";
  ts: string;
  turnId?: string;
  sessionId?: string;
  sessionFile?: string;
  text?: string;
  toolCallId?: string;
  toolName?: string;
  argsPreview?: string;
  resultPreview?: string;
  isError?: boolean;
  errorMessage?: string;
  validationWarnings?: string[];
  validationErrors?: string[];
  reason?: string;
  tokensBefore?: number;
  estimatedTokensAfter?: number;
  firstKeptEntryId?: string;
  aborted?: boolean;
  willRetry?: boolean;
  retryAttempt?: number;
  retryMaxAttempts?: number;
  retrySuccess?: boolean;
  recoveryKind?: string;
  recoveryAction?: string;
  recoveryRetryable?: boolean;
  ruleCode?: string;
  ruleSeverity?: "warning" | "blocker";
  ruleAction?: "observe_only" | "abort_and_retry";
  ruleMatch?: string;
  ruleOffset?: number;
  permissionRequest?: AgentPermissionRequest & { requestId: string; createdAt: string; expiresAt: string };
  messageQueue?: TaskMessageQueue;
  chat?: ChatEvent[];
  usage?: ChatEvent["usage"];
}

// Agent runs against the same chat scope are serialized: concurrent runs raced
// on the durable Pi session file and on chat.json's read-modify-write (last
// writer wins, dropping the loser's messages). Keyed per project, so distinct
// projects still run in parallel. A
// queued run simply starts later: its SSE stream stays quiet until the prior
// run's turn completes.
const agentRunQueue = createKeyedSerialQueue();
const permissionDecisionRegistry = createPermissionDecisionRegistry();
const activeAgentRuns = new ActiveAgentRunRegistry();
const taskMessageQueue = new TaskMessageQueueCoordinator(repoRoot);
const serverSourceExtension = extname(fileURLToPath(import.meta.url));
const generalWorkerRuntime = new SupervisorGeneralWorkerSessionAuthority(new RunWorkerSupervisor(
  new NodeJsonlRunWorkerProcessAdapter({
    entryPath: join(dirname(fileURLToPath(import.meta.url)), `general_run_worker_entry${serverSourceExtension}`),
    cwd: repoRoot,
    env: process.env,
    nodeArgs: serverSourceExtension === ".ts" ? ["--import", "tsx"] : [],
  }),
  { readyTimeoutMs: 120_000, heartbeatTimeoutMs: 15_000, cancelGraceMs: 8_000 },
));
const catWorkerRuntime = new SupervisorCatWorkerSessionAuthority(new RunWorkerSupervisor(
  new NodeJsonlRunWorkerProcessAdapter({
    entryPath: join(dirname(fileURLToPath(import.meta.url)), `cat_run_worker_entry${serverSourceExtension}`),
    cwd: repoRoot,
    env: process.env,
    nodeArgs: serverSourceExtension === ".ts" ? ["--import", "tsx"] : [],
  }),
  { readyTimeoutMs: 120_000, heartbeatTimeoutMs: 15_000, cancelGraceMs: 8_000 },
));

/**
 * Supporting CAT operations also cross the Worker boundary. They are
 * not canonical Task Runs, so their attested ExecutionSnapshot has no durable
 * Task owner; the caller remains responsible for its existing durable result.
 */
async function createCatWorkerSupportSession(plan: CatWorkerSessionPlanV1, operation: string): Promise<CatWorkerSessionCreation> {
  const effectivePlan = plan.memoryRecall === undefined
    ? finalizeCatWorkerSessionPlan({
        ...plan,
        memoryRecall: plan.workspace.projectId && assistantMemoryStore
          ? await confirmedMemoryRecallForCat(plan.workspace.projectId)
          : "",
      })
    : plan;
  const createdAt = new Date().toISOString();
  return catWorkerRuntime.createSession({
    plan: effectivePlan,
    executionIdentity: {
      executionId: `${effectivePlan.runId}.execution.1`,
      threadId: `${effectivePlan.runId}.support`,
      turnId: effectivePlan.runId,
      runtimeEpochId: `${effectivePlan.runId}.epoch.1`,
      configRevision: 1,
      executionProfile: null,
      createdAt,
    },
    persistExecutionSnapshot: async () => undefined,
    requestPermissionDecision: async () => ({ action: "deny", reason: `${operation} has no interactive tool authority.` }),
    executeServerTool: async () => { throw new Error(`${operation} has no server tools.`); },
    requestUi: async () => { throw new Error(`${operation} has no Extension UI.`); },
    notifyUi: () => undefined,
    libraryPersistence: assistantLibraryStore,
  });
}
const activeTaskSessionManagers = new Map<string, SessionManager>();
let legacyHomeReplacementTaskId: string | undefined;

function assistantMessageError(message: unknown): string | undefined {
  const assistant = message as { role?: string; stopReason?: string; errorMessage?: string } | undefined;
  if (!assistant || assistant.role !== "assistant") return undefined;
  if (assistant.stopReason !== "error" && assistant.stopReason !== "aborted") return undefined;
  const errorMessage = assistant.errorMessage?.trim();
  return errorMessage || `Request ${assistant.stopReason}`;
}

function assistantMessageUsage(message: unknown): ChatEvent["usage"] {
  const usage = (message as { role?: string; usage?: { input?: unknown; cacheRead?: unknown; cacheWrite?: unknown; output?: unknown; totalTokens?: unknown; cost?: { total?: unknown } } } | undefined)?.usage;
  if (!usage) return undefined;
  const number = (value: unknown): number | undefined => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  };
  return {
    inputTokens: number(usage.input),
    cacheReadTokens: number(usage.cacheRead),
    cacheWriteTokens: number(usage.cacheWrite),
    outputTokens: number(usage.output),
    totalTokens: number(usage.totalTokens),
    costUsd: number(usage.cost?.total),
    modelCalls: 1,
  };
}

function json(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
  });
  res.end(body);
}

function text(res: ServerResponse, status: number, value: string, contentType = "text/plain; charset=utf-8"): void {
  res.writeHead(status, {
    "content-type": contentType,
  });
  res.end(value);
}

function markdown(res: ServerResponse, status: number, value: string, fileName?: string): void {
  const headers: Record<string, string> = {
    "content-type": "text/markdown; charset=utf-8",
  };
  if (fileName) {
    const safeName = fileName.replace(/[^A-Za-z0-9_.-]+/g, "_") || "proposal-report.md";
    headers["content-disposition"] = `attachment; filename="${safeName}"`;
  }
  res.writeHead(status, headers);
  res.end(value);
}

function sseHeaders(res: ServerResponse): void {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
}

function writeSse(res: ServerResponse, event: StreamEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const maxBytes = req.url?.startsWith("/api/projects/import-upload")
    ? Math.ceil(uploadMaxBytes * 4 / 3) + 1024 * 1024
    : localBodyMaxBytes;
  return readStrictApiJsonBody(req, {
    contentType: req.headers["content-type"],
    maxBytes,
    schema: externalApiRequestSchema,
  });
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error("Optional string input must be a string.");
  const normalized = value.trim();
  return normalized || undefined;
}

function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error("Optional string array input must be an array of strings.");
  }
  return value;
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw new Error("Optional boolean input must be a boolean.");
  return value;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Optional numeric input must be a finite number.");
  return value;
}

function legacyGlobalDataPath(...parts: string[]): string {
  return join(repoRoot, "data", "assistant", ...parts);
}

function globalSessionControlPath(): string {
  return legacyGlobalDataPath("agent_selected_session.json");
}

function agentTracePath(projectId: string): string {
  return workspacePath(createWorkspace(repoRoot, projectId), "agent_events.jsonl");
}

function agentSessionControlPath(projectId: string): string {
  return workspacePath(createWorkspace(repoRoot, projectId), "agent_session_control.json");
}

// Multi-session: which Pi session the web workspace is currently viewing/driving.
// Defaults to the deterministic project session. Persisted so switches survive reload.
function agentSelectedSessionPath(projectId: string): string {
  return workspacePath(createWorkspace(repoRoot, projectId), "agent_selected_session.json");
}

interface SelectedSessionControl {
  selectedSessionId?: string;
  selectedAt?: string;
  pendingBranchEntryId?: string;
  pendingBranchSetAt?: string;
}

async function resolveSelectedSessionId(projectId: string): Promise<string> {
  const fallback = catAgentProjectSessionId(createWorkspace(repoRoot, projectId));
  const control = await readJsonFile<SelectedSessionControl>(agentSelectedSessionPath(projectId), {});
  // Honor the selection even if the session file doesn't exist yet — a brand-new session
  // only materializes on its first turn (openOrCreateSessionById). Falling back here would
  // make "new session" silently snap back to the project session.
  return control.selectedSessionId || fallback;
}

async function resolveSelectedGlobalSessionId(): Promise<string> {
  const control = await readJsonFile<SelectedSessionControl>(globalSessionControlPath(), {});
  return control.selectedSessionId || "la-assistant-global";
}

async function setSelectedSessionId(projectId: string, sessionId: string): Promise<{ selectedSessionId: string }> {
  const path = agentSelectedSessionPath(projectId);
  await writeJsonFile(path, { selectedSessionId: sessionId, selectedAt: new Date().toISOString() }, { durability: "critical" });
  return { selectedSessionId: sessionId };
}

async function setSelectedGlobalSessionId(sessionId: string): Promise<{ selectedSessionId: string }> {
  const path = globalSessionControlPath();
  await writeJsonFile(path, { selectedSessionId: sessionId, selectedAt: new Date().toISOString() }, { durability: "critical" });
  return { selectedSessionId: sessionId };
}

async function readSelectedSessionControl(path: string): Promise<SelectedSessionControl> {
  return readJsonFile<SelectedSessionControl>(path, {});
}

async function writeSelectedSessionControl(path: string, control: SelectedSessionControl): Promise<void> {
  await writeJsonFile(path, control, { durability: "critical" });
}

async function setProjectPendingBranchEntry(projectId: string, sessionId: string, entryId: string): Promise<void> {
  const path = agentSelectedSessionPath(projectId);
  const control = await readSelectedSessionControl(path);
  await writeSelectedSessionControl(path, {
    ...control,
    selectedSessionId: sessionId,
    selectedAt: control.selectedAt ?? new Date().toISOString(),
    pendingBranchEntryId: entryId,
    pendingBranchSetAt: new Date().toISOString(),
  });
}

async function setGlobalPendingBranchEntry(sessionId: string, entryId: string): Promise<void> {
  const path = globalSessionControlPath();
  const control = await readSelectedSessionControl(path);
  await writeSelectedSessionControl(path, {
    ...control,
    selectedSessionId: sessionId,
    selectedAt: control.selectedAt ?? new Date().toISOString(),
    pendingBranchEntryId: entryId,
    pendingBranchSetAt: new Date().toISOString(),
  });
}

async function consumeProjectPendingBranchEntry(projectId: string, sessionId: string): Promise<string | undefined> {
  const path = agentSelectedSessionPath(projectId);
  const control = await readSelectedSessionControl(path);
  if (control.selectedSessionId && control.selectedSessionId !== sessionId) return undefined;
  const entryId = control.pendingBranchEntryId;
  if (!entryId) return undefined;
  const { pendingBranchEntryId: _pending, pendingBranchSetAt: _pendingAt, ...next } = control;
  await writeSelectedSessionControl(path, next);
  return entryId;
}

// Runtime-settable agent settings persisted per project. disabledTools remains
// readable for legacy clients/data, but canonical Main/Team/Eval profiles ignore
// it and use the server-owned profile plus fixed denylist.
interface AgentSettings {
  modelProvider?: string;
  modelId?: string;
  thinkingLevel?: PiThinkingLevel;
  disabledTools?: string[];
  disabledSkills?: string[];
  permissionMode?: AgentPermissionMode;
  permissionRules?: AgentPermissionRules;
  teamRoleSettings?: TeamRoleSettings;
}

type PiThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

interface ModelDefaults {
  defaultProvider?: string;
  defaultModel?: string;
  defaultThinkingLevel?: PiThinkingLevel;
  effectiveProvider?: string;
  effectiveModel?: string;
  effectiveThinkingLevel?: PiThinkingLevel;
  source: {
    piSettingsPath: string;
    provider: "env" | "global" | "project" | "unset";
    model: "env" | "global" | "project" | "unset";
    thinkingLevel: "env" | "global" | "project" | "unset";
  };
}

function agentSettingsPath(projectId: string): string {
  return workspacePath(createWorkspace(repoRoot, projectId), "agent_settings.json");
}

function agentSettingsStorageAddress(projectId: string) {
  return { domain: "settings" as const, key: `agent:${projectId}`, scope: `project:${projectId}` };
}

async function readAgentSettings(projectId: string): Promise<AgentSettings> {
  const backend = resolveStructuredStorageBackend(repoRoot);
  const stored = backend?.read(agentSettingsStorageAddress(projectId));
  if (stored) return stored.payload as AgentSettings;
  if (backend) return {};
  return readJsonFile<AgentSettings>(agentSettingsPath(projectId), {});
}

async function writeAgentSettings(projectId: string, patch: Partial<AgentSettings>): Promise<AgentSettings> {
  const current = await readAgentSettings(projectId);
  const next: AgentSettings = { ...current, ...patch };
  assertCanonicalAgentSettings(next, `project ${projectId} agent settings`);
  const backend = resolveStructuredStorageBackend(repoRoot);
  const stored = backend?.read(agentSettingsStorageAddress(projectId));
  if (backend) {
    await backend.write({
      address: agentSettingsStorageAddress(projectId),
      expectedRevision: stored?.revision ?? 0,
      expectedValue: stored?.payload ?? {},
      value: next as unknown as Record<string, unknown>,
    });
    return next;
  }
  const path = agentSettingsPath(projectId);
  await writeJsonFile(path, next, { durability: "critical" });
  return next;
}

function globalAgentPermissionSettingsPath(): string {
  return join(repoRoot, "data", "runtime", "agent_permissions.json");
}

async function readGlobalAgentPermissionSettings(): Promise<AgentPermissionSettings> {
  const address = { domain: "settings" as const, key: "agent-permissions", scope: "global" };
  const backend = resolveStructuredStorageBackend(repoRoot);
  const raw = backend?.read(address)?.payload
    ?? (backend ? {} : await readJsonFile<Record<string, unknown>>(globalAgentPermissionSettingsPath(), {}));
  return {
    permissionMode: raw.permissionMode === undefined ? "ask" : normalizeAgentPermissionMode(raw.permissionMode),
    permissionRules: normalizeAgentPermissionRules(raw.permissionRules),
  };
}

async function writeGlobalAgentPermissionSettings(patch: AgentPermissionSettings): Promise<AgentPermissionSettings> {
  const current = await readGlobalAgentPermissionSettings();
  const next = { ...current, ...patch };
  assertCanonicalAgentPermissionSettings(next);
  const address = { domain: "settings" as const, key: "agent-permissions", scope: "global" };
  const backend = resolveStructuredStorageBackend(repoRoot);
  const stored = backend?.read(address);
  if (backend) {
    await backend.write({
      address,
      expectedRevision: stored?.revision ?? 0,
      expectedValue: stored?.payload ?? {},
      value: next as unknown as Record<string, unknown>,
    });
    await appendPiSettingsAudit({ scope: "global", path: "agent.permissions", mode: "permission-policy", restartRequired: false });
    return next;
  }
  const path = globalAgentPermissionSettingsPath();
  await writeJsonFile(path, next, { durability: "critical" });
  await appendPiSettingsAudit({ scope: "global", path: "agent.permissions", mode: "permission-policy", restartRequired: false });
  return next;
}

async function readEffectiveAgentPermissionSettings(projectId?: string): Promise<AgentPermissionSettings> {
  const global = await readGlobalAgentPermissionSettings();
  if (!projectId) return global;
  const project = await readAgentSettings(projectId);
  return {
    permissionMode: project.permissionMode ?? (project.permissionRules ? "custom" : global.permissionMode),
    permissionRules: {
      ...(global.permissionRules ?? {}),
      ...(project.permissionRules ?? {}),
    },
  };
}

async function writeProjectAgentPermissionSettings(projectId: string, patch: AgentPermissionSettings): Promise<AgentPermissionSettings> {
  const next = await writeAgentSettings(projectId, patch);
  await appendPiSettingsAudit({ scope: "project", path: `projects.${projectId}.agent.permissions`, mode: "permission-policy", restartRequired: false });
  return {
    permissionMode: next.permissionMode,
    permissionRules: next.permissionRules,
  };
}

async function readAgentPermissionContract(projectId?: string): Promise<AgentPermissionContract> {
  const settings = await readEffectiveAgentPermissionSettings(projectId);
  return buildAgentPermissionContract({
    mode: settings.permissionMode ?? "auto",
    customRules: settings.permissionRules,
  });
}

async function readGeneralAgentPermissionContract(): Promise<AgentPermissionContract> {
  const address = { domain: "settings" as const, key: "agent-permissions", scope: "global" };
  const backend = resolveStructuredStorageBackend(repoRoot);
  const raw = backend?.read(address)?.payload
    ?? (backend ? {} : await readJsonFile<Record<string, unknown>>(globalAgentPermissionSettingsPath(), {}));
  return buildAgentPermissionContract({
    mode: raw.permissionMode === undefined ? "ask" : normalizeAgentPermissionMode(raw.permissionMode),
    customRules: normalizeAgentPermissionRules(raw.permissionRules),
  });
}

async function persistPermissionDecision(
  request: AgentPermissionRequest,
  action: AgentPermissionAction,
  reason?: string,
): Promise<void> {
  if (action !== "always_allow") return;
  if (request.kind !== "tool") throw new TaskWorkspaceConflictError("Pi resource trust uses its exact summary/path trust mechanism, not Always allow.");
  const editableDomains = new Set(["fileRead", "fileWrite", "webRead", "bash", "bridge"]);
  if (!editableDomains.has(request.domain)) throw new TaskWorkspaceConflictError(`Permission domain ${request.domain} is server-locked.`);
  const current = await readEffectiveAgentPermissionSettings(request.projectId);
  const currentContract = buildAgentPermissionContract({
    mode: current.permissionMode ?? "auto",
    customRules: current.permissionRules,
  });
  const rules = normalizeAgentPermissionRules({
    ...Object.fromEntries(currentContract.effectivePolicy
      .filter((entry) => editableDomains.has(entry.domain))
      .map((entry) => [entry.domain, entry.decision])),
    [request.domain]: "auto",
  });
  const patch: AgentPermissionSettings = { permissionMode: "custom", permissionRules: rules };
  if (request.projectId) await writeProjectAgentPermissionSettings(request.projectId, patch);
  else await writeGlobalAgentPermissionSettings(patch);
  await appendPiSettingsAudit({
    scope: request.projectId ? "project" : "global",
    path: request.projectId ? `projects.${request.projectId}.agent.permissions.${request.domain}` : `agent.permissions.${request.domain}`,
    mode: "permission-decision",
    restartRequired: false,
    ...(reason ? { nextValue: { action, reason } } : {}),
  });
}

async function permissionDecisionForRequest(request: AgentPermissionRequest, emit?: (event: StreamEvent) => void): Promise<AgentPermissionUserDecision> {
  if (!emit) return { decision: "deny", reason: "permission approval requires a streaming client" };
  const pending = permissionDecisionRegistry.request({ kind: "tool", ...request });
  if (pending.autoApproved) return pending.decision;
  emit({
    type: "permission_request",
    ts: new Date().toISOString(),
    sessionId: pending.request.sessionId,
    permissionRequest: pending.request,
  });
  return pending.decision;
}

async function projectPermissionSessionOptions(projectId: string, emit?: (event: StreamEvent) => void, taskId?: string, runId?: string): Promise<{
  permissionContract: AgentPermissionContract;
  requestPermissionDecision: (request: AgentPermissionRequest) => Promise<AgentPermissionUserDecision>;
}> {
  return {
    permissionContract: await readAgentPermissionContract(projectId),
    requestPermissionDecision: (request) => permissionDecisionForRequest({
      ...request,
      projectId: request.projectId ?? projectId,
      ...(request.taskId ?? taskId ? { taskId: request.taskId ?? taskId } : {}),
      ...(request.runId ?? runId ? { runId: request.runId ?? runId } : {}),
    }, emit),
  };
}

function normalizeThinkingLevel(value: unknown): PiThinkingLevel | undefined {
  return value === "off" || value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh" || value === "max"
    ? value
    : undefined;
}

async function readModelDefaults(): Promise<ModelDefaults> {
  const [globalSettings, projectSettings] = await Promise.all([
    readJsonFile<Record<string, unknown>>(globalPiSettingsPath(), {}),
    readJsonFile<Record<string, unknown>>(projectPiSettingsPath(), {}),
  ]);
  const globalProvider = typeof globalSettings.defaultProvider === "string" ? globalSettings.defaultProvider : undefined;
  const globalModel = typeof globalSettings.defaultModel === "string" ? globalSettings.defaultModel : undefined;
  const projectProvider = typeof projectSettings.defaultProvider === "string" ? projectSettings.defaultProvider : undefined;
  const projectModel = typeof projectSettings.defaultModel === "string" ? projectSettings.defaultModel : undefined;
  // A person choosing a model in LA is a user preference, not a project-file
  // default.  Pi's project settings remain a safe bundled fallback only until
  // that user has selected a complete provider/model pair.
  const globalSelection = Boolean(globalProvider && globalModel);
  const projectSelection = Boolean(projectProvider && projectModel);
  const settingsProvider = globalSelection ? globalProvider : projectSelection ? projectProvider : undefined;
  const settingsModel = globalSelection ? globalModel : projectSelection ? projectModel : undefined;
  const selectionSource = globalSelection ? "global" as const : projectSelection ? "project" as const : "unset" as const;
  const settingsThinkingLevel = normalizeThinkingLevel(
    globalSelection
      ? globalSettings.defaultThinkingLevel
      : projectSelection
        ? projectSettings.defaultThinkingLevel
        : globalSettings.defaultThinkingLevel ?? projectSettings.defaultThinkingLevel,
  );
  const thinkingSource = normalizeThinkingLevel(globalSettings.defaultThinkingLevel)
    ? "global" as const
    : normalizeThinkingLevel(projectSettings.defaultThinkingLevel)
      ? "project" as const
      : "unset" as const;
  const envProvider = process.env.LA_MODEL_PROVIDER || undefined;
  const envModel = process.env.LA_MODEL_ID || undefined;
  const envThinkingLevel = normalizeThinkingLevel(process.env.LA_PI_THINKING_LEVEL);
  return {
    defaultProvider: settingsProvider,
    defaultModel: settingsModel,
    defaultThinkingLevel: settingsThinkingLevel,
    effectiveProvider: envProvider ?? settingsProvider,
    effectiveModel: envModel ?? settingsModel,
    effectiveThinkingLevel: envThinkingLevel ?? settingsThinkingLevel,
    source: {
      piSettingsPath: globalPiSettingsPath(),
      provider: envProvider ? "env" : settingsProvider ? selectionSource : "unset",
      model: envModel ? "env" : settingsModel ? selectionSource : "unset",
      thinkingLevel: envThinkingLevel ? "env" : settingsThinkingLevel ? thinkingSource : "unset",
    },
  };
}

async function writePiModelPreference(input: { provider: string; model: string; thinking?: string }) {
  const provider = input.provider.trim();
  const model = input.model.trim();
  if (!provider || !model) throw new Error("provider and model are required.");
  const thinking = input.thinking === undefined ? undefined : normalizeThinkingLevel(input.thinking);
  if (input.thinking !== undefined && !thinking) throw new Error("thinking must be a valid Pi thinking level.");
  const catalog = await readPiProviderCatalog();
  const selected = catalog.providers
    .find((entry) => entry.id === provider && entry.kind === "model")
    ?.models.find((entry) => entry.id === model);
  if (!selected?.available) throw new TaskWorkspaceConflictError(`Model ${provider}/${model} is not available for this runtime.`);

  const path = globalPiSettingsPath();
  const before = await readJsonFile<Record<string, unknown>>(path, {});
  const next = JSON.parse(JSON.stringify(before)) as Record<string, unknown>;
  next.defaultProvider = provider;
  next.defaultModel = model;
  if (thinking) next.defaultThinkingLevel = thinking;
  await writeJsonFile(path, next, { durability: "critical" });
  await appendPiSettingsAudit({
    scope: "global",
    path: "model-preference",
    mode: "current-model",
    restartRequired: false,
    previousValue: { provider: before.defaultProvider, model: before.defaultModel, thinking: before.defaultThinkingLevel },
    nextValue: { provider, model, ...(thinking ? { thinking } : {}) },
  });
  return readPiSettingsCatalog();
}

const generalAgentRuns = new GeneralAgentRunCoordinator({
  repoRoot,
  resolveManagedResources: async () => {
    if (!lapkgPackageStorage) throw new Error("Package SQLite storage is not ready.");
    return resolveActivatedLapkgResources(repoRoot, { storage: lapkgPackageStorage });
  },
  assistantMemoryStore: () => assistantMemoryStore,
  libraryPersistence: () => assistantLibraryStore,
  activeRuns: activeAgentRuns,
  messageQueue: taskMessageQueue,
  runtimePort: createPiAgentRuntimePort({ modelRuntime: getPiModelRuntime }),
  workerRuntime: generalWorkerRuntime,
  modelRoute: async () => {
    const defaults = await readModelDefaults();
    return {
      provider: defaults.effectiveProvider,
      modelId: defaults.effectiveModel,
      thinkingLevel: defaults.effectiveThinkingLevel,
      executionProfile: "balanced" as const,
    };
  },
  resolveModelRoute: async (route) => {
    const defaults = await readModelDefaults();
    const defaultRoute = defaults.effectiveProvider && defaults.effectiveModel
      ? {
        provider: defaults.effectiveProvider,
        modelId: defaults.effectiveModel,
        ...(defaults.effectiveThinkingLevel === undefined ? {} : { thinkingLevel: defaults.effectiveThinkingLevel }),
      }
      : undefined;
    const requestedProfile = route.executionProfile ?? "custom";
    const selectedRoute = requestedProfile === "custom"
      ? route.provider && route.modelId
        ? {
          provider: route.provider,
          modelId: route.modelId,
          ...(route.thinkingLevel === undefined ? {} : { thinkingLevel: route.thinkingLevel }),
        }
        : undefined
      : requestedProfile === "balanced"
        ? defaultRoute
        : undefined;
    if (!selectedRoute) {
      if (requestedProfile === "fast" || requestedProfile === "best") {
        throw new TaskWorkspaceConflictError(`${requestedProfile.slice(0, 1).toUpperCase()}${requestedProfile.slice(1)} ExecutionProfile is not configured for standalone Chats.`);
      }
      throw new TaskWorkspaceConflictError("No model is configured for this Chat Run.");
    }
    if (requestedProfile !== "custom" && route.provider && route.modelId
      && (route.provider !== selectedRoute.provider || route.modelId !== selectedRoute.modelId
        || route.thinkingLevel !== selectedRoute.thinkingLevel)) {
      throw new TaskWorkspaceConflictError("The requested ExecutionProfile no longer matches this immutable Run route; start a new Run from the current profile instead.");
    }
    const provider = selectedRoute.provider;
    const modelId = selectedRoute.modelId;
    const thinkingLevel = selectedRoute.thinkingLevel;
    const catalog = await readPiProviderCatalog();
    const model = catalog.providers
      .find((entry) => entry.id === provider && entry.kind === "model")
      ?.models.find((entry) => entry.id === modelId);
    if (!model?.available) {
      throw new TaskWorkspaceConflictError(`Model ${provider}/${modelId} is not available for this Chat Run.`);
    }
    const requestBudget = await resolveModelPromptTokenBudget(provider, modelId);
    if (!requestBudget) {
      throw new TaskWorkspaceConflictError(`Model ${provider}/${modelId} has no verified context/output budget for an ExecutionProfile.`);
    }
    const profilePlan = requestedProfile === "custom"
      ? planExecutionProfile({ explicitModel: selectedRoute, qualityRoutes: {}, requestBudget })
      : planExecutionProfile({ requestedProfile, qualityRoutes: { balanced: defaultRoute! }, requestBudget });
    return { provider, modelId, ...(thinkingLevel === undefined ? {} : { thinkingLevel }), executionProfile: profilePlan.profile, profilePlan };
  },
  permissionContract: () => readGeneralAgentPermissionContract(),
  defaultProjectTrust: () => readDefaultProjectTrust(),
    requestPermissionDecision: async (request, onPending) => {
    const pending = permissionDecisionRegistry.request({ kind: "tool", ...request });
    if (pending.autoApproved) return pending.decision;
    onPending(pending.request);
    return pending.decision;
  },
  cancelPermissionDecisions: (sessionId, reason) => permissionDecisionRegistry.cancelForSession(sessionId, reason),
});

async function projectPromptModelForProject(projectId: string): Promise<{
  assistantModel: string;
  askPrompt: (prompt: string) => Promise<string>;
} | undefined> {
  const agentSettings = await readAgentSettings(projectId);
  const modelDefaults = await readModelDefaults();
  const modelProvider = agentSettings.modelProvider ?? modelDefaults.effectiveProvider;
  const modelId = agentSettings.modelId ?? modelDefaults.effectiveModel;
  const thinkingLevel = agentSettings.thinkingLevel ?? modelDefaults.effectiveThinkingLevel;
  if (!modelProvider || !modelId) return undefined;

  const modelRuntime = await getPiModelRuntime();
  const authStatus = (() => {
    try {
      return modelRuntime.getProviderAuthStatus(modelProvider) as { configured?: boolean };
    } catch {
      return undefined;
    }
  })();
  if (!authStatus?.configured) return undefined;

  return {
    assistantModel: `${modelProvider}/${modelId}`,
    askPrompt: async (prompt) => {
      const workspace = createWorkspace(repoRoot, projectId);
      const operationId = `project-prompt-${randomUUID()}`;
      const created = await createCatWorkerSupportSession(finalizeCatWorkerSessionPlan({
        schemaVersion: 1,
        profile: "cat",
        runtimeRoot: repoRoot,
        workspace: { root: workspace.root, projectId: workspace.projectId },
        taskId: null,
        runId: operationId,
        modelProvider,
        modelId,
        thinkingLevel: thinkingLevel ?? null,
        sessionMode: "memory",
        sessionId: null,
        branchEntryId: null,
        preset: "scratch",
        disabledTools: [],
        runOptions: null,
        isolatedResources: {},
        runtimeExtension: true,
        permissionContract: null,
        serverTools: [],
        extensionBinding: false,
      }), "Project prompt helper");
      const { session } = created;
      const assistantParts: string[] = [];
      let assistantEndError: string | undefined;
      try {
        session.subscribe((event) => {
          if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
            assistantParts.push(event.assistantMessageEvent.delta);
          }
          if (event.type === "message_end") {
            assistantEndError = assistantMessageError(event.message) ?? assistantEndError;
          }
        });
        await session.prompt(prompt);
        if (assistantEndError) throw new Error(assistantEndError);
        return assistantParts.join("").trim();
      } finally {
        await created.dispose();
      }
    },
  };
}

async function askTagRuleModelForProject(projectId: string): Promise<{
  askModel: AskTagRuleModel;
  assistantModel?: string;
} | undefined> {
  const model = await projectPromptModelForProject(projectId);
  return model
    ? {
        assistantModel: model.assistantModel,
        askModel: ({ prompt }) => model.askPrompt(prompt),
      }
    : undefined;
}

async function askAssetMappingModelForProject(projectId: string): Promise<{
  askModel: AskAssetMappingModel;
  assistantModel?: string;
} | undefined> {
  const model = await projectPromptModelForProject(projectId);
  return model
    ? {
        assistantModel: model.assistantModel,
        askModel: ({ prompt }) => model.askPrompt(prompt),
      }
    : undefined;
}

type PiSettingScope = "global" | "project";

interface PiSettingsAuditEntry {
  id: string;
  ts: string;
  scope: PiSettingScope | "global";
  path: string;
  unset?: boolean;
  mode?: string;
  restartRequired?: boolean;
  sensitive?: boolean;
  previousValue?: unknown;
  previousValuePresent?: boolean;
  nextValue?: unknown;
  nextValuePresent?: boolean;
}

function globalPiSettingsPath(): string {
  return join(homedir(), ".pi", "agent", "settings.json");
}

function globalPiKeybindingsPath(): string {
  return join(homedir(), ".pi", "agent", "keybindings.json");
}

function globalPiThemesDir(): string {
  return join(homedir(), ".pi", "agent", "themes");
}

function projectPiSettingsPath(): string {
  return join(repoRoot, ".pi", "settings.json");
}

function projectPiThemesDir(): string {
  return join(repoRoot, ".pi", "themes");
}

async function readDefaultProjectTrust(): Promise<PiDefaultProjectTrust> {
  const settings = await readJsonFile<Record<string, unknown>>(globalPiSettingsPath(), {});
  const value = settings.defaultProjectTrust;
  return value === "always" || value === "never" || value === "ask" ? value : "ask";
}

function deepMergeSettings(a: unknown, b: unknown): unknown {
  if (!a || typeof a !== "object" || Array.isArray(a)) return b === undefined ? a : b;
  if (!b || typeof b !== "object" || Array.isArray(b)) return b === undefined ? a : b;
  const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
  for (const [key, value] of Object.entries(b as Record<string, unknown>)) {
    out[key] = deepMergeSettings(out[key], value);
  }
  return out;
}

function getPathValue(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((cur, key) => (cur && typeof cur === "object" ? (cur as Record<string, unknown>)[key] : undefined), obj);
}

function setPathValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur: Record<string, unknown> = obj;
  for (const part of parts.slice(0, -1)) {
    const next = cur[part];
    if (!next || typeof next !== "object" || Array.isArray(next)) cur[part] = {};
    cur = cur[part] as Record<string, unknown>;
  }
  cur[parts.at(-1) ?? path] = value;
}

function unsetPathValue(obj: Record<string, unknown>, path: string): void {
  const parts = path.split(".");
  let cur: Record<string, unknown> = obj;
  for (const part of parts.slice(0, -1)) {
    const next = cur[part];
    if (!next || typeof next !== "object" || Array.isArray(next)) return;
    cur = next as Record<string, unknown>;
  }
  delete cur[parts.at(-1) ?? path];
}

function validatePiSettingValue(def: PiSettingDefinition, value: unknown): void {
  validatePiSettingDefinitionValue(def, value);
}

function settingsSectionId(section: string): string {
  return section.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function piSettingsAuditPath(): string {
  return join(repoRoot, "data", "runtime", "pi_settings_audit.jsonl");
}

async function appendPiSettingsAudit(entry: Omit<PiSettingsAuditEntry, "id" | "ts"> & Partial<Pick<PiSettingsAuditEntry, "id" | "ts">>): Promise<void> {
  const path = join(repoRoot, "data", "runtime", "pi_settings_audit.jsonl");
  await appendDurableFile(path, `${JSON.stringify({
    id: entry.id ?? `pi_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    ts: entry.ts ?? new Date().toISOString(),
    ...entry,
  })}\n`);
}

async function readPiSettingsAudit(limit = 80): Promise<PiSettingsAuditEntry[]> {
  let raw = "";
  try {
    raw = await readFile(piSettingsAuditPath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return raw.split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as PiSettingsAuditEntry)
    .slice(-limit)
    .reverse();
}

async function readPiSettingsCatalog() {
  const globalPath = globalPiSettingsPath();
  const projectPath = projectPiSettingsPath();
  const [globalSettings, projectSettings] = await Promise.all([
    readJsonFile<Record<string, unknown>>(globalPath, {}),
    readJsonFile<Record<string, unknown>>(projectPath, {}),
  ]);
  const effective = deepMergeSettings(globalSettings, projectSettings) as Record<string, unknown>;
  const fields = PI_SETTING_DEFINITIONS.map((def) => {
    const globalValue = getPathValue(globalSettings, def.path);
    const projectValue = getPathValue(projectSettings, def.path);
    const effectiveValue = getPathValue(effective, def.path) ?? def.defaultValue;
    const source: "project" | "global" | "default" | "unset" =
      projectValue !== undefined ? "project" : globalValue !== undefined ? "global" : def.defaultValue !== undefined ? "default" : "unset";
    return {
      ...def,
      globalValue,
      projectValue,
      effectiveValue,
      source,
    };
  });
  const sections = Array.from(new Map(PI_SETTING_DEFINITIONS.map((def) => [
    settingsSectionId(def.section),
    {
      id: settingsSectionId(def.section),
      label: def.section,
      fieldPaths: PI_SETTING_DEFINITIONS.filter((item) => item.section === def.section).map((item) => item.path),
    },
  ])).values());
  const resourceSection = sections.find((section) => section.id === "resources");
  return {
    docs: {
      settings: "https://pi.dev/docs/latest/settings",
      providers: "https://pi.dev/docs/latest/providers",
      models: "https://pi.dev/docs/latest/models",
    },
    paths: {
      global: globalPath,
      project: projectPath,
      auth: join(homedir(), ".pi", "agent", "auth.json"),
      models: join(homedir(), ".pi", "agent", "models.json"),
    },
    sections,
    views: {
      resources: {
        title: "Pi resource settings",
        fieldPaths: resourceSection?.fieldPaths ?? [],
      },
    },
    fields,
    raw: { global: globalSettings, project: projectSettings, effective },
  };
}

async function writePiSetting(scope: PiSettingScope, path: string, value: unknown, unset = false) {
  if (scope === "project" && (path === "subagents" || path.startsWith("subagents."))) {
    throw new Error("Project Pi subagents settings are reserved for canonical Team Runs and cannot be edited.");
  }
  const def = PI_SETTING_DEFINITIONS.find((item) => item.path === path);
  if (!def) throw new Error(`Unknown Pi setting path: ${path}`);
  if (!def.editable) throw new Error(`${path} is not editable through LA Settings.`);
  if (scope === "project" && def.globalOnly) throw new Error(`${path} is a global-only Pi setting.`);
  if (!unset) validatePiSettingValue(def, value);
  const settingsPath = scope === "global" ? globalPiSettingsPath() : projectPiSettingsPath();
  const before = await readJsonFile<Record<string, unknown>>(settingsPath, {});
  const next = JSON.parse(JSON.stringify(before)) as Record<string, unknown>;
  const previousValue = getPathValue(before, path);
  if (unset) unsetPathValue(next, path);
  else setPathValue(next, path, value);
  await writeJsonFile(settingsPath, next, { durability: "critical" });
  const nextValue = getPathValue(next, path);
  await appendPiSettingsAudit({
    scope,
    path,
    unset,
    restartRequired: def.restartRequired,
    sensitive: def.sensitive,
    previousValue,
    previousValuePresent: previousValue !== undefined,
    nextValue,
    nextValuePresent: nextValue !== undefined,
  });
  return readPiSettingsCatalog();
}

async function writePiSettingsRaw(scope: PiSettingScope, value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Raw Pi settings must be a JSON object.");
  }
  if (scope === "project") {
    const blocked = findProjectRawGlobalOnlySettings(value);
    if (blocked.length > 0) throw new Error(`Project Pi settings cannot include global-only setting(s): ${blocked.join(", ")}`);
    assertCanonicalTeamProjectSettingsDocument(value);
  }
  const settingsPath = scope === "global" ? globalPiSettingsPath() : projectPiSettingsPath();
  await writeJsonFile(settingsPath, value, { durability: "critical" });
  await appendPiSettingsAudit({ scope, path: "*", mode: "raw-json", restartRequired: true });
  return readPiSettingsCatalog();
}

async function readPiTrustStatusForRepo() {
  return readPiTrustStatus({ cwd: repoRoot, storageRoot: repoRoot, defaultProjectTrust: await readDefaultProjectTrust() });
}

async function writePiTrustDecisionForRepo(target: "current" | "parent", decision: PiTrustDecision) {
  const status = await writePiTrustDecision({
    cwd: repoRoot,
    storageRoot: repoRoot,
    target,
    decision,
    defaultProjectTrust: await readDefaultProjectTrust(),
  });
  await appendPiSettingsAudit({
    scope: "global",
    path: `trust.${target}`,
    unset: decision === null,
    restartRequired: true,
  });
  return status;
}

async function readPiPackagesCatalog() {
  const globalPath = globalPiSettingsPath();
  const projectPath = projectPiSettingsPath();
  const [globalSettings, projectSettings] = await Promise.all([
    readJsonFile<Record<string, unknown>>(globalPath, {}),
    readJsonFile<Record<string, unknown>>(projectPath, {}),
  ]);
  const agentDir = getAgentDir();
  const defaultProjectTrust = await readDefaultProjectTrust();
  const storedProjectTrust = new ProjectTrustStore(agentDir).get(repoRoot);
  const projectTrusted = storedProjectTrust === true || (storedProjectTrust === undefined && defaultProjectTrust === "always");
  const settingsManager = SettingsManager.create(repoRoot, agentDir, { projectTrusted });
  const packageManager = new DefaultPackageManager({ cwd: repoRoot, agentDir, settingsManager });
  const skippedMissingSources: string[] = [];
  const resolvedPaths = await packageManager.resolve(async (source) => {
    skippedMissingSources.push(source);
    return "skip";
  });
  return buildPiPackagesCatalog({
    globalSettings,
    projectSettings,
    paths: { global: globalPath, project: projectPath },
    configuredPackages: packageManager.listConfiguredPackages(),
    resources: buildPiPackageResourceVisibility({
      resolvedPaths,
      projectTrusted,
      defaultProjectTrust,
      skippedMissingSources,
    }),
  });
}

async function readTaskPackageProfileForRepo(projectId: string, taskId: string) {
  return readTaskPackageProfile({ repoRoot, projectId, taskId });
}

async function previewTaskPackageProfileForRepo(input: {
  projectId: string;
  taskId: string;
  expectedRevision: number;
  selections: TaskPackageSelection[];
  executableApprovals?: TaskPackageExecutableApproval[];
}) {
  const profile = await readTaskPackageProfileForRepo(input.projectId, input.taskId);
  if (profile.revision !== input.expectedRevision) {
    throw new TaskPackageProfileError(409, "revision_conflict", `Task Package profile revision ${profile.revision} does not match expected ${input.expectedRevision}.`);
  }
  return previewTaskPackageProfile({
    profile,
    catalog: await readPiPackagesCatalog(),
    desiredSelections: input.selections,
    executableApprovals: input.executableApprovals,
  });
}

async function applyTaskPackageProfileForRepo(input: {
  projectId: string;
  taskId: string;
  expectedRevision: number;
  planHash: string;
  selections: TaskPackageSelection[];
  executableApprovals?: TaskPackageExecutableApproval[];
}) {
  return applyTaskPackageProfile({
    store: { repoRoot, projectId: input.projectId, taskId: input.taskId },
    catalog: await readPiPackagesCatalog(),
    expectedRevision: input.expectedRevision,
    planHash: input.planHash,
    selections: input.selections,
    executableApprovals: input.executableApprovals,
  });
}

async function resolveTaskPackageRunResourcesForRepo(projectId: string, taskId: string) {
  const profile = await readTaskPackageProfileForRepo(projectId, taskId);
  return resolveTaskPackageRunResources({ profile, catalog: await readPiPackagesCatalog() });
}

async function writeScopedPiSettings(scope: PiSettingScope, settings: Record<string, unknown>) {
  const settingsPath = scope === "global" ? globalPiSettingsPath() : projectPiSettingsPath();
  await writeJsonFile(settingsPath, settings, { durability: "critical" });
}

async function upsertPiPackageEntryForRepo(scope: PiSettingScope, input: Record<string, unknown>) {
  const settingsPath = scope === "global" ? globalPiSettingsPath() : projectPiSettingsPath();
  const before = await readJsonFile<Record<string, unknown>>(settingsPath, {});
  const next = upsertPiPackageEntry(before, input as unknown as PiPackageInput);
  await writeScopedPiSettings(scope, next);
  await appendPiSettingsAudit({ scope, path: "packages", mode: "package-entry", restartRequired: true });
  return readPiPackagesCatalog();
}

async function deletePiPackageEntryForRepo(scope: PiSettingScope, source: string) {
  const settingsPath = scope === "global" ? globalPiSettingsPath() : projectPiSettingsPath();
  const before = await readJsonFile<Record<string, unknown>>(settingsPath, {});
  const { settings, removed } = deletePiPackageEntry(before, source);
  if (!removed) throw new Error(`No matching Pi package entry found for ${source}.`);
  await writeScopedPiSettings(scope, settings);
  await appendPiSettingsAudit({ scope, path: "packages", unset: true, mode: "package-entry", restartRequired: true });
  return readPiPackagesCatalog();
}

async function togglePiPackageResourceForRepo(input: Record<string, unknown>) {
  const scope: PiSettingScope = input.scope === "global" ? "global" : "project";
  const settingsPath = scope === "global" ? globalPiSettingsPath() : projectPiSettingsPath();
  const before = await readJsonFile<Record<string, unknown>>(settingsPath, {});
  const next = togglePiPackageResource(before, {
    type: input.type,
    path: input.path,
    enabled: input.enabled,
    source: input.source,
    scope,
    origin: input.origin,
    baseDir: input.baseDir,
  } as Parameters<typeof togglePiPackageResource>[1]);
  await writeScopedPiSettings(scope, next);
  const type = typeof input.type === "string" ? input.type : "resource";
  await appendPiSettingsAudit({
    scope,
    path: input.origin === "package" ? `packages.${String(input.source ?? "")}.${type}` : type,
    mode: "package-resource",
    restartRequired: true,
  });
  return readPiPackagesCatalog();
}

async function runPiPackageActionForRepo(input: PiPackageActionInput) {
  const result = await runPiPackageAction(input, {
    cwd: repoRoot,
    acquireResourceMutation: () => activeAgentRuns.tryAcquireResourceMutationLease(),
    invalidateResourceCatalogs: () => mainRunToolCatalog.invalidate(),
  });
  await appendPiSettingsAudit({
    scope: result.scope,
    path: "packages",
    mode: `package-${result.action}`,
    restartRequired: true,
  });
  return {
    ...result,
    catalog: await readPiPackagesCatalog(),
  };
}

async function previewPiPackageActionForRepo(input: PiPackageActionInput) {
  return previewPiPackageAction(input, { cwd: repoRoot });
}

async function readPiKeybindingsCatalogForRepo() {
  const keybindingsPath = globalPiKeybindingsPath();
  const keybindings = await readJsonFile<Record<string, unknown>>(keybindingsPath, {});
  return buildPiKeybindingsCatalog({ keybindingsPath, keybindings });
}

async function writePiKeybindingActionForRepo(input: Record<string, unknown>) {
  const keybindingsPath = globalPiKeybindingsPath();
  const before = await readJsonFile<Record<string, unknown>>(keybindingsPath, {});
  const next = upsertPiKeybindingAction(before, {
    id: input.id,
    keys: input.keys,
    unset: input.unset === true,
  });
  await writeJsonFile(keybindingsPath, next, { durability: "critical" });
  await appendPiSettingsAudit({
    scope: "global",
    path: `keybindings.${String(input.id ?? "")}`,
    unset: input.unset === true,
    mode: "keybindings",
    restartRequired: false,
  });
  return readPiKeybindingsCatalogForRepo();
}

async function readNotificationPreferencesForRepo() {
  return readNotificationPreferences(repoRoot);
}

async function writeNotificationPreferencesForRepo(input: Record<string, unknown>) {
  return writeNotificationPreferences(repoRoot, {
    enabled: input.enabled as boolean,
    categories: input.categories as Record<"waiting" | "failed" | "completed" | "permission", boolean>,
    expectedUpdatedAt: input.expectedUpdatedAt === null ? null : String(input.expectedUpdatedAt ?? ""),
  });
}

function piThemePaths() {
  return {
    globalDir: globalPiThemesDir(),
    projectDir: projectPiThemesDir(),
    globalSettings: globalPiSettingsPath(),
    projectSettings: projectPiSettingsPath(),
  };
}

async function readPiThemesCatalogForRepo() {
  const paths = piThemePaths();
  const [globalSettings, projectSettings] = await Promise.all([
    readJsonFile<Record<string, unknown>>(paths.globalSettings, {}),
    readJsonFile<Record<string, unknown>>(paths.projectSettings, {}),
  ]);
  return buildPiThemesCatalog({
    globalSettings,
    projectSettings,
    paths,
    homeDir: homedir(),
    repoRoot,
  });
}

async function writePiThemeSelectionForRepo(scope: PiSettingScope, theme: string) {
  const settingsPath = scope === "global" ? globalPiSettingsPath() : projectPiSettingsPath();
  const settings = await readJsonFile<Record<string, unknown>>(settingsPath, {});
  settings.theme = theme.trim();
  if (!settings.theme) throw new Error("Pi theme is required.");
  await writeScopedPiSettings(scope, settings);
  await appendPiSettingsAudit({ scope, path: "theme", mode: "theme-selection", restartRequired: true });
  return readPiThemesCatalogForRepo();
}

async function writePiCustomThemeForRepo(input: Record<string, unknown>) {
  const scope: PiSettingScope = input.scope === "global" ? "global" : "project";
  const name = typeof input.name === "string" ? input.name : undefined;
  const path = await writePiThemeFile({
    scope,
    name,
    theme: input.theme,
    paths: { globalDir: globalPiThemesDir(), projectDir: projectPiThemesDir() },
  });
  const themeName = basename(path, ".json");
  if (input.select === true) {
    await writePiThemeSelectionForRepo(scope, themeName);
  } else {
    await appendPiSettingsAudit({ scope, path: `themes.${themeName}`, mode: "theme-file", restartRequired: false });
  }
  return readPiThemesCatalogForRepo();
}

const PROVIDER_KEY_LINKS: Record<string, string> = {
  anthropic: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
  deepseek: "https://platform.deepseek.com/api_keys",
  google: "https://aistudio.google.com/app/apikey",
  mistral: "https://console.mistral.ai/api-keys/",
  groq: "https://console.groq.com/keys",
  xai: "https://console.x.ai/",
  openrouter: "https://openrouter.ai/settings/keys",
  "vercel-ai-gateway": "https://vercel.com/docs/ai-gateway",
  huggingface: "https://huggingface.co/settings/tokens",
  fireworks: "https://fireworks.ai/account/api-keys",
  together: "https://api.together.ai/settings/api-keys",
  cerebras: "https://cloud.cerebras.ai/platform",
};

interface AuxiliaryCredentialProvider {
  id: string;
  displayName: string;
  kind: "bridge";
  keyLink: string;
  authProviderIds: string[];
  envVars: string[];
  label: string;
}

interface PiProviderCatalogProviderItem {
  id: string;
  displayName: string;
  kind: "model" | "bridge";
  configured: boolean;
  authStatus: { configured?: boolean; source?: string; label?: string };
  authEnv?: Record<string, string>;
  apiKeyEnvVars: string[];
  ambientAuth?: ReturnType<typeof ambientCredentialStatusForProvider>;
  usesOAuth: boolean;
  keyLink: string;
  modelCount: number;
  availableModelCount: number;
  models: Array<{
    id: unknown;
    name: unknown;
    api: unknown;
    provider: unknown;
    reasoning: unknown;
    input: unknown;
    contextWindow: unknown;
    maxTokens: unknown;
    available: boolean;
  }>;
}

async function getProviderCatalogAuthEnv(providerIds: string[]): Promise<Record<string, string> | undefined> {
  const credentials = getPiCredentialStore();
  for (const providerId of providerIds) {
    const credential = await credentials.readStored(providerId);
    const env = sanitizeProviderScopedEnv(credential?.type === "api_key" ? credential.env : undefined);
    if (env && Object.keys(env).length) return env;
  }
  return undefined;
}

const AUXILIARY_CREDENTIAL_PROVIDERS: AuxiliaryCredentialProvider[] = [
  {
    id: "tavily",
    displayName: "Tavily Search",
    kind: "bridge",
    keyLink: "https://app.tavily.com/home",
    authProviderIds: ["tavily", "tavily-search"],
    envVars: ["TAVILY_API_KEY", "LA_TAVILY_API_KEY"],
    label: "Web search bridge credential",
  },
];

const SUPPORTED_MODEL_APIS = ["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"] as const;

function piModelsJsonPath(): string {
  return join(homedir(), ".pi", "agent", "models.json");
}

function stripJsonComments(text: string): string {
  let output = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") {
      inString = true;
      output += char;
      continue;
    }
    if (char === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      output += "\n";
      continue;
    }
    if (char === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
      i += 1;
      continue;
    }
    output += char;
  }
  return output.replace(/,\s*([}\]])/g, "$1");
}

function parseCustomModels(raw: string): CustomModelsDocument {
  if (!raw.trim()) return { providers: {} };
  const parsed = JSON.parse(stripJsonComments(raw)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("models.json must be a JSON object.");
  }
  const doc = parsed as CustomModelsDocument;
  if (doc.providers !== undefined && (!doc.providers || typeof doc.providers !== "object" || Array.isArray(doc.providers))) {
    throw new Error("models.json providers must be an object.");
  }
  return doc;
}

async function readCustomModelsDocument(): Promise<{ path: string; exists: boolean; document: CustomModelsDocument; parseError?: string }> {
  const path = piModelsJsonPath();
  try {
    const raw = await readFile(path, "utf8");
    try {
      return { path, exists: true, document: parseCustomModels(raw) };
    } catch (error) {
      return { path, exists: true, document: { providers: {} }, parseError: error instanceof Error ? error.message : String(error) };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { path, exists: false, document: { providers: {} } };
  }
}

function summarizeCustomModels(input: Awaited<ReturnType<typeof readCustomModelsDocument>>) {
  const providers = Object.entries(input.document.providers ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([id, provider]) => {
    const models = Array.isArray(provider.models) ? provider.models : [];
    return {
      id,
      baseUrl: typeof provider.baseUrl === "string" ? provider.baseUrl : undefined,
      api: typeof provider.api === "string" ? provider.api : undefined,
      hasApiKey: typeof provider.apiKey === "string" && provider.apiKey.length > 0,
      apiKeyLabel: typeof provider.apiKey === "string"
        ? provider.apiKey.includes("security find-generic-password") ? "macOS Keychain" : provider.apiKey.startsWith("!") ? "shell command" : provider.apiKey.includes("_") || /^[A-Z0-9_]+$/.test(provider.apiKey) ? provider.apiKey : "literal key"
        : undefined,
      authHeader: provider.authHeader === true,
      headers: provider.headers && typeof provider.headers === "object" && !Array.isArray(provider.headers) ? provider.headers : undefined,
      modelOverrides: provider.modelOverrides && typeof provider.modelOverrides === "object" && !Array.isArray(provider.modelOverrides) ? provider.modelOverrides : undefined,
      compat: provider.compat && typeof provider.compat === "object" && !Array.isArray(provider.compat) ? provider.compat : undefined,
      modelCount: models.length,
      models: models.map((model) => ({
        id: typeof model.id === "string" ? model.id : "",
        name: typeof model.name === "string" ? model.name : undefined,
        api: typeof model.api === "string" ? model.api : undefined,
        reasoning: model.reasoning === true,
        contextWindow: typeof model.contextWindow === "number" ? model.contextWindow : undefined,
        maxTokens: typeof model.maxTokens === "number" ? model.maxTokens : undefined,
        cost: model.cost && typeof model.cost === "object" && !Array.isArray(model.cost) ? model.cost : undefined,
        thinkingLevelMap: model.thinkingLevelMap && typeof model.thinkingLevelMap === "object" && !Array.isArray(model.thinkingLevelMap) ? model.thinkingLevelMap : undefined,
        headers: model.headers && typeof model.headers === "object" && !Array.isArray(model.headers) ? model.headers : undefined,
        compat: model.compat && typeof model.compat === "object" && !Array.isArray(model.compat) ? model.compat : undefined,
        input: Array.isArray(model.input) ? model.input.filter((item): item is string => typeof item === "string") : undefined,
      })).filter((model) => model.id),
    };
  });
  return {
    path: input.path,
    exists: input.exists,
    parseError: input.parseError,
    docs: "node_modules/@earendil-works/pi-coding-agent/docs/models.md",
    supportedApis: [...SUPPORTED_MODEL_APIS],
    providerCount: providers.length,
    modelCount: providers.reduce((sum, provider) => sum + provider.modelCount, 0),
    providers,
  };
}

async function readCustomModelsCatalog() {
  return summarizeCustomModels(await readCustomModelsDocument());
}

function cleanOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function writeCustomModelsDocument(document: CustomModelsDocument) {
  const path = piModelsJsonPath();
  await writeJsonFile(path, { providers: document.providers ?? {} }, { durability: "critical" });
  await (await getPiModelRuntime()).reloadConfig();
  await appendPiSettingsAudit({ scope: "global", path: "models.json", mode: "custom-models", restartRequired: false });
  return readCustomModelsCatalog();
}

async function writeCustomModelsRaw(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("models.json must be a JSON object.");
  }
  const document = parseCustomModels(JSON.stringify(value));
  return writeCustomModelsDocument(document);
}

async function upsertCustomModelProvider(input: Record<string, unknown>) {
  const providerId = cleanOptionalString(input.providerId);
  if (!providerId) throw new Error("providerId is required.");
  const api = cleanOptionalString(input.api);
  if (api && !SUPPORTED_MODEL_APIS.includes(api as never)) throw new Error(`Unsupported api '${api}'.`);
  const current = await readCustomModelsDocument();
  if (current.parseError) throw new Error(`Cannot edit models.json until parse error is fixed: ${current.parseError}`);
  const providers = { ...(current.document.providers ?? {}) };
  const existing = providers[providerId] ?? {};
  const incomingApiKey = cleanOptionalString(input.apiKey);
  let apiKeyReference: string | undefined;
  if (incomingApiKey) {
    if (incomingApiKey.startsWith("!") || /^[A-Z0-9_]+$/.test(incomingApiKey)) {
      apiKeyReference = incomingApiKey;
    } else {
      const service = keychainServiceForProvider(providerId);
      await writeKeychainGenericPassword({ service, password: incomingApiKey });
      apiKeyReference = buildKeychainCredentialCommand({ service });
    }
  }
  providers[providerId] = {
    ...mergeCustomModelProviderConfig(existing, input, apiKeyReference),
    ...(api ? { api } : {}),
  };
  return writeCustomModelsDocument({ providers });
}

async function upsertCustomModel(input: Record<string, unknown>) {
  const providerId = cleanOptionalString(input.providerId);
  const modelId = cleanOptionalString(input.id);
  if (!providerId) throw new Error("providerId is required.");
  if (!modelId) throw new Error("model id is required.");
  const current = await readCustomModelsDocument();
  if (current.parseError) throw new Error(`Cannot edit models.json until parse error is fixed: ${current.parseError}`);
  const providers = { ...(current.document.providers ?? {}) };
  const provider = providers[providerId] ?? { models: [] };
  const models = Array.isArray(provider.models) ? [...provider.models] : [];
  const index = models.findIndex((item) => item && typeof item === "object" && (item as Record<string, unknown>).id === modelId);
  const model = mergeCustomModelConfig(index >= 0 ? models[index] : {}, input);
  if (index >= 0) models[index] = model;
  else models.push(model);
  providers[providerId] = { ...provider, models };
  return writeCustomModelsDocument({ providers });
}

async function deleteCustomModelProvider(providerId: string) {
  const id = providerId.trim();
  if (!id) throw new Error("providerId is required.");
  const current = await readCustomModelsDocument();
  if (current.parseError) throw new Error(`Cannot edit models.json until parse error is fixed: ${current.parseError}`);
  const providers = { ...(current.document.providers ?? {}) };
  delete providers[id];
  return writeCustomModelsDocument({ providers });
}

async function deleteCustomModel(providerId: string, modelId: string) {
  const providerKey = providerId.trim();
  const modelKey = modelId.trim();
  if (!providerKey) throw new Error("providerId is required.");
  if (!modelKey) throw new Error("modelId is required.");
  const current = await readCustomModelsDocument();
  if (current.parseError) throw new Error(`Cannot edit models.json until parse error is fixed: ${current.parseError}`);
  const providers = { ...(current.document.providers ?? {}) };
  const provider = providers[providerKey];
  if (!provider) return writeCustomModelsDocument({ providers });
  const models = Array.isArray(provider.models) ? provider.models.filter((item) => {
    return !(item && typeof item === "object" && (item as Record<string, unknown>).id === modelKey);
  }) : [];
  providers[providerKey] = { ...provider, models };
  return writeCustomModelsDocument({ providers });
}

async function readCredentialStatus(provider: AuxiliaryCredentialProvider) {
  const envVar = provider.envVars.find((name) => Boolean(process.env[name]));
  if (envVar) return { configured: true, source: "env", label: envVar };
  for (const providerId of provider.authProviderIds) {
    const credential = await getPiCredentialStore().readStored(providerId);
    if (credential?.type === "api_key" && credential.key) {
      return { configured: true, source: "authStorage", label: providerId };
    }
  }
  return { configured: false, source: "unset", label: provider.authProviderIds.join(" / ") };
}

async function readPiProviderCatalog() {
  const modelRuntime = await getPiModelRuntime();
  const defaults = await readModelDefaults();
  const customModels = await readCustomModelsCatalog();
  const allModels = [...modelRuntime.getModels()] as unknown as Array<Record<string, unknown>>;
  const availableModels = await modelRuntime.getAvailable() as unknown as Array<Record<string, unknown>>;
  const availableKeys = new Set(availableModels.map((model) => `${model.provider}/${model.id}`));
  const byProvider = new Map<string, Array<Record<string, unknown>>>();
  for (const model of allModels) {
    const provider = String(model.provider ?? "unknown");
    byProvider.set(provider, [...(byProvider.get(provider) ?? []), model]);
  }
  const providers: PiProviderCatalogProviderItem[] = await Promise.all(Array.from(byProvider.entries()).sort(([a], [b]) => a.localeCompare(b)).map(async ([provider, models]) => {
    const authStatus = modelRuntime.getProviderAuthStatus(provider) as { configured?: boolean; source?: string; label?: string };
    return {
      id: provider,
      displayName: modelRuntime.getProvider(provider)?.name ?? provider,
      kind: "model" as const,
      configured: Boolean(authStatus?.configured),
      authStatus,
      authEnv: await getProviderCatalogAuthEnv([provider]),
      apiKeyEnvVars: apiKeyEnvVarsForProvider(provider),
      ambientAuth: ambientCredentialStatusForProvider(provider),
      usesOAuth: piProviderUsesOAuth(provider, modelRuntime),
      keyLink: PROVIDER_KEY_LINKS[provider] ?? "https://pi.dev/docs/latest/providers",
      modelCount: models.length,
      availableModelCount: models.filter((model) => availableKeys.has(`${model.provider}/${model.id}`)).length,
      models: models.map((model) => ({
        id: model.id,
        name: model.name,
        api: model.api,
        provider: model.provider,
        reasoning: model.reasoning,
        input: model.input,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        available: availableKeys.has(`${model.provider}/${model.id}`),
      })),
    };
  }));
  for (const provider of AUXILIARY_CREDENTIAL_PROVIDERS) {
    if (providers.some((item) => item.id === provider.id)) continue;
    const authStatus = await readCredentialStatus(provider);
    providers.push({
      id: provider.id,
      displayName: provider.displayName,
      kind: provider.kind,
      configured: Boolean(authStatus.configured),
      authStatus,
      authEnv: await getProviderCatalogAuthEnv(provider.authProviderIds),
      apiKeyEnvVars: [...new Set(provider.authProviderIds.flatMap((providerId) => apiKeyEnvVarsForProvider(providerId)))],
      ambientAuth: undefined,
      usesOAuth: false,
      keyLink: provider.keyLink,
      modelCount: 0,
      availableModelCount: 0,
      models: [],
    });
  }
  providers.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "model" ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
  return {
    docs: {
      providers: "https://pi.dev/docs/latest/providers",
      models: "https://pi.dev/docs/latest/models",
      customModels: "https://pi.dev/docs/latest/models",
    },
    paths: {
      auth: join(homedir(), ".pi", "agent", "auth.json"),
      models: join(homedir(), ".pi", "agent", "models.json"),
    },
    defaults: {
      provider: defaults.effectiveProvider,
      modelId: defaults.effectiveModel,
      thinkingLevel: defaults.effectiveThinkingLevel,
    },
    totalModels: allModels.length,
    availableModels: availableModels.length,
    customModels,
    providers,
  };
}

function startPiProviderLoginForRepo(provider: string) {
  return piAuthLoginCoordinator.start(provider);
}

function readPiProviderLoginForRepo(attemptId: string) {
  return piAuthLoginCoordinator.status(attemptId);
}

function answerPiProviderLoginForRepo(input: { attemptId: string; eventId: string; value?: string }) {
  return piAuthLoginCoordinator.answer(input);
}

function cancelPiProviderLoginForRepo(attemptId: string) {
  return piAuthLoginCoordinator.cancel(attemptId);
}

async function logoutPiProviderAuthForRepo(provider: string) {
  return logoutPiProviderAuth({ provider });
}

type AgentBridgeStatus = "enabled" | "available_to_bridge" | "planned" | "blocked";
type AgentBridgeTone = "pass" | "warn" | "muted";
type AgentBridgeConfigStatus = "configured" | "missing_credential" | "not_required" | "not_ready";

function bridgeStatusDisplay(status: AgentBridgeStatus): { label: string; tone: AgentBridgeTone } {
  if (status === "enabled") return { label: "enabled", tone: "pass" };
  if (status === "available_to_bridge") return { label: "ready to bridge", tone: "warn" };
  if (status === "blocked") return { label: "blocked", tone: "warn" };
  return { label: "planned", tone: "muted" };
}

function bridgeConfigDisplay(status: AgentBridgeConfigStatus): { label: string; tone: AgentBridgeTone } {
  if (status === "configured") return { label: "credential ready", tone: "pass" };
  if (status === "missing_credential") return { label: "missing credential", tone: "warn" };
  if (status === "not_required") return { label: "no credential required", tone: "pass" };
  return { label: "not configurable yet", tone: "muted" };
}

function resourceValueIncludes(value: unknown, signals: string[]): boolean {
  if (!signals.length) return false;
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return values.some((item) => {
    const text = typeof item === "string" ? item : JSON.stringify(item);
    return signals.some((signal) => text.toLowerCase().includes(signal.toLowerCase()));
  });
}

async function localBridgeSignals(def: PiBridgePolicy): Promise<string[]> {
  const candidates = [
    join(repoRoot, ".pi", "skills", def.id, "SKILL.md"),
    join(repoRoot, ".pi", "skills", `${def.id}-tools`, "SKILL.md"),
    join(repoRoot, ".pi", "skills", "browser-tools", "SKILL.md"),
    join(repoRoot, ".pi", "skills", "mcp-builder", "SKILL.md"),
  ];
  const signals: string[] = [];
  for (const candidate of candidates) {
    const matchedSignal = def.settingsSignals.find((signal) => candidate.toLowerCase().includes(signal.toLowerCase()));
    if (!matchedSignal) continue;
    try {
      await readFile(candidate, "utf8");
      signals.push(`local:${matchedSignal}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return Array.from(new Set(signals));
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function readMcpBridgeCatalog(): Promise<{ catalog: McpBridgeCatalog; diagnostics: ServerDiagnostic[] }> {
  const configs = await readMcpServerConfigs(repoRoot);
  const descriptors: McpToolDescriptor[] = [];
  const diagnostics: ServerDiagnostic[] = [];
  for (const config of configs) {
    if (config.enabled === false) continue;
    if (config.transport !== "stdio" || !config.command) {
      diagnostics.push(createServerDiagnostic({
        severity: "warning",
        code: "mcp_config_not_discoverable",
        message: `MCP server ${config.id} is configured but cannot be discovered yet; only stdio servers with command are supported in v2.16.`,
      }));
      continue;
    }
    try {
      descriptors.push(...await withTimeout(discoverMcpServerTools(config), 2500, `MCP discovery ${config.id}`));
    } catch (error) {
      diagnostics.push(createServerDiagnostic({
        severity: "warning",
        code: "mcp_discovery_failed",
        message: `MCP server ${config.id} discovery failed: ${(error as Error).message}`,
      }));
    }
  }
  return { catalog: buildMcpBridgeCatalog(configs, descriptors), diagnostics };
}

async function readAgentBridgeCatalog() {
  const piCatalog = await readPiSettingsCatalog();
  const mcpBridgeCatalog = await readMcpBridgeCatalog();
  if (mcpBridgeCatalog.diagnostics.length) {
    await appendServerDiagnostics(repoRoot, mcpBridgeCatalog.diagnostics);
  }
  const registeredToolNames = new Set(listCatToolMetadata().map((tool) => tool.name));
  const effective = piCatalog.raw.effective;
  const packages = getPathValue(effective, "packages");
  const extensions = getPathValue(effective, "extensions");
  const skills = getPathValue(effective, "skills");
  const prompts = getPathValue(effective, "prompts");
  const bridges = await Promise.all(CAT_WEB_SESSION_BRIDGE_POLICIES.map(async (def) => {
    const settingsSignals = def.settingsSignals.filter((signal) =>
      resourceValueIncludes(packages, [signal]) ||
      resourceValueIncludes(extensions, [signal]) ||
      resourceValueIncludes(skills, [signal]) ||
      resourceValueIncludes(prompts, [signal]),
    );
    const detectedSignals = Array.from(new Set([...settingsSignals, ...await localBridgeSignals(def)]));
    const mcpSignals = def.id === "mcp"
      ? [
          ...mcpBridgeCatalog.catalog.servers.map((server) => `mcp-server:${server.id}`),
          ...mcpBridgeCatalog.catalog.tools.map((tool) => `mcp-tool:${tool.bridgeToolName}`),
        ]
      : [];
    const signalFound = detectedSignals.length > 0 || mcpSignals.length > 0;
    const inheritedBridge = !BROWSER_SESSION_POLICY.noExtensions && def.status === "implemented" && def.kind === "web" && signalFound;
    const explicitBridge = BROWSER_SESSION_POLICY.noExtensions && registeredToolNames.has(def.desiredToolName);
    const mcpBridge = def.id === "mcp" && mcpBridgeCatalog.catalog.tools.some((tool) => tool.allowlistState === "allowlisted");
    const bridgeRegistered = explicitBridge || inheritedBridge || mcpBridge;
    const status: AgentBridgeStatus = bridgeRegistered ? "enabled" : def.status === "blocked" ? "blocked" : BROWSER_SESSION_POLICY.noExtensions
      ? signalFound ? "available_to_bridge" : "planned"
      : signalFound ? "enabled" : "planned";
    const display = bridgeStatusDisplay(status);
    const credentialProvider = def.credentialProviderId
      ? AUXILIARY_CREDENTIAL_PROVIDERS.find((provider) => provider.id === def.credentialProviderId)
      : undefined;
    const credentialStatus = credentialProvider ? await readCredentialStatus(credentialProvider) : undefined;
    const configStatus: AgentBridgeConfigStatus = !bridgeRegistered
      ? "not_ready"
      : def.configWhenRegistered === "credential"
        ? credentialStatus?.configured ? "configured" : "missing_credential"
        : "not_required";
    const configDisplay = bridgeConfigDisplay(configStatus);
    return {
      ...def,
      status,
      statusLabel: display.label,
      statusTone: display.tone,
      configStatus,
      configStatusLabel: configDisplay.label,
      configStatusTone: configDisplay.tone,
      configDetail: def.id === "mcp"
        ? `${mcpBridgeCatalog.catalog.servers.length} MCP servers · ${mcpBridgeCatalog.catalog.tools.length} discovered tools · ${mcpBridgeCatalog.catalog.tools.filter((tool) => tool.allowlistState === "allowlisted").length} allowlisted`
        : credentialProvider
        ? `${credentialProvider.displayName}: ${credentialStatus?.source ?? "unset"}${credentialStatus?.label ? ` · ${credentialStatus.label}` : ""}`
        : bridgeRegistered ? "This bridge does not require a provider secret." : "No editable bridge credential is available yet.",
      configProviderId: credentialProvider?.id,
      configActionLabel: credentialProvider ? `Configure ${credentialProvider.displayName}` : undefined,
      bridgedToWeb: bridgeRegistered,
      detectedSignals: bridgeRegistered
        ? Array.from(new Set([inheritedBridge ? "pi:inherited-tool" : "la:custom-tool", ...detectedSignals, ...mcpSignals]))
        : Array.from(new Set([...detectedSignals, ...mcpSignals])),
      mcpCatalog: def.id === "mcp" ? mcpBridgeCatalog.catalog : undefined,
    };
  }));
  const enabled = bridges.filter((bridge) => bridge.status === "enabled").length;
  const ready = bridges.filter((bridge) => bridge.status === "available_to_bridge").length;
  return {
    policy: {
      noExtensions: BROWSER_SESSION_POLICY.noExtensions,
      customTools: BROWSER_SESSION_POLICY.useCustomTools,
      mode: BROWSER_SESSION_POLICY.noExtensions ? "explicit_bridge" : "full_pi_cli",
      title: BROWSER_SESSION_POLICY.noExtensions ? "Isolated product resources" : "Full Pi CLI + CAT custom",
      explanation: BROWSER_SESSION_POLICY.noExtensions
        ? "Product sessions do not auto-load global Pi tools. Capabilities become available only through the server-selected Run profile."
        : "Web sessions inherit Pi package, extension, and built-in tools while LA runtime guards data writes and marks non-CAT output advisory.",
      description: BROWSER_SESSION_POLICY.noExtensions
        ? "Product sessions keep noExtensions enabled, so global Package tools are never inherited silently. Research, browser, computer, and vision capabilities are selected explicitly for a canonical Run."
        : "Browser/API CAT sessions use noExtensions=false and full Pi CLI discovery, plus explicit LA CAT custom tools. Inherited/built-in results are citable:false until promoted through CAT evidence gates.",
      pills: [
        { label: "noExtensions", value: String(BROWSER_SESSION_POLICY.noExtensions), tone: BROWSER_SESSION_POLICY.noExtensions ? "pass" : "warn" },
        { label: "toolSurface", value: BROWSER_SESSION_POLICY.noExtensions ? "isolated-la-cat+server-resources" : "full-pi-cli+cat-custom", tone: BROWSER_SESSION_POLICY.useCustomTools ? "pass" : "muted" },
        { label: "dataGuard", value: String(BROWSER_SESSION_POLICY.dataStoreWriteGuard), tone: BROWSER_SESSION_POLICY.dataStoreWriteGuard ? "pass" : "warn" },
        { label: "citable", value: String(BROWSER_SESSION_POLICY.nonCatToolResultsCitable), tone: BROWSER_SESSION_POLICY.nonCatToolResultsCitable ? "warn" : "pass" },
      ],
    },
    summary: [
      { label: "enabled", value: enabled },
      { label: "ready", value: ready },
    ],
    docs: {
      resourcePolicy: "docs/PI_RESOURCE_POLICY.md",
      bridgeRoadmap: "docs/PI_RESOURCE_POLICY.md#current-decision",
    },
    bridges,
  };
}

// Historical trace remains read-only until explicit Task backfill. Session
// diagnostics may use its compaction metadata, but new Task work never appends
// to this file.
async function readAgentTraceFile(projectId: string): Promise<AgentTraceEvent[]> {
  try {
    const raw = await readFile(agentTracePath(projectId), "utf8");
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as AgentTraceEvent);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function compactNumber(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}

async function resolveModelContextWindow(provider?: string, modelId?: string): Promise<number | null> {
  if (!provider || !modelId) return null;
  try {
    const model = (await getPiModelRuntime()).getModel(provider, modelId) ?? builtinModelCatalog.getModel(provider, modelId);
    return typeof model?.contextWindow === "number" && Number.isFinite(model.contextWindow) && model.contextWindow > 0
      ? model.contextWindow
      : null;
  } catch {
    return null;
  }
}

async function resolveModelPromptTokenBudget(provider?: string, modelId?: string): Promise<PromptRequestBudget | undefined> {
  if (!provider || !modelId) return undefined;
  try {
    const model = (await getPiModelRuntime()).getModel(provider, modelId) ?? builtinModelCatalog.getModel(provider, modelId);
    if (!(typeof model?.contextWindow === "number" && model.contextWindow > 0
      && typeof model.maxTokens === "number" && model.maxTokens > 0 && model.maxTokens < model.contextWindow
    )) return undefined;
    const registry = new ModelContextRegistry([{
      provider,
      modelId,
      contextWindow: model.contextWindow,
      outputReserveTokens: model.maxTokens,
    }]);
    return {
      registry,
      provider,
      modelId,
      toolSchemaTokens: 0,
      historyTokens: 0,
      providerFramingTokens: estimatePromptTokens(JSON.stringify({ provider, modelId, api: model.api, messages: [], tools: [] })),
      safetyMarginTokens: 0,
      compactionReserveTokens: 0,
    };
  } catch {
    return undefined;
  }
}

function sessionContextPercent(contextTokens: number | null, contextWindow: number | null): number | null {
  return typeof contextTokens === "number" && typeof contextWindow === "number"
    ? Number(((contextTokens / contextWindow) * 100).toFixed(2))
    : null;
}

function sessionTokenLabel(contextTokens: number | null, contextWindow: number | null): string {
  if (typeof contextTokens !== "number") return "pending post-compact";
  if (typeof contextWindow === "number") return `${compactNumber(contextTokens)} / ${compactNumber(contextWindow)}`;
  return compactNumber(contextTokens);
}

async function readSessionStats(path: string, diagnostics?: ServerDiagnostic[], projectId?: string, sessionId?: string): Promise<{
  messageCount: number;
  contextTokens: number | null;
  contextWindow: number | null;
  contextPct: number | null;
  tokenLabel: string;
  compactionCount: number;
  lastCompactionAt?: string;
  lastTokensBefore?: number;
  latestEntryId?: string;
  latestParentId?: string | null;
  lastUserAt?: string;
  lastAssistantAt?: string;
  sessionName?: string;
  namedAt?: string;
  provider?: string;
  modelId?: string;
  thinkingLevel?: PiThinkingLevel;
  inputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  lastCost?: number;
}> {
  try {
    const raw = await readFile(path, "utf8");
    let messageCount = 0;
    let contextTokens: number | null = null;
    let compactionCount = 0;
    let lastCompactionAt: string | undefined;
    let lastTokensBefore: number | undefined;
    let latestEntryId: string | undefined;
    let latestParentId: string | null | undefined;
    let lastUserAt: string | undefined;
    let lastAssistantAt: string | undefined;
    let sessionName: string | undefined;
    let namedAt: string | undefined;
    let provider: string | undefined;
    let modelId: string | undefined;
    let thinkingLevel: PiThinkingLevel | undefined;
    let usageTotals = emptySessionUsageTotals();
    let lastCost: number | undefined;
    let latestAssistantTokens: number | undefined;
    let lineNo = 0;
    for (const line of raw.split(/\r?\n/)) {
      lineNo += 1;
      if (!line.trim()) continue;
      let record: any;
      try {
        record = JSON.parse(line);
      } catch (error) {
        diagnostics?.push(
          createServerDiagnostic({
            severity: "warning",
            code: "session_stats_line_unreadable",
            error,
            path,
            projectId,
            line: lineNo,
          }),
        );
        continue;
      }
      if (record?.type === "message") messageCount += 1;
      if (typeof record?.id === "string") latestEntryId = record.id;
      if (record && typeof record === "object" && "parentId" in record) latestParentId = typeof record.parentId === "string" ? record.parentId : null;
      if (record?.type === "model_change") {
        if (typeof record.provider === "string") provider = record.provider;
        if (typeof record.modelId === "string") modelId = record.modelId;
      }
      if (record?.type === "thinking_level_change") {
        thinkingLevel = normalizeThinkingLevel(record.thinkingLevel);
      }
      if (record?.type === "message" && record.message?.role === "user" && typeof record.timestamp === "string") lastUserAt = record.timestamp;
      if (record?.type === "session_info") {
        if (typeof record.name === "string" && record.name.trim()) sessionName = record.name.trim();
        if (typeof record.timestamp === "string") namedAt = record.timestamp;
      }
      if (record?.type === "message" && record.message?.role === "assistant") {
        if (typeof record.timestamp === "string") lastAssistantAt = record.timestamp;
        if (typeof record.message?.provider === "string") provider = record.message.provider;
        if (typeof record.message?.model === "string") modelId = record.message.model;
        usageTotals = addPiMessageUsageTotals(usageTotals, record.message?.usage);
        const cost = Number(record.message?.usage?.cost?.total ?? 0);
        if (Number.isFinite(cost) && cost > 0) lastCost = cost;
        const total = Number(record.message?.usage?.totalTokens ?? 0);
        if (Number.isFinite(total) && total > 0) latestAssistantTokens = total;
      }
      if (record?.type === "compaction") {
        compactionCount += 1;
        if (typeof record.timestamp === "string") lastCompactionAt = record.timestamp;
        else if (typeof record.timestamp === "number") lastCompactionAt = new Date(record.timestamp).toISOString();
        const tokensBefore = Number(record.tokensBefore ?? 0);
        if (Number.isFinite(tokensBefore) && tokensBefore > 0) lastTokensBefore = tokensBefore;
      }
    }
    const compactedAfterLastAssistant =
      typeof lastCompactionAt === "string" &&
      (!lastAssistantAt || Date.parse(lastCompactionAt) >= Date.parse(lastAssistantAt));
    contextTokens = compactedAfterLastAssistant ? null : (latestAssistantTokens ?? Math.ceil(raw.length / 4));
    if (projectId) {
      const trace = await readAgentTraceFile(projectId);
      let traceCompactionCount = 0;
      for (const event of trace) {
        const matchesSessionFile = Boolean(path) && event.sessionFile === path;
        const matchesSessionId = Boolean(sessionId) && event.sessionId === sessionId;
        if (!matchesSessionFile && !matchesSessionId) continue;
        if (event.kind !== "compaction_end") continue;
        traceCompactionCount += 1;
        lastCompactionAt = event.ts;
        const tokensBefore = Number(event.tokensBefore ?? 0);
        if (Number.isFinite(tokensBefore) && tokensBefore > 0) {
          lastTokensBefore = tokensBefore;
        } else if (!lastTokensBefore && typeof contextTokens === "number" && contextTokens > 0) {
          lastTokensBefore = contextTokens;
        }
      }
      if (compactionCount === 0) compactionCount = traceCompactionCount;
    }
    const contextWindow = await resolveModelContextWindow(provider, modelId);
    const contextPct = sessionContextPercent(contextTokens, contextWindow);
    return {
      messageCount,
      contextTokens,
      contextWindow,
      contextPct,
      tokenLabel: sessionTokenLabel(contextTokens, contextWindow),
      compactionCount,
      lastCompactionAt,
      lastTokensBefore,
      latestEntryId,
      latestParentId,
      lastUserAt,
      lastAssistantAt,
      sessionName,
      namedAt,
      provider,
      modelId,
      thinkingLevel,
      inputTokens: usageTotals.inputTokens,
      cacheReadTokens: usageTotals.cacheReadTokens,
      cacheWriteTokens: usageTotals.cacheWriteTokens,
      lastCost,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { messageCount: 0, contextTokens: 0, contextWindow: null, contextPct: null, tokenLabel: "0 tokens", compactionCount: 0 };
  }
}

async function readRuntimeHealth(): Promise<ReturnType<typeof buildCatRuntimeHealthReport>> {
  const rootPackage = await readJsonFile<{
    version?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }>(join(repoRoot, "package.json"), {});
  const runtimePackage = await readJsonFile<{
    dependencies?: Record<string, string>;
  }>(join(repoRoot, "packages", "cat-runtime", "package.json"), {});
  const piSettings = await readJsonFile<Record<string, unknown>>(join(repoRoot, ".pi", "settings.json"), {});
  const dependencyVersions = {
    ...rootPackage.devDependencies,
    ...rootPackage.dependencies,
    ...runtimePackage.dependencies,
  };
  const residentRuntime = await readResidentRuntimeStatus({
    repoRoot,
    port,
    currentPid: process.pid,
    uptimeSec: Math.round(process.uptime()),
  });
  return buildCatRuntimeHealthReport({
    laVersion: rootPackage.version ?? "unknown",
    piCodingAgentVersion: dependencyVersions["@earendil-works/pi-coding-agent"] ?? "missing",
    piAiVersion: dependencyVersions["@earendil-works/pi-ai"] ?? "missing",
    expectedPiVersion: piRuntimeVersion,
    piSettings,
    // M2 fix: derive these from the SAME single-source constants createCatAgentSession
    // applies, so the health surface cannot green-certify a stance the session does not
    // actually use. M5 fix: pass the real documented package resources so web_search
    // conflict precedence is evaluated against a non-empty list, not self-asserted.
    browserNoExtensions: BROWSER_SESSION_POLICY.noExtensions,
    browserCustomTools: BROWSER_SESSION_POLICY.useCustomTools,
    browserBuiltinTools: BROWSER_SESSION_POLICY.builtinTools,
    browserDataStoreWriteGuard: BROWSER_SESSION_POLICY.dataStoreWriteGuard,
    browserNonCatToolResultsCitable: BROWSER_SESSION_POLICY.nonCatToolResultsCitable,
    projectSessionStrategy: PROJECT_SESSION_STRATEGY,
    resources: CAT_PI_PACKAGE_RESOURCES,
    sandbox: buildCatSandboxHealthReport(createWorkspace(repoRoot, "__runtime_health__")),
    residentRuntime,
    permissionPolicy: await readAgentPermissionContract(),
  });
}

const mainRunToolCatalog = createLeasedAgentToolCatalog({
  acquireResourceRead: () => activeAgentRuns.acquireRunStartLease(),
  load: async () => {
    const resources = await resolveTaskRunResources("main", { cwd: repoRoot });
    const workspace = createWorkspace(repoRoot, "__main_run_tool_catalog__");
    const operationId = `tool-catalog-${randomUUID()}`;
    const createdSession = await createCatWorkerSupportSession(finalizeCatWorkerSessionPlan({
      schemaVersion: 1,
      profile: "cat",
      runtimeRoot: repoRoot,
      workspace: { root: workspace.root, projectId: workspace.projectId },
      taskId: null,
      runId: operationId,
      modelProvider: null,
      modelId: null,
      thinkingLevel: null,
      sessionMode: "memory",
      sessionId: null,
      branchEntryId: null,
      preset: "cat",
      disabledTools: [],
      runOptions: null,
      isolatedResources: resources.isolatedResources,
      runtimeExtension: true,
      permissionContract: null,
      serverTools: [],
      extensionBinding: false,
    }), "Main Run tool catalog probe");
    try {
      return buildAgentToolMetadataCatalog({
        catTools: listCatToolMetadata(),
        activeToolNames: createdSession.requestShape.activeToolNames,
        tools: createdSession.tools,
      });
    } finally {
      await createdSession.dispose();
    }
  },
});

const listAgentToolMetadata = () => mainRunToolCatalog.list();

async function readNativeCapabilityCatalog() {
  let researchFailure: string | null = null;
  try {
    await resolveTaskRunResources("main", { cwd: repoRoot }, ["research"]);
  } catch (error) {
    researchFailure = error instanceof Error ? error.message : String(error);
  }
  return {
    schemaVersion: 1,
    capabilities: NATIVE_CAPABILITY_PACKAGES
      .filter((entry) => entry.activation === "on-demand" || entry.activation === "experimental")
      .map((entry) => {
        const common = {
          id: entry.id,
          packageName: entry.packageName,
          version: entry.version,
          source: entry.source,
          activation: entry.activation,
        };
        if (entry.id === "research") return {
          ...common,
          label: "网页研究",
          description: "搜索公开网页并返回带来源的结果；不打开 curator、不读取浏览器 Cookie、不上传媒体。",
          selectable: researchFailure === null,
          status: researchFailure === null ? "ready" : "unavailable",
          reason: researchFailure,
        };
        if (entry.id === "browser") return {
          ...common,
          label: "浏览器操作",
          description: "在网页中执行明确的交互步骤。",
          selectable: false,
          status: "setup_required",
          reason: "需要先安装并验证 agent-browser 可执行文件。",
        };
        if (entry.id === "computer") return {
          ...common,
          label: "电脑控制",
          description: "在本机应用中执行明确授权的操作。",
          selectable: false,
          status: "permission_required",
          reason: "需要先完成辅助功能与屏幕录制授权。",
        };
        return {
          ...common,
          label: "视觉理解",
          description: "分析图片内容。",
          selectable: false,
          status: "consent_required",
          reason: "需要先完成云端提供商、隐私范围和成本披露。",
        };
      }),
  };
}

async function projectMemoryStatus(projectId: string): Promise<MemoryStatus> {
  const workspace = createWorkspace(repoRoot, projectId);
  const [legacyTdai, vectorIndex] = await Promise.all([
    inspectLegacyTdaiMemoryConfiguration(workspace),
    readAssetVectorIndexSummary(repoRoot, projectId),
  ]);
  return buildMemoryStatus(legacyTdai, vectorIndex.state === "ready"
    ? {
        state: "ready",
        assetVectorIndex: "ready",
        embeddingModel: vectorIndex.embeddingModel,
        backend: vectorIndex.backend,
        provider: vectorIndex.provider,
        dim: vectorIndex.dim,
        indexedBlocks: vectorIndex.indexedBlocks,
        builtAt: vectorIndex.builtAt,
      }
    : {
        state: "blocked_missing_vector_index",
        assetVectorIndex: vectorIndex.state,
        indexedBlocks: vectorIndex.indexedBlocks,
      },
  );
}

async function projectSessionInfo(projectId: string, requestedSessionId?: string): Promise<{
  sessionDir: string;
  activeSessionId: string;
  sessions: Array<{
    id: string;
    path: string;
    firstMessage: string;
    displayName: string;
    isProjectSession: boolean;
    updatedAt?: string;
    messageCount: number;
    contextTokens: number | null;
    contextWindow: number | null;
    contextPct: number | null;
    tokenLabel: string;
    compactionCount: number;
    lastCompactionAt?: string;
    lastTokensBefore?: number;
    latestEntryId?: string;
    latestParentId?: string | null;
    lastUserAt?: string;
    lastAssistantAt?: string;
    sessionName?: string;
    namedAt?: string;
    provider?: string;
    modelId?: string;
    thinkingLevel?: PiThinkingLevel;
    inputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    lastCost?: number;
  }>;
  nextSessionMode?: "new";
}> {
  const workspace = createWorkspace(repoRoot, projectId);
  const sessionDir = catAgentSessionDir(workspace);
  // The "active" session is whichever one the workspace is currently viewing (multi-session).
  const activeSessionId = requestedSessionId ?? await resolveSelectedSessionId(projectId);
  const sessions = await SessionManager.list(workspace.root, sessionDir);
  const control = await readJsonFile<{ nextSessionMode?: "new" }>(agentSessionControlPath(projectId), {});
  const modelDefaults = await readModelDefaults();
  const agentSettings = await readAgentSettings(projectId);
  const diagnostics: ServerDiagnostic[] = [];
  const sessionSummaries = await Promise.all(sessions.map(async (session) => {
    const stats = await readSessionStats(session.path, diagnostics, projectId, session.id);
    const provider = stats.provider ?? agentSettings.modelProvider ?? modelDefaults.effectiveProvider;
    const modelId = stats.modelId ?? agentSettings.modelId ?? modelDefaults.effectiveModel;
    const contextWindow = stats.contextWindow ?? await resolveModelContextWindow(provider, modelId);
    return {
      id: session.id,
      path: session.path,
      sessionName: session.name,
      firstMessage: session.firstMessage,
      displayName: session.name ?? compactSessionTitle(session.firstMessage, projectId),
      isProjectSession: session.id === activeSessionId,
      updatedAt: "mtime" in session && typeof session.mtime === "string" ? session.mtime : undefined,
      ...stats,
      provider,
      modelId,
      thinkingLevel: stats.thinkingLevel ?? agentSettings.thinkingLevel ?? modelDefaults.effectiveThinkingLevel,
      contextWindow,
      contextPct: sessionContextPercent(stats.contextTokens, contextWindow),
      tokenLabel: sessionTokenLabel(stats.contextTokens, contextWindow),
    };
  }));
  await appendServerDiagnostics(repoRoot, diagnostics);
  // A freshly-created (not-yet-prompted) session has no file on disk; surface a placeholder
  // so it shows in the rail/chat list and can be switched to immediately.
  if (!sessionSummaries.some((session) => session.id === activeSessionId)) {
    const placeholderContextWindow = await resolveModelContextWindow(
      agentSettings.modelProvider ?? modelDefaults.effectiveProvider,
      agentSettings.modelId ?? modelDefaults.effectiveModel,
    );
    sessionSummaries.push({
      id: activeSessionId,
      path: "",
      sessionName: undefined,
      firstMessage: "",
      displayName: "new session",
      isProjectSession: activeSessionId === catAgentProjectSessionId(workspace),
      updatedAt: new Date().toISOString(),
      messageCount: 0,
      contextTokens: 0,
      contextWindow: placeholderContextWindow,
      contextPct: 0,
      tokenLabel: sessionTokenLabel(0, placeholderContextWindow),
      compactionCount: 0,
      provider: agentSettings.modelProvider ?? modelDefaults.effectiveProvider,
      modelId: agentSettings.modelId ?? modelDefaults.effectiveModel,
      thinkingLevel: agentSettings.thinkingLevel ?? modelDefaults.effectiveThinkingLevel,
    });
  }
  return {
    sessionDir,
    activeSessionId,
    nextSessionMode: control.nextSessionMode,
    sessions: sessionSummaries.sort((a, b) => {
      if (a.id === activeSessionId && b.id !== activeSessionId) return -1;
      if (b.id === activeSessionId && a.id !== activeSessionId) return 1;
      return String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""));
    }),
  };
}

async function piSessionScope(surface: PiSessionSurface, projectId?: string): Promise<PiSessionScope> {
  if (surface === "project") {
    if (!projectId) throw new Error("projectId is required for project Pi sessions");
    const workspace = createWorkspace(repoRoot, projectId);
    const control = await readSelectedSessionControl(agentSelectedSessionPath(projectId));
    const activeSessionId = control.selectedSessionId || await resolveSelectedSessionId(projectId);
    return {
      surface,
      projectId,
      cwd: workspace.root,
      sessionDir: catAgentSessionDir(workspace),
      activeSessionId,
      pendingBranchEntryId: control.pendingBranchEntryId,
    };
  }
  const control = await readSelectedSessionControl(globalSessionControlPath());
  const activeSessionId = control.selectedSessionId || await resolveSelectedGlobalSessionId();
  return {
    surface: "global",
    cwd: repoRoot,
    sessionDir: legacyGlobalDataPath("_pi_sessions"),
    activeSessionId,
    pendingBranchEntryId: control.pendingBranchEntryId,
  };
}

async function readPiSessionsCatalogForRepo(surface: PiSessionSurface, projectId?: string) {
  return buildPiSessionsCatalog(await piSessionScope(surface, projectId));
}

async function readPiSessionTreeForRepo(surface: PiSessionSurface, projectId: string | undefined, sessionId: string) {
  return readPiSessionTree(await piSessionScope(surface, projectId), sessionId);
}

async function readPiSessionEntriesForRepo(surface: PiSessionSurface, projectId: string | undefined, sessionId: string, since?: string) {
  return readPiSessionEntries(await piSessionScope(surface, projectId), sessionId, since);
}

async function renamePiSessionForRepo(surface: PiSessionSurface, projectId: string | undefined, sessionId: string, name: string) {
  const scope = await piSessionScope(surface, projectId);
  const result = await renamePiSession(scope, sessionId, name);
  await appendPiSettingsAudit({ scope: "global", path: `sessions.${scope.surface}.${sessionId}.name` });
  return result;
}

async function deletePiSessionForRepo(surface: PiSessionSurface, projectId: string | undefined, sessionId: string) {
  const scope = await piSessionScope(surface, projectId);
  const result = await deletePiSession(scope, sessionId);
  const fallback = scope.surface === "project" && scope.projectId
    ? catAgentProjectSessionId(createWorkspace(repoRoot, scope.projectId))
    : "la-assistant-global";
  if (scope.activeSessionId === sessionId) {
    if (scope.surface === "project" && scope.projectId) await setSelectedSessionId(scope.projectId, fallback);
    else await setSelectedGlobalSessionId(fallback);
    result.selectedSessionId = fallback;
    result.catalog = await buildPiSessionsCatalog(await piSessionScope(scope.surface, scope.projectId));
  }
  await appendPiSettingsAudit({ scope: "global", path: `sessions.${scope.surface}.${sessionId}.delete` });
  return result;
}

async function branchPiSessionForRepo(input: {
  surface: PiSessionSurface;
  projectId?: string;
  sessionId: string;
  operation: PiSessionBranchOperation;
  entryId?: string;
  name?: string;
}) {
  const scope = await piSessionScope(input.surface, input.projectId);
  if (input.operation === "tree") {
    const result = await validatePiSessionBranchTarget(scope, input.sessionId, input.entryId ?? "");
    if (scope.surface === "project" && scope.projectId) await setProjectPendingBranchEntry(scope.projectId, input.sessionId, result.pendingBranchEntryId!);
    else await setGlobalPendingBranchEntry(input.sessionId, result.pendingBranchEntryId!);
    result.catalog = await buildPiSessionsCatalog(await piSessionScope(scope.surface, scope.projectId));
    await appendPiSettingsAudit({ scope: "global", path: `sessions.${scope.surface}.${input.sessionId}.tree` });
    return result;
  }
  const result = await clonePiSessionBranch(scope, {
    sessionId: input.sessionId,
    operation: input.operation,
    entryId: input.entryId,
    name: input.name,
  });
  if (result.selectedSessionId) {
    if (scope.surface === "project" && scope.projectId) await setSelectedSessionId(scope.projectId, result.selectedSessionId);
    else await setSelectedGlobalSessionId(result.selectedSessionId);
    result.catalog = await buildPiSessionsCatalog(await piSessionScope(scope.surface, scope.projectId));
  }
  await appendPiSettingsAudit({ scope: "global", path: `sessions.${scope.surface}.${input.sessionId}.${input.operation}` });
  return result;
}

async function exportPiSessionForRepo(surface: PiSessionSurface, projectId: string | undefined, sessionId: string, format?: PiSessionExportFormat, outputPath?: string) {
  const scope = await piSessionScope(surface, projectId);
  const result = await exportPiSession(scope, { sessionId, format, outputPath });
  await appendPiSettingsAudit({ scope: "global", path: `sessions.${scope.surface}.${sessionId}.export` });
  return result;
}

async function sharePiSessionForRepo(surface: PiSessionSurface, projectId: string | undefined, sessionId: string) {
  const scope = await piSessionScope(surface, projectId);
  const result = await sharePiSession(scope, { sessionId });
  await appendPiSettingsAudit({ scope: "global", path: `sessions.${scope.surface}.${sessionId}.share` });
  return result;
}

function rpcReplyAsyncDir(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const root = value as Record<string, unknown>;
  const data = root.data && typeof root.data === "object" ? root.data as Record<string, unknown> : undefined;
  const details = data?.details && typeof data.details === "object" ? data.details as Record<string, unknown> : undefined;
  return typeof details?.asyncDir === "string" ? details.asyncDir : undefined;
}

async function spawnWorkflowSubagent(projectId: string, workflowId: string, roleId: TeamRoleId, request: TeamRoleSubagentSpawnRequest): Promise<unknown> {
  return agentRunQueue(`agent:${projectId}`, async () => {
    const releaseRunStart = activeAgentRuns.acquireRunStartLease();
    try {
      const workspace = createWorkspace(repoRoot, projectId);
      const workflow = await readCatWorkflowRun(repoRoot, projectId, workflowId);
      if (!workflow.taskId) throw new Error(`Team workflow ${workflowId} is not linked to a canonical Task.`);
      if (!request.params.sessionDir) throw new Error(`Team role ${roleId} has no server-owned child session scope.`);
      const agentSettings = await readAgentSettings(projectId);
      const modelDefaults = await readModelDefaults();
      const permissionOptions = await projectPermissionSessionOptions(projectId, undefined, workflow.taskId, workflowId);
      const resources = await resolveTaskRunResources("team", { cwd: repoRoot });
      const taskPackageResources = await resolveTaskPackageRunResourcesForRepo(projectId, workflow.taskId);
      const packageExecution = await resolveTeamChildPackageExecution(taskPackageResources.resolvedResources);
      if (packageExecution.mode === "blocked") {
        throw new Error(`Task Package profile cannot run in Team: ${packageExecution.blockers.join(" ")}`);
      }
      if (!resources.verifiedPiBinaryPath) {
        throw new Error("Team Run resource resolution did not return a verified Pi child binary.");
      }
      if (packageExecution.mode === "pi_subagents") bindVerifiedPiSubagentBinary(resources.verifiedPiBinaryPath);
      let sessionAbort: (() => Promise<void>) | undefined;
      const interactionHost = createTaskExtensionInteractionHost({
        repoRoot,
        projectId,
        taskId: workflow.taskId,
        runId: workflowId,
        agentThreadId: `${workflowId}.${roleId}`,
        ...(packageExecution.provenance ? { requestProvenance: packageExecution.provenance } : {}),
        onFatalError: async () => { await sessionAbort?.(); },
      });
      const childScope = await readTeamEvidenceChildScope(repoRoot, join(request.params.sessionDir, "session.jsonl"));
      if (childScope.projectId !== projectId || childScope.workflowId !== workflowId || childScope.roleId !== roleId) {
        throw new Error(`Team child evidence scope does not match ${projectId}/${workflowId}/${roleId}.`);
      }
      const selectedModelRoles = (workflow.teamSelectedRoleIds?.length ? workflow.teamSelectedRoleIds : [roleId])
        .filter((candidate): candidate is TeamRoleId => !DETERMINISTIC_TEAM_ROLE_IDS.has(candidate));
      if (!selectedModelRoles.includes(roleId)) {
        throw new Error(`Team role ${roleId} is not part of the persisted Run plan.`);
      }
      const childRequestShape = await buildTeamEvidenceChildRequestShape({
        repoRoot,
        roleIds: selectedModelRoles,
        activeToolNames: childScope.allowedTools,
        packageResources: packageExecution.mode === "pi_rpc_v1"
          ? taskPackageResources.resolvedResources.map((resource) => ({
              packageName: resource.packageName,
              version: resource.version,
              resourceType: resource.resourceType,
              resourceId: resource.resourceId,
              integrity: resource.integrity,
            }))
          : undefined,
      });
      const taskWorkspace = createTaskWorkspace(repoRoot);
      const taskSnapshot = await taskWorkspace.open({ projectId, taskId: workflow.taskId });
      const run = taskSnapshot.runs.find((candidate) => candidate.id === workflowId);
      if (!run) throw new Error(`Team Run ${workflowId} is not projected in Task ${workflow.taskId}.`);
      const previousExecutions = run.executionSnapshots;
      const previousExecutionCount = previousExecutions?.length ?? 0;
      const previousExecution = previousExecutions?.at(-1);
      if (!previousExecution || !run.configChanges) {
        throw new Error(`Team Run ${workflowId} predates ExecutionSnapshot authority; start a new Team Run.`);
      }
      const toRevision = previousExecution.configRevision + 1;
      const workerStartedAt = new Date().toISOString();
      const plan = finalizeCatWorkerSessionPlan({
        schemaVersion: 1,
        profile: "team",
        runtimeRoot: repoRoot,
        workspace: { root: workspace.root, projectId: workspace.projectId },
        taskId: workflow.taskId,
        runId: workflowId,
        modelProvider: agentSettings.modelProvider ?? modelDefaults.effectiveProvider ?? null,
        modelId: agentSettings.modelId ?? modelDefaults.effectiveModel ?? null,
        thinkingLevel: agentSettings.thinkingLevel ?? modelDefaults.effectiveThinkingLevel ?? null,
        sessionMode: "new",
        sessionId: null,
        branchEntryId: null,
        preset: "scratch",
        disabledTools: serverOwnedRunDisabledTools(agentSettings.disabledTools),
        isolatedResources: packageExecution.mode === "pi_rpc_v1"
          ? {}
          : mergeTaskPackageIsolatedResources(resources.isolatedResources, taskPackageResources.isolatedResources),
        runOptions: null,
        runtimeExtension: true,
        permissionContract: permissionOptions.permissionContract,
        serverTools: [],
        extensionBinding: true,
        memoryRecall: await confirmedMemoryRecallForCat(projectId),
      });
      const createdSession = await catWorkerRuntime.createSession({
        plan,
        executionIdentity: {
          executionId: `${run.id}.execution.${previousExecutionCount + 1}`,
          threadId: run.rootAgentThreadId,
          turnId: `${workflowId}.${roleId}`,
          runtimeEpochId: `${run.id}.epoch.${toRevision}`,
          configRevision: toRevision,
          executionProfile: previousExecution.executionProfile,
          createdAt: workerStartedAt,
        },
        persistExecutionSnapshot: async (workerSnapshot, supervisorShape) => {
          const promotedManifest = composeTeamRunResourceManifest({
            packages: Array.from(new Map([...resources.manifest.packages, ...taskPackageResources.packages].map((entry) => [entry.name, entry])).values()),
            supervisor: supervisorShape,
            children: childRequestShape,
            previous: run.resourceManifest,
            ...(taskPackageResources.profileRevision > 0 || taskPackageResources.selections.length > 0
              ? {
                  profileRevision: taskPackageResources.profileRevision,
                  profileHash: taskPackageResources.profileHash,
                  resources: taskPackageResources.selections,
                }
              : {}),
          });
          let promotedRun: TaskRun = { ...run, resourceManifest: promotedManifest };
          promotedRun = appendTaskSessionConfigChange(promotedRun, {
            schemaVersion: 1,
            changeId: `${run.id}.config.${toRevision}`,
            runId: run.id,
            threadId: run.rootAgentThreadId,
            actor: "system",
            fromRevision: previousExecution.configRevision,
            toRevision,
            changes: { retrievalProfile: { from: run.resourceManifest?.profile ?? "main", to: promotedManifest.profile } },
            effectiveFrom: "new_runtime_epoch",
            compatibility: "requires_runtime_restart",
            createdAt: workerSnapshot.createdAt,
          });
          promotedRun = appendTaskExecutionSnapshot(promotedRun, {
            ...workerSnapshot,
            promptHash: promotedManifest.systemPromptHash!,
            toolManifestHash: promotedManifest.toolSurfaceHash!,
            resourceSnapshotHash: promotedManifest.resourceIndexHash!,
            contextInputHash: createHash("sha256").update(JSON.stringify({
              workflowId,
              roleId,
              childPolicyHash: childScope.policyHash,
              planHash: run.planHash ?? null,
              requestShapeHash: promotedManifest.requestShapeHash,
            })).digest("hex"),
          });
          await taskWorkspace.appendGenerated({
            projectId,
            taskId: workflow.taskId!,
            runId: workflowId,
            events: [{
              type: "run_upsert",
              agentThreadId: run.rootAgentThreadId,
              occurredAt: workerSnapshot.createdAt,
              run: promotedRun,
            }],
          });
        },
        requestPermissionDecision: permissionOptions.requestPermissionDecision,
        executeServerTool: async () => { throw new Error("Team supervisor has no Host server tools."); },
        requestUi: (uiRequest) => {
          if (uiRequest.method === "select") return interactionHost.uiContext.select(uiRequest.title, uiRequest.options ?? [], uiRequest.dialog);
          if (uiRequest.method === "confirm") return interactionHost.uiContext.confirm(uiRequest.title, uiRequest.message ?? "", uiRequest.dialog);
          if (uiRequest.method === "input") return interactionHost.uiContext.input(uiRequest.title, uiRequest.message, uiRequest.dialog);
          return interactionHost.uiContext.editor(uiRequest.title, uiRequest.message);
        },
        notifyUi: (message, level) => interactionHost.uiContext.notify(message, level),
        libraryPersistence: assistantLibraryStore,
      });
      const session = createdSession.session;
      const eventBus: EventBus = {
        emit: (channel, data) => createdSession.emitExtensionEvent(channel, data),
        on: (channel, handler) => createdSession.onExtensionEvent((candidate, data) => {
          if (candidate === channel) handler(data);
        }),
      };
      sessionAbort = () => session.abort();
      const unbindResultDelivery = packageExecution.mode === "pi_subagents"
        ? bindSubagentResultDeliveryAcknowledgement(eventBus)
        : () => undefined;
      let sessionDisposed = false;
      const disposeSession = (): void => {
        if (sessionDisposed) return;
        sessionDisposed = true;
        unbindResultDelivery();
        void interactionHost.dispose().catch(() => undefined);
        session.dispose();
      };
      interactionHost.bindEvents(eventBus);
      let retainedByActiveRun = false;
      try {
        if (packageExecution.mode === "pi_subagents") await callSubagentRpc(eventBus, "ping", {});
        await mkdir(join(repoRoot, "data", "team-role-outputs"), { recursive: true });
        let directChild: Awaited<ReturnType<typeof startWorkflowTeamChildRpc>> | undefined;
        const reply = packageExecution.mode === "pi_rpc_v1"
          ? await (async () => {
              directChild = await startWorkflowTeamChildRpc({
                repoRoot,
                roleId,
                workflowId,
                request,
                taskPackageResources,
                verifiedPiBinaryPath: resources.verifiedPiBinaryPath!,
                uiContext: interactionHost.uiContext,
              });
              sessionAbort = async () => {
                await directChild?.abort();
                await session.abort();
              };
              return { version: 1, requestId: `direct-${directChild.runId}`, method: "spawn", success: true, data: { details: { asyncDir: directChild.asyncDir } } };
            })()
          : await (async () => {
              const startedAfter = Date.now() - 5_000;
              return spawnSubagentViaRpc(eventBus, request, 15_000, async () =>
                (await listSubagentAsyncStatuses({ sinceMs: startedAfter, agent: teamRoleAgentName(roleId) }))[0]?.asyncDir);
            })();
        const asyncDir = rpcReplyAsyncDir(reply);
        if (asyncDir) {
          const candidateRunId = (await readSubagentAsyncStatus({ asyncDir }).catch(() => undefined))?.status.runId ?? basename(asyncDir);
          const turnId = `workflow-role:${projectId}:${workflowId}:${roleId}:${candidateRunId}`;
          activeAgentRuns.register({
            turnId,
            sessionId: session.sessionId,
            workerId: createdSession.workerId,
            runtimeEpochId: createdSession.runtimeEpochId,
            scope: "workflow_role",
            projectId,
            taskId: workflow.taskId,
            workflowId,
            roleId,
            beforeAbort: () => interactionHost.prepareStop(),
            session: {
              abort: async () => {
                await directChild?.abort();
                await session.abort();
              },
              dispose: disposeSession,
            },
            subagentRunId: candidateRunId,
            subagent: {
              stop: async (runId) => {
                if (directChild) await directChild.stop();
                else await callSubagentRpc(eventBus, "stop", { id: runId });
              },
            },
          });
          retainedByActiveRun = true;
          if (directChild) await directChild.completion;
          const waited = await waitForSubagentAsyncStatus({ asyncDir });
          if (waited.status.runId !== candidateRunId) {
            activeAgentRuns.complete({ turnId });
            retainedByActiveRun = true;
            throw new Error(`Team child status runId ${waited.status.runId} does not match async directory ${candidateRunId}.`);
          }
        }
        return reply;
      } finally {
        if (!retainedByActiveRun) disposeSession();
      }
    } finally {
      releaseRunStart();
    }
  });
}

function workflowRouteDeps(overrides: Partial<WorkflowRouteDeps> = {}): WorkflowRouteDeps {
  return {
    repoRoot,
    json,
    readBody,
    requireString,
    optionalString,
    optionalStringArray,
    optionalBoolean,
    stopActiveRuns: (input) => activeAgentRuns.stop(input),
    completeActiveRuns: (input, error) => activeAgentRuns.complete(input, error),
    spawnSubagentRun: (projectId, workflowId, roleId, request) => spawnWorkflowSubagent(projectId, workflowId, roleId, request),
    continueTeamRunsInBackground: true,
    readProjectAgentSettings: readAgentSettings,
    writeProjectAgentSettings: (id, patch) => writeAgentSettings(id, patch),
    readTaskPackageRunResources: (projectId, taskId) => resolveTaskPackageRunResourcesForRepo(projectId, taskId),
    resolveModelPromptTokenBudget,
    ...overrides,
  };
}

async function runPrivateEvalSingle(
  input: PrivateEvalCanonicalSingleGenerationInput,
): Promise<PrivateEvalCanonicalSingleGenerationResult> {
  const workspace = createWorkspace(repoRoot, input.projectId);
  const agentSettings = await readAgentSettings(input.projectId);
  const modelDefaults = await readModelDefaults();
  const turnId = `eval-single:${input.parentRunId}:${randomUUID()}`;
  const releaseRunStart = activeAgentRuns.acquireRunStartLease();
  let workerCreation: CatWorkerSessionCreation;
  try {
    const plan = finalizeCatWorkerSessionPlan({
      schemaVersion: 1,
      profile: "private_eval",
      runtimeRoot: repoRoot,
      workspace: { root: workspace.root, projectId: workspace.projectId },
      taskId: null,
      runId: turnId,
      modelProvider: input.modelProvider ?? agentSettings.modelProvider ?? modelDefaults.effectiveProvider ?? null,
      modelId: input.modelId ?? agentSettings.modelId ?? modelDefaults.effectiveModel ?? null,
      thinkingLevel: input.thinkingLevel ?? null,
      sessionMode: "memory",
      sessionId: null,
      branchEntryId: null,
      preset: "eval",
      disabledTools: serverOwnedRunDisabledTools(agentSettings.disabledTools),
      runOptions: input.runOptions ?? null,
      isolatedResources: {},
      runtimeExtension: false,
      permissionContract: null,
      serverTools: [],
      extensionBinding: false,
      memoryRecall: await confirmedMemoryRecallForCat(input.projectId),
    });
    workerCreation = await catWorkerRuntime.createSession({
      plan,
      executionIdentity: {
        executionId: `${turnId}.execution.1`,
        threadId: `${turnId}.main`,
        turnId,
        runtimeEpochId: `${turnId}.epoch.1`,
        configRevision: 1,
        executionProfile: null,
        createdAt: new Date().toISOString(),
      },
      persistExecutionSnapshot: async () => undefined,
      requestPermissionDecision: async () => ({ action: "deny", reason: "Private Eval has no runtime tool permissions." }),
      executeServerTool: async () => { throw new Error("Private Eval has no server tools."); },
      requestUi: async () => { throw new Error("Private Eval has no Extension UI."); },
      notifyUi: () => undefined,
      libraryPersistence: assistantLibraryStore,
    });
    const session = workerCreation.session;
    activeAgentRuns.register({
      turnId,
      sessionId: session.sessionId,
      workerId: workerCreation.workerId,
      runtimeEpochId: workerCreation.runtimeEpochId,
      scope: "private_eval",
      projectId: input.projectId,
      parentRunId: input.parentRunId,
      session,
    });
  } finally {
    releaseRunStart();
  }
  const session = workerCreation.session;
  const assistantParts: string[] = [];
  let assistantError: string | undefined;
  let usage: ChatEvent["usage"];
  session.subscribe((event) => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      assistantParts.push(event.assistantMessageEvent.delta);
    }
    if (event.type === "message_end") {
      assistantError = assistantMessageError(event.message) ?? assistantError;
      usage = assistantMessageUsage(event.message) ?? usage;
    }
  });
  let failure: unknown;
  try {
    if (activeAgentRuns.isStoppingOrStopped(turnId)) throw new Error("Private eval stopped before generation started.");
    await promptPrivateEvalSession(session, input.prompt, { label: "Private Eval Single generation", timeoutMs: input.timeoutMs });
    if (assistantError) throw new Error(assistantError);
    return { text: assistantParts.join("").trim(), usage };
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    activeAgentRuns.complete({ turnId }, failure);
  }
}

type TaskAgentRunOptions = {
  expectedRunId?: string;
  segmentId?: string;
  segmentSource?: string;
  parentRunId?: string;
  modelProvider?: string;
  modelId?: string;
  thinkingLevel?: PiThinkingLevel;
  attachmentPaths?: string[];
  attachmentRefs?: string[];
  capabilityIds?: NativeCapabilityPackageId[];
  sessionId: string;
  taskId: string;
  taskScope: TaskScope;
};

const taskSessionKey = (projectId: string, taskId: string): string => `${projectId}\0${taskId}`;

async function confirmedMemoryRecallForCat(projectId: string, query = ""): Promise<string> {
  if (!assistantMemoryStore) throw new Error("SQLite assistant memory storage is not ready.");
  if (!query.trim()) return "";
  const manifest = await readProjectManifest(repoRoot, projectId).catch(() => undefined);
  const report = await searchAssistantMemories(repoRoot, {
    query,
    context: {
      projectId,
      ...(manifest?.targetLanguage ? { locale: manifest.targetLanguage } : {}),
      includePersonal: true,
    },
    store: assistantMemoryStore,
  });
  return formatAssistantMemoryRecallReport(report);
}

async function syncCanonicalTaskTitleToPiSession(input: { projectId: string; taskId: string; title: string }): Promise<void> {
  const live = activeTaskSessionManagers.get(taskSessionKey(input.projectId, input.taskId));
  await syncExistingPiSessionTitle({
    repoRoot,
    projectId: input.projectId,
    sessionId: taskAgentSessionId(input.taskId),
    title: input.title,
    liveManager: live,
  });
}

const taskAutoTitles = createTaskAutoTitleCoordinator({
  repoRoot,
  resolveModel: async (projectId) => {
    const modelDefaults = await readModelDefaults();
    const agentSettings = await readAgentSettings(projectId);
    return {
      provider: agentSettings.modelProvider ?? modelDefaults.effectiveProvider,
      modelId: agentSettings.modelId ?? modelDefaults.effectiveModel,
    };
  },
  generateTitle: async (input) => generateAgentTitle({
    projectId: input.projectId,
    userMessage: input.userMessage,
    assistantText: "The task was created and scoped. Name its requested outcome.",
    provider: input.provider,
    modelId: input.modelId,
    modelRuntime: await getPiModelRuntime(),
  }),
  syncSessionTitle: syncCanonicalTaskTitleToPiSession,
});

function scheduleTaskAutoTitle(input: { projectId: string; taskId: string }): void {
  void taskAutoTitles.schedule(input).catch((error) => {
    safeLogger.warn("task.auto_title_failed", { error });
  });
}

async function stopCanonicalTaskAgent(input: {
  projectId: string;
  taskId: string;
  reason?: string;
  runId?: string;
  mode?: "single" | "team" | "pipeline" | "eval";
}) {
  const { projectId, taskId, reason, runId } = input;
  if (input.mode === "team" && runId) {
    return stopTeamWorkflowRun({ projectId, workflowId: runId, reason }, workflowRouteDeps());
  }
  if (input.mode === "eval" && runId) {
    // ponytail: eval sets are bounded local metadata; add an index only if Stop latency becomes measurable.
    for (const evalSet of await listPrivateEvalSets(repoRoot)) {
      const run = (await listPrivateEvalRuns(repoRoot, evalSet.evalSetId)).find((candidate) => candidate.runId === runId);
      if (run?.projectId === projectId && run.taskId === taskId) {
        return stopPrivateEvalRun({ evalSetId: evalSet.evalSetId, runId, reason }, { repoRoot, activeRuns: activeAgentRuns });
      }
    }
    throw new TaskWorkspaceConflictError(`Eval Run ${runId} is not owned by Task ${taskId}.`);
  }
  const live = await activeAgentRuns.stop({ scope: "project", projectId, taskId, turnId: runId, reason });
  if (live.stopped > 0) return live;
  if (await stopPendingSingleTaskRun({ repoRoot, projectId, taskId, runId, reason })) {
    return { ...live, stopped: 1 };
  }
  // Activation and Stop use the same canonical compare-and-append guard. If
  // activation won while the pending fallback checked, its live handle is now
  // registered and this second bounded lookup closes that race.
  const raced = await activeAgentRuns.stop({ scope: "project", projectId, taskId, turnId: runId, reason });
  return raced.stopped > 0 ? raced : live;
}

async function deliverCanonicalTaskMessage(input: {
  projectId: string;
  taskId: string;
  runId?: string;
  message: string;
  delivery: "steer" | "follow_up";
}) {
  return taskMessageQueue.deliver({
    locator: { kind: "project", projectId: input.projectId, taskId: input.taskId },
    runId: input.runId,
    message: input.message,
    delivery: input.delivery,
  });
}

function runAgentStreaming(
  projectId: string,
  message: string,
  emit: (event: StreamEvent) => void,
  options: TaskAgentRunOptions,
): Promise<ChatEvent[]> {
  return agentRunQueue(`agent:${projectId}:${options.sessionId}`, () => projectTaskRunCoordinator.run(projectId, message, emit, options));
}

const projectTaskRunCoordinator = new ProjectTaskRunCoordinator({
  repoRoot,
  activeRuns: activeAgentRuns,
  messageQueue: taskMessageQueue,
  workerRuntime: catWorkerRuntime,
  readProjectSummary: async (projectId) => (await listProjects(repoRoot)).find((item) => item.projectId === projectId),
  resolveSessionId: resolveSelectedSessionId,
  consumePendingBranchEntry: consumeProjectPendingBranchEntry,
  readAgentSettings,
  readModelDefaults,
  readProviderCatalog: readPiProviderCatalog,
  projectPermissionContract: async (projectId, taskId, operationId) => (
    await projectPermissionSessionOptions(projectId, undefined, taskId, operationId)
  ).permissionContract,
  projectPermissionSessionOptions,
  createSupportSession: createCatWorkerSupportSession,
  readSessionStats: async (path, projectId, sessionId) => readSessionStats(path, undefined, projectId, sessionId),
  projectSessionInfo,
  readTaskPackageRunResources: resolveTaskPackageRunResourcesForRepo,
  prepareTeamExecution: ({ projectId, taskId, runId, reason }) => prepareTeamExecution({
    projectId,
    taskId,
    runId,
    reason,
    deps: workflowRouteDeps(),
  }),
  syncTaskTitle: syncCanonicalTaskTitleToPiSession,
  cancelPermissionDecisions: (sessionId, reason) => permissionDecisionRegistry.cancelForSession(sessionId, reason),
  assistantMemoryStore: () => assistantMemoryStore,
  assistantLibraryStore: () => assistantLibraryStore,
  formatTaskRuntimeScope,
});

function inferBatchId(path: string): string {
  return basename(path)
    .replace(/\.[^.]+$/, "")
    .replace(/[/:]+/g, "-")
    .trim();
}

function safeProjectId(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLocaleLowerCase() || "uploaded-project";
}

function safeUploadName(value: string): string {
  const name = basename(value).replace(/[^\p{Letter}\p{Number}._-]+/gu, "-");
  return name.replace(/^-+|-+$/g, "") || "upload.dat";
}

async function writeUploadedProjectFile(projectId: string, fileName: string, contentBase64: string, allowedExts = [".mxliff", ".mqxliff", ".sdlxliff", ".xliff", ".xlf", ".csv", ".xlsx"]): Promise<string> {
  const safeName = safeUploadName(fileName);
  const ext = extname(safeName).toLocaleLowerCase();
  if (!allowedExts.includes(ext)) {
    throw new Error(`Unsupported upload extension ${ext || "(none)"}.`);
  }
  const rawBase64 = contentBase64.replace(/^data:[^,]+,/, "");
  const bytes = Buffer.from(rawBase64, "base64");
  if (bytes.length === 0) throw new Error(`${fileName} is empty.`);
  if (bytes.length > uploadMaxBytes) {
    throw new Error(`${fileName} is too large (${bytes.length} bytes). Limit is ${uploadMaxBytes} bytes.`);
  }
  const uploadDir = workspacePath(createWorkspace(repoRoot, projectId), "uploads");
  await mkdir(uploadDir, { recursive: true });
  const uploadPath = join(uploadDir, `${Date.now()}-${safeName}`);
  await writeFile(uploadPath, bytes);
  return uploadPath;
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
  const decision = localTransportSecurity.authorize({
    method: req.method,
    pathname: url.pathname,
    origin,
    authorization: req.headers.authorization,
  });
  if (!decision.allowed) {
    json(res, decision.status, { error: { code: decision.code, message: decision.message } });
    return;
  }
  for (const [name, value] of Object.entries(localTransportSecurity.responseHeaders(origin))) res.setHeader(name, value);
  if (req.method === "OPTIONS") {
    res.setHeader("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader("access-control-allow-headers", "authorization,content-type");
    res.writeHead(204).end();
    return;
  }
  const parts = url.pathname.split("/").filter(Boolean);

  if (url.pathname === "/api/health") {
    json(res, 200, runtimeHandshake);
    return;
  }
  if (url.pathname === "/api/runtime/health" && req.method === "GET") {
    json(res, 200, await readRuntimeHealth());
    return;
  }
  if (await handleAgentPermissionRoute(req, res, url, parts, {
    json,
    readBody,
    requireString,
    optionalString,
    permissionDecisionRegistry,
    readAgentPermissionContract,
    writeGlobalAgentPermissionSettings,
    writeProjectAgentPermissionSettings,
    persistPermissionDecision,
  })) {
    return;
  }
  if (url.pathname === "/api/cat/tag-tokens" && req.method === "POST") {
    const body = (await readBody(req)) as Record<string, unknown>;
    const projectId = optionalString(body.projectId);
    const ruleContext = projectId ? await readProjectTagRuleContext(repoRoot, projectId) : undefined;
    json(res, 200, buildTagTokenContract({
      text: optionalString(body.text),
      source: optionalString(body.source),
      target: optionalString(body.target),
    }, ruleContext));
    return;
  }
  if (parts[0] === "api" && parts[1] === "runtime" && parts[2] === "resident" && req.method === "POST") {
    const action = parts[3] as ResidentRuntimeAction | undefined;
    if (!action || !["install", "start", "stop", "restart", "uninstall"].includes(action)) {
      json(res, 404, { error: "resident runtime action not found" });
      return;
    }
    json(res, 200, await runResidentRuntimeAction(action, {
      repoRoot,
      port,
      currentPid: process.pid,
      uptimeSec: Math.round(process.uptime()),
      currentServerOwnsTransport: true,
    }));
    return;
  }
  if (await handleHomeReplacementRoute(req, res, parts, {
    json,
    migratedTaskId: () => legacyHomeReplacementTaskId,
  })) {
    return;
  }
  if (await handleAssistantLibraryRoute(req, res, url, parts, {
    repoRoot,
    json,
    readBody,
    assistantMemoryStore,
    assistantLibraryStore,
    acquireCapabilityMutation: () => activeAgentRuns.tryAcquireResourceMutationLease(),
  })) {
    return;
  }
  if (await handleDocumentCapabilityRoute(req, res, parts, {
    repoRoot,
    json,
    readBody,
    acquireCapabilityMutation: () => activeAgentRuns.tryAcquireResourceMutationLease(),
  })) {
    return;
  }
  if (await handlePackageCenterRoute(req, res, url, parts, {
    repoRoot,
    json,
    readBody,
    packageStorage: lapkgPackageStorage,
    acquireCapabilityMutation: () => activeAgentRuns.tryAcquireResourceMutationLease(),
    invalidateResourceCatalogs: () => {
      mainRunToolCatalog.invalidate();
      invalidateTaskRunResourceCache();
    },
  })) {
    return;
  }
  if (await handleMaintainerRoute(req, res, parts, {
    repoRoot,
    json,
    readBody,
    acquireCapabilityMutation: () => activeAgentRuns.tryAcquireResourceMutationLease(),
    migrate: async ({ candidateRoot, plan }) => {
      const modelRoute = await readModelDefaults();
      return runMaintainerMigrationAgent({
        repoRoot,
        candidateRoot,
        plan,
        modelRuntime: await getPiModelRuntime(),
        modelProvider: modelRoute.effectiveProvider,
        modelId: modelRoute.effectiveModel,
        thinkingLevel: modelRoute.effectiveThinkingLevel,
      });
    },
  })) {
    return;
  }
  if (await handleStandaloneTaskRoute(req, res, url, parts, {
    repoRoot,
    json,
    readBody,
    acceptMessage: (input) => generalAgentRuns.acceptMessage(input),
    subscribeMessageStream: (taskId, listener) => generalAgentRuns.subscribeMessageStream(taskId, listener),
    stop: (input) => generalAgentRuns.stop(input),
    compact: (input) => generalAgentRuns.compact(input),
    fork: (input) => generalAgentRuns.fork(input),
    hasActiveRun: (taskId) => Boolean(activeAgentRuns.find({ scope: "standalone", taskId })),
    messageQueue: taskMessageQueue,
  })) {
    return;
  }
  if (await handlePiSettingsRoute(req, res, url, {
    json,
    readBody,
    requireString,
    readPiSettingsCatalog,
    readPiSettingsAudit,
    readPiUsageCatalog: readPiUsageParityCatalog,
    writePiSetting,
    writePiModelPreference,
    writePiSettingsRaw,
    readPiTrustStatus: readPiTrustStatusForRepo,
    writePiTrustDecision: writePiTrustDecisionForRepo,
    readPiPackagesCatalog,
    upsertPiPackageEntry: upsertPiPackageEntryForRepo,
    deletePiPackageEntry: deletePiPackageEntryForRepo,
    togglePiPackageResource: togglePiPackageResourceForRepo,
    previewPiPackageAction: previewPiPackageActionForRepo,
    runPiPackageAction: runPiPackageActionForRepo,
    readPiKeybindingsCatalog: readPiKeybindingsCatalogForRepo,
    writePiKeybindingAction: writePiKeybindingActionForRepo,
    readNotificationPreferences: readNotificationPreferencesForRepo,
    writeNotificationPreferences: writeNotificationPreferencesForRepo,
    readPiThemesCatalog: readPiThemesCatalogForRepo,
    writePiThemeSelection: writePiThemeSelectionForRepo,
    writePiCustomTheme: writePiCustomThemeForRepo,
    readPiSessionsCatalog: readPiSessionsCatalogForRepo,
    readPiSessionTree: readPiSessionTreeForRepo,
    readPiSessionEntries: readPiSessionEntriesForRepo,
    renamePiSession: renamePiSessionForRepo,
    deletePiSession: deletePiSessionForRepo,
    exportPiSession: exportPiSessionForRepo,
    sharePiSession: sharePiSessionForRepo,
    branchPiSession: branchPiSessionForRepo,
    readPiProviderCatalog,
    readCustomModelsCatalog,
    writeCustomModelsRaw,
    upsertCustomModelProvider,
    deleteCustomModelProvider,
    upsertCustomModel,
    deleteCustomModel,
    startPiProviderLogin: startPiProviderLoginForRepo,
    readPiProviderLogin: readPiProviderLoginForRepo,
    answerPiProviderLogin: answerPiProviderLoginForRepo,
    cancelPiProviderLogin: cancelPiProviderLoginForRepo,
    logoutPiProviderAuth: logoutPiProviderAuthForRepo,
    appendPiSettingsAudit,
  })) {
    return;
  }
  if (url.pathname === "/api/diagnostics" && req.method === "GET") {
    const limit = Number(url.searchParams.get("limit") ?? 200);
    json(res, 200, { diagnostics: await readServerDiagnostics(repoRoot, limit) });
    return;
  }
  if (await handleAgentCatalogRoute(req, res, url, {
    json,
    listAgentSkills,
    listAgentPrompts,
    readModelDefaults,
    listAgentToolMetadata,
    readAgentBridgeCatalog,
    readNativeCapabilityCatalog,
  })) {
    return;
  }
  if (await handleEvalRoute(req, res, parts, {
    repoRoot,
    json,
    readBody,
    requireString,
    optionalString,
    runSingleGeneration: runPrivateEvalSingle,
    runTeamWorkflow: (input) => runPrivateEvalCanonicalTeam({
      repoRoot,
      ...input,
      workflowDeps: workflowRouteDeps({ continueTeamRunsInBackground: false }),
      activeRuns: activeAgentRuns,
    }),
    resolveModelPromptTokenBudget,
    activeRuns: activeAgentRuns,
  })) {
    return;
  }
  if (url.pathname === "/api/projects" && req.method === "GET") {
    const result = await listProjectsWithDiagnostics(repoRoot);
    await appendServerDiagnostics(repoRoot, result.diagnostics);
    json(res, 200, result);
    return;
  }
  if (await handleStorageRoute(req, res, parts, {
    repoRoot,
    json,
    readBody,
    hasActiveRuns: () => activeAgentRuns.list().length > 0,
  })) {
    return;
  }
  if (url.pathname === "/api/projects" && req.method === "POST") {
    const body = (await readBody(req)) as Record<string, unknown>;
    const rootPath = requireString(body.rootPath, "rootPath");
    const projectId = optionalString(body.projectId);
    const { manifest, path } = await createProjectManifest(repoRoot, rootPath, {
      projectId,
      projectName: optionalString(body.projectName),
      sourceLanguage: requireString(body.sourceLanguage, "sourceLanguage"),
      targetLanguage: requireString(body.targetLanguage, "targetLanguage"),
      assetRoleOverrides: Array.isArray(body.assetRoleOverrides) ? body.assetRoleOverrides as never : undefined,
    });
    json(res, 200, { manifest, path });
    return;
  }
  if (await handleUploadImportRoute(req, res, url, {
    repoRoot,
    json,
    readBody,
    requireString,
    optionalString,
    safeProjectId,
    inferBatchId,
    writeUploadedProjectFile,
    readProjectManifest,
    createProjectManifest,
    isEnoent,
    importPhraseBatch,
    importMqxliffBatch,
    importSdlxliffBatch,
    importGenericXliffBatch,
    importCsvBatch,
    importXlsxBatch,
  })) {
    return;
  }
  if (parts[0] === "api" && parts[1] === "projects" && parts.length >= 3) {
    const projectId = decodeURIComponent(parts[2]);
    if (parts.length === 3 && req.method === "DELETE") {
      const result = await deleteProjectWorkspace(repoRoot, projectId);
      json(res, result.deleted ? 200 : 404, result);
      return;
    }
    if (await handleVoiceRoute(req, res, parts, projectId, {
      repoRoot,
      json,
      readBody,
      requireString,
      optionalString,
    })) {
      return;
    }
    if (await handleTagRuleRoute(req, res, parts, projectId, {
      repoRoot,
      json,
      readBody,
      requireString,
      optionalNumber,
      readProjectTagRules,
      createManualProjectTagRuleCandidate,
      confirmProjectTagRule,
      disableProjectTagRule,
      declareNoProjectTagRules,
      readBatch,
      buildProjectTagRuleEvidence,
      discoverTagRulesFromEvidence,
      writeProjectTagRuleCandidates,
      askTagRuleModelForProject,
    })) {
      return;
    }
    if (await handleQualityChecklistRoute(req, res, parts, projectId, {
      repoRoot,
      json,
      readBody,
      readQualityChecklist,
      parseQualityChecklistEntries,
      parseMechanicalTextQaOptions,
      writeQualityChecklist,
    })) {
      return;
    }
    if (await handleAssetRoute(req, res, parts, projectId, {
      repoRoot,
      json,
      readBody,
      requireString,
      optionalString,
      optionalBoolean,
      readProjectManifest,
      planWorkbookAssetImport,
      importWorkbookAssetPlan,
      parseAsset,
      suggestAssetMappings,
      askAssetMappingModelForProject,
      parseWorkbookTypedAsset,
      readAssetTypedIndex,
      confirmTypedAssetCandidates,
      readAssetMappingProfiles,
      saveAssetMappingProfile,
      readTermbaseEntries,
      readTermbaseOverrides,
      readTermHistoryIndex,
      auditTermbaseConflicts,
      upsertTermbaseOverride,
      grepAssets,
      readAssetText,
      readWorkbookNativePreview,
      readWorkbookSheetPage,
    })) {
      return;
    }
    if (await handleWorkflowArtifactRoute(req, res, parts, projectId, {
      repoRoot,
      json,
      readBody,
      requireString,
      optionalString,
      optionalStringArray,
      optionalBoolean,
      optionalNumber,
    })) {
      return;
    }
    if (parts[3] === "source-context" && req.method === "GET") {
      json(res, 200, await readSourceContextIndex(repoRoot, projectId));
      return;
    }
    if (parts.length === 3 && req.method === "GET") {
      const manifest = await readProjectManifest(repoRoot, projectId);
      const summaries = await listProjects(repoRoot);
      json(res, 200, { manifest, summary: summaries.find((item) => item.projectId === projectId) ?? null });
      return;
    }
    if (await handleTaskWorkspaceRoute(req, res, url, parts, projectId, {
      repoRoot,
      json,
      readBody,
      scheduleAutoTitle: scheduleTaskAutoTitle,
      specialistFollowUp: {
        start: (input) => startSpecialistFollowUp(input, workflowRouteDeps()),
      },
      taskPackageProfile: {
        read: ({ projectId, taskId }) => readTaskPackageProfileForRepo(projectId, taskId),
        preview: previewTaskPackageProfileForRepo,
        apply: applyTaskPackageProfileForRepo,
      },
      agentRuntime: {
        requireString,
        optionalString,
        sseHeaders,
        writeSse: (target, event) => writeSse(target, event as StreamEvent),
        runAgentStreaming: (id, message, emit, options) => runAgentStreaming(id, message, (event) => emit(event), options),
        stopAgent: stopCanonicalTaskAgent,
        deliverMessage: deliverCanonicalTaskMessage,
        messageQueue: taskMessageQueue,
        projectSessionInfo,
        compactProjectAgentSession: (projectId, taskId, customInstructions, sessionId) => (
          projectTaskRunCoordinator.compact(projectId, taskId, customInstructions, sessionId)
        ),
      },
    })) {
      return;
    }
    if (await handleProjectAgentSettingsRoute(req, res, parts, projectId, {
      json,
      readBody,
      readAgentSettings,
      writeAgentSettings: (id, patch) => writeAgentSettings(id, patch as Partial<AgentSettings>),
    })) {
      return;
    }
    if (parts[3] === "memory" && parts[4] === "status" && req.method === "GET") {
      json(res, 200, await projectMemoryStatus(projectId));
      return;
    }
    if (parts[3] === "memory" && parts[4] === "guidance" && parts.length === 5 && req.method === "GET") {
      json(res, 200, { guidance: await readProjectGuidance(createWorkspace(repoRoot, projectId)) });
      return;
    }
    if (parts[3] === "memory" && parts[4] === "guidance" && parts.length === 5 && req.method === "PUT") {
      const body = (await readBody(req)) as { guidance?: unknown };
      if (!Array.isArray(body.guidance) || !body.guidance.every(isProjectGuidanceDecision)) {
        json(res, 400, { error: "guidance must be an array of valid project guidance records." });
        return;
      }
      json(res, 200, { guidance: await writeProjectGuidance(
        createWorkspace(repoRoot, projectId),
        body.guidance as ProjectGuidanceDecision[],
      ) });
      return;
    }
    if (await handleWorkflowRoute(req, res, parts, projectId, workflowRouteDeps())) {
      return;
    }
    if (await handleBatchRoute(req, res, url, parts, projectId, {
      repoRoot,
      json,
      markdown,
      readBody,
      requireString,
      optionalString,
      optionalStringArray,
      optionalBoolean,
    })) {
      return;
    }
  }

  text(res, 404, "Not Found");
}

const dataMigration = await migrateRuntimeDataSchemaV2(repoRoot, { activeRuns: activeAgentRuns.list() });
if (dataMigration.status === "blocked") throw new Error(dataMigration.blockers.join("\n"));
legacyHomeReplacementTaskId = dataMigration.legacyHomeTaskId;
if (dataMigration.status === "migrated") {
  safeLogger.info("runtime.data_migrated", {
    schemaVersion: dataMigration.schemaVersion,
    backupId: dataMigration.backup?.backupId,
  });
}

const taskAggregateSqlite = await prepareTaskAggregateSqliteCutover({
  repoRoot,
  authority: dataRootWriterLease,
  activeRunCount: activeAgentRuns.list().length,
});
activateTaskAggregateSqliteCutover(taskAggregateSqlite);
safeLogger.info("task.storage_authority_ready", {
  authority: taskAggregateSqlite.marker.authority,
  status: taskAggregateSqlite.status,
  taskCount: taskAggregateSqlite.marker.tasks.length,
  inventoryHash: taskAggregateSqlite.marker.inventoryHash,
});

const settingsGrantsTrustSqlite = await prepareSettingsGrantsTrustSqliteCutover({
  repoRoot,
  authority: dataRootWriterLease,
  activeRunCount: activeAgentRuns.list().length,
  ...(piAgentDirOverride ? { piAgentDir: piAgentDirOverride } : {}),
});
safeLogger.info("settings_grants_trust.storage_authority_ready", {
  authority: settingsGrantsTrustSqlite.marker.authority,
  status: settingsGrantsTrustSqlite.status,
  sourceCount: settingsGrantsTrustSqlite.marker.sources.length,
  excludes: settingsGrantsTrustSqlite.marker.excludes,
});

const lapkgSqlite = await prepareLapkgSqliteCutover({
  repoRoot,
  authority: dataRootWriterLease,
  activeRunCount: activeAgentRuns.list().length,
});
lapkgPackageStorage = lapkgSqlite.storage;
safeLogger.info("package.storage_authority_ready", {
  authority: lapkgSqlite.marker.authority,
  status: lapkgSqlite.status,
  packageCount: lapkgSqlite.marker.packageCount,
});

const assistantMemorySqlite = await prepareAssistantMemorySqliteCutover({
  root: repoRoot,
  authority: dataRootWriterLease,
  activeRunCount: activeAgentRuns.list().length,
});
assistantMemoryStore = assistantMemorySqlite.store;
safeLogger.info("assistant_memory.storage_authority_ready", {
  authority: assistantMemorySqlite.marker.authority,
  status: assistantMemorySqlite.status,
  scopeCount: assistantMemorySqlite.marker.scopes.length,
  excludes: assistantMemorySqlite.marker.excludes,
});

const assistantLibrarySqlite = await prepareAssistantLibrarySqliteCutover({
  root: repoRoot,
  authority: dataRootWriterLease,
  activeRunCount: activeAgentRuns.list().length,
});
assistantLibraryStore = assistantLibrarySqlite.persistence;
safeLogger.info("assistant_library.storage_authority_ready", {
  authority: assistantLibrarySqlite.marker.authority,
  status: assistantLibrarySqlite.status,
  scopeCount: assistantLibrarySqlite.marker.scopes.length,
  excludes: assistantLibrarySqlite.marker.excludes,
});

const catCoreSqlite = await prepareCatCoreSqliteCutover({
  root: repoRoot,
  authority: dataRootWriterLease,
  activeRunCount: activeAgentRuns.list().length,
});
activateCatCoreSqliteCutover(catCoreSqlite);
catCoreStorage = catCoreSqlite.repository;
safeLogger.info("cat_core.storage_authority_ready", {
  authority: catCoreSqlite.marker.authority,
  status: catCoreSqlite.status,
  projectCount: catCoreSqlite.marker.projects.length,
  sourceRefCount: catCoreSqlite.marker.sourceRefs,
  excludes: catCoreSqlite.marker.excludes,
});

const catGovernanceSqlite = await prepareCatGovernanceSqliteCutover({
  root: repoRoot,
  authority: dataRootWriterLease,
  activeRunCount: activeAgentRuns.list().length,
});
activateCatGovernanceSqliteCutover(catGovernanceSqlite);
catGovernanceStorage = catGovernanceSqlite.repository;
safeLogger.info("cat_governance.storage_authority_ready", {
  authority: catGovernanceSqlite.marker.authority,
  status: catGovernanceSqlite.status,
  projectCount: catGovernanceSqlite.marker.projects.length,
  excludes: catGovernanceSqlite.marker.excludes,
});

const workflowEvalSqlite = await prepareWorkflowEvalSqliteCutover({
  root: repoRoot,
  authority: dataRootWriterLease,
  activeRunCount: activeAgentRuns.list().length,
});
activateWorkflowEvalSqliteCutover(workflowEvalSqlite);
workflowEvalStorage = workflowEvalSqlite.repository;
safeLogger.info("workflow_eval.storage_authority_ready", {
  authority: workflowEvalSqlite.marker.authority,
  status: workflowEvalSqlite.status,
  records: workflowEvalSqlite.marker.records,
  excludes: workflowEvalSqlite.marker.excludes,
});

const taskExtensionRecovery = await reconcileInterruptedTaskExtensionInteractions({ repoRoot });
if (taskExtensionRecovery.failedRuns > 0) {
  safeLogger.warn("extension.interrupted_runs_failed", { failedRuns: taskExtensionRecovery.failedRuns });
}
for (const diagnostic of taskExtensionRecovery.diagnostics) {
  safeLogger.warn("extension.recovery_skipped", { diagnostic });
}
const lapkgRecovery = await recoverLapkgActivation(repoRoot, { exclusiveStartup: true, storage: lapkgPackageStorage });
if (lapkgRecovery.status === "blocked") {
  throw new Error(`Stable Package Center recovery is blocked: ${lapkgRecovery.reason}`);
}
if (lapkgRecovery.status !== "clean") {
  safeLogger.info("package.recovery_completed", { status: lapkgRecovery.status, reason: lapkgRecovery.reason });
}
const staleDocumentStages = await cleanupExpiredDocumentRouterStages(repoRoot);
if (staleDocumentStages) safeLogger.info("document_router.staging_recovered", { removed: staleDocumentStages });
try {
  const titleRecovery = await taskAutoTitles.recover();
  if (titleRecovery.failed > 0) {
    safeLogger.warn("task.interrupted_title_requests_failed", { failed: titleRecovery.failed });
  }
} catch (error) {
  safeLogger.warn("task.title_recovery_failed", { error });
}

const localServer = createServer((req, res) => {
  dataRootWriterLease.assertOwned().then(() => handle(req, res)).catch((error) => {
    if (error instanceof LocalTransportError) {
      json(res, error.status, { error: { code: error.code, message: error.message } });
      return;
    }
    if (error instanceof StrictApiInputError) {
      json(res, error.status, { error: { code: error.code, message: error.message } });
      return;
    }
    if (error instanceof ActiveAgentRunResourceMutationError) {
      json(res, error.status, { error: { code: error.code, message: error.message } });
      return;
    }
    json(res, 500, { error: error instanceof Error ? error.message : String(error) });
  });
});

await new Promise<void>((resolveReady, rejectReady) => {
  localServer.once("error", rejectReady);
  if (runtimeRendezvous) {
    void prepareRuntimeTransportRoot(unixTransportPaths.root).then(async () => {
      await rm(runtimeRendezvous.socketPath, { force: true });
      localServer.listen(runtimeRendezvous.socketPath, async () => {
        try {
          await secureRuntimeSocket(runtimeRendezvous.socketPath);
          await publishRuntimeRendezvous(unixTransportPaths.rendezvousPath, runtimeRendezvous);
          safeLogger.info("runtime.transport_listening", { transport: "unix" });
          resolveReady();
        } catch (error) {
          localServer.close();
          rejectReady(error);
        }
      });
    }).catch(rejectReady);
    return;
  }
  localServer.listen(port, "127.0.0.1", () => {
    safeLogger.info("runtime.transport_listening", { transport: "legacy-loopback", port });
    resolveReady();
  });
});

let releasingDataRootLease = false;
async function releaseDataRootLeaseAndExit(signal: NodeJS.Signals): Promise<void> {
  if (releasingDataRootLease) return;
  releasingDataRootLease = true;
  try {
    const closed = new Promise<void>((resolveClose) => localServer.close(() => resolveClose()));
    localServer.closeAllConnections();
    await closed;
    if (runtimeRendezvous) await rm(runtimeRendezvous.socketPath, { force: true });
    lapkgPackageStorage?.close();
    assistantMemorySqlite.close();
    assistantLibrarySqlite.close();
    catCoreStorage?.close();
    catGovernanceStorage?.close();
    workflowEvalStorage?.close();
    taskAggregateSqlite.close();
    await dataRootWriterLease.release();
    process.exit(0);
  } catch (error) {
    safeLogger.error("runtime.writer_lease_release_failed", { signal, error });
    process.exit(1);
  }
}
process.once("SIGINT", () => { void releaseDataRootLeaseAndExit("SIGINT"); });
process.once("SIGTERM", () => { void releaseDataRootLeaseAndExit("SIGTERM"); });
