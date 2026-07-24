import { createHash } from "node:crypto";
import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import {
  resolveStandaloneFileGrantAccess,
  type FileGrantV1,
  type AssistantMemoryPersistence,
  assertExecutionProfilePlan,
  parseExecutionProfilePlan,
  type ExecutionProfilePlan,
} from "@linguist-agent/cat-data";
import { buildAgentPermissionContract, type AgentPermissionContract } from "./agentPermissions.js";
import { applySharedPiRuntimeOverrides } from "./piRuntimeOverrides.js";
import {
  buildGeneralResourceSnapshot,
  verifyGeneralResourceSnapshot,
  type GeneralManagedResourcePaths,
  type GeneralResourceSnapshot,
} from "./generalResourceSnapshot.js";

export const GENERAL_BUILTIN_TOOL_NAMES = ["read", "grep", "find", "ls", "edit", "write", "bash"] as const;
export const GENERAL_READ_ONLY_TOOL_NAMES = ["read", "grep", "find", "ls"] as const;
const MEMORY_TOOLS = ["assistant_memory_search", "assistant_memory_propose"] as const;
const READ_ONLY_MEMORY_TOOLS = ["assistant_memory_search"] as const;
const LIBRARY_TOOLS = ["assistant_library_search", "assistant_library_list"] as const;
const DOCUMENT_TOOLS = ["document_extract_evidence", "office_document_operate", "document_extract_layout"] as const;
const PLAN_TOOLS = ["agent_plan_update"] as const;
const PRESENT_TOOLS = ["agent_present"] as const;

export interface GeneralSessionPlanAccess {
  workspaceRoot: string;
  workingDirectory: string;
  grants: FileGrantV1[];
}

export interface GeneralAgentSessionPlanV1 {
  schemaVersion: 1;
  planHash: string;
  runtimeRoot: string;
  taskId: string;
  runId?: string;
  rootAgentThreadId?: string;
  sessionIdSuffix?: string;
  readOnlyChild: boolean;
  agentDir: string;
  modelProvider?: string;
  modelId?: string;
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  /** Immutable server-selected model/profile/budget authority for a new or resumed Run. */
  executionProfilePlan?: ExecutionProfilePlan;
  permissionContract: AgentPermissionContract;
  projectTrusted: boolean;
  sessionFile?: string;
  contextHandoffs: string[];
  delegationEnabled: boolean;
  access: GeneralSessionPlanAccess;
  confirmedMemory: string;
  resourceSnapshot: GeneralResourceSnapshot;
  initialActiveToolNames: string[];
  registeredToolNames: string[];
  promptInputHash: string;
  toolManifestHash: string;
  resourceSnapshotHash: string;
  capabilityGrantHash: string;
  contextInputHash: string;
}

