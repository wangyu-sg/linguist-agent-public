import type {
  DeliveryExportResultDTO,
  DeliveryQaReportDTO,
  DeliveryReadinessReportDTO,
  QualityAuditReportDTO,
  ReviewedDeliveryQaReportDTO,
} from "../data/workspace-client.ts";

export interface PipelineScope {
  projectId: string;
  batchId: string;
  taskId: string;
}

export type DeliveryExportFormat =
  | "phrase_mxliff"
  | "phrase_docx"
  | "mqxliff"
  | "sdlxliff"
  | "xliff"
  | "csv"
  | "xlsx";

export type DeliveryQaReviewChoice = "fix_required" | "ignore_with_reason" | "query" | "accepted_risk";

export interface QualityWaiverInput {
  segmentId: string;
  findingId: string;
  code: string;
  reason: string;
}

export interface DeliveryQaReviewInput {
  reportId: string;
  findingId: string;
  decision: DeliveryQaReviewChoice;
  reason: string;
}

export interface DeliveryExportInput {
  format: DeliveryExportFormat;
  outputPath?: string;
  role?: "T" | "E" | "P";
  templateDocxPath?: string;
}

export interface CanonicalPipelineClient {
  runQualityAudit(scope: PipelineScope): Promise<QualityAuditReportDTO>;
  runDeliveryQa(scope: PipelineScope): Promise<DeliveryQaReportDTO>;
  reviewDeliveryQa(scope: PipelineScope, input: DeliveryQaReviewInput): Promise<ReviewedDeliveryQaReportDTO>;
  recordQualityWaiver(scope: PipelineScope, input: QualityWaiverInput): Promise<unknown>;
  checkDeliveryReadiness(scope: PipelineScope): Promise<DeliveryReadinessReportDTO>;
  exportDelivery(scope: PipelineScope, input: DeliveryExportInput): Promise<DeliveryExportResultDTO>;
}

export type CanonicalPipelineAction =
  | { kind: "quality-audit" }
  | { kind: "delivery-qa" }
  | { kind: "delivery-qa-review"; input: DeliveryQaReviewInput }
  | { kind: "quality-waiver"; input: QualityWaiverInput }
  | { kind: "delivery-readiness" }
  | { kind: "delivery-export"; input: DeliveryExportInput };

export async function executeCanonicalPipelineAction(
  scope: PipelineScope,
  action: CanonicalPipelineAction,
  client: CanonicalPipelineClient,
): Promise<unknown> {
  if (!scope.projectId.trim() || !scope.batchId.trim() || !scope.taskId.trim()) {
    throw new Error("A canonical Project, Batch, and Task scope is required.");
  }
  switch (action.kind) {
    case "quality-audit":
      return client.runQualityAudit(scope);
    case "delivery-qa":
      return client.runDeliveryQa(scope);
    case "delivery-readiness":
      return client.checkDeliveryReadiness(scope);
    case "delivery-export":
      return client.exportDelivery(scope, action.input);
    case "delivery-qa-review": {
      const reason = action.input.reason.trim();
      if (!reason) throw new Error("A review reason is required before recording a Delivery QA decision.");
      if (!action.input.reportId.trim() || !action.input.findingId.trim()) throw new Error("The canonical Delivery QA report and finding are required.");
      return client.reviewDeliveryQa(scope, { ...action.input, reason });
    }
    case "quality-waiver": {
      const reason = action.input.reason.trim();
      if (!reason) throw new Error("A reason is required before accepting a quality risk.");
      if (!action.input.segmentId.trim() || !action.input.findingId.trim() || !action.input.code.trim()) {
        throw new Error("The canonical quality finding scope is required.");
      }
      return client.recordQualityWaiver(scope, { ...action.input, reason });
    }
  }
}
