import { readdir, stat } from "node:fs/promises";
import { readBatch } from "./batch_workspace.js";
import { runDeliveryCheck, type DeliveryReport } from "./delivery.js";
import { readProjectManifest } from "./project_manifest.js";
import { scanProjectFolder, type DiscoveredAsset, type SuggestedImportAction } from "./project_scan.js";
import { createWorkspace, readJsonFile, workspacePath } from "./workspace.js";

export type ProjectHealthSeverity = "blocker" | "warning" | "info";

export interface ProjectHealthIssue {
  severity: ProjectHealthSeverity;
  code: string;
  message: string;
  assetPaths?: string[];
  batchIds?: string[];
  nextActions?: string[];
}

export interface ProjectHealthBatch {
  batchId: string;
  format: string;
  totalSegments: number;
  lockedSegments: number;
  status: DeliveryReport["status"];
  blockers: number;
  warnings: number;
}

export interface ProjectHealthReport {
  status: "pass" | "warn" | "fail";
  projectId: string;
  checkedAt: string;
  root: string;
  manifestUpdatedAt: string;
  summary: {
    assets: number;
    suggestedActions: number;
    missingImports: number;
    addedAssets: number;
    removedAssets: number;
    changedAssets: number;
    batches: number;
    deliveryFailures: number;
    deliveryWarnings: number;
    unappliedProposalRows: number;
  };
  issues: ProjectHealthIssue[];
  missingSuggestedActions: SuggestedImportAction[];
  batches: ProjectHealthBatch[];
}

function byRelPath(assets: DiscoveredAsset[]): Map<string, DiscoveredAsset> {
  return new Map(assets.map((asset) => [asset.relPath, asset]));
}

function assetChanged(before: DiscoveredAsset, after: DiscoveredAsset): boolean {
  return before.sizeBytes !== after.sizeBytes || before.role !== after.role || before.confidence !== after.confidence;
}

