import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { createWorkspace, workspacePath, writeJsonFile } from "./workspace.js";
import { readProjectManifest } from "./project_manifest.js";
import { readWorkbookRows, type WorkbookRows } from "./workbook_mapping.js";
import { readTermbaseEntries, termbasePath, type TermbaseEntry, writeTermbaseEntries } from "./termbase.js";
import { termHistoryPath, termHistoryRowsFromSheet, writeTermHistoryRows, type TermHistoryRecord } from "./term_history.js";
import { assetBlocksPath, type AssetBlock } from "./asset_blocks.js";
import type { AssetAuthorityTier } from "./asset_ingestion_contract.js";
import type { WorkbookAssetAction, WorkbookAssetRole, WorkbookAssetSheetOverride } from "./workbook_asset_plan.js";

export type AssetTypedParserKind = "termbase" | "term_history" | "query" | "issue_log" | "style_guide" | "reference_index";
export type AssetTypedRowKind = "term_candidate" | "term_history_candidate" | "query" | "issue" | "style_guide" | "reference";
export type AssetTypedExtractionSource = "deterministic" | "llm";

export interface AssetTypedRow {
  id: string;
  assetPath: string;
  sheetName: string;
  rowNo: number;
  kind: AssetTypedRowKind;
  role: WorkbookAssetRole;
  action: WorkbookAssetAction;
  authorityTier: AssetAuthorityTier;
  parserKind: AssetTypedParserKind;
  extractionSource: AssetTypedExtractionSource;
  confidence: number;
  text: string;
  source?: string;
  target?: string;
  note?: string;
  status?: string;
  category?: string;
  question?: string;
  answer?: string;
  issue?: string;
  guidance?: string;
  fields: Record<string, string>;
  trace: string[];
}

export interface AssetTypedSheetPreview {
  sheetName: string;
  role: WorkbookAssetRole;
  action: WorkbookAssetAction;
  parserKind: AssetTypedParserKind;
  parserStatus: "ready" | "candidate" | "skipped";
  typedRowCount: number;
  candidateCount: number;
  blockCount: number;
  trace: string[];
}

export interface AssetTypedIndexSummary {
  typedRows: number;
  candidateRows: number;
  referenceRows: number;
  blocks: number;
}

export interface AssetTypedIndex {
  schemaVersion: 1;
  projectId: string;
  assetPath: string;
  generatedAt: string;
  sheets: AssetTypedSheetPreview[];
  rows: AssetTypedRow[];
  summary: AssetTypedIndexSummary;
  warnings: string[];
}

export type AskTypedWorkbookModel = (input: { prompt: string; evidence: AssetTypedIndex }) => Promise<string>;

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

function rowValue(row: string[], index: number): string | undefined {
  const value = index >= 0 ? row[index]?.trim() : undefined;
  return isUsefulCell(value) ? value : undefined;
}

function fieldsForRow(headers: string[], row: string[]): Record<string, string> {
  const fields: Record<string, string> = {};
  headers.forEach((header, index) => {
    const key = header.trim() || `column_${index + 1}`;
    const value = rowValue(row, index);
    if (value) fields[key] = value;
  });
  return fields;
}

function authorityTierForAction(action: WorkbookAssetAction): AssetAuthorityTier {
  if (action === "import_terms") return "termbase";
  if (action === "resolve_term_history" || action === "import_term_delta") return "term_history";
  if (action === "index_reference") return "reference";
  return "proposal_only";
}

function parserKindForRole(role: WorkbookAssetRole): AssetTypedParserKind {
  if (role === "termbase" || role === "candidate_terms" || role === "glossary") return "termbase";
  if (role === "termbase_delta") return "term_history";
  if (role === "qa_reference") return "query";
  if (role === "issue_log") return "issue_log";
  if (role === "style_guide" || role === "project_requirements" || role === "checklist") return "style_guide";
  return "reference_index";
}

