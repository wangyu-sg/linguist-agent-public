import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildAssetBlocks,
  createWorkspace,
  exportCsvBatch,
  exportGenericXliff,
  exportPhraseMxliff,
  exportMqxliff,
  exportSdlxliff,
  exportXlsxBatch,
  listProposalSets,
  readBatch,
  readProjectManifest,
  runDeliveryCheck,
  runProjectHealthCheck,
  suggestWorkbookMappingCandidates,
  workspacePath,
  type AssetBlockBuildReport,
  type DeliveryReport,
  type ExportResult,
  type WorkbookMappingCandidate,
  type ProjectHealthReport,
} from "@linguist-agent/cat-data";

export interface RealAlphaBatchResult {
  batchId: string;
  format: string;
  delivery: DeliveryReport;
  proposals: {
    sets: number;
    proposed: number;
    applied: number;
    skipped: number;
    rejected: number;
  };
  export?: ExportResult;
  exportError?: string;
}

export interface RealAlphaReport {
  projectId: string;
  checkedAt: string;
  root: string;
  manifestUpdatedAt: string;
  healthBefore: ProjectHealthReport;
  assetBlocks?: AssetBlockBuildReport;
  healthAfter: ProjectHealthReport;
  batches: RealAlphaBatchResult[];
  status: "pass" | "warn" | "fail";
  p0p1DeliveryRisks: string[];
  warnings: string[];
  mappingCandidates: Array<{
    assetPath: string;
    purpose: "termbase" | "tm" | "glossary";
    candidates: WorkbookMappingCandidate[];
    error?: string;
  }>;
  reportPath: string;
}

