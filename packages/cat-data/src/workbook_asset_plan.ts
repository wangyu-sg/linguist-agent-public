import { isAbsolute, resolve } from "node:path";
import { readProjectLocalePair, readProjectManifest } from "./project_manifest.js";
import { assetBlocksPath } from "./asset_blocks.js";
import { readJsonFile, writeJsonFile } from "./workspace.js";
import { termbasePath, type TermbaseEntry } from "./termbase.js";
import { readWorkbookRows, type WorkbookRows } from "./workbook_mapping.js";
import { termHistoryPath, termHistoryRowsFromSheet, writeTermHistoryRows, type TermHistoryDecision, type TermHistoryRecord } from "./term_history.js";
import type { AssetConfirmedMapping, AssetParseMode } from "./asset_ingestion_contract.js";
import {
  classifyWorkbookAssetSheet,
  assetTypedIndexPath,
  confirmTypedAssetCandidates,
  parseWorkbookTypedAsset,
  writeAssetTypedIndex,
  writeTypedBlocks,
  type AssetTypedIndex,
} from "./asset_typed_index.js";

export type WorkbookAssetRole =
  | "termbase"
  | "termbase_delta"
  | "candidate_terms"
  | "glossary"
  | "style_guide"
  | "project_requirements"
  | "qa_reference"
  | "issue_log"
  | "checklist"
  | "source_table"
  | "reference";
export type WorkbookAssetAction = "import_terms" | "import_term_delta" | "resolve_term_history" | "index_reference" | "needs_mapping";

export interface WorkbookAssetSheetOverride {
  sheetName: string;
  role: WorkbookAssetRole;
  action?: WorkbookAssetAction;
  reason?: string;
}

export interface WorkbookAssetSheetPlan {
  sheetName: string;
  role: WorkbookAssetRole;
  action: WorkbookAssetAction;
  reason: string;
  rowCount: number;
  headers: string[];
  sampleRows: string[][];
  importableTerms: number;
  referenceBlocks: number;
  diagnostics: Array<{ label: string; value: string | number }>;
  warnings: string[];
  parserKind?: string;
  parserStatus?: "ready" | "candidate" | "skipped";
  typedRowCount?: number;
  candidateCount?: number;
  blockCount?: number;
  trace?: string[];
}

export interface WorkbookAssetPlan {
  projectId: string;
  assetPath: string;
  resolvedPath: string;
  parseMode?: AssetParseMode;
  mappingProfileId?: string;
  sheets: WorkbookAssetSheetPlan[];
  summary: {
    sheets: number;
    importableTermRows: number;
    dedupeTermPairs: number;
    referenceBlocks: number;
    needsMapping: number;
    needsResolution: number;
    typedRows?: number;
    candidateRows?: number;
    typedBlocks?: number;
  };
  warnings: string[];
  typedIndex?: AssetTypedIndex;
}

export interface WorkbookAssetImportResult extends WorkbookAssetPlan {
  termbasePath: string;
  assetBlocksPath: string;
  termHistoryPath: string;
  importedTerms: number;
  importedTermHistoryRows: number;
  skippedDuplicateTerms: number;
  writtenReferenceBlocks: number;
  typedIndexPath: string;
  typedRowsWritten: number;
  candidateRowsWritten: number;
  sampleTerms: TermbaseEntry[];
  termHistoryDecisions: TermHistoryDecision[];
}

interface PlannedTermRow {
  source: string;
  target: string;
  note?: string;
  sheetName: string;
  rowNo: number;
  origin: TermbaseEntry["origin"];
}

const REFERENCE_BLOCK_ROWS = 40;

async function resolveProjectPath(workspaceRoot: string, projectId: string, assetPath: string): Promise<string> {
  if (isAbsolute(assetPath)) return assetPath;
  const manifest = await readProjectManifest(workspaceRoot, projectId);
  return resolve(manifest.root, assetPath);
}