export function classifyWorkbookAssetSheet(sheetName: string): Pick<AssetTypedSheetPreview, "role" | "action" | "parserKind"> & { reason: string } {
  const name = normalized(sheetName);
  let role: WorkbookAssetRole = "reference";
  let action: WorkbookAssetAction = "index_reference";
  let reason = "no deterministic source/target import rule; keep as reference";
  if (includesAny(name, ["archived terms", "core term", "term base", "termbase", "归档术语", "术语表", "核心术语"])) {
    role = "termbase"; action = "import_terms"; reason = "canonical archived CN/EN termbase sheet";
  } else if (includesAny(name, ["term change", "术语变更"])) {
    role = "termbase_delta"; action = "resolve_term_history"; reason = "term change log requires explicit candidate confirmation";
  } else if (includesAny(name, ["checklist", "check list", "检查清单", "核对清单"])) {
    role = "checklist"; reason = "workflow checklist, indexed as reference evidence";
  } else if (includesAny(name, ["issue log", "issue", "问题", "审校", "校对"])) {
    role = "issue_log"; reason = "issue/review log, indexed as QA reference evidence";
  } else if (includesAny(name, ["query", "答疑"])) {
    role = "qa_reference"; reason = "query/Q&A reference";
  } else if (includesAny(name, ["style guide", "en-sg", "sg", "风格指南", "高频句式", "通修", "句式", "术语提取总结", "注意事项"])) {
    role = "style_guide"; reason = "style/language guidance sheet";
  } else if (includesAny(name, ["项目要求", "要求说明", "project requirement", "requirements"])) {
    role = "project_requirements"; reason = "project requirement sheet";
  } else if (includesAny(name, ["glossary", "词汇表", "term", "术语"])) {
    role = "candidate_terms"; action = "needs_mapping"; reason = "term-like sheet requires explicit mapping confirmation";
  }
  return { role, action, parserKind: parserKindForRole(role), reason };
}

function rowId(assetPath: string, sheetName: string, rowNo: number, kind: AssetTypedRowKind): string {
  return `${assetPath}:xlsx:${sheetName}:${rowNo}:${kind}`;
}

function rowText(fields: Record<string, string>, preferred: Array<string | undefined>): string {
  const selected = preferred.filter((value): value is string => isUsefulCell(value));
  return (selected.length ? selected : Object.values(fields)).join(" · ").slice(0, 4000);
}

function termRows(assetPath: string, sheet: WorkbookRows, role: WorkbookAssetRole, action: WorkbookAssetAction): AssetTypedRow[] {
  const sourceIndex = columnIndex(sheet.headers, ["terms - cn", "术语 - 中文", "中文", "source", "原文"]);
  const targetIndex = columnIndex(sheet.headers, ["terms - en", "术语 - 英文", "英文", "target", "译文"]);
  const noteIndex = columnIndex(sheet.headers, ["description&notes", "description", "描述与备注", "note", "备注"]);
  if (sourceIndex < 0 || targetIndex < 0) return [];
  return sheet.rows.map((row, index): AssetTypedRow | undefined => {
    const source = rowValue(row, sourceIndex);
    const target = rowValue(row, targetIndex);
    if (!source || !target) return undefined;
    const rowNo = index + 2;
    const note = rowValue(row, noteIndex);
    const fields = fieldsForRow(sheet.headers, row);
    return {
      id: rowId(assetPath, sheet.sheetName, rowNo, "term_candidate"),
      assetPath,
      sheetName: sheet.sheetName,
      rowNo,
      kind: "term_candidate",
      role,
      action,
      authorityTier: "proposal_only",
      parserKind: "termbase",
      extractionSource: "deterministic",
      confidence: 0.92,
      source,
      target,
      note,
      text: rowText(fields, [source, target, note]),
      fields,
      trace: ["deterministic term candidate; requires confirmation before termbase write"],
    };
  }).filter((row): row is AssetTypedRow => Boolean(row));
}

function termHistoryCandidateRows(assetPath: string, sheet: WorkbookRows, role: WorkbookAssetRole, action: WorkbookAssetAction): AssetTypedRow[] {
  return termHistoryRowsFromSheet(assetPath, sheet).map((record) => {
    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries(record)) {
      if (typeof value === "string" && value.trim()) fields[key] = value;
      if (typeof value === "number") fields[key] = String(value);
    }
    return {
      id: rowId(assetPath, sheet.sheetName, record.rowNo, "term_history_candidate"),
      assetPath,
      sheetName: sheet.sheetName,
      rowNo: record.rowNo,
      kind: "term_history_candidate",
      role,
      action,
      authorityTier: "proposal_only",
      parserKind: "term_history",
      extractionSource: "deterministic",
      confidence: 0.9,
      source: record.newSource ?? record.oldSource,
      target: record.newTarget ?? record.oldTarget,
      note: record.updateNotes,
      status: record.finalConfirm,
      category: record.category,
      text: rowText(fields, [record.newSource ?? record.oldSource, record.newTarget ?? record.oldTarget, record.updateNotes, record.finalConfirm]),
      fields,
      trace: ["deterministic term-history candidate; requires confirmation before term_history write"],
    };
  });
}

