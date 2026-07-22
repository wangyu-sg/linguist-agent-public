import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import {
  TABLE_ID_ALIASES,
  TABLE_NOTE_ALIASES,
  TABLE_SOURCE_ALIASES,
  TABLE_STATE_ALIASES,
  TABLE_TARGET_ALIASES,
  pickTableColumn,
} from "./table_columns.js";

export interface TableCsvSegment {
  index: number;
  id: string;
  source: string;
  target: string;
  state?: string;
  note?: string;
  duplicateKey: string;
  rowNo: number;
}

export interface TableCsvBatch {
  format: "csv_paste";
  batchId: string;
  fileName: string;
  sourceLanguage: string;
  targetLanguage: string;
  segments: TableCsvSegment[];
  headers: string[];
}

export interface TableCsvTargetWrite {
  id: string;
  target: string;
}

export interface TableCsvWriteResult {
  content: string;
  updatedIds: string[];
  missingIds: string[];
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const ch = line[index];
    if (ch === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && ch === ",") {
      cells.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current);
  return cells;
}

function parseCsv(text: string): string[][] {
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map(splitCsvLine);
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function parseTableCsv(content: string, options: { fileName?: string; srcLang: string; tgtLang: string }): TableCsvBatch {
  const rows = parseCsv(content);
  const headers = rows[0] ?? [];
  const idIndex = pickTableColumn(headers, TABLE_ID_ALIASES);
  const srcIndex = pickTableColumn(headers, TABLE_SOURCE_ALIASES);
  const tgtIndex = pickTableColumn(headers, TABLE_TARGET_ALIASES);
  const stateIndex = pickTableColumn(headers, TABLE_STATE_ALIASES);
  const noteIndex = pickTableColumn(headers, TABLE_NOTE_ALIASES);
  if (idIndex < 0 || srcIndex < 0 || tgtIndex < 0) {
    throw new Error(`csv_paste: expected SegmentID/Source/Target columns. headers=${headers.join(", ")}`);
  }
  const segments: TableCsvSegment[] = [];
  for (const [index, row] of rows.slice(1).entries()) {
    const id = (row[idIndex] ?? "").trim();
    if (!id) continue;
    const source = row[srcIndex] ?? "";
    const target = row[tgtIndex] ?? "";
    segments.push({
      index: segments.length + 1,
      id,
      source,
      target,
      state: stateIndex >= 0 ? (row[stateIndex] ?? "").trim() || undefined : undefined,
      note: noteIndex >= 0 ? row[noteIndex] ?? "" : undefined,
      duplicateKey: source.trim(),
      rowNo: index + 2,
    });
  }
  const fileName = options.fileName ?? "paste.csv";
  return {
    format: "csv_paste",
    batchId: basename(fileName, extname(fileName)),
    fileName: basename(fileName),
    sourceLanguage: options.srcLang,
    targetLanguage: options.tgtLang,
    segments,
    headers,
  };
}

export async function readTableCsv(path: string, options: { srcLang: string; tgtLang: string }): Promise<TableCsvBatch> {
  return parseTableCsv(await readFile(path, "utf8"), { fileName: path, ...options });
}

export function writeTableCsvTargets(content: string, writes: TableCsvTargetWrite[]): TableCsvWriteResult {
  const rows = parseCsv(content);
  const headers = rows[0] ?? [];
  const idIndex = pickTableColumn(headers, TABLE_ID_ALIASES);
  const tgtIndex = pickTableColumn(headers, TABLE_TARGET_ALIASES);
  if (idIndex < 0 || tgtIndex < 0) throw new Error(`csv_paste: expected SegmentID/Target columns. headers=${headers.join(", ")}`);
  const byId = new Map(writes.map((write) => [write.id, write.target]));
  const updatedIds: string[] = [];
  const nextRows = rows.map((row, index) => {
    if (index === 0) return row;
    const id = (row[idIndex] ?? "").trim();
    if (!byId.has(id)) return row;
    const next = [...row];
    while (next.length < headers.length) next.push("");
    next[tgtIndex] = byId.get(id) ?? "";
    updatedIds.push(id);
    return next;
  });
  return {
    content: `${nextRows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`,
    updatedIds,
    missingIds: Array.from(byId.keys()).filter((id) => !updatedIds.includes(id)),
  };
}
