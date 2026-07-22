import type { TaskArtifact } from "../../../../../packages/cat-data/src/task_workspace_contract.ts";
import type {
  BatchFormat,
  DeliveryExportResultDTO,
  DeliveryQaReportDTO,
  DeliveryReadinessReportDTO,
  HumanScoreRowDTO,
  PrivateEvalComparisonDTO,
  QualityAuditReportDTO,
  ReviewedDeliveryQaReportDTO,
} from "../data/workspace-client.ts";
import type { DeliveryExportFormat } from "./pipeline-actions.ts";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function exportFormatForBatch(format: BatchFormat): DeliveryExportFormat {
  switch (format) {
    case "phrase_mxliff": return "phrase_mxliff";
    case "mqxliff": return "mqxliff";
    case "sdlxliff": return "sdlxliff";
    case "xliff_1_2":
    case "xliff_2_0": return "xliff";
    case "csv_paste": return "csv";
    case "xlsx_paste": return "xlsx";
  }
}

export function deliveryAuthority(artifact: TaskArtifact | null): "authorized" | "blocked_override" | "unknown" {
  if (artifact?.type !== "delivery_export") return "unknown";
  const authorization = record(artifact.content.authorization);
  return authorization?.authorized === true ? "authorized"
    : authorization?.authorized === false ? "blocked_override"
    : "unknown";
}

export function readQualityReport(artifact: TaskArtifact | null): QualityAuditReportDTO | null {
  if (artifact?.type !== "qa_report") return null;
  const content = artifact.content;
  const summary = record(content.summary);
  if (content.schemaVersion !== 1 || !text(content.projectId) || !text(content.batchId) || !text(content.checkedAt) || !summary || !Array.isArray(content.findings)) return null;
  if (!(["pass", "warn", "fail"] as unknown[]).includes(content.status)) return null;
  if (["checkedSegments", "openBlockers", "openWarnings", "ignored"].some((key) => number(summary[key]) === null)) return null;
  return content as unknown as QualityAuditReportDTO;
}

export interface DeliveryQaArtifactContent {
  report: DeliveryQaReportDTO;
  review: ReviewedDeliveryQaReportDTO | null;
}

export function readDeliveryQaReport(artifact: TaskArtifact | null): DeliveryQaArtifactContent | null {
  if (artifact?.type !== "qa_report") return null;
  const content = artifact.content;
  const raw = record(content.rawReport);
  const candidate = raw ?? content;
  const summary = record(candidate.summary);
  if (!text(candidate.reportId) || !text(candidate.projectId) || !text(candidate.generatedAt) || !summary || !Array.isArray(candidate.findings)) return null;
  if (["blockers", "warnings", "advisories"].some((key) => number(summary[key]) === null)) return null;
  return {
    report: candidate as unknown as DeliveryQaReportDTO,
    review: raw && text(content.reviewedAt) && Array.isArray(content.findings)
      ? content as unknown as ReviewedDeliveryQaReportDTO
      : null,
  };
}

export function readDeliveryReadiness(artifact: TaskArtifact | null): DeliveryReadinessReportDTO | null {
  if (artifact?.type !== "delivery_readiness") return null;
  const content = artifact.content;
  if (content.schemaVersion !== 1 || !text(content.projectId) || !text(content.batchId) || !text(content.checkedAt)) return null;
  if (!(["pass", "warn", "fail"] as unknown[]).includes(content.status) || !record(content.delivery) || !record(content.quality) || !record(content.proposals) || !Array.isArray(content.files) || !Array.isArray(content.nextActions)) return null;
  return content as unknown as DeliveryReadinessReportDTO;
}

export function readDeliveryExport(artifact: TaskArtifact | null): DeliveryExportResultDTO | null {
  if (artifact?.type !== "delivery_export") return null;
  const content = artifact.content;
  if (!text(content.projectId) || !text(content.batchId) || !text(content.format) || !text(content.outputPath) || number(content.updatedSegments) === null || !Array.isArray(content.missingIds) || !record(content.delivery)) return null;
  return content as unknown as DeliveryExportResultDTO;
}

export interface EvalScorecardContent {
  evalSetId: string;
  runId: string;
  rows: HumanScoreRowDTO[];
}

export function readEvalScorecard(artifact: TaskArtifact | null): EvalScorecardContent | null {
  if (artifact?.type !== "eval_scorecard") return null;
  const evalSetId = text(artifact.content.evalSetId);
  const runId = text(artifact.content.runId);
  if (!evalSetId || !runId || !Array.isArray(artifact.content.rows)) return null;
  const rows = artifact.content.rows.filter((value): value is HumanScoreRowDTO => {
    const row = record(value);
    return Boolean(row && text(row.runId) && text(row.segmentId) && text(row.dimension) && number(row.score) !== null && text(row.judge) && text(row.issueTier) && Array.isArray(row.issueCategories));
  });
  if (rows.length !== artifact.content.rows.length) return null;
  return { evalSetId, runId, rows };
}

export function readEvalComparison(artifact: TaskArtifact | null): (PrivateEvalComparisonDTO & { evalSetId: string }) | null {
  if (artifact?.type !== "eval_comparison") return null;
  const evalSetId = text(artifact.content.evalSetId);
  const markdown = typeof artifact.content.markdown === "string" ? artifact.content.markdown : null;
  const reportPath = typeof artifact.content.reportPath === "string" ? artifact.content.reportPath : null;
  return evalSetId && markdown !== null && reportPath !== null ? { evalSetId, markdown, reportPath } : null;
}

export interface EvalBlindReviewContent {
  evalSetId: string;
  reviewId: string;
  total: number;
  judged: number;
  complete: boolean;
  pairs: Array<{
    pairId: string;
    segmentId: string;
    source: string;
    candidateA: string;
    candidateB: string;
    judgment?: {
      preference: string;
      issueTierA: string;
      issueTierB: string;
      comment?: string;
    };
  }>;
}

export function readEvalBlindReview(artifact: TaskArtifact | null): EvalBlindReviewContent | null {
  if (artifact?.type !== "eval_comparison") return null;
  const evalSetId = text(artifact.content.evalSetId);
  const blind = record(artifact.content.blindReview);
  if (!evalSetId || !blind || !text(blind.reviewId) || number(blind.total) === null || number(blind.judged) === null || typeof blind.complete !== "boolean" || !Array.isArray(blind.pairs)) return null;
  const pairs = blind.pairs.map((value) => {
    const pair = record(value);
    if (!pair || !text(pair.pairId) || !text(pair.segmentId) || typeof pair.source !== "string" || typeof pair.candidateA !== "string" || typeof pair.candidateB !== "string") return null;
    const judgment = record(pair.judgment);
    return {
      pairId: pair.pairId as string,
      segmentId: pair.segmentId as string,
      source: pair.source,
      candidateA: pair.candidateA,
      candidateB: pair.candidateB,
      ...(judgment && text(judgment.preference) && text(judgment.issueTierA) && text(judgment.issueTierB) ? {
        judgment: {
          preference: judgment.preference as string,
          issueTierA: judgment.issueTierA as string,
          issueTierB: judgment.issueTierB as string,
          ...(typeof judgment.comment === "string" ? { comment: judgment.comment } : {}),
        },
      } : {}),
    };
  });
  if (pairs.some((pair) => pair === null)) return null;
  return {
    evalSetId,
    reviewId: blind.reviewId as string,
    total: blind.total as number,
    judged: blind.judged as number,
    complete: blind.complete,
    pairs: pairs as EvalBlindReviewContent["pairs"],
  };
}