function normalized(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function includesAny(value: string, needles: string[]): boolean {
  const v = normalized(value);
  return needles.some((needle) => v.includes(needle.toLocaleLowerCase()));
}

function isUsefulCell(value: string | undefined): value is string {
  if (!value?.trim()) return false;
  return !["n/a", "na", "none", "-", "无"].includes(value.trim().toLocaleLowerCase());
}

function columnIndex(headers: string[], needles: string[]): number {
  return headers.findIndex((header) => includesAny(header, needles));
}

function rowValue(row: string[], index: number): string {
  return index >= 0 ? (row[index] ?? "").trim() : "";
}

function classifySheet(sheetName: string): Pick<WorkbookAssetSheetPlan, "role" | "action" | "reason"> {
  const classified = classifyWorkbookAssetSheet(sheetName);
  return { role: classified.role, action: classified.action, reason: classified.reason };
}

function actionForRole(role: WorkbookAssetRole): WorkbookAssetAction {
  if (role === "termbase") return "import_terms";
  if (role === "termbase_delta") return "resolve_term_history";
  if (role === "candidate_terms" || role === "glossary") return "needs_mapping";
  return "index_reference";
}

function archivedTermRows(sheet: WorkbookRows): PlannedTermRow[] {
  const sourceIndex = columnIndex(sheet.headers, ["terms - cn", "术语 - 中文", "中文"]);
  const targetIndex = columnIndex(sheet.headers, ["terms - en", "术语 - 英文", "英文"]);
  const noteIndex = columnIndex(sheet.headers, ["description&notes", "description", "描述与备注", "note", "备注"]);
  return sheet.rows
    .map((row, index) => ({
      source: rowValue(row, sourceIndex),
      target: rowValue(row, targetIndex),
      note: rowValue(row, noteIndex),
      sheetName: sheet.sheetName,
      rowNo: index + 2,
      origin: "table" as const,
    }))
    .filter((row) => isUsefulCell(row.source) && isUsefulCell(row.target));
}

function termChangeDiagnostics(sheet: WorkbookRows): {
  diagnostics: Array<{ label: string; value: string | number }>;
  warnings: string[];
} {
  const oldSourceIndex = columnIndex(sheet.headers, ["old source", "改前原文"]);
  const newSourceIndex = columnIndex(sheet.headers, ["new source", "改后原文"]);
  const oldTargetIndex = columnIndex(sheet.headers, ["old target", "改前译文"]);
  const newTargetIndex = columnIndex(sheet.headers, ["new target", "改后译文"]);
  const statusIndex = columnIndex(sheet.headers, ["final confirm", "最终确认"]);
  const typeIndex = columnIndex(sheet.headers, ["type", "类型"]);
  const categoryIndex = columnIndex(sheet.headers, ["category", "类别", "分类"]);

  let approved = 0;
  let pending = 0;
  let deleted = 0;
  let oldNewTargetDiffs = 0;
  let blankConfirmLaterChanges = 0;
  let rowsWithNewTarget = 0;
  let rowsWithOldAndNewSource = 0;
  const uniqueSources = new Set<string>();
  const statusCounts = new Map<string, number>();
  const typeCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();

  const addCount = (map: Map<string, number>, value: string, fallback: string) => {
    const key = value.trim() || fallback;
    map.set(key, (map.get(key) ?? 0) + 1);
  };

  for (const row of sheet.rows) {
    const status = rowValue(row, statusIndex).toLocaleLowerCase();
    const changeType = rowValue(row, typeIndex).toLocaleLowerCase();
    const category = rowValue(row, categoryIndex);
    const oldSource = rowValue(row, oldSourceIndex);
    const newSource = rowValue(row, newSourceIndex);
    const oldTarget = rowValue(row, oldTargetIndex);
    const newTarget = rowValue(row, newTargetIndex);

    if (status.includes("approved") || status.includes("已监修")) approved += 1;
    if (["pending", "讨论", "未确认", "待确认", "reject", "rejected", "否决"].some((token) => status.includes(token))) pending += 1;
    if (["delete", "deleted", "废弃", "删除"].some((token) => changeType.includes(token))) deleted += 1;
    if (isUsefulCell(newTarget)) rowsWithNewTarget += 1;
    if (isUsefulCell(oldSource) && isUsefulCell(newSource)) rowsWithOldAndNewSource += 1;
    if (isUsefulCell(oldTarget) && isUsefulCell(newTarget) && normalized(oldTarget) !== normalized(newTarget)) oldNewTargetDiffs += 1;
    if (!status && includesAny(changeType, ["change", "变更"]) && isUsefulCell(newTarget)) blankConfirmLaterChanges += 1;
    addCount(statusCounts, rowValue(row, statusIndex), "blank status");
    addCount(typeCounts, rowValue(row, typeIndex), "blank type");
    addCount(categoryCounts, category, "blank category");
    const source = isUsefulCell(newSource) ? newSource : oldSource;
    if (isUsefulCell(source)) uniqueSources.add(normalized(source));
  }

  const topCounts = (label: string, counts: Map<string, number>) => Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([name, count]) => ({ label: `${label}: ${name}`, value: count }));

  const diagnostics = [
    { label: "approved rows", value: approved },
    { label: "pending/rejected rows", value: pending },
    { label: "deleted rows", value: deleted },
    { label: "old/new target diffs", value: oldNewTargetDiffs },
    { label: "blank-confirm later changes", value: blankConfirmLaterChanges },
    { label: "rows with new target", value: rowsWithNewTarget },
    { label: "rows with old+new source", value: rowsWithOldAndNewSource },
    { label: "normalized source keys", value: uniqueSources.size },
    ...topCounts("status", statusCounts),
    ...topCounts("type", typeCounts),
    ...topCounts("category", categoryCounts),
  ];
  const warnings = [
    "Term history resolver required before authoritative import; old/new rows are indexed as reference only.",
  ];
  if (oldNewTargetDiffs > 0) {
    warnings.push("Old/New Target differs in this sheet; old targets must be treated as deprecated or conflict evidence, not preferred terms.");
  }
  if (blankConfirmLaterChanges > 0) {
    warnings.push("Blank Final Confirm rows with later changes require TERM_CHANGE_UNCONFIRMED_LATER_ROW handling before preference decisions.");
  }
  if (deleted > 0 || pending > 0) {
    warnings.push("Pending/deleted/rejected rows are present and must not become preferred terms.");
  }
  return { diagnostics, warnings };
}

