import { stat } from "node:fs/promises";
import { join } from "node:path";
import { listBatches, readBatch, type CatBatch } from "./batch_workspace.js";
import { runProjectHealthCheck, type ProjectHealthReport } from "./project_health.js";
import { readProjectManifest } from "./project_manifest.js";

export interface ProjectContextBatch {
  batchId: string;
  format: string;
  segments: number;
  confirmed: number;
  draft: number;
  new: number;
  locked: number;
}

export interface ProjectContextMissingBatchFile {
  batchId: string;
  kind: "source" | "master";
  path: string;
}

export type ProjectContextDetailSection =
  | "batches"
  | "confirmed_asset_roles"
  | "warnings"
  | "questions"
  | "missing_assets"
  | "changed_assets"
  | "missing_batch_files";

export interface ProjectContextDetailPage {
  projectId: string;
  section: ProjectContextDetailSection;
  start: number;
  limit: number;
  total: number;
  returned: number;
  nextStart: number | null;
  pageComplete: boolean;
  items: Array<ProjectContextBatch | { relPath: string; role: string } | ProjectContextMissingBatchFile | string>;
}

export interface ProjectContextSnapshot {
  projectId: string;
  projectRoot: string;
  sourceLanguage: string;
  targetLanguage: string;
  manifestUpdatedAt: string;
  assetsByRole: Record<string, number>;
  confirmedAssetRoles: Array<{ relPath: string; role: string }>;
  warnings: string[];
  questions: string[];
  batches: ProjectContextBatch[];
  coverage: {
    totalAssets: number;
    confirmedAssetRoles: number;
    visibleConfirmedAssetRoles: number;
    totalWarnings: number;
    visibleWarnings: number;
    totalQuestions: number;
    visibleQuestions: number;
    totalBatches: number;
    visibleBatches: number;
  };
  freshness: {
    checkedAt: string;
    projectRootExists: boolean;
    manifestAgeHours: number;
    missingAssetPaths: string[];
    assetsChecked: number;
    assetsAvailable: number;
    detectedMissingAssets: number;
    sizeChangedAssetPaths: string[];
    detectedChangedAssets: number;
    missingBatchFiles: Array<{ batchId: string; kind: "source" | "master"; path: string }>;
    batchesChecked: number;
    detectedMissingBatchFiles: number;
  };
  health?: {
    status: ProjectHealthReport["status"];
    checkedAt: string;
    summary: ProjectHealthReport["summary"];
    issueCount: number;
    issues: Array<Pick<ProjectHealthReport["issues"][number], "severity" | "code" | "message" | "nextActions">>;
  };
  contextPolicy: {
    useToolsForEvidence: true;
    traceIsEvidence: false;
    lockedRowsImmutable: true;
    memoryIsRecallOnly: true;
  };
}

function countByRole(assets: Array<{ role: string }>): Record<string, number> {
  const roles: Record<string, number> = {};
  for (const asset of assets) roles[asset.role] = (roles[asset.role] ?? 0) + 1;
  return Object.fromEntries(Object.entries(roles).sort(([a], [b]) => a.localeCompare(b)));
}

function uniqueStrings(...groups: string[][]): string[] {
  return [...new Set(groups.flat().filter(Boolean))];
}

function summarizeBatch(batch: CatBatch): ProjectContextBatch {
  return {
    batchId: batch.batchId,
    format: batch.format,
    segments: batch.segments.length,
    confirmed: batch.segments.filter((segment) => segment.status === "confirmed").length,
    draft: batch.segments.filter((segment) => segment.status === "draft").length,
    new: batch.segments.filter((segment) => segment.status === "new").length,
    locked: batch.segments.filter((segment) => segment.locked).length,
  };
}

async function mapInChunks<T, R>(items: readonly T[], mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let offset = 0; offset < items.length; offset += 16) {
    results.push(...await Promise.all(items.slice(offset, offset + 16).map(mapper)));
  }
  return results;
}

async function batchContext(workspaceRoot: string, projectId: string): Promise<{ rows: ProjectContextBatch[]; batches: CatBatch[] }> {
  const refs = (await listBatches(workspaceRoot, projectId)).sort((a, b) => a.batchId.localeCompare(b.batchId));
  const loaded = await mapInChunks(refs, (ref) => readBatch(workspaceRoot, projectId, ref.batchId));
  const rows = loaded.slice(0, 12).map(summarizeBatch);
  return { rows, batches: loaded };
}

