import type {
  ExtensionAPI,
  ToolCallEvent,
  ToolCallEventResult,
  ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import {
  buildProjectContextSnapshot,
  formatAssistantMemoryRecall,
  formatProjectGuidance,
  formatProjectContextSnapshot,
  readProjectGuidance,
  listAssistantMemories,
  readProjectManifest,
  readWorkflowArtifacts,
  workspacePath,
  type CatWorkspace,
} from "@linguist-agent/cat-data";
import { catEvidenceViolations, catToolMetadataFor, prepareCatToolArguments } from "@linguist-agent/cat-tools";
import { isAbsolute, relative, resolve } from "node:path";
import {
  evaluateAgentToolPermissionCall,
  type AgentPermissionContract,
  type AgentPermissionRequest,
  type AgentPermissionUserDecision,
} from "./agentPermissions.js";
import { buildCatCompactionInstructions } from "./catCompaction.js";
import { evaluateCatSafetyToolCall } from "./catSafetyKernel.js";

export interface CatRuntimeValidation {
  checked: true;
  toolName: string;
  warnings: string[];
  errors: string[];
}

interface CatToolResultEventResult {
  content?: ToolResultEvent["content"];
  details?: unknown;
  isError?: boolean;
}

interface CatRuntimeAdvisory {
  citable: false;
  reason: string;
}

interface CatRuntimeAudit {
  checked: true;
  toolName: string;
  warnings: string[];
}

const SCOPED_DOCUMENT_TOOLS = new Set(["document_parse", "document_search", "document_screenshot"]);

async function allowedDocumentRootsForTool(toolName: string, workspace: CatWorkspace): Promise<string[] | undefined> {
  if (!SCOPED_DOCUMENT_TOOLS.has(toolName.toLowerCase())) return undefined;
  const roots = [workspacePath(workspace)];
  const manifest = await readProjectManifest(workspace.root, workspace.projectId).catch(() => undefined);
  if (manifest?.root) roots.push(manifest.root);
  return roots;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function extractCatRuntimeValidation(value: unknown): CatRuntimeValidation | undefined {
  const details = isObject(value) ? value.details : undefined;
  const validation = isObject(details) ? details.catRuntimeValidation : undefined;
  if (!isObject(validation)) return undefined;
  if (validation.checked !== true || typeof validation.toolName !== "string") return undefined;
  const warnings = Array.isArray(validation.warnings)
    ? validation.warnings.filter((entry): entry is string => typeof entry === "string")
    : [];
  const errors = Array.isArray(validation.errors)
    ? validation.errors.filter((entry): entry is string => typeof entry === "string")
    : [];
  return {
    checked: true,
    toolName: validation.toolName,
    warnings,
    errors,
  };
}

function textContent(content: ToolResultEvent["content"]): string {
  return content
    .map((part) => ("text" in part && typeof part.text === "string" ? part.text : ""))
    .join("\n")
    .trim();
}

function replaceMutableObject(target: Record<string, unknown>, next: unknown): void {
  if (!isObject(next)) return;
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, next);
}

function isInsidePath(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

// Path-bearing input fields a write-capable tool may use to name its target. Kept broad so the
// data-store guard does not depend on a single verb's argument naming convention.
const TARGET_PATH_FIELD_KEYS = [
  "path",
  "file_path",
  "filePath",
  "target_path",
  "targetPath",
  "output_path",
  "outputPath",
  "dest",
  "destination",
  "to",
  "output",
  "output_file",
  "outputFile",
  "file",
  "filename",
  "notebook_path",
  "notebookPath",
] as const;

// Array fields whose entries (strings, or objects carrying a target-path field) may name write
// targets, e.g. a multi-file edit verb's `edits: [{ file_path }]` or `files: [...]`.
const TARGET_PATH_ARRAY_KEYS = ["files", "paths", "file_paths", "filePaths", "targets", "edits"] as const;

function collectTargetPathCandidates(input: unknown, depth = 0): string[] {
  if (depth > 3 || !isObject(input)) return [];
  const candidates: string[] = [];
  for (const key of TARGET_PATH_FIELD_KEYS) {
    const value = input[key];
    if (typeof value === "string" && value.trim().length > 0) candidates.push(value);
  }
  for (const key of TARGET_PATH_ARRAY_KEYS) {
    const entries = input[key];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (typeof entry === "string" && entry.trim().length > 0) candidates.push(entry);
      else if (isObject(entry)) candidates.push(...collectTargetPathCandidates(entry, depth + 1));
    }
  }
  return candidates;
}

// Non-CAT tools allowed to reference a path inside data/. Read-only inspection tools legitimately
// read project state; bash writes into data/ are contained at the OS layer (sandbox denyWrite on
// dataRoot) and flagged by auditBashCall, so they are not double-blocked here; network tools never
// touch the local filesystem. Every other non-CAT tool that targets a data/ path is treated as a
// write and blocked by default.
const DATA_STORE_GUARD_EXEMPT_TOOLS = new Set<string>([
  "read",
  "read_file",
  "read_many_files",
  "view",
  "cat",
  "head",
  "tail",
  "grep",
  "glob",
  "ls",
  "list",
  "list_dir",
  "list_directory",
  "find",
  "tree",
  "stat",
  "wc",
  "file_search",
  "document_parse",
  "document_search",
  "document_screenshot",
  "bash",
  "web_search",
  "web_extract",
  "web_fetch",
  "fetch_content",
  "get_search_content",
]);

export function isInsideCatDataStore(workspace: CatWorkspace, candidatePath: string): boolean {
  const dataRoot = resolve(workspace.root, "data");
  const absoluteCandidate = isAbsolute(candidatePath) ? resolve(candidatePath) : resolve(workspace.root, candidatePath);
  return isInsidePath(dataRoot, absoluteCandidate);
}

export function guardNonCatToolCall(
  event: Pick<ToolCallEvent, "toolName" | "input">,
  workspace: CatWorkspace,
): ToolCallEventResult | undefined {
  if (catToolMetadataFor(event.toolName)) return undefined;
  // Default-deny: a non-CAT tool that is not an explicitly-exempt read/bash/network tool and that
  // targets a path inside the CAT data store is blocked, regardless of the tool's name. This closes
  // the prior gap where only the literal "write"/"edit" verbs were guarded, so a newly-added Pi
  // builtin write verb (e.g. multi_edit / apply_patch / create_file) would have bypassed the
  // data-store guard. Known residual: a verb that hides its target path inside an opaque payload
  // (e.g. a unified-diff blob) is not parsed here, and the OS sandbox does not contain node-fs
  // builtins — revisit per-verb if Pi ever ships such a tool.
  if (DATA_STORE_GUARD_EXEMPT_TOOLS.has(event.toolName.toLowerCase())) return undefined;
  const blockedPath = collectTargetPathCandidates(event.input).find((candidate) =>
    isInsideCatDataStore(workspace, candidate),
  );
  if (!blockedPath) return undefined;
  return {
    block: true,
    reason: `CAT data/ store guard blocked ${event.toolName} targeting ${blockedPath}; CAT project state under data/ must change through explicit CAT apply/import/export tools (read-only inspection and bash are exempt).`,
  };
}

export function auditBashCall(event: Pick<ToolCallEvent, "toolName" | "input">): CatRuntimeAudit | undefined {
  const input = event.input as unknown;
  const command = isObject(input) ? input.command : undefined;
  if (event.toolName !== "bash" || typeof command !== "string") return undefined;
  const warnings: string[] = [];
  if (/(^|[;&|]\s*)(rm|mv|cp|cat|tee|sed|perl|python|node|ruby|awk|truncate)\b[^\n]*(data\/|\/data\/)/.test(command)) {
    warnings.push("bash command references data/ with write-capable shell operations; OS sandbox denyWrite remains authoritative.");
  }
  if (/(>|>>|\btee\b)[^\n]*(data\/|\/data\/)/.test(command)) {
    warnings.push("bash command appears to write data/ directly; use CAT apply/import/export tools for project state.");
  }
  return {
    checked: true,
    toolName: event.toolName,
    warnings,
  };
}

export function tagNonCatToolResult(
  event: Pick<ToolResultEvent, "toolName" | "content" | "details" | "isError"> & { input?: Record<string, unknown> },
): CatToolResultEventResult | undefined {
  const metadata = catToolMetadataFor(event.toolName);
  if (metadata && metadata.category !== "bridge") return undefined;
  const details = isObject(event.details) ? event.details : { value: event.details };
  const advisory: CatRuntimeAdvisory = {
    citable: false,
    reason: "Inherited Pi or built-in tool output is advisory until a CAT evidence/proposal tool records the relevant excerpt.",
  };
  const audit = event.toolName === "bash" && event.input ? auditBashCall({ toolName: event.toolName, input: event.input }) : undefined;
  return {
    details: {
      ...details,
      catRuntimeAdvisory: advisory,
      ...(audit ? { catRuntimeAudit: audit } : {}),
    },
  };
}

export async function buildCatAgentTurnContext(workspace: CatWorkspace): Promise<string> {
  // Durable project guidance is recall context, not a Task approval or CAT
  // evidence source. It may steer future turns across sessions.
  const guidanceBlock = formatProjectGuidance(await readProjectGuidance(workspace).catch(() => []));
  const [projectMemories, personalPreferences] = await Promise.all([
    listAssistantMemories(workspace.root, { kind: "project", projectId: workspace.projectId }, { status: "active" }),
    listAssistantMemories(workspace.root, { kind: "personal" }, { status: "active", kind: "preference" }),
  ]);
  const projectMemoryBlock = formatAssistantMemoryRecall(projectMemories);
  const personalPreferenceBlock = formatAssistantMemoryRecall(personalPreferences);
  const memoryBlock = projectMemoryBlock || personalPreferenceBlock
    ? [
        "Memory authority for this CAT Task:",
        "- Project memory is recall-only and cannot replace current client assets, approved terminology, evidence, or hard gates.",
        "- Personal memory is limited to expression preferences and cannot override Project memory.",
        projectMemoryBlock ? `Project memory:\n${projectMemoryBlock}` : undefined,
        personalPreferenceBlock ? `Personal expression preferences:\n${personalPreferenceBlock}` : undefined,
      ].filter(Boolean).join("\n")
    : "";
  let base: string;
  try {
    const snapshot = await buildProjectContextSnapshot(workspace.root, workspace.projectId, { includeHealth: true });
    base = formatProjectContextSnapshot(snapshot);
  } catch (error) {
    base = [
      "Linguist Agent CAT project context:",
      `- project_id: ${workspace.projectId}`,
      `- workspace_root: ${workspace.root}`,
      `- context_warning: ${error instanceof Error ? error.message : String(error)}`,
      "- policy: use CAT tools for project authority; term/terminology writes require returned evidenceSources. Source/target/context can establish ordinary accuracy and consistency.",
      "- policy: tool_trace is audit data, not evidence; project memory is recall context, not citable CAT evidence.",
      "- policy: locked rows and unsafe tag changes must remain blocked.",
    ].join("\n");
  }
  const reinjection = await buildCatCriticalReinjectionBlock(workspace);
  return [base, guidanceBlock, memoryBlock, reinjection].filter(Boolean).join("\n");
}

export async function buildCatCriticalReinjectionBlock(workspace: CatWorkspace): Promise<string> {
  try {
    const artifacts = await readWorkflowArtifacts(workspace.root, workspace.projectId);
    const unresolvedQa = artifacts.phraseQaRows.filter((row) => row.disposition === "unresolved").length;
    const retainedQa = artifacts.phraseQaRows.filter((row) => row.disposition === "retained_true_issue" || row.disposition === "retained_unconfirmed").length;
    const blockedBackfill = artifacts.backfillRows.filter((row) => row.state === "blocked" || row.state === "current_mismatch" || row.state === "readback_failed").length;
    const uncertainBackfill = artifacts.backfillRows.filter((row) => row.decision === "uncertain").length;
    const riskRows = artifacts.riskQueue
      .slice(0, 5)
      .map((row) => `  - ${row.segmentId}: ${row.risks.join(", ")} · ${row.reason}`)
      .join("\n") || "  - none";
    const authorityRows = artifacts.authorityDecisions
      .slice(0, 5)
      .map((row) => `  - ${row.decisionKey}: ${row.winner.tier} -> ${row.winner.target ?? row.winner.label}`)
      .join("\n") || "  - none";
    const blockedChecks = artifacts.browserAutomationChecks.filter((row) => ["blocked", "failed", "timeout"].includes(row.status));
    const checkRows = blockedChecks
      .slice(0, 5)
      .map((row) => `  - ${row.operation}:${row.status}:${row.error ?? row.checkpoint}`)
      .join("\n") || "  - none";
    return [
      "CAT-critical compaction reinjection:",
      "- source: workflow_artifacts + project health; bounded context only, no raw logs.",
      "- evidence_policy: memory is recall context only; tool trace is audit only; cite TM/TB/glossary/assets/web excerpts for CAT claims.",
      `- pending_phrase_qa: unresolved=${unresolvedQa}, retained=${retainedQa}`,
      `- pending_backfill: blocked=${blockedBackfill}, uncertain=${uncertainBackfill}`,
      `- platform_checks: blocked=${blockedChecks.length}; showing ${Math.min(5, blockedChecks.length)} of ${blockedChecks.length}`,
      checkRows,
      `- risk_queue: showing ${Math.min(5, artifacts.riskQueue.length)} of ${artifacts.riskQueue.length}; read canonical artifacts before assuming the preview is complete`,
      riskRows,
      `- authority_decisions: showing ${Math.min(5, artifacts.authorityDecisions.length)} of ${artifacts.authorityDecisions.length}; read canonical artifacts before relying on omitted decisions`,
      authorityRows,
    ].join("\n");
  } catch (error) {
    return [
      "CAT-critical compaction reinjection:",
      `- source_warning: ${error instanceof Error ? error.message : String(error)}`,
      "- evidence_policy: use CAT tools for fresh evidence; do not rely on memory or trace as citable evidence.",
    ].join("\n");
  }
}

export async function buildCatCompactionInstructionsForWorkspace(workspace: CatWorkspace, userInstructions?: string): Promise<string> {
  const snapshot = await buildProjectContextSnapshot(workspace.root, workspace.projectId, { includeHealth: true }).catch(() => undefined);
  const reinjection = await buildCatCriticalReinjectionBlock(workspace);
  return buildCatCompactionInstructions({
    projectId: snapshot?.projectId ?? workspace.projectId,
    projectRoot: snapshot?.projectRoot ?? workspace.root,
    batches: snapshot?.batches,
    customInstructions: [
      reinjection,
      userInstructions?.trim() ? `User compaction note:\n${userInstructions.trim()}` : undefined,
    ].filter(Boolean).join("\n\n"),
  });
}

export function normalizeAndGuardCatToolCall(event: Pick<ToolCallEvent, "toolName" | "input">): ToolCallEventResult | undefined {
  const metadata = catToolMetadataFor(event.toolName);
  if (!metadata) return undefined;
  const prepared = prepareCatToolArguments(event.input);
  replaceMutableObject(event.input, prepared);
  if (metadata.requiresEvidenceFor?.length) {
    const violations = catEvidenceViolations(event.input);
    if (violations.length) {
      return {
        block: true,
        reason: `CAT evidence gate blocked ${event.toolName}: ${violations.join("; ")}`,
      };
    }
  }
  return undefined;
}

export function validateCatToolResult(event: Pick<ToolResultEvent, "toolName" | "content" | "details" | "isError">): CatToolResultEventResult | undefined {
  const metadata = catToolMetadataFor(event.toolName);
  if (metadata?.category === "bridge") return undefined;
  if (!metadata) return undefined;

  const warnings: string[] = [];
  const errors: string[] = [];
  if (!textContent(event.content)) {
    errors.push(`${event.toolName} returned an empty textual result`);
  }
  if (metadata.mutatesProject && metadata.access !== "read") {
    warnings.push(`${event.toolName} mutated project state`);
  }

  const validation: CatRuntimeValidation = {
    checked: true,
    toolName: event.toolName,
    warnings,
    errors,
  };
  const details = isObject(event.details) ? event.details : { value: event.details };

  if (errors.length && !event.isError) {
    const content: ToolResultEvent["content"] = [
      {
        type: "text",
        text: `CAT tool result validation failed: ${errors.join("; ")}`,
      },
    ];
    return {
      content,
      isError: true,
      details: {
        ...details,
        catRuntimeValidation: validation,
      },
    };
  }

  return {
    details: {
      ...details,
      catRuntimeValidation: validation,
    },
  };
}

export interface CatRuntimePermissionOptions {
  contract?: AgentPermissionContract;
  sessionId?: () => string | undefined;
  requestDecision?: (request: AgentPermissionRequest) => Promise<AgentPermissionUserDecision>;
}

export function createCatRuntimeExtension(workspace: CatWorkspace, permissions: CatRuntimePermissionOptions = {}) {
  return (pi: ExtensionAPI) => {
    registerCatRuntimeHooks(pi, workspace, permissions);
  };
}

export function registerCatRuntimeHooks(pi: ExtensionAPI, workspace: CatWorkspace, permissions: CatRuntimePermissionOptions = {}): void {
  pi.registerCommand("cat-compact", {
    description: "Compact this project session with CAT-specific preservation instructions.",
    handler: async (args, ctx) => {
      ctx.compact({
        customInstructions: await buildCatCompactionInstructionsForWorkspace(workspace, args),
        onComplete: () => ctx.ui.notify("CAT-aware Pi compaction completed.", "info"),
        onError: (error) => ctx.ui.notify(`CAT-aware Pi compaction failed: ${error.message}`, "error"),
      });
    },
  });

  pi.on("session_before_compact", (event, ctx) => {
    ctx.ui.setStatus("la-cat-compaction", `CAT compaction: ${event.reason}${event.willRetry ? "; retry pending" : ""}`);
  });

  pi.on("session_compact", (_event, ctx) => {
    ctx.ui.setStatus("la-cat-compaction", undefined);
  });

  pi.on("before_agent_start", async () => {
    const content = await buildCatAgentTurnContext(workspace);
    return {
      message: {
        customType: "la-cat-runtime-context",
        content,
        display: false,
        details: {
          projectId: workspace.projectId,
          source: "cat-runtime",
        },
      },
    };
  });

  pi.on("tool_call", async (event) => {
    const hardGuard = evaluateCatSafetyToolCall(event, {
      workspaceRoot: workspace.root,
      allowedDocumentRoots: await allowedDocumentRootsForTool(event.toolName, workspace),
    })
      ?? normalizeAndGuardCatToolCall(event)
      ?? guardNonCatToolCall(event, workspace);
    if (hardGuard) return hardGuard;
    if (!permissions.contract) return undefined;
    return evaluateAgentToolPermissionCall({
      toolName: event.toolName,
      input: event.input,
      contract: permissions.contract,
      projectId: workspace.projectId,
      sessionId: permissions.sessionId?.(),
      requestDecision: permissions.requestDecision,
    });
  });
  pi.on("tool_result", (event) => validateCatToolResult(event) ?? tagNonCatToolResult(event));
}