export interface RunRealAlphaOptions {
  projectId: string;
  batchIds?: string[];
  buildAssets?: boolean;
  exportBatches?: boolean;
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

function proposalTotals(rows: Awaited<ReturnType<typeof listProposalSets>>): RealAlphaBatchResult["proposals"] {
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

async function exportBatch(workspaceRoot: string, projectId: string, batchId: string, format: string): Promise<ExportResult | undefined> {
  if (format === "phrase_mxliff") return exportPhraseMxliff(workspaceRoot, { projectId, batchId });
  if (format === "mqxliff") return exportMqxliff(workspaceRoot, { projectId, batchId });
  if (format === "sdlxliff") return exportSdlxliff(workspaceRoot, { projectId, batchId, role: "P" });
  if (format === "xliff_1_2" || format === "xliff_2_0") return exportGenericXliff(workspaceRoot, { projectId, batchId });
  if (format === "csv_paste") return exportCsvBatch(workspaceRoot, { projectId, batchId });
  if (format === "xlsx_paste") return exportXlsxBatch(workspaceRoot, { projectId, batchId });
  return undefined;
}

function issueLines(report: ProjectHealthReport): string[] {
  const lines: string[] = [];
  for (const issue of report.issues) {
    const scope = issue.batchIds?.length ? ` batches=${issue.batchIds.join(",")}` : issue.assetPaths?.length ? ` assets=${issue.assetPaths.slice(0, 5).join("; ")}${issue.assetPaths.length > 5 ? " ..." : ""}` : "";
    lines.push(`- ${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}${scope}`);
    for (const action of issue.nextActions ?? []) lines.push(`  - next: ${action}`);
  }
  return lines;
}

function renderMarkdown(report: RealAlphaReport): string {
  const lines: string[] = [];
  lines.push(`# LA Real Alpha Report`);
  lines.push("");
  lines.push(`Project: ${report.projectId}`);
  lines.push(`Checked: ${report.checkedAt}`);
  lines.push(`Root: ${report.root}`);
  lines.push(`Status: ${report.status}`);
  lines.push(`Manifest updated: ${report.manifestUpdatedAt}`);
  lines.push("");
  lines.push(`## Health`);
  lines.push("");
  lines.push(`Before asset build: ${report.healthBefore.status} · missing imports ${report.healthBefore.summary.missingImports} · delivery failures ${report.healthBefore.summary.deliveryFailures}`);
  if (report.assetBlocks) {
    lines.push(`Asset blocks: ${report.assetBlocks.blocksWritten} blocks from ${report.assetBlocks.assetsProcessed} assets -> ${report.assetBlocks.path}`);
    if (report.assetBlocks.skipped.length) {
      lines.push(`Skipped asset block inputs:`);
      for (const skipped of report.assetBlocks.skipped) lines.push(`- ${skipped.relPath}: ${skipped.reason}`);
    }
  } else {
    lines.push(`Asset blocks: skipped by command option`);
  }
  lines.push(`After asset build: ${report.healthAfter.status} · missing imports ${report.healthAfter.summary.missingImports} · delivery failures ${report.healthAfter.summary.deliveryFailures}`);
  const healthIssues = issueLines(report.healthAfter);
  if (healthIssues.length) {
    lines.push("");
    lines.push(`Health issues:`);
    lines.push(...healthIssues);
  }
  lines.push("");
  lines.push(`## Batches`);
  lines.push("");
  lines.push(`| Batch | Format | Delivery | Blockers | Warnings | Proposal rows | Export |`);
  lines.push(`|---|---|---:|---:|---:|---:|---|`);
  for (const batch of report.batches) {
    const exportStatus = batch.export ? `${batch.export.updatedSegments} updated -> ${batch.export.outputPath}` : batch.exportError ? `FAILED: ${batch.exportError}` : "not exported";
    lines.push(`| ${batch.batchId} | ${batch.format} | ${batch.delivery.status} | ${batch.delivery.blockers.length} | ${batch.delivery.warnings.length} | ${batch.proposals.proposed} proposed / ${batch.proposals.applied} applied / ${batch.proposals.rejected} rejected | ${exportStatus.replace(/\|/g, "\\|")} |`);
  }
  lines.push("");
  lines.push(`## Delivery Risk`);
  lines.push("");
  if (report.p0p1DeliveryRisks.length) {
    for (const risk of report.p0p1DeliveryRisks) lines.push(`- ${risk}`);
  } else {
    lines.push(`No P0/P1 delivery blockers were detected by delivery_check for the selected batch set.`);
  }
  if (report.mappingCandidates.length) {
    lines.push("");
    lines.push(`## Mapping Candidates`);
    lines.push("");
    for (const row of report.mappingCandidates) {
      lines.push(`### ${row.assetPath} (${row.purpose})`);
      if (row.error) {
        lines.push(`- ERROR: ${row.error}`);
        continue;
      }
      if (!row.candidates.length) {
        lines.push(`- No candidates found; ask the user for exact sheet and columns.`);
        continue;
      }
      for (const [index, candidate] of row.candidates.entries()) {
        lines.push(
          `- ${index + 1}. ${candidate.sheetName}: source=${candidate.sourceColumn.replace(/\n/g, " ")}; target=${candidate.targetColumn.replace(/\n/g, " ")}; note=${candidate.noteColumn?.replace(/\n/g, " ") ?? "-"}; score=${candidate.score}; rows=${candidate.rowCount}`,
        );
      }
    }
  }
  if (report.warnings.length) {
    lines.push("");
    lines.push(`## Warnings / Follow-up`);
    lines.push("");
    for (const warning of report.warnings) lines.push(`- ${warning}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function collectMappingCandidates(
  workspaceRoot: string,
  projectId: string,
  health: ProjectHealthReport,
): Promise<RealAlphaReport["mappingCandidates"]> {
  const rows: RealAlphaReport["mappingCandidates"] = [];
  for (const action of health.missingSuggestedActions) {
    const purpose = action.tool === "workbook_preview -> tm_import_table" ? "tm" : action.tool === "workbook_preview -> termbase_import_table" ? "termbase" : undefined;
    if (!purpose) continue;
    try {
      const result = await suggestWorkbookMappingCandidates(workspaceRoot, {
        projectId,
        assetPath: action.assetPath,
        purpose,
        maxSheets: 12,
        sampleRows: 12,
        limit: 6,
      });
      rows.push({ assetPath: action.assetPath, purpose, candidates: result.candidates });
    } catch (error) {
      rows.push({ assetPath: action.assetPath, purpose, candidates: [], error: error instanceof Error ? error.message : String(error) });
    }
  }
  return rows;
}

export async function runRealAlpha(workspaceRoot: string, options: RunRealAlphaOptions): Promise<RealAlphaReport> {
  const checkedAt = new Date().toISOString();
  const manifest = await readProjectManifest(workspaceRoot, options.projectId);
  const healthBefore = await runProjectHealthCheck(workspaceRoot, options.projectId);
  let assetBlocks: AssetBlockBuildReport | undefined;
  if (options.buildAssets !== false) {
    assetBlocks = await buildAssetBlocks(workspaceRoot, { projectId: options.projectId });
  }
  const healthAfter = await runProjectHealthCheck(workspaceRoot, options.projectId);
  const mappingCandidates = await collectMappingCandidates(workspaceRoot, options.projectId, healthAfter);
  const batchIds = options.batchIds?.length ? options.batchIds : await listBatchIds(workspaceRoot, options.projectId);
  if (!batchIds.length) throw new Error(`No imported batches found for project ${options.projectId}.`);

  const batches: RealAlphaBatchResult[] = [];
  for (const batchId of batchIds) {
    const batch = await readBatch(workspaceRoot, options.projectId, batchId);
    const delivery = await runDeliveryCheck(workspaceRoot, options.projectId, batchId);
    const proposals = proposalTotals(await listProposalSets(workspaceRoot, options.projectId, batchId));
    const result: RealAlphaBatchResult = { batchId, format: batch.format, delivery, proposals };
    if (options.exportBatches !== false && !delivery.blockers.length) {
      try {
        result.export = await exportBatch(workspaceRoot, options.projectId, batchId, batch.format);
      } catch (error) {
        result.exportError = error instanceof Error ? error.message : String(error);
      }
    }
    batches.push(result);
  }

  const p0p1DeliveryRisks: string[] = [];
  for (const batch of batches) {
    for (const blocker of batch.delivery.blockers) p0p1DeliveryRisks.push(`${batch.batchId} ${blocker.code}: ${blocker.message}`);
    if (options.exportBatches !== false && !batch.export) p0p1DeliveryRisks.push(`${batch.batchId} export did not complete${batch.exportError ? `: ${batch.exportError}` : ""}.`);
  }

  const warnings: string[] = [];
  if (healthAfter.summary.missingImports) warnings.push(`${healthAfter.summary.missingImports} suggested import/index actions remain unsatisfied; review whether they are required for this project phase.`);
  for (const row of mappingCandidates) {
    if (row.error) warnings.push(`Mapping candidates for ${row.assetPath} could not be generated: ${row.error}`);
    else if (row.candidates.length) warnings.push(`${row.assetPath} has ${row.candidates.length} mapping candidates ready for user confirmation.`);
  }
  if (healthAfter.summary.addedAssets || healthAfter.summary.removedAssets || healthAfter.summary.changedAssets) warnings.push("Project manifest differs from the current folder scan; run project_refresh before relying on asset freshness.");
  if (assetBlocks?.skipped.length) warnings.push(`${assetBlocks.skipped.length} readable assets were skipped during asset block indexing.`);
  for (const batch of batches) {
    if (batch.delivery.warnings.length) warnings.push(`${batch.batchId} has ${batch.delivery.warnings.length} delivery warnings.`);
    if (batch.proposals.proposed) warnings.push(`${batch.batchId} has ${batch.proposals.proposed} unapplied proposal rows.`);
  }

  const status: RealAlphaReport["status"] = p0p1DeliveryRisks.length ? "fail" : warnings.length ? "warn" : "pass";
  const reportDir = options.reportDir ?? join(workspaceRoot, "data", "reports");
  await mkdir(reportDir, { recursive: true });
  const reportPath = join(reportDir, `la_alpha_${options.projectId}_${checkedAt.replace(/[:.]/g, "-")}.md`);
  const report: RealAlphaReport = {
    projectId: options.projectId,
    checkedAt,
    root: manifest.root,
    manifestUpdatedAt: manifest.updatedAt,
    healthBefore,
    assetBlocks,
    healthAfter,
    batches,
    status,
    p0p1DeliveryRisks,
    warnings,
    mappingCandidates,
    reportPath,
  };
  await writeFile(reportPath, renderMarkdown(report), "utf8");
  return report;
}
