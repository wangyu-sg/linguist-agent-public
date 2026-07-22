import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  TABLE_ID_ALIASES,
  TABLE_NOTE_ALIASES,
  TABLE_SOURCE_ALIASES,
  TABLE_STATE_ALIASES,
  TABLE_TARGET_ALIASES,
  pickTableColumn,
} from "@linguist-agent/cat-formats";
import JSZip from "jszip";
import { readWorkbookRows } from "./workbook_mapping.js";

export interface XlsxWriteResult {
  buffer: Buffer;
  updatedIds: string[];
  missingIds: string[];
}

export interface TableBatchRow {
  index: number;
  id: string;
  source: string;
  target: string;
  state?: string;
  note?: string;
  duplicateKey: string;
  rowNo: number;
}

export async function readXlsxBatchRows(path: string): Promise<{ rows: TableBatchRow[]; sheetName: string }> {
  const sheets = await readWorkbookRows(path);
  const sheet = sheets[0];
  if (!sheet) throw new Error(`xlsx_paste: no readable sheets in ${path}.`);
  const idIndex = pickTableColumn(sheet.headers, TABLE_ID_ALIASES);
  const srcIndex = pickTableColumn(sheet.headers, TABLE_SOURCE_ALIASES);
  const tgtIndex = pickTableColumn(sheet.headers, TABLE_TARGET_ALIASES);
  const stateIndex = pickTableColumn(sheet.headers, TABLE_STATE_ALIASES);
  const noteIndex = pickTableColumn(sheet.headers, TABLE_NOTE_ALIASES);
  if (idIndex < 0 || srcIndex < 0 || tgtIndex < 0) {
    throw new Error(`xlsx_paste: expected SegmentID/Source/Target columns. headers=${sheet.headers.join(", ")}`);
  }
  const rows: TableBatchRow[] = [];
  for (const [index, row] of sheet.rows.entries()) {
    const id = (row[idIndex] ?? "").trim();
    if (!id) continue;
    const source = row[srcIndex] ?? "";
    rows.push({
      index: rows.length + 1,
      id,
      source,
      target: row[tgtIndex] ?? "",
      state: stateIndex >= 0 ? (row[stateIndex] ?? "").trim() || undefined : undefined,
      note: noteIndex >= 0 ? row[noteIndex] ?? "" : undefined,
      duplicateKey: source.trim(),
      rowNo: index + 2,
    });
  }
  return { rows, sheetName: sheet.sheetName };
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function encodeXmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function cellRef(column: number, row: number): string {
  let n = column;
  let col = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    col = String.fromCharCode(65 + rem) + col;
    n = Math.floor((n - 1) / 26);
  }
  return `${col}${row}`;
}

function colFromRef(ref: string): number {
  const letters = ref.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? "";
  let value = 0;
  for (const ch of letters) value = value * 26 + (ch.charCodeAt(0) - 64);
  return value;
}

function rowFromRef(ref: string): number {
  return Number(ref.match(/\d+$/)?.[0] ?? 0);
}

async function firstSheetPath(zip: JSZip): Promise<string> {
  const workbook = await zip.file("xl/workbook.xml")?.async("string");
  const rels = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");
  if (!workbook || !rels) throw new Error("xlsx_paste: invalid XLSX workbook metadata.");
  const sheetRelId = /<sheet\b[^>]*r:id="([^"]+)"/.exec(workbook)?.[1];
  if (!sheetRelId) throw new Error("xlsx_paste: workbook has no sheet.");
  // Match the Relationship element with this Id (attribute-order independent),
  // then extract its Target. Some XLSX writers emit Target before Id, which the
  // old Id-then-Target pattern could not parse ("missing relationship rId1").
  const relElement = new RegExp(`<Relationship\\b[^>]*Id="${sheetRelId}"[^>]*>`).exec(rels)?.[0];
  const target = relElement ? /Target="([^"]+)"/.exec(relElement)?.[1] : undefined;
  if (!target) throw new Error(`xlsx_paste: missing relationship ${sheetRelId}.`);
  return target.startsWith("/") ? target.replace(/^\//, "") : `xl/${target.replace(/^\.\//, "")}`;
}

