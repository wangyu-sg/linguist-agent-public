import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildDeliveryReadinessReport, type DeliveryReadinessReport } from "./delivery_readiness.js";
import { createWorkspace, workspacePath } from "./workspace.js";

export interface RcReadinessReport {
  schemaVersion: 1;
  projectId: string;
  checkedAt: string;
  status: "pass" | "warn" | "fail";
  batchCount: number;
  reportPath: string;
  batches: DeliveryReadinessReport[];
  failures: string[];
  warnings: string[];
}
export interface RunRcReadinessOptions {
  projectId: string;
  batchIds?: string[];
  reportDir?: string;
}

async function listBatchIds(workspaceRoot: string, projectId: string): Promise<string[]> {
  const root = workspacePath(createWorkspace(workspaceRoot, projectId), "batches");
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function renderMarkdown(report: RcReadinessReport): string {
  const lines: string[] = [];
  lines.push("# LA RC Readiness Report");
  lines.push("");
  lines.push(`Project: ${report.projectId}`);
  lines.push(`Checked: ${report.checkedAt}`);
  lines.push(`Status: ${report.status}`);
  lines.push(`Batch count: ${report.batchCount}`);
  lines.push("");
  lines.push("## Batches");
  lines.push("");
  lines.push("| Batch | Status | Delivery | Proposed | Export audits | Latest export |");
  lines.push("|---|---|---|---:|---:|---|");
  for (const batch of report.batches) {
    const latestExport = batch.latestExport ? `${batch.latestExport.format} ${batch.latestExport.exportedAt}` : "none";
    lines.push(`| ${batch.batchId} | ${batch.status} | ${batch.delivery.status} | ${batch.proposals.proposed} | ${batch.exportAuditCount} | ${latestExport.replace(/\|/g, "\\|")} |`);
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

export async function runRcReadinessReport(workspaceRoot: string, options: RunRcReadinessOptions): Promise<RcReadinessReport> {
  const checkedAt = new Date().toISOString();
  const batchIds = options.batchIds?.length ? options.batchIds : await listBatchIds(workspaceRoot, options.projectId);
  if (!batchIds.length) throw new Error(`No imported batches found for project ${options.projectId}.`);
  const batches = [];
  for (const batchId of batchIds) batches.push(await buildDeliveryReadinessReport(workspaceRoot, options.projectId, batchId));
  const failures: string[] = [];
  const warnings: string[] = [];
  for (const batch of batches) {
    if (batch.status === "fail") failures.push(`${batch.batchId} readiness failed.`);
    if (batch.status === "warn") warnings.push(`${batch.batchId} readiness has warnings.`);
    if (!batch.latestExport) warnings.push(`${batch.batchId} has no export audit yet.`);
    for (const action of batch.nextActions) {
      if (batch.status === "fail") failures.push(`${batch.batchId}: ${action}`);
      else if (action !== "Ready for export or final handoff; latest export audit is available.") warnings.push(`${batch.batchId}: ${action}`);
    }
  }
  const status: RcReadinessReport["status"] = failures.length ? "fail" : warnings.length ? "warn" : "pass";
  const reportDir = options.reportDir ?? join(workspaceRoot, "data", "reports");
  await mkdir(reportDir, { recursive: true });
  const reportPath = join(reportDir, `la_rc_readiness_${options.projectId}_${checkedAt.replace(/[:.]/g, "-")}.md`);
  const report: RcReadinessReport = {
    schemaVersion: 1,
    projectId: options.projectId,
    checkedAt,
    status,
    batchCount: batches.length,
    reportPath,
    batches,
    failures,
    warnings,
  };
  await writeFile(reportPath, renderMarkdown(report), "utf8");
  return report;
}