export async function readProjectContextDetailPage(
  workspaceRoot: string,
  projectId: string,
  section: ProjectContextDetailSection,
  options: { start?: number; limit?: number } = {},
): Promise<ProjectContextDetailPage> {
  const start = Math.max(1, Math.floor(options.start ?? 1));
  const limit = Math.max(1, Math.min(200, Math.floor(options.limit ?? 50)));
  const manifest = await readProjectManifest(workspaceRoot, projectId);
  let all: ProjectContextDetailPage["items"];

  if (section === "batches") {
    const refs = (await listBatches(workspaceRoot, projectId)).sort((a, b) => a.batchId.localeCompare(b.batchId));
    all = await mapInChunks(refs.slice(start - 1, start - 1 + limit), async (ref) => summarizeBatch(await readBatch(workspaceRoot, projectId, ref.batchId)));
    const nextStart = start - 1 + all.length < refs.length ? start + all.length : null;
    return { projectId, section, start, limit, total: refs.length, returned: all.length, nextStart, pageComplete: nextStart === null, items: all };
  }

  if (section === "missing_assets" || section === "changed_assets" || section === "missing_batch_files") {
    const { batches } = await batchContext(workspaceRoot, projectId);
    const freshness = await buildFreshness(manifest, batches);
    all = section === "missing_assets"
      ? freshness.allMissingAssetPaths
      : section === "changed_assets"
        ? freshness.allSizeChangedAssetPaths
        : freshness.allMissingBatchFiles;
  } else if (section === "confirmed_asset_roles") {
    all = manifest.assetRoleDecisions
      .filter((decision) => decision.status === "confirmed")
      .map((decision) => ({ relPath: decision.relPath, role: decision.role }));
  } else if (section === "warnings") {
    all = uniqueStrings(manifest.warnings, manifest.scan.warnings);
  } else {
    all = uniqueStrings(manifest.questions, manifest.scan.questions);
  }

  const total = all.length;
  const items = all.slice(start - 1, start - 1 + limit);
  const nextStart = start - 1 + items.length < total ? start + items.length : null;
  return { projectId, section, start, limit, total, returned: items.length, nextStart, pageComplete: nextStart === null, items };
}

export function formatProjectContextDetailPage(page: ProjectContextDetailPage): string {
  const lines = [
    "# Project Context Detail",
    "",
    `Project: ${page.projectId}`,
    `Section: ${page.section}`,
    `Start: ${page.start}`,
    `Returned: ${page.returned}/${page.total}`,
    `Page complete: ${page.pageComplete ? "yes" : "no"}`,
    `Next start: ${page.nextStart ?? "none"}`,
    "",
  ];
  for (const item of page.items) {
    if (typeof item === "string") lines.push(`- ${item}`);
    else if ("batchId" in item && "format" in item) lines.push(`- ${item.batchId}: ${item.format}, ${item.segments} seg, ${item.confirmed} confirmed, ${item.draft} draft, ${item.new} new, ${item.locked} locked`);
    else if ("batchId" in item) lines.push(`- ${item.batchId} ${item.kind}: ${item.path}`);
    else lines.push(`- ${item.relPath}=${item.role}`);
  }
  if (!page.items.length) lines.push("- None.");
  if (page.nextStart !== null) lines.push("", `Continue with section=${page.section}, start=${page.nextStart}.`);
  return lines.join("\n");
}

async function existsAndSize(path: string): Promise<{ exists: boolean; size?: number }> {
  try {
    const info = await stat(path);
    return { exists: true, size: info.size };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false };
    throw error;
  }
}

async function buildFreshness(manifest: Awaited<ReturnType<typeof readProjectManifest>>, batches: CatBatch[]) {
  const checkedAt = new Date().toISOString();
  const projectRootInfo = await existsAndSize(manifest.root);
  const manifestAgeMs = Date.now() - Date.parse(manifest.updatedAt);
  const manifestAgeHours = Number((Math.max(0, manifestAgeMs) / 3_600_000).toFixed(2));
  const missingAssetPaths: string[] = [];
  const sizeChangedAssetPaths: string[] = [];
  let assetsAvailable = 0;
  const assetResults = await mapInChunks(manifest.scan.assets, async (asset) => {
    const path = join(manifest.root, asset.relPath);
    const info = await existsAndSize(path);
    return { asset, info };
  });
  for (const { asset, info } of assetResults) {
    if (!info.exists) missingAssetPaths.push(asset.relPath);
    else {
      assetsAvailable += 1;
      if (typeof info.size === "number" && info.size !== asset.sizeBytes) sizeChangedAssetPaths.push(asset.relPath);
    }
  }
  const missingBatchFiles = (await mapInChunks(batches, async (batch) => {
    const missing: Array<{ batchId: string; kind: "source" | "master"; path: string }> = [];
    if (!(await existsAndSize(batch.sourceFile)).exists) missing.push({ batchId: batch.batchId, kind: "source", path: batch.sourceFile });
    if (batch.masterFile && !(await existsAndSize(batch.masterFile)).exists) missing.push({ batchId: batch.batchId, kind: "master", path: batch.masterFile });
    return missing;
  })).flat();
  return {
    checkedAt,
    projectRootExists: projectRootInfo.exists,
    manifestAgeHours,
    assetsChecked: manifest.scan.assets.length,
    assetsAvailable,
    detectedMissingAssets: missingAssetPaths.length,
    missingAssetPaths: missingAssetPaths.slice(0, 20),
    allMissingAssetPaths: missingAssetPaths,
    detectedChangedAssets: sizeChangedAssetPaths.length,
    sizeChangedAssetPaths: sizeChangedAssetPaths.slice(0, 20),
    allSizeChangedAssetPaths: sizeChangedAssetPaths,
    batchesChecked: batches.length,
    detectedMissingBatchFiles: missingBatchFiles.length,
    missingBatchFiles: missingBatchFiles.slice(0, 20),
    allMissingBatchFiles: missingBatchFiles,
  };
}