function referenceRows(assetPath: string, sheet: WorkbookRows, role: WorkbookAssetRole, action: WorkbookAssetAction, parserKind: AssetTypedParserKind): AssetTypedRow[] {
  const questionIndex = columnIndex(sheet.headers, ["question", "问题"]);
  const answerIndex = columnIndex(sheet.headers, ["answer", "回复", "答复"]);
  const sourceIndex = columnIndex(sheet.headers, ["source text", "source", "原文"]);
  const targetIndex = columnIndex(sheet.headers, ["reviewed version", "suggested translation", "target", "译文", "建议译文"]);
  const commentIndex = columnIndex(sheet.headers, ["comment", "comments", "备注", "instructions", "说明"]);
  const statusIndex = columnIndex(sheet.headers, ["status", "状态", "approval"]);
  const categoryIndex = columnIndex(sheet.headers, ["category", "分类", "类别"]);
  const kind: AssetTypedRowKind = parserKind === "query" ? "query" : parserKind === "issue_log" ? "issue" : parserKind === "style_guide" ? "style_guide" : "reference";
  return sheet.rows.map((row, index): AssetTypedRow | undefined => {
    const fields = fieldsForRow(sheet.headers, row);
    if (!Object.keys(fields).length) return undefined;
    const rowNo = index + 2;
    const question = rowValue(row, questionIndex);
    const answer = rowValue(row, answerIndex);
    const source = rowValue(row, sourceIndex);
    const target = rowValue(row, targetIndex);
    const note = rowValue(row, commentIndex);
    const status = rowValue(row, statusIndex);
    const category = rowValue(row, categoryIndex);
    return {
      id: rowId(assetPath, sheet.sheetName, rowNo, kind),
      assetPath,
      sheetName: sheet.sheetName,
      rowNo,
      kind,
      role,
      action,
      authorityTier: role === "style_guide" ? "style_guide" : authorityTierForAction(action),
      parserKind,
      extractionSource: "deterministic",
      confidence: 0.82,
      source,
      target,
      note,
      status,
      category,
      question,
      answer,
      issue: kind === "issue" ? note ?? rowText(fields, []) : undefined,
      guidance: kind === "style_guide" ? note ?? rowText(fields, []) : undefined,
      text: rowText(fields, [question, answer, source, target, note, status, category]),
      fields,
      trace: [`deterministic ${parserKind} row`],
    };
  }).filter((row): row is AssetTypedRow => Boolean(row));
}

function rowsForSheet(assetPath: string, sheet: WorkbookRows, role: WorkbookAssetRole, action: WorkbookAssetAction, parserKind: AssetTypedParserKind): AssetTypedRow[] {
  if (parserKind === "termbase") return termRows(assetPath, sheet, role, action);
  if (parserKind === "term_history") return termHistoryCandidateRows(assetPath, sheet, role, action);
  return referenceRows(assetPath, sheet, role, action, parserKind);
}

function blockCountForRows(rows: AssetTypedRow[]): number {
  return Math.ceil(rows.length / 40);
}

function refreshSheetMetrics(sheets: AssetTypedSheetPreview[], rows: AssetTypedRow[]): AssetTypedSheetPreview[] {
  return sheets.map((sheet) => {
    const sheetRows = rows.filter((row) => row.sheetName === sheet.sheetName);
    const candidateCount = sheetRows.filter((row) => row.kind === "term_candidate" || row.kind === "term_history_candidate").length;
    const referenceRows = sheetRows.filter((row) => row.kind !== "term_candidate" && row.kind !== "term_history_candidate");
    return {
      ...sheet,
      parserStatus: sheetRows.length ? (candidateCount ? "candidate" : "ready") : "skipped",
      typedRowCount: sheetRows.length,
      candidateCount,
      blockCount: blockCountForRows(referenceRows),
    };
  });
}

function summarize(projectId: string, assetPath: string, rows: AssetTypedRow[], sheets: AssetTypedSheetPreview[], warnings: string[]): AssetTypedIndex {
  const refreshedSheets = refreshSheetMetrics(sheets, rows);
  return {
    schemaVersion: 1,
    projectId,
    assetPath,
    generatedAt: new Date().toISOString(),
    sheets: refreshedSheets,
    rows,
    summary: {
      typedRows: rows.length,
      candidateRows: rows.filter((row) => row.kind === "term_candidate" || row.kind === "term_history_candidate").length,
      referenceRows: rows.filter((row) => row.kind !== "term_candidate" && row.kind !== "term_history_candidate").length,
      blocks: refreshedSheets.reduce((sum, sheet) => sum + sheet.blockCount, 0),
    },
    warnings,
  };
}

