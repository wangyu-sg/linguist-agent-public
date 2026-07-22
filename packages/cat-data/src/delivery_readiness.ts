import { stat } from "node:fs/promises";
import { listProposalSets } from "./proposals.js";
import { readBatch } from "./batch_workspace.js";
import { readProjectManifest } from "./project_manifest.js";
import { readExportAuditRecords, runDeliveryCheck, type DeliveryReport, type ExportAuditRecord } from "./delivery.js";
import { runQualityAudit, type QualityAuditReport } from "./quality_audit.js";

export type DeliveryReadinessStatus = "pass" | "warn" | "fail";

export interface DeliveryReadinessFile {
  role: "source" | "master";
  path: string;
  exists: boolean;
  size?: number;
  mtimeMs?: number;
  status: "pass" | "fail";
}

export interface DeliveryReadinessReport {
  schemaVersion: 1;
  projectId: string;
  batchId: string;
  checkedAt: string;
  status: DeliveryReadinessStatus;
  delivery: DeliveryReport;
  quality: QualityAuditReport;
  proposals: {
    sets: number;
    proposed: number;
    applied: number;
    skipped: number;
    rejected: number;
  };
  files: DeliveryReadinessFile[];
  latestExport?: ExportAuditRecord;
  exportAuditCount: number;
  nextActions: string[];
}

async function fileReadiness(role: DeliveryReadinessFile["role"], path: string): Promise<DeliveryReadinessFile> {
  try {
    const info = await stat(path);
    return {
      role,
      path,
      exists: true,
      size: info.size,
      mtimeMs: info.mtimeMs,
      status: "pass",
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { role, path, exists: false, status: "fail" };
  }
}

function proposalTotals(rows: Awaited<ReturnType<typeof listProposalSets>>): DeliveryReadinessReport["proposals"] {
  return rows.reduce(
    (totals, row) => ({
      sets: totals.sets + 1,
      proposed: totals.proposed + row.proposed,
      applied: totals.applied + row.applied,
      skipped: totals.skipped + row.skipped,
      rejected: totals.rejected + row.rejected,
    }),
    { sets: 0, proposed: 0, applied: 0, skipped: 0, rejected: 0 },
  );
}

function deriveStatus(
  delivery: DeliveryReport,
  quality: QualityAuditReport,
  files: DeliveryReadinessFile[],
  proposals: DeliveryReadinessReport["proposals"],
): DeliveryReadinessStatus {
  if (delivery.status === "fail") return "fail";
  if (quality.status === "fail") return "fail";
  if (files.some((file) => file.status === "fail")) return "fail";
  if (delivery.status === "warn") return "warn";
  if (quality.status === "warn") return "warn";
  if (proposals.proposed > 0) return "warn";
  return "pass";
}

function nextActions(report: Omit<DeliveryReadinessReport, "nextActions">): string[] {
  const actions: string[] = [];
  const missingFiles = report.files.filter((file) => !file.exists);
  for (const file of missingFiles) actions.push(`Restore missing ${file.role} file before export: ${file.path}`);
  for (const blocker of report.delivery.blockers) actions.push(`Fix delivery blocker ${blocker.code}: ${blocker.message}`);
  const qualityBlockers = report.quality.findings.filter((finding) => finding.status === "open" && finding.severity === "blocker");
  if (qualityBlockers.length) {
    const sample = qualityBlockers.slice(0, 5).map((finding) => `${finding.segmentId}:${finding.code}`).join(", ");
    actions.push(`Fix ${qualityBlockers.length} quality blocker(s) before delivery (${sample}${qualityBlockers.length > 5 ? ", ..." : ""}).`);
  }
  const qualityWarnings = report.quality.findings.filter((finding) => finding.status === "open" && finding.severity === "warning");
  if (!qualityBlockers.length && qualityWarnings.length) {
    actions.push(`Review ${qualityWarnings.length} quality warning(s) before final handoff.`);
  }
  if (report.delivery.waived.length) {
    const codes = Array.from(new Set(report.delivery.waived.map((issue) => issue.code))).join(", ");
    actions.push(`Accepted delivery risks remain waived (${codes}); export can proceed if this is the intended handoff.`);
  }
  if (report.proposals.proposed) actions.push(`Review/apply/reject ${report.proposals.proposed} proposed proposal rows before delivery.`);
  if (!report.latestExport && !report.delivery.blockers.length && !missingFiles.length && !report.proposals.proposed) {
    actions.push("No export audit exists yet; run the appropriate export tool after confirming readiness.");
  }
  if (!actions.length) actions.push("Ready for export or final handoff; latest export audit is available.");
  return actions;
}

export async function buildDeliveryReadinessReport(
  workspaceRoot: string,
  projectId: string,
  batchId: string,
): Promise<DeliveryReadinessReport> {
  await readProjectManifest(workspaceRoot, projectId);
  const batch = await readBatch(workspaceRoot, projectId, batchId);
  const delivery = await runDeliveryCheck(workspaceRoot, projectId, batchId);
  const quality = await runQualityAudit(workspaceRoot, projectId, batchId);
  const proposals = proposalTotals(await listProposalSets(workspaceRoot, projectId, batchId));
  const files = await Promise.all([
    fileReadiness("source", batch.sourceFile),
    ...(batch.masterFile ? [fileReadiness("master", batch.masterFile)] : []),
  ]);
  const audits = await readExportAuditRecords(workspaceRoot, projectId, batchId);
  const base = {
    schemaVersion: 1 as const,
    projectId,
    batchId,
    checkedAt: new Date().toISOString(),
    status: deriveStatus(delivery, quality, files, proposals),
    delivery,
    quality,
    proposals,
    files,
    latestExport: audits[0],
    exportAuditCount: audits.length,
  };
  return { ...base, nextActions: nextActions(base) };
}
