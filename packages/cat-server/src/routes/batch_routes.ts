import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, extname } from "node:path";
import {
  applyProposalSet,
  buildDeliveryReadinessReport,
  buildBatchEvidencePack,
  createProposalSet,
  exportCsvBatch,
  exportGenericXliff,
  exportMqxliff,
  exportPhraseBilingualDocx,
  exportPhraseMxliff,
  exportSdlxliff,
  exportXlsxBatch,
  buildSegmentEvidenceSnapshot,
  buildBatchConstraintPack,
  buildSegmentConstraintPackSnapshot,
  createTmStore,
  createWorkspace,
  importCsvBatch,
  importGenericXliffBatch,
  importMqxliffBatch,
  importPhraseBatch,
  importSdlxliffBatch,
  importXlsxBatch,
  listProposalSets,
  parseDeliveryQaReviewDecisions,
  readBatch,
  readProjectTagRuleContext,
  readProposalSet,
  formatQualityAuditMarkdown,
  formatCustomerReturnMarkdown,
  learnCustomerReturn,
  runDeliveryCheck,
  runDeliveryQa,
  reviewSavedDeliveryQaReport,
  runQualityAudit,
  recordQualityFindingWaiver,
  SegmentRevisionConflictError,
  updateSegmentTarget,
  writeProposalReport,
  type CatBatch,
  type BatchWorkflowStage,
  type DeliveryQaReviewDecision,
  type ExportResult,
  type SegmentChangeType,
  type TaskDecisionOption,
} from "@linguist-agent/cat-data";
import { buildTagTokenContract } from "../tag_token_contract.js";
import { runTaskPipeline } from "../task_pipeline_projection.js";
import { summarizeBatch } from "../projects_index.js";

export interface BatchRouteDeps {
  repoRoot: string;
  json: (res: ServerResponse, status: number, data: unknown) => void;
  markdown: (res: ServerResponse, status: number, data: string, fileName?: string) => void;
  readBody: (req: IncomingMessage) => Promise<unknown>;
  requireString: (value: unknown, label: string) => string;
  optionalString: (value: unknown) => string | undefined;
  optionalStringArray: (value: unknown) => string[] | undefined;
  optionalBoolean: (value: unknown) => boolean | undefined;
}

function inferBatchId(path: string): string {
  return basename(path)
    .replace(/\.[^.]+$/, "")
    .replace(/[/:]+/g, "-")
    .trim();
}

function segmentChangeType(value: unknown): SegmentChangeType {
  const allowed = new Set<SegmentChangeType>([
    "translation",
    "term",
    "terminology",
    "accuracy",
    "consistency",
    "style",
    "fluency",
    "user_approved",
    "other",
  ]);
  if (value === undefined || value === null || value === "") return "user_approved";
  if (typeof value === "string" && allowed.has(value as SegmentChangeType)) return value as SegmentChangeType;
  throw new Error(`Invalid segment changeType ${String(value)}.`);
}

function batchWorkflowStage(value: unknown): BatchWorkflowStage | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const allowed = new Set<BatchWorkflowStage>(["translate", "edit", "proof", "delivery"]);
  if (typeof value === "string" && allowed.has(value as BatchWorkflowStage)) return value as BatchWorkflowStage;
  throw new Error(`Invalid batch workflowStage ${String(value)}.`);
}

async function batchPayload(repoRoot: string, projectId: string, batchId: string): Promise<{ batch: CatBatch & { tagViews: Record<string, ReturnType<typeof buildTagTokenContract>> }; delivery: Awaited<ReturnType<typeof runDeliveryCheck>> }> {
  const batch = await readBatch(repoRoot, projectId, batchId);
  const delivery = await runDeliveryCheck(repoRoot, projectId, batchId);
  const ruleContext = await readProjectTagRuleContext(repoRoot, projectId);
  const tagViews = Object.fromEntries(
    batch.segments.map((segment) => [
      segment.id,
      buildTagTokenContract({
        text: segment.source,
        source: segment.source,
        target: segment.target,
      }, ruleContext),
    ]),
  );
  return { batch: { ...batch, tagViews }, delivery };
}