function termRowsForSheet(sheet: WorkbookRows, action: WorkbookAssetAction): PlannedTermRow[] {
  if (action === "import_terms") return archivedTermRows(sheet);
  return [];
}

function mappedTermRows(sheet: WorkbookRows, mapping: AssetConfirmedMapping): PlannedTermRow[] {
  const sourceIndex = mapping.sourceColumn ? sheet.headers.indexOf(mapping.sourceColumn) : -1;
  const targetIndex = mapping.targetColumn ? sheet.headers.indexOf(mapping.targetColumn) : -1;
  const noteIndex = mapping.noteColumn ? sheet.headers.indexOf(mapping.noteColumn) : -1;
  if (sourceIndex < 0 || targetIndex < 0) return [];
  return sheet.rows
    .map((row, index) => ({
      source: rowValue(row, sourceIndex),
      target: rowValue(row, targetIndex),
      note: rowValue(row, noteIndex),
      sheetName: sheet.sheetName,
      rowNo: index + 2,
      origin: "table" as const,
    }))
    .filter((row) => isUsefulCell(row.source) && isUsefulCell(row.target));
}

function termRowsForSheetWithMapping(sheet: WorkbookRows, action: WorkbookAssetAction, mapping?: AssetConfirmedMapping): PlannedTermRow[] {
  if (mapping && action === "import_terms") return mappedTermRows(sheet, mapping);
  return termRowsForSheet(sheet, action);
}

function termDedupeKey(row: Pick<PlannedTermRow, "source" | "target">): string {
  return `${normalized(row.source)}\u0000${normalized(row.target)}`;
}

function sheetReferenceBlockCount(sheet: WorkbookRows, action: WorkbookAssetAction, importedTerms: number): number {
  if (action === "index_reference" || action === "needs_mapping" || action === "resolve_term_history" || action === "import_term_delta" || importedTerms === 0) {
    return Math.ceil(sheet.rows.length / REFERENCE_BLOCK_ROWS);
  }
  return 0;
}