function buildTypedPrompt(index: AssetTypedIndex): string {
  return [
    "Extract structured workbook asset rows for Linguist Agent.",
    "Return strict JSON: {\"rows\":[{\"sheetName\":\"...\",\"rowNo\":2,\"kind\":\"query|issue|style_guide|reference|term_candidate|term_history_candidate\",\"confidence\":0.8,\"fields\":{\"Header\":\"value\"},\"text\":\"...\"}]}",
    "Only use real sheet names and row numbers from the evidence. Do not invent columns or rows.",
    "Term and term-history rows are candidates only; reference/query/issue/style rows may be indexed automatically.",
    "",
    ...index.sheets.map((sheet) => {
      const sample = index.rows.filter((row) => row.sheetName === sheet.sheetName).slice(0, 6);
      return [`Sheet: ${sheet.sheetName}`, `Role: ${sheet.role}`, `Parser: ${sheet.parserKind}`, ...sample.map((row) => `Row ${row.rowNo}: ${row.text}`)].join("\n");
    }),
  ].join("\n");
}

function validateLlmRows(raw: unknown, evidence: AssetTypedIndex): AssetTypedRow[] {
  const rows = typeof raw === "object" && raw && Array.isArray((raw as { rows?: unknown[] }).rows) ? (raw as { rows: unknown[] }).rows : [];
  const evidenceBySheet = new Map<string, AssetTypedRow[]>();
  for (const row of evidence.rows) {
    const bucket = evidenceBySheet.get(row.sheetName) ?? [];
    bucket.push(row);
    evidenceBySheet.set(row.sheetName, bucket);
  }
  const validKinds = new Set<AssetTypedRowKind>(["term_candidate", "term_history_candidate", "query", "issue", "style_guide", "reference"]);
  const out: AssetTypedRow[] = [];
  for (const item of rows) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const sheetName = typeof row.sheetName === "string" ? row.sheetName : "";
    const rowNo = typeof row.rowNo === "number" ? row.rowNo : -1;
    const kind = typeof row.kind === "string" && validKinds.has(row.kind as AssetTypedRowKind) ? row.kind as AssetTypedRowKind : undefined;
    const evidenceRow = evidenceBySheet.get(sheetName)?.find((candidate) => candidate.rowNo === rowNo);
    if (!evidenceRow || !kind) continue;
    const fields = typeof row.fields === "object" && row.fields
      ? Object.fromEntries(Object.entries(row.fields as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string" && Boolean(entry[1].trim())))
      : evidenceRow.fields;
    const text = typeof row.text === "string" && row.text.trim() ? row.text.trim() : rowText(fields, []);
    if (text && !evidenceRow.text.includes(text.slice(0, Math.min(24, text.length))) && !Object.values(evidenceRow.fields).some((value) => value.includes(text.slice(0, Math.min(24, text.length))))) {
      continue;
    }
    out.push({
      ...evidenceRow,
      id: `${evidenceRow.id}:llm`,
      kind,
      fields,
      text: text || evidenceRow.text,
      extractionSource: "llm",
      confidence: typeof row.confidence === "number" ? Math.max(0, Math.min(1, row.confidence)) : 0.7,
      trace: [...evidenceRow.trace, "validated LLM structured extraction"],
    });
  }
  return out;
}

function mergeLlmRows(index: AssetTypedIndex, llmRows: AssetTypedRow[]): AssetTypedIndex {
  if (!llmRows.length) return index;
  const deterministicKeys = new Set(index.rows.map((row) => `${row.sheetName}:${row.rowNo}:${row.kind}`));
  const merged = [...index.rows];
  for (const row of llmRows) {
    const key = `${row.sheetName}:${row.rowNo}:${row.kind}`;
    if (deterministicKeys.has(key)) continue;
    merged.push(row);
  }
  return summarize(index.projectId, index.assetPath, merged, index.sheets, index.warnings);
}

export async function parseWorkbookTypedAsset(
  workspaceRoot: string,
  options: {
    projectId: string;
    assetPath: string;
    sheetOverrides?: WorkbookAssetSheetOverride[];
    askModel?: AskTypedWorkbookModel;
  },
): Promise<AssetTypedIndex> {
  const resolvedPath = await resolveProjectPath(workspaceRoot, options.projectId, options.assetPath);
  const sheets = await readWorkbookRows(resolvedPath);
  const overrides = new Map((options.sheetOverrides ?? []).map((override) => [override.sheetName, override]));
  const rows: AssetTypedRow[] = [];
  const previews: AssetTypedSheetPreview[] = [];
  const warnings: string[] = [];
  for (const sheet of sheets) {
    const inferred = classifyWorkbookAssetSheet(sheet.sheetName);
    const override = overrides.get(sheet.sheetName);
    const role = override?.role ?? inferred.role;
    const action = override?.action ?? inferred.action;
    const parserKind = parserKindForRole(role);
    const sheetRows = rowsForSheet(resolvedPath, sheet, role, action, parserKind);
    rows.push(...sheetRows);
    if ((role === "termbase" || role === "candidate_terms" || role === "glossary") && sheetRows.length === 0) {
      warnings.push(`${sheet.sheetName}: no source/target term candidates found; confirm columns before authority import.`);
    }
    const candidateCount = sheetRows.filter((row) => row.kind === "term_candidate" || row.kind === "term_history_candidate").length;
    previews.push({
      sheetName: sheet.sheetName,
      role,
      action,
      parserKind,
      parserStatus: sheetRows.length ? (candidateCount ? "candidate" : "ready") : "skipped",
      typedRowCount: sheetRows.length,
      candidateCount,
      blockCount: blockCountForRows(sheetRows.filter((row) => row.kind !== "term_candidate" && row.kind !== "term_history_candidate")),
      trace: [override ? `user override ${inferred.role}/${inferred.action} -> ${role}/${action}` : inferred.reason],
    });
  }
  const deterministic = summarize(options.projectId, resolvedPath, rows, previews, warnings);
  if (!options.askModel) return deterministic;
  const prompt = buildTypedPrompt(deterministic);
  try {
    const raw = await options.askModel({ prompt, evidence: deterministic });
    const parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
    return mergeLlmRows(deterministic, validateLlmRows(parsed, deterministic));
  } catch (error) {
    return { ...deterministic, warnings: [...deterministic.warnings, `typed LLM extraction failed: ${error instanceof Error ? error.message : String(error)}`] };
  }
}

export function assetTypedIndexPath(workspaceRoot: string, projectId: string): string {
  return workspacePath(createWorkspace(workspaceRoot, projectId), "asset_typed_index.json");
}

export async function readAssetTypedIndex(workspaceRoot: string, projectId: string): Promise<AssetTypedIndex | undefined> {
  const path = assetTypedIndexPath(workspaceRoot, projectId);
  try {
    return JSON.parse(await readFile(path, "utf8")) as AssetTypedIndex;
  } catch {
    return undefined;
  }
}

export async function writeAssetTypedIndex(workspaceRoot: string, projectId: string, index: AssetTypedIndex, options: { append?: boolean } = {}): Promise<AssetTypedIndex> {
  const path = assetTypedIndexPath(workspaceRoot, projectId);
  const existing = options.append ? await readAssetTypedIndex(workspaceRoot, projectId) : undefined;
  const rows = existing ? [...existing.rows.filter((row) => row.assetPath !== index.assetPath), ...index.rows] : index.rows;
  const sheets = existing ? [...existing.sheets.filter((sheet) => !index.sheets.some((next) => next.sheetName === sheet.sheetName)), ...index.sheets] : index.sheets;
  const merged = summarize(projectId, index.assetPath, rows, sheets, index.warnings);
  await writeJsonFile(path, merged);
  return merged;
}

export function typedBlocksFromRows(index: AssetTypedIndex): AssetBlock[] {
  const rows = index.rows.filter((row) => row.kind !== "term_candidate" && row.kind !== "term_history_candidate");
  const blocks: AssetBlock[] = [];
  for (let offset = 0; offset < rows.length; offset += 20) {
    const chunk = rows.slice(offset, offset + 20);
    blocks.push({
      blockId: `${index.assetPath}:typed:${blocks.length + 1}`,
      assetPath: index.assetPath,
      lineNo: chunk[0]?.rowNo ?? offset + 1,
      blockType: "table",
      text: chunk.map((row) => `# ${row.sheetName} row ${row.rowNo} [${row.kind}]\n${row.text}`).join("\n\n"),
      sourceEngine: "xlsx_asset",
      role: chunk[0]?.role,
      parserKind: chunk[0]?.parserKind,
      typedRowId: chunk[0]?.id,
      authorityTier: chunk[0]?.authorityTier,
    });
  }
  return blocks;
}

export interface ConfirmTypedAssetCandidatesResult {
  confirmedTermRows: number;
  confirmedTermHistoryRows: number;
  termbasePath: string;
  termHistoryPath: string;
}

export async function confirmTypedAssetCandidates(
  workspaceRoot: string,
  options: { projectId: string; candidateIds: string[]; append?: boolean; srcLang?: string; tgtLang?: string },
): Promise<ConfirmTypedAssetCandidatesResult> {
  const [index, manifest] = await Promise.all([
    readAssetTypedIndex(workspaceRoot, options.projectId),
    readProjectManifest(workspaceRoot, options.projectId).catch(() => null),
  ]);
  const srcLang = options.srcLang ?? manifest?.sourceLanguage;
  const tgtLang = options.tgtLang ?? manifest?.targetLanguage;
  if (!srcLang || !tgtLang) throw new Error("Confirming typed term candidates requires an explicit project source and target locale.");
  const selected = new Set(options.candidateIds);
  const rows = (index?.rows ?? []).filter((row) => selected.has(row.id));
  const termRows = rows.filter((row) => row.kind === "term_candidate" && row.source && row.target);
  const historyRows = rows.filter((row) => row.kind === "term_history_candidate");
  const termbaseFile = termbasePath(workspaceRoot, options.projectId);
  const existing = options.append === false ? [] : await readTermbaseEntries(workspaceRoot, options.projectId);
  const seenTerms = new Set(existing.map((entry) => `${normalized(entry.source)}\u0000${normalized(entry.target)}`));
  const confirmedTerms = termRows.filter((row) => {
    const key = `${normalized(row.source ?? "")}\u0000${normalized(row.target ?? "")}`;
    if (seenTerms.has(key)) return false;
    seenTerms.add(key);
    return true;
  });
  const nextTerms = [
    ...existing,
    ...confirmedTerms.map((row, index): TermbaseEntry => ({
      id: `tb-${existing.length + index + 1}`,
      source: row.source ?? "",
      target: row.target ?? "",
      srcLang,
      tgtLang,
      note: row.note,
      sourceFile: row.assetPath,
      sheetName: row.sheetName,
      rowNo: row.rowNo,
      origin: "table",
    })),
  ];
  if (confirmedTerms.length || options.append === false) await writeTermbaseEntries(workspaceRoot, options.projectId, nextTerms, options.append === false ? null : existing);
  const records: TermHistoryRecord[] = historyRows.map((row): TermHistoryRecord => ({
    id: row.id,
    sourceFile: row.assetPath,
    sheetName: row.sheetName,
    rowNo: row.rowNo,
    oldSource: row.fields.oldSource,
    newSource: row.fields.newSource,
    oldTarget: row.fields.oldTarget,
    newTarget: row.fields.newTarget,
    type: row.fields.type,
    finalConfirm: row.fields.finalConfirm,
    updateDate: row.fields.updateDate,
    updatedBy: row.fields.updatedBy,
    category: row.category ?? row.fields.category,
    updateNotes: row.note ?? row.fields.updateNotes,
    locComment: row.fields.locComment,
    devComment: row.fields.devComment,
  }));
  const history = records.length ? await writeTermHistoryRows(workspaceRoot, options.projectId, records, { append: options.append !== false }) : { importedRows: 0 };
  return {
    confirmedTermRows: confirmedTerms.length,
    confirmedTermHistoryRows: history.importedRows,
    termbasePath: termbaseFile,
    termHistoryPath: termHistoryPath(workspaceRoot, options.projectId),
  };
}

export async function writeTypedBlocks(workspaceRoot: string, projectId: string, index: AssetTypedIndex, options: { append?: boolean } = {}): Promise<number> {
  const blocksFile = assetBlocksPath(workspaceRoot, projectId);
  await mkdir(dirname(blocksFile), { recursive: true });
  if (!options.append) await writeFile(blocksFile, "", "utf8");
  const blocks = typedBlocksFromRows(index);
  for (const block of blocks) await appendFile(blocksFile, `${JSON.stringify(block)}\n`, "utf8");
  return blocks.length;
}
