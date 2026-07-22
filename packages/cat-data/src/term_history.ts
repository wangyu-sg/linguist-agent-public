import { createWorkspace, readJsonFile, workspacePath, writeJsonFile } from "./workspace.js";
import type { AuthorityTier } from "./authority_policy.js";
import type { WorkbookRows } from "./workbook_mapping.js";

export type TermHistoryDecisionStatus =
  | "current"
  | "deprecated"
  | "conflict"
  | "unconfirmed_later_row"
  | "pending"
  | "deleted";

export interface TermHistoryRecord {
  id: string;
  sourceFile: string;
  sheetName: string;
  rowNo: number;
  oldSource?: string;
  newSource?: string;
  oldTarget?: string;
  newTarget?: string;
  type?: string;
  finalConfirm?: string;
  updateDate?: string;
  updatedBy?: string;
  category?: string;
  updatedToTerms?: string;
  globalFixed?: string;
  updateNotes?: string;
  locComment?: string;
  devComment?: string;
}

export interface TermHistoryDecision {
  source: string;
  status: TermHistoryDecisionStatus;
  target?: string;
  deprecatedTargets?: string[];
  conflictTargets?: string[];
  reason: string;
  evidenceRows: Array<Pick<
    TermHistoryRecord,
    | "id"
    | "sourceFile"
    | "sheetName"
    | "rowNo"
    | "oldSource"
    | "newSource"
    | "oldTarget"
    | "newTarget"
    | "finalConfirm"
    | "type"
    | "updateDate"
    | "updatedBy"
    | "category"
    | "updatedToTerms"
    | "globalFixed"
    | "updateNotes"
    | "locComment"
    | "devComment"
  >>;
}

export interface TermHistoryIndex {
  rows: TermHistoryRecord[];
  decisions: TermHistoryDecision[];
}

export interface TermHistoryPromotionDecision {
  decisionKey?: string;
  source?: string;
  winner: {
    tier: AuthorityTier;
    source?: string;
    target?: string;
    label: string;
  };
  reason: string;
}