async function exportBatchFromRequest(repoRoot: string, projectId: string, batchId: string, body: Record<string, unknown>, deps: BatchRouteDeps): Promise<ExportResult> {
  const format = deps.requireString(body.format, "format");
  const common = { projectId, batchId, outputPath: deps.optionalString(body.outputPath), force: Boolean(body.force) };
  if (format === "phrase_mxliff") return exportPhraseMxliff(repoRoot, common);
  if (format === "phrase_docx") return exportPhraseBilingualDocx(repoRoot, { ...common, templateDocxPath: deps.requireString(body.templateDocxPath, "templateDocxPath") });
  if (format === "mqxliff") return exportMqxliff(repoRoot, { ...common, role: deps.optionalString(body.role) as "T" | "E" | "P" | undefined });
  if (format === "sdlxliff") return exportSdlxliff(repoRoot, { ...common, role: deps.optionalString(body.role) as "T" | "E" | "P" | undefined });
  if (format === "xliff") return exportGenericXliff(repoRoot, common);
  if (format === "csv") return exportCsvBatch(repoRoot, common);
  if (format === "xlsx") return exportXlsxBatch(repoRoot, common);
  throw new Error(`Unsupported export format ${format}.`);
}

const DELIVERY_QA_DECISION_OPTIONS: TaskDecisionOption[] = [
  { id: "fix_required", label: "Fix required", action: "request_change", destructive: false },
  { id: "ignore_with_reason", label: "Ignore with reason", action: "waive", destructive: false },
  { id: "query", label: "Query", action: "answer", destructive: false },
  { id: "accepted_risk", label: "Accept risk", action: "waive", destructive: false },
];

function taskDeliveryQaDecisions(decisions: DeliveryQaReviewDecision[]) {
  return decisions.map((decision) => ({
    key: `${decision.findingId}\0${decision.reviewDecision}\0${decision.reviewReason}`,
    kind: decision.reviewDecision === "query" ? "answer" as const
      : ["ignore_with_reason", "accepted_risk"].includes(decision.reviewDecision) ? "waiver" as const
      : "proposal_review" as const,
    prompt: `Review Delivery QA finding ${decision.findingId}`,
    options: DELIVERY_QA_DECISION_OPTIONS,
    selectedOptionId: decision.reviewDecision,
    reason: decision.reviewReason,
  }));
}

function taskDeliveryAuthorizationDecision(exported: ExportResult) {
  const authorization = exported.authorization;
  if (!authorization) return [];
  const selectedOptionId = authorization.authorized ? "authorized" : "blocked_force_override";
  const reason = authorization.authorized
    ? `Deterministic export gate authorized delivery; ${authorization.waivedFindingIds.length} finding(s) were explicitly waived.`
    : `Deterministic export gate remained blocked by ${authorization.blockers.length} blocker(s) and ${authorization.unreviewedFindingIds.length} unreviewed finding(s); the export used an explicit force override.`;
  return [{
    key: `${exported.auditId ?? exported.outputPath}\0${selectedOptionId}`,
    kind: "delivery_authorization" as const,
    prompt: "Deterministic Delivery authorization",
    options: [
      { id: "authorized", label: "Authorized by quality gate", action: "authorize_delivery" as const, destructive: false },
      { id: "blocked_force_override", label: "Blocked; force override used", action: "reject" as const, destructive: true },
    ],
    selectedOptionId,
    reason,
  }];
}

