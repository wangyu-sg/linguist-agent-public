import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runRealAlpha, type RealAlphaReport, type RunRealAlphaOptions } from "./real_alpha.js";

export interface RunBetaDeliveryCandidateOptions extends RunRealAlphaOptions {
  minBatches?: number;
}

export interface BetaDeliveryCandidateReport {
  projectId: string;
  checkedAt: string;
  status: "pass" | "warn" | "fail";
  minBatches: number;
  alphaReportPath: string;
  reportPath: string;
  batchCount: number;
  failures: string[];
  warnings: string[];
  alpha: RealAlphaReport;
}

function renderBetaMarkdown(report: BetaDeliveryCandidateReport): string {
  const lines: string[] = [];
  lines.push("# LA Beta Delivery Candidate Report");
  lines.push("");
  lines.push(`Project: ${report.projectId}`);
  lines.push(`Checked: ${report.checkedAt}`);
  lines.push(`Status: ${report.status}`);
  lines.push(`Batch count: ${report.batchCount} / required ${report.minBatches}`);
  lines.push(`Alpha report: ${report.alphaReportPath}`);
  lines.push("");
  lines.push("## Batches");
  lines.push("");
  lines.push("| Batch | Delivery | Export |");
  lines.push("|---|---|---|");
  for (const batch of report.alpha.batches) {
    lines.push(`| ${batch.batchId} | ${batch.delivery.status} | ${batch.export ? batch.export.outputPath.replace(/\|/g, "\\|") : batch.exportError ? `FAILED: ${batch.exportError}` : "missing"} |`);
  }
  lines.push("");
  lines.push("## Failures");
  if (report.failures.length) {
    for (const failure of report.failures) lines.push(`- ${failure}`);
  } else {
    lines.push("- None.");
  }
  if (report.warnings.length) {
    lines.push("");
    lines.push("## Warnings");
    for (const warning of report.warnings) lines.push(`- ${warning}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export async function runBetaDeliveryCandidate(
  workspaceRoot: string,
  options: RunBetaDeliveryCandidateOptions,
): Promise<BetaDeliveryCandidateReport> {
  const minBatches = options.minBatches ?? 2;
  const alpha = await runRealAlpha(workspaceRoot, { ...options, exportBatches: true });
  const failures: string[] = [];
  if (alpha.batches.length < minBatches) failures.push(`Selected ${alpha.batches.length} batch(es), but beta candidate requires at least ${minBatches}.`);
  for (const risk of alpha.p0p1DeliveryRisks) failures.push(risk);
  for (const batch of alpha.batches) {
    if (batch.delivery.status !== "pass") failures.push(`${batch.batchId} delivery status is ${batch.delivery.status}.`);
    if (!batch.export) failures.push(`${batch.batchId} export missing${batch.exportError ? `: ${batch.exportError}` : ""}.`);
  }
  const status: BetaDeliveryCandidateReport["status"] = failures.length ? "fail" : alpha.warnings.length ? "warn" : "pass";
  const checkedAt = new Date().toISOString();
  const reportDir = options.reportDir ?? join(workspaceRoot, "data", "reports");
  await mkdir(reportDir, { recursive: true });
  const reportPath = join(reportDir, `la_beta_${options.projectId}_${checkedAt.replace(/[:.]/g, "-")}.md`);
  const report: BetaDeliveryCandidateReport = {
    projectId: options.projectId,
    checkedAt,
    status,
    minBatches,
    alphaReportPath: alpha.reportPath,
    reportPath,
    batchCount: alpha.batches.length,
    failures,
    warnings: alpha.warnings,
    alpha,
  };
  await writeFile(reportPath, renderBetaMarkdown(report), "utf8");
  return report;
}