export interface PromotedTermHistoryEntry {
  source: string;
  target: string;
  note: string;
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

function firstColumn(headers: string[], groups: string[][]): number {
  for (const needles of groups) {
    const index = columnIndex(headers, needles);
    if (index >= 0) return index;
  }
  return -1;
}

export function termHistoryPath(workspaceRoot: string, projectId: string): string {
  return workspacePath(createWorkspace(workspaceRoot, projectId), "term_history.json");
}

export function termHistoryRowsFromSheet(sourceFile: string, sheet: WorkbookRows): TermHistoryRecord[] {
  const oldSourceIndex = firstColumn(sheet.headers, [["old source", "改前原文"], ["term - old source"]]);
  const newSourceIndex = firstColumn(sheet.headers, [["new source", "改后原文"], ["term - new source"]]);
  const oldTargetIndex = firstColumn(sheet.headers, [["old target", "改前译文"], ["term - old target"]]);
  const newTargetIndex = firstColumn(sheet.headers, [["new target", "改后译文"], ["term - new target"]]);
  const typeIndex = columnIndex(sheet.headers, ["type", "类型"]);
  const finalConfirmIndex = columnIndex(sheet.headers, ["final confirm", "最终确认"]);
  const updateDateIndex = columnIndex(sheet.headers, ["update date", "updated date", "日期", "更新时间"]);
  const updatedByIndex = columnIndex(sheet.headers, ["updated by", "update by", "更新人"]);
  const categoryIndex = columnIndex(sheet.headers, ["category", "类别", "分类"]);
  const updatedToTermsIndex = columnIndex(sheet.headers, ["updated to terms", "updatedtoterms", "更新至术语", "登记术语"]);
  const globalFixedIndex = columnIndex(sheet.headers, ["global fixed", "globalfixed", "全局修正", "全局"]);
  const updateNotesIndex = columnIndex(sheet.headers, ["update notes", "更新原因", "description&notes", "description", "note", "备注"]);
  const locCommentIndex = columnIndex(sheet.headers, ["loc comment", "localization comment", "本地化备注", "译者备注"]);
  const devCommentIndex = columnIndex(sheet.headers, ["dev comment", "developer comment", "开发备注"]);

  return sheet.rows
    .map((row, index): TermHistoryRecord => ({
      id: `${sourceFile}:xlsx:${sheet.sheetName}:${index + 2}`,
      sourceFile,
      sheetName: sheet.sheetName,
      rowNo: index + 2,
      oldSource: rowValue(row, oldSourceIndex),
      newSource: rowValue(row, newSourceIndex),
      oldTarget: rowValue(row, oldTargetIndex),
      newTarget: rowValue(row, newTargetIndex),
      type: rowValue(row, typeIndex),
      finalConfirm: rowValue(row, finalConfirmIndex),
      updateDate: rowValue(row, updateDateIndex),
      updatedBy: rowValue(row, updatedByIndex),
      category: rowValue(row, categoryIndex),
      updatedToTerms: rowValue(row, updatedToTermsIndex),
      globalFixed: rowValue(row, globalFixedIndex),
      updateNotes: rowValue(row, updateNotesIndex),
      locComment: rowValue(row, locCommentIndex),
      devComment: rowValue(row, devCommentIndex),
    }))
    .filter((row) => isUsefulCell(row.oldSource) || isUsefulCell(row.newSource) || isUsefulCell(row.oldTarget) || isUsefulCell(row.newTarget));
}

function sourceIdentity(row: TermHistoryRecord): string | undefined {
  return row.newSource ?? row.oldSource;
}

function finalTarget(row: TermHistoryRecord): string | undefined {
  return row.newTarget ?? row.oldTarget;
}

function evidenceRows(rows: TermHistoryRecord[]): TermHistoryDecision["evidenceRows"] {
  return rows.map((row) => ({
    id: row.id,
    sourceFile: row.sourceFile,
    sheetName: row.sheetName,
    rowNo: row.rowNo,
    oldSource: row.oldSource,
    newSource: row.newSource,
    oldTarget: row.oldTarget,
    newTarget: row.newTarget,
    finalConfirm: row.finalConfirm,
    type: row.type,
    updateDate: row.updateDate,
    updatedBy: row.updatedBy,
    category: row.category,
    updatedToTerms: row.updatedToTerms,
    globalFixed: row.globalFixed,
    updateNotes: row.updateNotes,
    locComment: row.locComment,
    devComment: row.devComment,
  }));
}

function isApproved(row: TermHistoryRecord): boolean {
  const status = normalized(row.finalConfirm ?? "");
  return status.includes("approved") || status.includes("已监修");
}

function isPending(row: TermHistoryRecord): boolean {
  const status = normalized(row.finalConfirm ?? "");
  return ["pending", "讨论", "未确认", "待确认", "reject", "rejected", "否决"].some((token) => status.includes(token));
}

function isDeleted(row: TermHistoryRecord): boolean {
  const type = normalized(row.type ?? "");
  return ["delete", "deleted", "废弃", "删除"].some((token) => type.includes(token));
}

function isBlankLaterChange(row: TermHistoryRecord): boolean {
  const type = normalized(row.type ?? "");
  return !row.finalConfirm && (type.includes("change") || type.includes("变更")) && isUsefulCell(row.newTarget);
}

export function resolveTermHistoryDecisions(rows: TermHistoryRecord[]): TermHistoryDecision[] {
  const groups = new Map<string, TermHistoryRecord[]>();
  for (const row of rows) {
    const source = sourceIdentity(row);
    if (!source) continue;
    const key = normalized(source);
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }
  const decisions: TermHistoryDecision[] = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => a.rowNo - b.rowNo);
    const source = sourceIdentity(sorted[sorted.length - 1] ?? sorted[0]) ?? "";
    const blankLaterRows = sorted.filter(isBlankLaterChange);
    if (blankLaterRows.length) {
      decisions.push({
        source,
        status: "unconfirmed_later_row",
        target: finalTarget(blankLaterRows[blankLaterRows.length - 1]),
        reason: "Later Change row has blank Final Confirm; do not auto-prefer older approved/archive terms.",
        evidenceRows: evidenceRows(blankLaterRows),
      });
      continue;
    }

    const deletedRows = sorted.filter(isDeleted);
    if (deletedRows.length && deletedRows.length === sorted.length) {
      decisions.push({
        source,
        status: "deleted",
        reason: "All visible history rows are deleted/discarded.",
        evidenceRows: evidenceRows(deletedRows),
      });
      continue;
    }

