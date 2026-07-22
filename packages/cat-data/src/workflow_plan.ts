import { mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { runDeliveryCheck, type DeliveryReport } from "./delivery.js";
import { runProjectHealthCheck, type ProjectHealthReport } from "./project_health.js";
import { createWorkspace, readJsonFile, workspacePath, writeJsonFile } from "./workspace.js";
import { TEAM_ROLE_IDS, type TeamRoleId } from "./team_workflow.js";

export const CAT_WORKFLOW_INTENTS = [
  "onboard_project",
  "check_assets",
  "import_terminology",
  "translate_batch",
  "edit_batch",
  "proof_batch",
  "review_batch",
  "show_proposals",
  "prepare_delivery",
  "game_localization_team_run",
] as const;

export type CatWorkflowIntent = (typeof CAT_WORKFLOW_INTENTS)[number];
export type CatWorkflowStepStatus = "planned" | "ready" | "blocked" | "needs_approval" | "approved" | "completed" | "skipped";
export type CatWorkflowRunStatus = "blocked" | "waiting_approval" | "ready" | "in_progress" | "completed" | "cancelled" | "stopping" | "stopped" | "failed";

export interface CatWorkflowPlanOptions {
  projectId: string;
  taskId?: string;
  batchId?: string;
  intent?: CatWorkflowIntent;
  userRequest?: string;
}

export interface CatWorkflowPlanStep {
  id: string;
  title: string;
  tool: string;
  reason: string;
  approvalRequired: boolean;
  writesProject: boolean;
  expectedInput?: string;
  blocksUntil?: string;
  status?: CatWorkflowStepStatus;
}

export interface CatWorkflowPlan {
  projectId: string;
  taskId?: string;
  batchId?: string;
  intent: CatWorkflowIntent;
  inferred: boolean;
  userRequest?: string;
  steps: CatWorkflowPlanStep[];
  approvalGates: string[];
}

export interface CatWorkflowReadiness {
  status: "ready" | "blocked" | "needs_approval";
  checkedAt: string;
  notes: string[];
  projectHealth?: Pick<ProjectHealthReport, "status" | "summary" | "issues">;
  delivery?: Pick<DeliveryReport, "status" | "summary" | "blockers" | "warnings">;
}

export interface CatWorkflowRunEvent {
  ts: string;
  kind: "created" | "readiness" | "approved" | "completed" | "cancelled" | "stopped" | "failed" | "note";
  message: string;
  stepIds?: string[];
}

export interface CatWorkflowRun {
  schemaVersion: 1;
  workflowId: string;
  projectId: string;
  taskId?: string;
  batchId?: string;
  status: CatWorkflowRunStatus;
  createdAt: string;
  updatedAt: string;
  plan: CatWorkflowPlan;
  readiness?: CatWorkflowReadiness;
  approvedStepIds: string[];
  completedStepIds: string[];
  currentStepId?: string;
  /** Team preflight snapshot accepted by the user before start/resume. */
  teamPlanHash?: string;
  teamSelectedRoleIds?: TeamRoleId[];
  history: CatWorkflowRunEvent[];
}

export interface CatWorkflowRunSummary {
  workflowId: string;
  projectId: string;
  taskId?: string;
  batchId?: string;
  intent: CatWorkflowIntent;
  status: CatWorkflowRunStatus;
  currentStepId?: string;
  approvalGatesRemaining: number;
  updatedAt: string;
}

const INTENT_KEYWORDS: Array<[CatWorkflowIntent, RegExp[]]> = [
  ["prepare_delivery", [/delivery/i, /deliver/i, /export/i, /交付/, /导出/, /回传/, /上传/]],
  ["game_localization_team_run", [/team/i, /multi[- ]?agent/i, /localization team/i, /团队/, /多\s*agent/i, /多角色/]],
  ["show_proposals", [/proposal/i, /proposed/i, /changes/i, /建议/, /提案/, /修改清单/]],
  ["import_terminology", [/term/i, /termbase/i, /glossary/i, /术语/, /词汇表/, /query表/i]],
  ["proof_batch", [/proof/i, /proofread/i, /\bP\b/, /终校/, /终审/, /校最终/, /检查译文/]],
  ["edit_batch", [/edit/i, /\bE\b/, /review/i, /校对/, /审校/, /审阅/]],
  ["translate_batch", [/translate/i, /translation/i, /first[- ]?pass/i, /首译/, /翻译/, /译这个批次/, /写译文/]],
  ["check_assets", [/asset/i, /fresh/i, /health/i, /reference/i, /资产/, /资料/, /新文件/, /更新/]],
  ["onboard_project", [/onboard/i, /setup/i, /new project/i, /新项目/, /建项目/, /导入项目/]],
];

function step(
  id: string,
  title: string,
  tool: string,
  reason: string,
  options: Pick<CatWorkflowPlanStep, "approvalRequired" | "writesProject"> & Partial<Pick<CatWorkflowPlanStep, "expectedInput" | "blocksUntil">>,
): CatWorkflowPlanStep {
  return { id, title, tool, reason, ...options };
}

export function inferCatWorkflowIntent(userRequest?: string): CatWorkflowIntent {
  const text = userRequest?.trim() ?? "";
  for (const [intent, patterns] of INTENT_KEYWORDS) {
    if (patterns.some((pattern) => pattern.test(text))) return intent;
  }
  return "check_assets";
}

function approvalGatesFor(steps: CatWorkflowPlanStep[]): string[] {
  return steps
    .filter((item) => item.approvalRequired)
    .map((item) => `${item.id}: approve before ${item.tool}`);
}

function safeWorkflowId(value: string): string {
  return value.replace(/[/:]+/g, "-").replace(/\s+/g, "-").replace(/[^A-Za-z0-9_.-]+/g, "").slice(0, 90) || "workflow";
}

function workflowRoot(workspaceRoot: string, projectId: string): string {
  return workspacePath(createWorkspace(workspaceRoot, projectId), "workflows");
}

export function workflowRunPath(workspaceRoot: string, projectId: string, workflowId: string): string {
  return join(workflowRoot(workspaceRoot, projectId), `${safeWorkflowId(workflowId)}.json`);
}

function approvedSet(run: Pick<CatWorkflowRun, "approvedStepIds">): Set<string> {
  return new Set(run.approvedStepIds);
}

function remainingApprovalSteps(run: CatWorkflowRun): CatWorkflowPlanStep[] {
  const approved = approvedSet(run);
  return run.plan.steps.filter((item) => item.approvalRequired && !approved.has(item.id));
}

function nextStep(run: CatWorkflowRun): CatWorkflowPlanStep | undefined {
  const approved = approvedSet(run);
  return run.plan.steps.find((item) => {
    if (run.completedStepIds.includes(item.id)) return false;
    return !item.approvalRequired || approved.has(item.id);
  });
}

function statusForRun(run: CatWorkflowRun): CatWorkflowRunStatus {
  if (run.status === "cancelled" || run.status === "completed" || run.status === "stopping" || run.status === "stopped" || run.status === "failed") return run.status;
  if (run.readiness?.status === "blocked") return "blocked";
  if (run.plan.steps.every((item) => run.completedStepIds.includes(item.id))) return "completed";
  if (remainingApprovalSteps(run).length) return "waiting_approval";
  return nextStep(run) ? "ready" : "in_progress";
}

function markWorkflowRun(run: CatWorkflowRun): CatWorkflowRun {
  const approved = approvedSet(run);
  const steps = run.plan.steps.map((item) => {
    if (run.completedStepIds.includes(item.id)) return { ...item, status: "completed" as const };
    if (run.readiness?.status === "blocked" && item.tool === "delivery_check") return { ...item, status: "blocked" as const };
    if (item.approvalRequired && approved.has(item.id)) return { ...item, status: "approved" as const };
    if (item.approvalRequired) return { ...item, status: "needs_approval" as const };
    return { ...item, status: "ready" as const };
  });
  const next = nextStep({ ...run, plan: { ...run.plan, steps } });
  const status = statusForRun({ ...run, plan: { ...run.plan, steps }, currentStepId: next?.id });
  return {
    ...run,
    status,
    currentStepId: status === "completed" || status === "cancelled" || status === "stopped" || status === "failed" ? undefined : next?.id,
    plan: { ...run.plan, steps },
  };
}

function plannedSteps(intent: CatWorkflowIntent): CatWorkflowPlanStep[] {
  switch (intent) {
    case "onboard_project":
      return [
        step("scan", "Scan project folder and classify assets", "project_onboard", "Create or refresh the project manifest before any batch work.", {
          approvalRequired: false,
          writesProject: true,
          expectedInput: "rootPath, sourceLanguage, targetLanguage, optional assetRoleOverrides",
        }),
        step("confirm-assets", "Resolve asset-role questions", "project_read", "Use manifest questions/warnings to ask only blocking asset questions.", {
          approvalRequired: true,
          writesProject: false,
          blocksUntil: "user confirms ambiguous TM/TB/glossary/reference roles",
        }),
        step("index-readable-assets", "Index confirmed readable assets", "asset_blocks_build", "Make reference/style/source assets searchable evidence.", {
          approvalRequired: false,
          writesProject: true,
          expectedInput: "confirmed assetPath values",
        }),
        step("import-batches", "Import confirmed bilingual batches", "batch_import_phrase, batch_import_mqxliff, batch_import_sdlxliff, batch_import_xliff, batch_import_csv, or batch_import_xlsx", "Create LA batch workspaces only after tag/lock companion files or table columns are known.", {
          approvalRequired: false,
          writesProject: true,
          expectedInput: "mxliffPath + masterXliffPath, mqxliffPath, or sdlxliffPath",
        }),
      ];
    case "check_assets":
      return [
        step("read-manifest", "Read current project manifest", "project_read", "Understand saved root, language pair, asset roles, warnings, and questions.", {
          approvalRequired: false,
          writesProject: false,
        }),
        step("health", "Run deterministic project health", "project_health", "Surface stale assets, unsatisfied imports, delivery blockers, and next tool calls.", {
          approvalRequired: false,
          writesProject: false,
        }),
        step("refresh-if-needed", "Refresh project assets when freshness matters", "project_refresh", "Rescan the source folder and update only the reversible LA workspace manifest; never modify client files.", {
          approvalRequired: false,
          writesProject: true,
        }),
      ];
    case "import_terminology":
      return [
        step("health", "Find unsatisfied terminology imports", "project_health", "Use Suggested Actions and nextActions rather than guessing workbook intent.", {
          approvalRequired: false,
          writesProject: false,
        }),
        step("map-workbook", "Rank workbook sheet/column mappings", "workbook_mapping_candidates", "Prepare source/target/note candidates across noisy multi-sheet workbooks.", {
          approvalRequired: false,
          writesProject: false,
          expectedInput: "assetPath and purpose=termbase|tm|glossary",
        }),
        step("confirm-mapping", "Ask user to confirm authoritative mapping", "workbook_preview", "Preview selected sheet/columns before formal import.", {
          approvalRequired: true,
          writesProject: false,
          blocksUntil: "user confirms sheetName, sourceColumn, targetColumn, and noteColumn",
        }),
        step("import-terms", "Import confirmed terminology rows", "termbase_import_table", "Only write termbase truth after the mapping is explicit.", {
          approvalRequired: false,
          writesProject: true,
        }),
      ];
    case "translate_batch":
      return [
        step("inspect-source", "Inspect source batch page and constraints", "batch_read", "Start from current source, locks, duplicate groups, and tag warnings before first-pass translation.", {
          approvalRequired: false,
          writesProject: false,
        }),
        step("collect-evidence", "Load typed constraints and relevant project evidence", "evidence_pack, constraint_pack, tm_lookup, tm_concordance, termbase_lookup, glossary_lookup, asset_block_search, asset_grep, asset_read", "Use project evidence where terminology, approved wording, or asset context controls a choice; source/context can establish ordinary bilingual accuracy.", {
          approvalRequired: false,
          writesProject: false,
        }),
        step("write-draft-targets", "Write first-pass draft targets", "batch_set_targets", "Persist translated rows as draft CAT targets through the shared write gate; do not create review proposals for first-pass translation.", {
          approvalRequired: false,
          writesProject: true,
          expectedInput: "updates with segmentId, target, and optional evidenceSources for term-sensitive rows",
        }),
        step("translation-summary", "Run post-translation safety summary", "delivery_check", "Report remaining untranslated rows and non-empty target tag/signature blockers without treating empty pre-translation rows as tag mismatches.", {
          approvalRequired: false,
          writesProject: false,
        }),
      ];
    case "edit_batch":
    case "review_batch":
    case "proof_batch":
      return [
        step("inspect-batch", "Inspect translated batch page and risks", "batch_read", "Start from current target state, locks, duplicates, and tag warnings.", {
          approvalRequired: false,
          writesProject: false,
        }),
        step("collect-evidence", "Load typed constraints and relevant project evidence", "evidence_pack, constraint_pack, tm_lookup, termbase_lookup, glossary_lookup, asset_block_search", "Cite returned project evidence for terminology or approved-wording claims; source/target/context can establish ordinary accuracy and consistency.", {
          approvalRequired: false,
          writesProject: false,
        }),
        step("create-proposals", "Create reviewable proposals", "proposal_create", "Store edit/proof changes as proposals first; do not rewrite segment targets silently.", {
          approvalRequired: false,
          writesProject: true,
        }),
        step("apply-approved", "Apply selected approved proposals", "proposal_apply", "Apply only user-approved proposal ids through the shared write gate.", {
          approvalRequired: true,
          writesProject: true,
          blocksUntil: "user approves proposal ids or rejects rows",
        }),
      ];
    case "show_proposals":
      return [
        step("read-proposals", "Read current proposal set", "proposal_read", "Show current proposal statuses and affected rows.", {
          approvalRequired: false,
          writesProject: false,
        }),
        step("render-report", "Render Markdown proposal report", "proposal_report", "Give the user a reviewable change table before apply.", {
          approvalRequired: false,
          writesProject: false,
        }),
        step("apply-approved", "Apply selected proposal rows", "proposal_apply", "Write only selected, approved proposal rows.", {
          approvalRequired: true,
          writesProject: true,
          blocksUntil: "user approves exact proposal ids",
        }),
      ];
    case "prepare_delivery":
      return [
        step("health", "Check project-level readiness", "project_health", "Confirm assets/imports/proposals are not hiding delivery blockers.", {
          approvalRequired: false,
          writesProject: false,
        }),
        step("delivery-check", "Run batch delivery gate", "delivery_check", "Block untranslated editable rows, tag mismatches, locked mutations, duplicate divergence, and unapplied proposals.", {
          approvalRequired: false,
          writesProject: false,
        }),
        step("resolve-blockers", "Resolve blockers before export", "proposal_apply or segment_set_target", "Any write must go through evidence/reason/tag/lock guards.", {
          approvalRequired: true,
          writesProject: true,
          blocksUntil: "delivery_check has no blockers",
        }),
        step("export", "Export the approved deliverable", "export_phrase_mxliff, export_phrase_docx, export_mqxliff, export_sdlxliff, export_xliff, export_csv, or export_xlsx", "Write client deliverable only after the user confirms target format/path.", {
          approvalRequired: true,
          writesProject: true,
          expectedInput: "format-specific output path/template path when needed",
        }),
      ];
    case "game_localization_team_run":
      return TEAM_ROLE_IDS.map((roleId) => step(
        roleId,
        roleId.replace(/_/g, " "),
        `team_role:${roleId}`,
        "Run the localization team role and persist structured artifacts before the next role sees context.",
        {
          approvalRequired: false,
          writesProject: roleId === "lead_linguist_final",
          expectedInput: "workflowId, roleId, structured artifact refs",
        },
      ));
  }
}

export function buildCatWorkflowPlan(options: CatWorkflowPlanOptions): CatWorkflowPlan {
  const inferredIntent = inferCatWorkflowIntent(options.userRequest);
  const intent = options.intent ?? inferredIntent;
  const steps = plannedSteps(intent);
  return {
    projectId: options.projectId,
    ...(options.taskId ? { taskId: options.taskId } : {}),
    batchId: options.batchId,
    intent,
    inferred: !options.intent,
    userRequest: options.userRequest,
    steps,
    approvalGates: approvalGatesFor(steps),
  };
}

function markPlanSteps(plan: CatWorkflowPlan, readiness: CatWorkflowReadiness): CatWorkflowPlan {
  const blocked = readiness.status === "blocked";
  const steps = plan.steps.map((item) => {
    if (blocked && item.tool === "delivery_check") return { ...item, status: "blocked" as const };
    if (item.approvalRequired) return { ...item, status: "needs_approval" as const };
    return { ...item, status: "ready" as const };
  });
  return { ...plan, steps };
}

function projectHealthBlocksIntent(intent: CatWorkflowIntent, projectHealth: ProjectHealthReport | undefined): boolean {
  if (!projectHealth || projectHealth.status !== "fail") return false;
  if (intent === "prepare_delivery") return true;
  return projectHealth.issues.some((issue) => issue.severity === "blocker" && issue.code !== "BATCH_DELIVERY_BLOCKED");
}

export async function evaluateCatWorkflowReadiness(workspaceRoot: string, plan: CatWorkflowPlan): Promise<{ plan: CatWorkflowPlan; readiness: CatWorkflowReadiness }> {
  const notes: string[] = [];
  const checkedAt = new Date().toISOString();
  let projectHealth: ProjectHealthReport | undefined;
  let delivery: DeliveryReport | undefined;

  try {
    projectHealth = await runProjectHealthCheck(workspaceRoot, plan.projectId);
    notes.push(`project_health=${projectHealth.status}`);
    if (projectHealth.issues.length) {
      const nextActions = projectHealth.issues.flatMap((issue) => issue.nextActions ?? []);
      if (nextActions.length) notes.push(`nextActions: showing ${Math.min(5, nextActions.length)}/${nextActions.length}: ${nextActions.slice(0, 5).join(" | ")}`);
    }
  } catch (error) {
    notes.push(`project_health failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (plan.intent === "prepare_delivery") {
    if (!plan.batchId) {
      notes.push("prepare_delivery needs batchId before delivery_check/export.");
    } else {
      try {
        delivery = await runDeliveryCheck(workspaceRoot, plan.projectId, plan.batchId);
        notes.push(`delivery_check=${delivery.status}`);
      } catch (error) {
        notes.push(`delivery_check failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  const hardBlocked =
    (plan.intent === "prepare_delivery" && (!plan.batchId || delivery?.status === "fail")) ||
    projectHealthBlocksIntent(plan.intent, projectHealth) ||
    notes.some((note) => note.includes(" failed:"));
  const needsApproval = !hardBlocked && plan.approvalGates.length > 0;
  const readiness: CatWorkflowReadiness = {
    status: hardBlocked ? "blocked" : needsApproval ? "needs_approval" : "ready",
    checkedAt,
    notes,
    projectHealth: projectHealth ? { status: projectHealth.status, summary: projectHealth.summary, issues: projectHealth.issues } : undefined,
    delivery: delivery ? { status: delivery.status, summary: delivery.summary, blockers: delivery.blockers, warnings: delivery.warnings } : undefined,
  };
  return { plan: markPlanSteps(plan, readiness), readiness };
}

export function renderCatWorkflowPlan(plan: CatWorkflowPlan, readiness?: CatWorkflowReadiness): string {
  const lines: string[] = [
    "# CAT Workflow Plan",
    "",
    `Project: ${plan.projectId}`,
    plan.batchId ? `Batch: ${plan.batchId}` : undefined,
    `Intent: ${plan.intent}${plan.inferred ? " (inferred)" : ""}`,
    plan.userRequest ? `Request: ${plan.userRequest}` : undefined,
    readiness ? `Readiness: ${readiness.status}` : undefined,
    "",
    "## Steps",
  ].filter((line): line is string => Boolean(line));

  for (const [index, item] of plan.steps.entries()) {
    const flags = [
      item.status ? `status=${item.status}` : undefined,
      item.approvalRequired ? "approval_required" : undefined,
      item.writesProject ? "writes_project" : "read_only",
    ]
      .filter(Boolean)
      .join(" · ");
    lines.push(`${index + 1}. ${item.title}`);
    lines.push(`   - tool: ${item.tool}`);
    lines.push(`   - why: ${item.reason}`);
    lines.push(`   - safety: ${flags}`);
    if (item.expectedInput) lines.push(`   - expected input: ${item.expectedInput}`);
    if (item.blocksUntil) lines.push(`   - blocks until: ${item.blocksUntil}`);
  }

  lines.push("");
  lines.push("## Approval Gates");
  if (plan.approvalGates.length) plan.approvalGates.forEach((gate) => lines.push(`- ${gate}`));
  else lines.push("- None.");

  if (readiness) {
    lines.push("");
    lines.push("## Readiness Notes");
    readiness.notes.forEach((note) => lines.push(`- ${note}`));
  }
  return lines.join("\n");
}

export async function createCatWorkflowRun(
  workspaceRoot: string,
  options: CatWorkflowPlanOptions & { workflowId?: string; includeReadiness?: boolean; overwrite?: boolean },
): Promise<{ run: CatWorkflowRun; path: string }> {
  const plan = buildCatWorkflowPlan(options);
  const evaluated = options.includeReadiness ?? true ? await evaluateCatWorkflowReadiness(workspaceRoot, plan) : { plan, readiness: undefined };
  const now = new Date().toISOString();
  const workflowId = safeWorkflowId(options.workflowId ?? `${evaluated.plan.intent}-${now.replace(/[:.]/g, "-")}`);
  const path = workflowRunPath(workspaceRoot, evaluated.plan.projectId, workflowId);
  const existing = await readJsonFile<CatWorkflowRun | null>(path, null);
  if (existing && !options.overwrite) {
    throw new Error(`Workflow run ${workflowId} already exists. Pass overwrite=true to replace it.`);
  }
  const run: CatWorkflowRun = markWorkflowRun({
    schemaVersion: 1,
    workflowId,
    projectId: evaluated.plan.projectId,
    ...(evaluated.plan.taskId ? { taskId: evaluated.plan.taskId } : {}),
    batchId: evaluated.plan.batchId,
    status: "ready",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    plan: evaluated.plan,
    readiness: evaluated.readiness,
    approvedStepIds: existing?.approvedStepIds ?? [],
    completedStepIds: existing?.completedStepIds ?? [],
    history: [
      ...(existing?.history ?? []),
      { ts: now, kind: "created", message: `Workflow ${workflowId} created for intent ${evaluated.plan.intent}.` },
      ...(evaluated.readiness ? [{ ts: now, kind: "readiness" as const, message: `Readiness ${evaluated.readiness.status}.` }] : []),
    ],
  });
  await mkdir(dirname(path), { recursive: true });
  await writeJsonFile(path, run);
  return { run, path };
}

export async function readCatWorkflowRun(workspaceRoot: string, projectId: string, workflowId: string): Promise<CatWorkflowRun> {
  const run = await readJsonFile<CatWorkflowRun | null>(workflowRunPath(workspaceRoot, projectId, workflowId), null);
  if (!run) throw new Error(`Workflow run ${workflowId} not found for project ${projectId}.`);
  return markWorkflowRun(run);
}

/** Link preserved legacy Workflow metadata to its archived canonical Task. */
export async function linkCatWorkflowTask(
  workspaceRoot: string,
  projectId: string,
  workflowId: string,
  taskId: string,
): Promise<CatWorkflowRun> {
  const path = workflowRunPath(workspaceRoot, projectId, workflowId);
  const run = await readJsonFile<CatWorkflowRun | null>(path, null);
  if (!run) throw new Error(`Workflow run ${workflowId} not found for project ${projectId}.`);
  if (run.projectId !== projectId || run.workflowId !== workflowId) throw new Error(`Workflow run ${workflowId} durable scope does not match its storage path.`);
  if (run.taskId && run.taskId !== taskId) throw new Error(`Workflow run ${workflowId} is already linked to Task ${run.taskId}.`);
  if (run.plan.taskId && run.plan.taskId !== taskId) throw new Error(`Workflow plan ${workflowId} is already linked to Task ${run.plan.taskId}.`);
  if (run.taskId === taskId && run.plan.taskId === taskId) return markWorkflowRun(run);
  const linked = { ...run, taskId, plan: { ...run.plan, taskId } };
  await writeJsonFile(path, linked);
  return markWorkflowRun(linked);
}

export async function listCatWorkflowRuns(workspaceRoot: string, projectId: string): Promise<CatWorkflowRunSummary[]> {
  let files: string[] = [];
  try {
    files = (await readdir(workflowRoot(workspaceRoot, projectId))).filter((file) => file.endsWith(".json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const rows = await Promise.all(
    files.map(async (file) => {
      const workflowId = file.replace(/\.json$/, "");
      const run = await readCatWorkflowRun(workspaceRoot, projectId, workflowId);
      return {
        workflowId: run.workflowId,
        projectId: run.projectId,
        ...(run.taskId ? { taskId: run.taskId } : {}),
        batchId: run.batchId,
        intent: run.plan.intent,
        status: run.status,
        currentStepId: run.currentStepId,
        approvalGatesRemaining: remainingApprovalSteps(run).length,
        updatedAt: run.updatedAt,
      } satisfies CatWorkflowRunSummary;
    }),
  );
  return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function completeCatWorkflowStep(
  workspaceRoot: string,
  projectId: string,
  workflowId: string,
  stepId: string,
  note?: string,
): Promise<CatWorkflowRun> {
  const run = await readCatWorkflowRun(workspaceRoot, projectId, workflowId);
  if (!run.plan.steps.some((item) => item.id === stepId)) throw new Error(`Workflow run ${workflowId} has no step ${stepId}.`);
  const now = new Date().toISOString();
  const nextRun = markWorkflowRun({
    ...run,
    completedStepIds: Array.from(new Set([...run.completedStepIds, stepId])),
    updatedAt: now,
    history: [
      ...run.history,
      { ts: now, kind: "completed", message: note ? `Completed ${stepId}. ${note}` : `Completed ${stepId}.`, stepIds: [stepId] },
    ],
  });
  await writeJsonFile(workflowRunPath(workspaceRoot, projectId, workflowId), nextRun);
  return nextRun;
}

export async function stopCatWorkflowRun(
  workspaceRoot: string,
  projectId: string,
  workflowId: string,
  reason?: string,
): Promise<CatWorkflowRun> {
  const run = await readCatWorkflowRun(workspaceRoot, projectId, workflowId);
  if (run.status === "completed") throw new Error(`Workflow run ${workflowId} is completed and cannot be stopped.`);
  const nextRun: CatWorkflowRun = {
    ...run,
    status: "stopped",
    updatedAt: new Date().toISOString(),
    history: [
      ...run.history,
      {
        ts: new Date().toISOString(),
        kind: "stopped",
        message: reason ? `Workflow stopped: ${reason}` : "Workflow stopped.",
      },
    ],
  };
  await writeJsonFile(workflowRunPath(workspaceRoot, projectId, workflowId), nextRun);
  return markWorkflowRun(nextRun);
}

export async function beginStopCatWorkflowRun(
  workspaceRoot: string,
  projectId: string,
  workflowId: string,
  reason?: string,
): Promise<CatWorkflowRun> {
  const run = await readCatWorkflowRun(workspaceRoot, projectId, workflowId);
  if (["completed", "cancelled", "stopped", "failed"].includes(run.status)) {
    throw new Error(`Workflow run ${workflowId} is ${run.status} and cannot be stopped.`);
  }
  if (run.status === "stopping") return run;
  const now = new Date().toISOString();
  const stopping: CatWorkflowRun = {
    ...run,
    status: "stopping",
    updatedAt: now,
    history: [
      ...run.history,
      {
        ts: now,
        kind: "note",
        message: reason ? `Workflow stopping: ${reason}` : "Workflow stopping.",
      },
    ],
  };
  await writeJsonFile(workflowRunPath(workspaceRoot, projectId, workflowId), stopping);
  return markWorkflowRun(stopping);
}

export function renderCatWorkflowRun(run: CatWorkflowRun): string {
  const lines = [
    renderCatWorkflowPlan(run.plan, run.readiness),
    "",
    "## Workflow Run",
    `Run: ${run.workflowId}`,
    `Status: ${run.status}`,
    run.currentStepId ? `Current step: ${run.currentStepId}` : undefined,
    `Approved gates: ${run.approvedStepIds.length ? run.approvedStepIds.join(", ") : "none"}`,
    `Completed steps: ${run.completedStepIds.length ? run.completedStepIds.join(", ") : "none"}`,
    "",
    "## History",
    ...run.history.slice(-12).map((item) => `- ${item.ts} ${item.kind}: ${item.message}`),
  ].filter((line): line is string => Boolean(line));
  return lines.join("\n");
}