export async function handleBatchRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  parts: string[],
  projectId: string,
  deps: BatchRouteDeps,
): Promise<boolean> {
  if (parts[3] !== "batches") return false;

  if (parts.length === 4 && req.method === "POST") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    const filePath = deps.requireString(body.filePath, "filePath");
    const batchId = deps.optionalString(body.batchId) ?? inferBatchId(filePath);
    const overwrite = Boolean(body.overwrite);
    const workflowStage = batchWorkflowStage(body.workflowStage);
    const ext = extname(filePath).toLocaleLowerCase();
    if (ext === ".mxliff") {
      deps.json(res, 200, await importPhraseBatch(deps.repoRoot, { projectId, mxliffPath: filePath, masterXliffPath: deps.optionalString(body.masterXliffPath), batchId, overwrite, workflowStage }));
      return true;
    }
    if (ext === ".mqxliff") {
      deps.json(res, 200, await importMqxliffBatch(deps.repoRoot, { projectId, mqxliffPath: filePath, batchId, overwrite, workflowStage }));
      return true;
    }
    if (ext === ".sdlxliff") {
      deps.json(res, 200, await importSdlxliffBatch(deps.repoRoot, { projectId, sdlxliffPath: filePath, batchId, overwrite, workflowStage }));
      return true;
    }
    if (ext === ".xliff" || ext === ".xlf") {
      deps.json(res, 200, await importGenericXliffBatch(deps.repoRoot, { projectId, xliffPath: filePath, batchId, overwrite, workflowStage }));
      return true;
    }
    if (ext === ".csv") {
      deps.json(res, 200, await importCsvBatch(deps.repoRoot, { projectId, csvPath: filePath, batchId, overwrite, workflowStage }));
      return true;
    }
    if (ext === ".xlsx") {
      deps.json(res, 200, await importXlsxBatch(deps.repoRoot, { projectId, xlsxPath: filePath, batchId, overwrite, workflowStage }));
      return true;
    }
    throw new Error(`Unsupported batch file extension ${ext || "(none)"}.`);
  }

  if (parts.length < 5) return false;
  const batchId = decodeURIComponent(parts[4]);

  if (parts.length === 5 && req.method === "GET") {
    const responseMode = url.searchParams.get("responseMode");
    if (responseMode === "summary") {
      deps.json(res, 200, { summary: summarizeBatch(await readBatch(deps.repoRoot, projectId, batchId)) });
      return true;
    }
    if (responseMode !== null) throw new Error("responseMode must be 'summary'.");
    deps.json(res, 200, await batchPayload(deps.repoRoot, projectId, batchId));
    return true;
  }

  if (parts[5] === "segments" && parts[6] && parts[7] === "evidence" && parts.length === 8 && req.method === "GET") {
    deps.json(res, 200, await buildSegmentEvidenceSnapshot(deps.repoRoot, {
      projectId,
      batchId,
      segmentId: decodeURIComponent(parts[6]),
    }));
    return true;
  }

  if (parts[5] === "evidence-pack" && req.method === "GET") {
    deps.json(res, 200, await buildBatchEvidencePack(deps.repoRoot, {
      projectId,
      batchId,
    }));
    return true;
  }

  if ((parts[5] === "constraint-pack" || parts[5] === "constraint-packs") && req.method === "GET" && !parts[6]) {
    const url = new URL(req.url ?? "", "http://localhost");
    const onlyFlagged = url.searchParams.get("onlyFlagged") === "true";
    deps.json(res, 200, await buildBatchConstraintPack(deps.repoRoot, {
      projectId,
      batchId,
      onlyFlagged,
    }));
    return true;
  }

  if (parts[5] === "segments" && parts[6] && parts[7] === "constraint-pack" && parts.length === 8 && req.method === "GET") {
    deps.json(res, 200, await buildSegmentConstraintPackSnapshot(deps.repoRoot, {
      projectId,
      batchId,
      segmentId: decodeURIComponent(parts[6]),
    }));
    return true;
  }

  if (parts[5] === "tm" && parts[6] && parts[7] === "promote" && parts.length === 8 && req.method === "POST") {
    const result = await createTmStore(createWorkspace(deps.repoRoot, projectId)).promoteReviewed(decodeURIComponent(parts[6]));
    deps.json(res, 200, { result });
    return true;
  }

  if (parts[5] === "delivery-qa" && req.method === "POST") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    deps.json(res, 200, await runTaskPipeline({
      repoRoot: deps.repoRoot,
      projectId,
      batchId,
      taskId: deps.requireString(body.taskId, "taskId"),
      operation: "delivery_qa",
      title: "Run Delivery QA",
      execute: () => runDeliveryQa(deps.repoRoot, projectId, batchId),
      artifact: (report) => ({
        type: "qa_report",
        title: "Delivery QA report",
        summary: `${report.summary.blockers} blockers · ${report.summary.warnings} warnings · ${report.summary.advisories} advisories`,
        content: report as unknown as Record<string, unknown>,
        key: report.reportId,
      }),
    }));
    return true;
  }

  if (parts[5] === "delivery-qa-review" && req.method === "POST") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    const reportId = deps.requireString(body.reportId, "reportId");
    const decisions = parseDeliveryQaReviewDecisions(body.decisions);
    deps.json(res, 200, await runTaskPipeline({
      repoRoot: deps.repoRoot,
      projectId,
      batchId,
      taskId: deps.requireString(body.taskId, "taskId"),
      operation: "delivery_qa_review",
      title: "Review Delivery QA",
      execute: () => reviewSavedDeliveryQaReport(deps.repoRoot, projectId, reportId, decisions),
      artifact: (reviewed) => ({
        type: "qa_report",
        title: "Delivery QA review decision",
        summary: `${decisions.length} recorded decision(s)`,
        content: reviewed as unknown as Record<string, unknown>,
        key: reviewed.reportId,
        decisions: taskDeliveryQaDecisions(decisions),
      }),
    }));
    return true;
  }

  if (parts[5] === "segments" && parts[6] && req.method === "POST") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    const responseMode = body.responseMode === undefined ? undefined : deps.requireString(body.responseMode, "responseMode");
    if (responseMode !== undefined && responseMode !== "segment") throw new Error("responseMode must be 'segment'.");
    const hasExpectedRevision = Object.prototype.hasOwnProperty.call(body, "expectedSegmentUpdatedAt");
    if (hasExpectedRevision && body.expectedSegmentUpdatedAt !== null && typeof body.expectedSegmentUpdatedAt !== "string") {
      throw new Error("expectedSegmentUpdatedAt must be a string or null.");
    }
    try {
      const result = await updateSegmentTarget(deps.repoRoot, projectId, batchId, {
        segmentId: decodeURIComponent(parts[6]),
        target: deps.requireString(body.target, "target"),
        confirm: Boolean(body.confirm),
        propagateDuplicates: body.propagateDuplicates === undefined ? undefined : Boolean(body.propagateDuplicates),
        reason: deps.requireString(body.reason, "reason"),
        changeType: segmentChangeType(body.changeType),
        evidenceSources: deps.optionalStringArray(body.evidenceSources),
        expectedSegmentUpdatedAt: hasExpectedRevision
          ? body.expectedSegmentUpdatedAt === null ? null : deps.requireString(body.expectedSegmentUpdatedAt, "expectedSegmentUpdatedAt")
          : undefined,
      });
      if (responseMode === "segment") {
        deps.json(res, 200, { segment: result.segment, batchUpdatedAt: result.batchUpdatedAt, result });
      } else {
        deps.json(res, 200, { result, ...(await batchPayload(deps.repoRoot, projectId, batchId)) });
      }
    } catch (error) {
      if (error instanceof SegmentRevisionConflictError) {
        deps.json(res, 409, {
          error: "segment_revision_conflict",
          currentSegment: error.currentSegment,
          batchUpdatedAt: error.batchUpdatedAt,
        });
      } else {
        throw error;
      }
    }
    return true;
  }

  if (parts[5] === "proposals" && parts.length === 6 && req.method === "GET") {
    deps.json(res, 200, { rows: await listProposalSets(deps.repoRoot, projectId, batchId) });
    return true;
  }

  if (parts[5] === "proposals" && parts.length === 6 && req.method === "POST") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    const rawProposals = Array.isArray(body.proposals) ? body.proposals as Array<Record<string, unknown>> : [];
    deps.json(res, 200, await createProposalSet(deps.repoRoot, projectId, batchId, {
      proposalSetId: deps.optionalString(body.proposalSetId),
      title: deps.optionalString(body.title),
      overwrite: Boolean(body.overwrite),
      proposals: rawProposals.map((proposal) => ({
        segmentId: deps.requireString(proposal.segmentId, "proposal.segmentId"),
        proposedTarget: deps.requireString(proposal.proposedTarget, "proposal.proposedTarget"),
        reason: deps.requireString(proposal.reason, "proposal.reason"),
        changeType: segmentChangeType(proposal.changeType),
        evidenceSources: deps.optionalStringArray(proposal.evidenceSources),
        severity: deps.optionalString(proposal.severity),
      })),
    }));
    return true;
  }

  if (parts[5] === "proposals" && parts[6] && parts.length === 7 && req.method === "GET") {
    deps.json(res, 200, await readProposalSet(deps.repoRoot, projectId, batchId, decodeURIComponent(parts[6])));
    return true;
  }

  if (parts[5] === "proposals" && parts[6] && (parts[7] === "report" || parts[7] === "report.md") && req.method === "GET") {
    const writeFile = url.searchParams.get("write") === "1" || url.searchParams.get("write") === "true";
    const proposalSetId = decodeURIComponent(parts[6]);
    const result = await writeProposalReport(deps.repoRoot, projectId, batchId, proposalSetId, { writeFile });
    const wantsMarkdown =
      parts[7] === "report.md" ||
      ["md", "markdown", "text"].includes((url.searchParams.get("format") ?? "").toLocaleLowerCase()) ||
      (req.headers.accept ?? "").includes("text/markdown");
    if (wantsMarkdown) {
      deps.markdown(res, 200, `${result.markdown}\n`, `${proposalSetId}.md`);
    } else {
      deps.json(res, 200, result);
    }
    return true;
  }

  if (parts[5] === "proposals" && parts[6] && parts[7] === "report" && req.method === "POST") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    deps.json(res, 200, await writeProposalReport(deps.repoRoot, projectId, batchId, decodeURIComponent(parts[6]), {
      writeFile: body.writeFile === undefined ? true : Boolean(body.writeFile),
    }));
    return true;
  }

  if (parts[5] === "proposals" && parts[6] && parts[7] === "apply" && req.method === "POST") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    deps.json(res, 200, await applyProposalSet(deps.repoRoot, projectId, batchId, decodeURIComponent(parts[6]), {
      proposalIds: deps.optionalStringArray(body.proposalIds),
      rejectProposalIds: deps.optionalStringArray(body.rejectProposalIds),
      confirm: deps.optionalBoolean(body.confirm),
      propagateDuplicates: deps.optionalBoolean(body.propagateDuplicates),
      rejectUnselected: deps.optionalBoolean(body.rejectUnselected),
    }));
    return true;
  }

  if (parts[5] === "delivery" && req.method === "GET") {
    deps.json(res, 200, await runDeliveryCheck(deps.repoRoot, projectId, batchId));
    return true;
  }

  if (parts[5] === "delivery-readiness" && req.method === "GET") {
    const taskId = url.searchParams.get("taskId")?.trim() || undefined;
    deps.json(res, 200, await runTaskPipeline({
      repoRoot: deps.repoRoot,
      projectId,
      batchId,
      taskId,
      operation: "delivery_readiness",
      title: "Check delivery readiness",
      execute: () => buildDeliveryReadinessReport(deps.repoRoot, projectId, batchId),
      artifact: (report) => ({
        type: "delivery_readiness",
        title: "Delivery readiness",
        summary: `${report.status} · ${report.delivery.blockers.length} blockers · ${report.quality.summary.openWarnings} warnings`,
        content: report as unknown as Record<string, unknown>,
        key: report.checkedAt,
      }),
    }));
    return true;
  }

  if (parts[5] === "quality" && req.method === "GET") {
    const taskId = url.searchParams.get("taskId")?.trim() || undefined;
    const report = await runTaskPipeline({
      repoRoot: deps.repoRoot,
      projectId,
      batchId,
      taskId,
      operation: "quality_audit",
      title: "Run quality audit",
      execute: () => runQualityAudit(deps.repoRoot, projectId, batchId),
      artifact: (quality) => ({
        type: "qa_report",
        title: "Quality audit",
        summary: `${quality.summary.openBlockers} blockers · ${quality.summary.openWarnings} warnings · ${quality.summary.ignored} accepted`,
        content: quality as unknown as Record<string, unknown>,
        key: quality.checkedAt,
      }),
    });
    const wantsMarkdown =
      parts[6] === "report.md" ||
      ["md", "markdown", "text"].includes((url.searchParams.get("format") ?? "").toLocaleLowerCase()) ||
      (req.headers.accept ?? "").includes("text/markdown");
    if (wantsMarkdown) {
      deps.markdown(res, 200, formatQualityAuditMarkdown(report), `${batchId}-quality.md`);
    } else {
      deps.json(res, 200, report);
    }
    return true;
  }

  if (parts[5] === "quality" && parts[6] === "waivers" && req.method === "POST") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    const segmentId = deps.requireString(body.segmentId, "segmentId");
    const findingId = deps.requireString(body.findingId, "findingId");
    const code = deps.requireString(body.code, "code");
    const reason = deps.requireString(body.reason, "reason");
    const acceptedBy = deps.optionalString(body.acceptedBy);
    deps.json(res, 200, await runTaskPipeline({
      repoRoot: deps.repoRoot,
      projectId,
      batchId,
      taskId: deps.requireString(body.taskId, "taskId"),
      operation: "quality_waiver",
      title: "Record quality decision",
      execute: async () => {
        const { waivers, report } = await recordQualityFindingWaiver(deps.repoRoot, projectId, { batchId, segmentId, findingId, code, reason, acceptedBy });
        return { waivers, quality: report };
      },
      artifact: (result) => ({
        type: "qa_report",
        title: "Quality finding accepted",
        summary: `${code} · ${segmentId}`,
        content: result.quality as unknown as Record<string, unknown>,
        key: `${findingId}-accepted`,
        decisions: [{
          key: `${findingId}\0accepted_risk\0${reason}`,
          kind: "waiver",
          prompt: `Review quality finding ${findingId}`,
          options: [{ id: "accepted_risk", label: "Accept risk", action: "waive", destructive: false }],
          selectedOptionId: "accepted_risk",
          reason,
        }],
      }),
    }));
    return true;
  }

  if (parts[5] === "customer-returns" && req.method === "POST") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    const report = await learnCustomerReturn(deps.repoRoot, {
      projectId,
      batchId,
      xlsxPath: deps.requireString(body.xlsxPath, "xlsxPath"),
      importReviewedTm: body.importReviewedTm === undefined ? true : Boolean(body.importReviewedTm),
    });
    const wantsMarkdown =
      ["md", "markdown", "text"].includes((url.searchParams.get("format") ?? "").toLocaleLowerCase()) ||
      (req.headers.accept ?? "").includes("text/markdown");
    if (wantsMarkdown) {
      deps.markdown(res, 200, formatCustomerReturnMarkdown(report), `${batchId}-customer-return.md`);
    } else {
      deps.json(res, 200, report);
    }
    return true;
  }

  if (parts[5] === "export" && req.method === "POST") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    const result = await runTaskPipeline({
      repoRoot: deps.repoRoot,
      projectId,
      batchId,
      taskId: deps.requireString(body.taskId, "taskId"),
      operation: "delivery_export",
      title: "Export batch",
      execute: () => exportBatchFromRequest(deps.repoRoot, projectId, batchId, body, deps),
      artifact: (exported) => ({
        type: "delivery_export",
        title: `Delivery export · ${exported.format}`,
        summary: `${exported.updatedSegments} segments · ${exported.missingIds.length} missing`,
        content: exported as unknown as Record<string, unknown>,
        key: exported.auditId ?? exported.outputPath,
        decisions: taskDeliveryAuthorizationDecision(exported),
      }),
    });
    deps.json(res, 200, result);
    return true;
  }

  return false;
}
