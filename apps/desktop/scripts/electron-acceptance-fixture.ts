#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createTaskWorkspace, type TaskRunEventDraft } from "../../../packages/cat-data/src/task_workspace.ts";
import JSZip from "jszip";
import type {
  TaskActivity,
  TaskAgentThread,
  TaskArtifact,
  TaskDecision,
  TaskRun,
  TaskRunStatus,
  TaskWorkspaceSnapshot,
} from "../../../packages/cat-data/src/task_workspace_contract.ts";
import { assertIsolatedRuntimeURL } from "./electron-acceptance-lib.mjs";

const run = promisify(execFile);
const FIXTURE = "electron-acceptance-stress";
const PRIMARY_REPO = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const PROJECTS = {
  primary: "electron-acceptance-primary",
  secondary: "electron-acceptance-secondary",
} as const;
const BATCHES = {
  cat1040: "electron-variable-1040",
  cat10000: "electron-variable-10000",
  secondary: "electron-variable-256",
} as const;

function argument(name: string, required = true): string | undefined {
  const equals = process.argv.find((value) => value.startsWith(`${name}=`));
  const index = process.argv.indexOf(name);
  const value = equals?.slice(name.length + 1) ?? (index >= 0 ? process.argv[index + 1] : undefined);
  if (required && (!value || value.startsWith("--"))) throw new Error(`${name} is required.`);
  return value;
}

const repoRoot = resolve(argument("--repo-root")!);
const runtimeURL = assertIsolatedRuntimeURL(argument("--runtime-url")!);
const replace = process.argv.includes("--replace");

async function assertSafeRoot(): Promise<void> {
  if (repoRoot === PRIMARY_REPO) throw new Error("The primary repository data root is never an acceptance fixture target.");
  if (repoRoot.startsWith("/private/tmp/") || repoRoot.startsWith("/tmp/")) return;
  const gitMarker = await stat(join(repoRoot, ".git")).catch(() => null);
  if (!gitMarker?.isFile()) throw new Error("Outside /tmp, --repo-root must be an explicit linked Git worktree.");
  const ignored = await run("/usr/bin/git", ["-C", repoRoot, "check-ignore", "data/"]).then(() => true, () => false);
  if (!ignored) throw new Error("Linked-worktree data/ must be ignored before fixture generation.");
}

async function assertReplaceableProject(projectId: string): Promise<boolean> {
  const workspace = join(repoRoot, "data", "projects", projectId);
  const markerPath = join(workspace, "electron-acceptance-fixture.json");
  const exists = await access(workspace).then(() => true, () => false);
  if (!exists) return false;
  if (!replace) throw new Error(`${projectId} already exists; pass --replace only for an owned synthetic fixture.`);
  const marker = JSON.parse(await readFile(markerPath, "utf8").catch(() => "null"));
  if (marker?.fixture !== FIXTURE || marker?.containsCustomerData !== false || marker?.projectId !== projectId) {
    throw new Error(`Refusing to replace unowned project workspace ${projectId}.`);
  }
  return true;
}

async function assertReplaceableGlobalManifest(): Promise<void> {
  const path = join(repoRoot, "data", "electron-acceptance-fixture.json");
  const raw = await readFile(path, "utf8").catch(() => null);
  if (raw === null) return;
  const marker = JSON.parse(raw);
  if (marker?.fixture !== FIXTURE || marker?.containsCustomerData !== false) {
    throw new Error("Refusing to overwrite an unowned data/electron-acceptance-fixture.json.");
  }
  if (!replace) throw new Error("The acceptance fixture already exists; pass --replace to regenerate it.");
}

const baseTime = Date.parse("2026-07-16T00:00:00.000Z");
let clockTick = 0;
const now = () => new Date(baseTime + clockTick++ * 1_000).toISOString();
const at = (offset: number) => new Date(baseTime + offset * 1_000).toISOString();

const sourceVariants = [
  "Synthetic compact menu label.",
  "Synthetic quest dialogue with enough words to wrap naturally in a narrow localization table.",
  "Synthetic system description for a game localization acceptance fixture. A second sentence forces genuine variable-height measurement without truncation.",
  "Synthetic combat tutorial: press {0}, wait for [A1B2C3], then confirm the result before leaving this deliberately long instructional line.",
];
const targetVariants = [
  "合成短菜单标签。",
  "这是一条长度足以在较窄本地化表格中自然换行的合成任务对话。",
  "这是游戏本地化验收夹具中的合成系统说明。第二句话用于强制真实可变行高测量，不能依靠截断。",
  "合成战斗教程：按下 {0}，等待 [A1B2C3]，然后在离开这条刻意写长的说明前确认结果。",
];