async function sharedStrings(zip: JSZip): Promise<string[]> {
  const xml = await zip.file("xl/sharedStrings.xml")?.async("string");
  if (!xml) return [];
  return Array.from(xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)).map((match) => decodeXml((match[1] ?? "").replace(/<[^>]+>/g, "")));
}

function cellText(cellXml: string, strings: string[]): string {
  const type = /\bt="([^"]+)"/.exec(cellXml)?.[1];
  if (type === "inlineStr") return decodeXml(/<t[^>]*>([\s\S]*?)<\/t>/.exec(cellXml)?.[1] ?? "");
  const value = /<v[^>]*>([\s\S]*?)<\/v>/.exec(cellXml)?.[1] ?? "";
  if (type === "s") return strings[Number(value)] ?? "";
  return decodeXml(value);
}

function parseRowCells(rowXml: string, strings: string[]): Map<number, { ref: string; xml: string; text: string }> {
  const cells = new Map<number, { ref: string; xml: string; text: string }>();
  for (const match of rowXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
    const attrs = match[1] ?? "";
    const ref = /\br="([^"]+)"/.exec(attrs)?.[1];
    if (!ref) continue;
    cells.set(colFromRef(ref), { ref, xml: match[0], text: cellText(match[0], strings) });
  }
  return cells;
}

function inlineStringCell(ref: string, value: string): string {
  return `<c r="${ref}" t="inlineStr"><is><t>${encodeXmlText(value)}</t></is></c>`;
}

function replaceOrInsertCell(rowXml: string, ref: string, value: string): string {
  const cellPattern = new RegExp(`<c\\b[^>]*r="${ref}"[^>]*>[\\s\\S]*?<\\/c>`);
  const replacement = inlineStringCell(ref, value);
  if (cellPattern.test(rowXml)) return rowXml.replace(cellPattern, replacement);
  return rowXml.replace(/<\/row>$/, `${replacement}</row>`);
}

export async function writeXlsxTargets(inputPath: string, outputPath: string, writes: Array<{ id: string; target: string }>): Promise<XlsxWriteResult> {
  const zip = await JSZip.loadAsync(await readFile(inputPath));
  const sheetPath = await firstSheetPath(zip);
  const sheetFile = zip.file(sheetPath);
  if (!sheetFile) throw new Error(`xlsx_paste: missing sheet ${sheetPath}.`);
  const strings = await sharedStrings(zip);
  const sheetXml = await sheetFile.async("string");
  const byId = new Map(writes.map((write) => [write.id, write.target]));
  const headerRow = /<row\b[^>]*r="1"[^>]*>[\s\S]*?<\/row>/.exec(sheetXml)?.[0];
  if (!headerRow) throw new Error("xlsx_paste: missing header row.");
  const headerCells = parseRowCells(headerRow, strings);
  const headers = Array.from(headerCells.entries()).sort((a, b) => a[0] - b[0]).map(([, cell]) => cell.text);
  const idCol = pickTableColumn(headers, TABLE_ID_ALIASES) + 1;
  const targetCol = pickTableColumn(headers, TABLE_TARGET_ALIASES) + 1;
  if (idCol <= 0 || targetCol <= 0) throw new Error(`xlsx_paste: expected SegmentID/Target columns. headers=${headers.join(", ")}`);
  const updatedIds: string[] = [];
  const nextXml = sheetXml.replace(/<row\b[^>]*>[\s\S]*?<\/row>/g, (rowXml) => {
    const rowNo = rowFromRef(/<row\b[^>]*r="([^"]+)"/.exec(rowXml)?.[1] ?? "");
    if (rowNo <= 1) return rowXml;
    const cells = parseRowCells(rowXml, strings);
    const id = cells.get(idCol)?.text.trim() ?? "";
    if (!byId.has(id)) return rowXml;
    updatedIds.push(id);
    return replaceOrInsertCell(rowXml, cellRef(targetCol, rowNo), byId.get(id) ?? "");
  });
  zip.file(sheetPath, nextXml);
  await mkdir(dirname(outputPath), { recursive: true });
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  await writeFile(outputPath, buffer);
  return { buffer, updatedIds, missingIds: Array.from(byId.keys()).filter((id) => !updatedIds.includes(id)) };
}