export async function buildProjectContextSnapshot(
  workspaceRoot: string,
  projectId: string,
  options: { includeHealth?: boolean } = {},
): Promise<ProjectContextSnapshot> {
  const manifest = await readProjectManifest(workspaceRoot, projectId);
  const [batchPreview, health] = await Promise.all([
    batchContext(workspaceRoot, projectId),
    options.includeHealth ? runProjectHealthCheck(workspaceRoot, projectId) : undefined,
  ]);
  const batches = batchPreview.rows;
  const freshnessScan = await buildFreshness(manifest, batchPreview.batches);
  const {
    allMissingAssetPaths: _allMissingAssetPaths,
    allSizeChangedAssetPaths: _allSizeChangedAssetPaths,
    allMissingBatchFiles: _allMissingBatchFiles,
    ...freshness
  } = freshnessScan;
  const confirmedAssetRoles = manifest.assetRoleDecisions
    .filter((decision) => decision.status === "confirmed")
    .map((decision) => ({ relPath: decision.relPath, role: decision.role }));
  const warnings = uniqueStrings(manifest.warnings, manifest.scan.warnings);
  const questions = uniqueStrings(manifest.questions, manifest.scan.questions);

  return {
    projectId: manifest.projectId,
    projectRoot: manifest.root,
    sourceLanguage: manifest.sourceLanguage,
    targetLanguage: manifest.targetLanguage,
    manifestUpdatedAt: manifest.updatedAt,
    assetsByRole: countByRole(manifest.scan.assets),
    confirmedAssetRoles: confirmedAssetRoles.slice(0, 20),
    warnings: warnings.slice(0, 20),
    questions: questions.slice(0, 20),
    batches,
    coverage: {
      totalAssets: manifest.scan.assets.length,
      confirmedAssetRoles: confirmedAssetRoles.length,
      visibleConfirmedAssetRoles: Math.min(20, confirmedAssetRoles.length),
      totalWarnings: warnings.length,
      visibleWarnings: Math.min(20, warnings.length),
      totalQuestions: questions.length,
      visibleQuestions: Math.min(20, questions.length),
      totalBatches: batchPreview.batches.length,
      visibleBatches: batches.length,
    },
    freshness,
    health: health
      ? {
          status: health.status,
          checkedAt: health.checkedAt,
          summary: health.summary,
          issueCount: health.issues.length,
          issues: health.issues
            .map((issue) => ({
              severity: issue.severity,
              code: issue.code,
              message: issue.message,
              nextActions: issue.nextActions?.slice(0, 4),
            }))
            .slice(0, 12),
        }
      : undefined,
    contextPolicy: {
      useToolsForEvidence: true,
      traceIsEvidence: false,
      lockedRowsImmutable: true,
      memoryIsRecallOnly: true,
    },
  };
}