export async function planWorkbookAssetImport(
  workspaceRoot: string,
  options: {
    projectId: string;
    assetPath: string;
    sampleRows?: number;
    sheetOverrides?: WorkbookAssetSheetOverride[];
    parseMode?: AssetParseMode;
    mappingProfileId?: string;
    confirmedMappings?: AssetConfirmedMapping[];
  },
): Promise<WorkbookAssetPlan> {
  const resolvedPath = await resolveProjectPath(workspaceRoot, options.projectId, options.assetPath);
  const sheets = await readWorkbookRows(resolvedPath);
  const typedIndex = await parseWorkbookTypedAsset(workspaceRoot, {
    projectId: options.projectId,
    assetPath: options.assetPath,
    sheetOverrides: options.sheetOverrides,
  });
  const typedBySheet = new Map(typedIndex.sheets.map((sheet) => [sheet.sheetName, sheet]));
  const allTermRows: PlannedTermRow[] = [];
  const overrides = new Map((options.sheetOverrides ?? []).map((override) => [override.sheetName, override]));
  const confirmedMappings = new Map((options.confirmedMappings ?? []).map((mapping) => [mapping.sheetName, mapping]));
  const sheetPlans = sheets.map((sheet) => {
    const override = overrides.get(sheet.sheetName);
    const confirmedMapping = confirmedMappings.get(sheet.sheetName);
    const inferred = classifySheet(sheet.sheetName);
    const classification = confirmedMapping
      ? {
          role: confirmedMapping.role,
          action: confirmedMapping.action,
          reason: confirmedMapping.reason || "User-confirmed asset column mapping profile.",
        }
      : override
      ? {
          role: override.role,
          action: override.action ?? actionForRole(override.role),
          reason: override.reason ?? `User-confirmed workbook sheet role override from ${inferred.role}/${inferred.action}.`,
        }
      : inferred;
    const terms = termRowsForSheetWithMapping(sheet, classification.action, confirmedMapping);
    allTermRows.push(...terms);
    const referenceBlocks = sheetReferenceBlockCount(sheet, classification.action, terms.length);
    const termHistory = classification.action === "resolve_term_history" || classification.action === "import_term_delta"
      ? termChangeDiagnostics(sheet)
      : { diagnostics: [], warnings: [] };
    const typedSheet = typedBySheet.get(sheet.sheetName);
    const warnings = [
      ...(confirmedMapping && terms.length === 0 ? ["Confirmed mapping did not produce importable source/target rows; verify columns before import."] : []),
      ...(classification.action === "needs_mapping" ? ["Explicit source/target mapping required before authoritative import."] : []),
      ...termHistory.warnings,
    ];
    return {
      sheetName: sheet.sheetName,
      ...classification,
      rowCount: sheet.rows.length,
      headers: sheet.headers,
      sampleRows: sheet.rows.slice(0, options.sampleRows ?? 3),
      importableTerms: terms.length,
      referenceBlocks,
      diagnostics: termHistory.diagnostics,
      warnings,
      parserKind: typedSheet?.parserKind,
      parserStatus: typedSheet?.parserStatus,
      typedRowCount: typedSheet?.typedRowCount,
      candidateCount: typedSheet?.candidateCount,
      blockCount: typedSheet?.blockCount,
      trace: typedSheet?.trace,
    };
  });
  const dedupe = new Set(allTermRows.map(termDedupeKey));
  const warnings = sheetPlans.flatMap((sheet) => sheet.warnings.map((warning) => `${sheet.sheetName}: ${warning}`));
  return {
    projectId: options.projectId,
    assetPath: options.assetPath,
    resolvedPath,
    parseMode: options.parseMode,
    mappingProfileId: options.mappingProfileId,
    sheets: sheetPlans,
    summary: {
      sheets: sheetPlans.length,
      importableTermRows: allTermRows.length,
      dedupeTermPairs: dedupe.size,
      referenceBlocks: sheetPlans.reduce((sum, sheet) => sum + sheet.referenceBlocks, 0),
      needsMapping: sheetPlans.filter((sheet) => sheet.action === "needs_mapping").length,
      needsResolution: sheetPlans.filter((sheet) => sheet.action === "resolve_term_history" || sheet.action === "import_term_delta").length,
      typedRows: typedIndex.summary.typedRows,
      candidateRows: typedIndex.summary.candidateRows,
      typedBlocks: typedIndex.summary.blocks,
    },
    warnings,
    typedIndex,
  };
}

