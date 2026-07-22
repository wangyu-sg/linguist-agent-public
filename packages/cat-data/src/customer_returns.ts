import { basename, isAbsolute, resolve } from "node:path";
import { readBatch, type CatBatch } from "./batch_workspace.js";
import { readProjectManifest } from "./project_manifest.js";
import { readXlsxBatchRows, type TableBatchRow } from "./table_batch.js";
import { createTmStore } from "./tm.js";
import { createWorkspace, readJsonFile, workspacePath, writeJsonFile } from "./workspace.js";

export interface CustomerReturnChange {
  segmentId: string;
  source: string;
  previousTarget: string;
  returnedTarget: string;
  rowNo: number;
  note?: string;
  evidenceSource: string;
}

export interface CustomerReturnLearnReport {
  schemaVersion: 1;
  projectId: string;
  batchId: string;
  learnedAt: string;
  sourceFile: string;
  changedRows: number;
  reviewedTmUpdated: number;
  rows: CustomerReturnChange[];
}

interface CustomerReturnHistoryDocument {
  schemaVersion: 1;
  reports: CustomerReturnLearnReport[];
}

function normalizeTarget(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function customerReturnsPath(workspaceRoot: string, projectId: string): string {
  return workspacePath(createWorkspace(workspaceRoot, projectId), "customer_returns.json");
}

async function resolveProjectFile(workspaceRoot: string, projectId: string, path: string): Promise<string> {
  if (isAbsolute(path)) return path;
  const manifest = await readProjectManifest(workspaceRoot, projectId);
  return resolve(manifest.root, path);
}

function normalizeDocument(raw: CustomerReturnHistoryDocument | CustomerReturnLearnReport[]): CustomerReturnHistoryDocument {
  if (Array.isArray(raw)) return { schemaVersion: 1, reports: raw };
  return { schemaVersion: 1, reports: Array.isArray(raw.reports) ? raw.reports : [] };
}

export function findCustomerReturnChanges(
  batch: CatBatch,
  returnedRows: TableBatchRow[],
  evidenceSource: string,
): CustomerReturnChange[] {
  const byId = new Map(batch.segments.map((segment) => [segment.id, segment]));
  const changes: CustomerReturnChange[] = [];
  for (const row of returnedRows) {
    const segment = byId.get(row.id);
    if (!segment) continue;
    const returnedTarget = normalizeTarget(row.target);
    if (!returnedTarget) continue;
    const previousTarget = normalizeTarget(segment.target);
    if (previousTarget === returnedTarget) continue;
    changes.push({
      segmentId: segment.id,
      source: segment.source,
      previousTarget: segment.target,
      returnedTarget: row.target,
      rowNo: row.rowNo,
      note: row.note,
      evidenceSource,
    });
  }
  return changes;
}

export async function readCustomerReturnHistory(workspaceRoot: string, projectId: string): Promise<CustomerReturnLearnReport[]> {
  const raw = await readJsonFile<CustomerReturnHistoryDocument | CustomerReturnLearnReport[]>(
    customerReturnsPath(workspaceRoot, projectId),
    { schemaVersion: 1, reports: [] },
  );
  return normalizeDocument(raw).reports;
}

export async function learnCustomerReturn(
  workspaceRoot: string,
  options: { projectId: string; batchId: string; xlsxPath: string; importReviewedTm?: boolean },
): Promise<CustomerReturnLearnReport> {
  const sourceFile = await resolveProjectFile(workspaceRoot, options.projectId, options.xlsxPath);
  const batch = await readBatch(workspaceRoot, options.projectId, options.batchId);
  const returned = await readXlsxBatchRows(sourceFile);
  const evidenceSource = `customer_return:${basename(sourceFile)}:${returned.sheetName}`;
  const rows = findCustomerReturnChanges(batch, returned.rows, evidenceSource);
  let reviewedTmUpdated = 0;
  if (options.importReviewedTm !== false && rows.length) {
    const tm = createTmStore(createWorkspace(workspaceRoot, options.projectId));
    for (const row of rows) {
      const result = await tm.upsertReviewed({
        source: row.source,
        target: row.returnedTarget,
        srcLang: batch.sourceLanguage,
        tgtLang: batch.targetLanguage,
        project: options.projectId,
        quality: 100,
        origin: "reviewed",
        note: `${row.evidenceSource}:row-${row.rowNo}`,
        sourceKind: "customer_return",
        sourceBatchId: options.batchId,
        sourceSegmentId: row.segmentId,
      });
      if (result.action !== "unchanged") reviewedTmUpdated += 1;
    }
  }
  const report: CustomerReturnLearnReport = {
    schemaVersion: 1,
    projectId: options.projectId,
    batchId: options.batchId,
    learnedAt: new Date().toISOString(),
    sourceFile,
    changedRows: rows.length,
    reviewedTmUpdated,
    rows,
  };
  const existing = await readCustomerReturnHistory(workspaceRoot, options.projectId);
  await writeJsonFile(customerReturnsPath(workspaceRoot, options.projectId), {
    schemaVersion: 1,
    reports: [report, ...existing],
  });
  return report;
}

export function formatCustomerReturnMarkdown(report: CustomerReturnLearnReport): string {
  const lines = [
    `# Customer Return Learn · ${report.batchId}`,
    "",
    `Changed rows: ${report.changedRows}`,
    `Reviewed TM updated: ${report.reviewedTmUpdated}`,
    `Source file: ${report.sourceFile}`,
    "",
    "## Rows",
  ];
  if (!report.rows.length) {
    lines.push("", "No customer-return differences were found.");
  } else {
    for (const row of report.rows.slice(0, 200)) {
      lines.push(
        "",
        `- ${row.segmentId} · row ${row.rowNo}`,
        `  - source: ${row.source}`,
        `  - before: ${row.previousTarget}`,
        `  - customer: ${row.returnedTarget}`,
      );
    }
    if (report.rows.length > 200) lines.push("", `... ${report.rows.length - 200} more row(s) omitted from Markdown preview.`);
  }
  return `${lines.join("\n")}\n`;
}