export function formatProjectContextSnapshot(snapshot: ProjectContextSnapshot): string {
  const sourceLanguage = snapshot.sourceLanguage?.trim() || "unspecified";
  const targetLanguage = snapshot.targetLanguage?.trim() || "unspecified";
  const lines = [
    "Linguist Agent CAT project context:",
    `- project_id: ${snapshot.projectId}`,
    `- project_root: ${snapshot.projectRoot}`,
    `- project_default_language_pair: ${sourceLanguage} -> ${targetLanguage}`,
    `- manifest_updated_at: ${snapshot.manifestUpdatedAt}`,
  ];
  const assets = Object.entries(snapshot.assetsByRole).map(([role, count]) => `${role}:${count}`).join(", ");
  lines.push(`- assets: ${assets || "none"}`);
  lines.push(
    `- freshness: root=${snapshot.freshness.projectRootExists ? "present" : "missing"}, manifest_age_hours=${snapshot.freshness.manifestAgeHours}, assets_checked=${snapshot.freshness.assetsChecked}/${snapshot.freshness.assetsAvailable}, missing_assets_detected=${snapshot.freshness.detectedMissingAssets}, changed_assets_detected=${snapshot.freshness.detectedChangedAssets}, batches_checked=${snapshot.freshness.batchesChecked}/${snapshot.coverage.totalBatches}, missing_batch_files_detected=${snapshot.freshness.detectedMissingBatchFiles}; path lists below may be previews`,
  );
  if (snapshot.freshness.detectedMissingAssets) {
    lines.push(`- missing_asset_paths: showing ${snapshot.freshness.missingAssetPaths.length}/${snapshot.freshness.detectedMissingAssets}; page with project_context section=missing_assets`);
  }
  if (snapshot.freshness.detectedChangedAssets) {
    lines.push(`- changed_asset_paths: showing ${snapshot.freshness.sizeChangedAssetPaths.length}/${snapshot.freshness.detectedChangedAssets}; page with project_context section=changed_assets`);
  }
  if (snapshot.freshness.detectedMissingBatchFiles) {
    lines.push(`- missing_batch_files: showing ${snapshot.freshness.missingBatchFiles.length}/${snapshot.freshness.detectedMissingBatchFiles}; page with project_context section=missing_batch_files`);
  }
  if (snapshot.confirmedAssetRoles.length) {
    lines.push(`- confirmed_asset_roles: showing ${snapshot.coverage.visibleConfirmedAssetRoles}/${snapshot.coverage.confirmedAssetRoles}: ${snapshot.confirmedAssetRoles.map((item) => `${item.relPath}=${item.role}`).join(" | ")}; page with project_context section=confirmed_asset_roles`);
  }
  if (snapshot.warnings.length) lines.push(`- warnings: showing ${Math.min(6, snapshot.warnings.length)}/${snapshot.coverage.totalWarnings}: ${snapshot.warnings.slice(0, 6).join(" | ")}; page with project_context section=warnings`);
  if (snapshot.questions.length) lines.push(`- open_questions: showing ${Math.min(6, snapshot.questions.length)}/${snapshot.coverage.totalQuestions}: ${snapshot.questions.slice(0, 6).join(" | ")}; page with project_context section=questions`);
  if (snapshot.batches.length) {
    lines.push(`- imported_batches: showing ${snapshot.coverage.visibleBatches}/${snapshot.coverage.totalBatches}; all ${snapshot.freshness.batchesChecked} batch records were scanned for freshness; page omitted summaries with project_context section=batches`);
    for (const batch of snapshot.batches) {
      lines.push(
        `  - ${batch.batchId}: ${batch.format}, ${batch.segments} seg, ${batch.confirmed} confirmed, ${batch.draft} draft, ${batch.new} new, ${batch.locked} locked`,
      );
    }
  } else {
    lines.push("- imported_batches: none");
  }
  if (snapshot.health) {
    lines.push(`- project_health: ${snapshot.health.status} checked_at=${snapshot.health.checkedAt}`);
    lines.push(
      `- health_summary: missing_imports=${snapshot.health.summary.missingImports}, delivery_failures=${snapshot.health.summary.deliveryFailures}, delivery_warnings=${snapshot.health.summary.deliveryWarnings}, unapplied_proposals=${snapshot.health.summary.unappliedProposalRows}`,
    );
    lines.push(`- health_issues: showing ${Math.min(6, snapshot.health.issues.length)}/${snapshot.health.issueCount}; read project health before declaring readiness`);
    for (const issue of snapshot.health.issues.slice(0, 6)) {
      lines.push(`  - ${issue.severity}:${issue.code}: ${issue.message}`);
      for (const action of issue.nextActions ?? []) lines.push(`    next: ${action}`);
    }
  }
  lines.push(
    "- policy: a selected Batch/Task locale pair is authoritative for scoped work; the project pair is only the default for new imports.",
    "- policy: use CAT tools for project authority; term/terminology writes require returned evidenceSources. Source/target/context can establish ordinary accuracy and consistency.",
    "- policy: tool_trace is audit data, not evidence; project memory is recall context, not citable CAT evidence.",
    "- policy: locked rows and unsafe tag changes must remain blocked.",
  );
  return lines.join("\n");
}