export async function importWorkbookAssetPlan(
  workspaceRoot: string,
  options: {
    projectId: string;
    assetPath: string;
    append?: boolean;
    srcLang?: string;
    tgtLang?: string;
    sheetOverrides?: WorkbookAssetSheetOverride[];
    parseMode?: AssetParseMode;
    mappingProfileId?: string;
    confirmedMappings?: AssetConfirmedMapping[];
    confirmedTypedCandidateIds?: string[];
  },
): Promise<WorkbookAssetImportResult> {
  const resolvedPath = await resolveProjectPath(workspaceRoot, options.projectId, options.assetPath);
  const locales = await readProjectLocalePair(workspaceRoot, options.projectId, {
    sourceLanguage: options.srcLang,
    targetLanguage: options.tgtLang,
  });
  const sheets = await readWorkbookRows(resolvedPath);
  const plan = await planWorkbookAssetImport(workspaceRoot, options);
  const confirmedMappings = new Map((options.confirmedMappings ?? []).map((mapping) => [mapping.sheetName, mapping]));
  const termbaseFile = termbasePath(workspaceRoot, options.projectId);
  const blocksFile = assetBlocksPath(workspaceRoot, options.projectId);
  const historyFile = termHistoryPath(workspaceRoot, options.projectId);
  const append = options.append !== false;
  const existing = append ? await readJsonFile<TermbaseEntry[]>(termbaseFile, []) : [];
  const seen = new Set(existing.map((entry) => termDedupeKey(entry)));
  const entries: TermbaseEntry[] = [];
  const termHistoryRows: TermHistoryRecord[] = [];
  let skippedDuplicateTerms = 0;
  let writtenReferenceBlocks = 0;
  for (const sheet of sheets) {
    const sheetPlan = plan.sheets.find((candidate) => candidate.sheetName === sheet.sheetName);
    if (!sheetPlan) continue;
    const confirmedMapping = confirmedMappings.get(sheet.sheetName);
    for (const row of termRowsForSheetWithMapping(sheet, sheetPlan.action, confirmedMapping)) {
      if ((sheetPlan.action === "import_terms" || sheetPlan.action === "needs_mapping") && !confirmedMapping) continue;
      const key = termDedupeKey(row);
      if (seen.has(key)) {
        skippedDuplicateTerms += 1;
        continue;
      }
      seen.add(key);
      entries.push({
        id: `tb-${existing.length + entries.length + 1}`,
        source: row.source,
        target: row.target,
        srcLang: locales.sourceLanguage,
        tgtLang: locales.targetLanguage,
        note: row.note,
        sourceFile: resolvedPath,
        sheetName: row.sheetName,
        rowNo: row.rowNo,
        origin: row.origin,
      });
    }
    if ((sheetPlan.action === "resolve_term_history" || sheetPlan.action === "import_term_delta") && confirmedMapping) {
      termHistoryRows.push(...termHistoryRowsFromSheet(resolvedPath, sheet));
    }
  }
  const typedIndex = await writeAssetTypedIndex(workspaceRoot, options.projectId, plan.typedIndex ?? await parseWorkbookTypedAsset(workspaceRoot, {
    projectId: options.projectId,
    assetPath: options.assetPath,
    sheetOverrides: options.sheetOverrides,
  }), { append });
  writtenReferenceBlocks = await writeTypedBlocks(workspaceRoot, options.projectId, typedIndex, { append });
  const termHistory = termHistoryRows.length
    ? await writeTermHistoryRows(workspaceRoot, options.projectId, termHistoryRows, { append })
    : { importedRows: 0, decisions: [] as TermHistoryDecision[] };
  await writeJsonFile(termbaseFile, [...existing, ...entries]);
  const confirmedTyped = options.confirmedTypedCandidateIds?.length
    ? await confirmTypedAssetCandidates(workspaceRoot, {
        projectId: options.projectId,
        candidateIds: options.confirmedTypedCandidateIds,
        append: true,
        srcLang: locales.sourceLanguage,
        tgtLang: locales.targetLanguage,
      })
    : { confirmedTermRows: 0, confirmedTermHistoryRows: 0 };
  return {
    ...plan,
    termbasePath: termbaseFile,
    assetBlocksPath: blocksFile,
    termHistoryPath: historyFile,
    importedTerms: entries.length + confirmedTyped.confirmedTermRows,
    importedTermHistoryRows: termHistory.importedRows + confirmedTyped.confirmedTermHistoryRows,
    skippedDuplicateTerms,
    writtenReferenceBlocks,
    typedIndexPath: assetTypedIndexPath(workspaceRoot, options.projectId),
    typedRowsWritten: typedIndex.summary.typedRows,
    candidateRowsWritten: typedIndex.summary.candidateRows,
    sampleTerms: entries.slice(0, 5),
    termHistoryDecisions: termHistory.decisions,
  };
}