function makeSegments(count: number, prefix: string) {
  return Array.from({ length: count }, (_, offset) => {
    const index = offset + 1;
    const variant = offset % sourceVariants.length;
    const source = sourceVariants[variant]!;
    const target = targetVariants[variant]!;
    const status = index % 11 === 0 ? "draft" : index % 7 === 0 ? "new" : "confirmed";
    const id = `${prefix}-${String(index).padStart(5, "0")}`;
    return {
      index, id, contextNote: index % 29 === 0 ? "Synthetic UI context; no customer content." : "",
      source, target: status === "new" ? "" : target,
      originalTarget: status === "new" ? "" : target,
      rawSource: source, rawTarget: status === "new" ? "" : target,
      locked: index % 97 === 0, status, duplicateKey: `${prefix}-unique-${index}`,
      duplicateGroupSize: 1, duplicateOrdinal: 1, duplicateFirstSegmentId: id, duplicateRole: "unique",
      placeholderCount: variant === 3 ? 2 : 0, unresolvedPlaceholderCount: 0,
      unresolvedRuntimePlaceholderCount: 0, unresolvedTagPlaceholderCount: 0,
      unresolvedPlaceholders: [], unresolvedRuntimePlaceholders: [], unresolvedTagPlaceholders: [], updatedAt: at(index),
    };
  });
}

function xmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

function inlineCell(ref: string, value: string): string {
  return `<c r="${ref}" t="inlineStr"><is><t>${xmlText(value)}</t></is></c>`;
}

async function writeSyntheticWorkbook(
  path: string,
  segments: ReturnType<typeof makeSegments>,
): Promise<void> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);
  zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Segments" sheetId="1" r:id="rId1"/></sheets>
</workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`);
  const header = `<row r="1">${inlineCell("A1", "SegmentID")}${inlineCell("B1", "Source")}${inlineCell("C1", "Target")}${inlineCell("D1", "State")}${inlineCell("E1", "Note")}</row>`;
  const rows = segments.map((segment, index) => {
    const row = index + 2;
    return `<row r="${row}">${inlineCell(`A${row}`, segment.id)}${inlineCell(`B${row}`, segment.source)}${inlineCell(`C${row}`, segment.target)}${inlineCell(`D${row}`, segment.status)}${inlineCell(`E${row}`, segment.contextNote)}</row>`;
  }).join("");
  zip.file("xl/worksheets/sheet1.xml", `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${header}${rows}</sheetData></worksheet>`);
  await writeFile(path, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}

async function writeProject(projectId: string, name: string, batches: Array<{ id: string; rows: number }>) {
  const projectRoot = join(repoRoot, "fixture-source", projectId);
  const workspace = join(repoRoot, "data", "projects", projectId);
  await mkdir(projectRoot, { recursive: true });
  await mkdir(workspace, { recursive: true });
  const timestamp = now();
  const project = {
    schemaVersion: 1, projectId, projectName: name, root: projectRoot,
    sourceLanguage: "en-US", targetLanguage: "zh-CN", createdAt: timestamp, updatedAt: timestamp,
    scan: { root: projectRoot, scannedAt: timestamp, assets: [], phraseTagPairs: [], warnings: [], questions: [], importPlan: [], suggestedActions: [], countsByRole: {} },
    assetRoleDecisions: [], phraseTagPairs: [], importPlan: [], warnings: [], questions: [],
  };
  await writeFile(join(workspace, "project.json"), `${JSON.stringify(project, null, 2)}\n`);
  for (const batchSpec of batches) {
    const segments = makeSegments(batchSpec.rows, batchSpec.id);
    const batchTimestamp = now();
    const sourceFile = join(projectRoot, `${batchSpec.id}.xlsx`);
    await writeSyntheticWorkbook(sourceFile, segments);
    const batch = {
      schemaVersion: 1, format: "xlsx_paste", projectId, batchId: batchSpec.id,
      sourceFile, sourceLanguage: "en-US", targetLanguage: "zh-CN",
      workflowStage: "edit", createdAt: batchTimestamp, updatedAt: batchTimestamp,
      tagReport: {
        totalSegments: batchSpec.rows, placeholderSegments: segments.filter((segment) => segment.placeholderCount > 0).length,
        masterMatchedSegments: batchSpec.rows, masterUnmatchedSegments: 0, replacedPlaceholders: 0,
        unresolvedPlaceholders: 0, unresolvedRuntimePlaceholders: 0, unresolvedTagPlaceholders: 0, tagCountMismatches: 0,
      },
      duplicateSourceGroups: [], segments,
    };
    const batchDirectory = join(workspace, "batches", batchSpec.id);
    await mkdir(batchDirectory, { recursive: true });
    await writeFile(join(batchDirectory, "batch.json"), `${JSON.stringify(batch)}\n`);
  }
  await writeFile(join(workspace, "electron-acceptance-fixture.json"), `${JSON.stringify({ schemaVersion: 1, fixture: FIXTURE, projectId, containsCustomerData: false }, null, 2)}\n`);
}

const workspace = createTaskWorkspace(repoRoot, { now });
type TaskSpec = { projectId: string; taskId: string; batchId: string; status: TaskRunStatus; activities?: number; artifactDecision?: boolean };

function activity(snapshot: TaskWorkspaceSnapshot, index: number): TaskActivity {
  const run = snapshot.runs[0]!;
  const thread = snapshot.agentThreads[0]!;
  const type = index % 13 === 0 ? "evidence_read" : index % 17 === 0 ? "tool_action" : "progress";
  const id = `${snapshot.task.id}.activity.${String(index).padStart(4, "0")}`;
  return {
    id, taskId: snapshot.task.id, runId: run.id, agentThreadId: thread.id, seq: 0, type, status: "done",
    actor: { kind: "agent", id: "linguist-agent", displayName: "Linguist Agent", agentThreadId: thread.id },
    title: type === "evidence_read" ? "Synthetic evidence read" : type === "tool_action" ? "Synthetic safe tool action" : `Synthetic progress ${index}`,
    body: `Synthetic acceptance activity ${index}; contains no customer text and no hidden reasoning.`,
    tool: type === "tool_action" || type === "evidence_read"
      ? { name: type === "evidence_read" ? "synthetic_evidence_read" : "synthetic_read", effect: "read", target: "synthetic fixture", outcome: "complete" }
      : null,
    refs: { artifactIds: [], evidenceRefs: type === "evidence_read" ? [`synthetic:evidence:${index}`] : [], decisionIds: [], segmentIds: [] },
    createdAt: at(20_000 + index), updatedAt: at(20_000 + index),
  };
}

async function createTask(spec: TaskSpec): Promise<TaskWorkspaceSnapshot> {
  let snapshot = await workspace.create({
    projectId: spec.projectId, taskId: spec.taskId, title: `Synthetic ${spec.status} task`,
    intent: "Exercise the Electron acceptance harness with synthetic canonical state.", kind: "general",
    initialMessage: "Run the synthetic acceptance scenario without any model call.",
    scope: { batchId: spec.batchId, segmentIds: [], sourceLocale: "en-US", targetLocale: "zh-CN" },
  });
  const runRecord = snapshot.runs[0]!;
  const thread = snapshot.agentThreads[0]!;
  const total = spec.activities ?? 1;
  for (let start = 2; start <= total; start += 100) {
    const end = Math.min(total, start + 99);
    const drafts: TaskRunEventDraft[] = [];
    for (let index = start; index <= end; index++) drafts.push({ type: "activity_append", agentThreadId: thread.id, activity: activity(snapshot, index) });
    snapshot = await workspace.appendGenerated({ projectId: spec.projectId, taskId: spec.taskId, runId: runRecord.id, events: drafts });
  }
  const timestamp = now();
  const terminal = ["stopped", "failed", "stale", "complete"].includes(spec.status);
  // Non-terminal synthetic states model a Team lifecycle. Startup recovery
  // correctly fails orphaned Single/Package sessions, so using a fake Single
  // handle here would destroy the very state matrix this owned fixture exists
  // to verify after every isolated-runtime restart.
  const mode = terminal ? runRecord.mode : "team";
  const events: TaskRunEventDraft[] = [
    { type: "run_upsert", agentThreadId: thread.id, run: { ...runRecord, mode, status: spec.status, startedAt: spec.status === "pending" ? null : timestamp, updatedAt: timestamp, completedAt: terminal ? timestamp : null, stopAvailable: !terminal && spec.status !== "awaiting_input" && spec.status !== "waiting", resumeAvailable: spec.status === "stopped" || spec.status === "failed" } },
    { type: "thread_upsert", agentThreadId: thread.id, thread: { ...thread, status: spec.status, updatedAt: timestamp } },
  ];
  let qualityRunId: string | null = null;
  let qualityRunEvents: TaskRunEventDraft[] = [];
  if (spec.status === "failed") events.push({ type: "activity_append", agentThreadId: thread.id, activity: { ...activity(snapshot, total + 1), id: `${spec.taskId}.failure`, type: "error", status: "error", title: "Synthetic failure", body: "Synthetic failure state for renderer acceptance." } });
  if (spec.artifactDecision) {
    const artifactId = `${spec.taskId}.artifact`;
    const specialistThreadId = `${spec.taskId}.specialist.localization-qa`;
    const interactionId = `${spec.taskId}.interaction`;
    const focusedSegmentId = `${spec.batchId}-00001`;
    const decisionIds = [0, 1, 2, 3].map((index) => `${spec.taskId}.decision.${index + 1}`);
    const mainReplyAt = now();
    const specialistStartedAt = now();
    const evidenceAt = now();
    const specialistCompletedAt = now();
    const artifactAt = now();
    const specialistThread: TaskAgentThread = {
      id: specialistThreadId,
      taskId: spec.taskId,
      runId: runRecord.id,
      parentThreadId: thread.id,
      identity: {
        kind: "specialist",
        roleId: "localization-qa",
        displayName: "Localization QA",
        roleLabel: "Specialist",
        disclosureLabel: "Agent",
      },
      status: "complete",
      canReceiveUserMessage: true,
      handoffSummary: "Reviewed placeholders, terminology evidence, and delivery risk for this Batch.",
      latestActivityId: `${spec.taskId}.specialist.final`,
      childThreadIds: [],
      createdAt: specialistStartedAt,
      updatedAt: specialistCompletedAt,
    };
    const mainReply: TaskActivity = {
      id: `${spec.taskId}.main.reply`, taskId: spec.taskId, runId: runRecord.id, agentThreadId: thread.id, seq: 0,
      type: "message", status: "done",
      actor: { kind: "agent", id: "linguist-agent", displayName: "Linguist Agent", agentThreadId: thread.id },
      title: "Scope confirmed",
      body: "I’ll ask Localization QA to inspect the Batch evidence, then bring the result and any required decision back into this conversation.",
      tool: null, refs: { artifactIds: [], evidenceRefs: [], decisionIds: [], segmentIds: [] },
      createdAt: mainReplyAt, updatedAt: mainReplyAt,
    };
    const evidenceRead: TaskActivity = {
      id: `${spec.taskId}.specialist.evidence`, taskId: spec.taskId, runId: runRecord.id, agentThreadId: specialistThreadId, seq: 0,
      type: "evidence_read", status: "done",
      actor: { kind: "agent", id: "localization-qa", displayName: "Localization QA", agentThreadId: specialistThreadId },
      title: "Checked Batch evidence",
      body: "Checked synthetic terminology, placeholder, and delivery-readiness evidence without reading customer data.",
      tool: { name: "synthetic_evidence_read", effect: "read", target: "owned acceptance fixture", outcome: "complete" },
      refs: { artifactIds: [], evidenceRefs: ["synthetic:evidence:terminology", "synthetic:evidence:placeholders"], decisionIds: [], segmentIds: [focusedSegmentId] },
      createdAt: evidenceAt, updatedAt: evidenceAt,
    };
    const specialistReply: TaskActivity = {
      id: `${spec.taskId}.specialist.final`, taskId: spec.taskId, runId: runRecord.id, agentThreadId: specialistThreadId, seq: 0,
      type: "final_response", status: "done",
      actor: { kind: "agent", id: "localization-qa", displayName: "Localization QA", agentThreadId: specialistThreadId },
      title: "QA review ready",
      body: "The synthetic QA report is ready. Placeholder structure is intact, and the next step needs an explicit approval before this Task can continue.",
      tool: null, refs: { artifactIds: [artifactId], evidenceRefs: ["synthetic:evidence:terminology", "synthetic:evidence:placeholders"], decisionIds, segmentIds: [focusedSegmentId] },
      createdAt: specialistCompletedAt, updatedAt: specialistCompletedAt,
    };
    const artifact: TaskArtifact = {
      id: artifactId, taskId: spec.taskId, runId: runRecord.id, type: "qa_report", status: "reviewable",
      title: "Synthetic QA report", summary: "Inspectable synthetic evidence with no customer content.",
      scope: { ...snapshot.task.scope, segmentIds: [focusedSegmentId] }, version: 0,
      provenance: { agentThreadId: specialistThreadId, activityId: evidenceRead.id, evidenceRefs: ["synthetic:evidence:report"], parentArtifactIds: [] },
      availableDecisions: ["approve", "request_change"], content: { synthetic: true, findingCount: 2 }, createdAt: artifactAt, updatedAt: artifactAt,
    };
    const decisionBase = {
      taskId: spec.taskId,
      runId: runRecord.id,
      requestedByThreadId: thread.id,
      artifactId,
      status: "required" as const,
      interactionId,
      selectedOptionId: null,
      selectedOptionIds: [],
      responseText: null,
      reason: null,
      scope: snapshot.task.scope,
      createdAt: artifactAt,
      decidedAt: null,
    };
    const decisions: TaskDecision[] = [
      {
        ...decisionBase,
        id: decisionIds[0]!, kind: "approval", questionIndex: 0, selectionMode: "single",
        prompt: "Approve the synthetic QA report?",
        options: [
          { id: "approve", label: "Approve", action: "approve", destructive: false, description: "Accept the synthetic report.", preview: "No customer data is changed." },
          { id: "revise", label: "Request changes", action: "request_change", destructive: false, description: "Keep the report reviewable.", preview: "Creates no write outside this fixture." },
        ],
      },
      {
        ...decisionBase,
        id: decisionIds[1]!, kind: "answer", questionIndex: 1, selectionMode: "multiple",
        prompt: "Which QA risks should the Specialist address next?",
        options: [
          { id: "terminology", label: "Terminology", action: "answer", destructive: false, description: "Check preferred terms and conflicts." },
          { id: "placeholders", label: "Placeholders", action: "answer", destructive: false, description: "Re-check runtime and tag placeholders." },
          { id: "freeform", label: "Another risk", action: "answer", destructive: false, description: "Add a risk not listed here." },
        ],
      },
      {
        ...decisionBase,
        id: decisionIds[2]!, kind: "answer", questionIndex: 2, selectionMode: "freeform",
        prompt: "What should the release note tell the localization team?",
        options: [{ id: "freeform", label: "Write an answer", action: "answer", destructive: false }],
      },
      {
        ...decisionBase,
        id: decisionIds[3]!, kind: "answer", questionIndex: 3, selectionMode: "single",
        prompt: "How should the Task continue after approval?",
        options: [
          { id: "cat", label: "Open CAT review", action: "answer", destructive: false, description: "Continue with focused segment review.", preview: "Keeps all changes behind the canonical CAT apply gate." },
          { id: "pause", label: "Pause here", action: "answer", destructive: false, description: "Keep the Task waiting for later." },
        ],
      },
    ];
    events.push(
      { type: "activity_append", agentThreadId: thread.id, activity: mainReply },
      { type: "thread_upsert", agentThreadId: specialistThreadId, thread: specialistThread },
      { type: "thread_upsert", agentThreadId: thread.id, thread: { ...thread, status: spec.status, childThreadIds: [...new Set([...thread.childThreadIds, specialistThreadId])], updatedAt: specialistCompletedAt } },
      { type: "activity_append", agentThreadId: specialistThreadId, activity: evidenceRead },
      { type: "activity_append", agentThreadId: specialistThreadId, activity: specialistReply },
      { type: "artifact_upsert", agentThreadId: specialistThreadId, artifact },
      ...decisions.map((decision): TaskRunEventDraft => ({ type: "decision_upsert", agentThreadId: thread.id, decision })),
    );

    qualityRunId = `${spec.taskId}.quality-run`;
    const qualityThreadId = `${spec.taskId}.quality-thread`;
    const qualityArtifactId = `${spec.taskId}.quality-report`;
    const qualityAt = now();
    const qualityRun: TaskRun = {
      id: qualityRunId,
      taskId: spec.taskId,
      mode: "pipeline",
      status: "complete",
      rootAgentThreadId: qualityThreadId,
      startedAt: qualityAt,
      updatedAt: qualityAt,
      completedAt: qualityAt,
      stopAvailable: false,
      resumeAvailable: false,
      usage: { modelCalls: 0, totalTokens: 0, costUSD: 0 },
    };
    const qualityThread: TaskAgentThread = {
      id: qualityThreadId,
      taskId: spec.taskId,
      runId: qualityRunId,
      parentThreadId: null,
      identity: {
        kind: "deterministic",
        roleId: "quality_audit",
        displayName: "Quality Audit",
        roleLabel: "Deterministic",
        disclosureLabel: "System",
      },
      status: "complete",
      canReceiveUserMessage: false,
      handoffSummary: "Synthetic deterministic QA report for renderer acceptance.",
      latestActivityId: `${spec.taskId}.quality-ready`,
      childThreadIds: [],
      createdAt: qualityAt,
      updatedAt: qualityAt,
    };
    const qualityActivity: TaskActivity = {
      id: `${spec.taskId}.quality-ready`,
      taskId: spec.taskId,
      runId: qualityRunId,
      agentThreadId: qualityThreadId,
      seq: 0,
      type: "artifact_update",
      status: "done",
      actor: { kind: "system", id: "quality-audit", displayName: "Quality Audit", agentThreadId: qualityThreadId },
      title: "Quality report ready",
      body: "Synthetic deterministic QA completed without a model call.",
      tool: null,
      refs: { artifactIds: [qualityArtifactId], evidenceRefs: ["synthetic:evidence:qa"], decisionIds: [], segmentIds: [focusedSegmentId] },
      createdAt: qualityAt,
      updatedAt: qualityAt,
    };
    const qualityArtifact: TaskArtifact = {
      id: qualityArtifactId,
      taskId: spec.taskId,
      runId: qualityRunId,
      type: "qa_report",
      status: "reviewable",
      title: "Synthetic quality audit",
      summary: "Two evidence-backed synthetic findings for the professional-workspace acceptance pass.",
      scope: { ...snapshot.task.scope, segmentIds: [focusedSegmentId, `${spec.batchId}-00002`] },
      version: 0,
      provenance: { agentThreadId: qualityThreadId, activityId: qualityActivity.id, evidenceRefs: ["synthetic:evidence:qa"], parentArtifactIds: [] },
      availableDecisions: ["waive"],
      content: {
        schemaVersion: 1,
        projectId: spec.projectId,
        batchId: spec.batchId,
        checkedAt: qualityAt,
        status: "warn",
        summary: { checkedSegments: 1_040, openBlockers: 0, openWarnings: 1, ignored: 0 },
        findings: [
          {
            id: `${qualityArtifactId}.finding.1`,
            batchId: spec.batchId,
            segmentId: focusedSegmentId,
            code: "terminology.preferred",
            category: "terminology",
            severity: "warning",
            confidence: "high",
            authority: "project_termbase",
            status: "open",
            source: "Synthetic compact menu label.",
            target: "合成短菜单标签。",
            message: "A preferred project term needs confirmation before delivery.",
            expectedTarget: "合成菜单标签。",
            sourceTerm: "menu label",
            evidenceSources: ["synthetic:termbase:preferred-term"],
          },
          {
            id: `${qualityArtifactId}.finding.2`,
            batchId: spec.batchId,
            segmentId: `${spec.batchId}-00002`,
            code: "formatting.placeholder",
            category: "formatting",
            severity: "info",
            confidence: "high",
            authority: "deterministic_placeholder_check",
            status: "open",
            source: "Synthetic quest dialogue with enough words to wrap naturally in a narrow localization table.",
            target: "这是一条长度足以在较窄本地化表格中自然换行的合成任务对话。",
            message: "Placeholder structure is intact; this informational result requires no action.",
            evidenceSources: ["synthetic:placeholder:structure"],
          },
        ],
      },
      createdAt: qualityAt,
      updatedAt: qualityAt,
    };
    qualityRunEvents = [
      { type: "run_upsert", agentThreadId: qualityThreadId, run: qualityRun },
      { type: "thread_upsert", agentThreadId: qualityThreadId, thread: qualityThread },
      { type: "activity_append", agentThreadId: qualityThreadId, activity: qualityActivity },
      { type: "artifact_upsert", agentThreadId: qualityThreadId, artifact: qualityArtifact },
    ];
  }
  snapshot = await workspace.appendGenerated({ projectId: spec.projectId, taskId: spec.taskId, runId: runRecord.id, events });
  if (qualityRunId && qualityRunEvents.length) {
    snapshot = await workspace.appendGenerated({ projectId: spec.projectId, taskId: spec.taskId, runId: qualityRunId, events: qualityRunEvents });
  }
  return snapshot;
}

await assertSafeRoot();
await assertReplaceableGlobalManifest();
const replaceableProjects = new Map<string, boolean>();
for (const projectId of Object.values(PROJECTS)) replaceableProjects.set(projectId, await assertReplaceableProject(projectId));
for (const [projectId, shouldRemove] of replaceableProjects) {
  if (shouldRemove) await rm(join(repoRoot, "data", "projects", projectId), { recursive: true });
}
await writeProject(PROJECTS.primary, "Electron Acceptance Primary", [
  { id: BATCHES.cat1040, rows: 1_040 }, { id: BATCHES.cat10000, rows: 10_000 },
]);
await writeProject(PROJECTS.secondary, "Electron Acceptance Secondary", [{ id: BATCHES.secondary, rows: 256 }]);

const taskSpecs: TaskSpec[] = [
  { projectId: PROJECTS.primary, taskId: "electron-activity-1146", batchId: BATCHES.cat1040, status: "complete", activities: 1_146 },
  { projectId: PROJECTS.primary, taskId: "electron-inspector-decision", batchId: BATCHES.cat1040, status: "awaiting_input", artifactDecision: true },
  { projectId: PROJECTS.primary, taskId: "electron-state-running", batchId: BATCHES.cat1040, status: "active" },
  { projectId: PROJECTS.primary, taskId: "electron-state-waiting", batchId: BATCHES.cat1040, status: "waiting" },
  { projectId: PROJECTS.primary, taskId: "electron-state-stopping", batchId: BATCHES.cat1040, status: "stopping" },
  { projectId: PROJECTS.primary, taskId: "electron-state-stopped", batchId: BATCHES.cat10000, status: "stopped" },
  { projectId: PROJECTS.primary, taskId: "electron-state-failed", batchId: BATCHES.cat10000, status: "failed" },
  { projectId: PROJECTS.primary, taskId: "electron-activity-append", batchId: BATCHES.cat1040, status: "active" },
  { projectId: PROJECTS.secondary, taskId: "electron-secondary-task", batchId: BATCHES.secondary, status: "complete" },
];
for (const spec of taskSpecs) await createTask(spec);

const snapshots = new Map<string, TaskWorkspaceSnapshot>();
for (const spec of taskSpecs) snapshots.set(`${spec.projectId}:${spec.taskId}`, await workspace.open({ projectId: spec.projectId, taskId: spec.taskId }));
const activitySnapshot = snapshots.get(`${PROJECTS.primary}:electron-activity-1146`)!;
if (activitySnapshot.activities.length !== 1_146) throw new Error(`Activity fixture self-check failed: ${activitySnapshot.activities.length}.`);
const inspectorSnapshot = snapshots.get(`${PROJECTS.primary}:electron-inspector-decision`)!;
const interactionArtifact = inspectorSnapshot.artifacts.find((artifact) => artifact.id === "electron-inspector-decision.artifact");
const qualityArtifact = inspectorSnapshot.artifacts.find((artifact) => artifact.id === "electron-inspector-decision.quality-report");
if (
  inspectorSnapshot.artifacts.length !== 2
  || inspectorSnapshot.decisions.length !== 4
  || interactionArtifact?.scope.segmentIds.length !== 1
  || qualityArtifact?.content.summary === undefined
  || !inspectorSnapshot.runs.some((run) => run.id === "electron-inspector-decision.quality-run" && run.mode === "pipeline" && run.status === "complete")
  || inspectorSnapshot.activities.filter((item) => item.refs.segmentIds.length > 0).length < 2
  || inspectorSnapshot.decisions.some((decision) => decision.status !== "required")
  || JSON.stringify(inspectorSnapshot.decisions.map((decision) => decision.selectionMode)) !== JSON.stringify(["single", "multiple", "freeform", "single"])
) throw new Error("Inspector and four-question interaction fixture self-check failed.");
for (const spec of taskSpecs.filter((item) => ["active", "waiting", "stopping", "stopped", "failed"].includes(item.status))) {
  if (!snapshots.get(`${spec.projectId}:${spec.taskId}`)?.runs.some((candidate) => candidate.status === spec.status)) throw new Error(`Run state self-check failed: ${spec.status}.`);
}

const config = {
  schemaVersion: 1, fixture: FIXTURE, containsCustomerData: false, runtimeURL,
  scenarios: {
    projectSwitch: { fromProjectId: PROJECTS.primary, toProjectId: PROJECTS.secondary },
    batchSwitch: { projectId: PROJECTS.primary, fromBatchId: BATCHES.cat1040, toBatchId: BATCHES.cat10000 },
    taskSwitch: { projectId: PROJECTS.primary, fromBatchId: BATCHES.cat1040, fromTaskId: "electron-state-running", toBatchId: BATCHES.cat10000, toTaskId: "electron-state-stopped" },
    activity465: { projectId: PROJECTS.primary, batchId: BATCHES.cat1040, taskId: "electron-activity-1146" },
    activity1146: { projectId: PROJECTS.primary, batchId: BATCHES.cat1040, taskId: "electron-activity-1146" },
    cat1040: { projectId: PROJECTS.primary, batchId: BATCHES.cat1040, taskId: "electron-inspector-decision" },
    cat10000: { projectId: PROJECTS.primary, batchId: BATCHES.cat10000, taskId: "electron-state-stopped" },
    inspector: { projectId: PROJECTS.primary, batchId: BATCHES.cat1040, taskId: "electron-inspector-decision" },
    activityAppend: { projectId: PROJECTS.primary, batchId: BATCHES.cat1040, taskId: "electron-activity-append", expectedEvents: 100, expectedHz: 5, producer: "external-canonical" },
  },
  uiTask: { projectId: PROJECTS.primary, batchId: BATCHES.cat1040, taskId: "electron-inspector-decision" },
  states: {
    running: { projectId: PROJECTS.primary, taskId: "electron-state-running" },
    waiting: { projectId: PROJECTS.primary, taskId: "electron-state-waiting" },
    stopping: { projectId: PROJECTS.primary, taskId: "electron-state-stopping" },
    stopped: { projectId: PROJECTS.primary, taskId: "electron-state-stopped" },
    failed: { projectId: PROJECTS.primary, taskId: "electron-state-failed" },
    decision: { projectId: PROJECTS.primary, taskId: "electron-inspector-decision" },
    empty: { capture: "Start isolated runtime with this fixture, then use a clean profile before selecting any Project." },
    loading: { capture: "Use the acceptance runtime response-delay fault switch while opening the UI Task." },
    "permission-error": { capture: "Launch the isolated runtime with the synthetic permission-denied fault switch." },
    "credential-error": { capture: "Launch a clean profile with an intentionally invalid isolated-runtime credential." },
    "draft-conflict": { capture: "Run the synthetic expectedSegmentUpdatedAt conflict helper against CAT 1040." },
  },
};
const configJSON = `${JSON.stringify(config, null, 2)}\n`;
const manifest = {
  schemaVersion: 1, fixture: FIXTURE, generatedAt: now(), runtimeURL, containsCustomerData: false,
  projects: Object.values(PROJECTS), batches: { [BATCHES.cat1040]: 1_040, [BATCHES.cat10000]: 10_000, [BATCHES.secondary]: 256 },
  tasks: taskSpecs.map(({ projectId, taskId, batchId, status, activities = 1, artifactDecision = false }) => ({ projectId, taskId, batchId, status, activities, artifactDecision })),
  completeActivityCount: activitySnapshot.activities.length, artifactCount: inspectorSnapshot.artifacts.length, decisionCount: inspectorSnapshot.decisions.length,
  configSha256: createHash("sha256").update(configJSON).digest("hex"), containsModelOutput: false,
};
const dataRoot = join(repoRoot, "data");
await mkdir(dataRoot, { recursive: true });
const configPath = join(dataRoot, "electron-acceptance-config.json");
await writeFile(configPath, configJSON);
await writeFile(join(dataRoot, "electron-acceptance-fixture.json"), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ configPath, manifest }, null, 2)}\n`);