    const pendingRows = sorted.filter(isPending);
    if (pendingRows.length && !sorted.some(isApproved)) {
      decisions.push({
        source,
        status: "pending",
        reason: "Only pending/rejected history rows are present.",
        evidenceRows: evidenceRows(pendingRows),
      });
      continue;
    }

    const approvedRows = sorted.filter((row) => isApproved(row) && !isDeleted(row) && finalTarget(row));
    const approvedTargets = Array.from(new Map(approvedRows.map((row) => [normalized(finalTarget(row) ?? ""), finalTarget(row) ?? ""])).values()).filter(Boolean);
    if (approvedTargets.length > 1) {
      decisions.push({
        source,
        status: "conflict",
        conflictTargets: approvedTargets,
        reason: "Multiple approved Term Change Log targets exist for the same normalized source; require resolver/platform evidence.",
        evidenceRows: evidenceRows(approvedRows),
      });
      continue;
    }

    const approved = approvedRows[approvedRows.length - 1];
    if (approved) {
      const target = finalTarget(approved);
      const deprecatedTargets = Array.from(
        new Set(
          approvedRows
            .flatMap((row) => [row.oldTarget, row.newTarget])
            .filter((targetValue): targetValue is string => isUsefulCell(targetValue) && normalized(targetValue) !== normalized(target ?? "")),
        ),
      );
      decisions.push({
        source,
        status: "current",
        target,
        deprecatedTargets,
        reason: "Single approved non-deleted history target. Still requires platform/customer conflict check before becoming preferred.",
        evidenceRows: evidenceRows([approved]),
      });
      for (const deprecated of deprecatedTargets) {
        decisions.push({
          source,
          status: "deprecated",
          target: deprecated,
          reason: "Old target differs from the current approved history target.",
          evidenceRows: evidenceRows(approvedRows.filter((row) => row.oldTarget === deprecated || row.newTarget === deprecated)),
        });
      }
    }
  }
  return decisions.sort((a, b) => a.source.localeCompare(b.source) || a.status.localeCompare(b.status));
}

function sameTerm(left?: string, right?: string): boolean {
  return Boolean(left && right) && normalized(left ?? "") === normalized(right ?? "");
}

export function promoteTermHistoryEntries(
  decisions: TermHistoryDecision[],
  authorityDecisions: TermHistoryPromotionDecision[] = [],
): PromotedTermHistoryEntry[] {
  const promoted: PromotedTermHistoryEntry[] = [];
  for (const decision of decisions) {
    if (decision.status !== "current" || !decision.target) continue;
    const authority = authorityDecisions.find((candidate) => {
      if (!["phrase_final_stage", "customer_override"].includes(candidate.winner.tier)) return false;
      if (!sameTerm(candidate.winner.target, decision.target)) return false;
      return sameTerm(candidate.source, decision.source)
        || sameTerm(candidate.winner.source, decision.source)
        || candidate.decisionKey === decision.source;
    });
    if (!authority) continue;
    promoted.push({
      source: decision.source,
      target: decision.target,
      note: `Promoted from Term Change Log after ${authority.winner.tier} authority: ${authority.reason}`,
    });
  }
  return promoted;
}

export async function readTermHistoryIndex(workspaceRoot: string, projectId: string): Promise<TermHistoryIndex> {
  return readJsonFile<TermHistoryIndex>(termHistoryPath(workspaceRoot, projectId), { rows: [], decisions: [] });
}

export async function writeTermHistoryRows(
  workspaceRoot: string,
  projectId: string,
  rows: TermHistoryRecord[],
  options: { append?: boolean } = {},
): Promise<TermHistoryIndex & { path: string; importedRows: number }> {
  const existing = options.append ? await readTermHistoryIndex(workspaceRoot, projectId) : { rows: [], decisions: [] };
  const byId = new Map(existing.rows.map((row) => [row.id, row]));
  for (const row of rows) byId.set(row.id, row);
  const nextRows = Array.from(byId.values()).sort((a, b) => a.sourceFile.localeCompare(b.sourceFile) || a.sheetName.localeCompare(b.sheetName) || a.rowNo - b.rowNo);
  const index = { rows: nextRows, decisions: resolveTermHistoryDecisions(nextRows) };
  const path = termHistoryPath(workspaceRoot, projectId);
  await writeJsonFile(path, index);
  return { ...index, path, importedRows: rows.length };
}