export interface PrepareGeneralAgentSessionPlanInput {
  runtimeRoot: string;
  taskId: string;
  runId?: string;
  rootAgentThreadId?: string;
  sessionIdSuffix?: string;
  readOnlyChild?: boolean;
  agentDir?: string;
  modelProvider?: string;
  modelId?: string;
  thinkingLevel?: GeneralAgentSessionPlanV1["thinkingLevel"];
  executionProfilePlan?: ExecutionProfilePlan;
  permissionContract: AgentPermissionContract;
  projectTrusted?: boolean;
  sessionFile?: string;
  contextHandoffs?: string[];
  delegationEnabled?: boolean;
  managedResources?: GeneralManagedResourcePaths;
  assistantMemoryStore?: AssistantMemoryPersistence;
  /** Immutable Host-selected recall snapshot; the Worker never reads live Memory. */
  confirmedMemory?: string;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function wireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function exactWireFields(row: Record<string, unknown>, allowedFields: readonly string[], label: string): void {
  const allowed = new Set(allowedFields);
  const extra = Object.keys(row).find((field) => !allowed.has(field));
  if (extra) throw new Error(`${label} has unknown field: ${extra}`);
}

function wireString(row: Record<string, unknown>, field: string, label: string, optional = false): string | undefined {
  const value = row[field];
  if (optional && value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}.${field} must be a non-empty string.`);
  return value;
}

function wireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) throw new Error(`${label} must be a string array.`);
  return [...value] as string[];
}

function parseWireGrant(value: unknown): FileGrantV1 {
  const row = wireRecord(value, "General session plan grant");
  exactWireFields(row, ["id", "taskId", "kind", "realPath", "access", "recursive", "createdAt", "revokedAt", "fingerprint"], "General session plan grant");
  for (const field of ["id", "taskId", "realPath", "createdAt", "fingerprint"] as const) wireString(row, field, "General session plan grant");
  if (row.kind !== "file" && row.kind !== "directory") throw new Error("General session plan grant.kind is invalid.");
  if (row.access !== "read" && row.access !== "read_write") throw new Error("General session plan grant.access is invalid.");
  if (typeof row.recursive !== "boolean") throw new Error("General session plan grant.recursive must be a boolean.");
  if (row.revokedAt !== undefined && typeof row.revokedAt !== "string") throw new Error("General session plan grant.revokedAt must be a string.");
  return row as unknown as FileGrantV1;
}

function parseWireResourceSnapshot(value: unknown): GeneralResourceSnapshot {
  const row = wireRecord(value, "General session plan resourceSnapshot");
  exactWireFields(row, ["entries", "extensionPaths", "skillPaths", "promptPaths", "themePaths", "contextFiles", "systemPrompt", "appendSystemPrompt", "resourceSetHash"], "General session plan resourceSnapshot");
  if (!Array.isArray(row.entries)) throw new Error("General session plan resourceSnapshot.entries must be an array.");
  const entries = row.entries.map((entryValue) => {
    const entry = wireRecord(entryValue, "General session plan resource entry");
    exactWireFields(entry, ["type", "path", "resolvedPath", "source", "scope", "origin", "sha256", "sizeBytes"], "General session plan resource entry");
    if (!["extension", "skill", "prompt", "theme", "context", "system", "append_system"].includes(String(entry.type))) throw new Error("General session plan resource entry.type is invalid.");
    if (!["user", "project", "temporary"].includes(String(entry.scope))) throw new Error("General session plan resource entry.scope is invalid.");
    if (entry.origin !== "package" && entry.origin !== "top-level") throw new Error("General session plan resource entry.origin is invalid.");
    for (const field of ["path", "resolvedPath", "source", "sha256"] as const) wireString(entry, field, "General session plan resource entry");
    if (!Number.isSafeInteger(entry.sizeBytes) || (entry.sizeBytes as number) < 0) throw new Error("General session plan resource entry.sizeBytes is invalid.");
    return entry;
  });
  if (!Array.isArray(row.contextFiles)) throw new Error("General session plan resourceSnapshot.contextFiles must be an array.");
  const contextFiles = row.contextFiles.map((contextValue) => {
    const context = wireRecord(contextValue, "General session plan context file");
    exactWireFields(context, ["path", "content"], "General session plan context file");
    wireString(context, "path", "General session plan context file");
    if (typeof context.content !== "string") throw new Error("General session plan context file.content must be a string.");
    return context;
  });
  if (row.systemPrompt !== undefined && typeof row.systemPrompt !== "string") throw new Error("General session plan resourceSnapshot.systemPrompt must be a string.");
  wireString(row, "resourceSetHash", "General session plan resourceSnapshot");
  return {
    entries: entries as unknown as GeneralResourceSnapshot["entries"],
    extensionPaths: wireStringArray(row.extensionPaths, "General session plan resourceSnapshot.extensionPaths"),
    skillPaths: wireStringArray(row.skillPaths, "General session plan resourceSnapshot.skillPaths"),
    promptPaths: wireStringArray(row.promptPaths, "General session plan resourceSnapshot.promptPaths"),
    themePaths: wireStringArray(row.themePaths, "General session plan resourceSnapshot.themePaths"),
    contextFiles: contextFiles as unknown as GeneralResourceSnapshot["contextFiles"],
    ...(row.systemPrompt === undefined ? {} : { systemPrompt: row.systemPrompt }),
    appendSystemPrompt: wireStringArray(row.appendSystemPrompt, "General session plan resourceSnapshot.appendSystemPrompt"),
    resourceSetHash: row.resourceSetHash as string,
  };
}

function normalizeResourceSnapshot(snapshot: GeneralResourceSnapshot): GeneralResourceSnapshot {
  return {
    entries: snapshot.entries.map((entry) => ({
      type: entry.type,
      path: entry.path,
      resolvedPath: entry.resolvedPath,
      source: entry.source,
      scope: entry.scope,
      origin: entry.origin,
      sha256: entry.sha256,
      sizeBytes: entry.sizeBytes,
    })),
    extensionPaths: [...snapshot.extensionPaths],
    skillPaths: [...snapshot.skillPaths],
    promptPaths: [...snapshot.promptPaths],
    themePaths: [...snapshot.themePaths],
    contextFiles: snapshot.contextFiles.map((entry) => ({ path: entry.path, content: entry.content })),
    ...(snapshot.systemPrompt === undefined ? {} : { systemPrompt: snapshot.systemPrompt }),
    appendSystemPrompt: [...snapshot.appendSystemPrompt],
    resourceSetHash: snapshot.resourceSetHash,
  };
}

function toolSurface(input: {
  readOnlyChild: boolean;
  hasDocumentContext: boolean;
  delegationEnabled: boolean;
}): { initial: string[]; registered: string[] } {
  const activeBuiltin = input.readOnlyChild ? [...GENERAL_READ_ONLY_TOOL_NAMES] : [...GENERAL_BUILTIN_TOOL_NAMES];
  const memory = input.readOnlyChild ? [...READ_ONLY_MEMORY_TOOLS] : [...MEMORY_TOOLS];
  const library = [...LIBRARY_TOOLS];
  const registered = [
    ...GENERAL_BUILTIN_TOOL_NAMES,
    ...(input.readOnlyChild ? [] : ["capability_search"]),
    ...memory,
    ...library,
    ...(input.hasDocumentContext && !input.readOnlyChild ? [...DOCUMENT_TOOLS, ...PLAN_TOOLS, ...PRESENT_TOOLS] : []),
    ...(input.delegationEnabled && !input.readOnlyChild ? ["delegate_agent"] : []),
  ];
  const initial = [
    ...activeBuiltin,
    ...(input.readOnlyChild ? [] : ["capability_search"]),
    ...memory,
    ...library,
    ...(input.delegationEnabled && !input.readOnlyChild ? ["delegate_agent"] : []),
  ];
  return { initial: [...new Set(initial)], registered: [...new Set(registered)].sort() };
}

function planShape(plan: Omit<GeneralAgentSessionPlanV1, "planHash">): Omit<GeneralAgentSessionPlanV1, "planHash"> {
  return plan;
}

export function assertGeneralAgentSessionPlan(plan: GeneralAgentSessionPlanV1): void {
  if (plan.schemaVersion !== 1) throw new Error("General session preparation plan schemaVersion must be 1.");
  if (!/^[a-f0-9]{64}$/u.test(plan.planHash)) throw new Error("General session preparation plan hash is invalid.");
  const { planHash, ...shape } = plan;
  if (digest(shape) !== planHash) throw new Error("General session preparation plan hash changed.");
  if (plan.resourceSnapshotHash !== plan.resourceSnapshot.resourceSetHash) {
    throw new Error("General session preparation resource snapshot hash changed.");
  }
  for (const [field, value] of Object.entries({
    promptInputHash: plan.promptInputHash,
    toolManifestHash: plan.toolManifestHash,
    resourceSnapshotHash: plan.resourceSnapshotHash,
    capabilityGrantHash: plan.capabilityGrantHash,
    contextInputHash: plan.contextInputHash,
  })) {
    if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error(`General session preparation ${field} is invalid.`);
  }
  if (plan.executionProfilePlan) {
    assertExecutionProfilePlan(plan.executionProfilePlan);
    if (plan.modelProvider !== plan.executionProfilePlan.model.provider
      || plan.modelId !== plan.executionProfilePlan.model.modelId
      || plan.thinkingLevel !== plan.executionProfilePlan.model.thinkingLevel) {
      throw new Error("General session ExecutionProfile plan differs from the selected model route.");
    }
  }
}

/** Strict parser for the Host-to-worker JSON boundary. Unknown fields never become ambient authority. */
export function parseGeneralAgentSessionPlan(value: unknown): GeneralAgentSessionPlanV1 {
  const row = wireRecord(value, "General session preparation plan");
  exactWireFields(row, [
    "schemaVersion", "planHash", "runtimeRoot", "taskId", "runId", "rootAgentThreadId", "sessionIdSuffix",
    "readOnlyChild", "agentDir", "modelProvider", "modelId", "thinkingLevel", "executionProfilePlan", "permissionContract",
    "projectTrusted", "sessionFile", "contextHandoffs", "delegationEnabled", "access", "confirmedMemory",
    "resourceSnapshot", "initialActiveToolNames", "registeredToolNames", "promptInputHash", "toolManifestHash",
    "resourceSnapshotHash", "capabilityGrantHash", "contextInputHash",
  ], "General session preparation plan");
  if (row.schemaVersion !== 1) throw new Error("General session preparation plan schemaVersion must be 1.");
  for (const field of ["planHash", "runtimeRoot", "taskId", "agentDir", "promptInputHash", "toolManifestHash", "resourceSnapshotHash", "capabilityGrantHash", "contextInputHash"] as const) {
    wireString(row, field, "General session preparation plan");
  }
  for (const field of ["runId", "rootAgentThreadId", "sessionIdSuffix", "modelProvider", "modelId", "sessionFile"] as const) {
    wireString(row, field, "General session preparation plan", true);
  }
  if (row.thinkingLevel !== undefined && !["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(String(row.thinkingLevel))) {
    throw new Error("General session preparation plan.thinkingLevel is invalid.");
  }
  if (row.executionProfilePlan !== undefined) parseExecutionProfilePlan(row.executionProfilePlan);
  for (const field of ["readOnlyChild", "projectTrusted", "delegationEnabled"] as const) {
    if (typeof row[field] !== "boolean") throw new Error(`General session preparation plan.${field} must be a boolean.`);
  }
  if (typeof row.confirmedMemory !== "string") throw new Error("General session preparation plan.confirmedMemory must be a string.");
  const access = wireRecord(row.access, "General session preparation plan.access");
  exactWireFields(access, ["workspaceRoot", "workingDirectory", "grants"], "General session preparation plan.access");
  wireString(access, "workspaceRoot", "General session preparation plan.access");
  wireString(access, "workingDirectory", "General session preparation plan.access");
  if (!Array.isArray(access.grants)) throw new Error("General session preparation plan.access.grants must be an array.");
  const permission = wireRecord(row.permissionContract, "General session preparation plan.permissionContract");
  if (permission.mode !== "ask" && permission.mode !== "auto" && permission.mode !== "custom") throw new Error("General session preparation plan permission mode is invalid.");
  const canonicalPermission = buildAgentPermissionContract({
    mode: permission.mode,
    customRules: wireRecord(permission.customRules, "General session preparation plan.permissionContract.customRules") as AgentPermissionContract["customRules"],
  });
  if (JSON.stringify(permission) !== JSON.stringify(canonicalPermission)) throw new Error("General session preparation plan permission contract is not canonical.");
  const plan = {
    ...row,
    permissionContract: canonicalPermission,
    ...(row.executionProfilePlan === undefined ? {} : { executionProfilePlan: parseExecutionProfilePlan(row.executionProfilePlan) }),
    contextHandoffs: wireStringArray(row.contextHandoffs, "General session preparation plan.contextHandoffs"),
    access: {
      workspaceRoot: access.workspaceRoot as string,
      workingDirectory: access.workingDirectory as string,
      grants: access.grants.map(parseWireGrant),
    },
    resourceSnapshot: parseWireResourceSnapshot(row.resourceSnapshot),
    initialActiveToolNames: wireStringArray(row.initialActiveToolNames, "General session preparation plan.initialActiveToolNames"),
    registeredToolNames: wireStringArray(row.registeredToolNames, "General session preparation plan.registeredToolNames"),
  } as unknown as GeneralAgentSessionPlanV1;
  assertGeneralAgentSessionPlan(plan);
  return plan;
}

export async function prepareGeneralAgentSessionPlan(
  input: PrepareGeneralAgentSessionPlanInput,
): Promise<GeneralAgentSessionPlanV1> {
  const access = await resolveStandaloneFileGrantAccess(input.runtimeRoot, input.taskId);
  const confirmedMemory = input.confirmedMemory ?? "";
  const agentDir = input.agentDir ?? getAgentDir();
  const projectTrusted = input.projectTrusted === true;
  const readOnlyChild = input.readOnlyChild === true;
  const delegationEnabled = input.delegationEnabled === true;
  const settings = SettingsManager.create(access.workingDirectory, agentDir, { projectTrusted });
  applySharedPiRuntimeOverrides(settings);
  const discoveredResourceSnapshot = await buildGeneralResourceSnapshot({
    cwd: access.workingDirectory,
    agentDir,
    settingsManager: settings,
    projectTrusted,
    includeExecutableExtensions: false,
    managedResources: input.managedResources,
  });
  await verifyGeneralResourceSnapshot(discoveredResourceSnapshot);
  const resourceSnapshot = normalizeResourceSnapshot(discoveredResourceSnapshot);
  const tools = toolSurface({
    readOnlyChild,
    hasDocumentContext: Boolean(input.runId && input.rootAgentThreadId),
    delegationEnabled,
  });
  const contextHandoffs = [...(input.contextHandoffs ?? [])];
  const capabilityGrantHash = digest({
    permissionContract: input.permissionContract,
    grants: access.grants.map((grant) => ({ ...grant })).sort((a, b) => a.id.localeCompare(b.id)),
  });
  const contextInputHash = digest({
    taskId: input.taskId,
    runId: input.runId ?? null,
    rootAgentThreadId: input.rootAgentThreadId ?? null,
    contextHandoffs,
  });
  const promptInputHash = digest({
    access,
    confirmedMemory,
    contextHandoffs,
    readOnlyChild,
    systemPrompt: resourceSnapshot.systemPrompt ?? null,
    appendSystemPrompt: resourceSnapshot.appendSystemPrompt,
    contextFiles: resourceSnapshot.contextFiles,
  });
  const toolManifestHash = digest({ initial: tools.initial, registered: tools.registered });
  const shape = planShape({
    schemaVersion: 1,
    runtimeRoot: input.runtimeRoot,
    taskId: input.taskId,
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.rootAgentThreadId ? { rootAgentThreadId: input.rootAgentThreadId } : {}),
    ...(input.sessionIdSuffix ? { sessionIdSuffix: input.sessionIdSuffix } : {}),
    readOnlyChild,
    agentDir,
    ...(input.modelProvider ? { modelProvider: input.modelProvider } : {}),
    ...(input.modelId ? { modelId: input.modelId } : {}),
    ...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
    ...(input.executionProfilePlan ? { executionProfilePlan: input.executionProfilePlan } : {}),
    permissionContract: input.permissionContract,
    projectTrusted,
    ...(input.sessionFile ? { sessionFile: input.sessionFile } : {}),
    contextHandoffs,
    delegationEnabled,
    access,
    confirmedMemory,
    resourceSnapshot,
    initialActiveToolNames: tools.initial,
    registeredToolNames: tools.registered,
    promptInputHash,
    toolManifestHash,
    resourceSnapshotHash: resourceSnapshot.resourceSetHash,
    capabilityGrantHash,
    contextInputHash,
  });
  const plan: GeneralAgentSessionPlanV1 = { ...shape, planHash: digest(shape) };
  assertGeneralAgentSessionPlan(plan);
  return plan;
}

function sameGrant(current: FileGrantV1, planned: FileGrantV1): boolean {
  return current.id === planned.id
    && current.taskId === planned.taskId
    && current.kind === planned.kind
    && current.realPath === planned.realPath
    && current.access === planned.access
    && current.recursive === planned.recursive
    && current.createdAt === planned.createdAt
    && current.fingerprint === planned.fingerprint
    && current.revokedAt === planned.revokedAt;
}

/** Re-resolve only to honor revocation; a live Run can never acquire a grant absent from its Plan. */
export async function resolveGeneralSessionPlanAccess(
  plan: GeneralAgentSessionPlanV1,
): Promise<GeneralSessionPlanAccess> {
  assertGeneralAgentSessionPlan(plan);
  const current = await resolveStandaloneFileGrantAccess(plan.runtimeRoot, plan.taskId);
  if (current.workspaceRoot !== plan.access.workspaceRoot || current.workingDirectory !== plan.access.workingDirectory) {
    throw new Error("General session working-directory authority changed after its preparation plan was fixed.");
  }
  const currentById = new Map(current.grants.map((grant) => [grant.id, grant]));
  return {
    workspaceRoot: plan.access.workspaceRoot,
    workingDirectory: plan.access.workingDirectory,
    grants: plan.access.grants.filter((planned) => {
      const active = currentById.get(planned.id);
      return active !== undefined && sameGrant(active, planned);
    }),
  };
}