async function jsonArrayCount(path: string): Promise<number> {
  return (await readJsonFile<unknown[]>(path, [])).length;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
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

async function satisfiedImportAction(workspaceRoot: string, projectId: string, action: SuggestedImportAction, batchIds: string[]): Promise<boolean> {
  const workspace = createWorkspace(workspaceRoot, projectId);
  if (!action.tool) return true;
  if (action.tool.startsWith("tm_import_") || action.tool === "workbook_preview -> tm_import_table") {
    return (await jsonArrayCount(workspacePath(workspace, "tm.json"))) > 0;
  }
  if (action.tool.startsWith("termbase_import_") || action.tool === "workbook_preview -> termbase_import_table") {
    return (await jsonArrayCount(workspacePath(workspace, "termbase.json"))) > 0;
  }
  if (action.tool === "asset_blocks_build") {
    return fileExists(workspacePath(workspace, "asset_blocks.jsonl"));
  }
  if (
    action.tool === "batch_import_phrase" ||
    action.tool === "batch_import_mqxliff" ||
    action.tool === "batch_import_sdlxliff" ||
    action.tool === "batch_import_xliff" ||
    action.tool === "batch_import_csv" ||
    action.tool === "batch_import_xlsx"
  ) {
    for (const batchId of batchIds) {
      const batch = await readBatch(workspaceRoot, projectId, batchId);
      if (batch.sourceFile.endsWith(action.assetPath)) return true;
    }
    return false;
  }
  return true;
}

function nextActionsForSuggestedImport(action: SuggestedImportAction): string[] {
  if (action.tool === "workbook_preview -> termbase_import_table") {
    return [
      `Run workbook_mapping_candidates(projectId="<projectId>", assetPath="${action.assetPath}", purpose="termbase") to rank sheet/source/target/note mappings.`,
      "Ask the user to confirm which candidate is authoritative before calling termbase_import_table.",
    ];
  }
  if (action.tool === "workbook_preview -> tm_import_table") {
    return [
      `Run workbook_mapping_candidates(projectId="<projectId>", assetPath="${action.assetPath}", purpose="tm") to rank sheet/source/target/note mappings.`,
      "Ask the user to confirm the TM source/target columns before calling tm_import_table.",
    ];
  }
  if (action.tool === "asset_blocks_build") return ["Run asset_blocks_build for this project before relying on reference/style/source evidence."];
  if (action.tool) return [`Run ${action.tool} for ${action.assetPath}${action.prerequisites.length ? ` after prerequisites: ${action.prerequisites.join("; ")}` : ""}.`];
  return action.prerequisites.length ? action.prerequisites : [action.action];
}

export async function runProjectHealthCheck(workspaceRoot: string, projectId: string): Promise<ProjectHealthReport> {
  const manifest = await readProjectManifest(workspaceRoot, projectId);
  const freshScan = await scanProjectFolder(manifest.root);
  const before = byRelPath(manifest.scan.assets);
  const after = byRelPath(freshScan.assets);
  const added = freshScan.assets.filter((asset) => !before.has(asset.relPath));
  const removed = manifest.scan.assets.filter((asset) => !after.has(asset.relPath));
  const changed = freshScan.assets.filter((asset) => {
    const old = before.get(asset.relPath);
    return old ? assetChanged(old, asset) : false;
  });

  const issues: ProjectHealthIssue[] = [];
  if (added.length) {
    issues.push({
      severity: "warning",
      code: "ASSET_ADDED_SINCE_MANIFEST",
      message: `${added.length} assets were added since the saved manifest. Run project_refresh before starting new work.`,
      assetPaths: added.map((asset) => asset.relPath),
    });
  }
  if (removed.length) {
    issues.push({
      severity: "warning",
      code: "ASSET_REMOVED_SINCE_MANIFEST",
      message: `${removed.length} assets were removed since the saved manifest. Run project_refresh before starting new work.`,
      assetPaths: removed.map((asset) => asset.relPath),
    });
  }
  if (changed.length) {
    issues.push({
      severity: "warning",
      code: "ASSET_CHANGED_SINCE_MANIFEST",
      message: `${changed.length} assets changed role, confidence, or size since the saved manifest. Run project_refresh before relying on asset status.`,
      assetPaths: changed.map((asset) => asset.relPath),
    });
  }

  const batchIds = await listBatchIds(workspaceRoot, projectId);
  const missingActions: SuggestedImportAction[] = [];
  for (const action of manifest.scan.suggestedActions) {
    if (!(await satisfiedImportAction(workspaceRoot, projectId, action, batchIds))) {
      missingActions.push(action);
    }
  }
  if (missingActions.length) {
    issues.push({
      severity: "warning",
      code: "SUGGESTED_IMPORTS_NOT_SATISFIED",
      message: `${missingActions.length} suggested import/index actions do not appear satisfied yet.`,
      assetPaths: missingActions.map((action) => action.assetPath),
      nextActions: missingActions.flatMap(nextActionsForSuggestedImport),
    });
  }

  const batches: ProjectHealthBatch[] = [];
  let deliveryFailures = 0;
  let deliveryWarnings = 0;
  let unappliedProposalRows = 0;
  for (const batchId of batchIds) {
    const batch = await readBatch(workspaceRoot, projectId, batchId);
    const delivery = await runDeliveryCheck(workspaceRoot, projectId, batchId);
    if (delivery.status === "fail") deliveryFailures += 1;
    if (delivery.status === "warn") deliveryWarnings += 1;
    unappliedProposalRows += delivery.summary.unappliedProposalRows;
    if (delivery.status !== "pass") {
      issues.push({
        severity: delivery.status === "fail" ? "blocker" : "warning",
        code: delivery.status === "fail" ? "BATCH_DELIVERY_BLOCKED" : "BATCH_DELIVERY_WARNINGS",
        message: `Batch ${batchId} delivery status is ${delivery.status}: ${delivery.blockers.length} blockers, ${delivery.warnings.length} warnings.`,
        batchIds: [batchId],
      });
    }
    batches.push({
      batchId,
      format: batch.format,
      totalSegments: batch.segments.length,
      lockedSegments: batch.segments.filter((segment) => segment.locked).length,
      status: delivery.status,
      blockers: delivery.blockers.length,
      warnings: delivery.warnings.length,
    });
  }

  const blockers = issues.filter((issue) => issue.severity === "blocker").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;
  return {
    status: blockers ? "fail" : warnings ? "warn" : "pass",
    projectId,
    checkedAt: new Date().toISOString(),
    root: manifest.root,
    manifestUpdatedAt: manifest.updatedAt,
    summary: {
      assets: manifest.scan.assets.length,
      suggestedActions: manifest.scan.suggestedActions.length,
      missingImports: missingActions.length,
      addedAssets: added.length,
      removedAssets: removed.length,
      changedAssets: changed.length,
      batches: batches.length,
      deliveryFailures,
      deliveryWarnings,
      unappliedProposalRows,
    },
    issues,
    missingSuggestedActions: missingActions,
    batches,
  };
}
