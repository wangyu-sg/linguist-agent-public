import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { extname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { readProjectManifest } from "./project_manifest.js";

export interface WorkbookSheetPreview {
  sheetName: string;
  headers: string[];
  sampleRows: string[][];
  rowCount: number;
  engine?: "openpyxl_read_only" | "raw_xlsx_xml" | "delimited";
  suggested: {
    sourceColumn?: string;
    targetColumn?: string;
    noteColumn?: string;
  };
  confidence: number;
  reason: string;
}

export interface WorkbookSheetCoverage {
  totalSheets: number;
  scannedSheets: number;
  visibleSheets: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  nextOffset?: number;
}

export interface WorkbookPreview {
  projectId: string;
  assetPath: string;
  resolvedPath: string;
  engine?: "openpyxl_read_only" | "raw_xlsx_xml" | "delimited";
  sheets: WorkbookSheetPreview[];
  sheetCoverage: WorkbookSheetCoverage;
}

export interface WorkbookMappingCandidate {
  sheetName: string;
  sourceColumn: string;
  targetColumn: string;
  noteColumn?: string;
  rowCount: number;
  confidence: number;
  score: number;
  reason: string;
  sampleRows: string[][];
}

export interface WorkbookMappingCandidates {
  projectId: string;
  assetPath: string;
  resolvedPath: string;
  purpose: "termbase" | "tm" | "glossary";
  engine?: WorkbookPreview["engine"];
  inspectedSheets: number;
  sheetCoverage: WorkbookSheetCoverage;
  candidates: WorkbookMappingCandidate[];
}

export interface WorkbookRows {
  sheetName: string;
  headers: string[];
  rows: string[][];
}

export interface WorkbookCellStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontColor?: string;
  fillColor?: string;
  horizontalAlign?: string;
  verticalAlign?: string;
  wrapText?: boolean;
  numberFormat?: string;
  border?: string;
}

export interface WorkbookPreviewCell {
  value: string;
  displayValue: string;
  style?: WorkbookCellStyle;
  mergedRef?: string;
  coveredBy?: string;
}

export interface WorkbookPreviewRow {
  rowNo: number;
  cells: WorkbookPreviewCell[];
}

export interface WorkbookPreviewSheetInfo {
  sheetName: string;
  rowCount: number;
  columnCount: number;
  headers: string[];
  mergedRanges: string[];
  columnWidths: number[];
  rowHeights: Record<string, number>;
}

export interface WorkbookNativePreview {
  projectId: string;
  assetPath: string;
  resolvedPath: string;
  engine?: WorkbookPreview["engine"];
  sheets: WorkbookPreviewSheetInfo[];
}

export interface WorkbookSheetPage {
  projectId: string;
  assetPath: string;
  resolvedPath: string;
  engine?: WorkbookPreview["engine"];
  sheetName: string;
  headers: string[];
  rows: WorkbookPreviewRow[];
  offset: number;
  limit: number;
  rowCount: number;
  columnCount: number;
  hasMore: boolean;
  mergedRanges: string[];
  columnWidths: number[];
  rowHeights: Record<string, number>;
}

const SOURCE_ALIASES = ["source", "src", "zh", "chinese", "中文", "源", "原文", "term_zh"];
const TARGET_ALIASES = ["target", "tgt", "translation", "english", "en", "英文", "译", "译文", "term_en"];
const NOTE_ALIASES = ["definition", "note", "comment", "description", "context", "备注", "注释", "释义"];
const execFileAsync = promisify(execFile);

const WORKBOOK_PYTHON_CANDIDATES = [
  process.env.LA_WORKBOOK_PYTHON,
  process.env.CODEX_PYTHON,
  join(homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "bin", "python3"),
].filter((candidate): candidate is string => Boolean(candidate));

function workbookPython(): string {
  return WORKBOOK_PYTHON_CANDIDATES.find((candidate) => existsSync(candidate)) ?? "python3";
}

async function resolveProjectPath(workspaceRoot: string, projectId: string, assetPath: string): Promise<string> {
  if (isAbsolute(assetPath)) return assetPath;
  const manifest = await readProjectManifest(workspaceRoot, projectId);
  return resolve(manifest.root, assetPath);
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && ch === delimiter) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

function parseMarkdownTable(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || !trimmed.includes("|", 1)) continue;
    const cells = trimmed
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());
    if (cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")))) continue;
    rows.push(cells);
  }
  return rows;
}

function decodeText(buffer: Buffer): string {
  const utf8 = buffer.toString("utf8");
  if (!utf8.includes("\uFFFD")) return utf8.replace(/^\uFEFF/, "");
  return buffer.toString("utf16le").replace(/^\uFEFF/, "");
}

function rowsFromDelimited(text: string, ext: string): string[][] {
  if (ext === ".md" || ext === ".markdown") {
    const table = parseMarkdownTable(text);
    if (table.length) return table;
  }
  const sample = text
    .split(/\r?\n/)
    .slice(0, 8)
    .join("\n");
  const delimiter = ext === ".tsv" || (sample.includes("\t") && sample.split("\t").length >= sample.split(",").length) ? "\t" : ",";
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => splitDelimitedLine(line, delimiter));
}

const OPENPYXL_STREAM_SCRIPT = String.raw`
import json
import sys
from openpyxl import load_workbook
from openpyxl.utils import get_column_letter

HEADER_HINTS = [
    "source", "src", "target", "tgt", "translation", "english", "chinese",
    "term", "terms", "note", "comment", "description", "question", "answer",
    "原文", "源", "目标", "译文", "中文", "英文", "术语", "备注", "问题", "回复",
]

def cell_to_text(value):
    if value is None:
        return ""
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    return str(value).strip()

def color_to_hex(color):
    if color is None:
        return None
    try:
        if color.type == "rgb" and color.rgb:
            raw = str(color.rgb)
            if len(raw) == 8:
                return "#" + raw[2:]
            if len(raw) == 6:
                return "#" + raw
        if color.type == "indexed" and color.indexed is not None:
            return f"indexed:{color.indexed}"
        if color.type == "theme" and color.theme is not None:
            return f"theme:{color.theme}"
    except Exception:
        return None
    return None

def cell_style(cell):
    style = {}
    font = cell.font
    fill = cell.fill
    alignment = cell.alignment
    border = cell.border
    if font is not None:
        if font.bold:
            style["bold"] = True
        if font.italic:
            style["italic"] = True
        if font.underline:
            style["underline"] = True
        color = color_to_hex(font.color)
        if color:
            style["fontColor"] = color
    if fill is not None and fill.fill_type:
        color = color_to_hex(fill.fgColor)
        if color:
            style["fillColor"] = color
    if alignment is not None:
        if alignment.horizontal:
            style["horizontalAlign"] = alignment.horizontal
        if alignment.vertical:
            style["verticalAlign"] = alignment.vertical
        if alignment.wrap_text:
            style["wrapText"] = True
    if cell.number_format and cell.number_format != "General":
        style["numberFormat"] = cell.number_format
    if border is not None and any(side is not None and side.style for side in [border.left, border.right, border.top, border.bottom]):
        style["border"] = "present"
    return style

def merged_map(ws):
    mapping = {}
    ranges = []
    try:
        merged_ranges = list(ws.merged_cells.ranges)
    except Exception:
        merged_ranges = []
    for merged in merged_ranges:
        ref = str(merged)
        ranges.append(ref)
        anchor = f"{merged.min_row}:{merged.min_col}"
        for row in range(merged.min_row, merged.max_row + 1):
            for col in range(merged.min_col, merged.max_col + 1):
                mapping[f"{row}:{col}"] = {"ref": ref, "anchor": anchor}
    return mapping, ranges

def sheet_info(ws):
    _merge_lookup, ranges = merged_map(ws)
    max_row = ws.max_row or 0
    max_col = ws.max_column or 0
    headers = []
    if max_row > 0 and max_col > 0:
        for cell in next(ws.iter_rows(min_row=1, max_row=1, values_only=True), []):
            headers.append(cell_to_text(cell))
    headers = headers + [""] * max(0, max_col - len(headers))
    widths = []
    for index in range(1, max_col + 1):
        letter = get_column_letter(index)
        widths.append(ws.column_dimensions[letter].width or 10)
    heights = {}
    for row_no, dimension in ws.row_dimensions.items():
        if dimension.height is not None:
            heights[str(row_no)] = dimension.height
    return {
        "sheetName": ws.title,
        "rowCount": max_row,
        "columnCount": max_col,
        "headers": headers,
        "mergedRanges": ranges,
        "columnWidths": widths,
        "rowHeights": heights,
    }

def styled_row(ws, row_no, width, merge_lookup):
    cells = []
    for col_no in range(1, width + 1):
        cell = ws.cell(row=row_no, column=col_no)
        text = cell_to_text(cell.value)
        item = {"value": text, "displayValue": text}
        style = cell_style(cell)
        if style:
            item["style"] = style
        merged = merge_lookup.get(f"{row_no}:{col_no}")
        if merged:
            if merged["anchor"] == f"{row_no}:{col_no}":
                item["mergedRef"] = merged["ref"]
            else:
                item["coveredBy"] = merged["ref"]
        cells.append(item)
    return {"rowNo": row_no, "cells": cells}

def row_to_cells(row):
    return [cell_to_text(value) for value in row]

def header_score(row):
    score = 0
    non_empty = [cell.strip() for cell in row if cell and cell.strip()]
    for cell in non_empty:
        lower = cell.lower()
        if any(hint in lower for hint in HEADER_HINTS):
            score += 4
        if 0 < len(cell) <= 48:
            score += 1
    if len(non_empty) >= 2:
        score += len(non_empty)
    return score

def split_header_rows(rows):
    if not rows:
        return [], []
    scan = rows[:12]
    best_index = 0
    best_score = header_score(scan[0])
    for index, row in enumerate(scan[1:], start=1):
        score = header_score(row)
        if score > best_score:
            best_index = index
            best_score = score
    if best_score < 4:
        best_index = 0
    return rows[best_index], rows[best_index + 1:]

path = sys.argv[1]
mode = sys.argv[2]
options = json.loads(sys.argv[3])
wb = load_workbook(filename=path, read_only=mode not in ("native_preview", "sheet_page"), data_only=True)

if mode == "preview":
    max_sheets = int(options.get("maxSheets") or 8)
    sheet_offset = max(0, int(options.get("sheetOffset") or 0))
    sample_limit = int(options.get("sampleRows") or 5)
    sheets = []
    selected = wb.worksheets[sheet_offset:sheet_offset + max_sheets]
    for ws in selected:
        all_rows = []
        for row in ws.iter_rows(values_only=True):
            cells = row_to_cells(row)
            if any(cell.strip() for cell in cells):
                all_rows.append(cells)
        if not all_rows:
            continue
        headers, data_rows = split_header_rows(all_rows)
        width = max(len(headers), *(len(row) for row in data_rows)) if data_rows else len(headers)
        sample_rows = data_rows[:sample_limit]
        row_count = len(data_rows)
        headers = headers + [""] * max(0, width - len(headers))
        sample_rows = [row + [""] * max(0, width - len(row)) for row in sample_rows]
        sheets.append({
            "sheetName": ws.title,
            "headers": headers,
            "sampleRows": sample_rows,
            "rowCount": row_count,
        })
    total_sheets = len(wb.worksheets)
    print(json.dumps({
        "sheets": sheets,
        "engine": "openpyxl_read_only",
        "sheetCoverage": {
            "totalSheets": total_sheets,
            "scannedSheets": len(selected),
            "visibleSheets": len(sheets),
            "offset": sheet_offset,
            "limit": max_sheets,
            "hasMore": sheet_offset + len(selected) < total_sheets,
            "nextOffset": sheet_offset + len(selected) if sheet_offset + len(selected) < total_sheets else None,
        },
    }, ensure_ascii=False))
elif mode == "workbook":
    sheets = []
    for ws in wb.worksheets:
        all_rows = []
        for row in ws.iter_rows(values_only=True):
            cells = row_to_cells(row)
            if any(cell.strip() for cell in cells):
                all_rows.append(cells)
        if not all_rows:
            continue
        headers, data_rows = split_header_rows(all_rows)
        width = max(len(headers), *(len(row) for row in data_rows)) if data_rows else len(headers)
        sheets.append({
            "sheetName": ws.title,
            "headers": headers + [""] * max(0, width - len(headers)),
            "rows": [row + [""] * max(0, width - len(row)) for row in data_rows],
        })
    print(json.dumps({"sheets": sheets, "engine": "openpyxl_read_only"}, ensure_ascii=False))
elif mode == "native_preview":
    print(json.dumps({"sheets": [sheet_info(ws) for ws in wb.worksheets], "engine": "openpyxl_read_only"}, ensure_ascii=False))
elif mode == "sheet_page":
    sheet_name = options.get("sheetName")
    if sheet_name and sheet_name not in wb.sheetnames:
        print(json.dumps({"error": f"Sheet not found: {sheet_name}. Available sheets: {', '.join(wb.sheetnames)}"}, ensure_ascii=False))
        sys.exit(0)
    ws = wb[sheet_name] if sheet_name else wb.worksheets[0]
    offset = max(0, int(options.get("offset") or 0))
    limit = max(1, min(500, int(options.get("limit") or 200)))
    info = sheet_info(ws)
    merge_lookup, _ranges = merged_map(ws)
    start = offset + 1
    end = min(info["rowCount"], offset + limit)
    rows = [styled_row(ws, row_no, info["columnCount"], merge_lookup) for row_no in range(start, end + 1)]
    print(json.dumps({
        **info,
        "rows": rows,
        "offset": offset,
        "limit": limit,
        "hasMore": offset + limit < info["rowCount"],
        "engine": "openpyxl_read_only",
    }, ensure_ascii=False))
elif mode == "mapped":
    sheet_name = options.get("sheetName")
    if sheet_name and sheet_name not in wb.sheetnames:
        print(json.dumps({"error": f"Sheet not found: {sheet_name}. Available sheets: {', '.join(wb.sheetnames)}"}, ensure_ascii=False))
        sys.exit(0)
    ws = wb[sheet_name] if sheet_name else wb.worksheets[0]
    all_rows = [row_to_cells(row) for row in ws.iter_rows(values_only=True)]
    all_rows = [row for row in all_rows if any(cell.strip() for cell in row)]
    headers, data_rows = split_header_rows(all_rows)
    source_column = options["sourceColumn"]
    target_column = options["targetColumn"]
    note_column = options.get("noteColumn")
    try:
        source_index = headers.index(source_column)
        target_index = headers.index(target_column)
    except ValueError:
        print(json.dumps({"error": f"Column mapping failed. source={source_column}, target={target_column}, headers={', '.join(headers)}"}, ensure_ascii=False))
        sys.exit(0)
    note_index = headers.index(note_column) if note_column in headers else -1
    rows = []
    header_offset = all_rows.index(headers) + 1 if headers in all_rows else 1
    for row_no, cells in enumerate(data_rows, start=header_offset + 1):
        source = cells[source_index].strip() if source_index < len(cells) else ""
        target = cells[target_index].strip() if target_index < len(cells) else ""
        if not source or not target:
            continue
        item = {
            "source": source,
            "target": target,
            "rowNo": row_no,
            "sheetName": ws.title,
        }
        if note_index >= 0 and note_index < len(cells) and cells[note_index].strip():
            item["note"] = cells[note_index].strip()
        rows.append(item)
    print(json.dumps({"headers": headers, "rows": rows, "engine": "openpyxl_read_only"}, ensure_ascii=False))
else:
    raise SystemExit(f"Unknown mode: {mode}")
`;

const RAW_XLSX_STREAM_SCRIPT = String.raw`
import json
import sys
import zipfile
import xml.etree.ElementTree as ET

path = sys.argv[1]
mode = sys.argv[2]
options = json.loads(sys.argv[3])

HEADER_HINTS = [
    "source", "src", "target", "tgt", "translation", "english", "chinese",
    "term", "terms", "note", "comment", "description", "question", "answer",
    "原文", "源", "目标", "译文", "中文", "英文", "术语", "备注", "问题", "回复",
]

def local(tag):
    return tag.rsplit("}", 1)[-1]

def col_index(cell_ref):
    letters = "".join(ch for ch in cell_ref if ch.isalpha()).upper()
    value = 0
    for ch in letters:
        value = value * 26 + (ord(ch) - 64)
    return max(0, value - 1)

def read_shared_strings(zipf):
    try:
        fh = zipf.open("xl/sharedStrings.xml")
    except KeyError:
        return []
    strings = []
    current = []
    for event, elem in ET.iterparse(fh, events=("start", "end")):
        name = local(elem.tag)
        if event == "start" and name == "si":
            current = []
        elif event == "end" and name == "t":
            current.append(elem.text or "")
        elif event == "end" and name == "si":
            strings.append("".join(current))
            elem.clear()
    return strings

def workbook_sheets(zipf):
    rels = {}
    rel_root = ET.fromstring(zipf.read("xl/_rels/workbook.xml.rels"))
    for rel in rel_root:
        rid = rel.attrib.get("Id")
        target = rel.attrib.get("Target")
        if rid and target:
            rels[rid] = target if target.startswith("xl/") else "xl/" + target.lstrip("/")
    root = ET.fromstring(zipf.read("xl/workbook.xml"))
    sheets = []
    for elem in root.iter():
        if local(elem.tag) != "sheet":
            continue
        name = elem.attrib.get("name") or f"Sheet{len(sheets) + 1}"
        rid = elem.attrib.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
        target = rels.get(rid or "")
        if target:
            sheets.append((name, target))
    return sheets

def cell_value(cell, shared):
    cell_type = cell.attrib.get("t")
    if cell_type == "inlineStr":
        return "".join((node.text or "") for node in cell.iter() if local(node.tag) == "t").strip()
    raw = ""
    for node in cell:
        if local(node.tag) == "v":
            raw = node.text or ""
            break
    if cell_type == "s":
        try:
            return shared[int(raw)].strip()
        except Exception:
            return raw.strip()
    return raw.strip()

def iter_rows(zipf, sheet_path, shared):
    with zipf.open(sheet_path) as fh:
        for event, elem in ET.iterparse(fh, events=("end",)):
            if local(elem.tag) != "row":
                continue
            row_no = int(elem.attrib.get("r") or "0")
            cells = []
            for cell in elem:
                if local(cell.tag) != "c":
                    continue
                index = col_index(cell.attrib.get("r", ""))
                while len(cells) <= index:
                    cells.append("")
                cells[index] = cell_value(cell, shared)
            while cells and not cells[-1]:
                cells.pop()
            elem.clear()
            yield row_no, cells

def header_score(row):
    score = 0
    non_empty = [cell.strip() for cell in row if cell and cell.strip()]
    for cell in non_empty:
        lower = cell.lower()
        if any(hint in lower for hint in HEADER_HINTS):
            score += 4
        if 0 < len(cell) <= 48:
            score += 1
    if len(non_empty) >= 2:
        score += len(non_empty)
    return score

def split_header_rows(rows):
    if not rows:
        return [], []
    scan = rows[:12]
    best_index = 0
    best_score = header_score(scan[0][1])
    for index, (_, row) in enumerate(scan[1:], start=1):
        score = header_score(row)
        if score > best_score:
            best_index = index
            best_score = score
    if best_score < 4:
        best_index = 0
    return rows[best_index], rows[best_index + 1:]

def pick_sheet(sheets, sheet_name):
    if sheet_name:
        for sheet in sheets:
            if sheet[0] == sheet_name:
                return sheet
        print(json.dumps({"error": f"Sheet not found: {sheet_name}. Available sheets: {', '.join(name for name, _ in sheets)}"}, ensure_ascii=False))
        sys.exit(0)
    return sheets[0] if sheets else ("Sheet1", "")

def plain_cell(value):
    return {"value": value, "displayValue": value}

try:
    with zipfile.ZipFile(path) as zipf:
        shared = read_shared_strings(zipf)
        sheets = workbook_sheets(zipf)
        if mode == "preview":
            max_sheets = int(options.get("maxSheets") or 8)
            sheet_offset = max(0, int(options.get("sheetOffset") or 0))
            sample_limit = int(options.get("sampleRows") or 5)
            out = []
            selected = sheets[sheet_offset:sheet_offset + max_sheets]
            for sheet_name, sheet_path in selected:
                all_rows = [(row_no, cells) for row_no, cells in iter_rows(zipf, sheet_path, shared) if any(cell.strip() for cell in cells)]
                if not all_rows:
                    continue
                (_, headers), data_rows = split_header_rows(all_rows)
                width = max(len(headers), *(len(cells) for _, cells in data_rows)) if data_rows else len(headers)
                samples = [cells for _, cells in data_rows[:sample_limit]]
                count = len(data_rows)
                headers = headers + [""] * max(0, width - len(headers))
                samples = [row + [""] * max(0, width - len(row)) for row in samples]
                out.append({"sheetName": sheet_name, "headers": headers, "sampleRows": samples, "rowCount": count})
            total_sheets = len(sheets)
            print(json.dumps({
                "sheets": out,
                "engine": "raw_xlsx_xml",
                "sheetCoverage": {
                    "totalSheets": total_sheets,
                    "scannedSheets": len(selected),
                    "visibleSheets": len(out),
                    "offset": sheet_offset,
                    "limit": max_sheets,
                    "hasMore": sheet_offset + len(selected) < total_sheets,
                    "nextOffset": sheet_offset + len(selected) if sheet_offset + len(selected) < total_sheets else None,
                },
            }, ensure_ascii=False))
        elif mode == "workbook":
            out = []
            for sheet_name, sheet_path in sheets:
                all_rows = [(row_no, cells) for row_no, cells in iter_rows(zipf, sheet_path, shared) if any(cell.strip() for cell in cells)]
                if not all_rows:
                    continue
                (_, headers), data_rows = split_header_rows(all_rows)
                width = max(len(headers), *(len(cells) for _, cells in data_rows)) if data_rows else len(headers)
                out.append({
                    "sheetName": sheet_name,
                    "headers": headers + [""] * max(0, width - len(headers)),
                    "rows": [cells + [""] * max(0, width - len(cells)) for _, cells in data_rows],
                })
            print(json.dumps({"sheets": out, "engine": "raw_xlsx_xml"}, ensure_ascii=False))
        elif mode == "native_preview":
            out = []
            for sheet_name, sheet_path in sheets:
                rows = [(row_no, cells) for row_no, cells in iter_rows(zipf, sheet_path, shared)]
                width = max((len(cells) for _, cells in rows), default=0)
                headers = (rows[0][1] if rows else []) + [""] * max(0, width - (len(rows[0][1]) if rows else 0))
                out.append({
                    "sheetName": sheet_name,
                    "rowCount": max((row_no for row_no, _ in rows), default=0),
                    "columnCount": width,
                    "headers": headers,
                    "mergedRanges": [],
                    "columnWidths": [10] * width,
                    "rowHeights": {},
                })
            print(json.dumps({"sheets": out, "engine": "raw_xlsx_xml"}, ensure_ascii=False))
        elif mode == "sheet_page":
            sheet_name, sheet_path = pick_sheet(sheets, options.get("sheetName"))
            offset = max(0, int(options.get("offset") or 0))
            limit = max(1, min(500, int(options.get("limit") or 200)))
            all_rows = [(row_no, cells) for row_no, cells in iter_rows(zipf, sheet_path, shared)]
            width = max((len(cells) for _, cells in all_rows), default=0)
            headers = (all_rows[0][1] if all_rows else []) + [""] * max(0, width - (len(all_rows[0][1]) if all_rows else 0))
            row_count = max((row_no for row_no, _ in all_rows), default=0)
            page = []
            for row_no, cells in all_rows:
                if row_no < offset + 1 or row_no > offset + limit:
                    continue
                padded = cells + [""] * max(0, width - len(cells))
                page.append({"rowNo": row_no, "cells": [plain_cell(value) for value in padded]})
            print(json.dumps({
                "sheetName": sheet_name,
                "headers": headers,
                "rows": page,
                "offset": offset,
                "limit": limit,
                "rowCount": row_count,
                "columnCount": width,
                "hasMore": offset + limit < row_count,
                "mergedRanges": [],
                "columnWidths": [10] * width,
                "rowHeights": {},
                "engine": "raw_xlsx_xml",
            }, ensure_ascii=False))
        elif mode == "mapped":
            sheet_name, sheet_path = pick_sheet(sheets, options.get("sheetName"))
            all_rows = [(row_no, cells) for row_no, cells in iter_rows(zipf, sheet_path, shared) if any(cell.strip() for cell in cells)]
            (header_row_no, headers), data_rows = split_header_rows(all_rows) if all_rows else ((1, []), [])
            source_column = options["sourceColumn"]
            target_column = options["targetColumn"]
            note_column = options.get("noteColumn")
            try:
                source_index = headers.index(source_column)
                target_index = headers.index(target_column)
            except ValueError:
                print(json.dumps({"error": f"Column mapping failed. source={source_column}, target={target_column}, headers={', '.join(headers)}"}, ensure_ascii=False))
                sys.exit(0)
            note_index = headers.index(note_column) if note_column in headers else -1
            mapped = []
            for row_no, cells in data_rows:
                source = cells[source_index].strip() if source_index < len(cells) else ""
                target = cells[target_index].strip() if target_index < len(cells) else ""
                if not source or not target:
                    continue
                item = {"source": source, "target": target, "rowNo": row_no, "sheetName": sheet_name}
                if note_index >= 0 and note_index < len(cells) and cells[note_index].strip():
                    item["note"] = cells[note_index].strip()
                mapped.append(item)
            print(json.dumps({"headers": headers, "rows": mapped, "engine": "raw_xlsx_xml"}, ensure_ascii=False))
        else:
            print(json.dumps({"error": f"Unknown mode: {mode}"}, ensure_ascii=False))
except Exception as exc:
    print(json.dumps({"error": str(exc)}, ensure_ascii=False))
`;

async function runOpenpyxl(path: string, mode: "preview" | "mapped" | "workbook" | "native_preview" | "sheet_page", options: Record<string, unknown>): Promise<any> {
  try {
    const { stdout } = await execFileAsync(workbookPython(), ["-c", OPENPYXL_STREAM_SCRIPT, path, mode, JSON.stringify(options)], {
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
      timeout: 120_000,
    });
    return JSON.parse(stdout);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("python3 not found. XLSX streaming preview/import requires python3 with openpyxl installed.");
    }
    return runRawXlsx(path, mode, options);
  }
}

async function runRawXlsx(path: string, mode: "preview" | "mapped" | "workbook" | "native_preview" | "sheet_page", options: Record<string, unknown>): Promise<any> {
  try {
    const { stdout } = await execFileAsync(workbookPython(), ["-c", RAW_XLSX_STREAM_SCRIPT, path, mode, JSON.stringify(options)], {
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
      timeout: 120_000,
    });
    const payload = JSON.parse(stdout);
    if (payload.error) throw new Error(payload.error);
    return payload;
  } catch (error) {
    const stderr = (error as { stderr?: string | Buffer }).stderr;
    const message = stderr ? String(stderr).trim() : error instanceof Error ? error.message : String(error);
    throw new Error(`XLSX streaming read failed for ${path}: ${message}. Install openpyxl or provide CSV/TSV export.`);
  }
}

async function previewXlsxWorkbook(
  path: string,
  options: { maxSheets?: number; sampleRows?: number; sheetOffset?: number },
): Promise<{
  engine: NonNullable<WorkbookPreview["engine"]>;
  sheets: Array<Pick<WorkbookSheetPreview, "sheetName" | "headers" | "sampleRows" | "rowCount">>;
  sheetCoverage: WorkbookSheetCoverage;
}> {
  const payload = await runOpenpyxl(path, "preview", {
    maxSheets: options.maxSheets ?? 8,
    sampleRows: options.sampleRows ?? 5,
    sheetOffset: options.sheetOffset ?? 0,
  });
  return {
    engine: payload.engine ?? "openpyxl_read_only",
    sheets: payload.sheets ?? [],
    sheetCoverage: payload.sheetCoverage ?? {
      totalSheets: payload.sheets?.length ?? 0,
      scannedSheets: payload.sheets?.length ?? 0,
      visibleSheets: payload.sheets?.length ?? 0,
      offset: options.sheetOffset ?? 0,
      limit: options.maxSheets ?? 8,
      hasMore: false,
    },
  };
}

async function extractMappedXlsxRows(
  path: string,
  options: {
    sheetName?: string;
    sourceColumn: string;
    targetColumn: string;
    noteColumn?: string;
  },
): Promise<Array<{ source: string; target: string; note?: string; rowNo: number; sheetName: string }>> {
  const payload = await runOpenpyxl(path, "mapped", options);
  if (payload.error) throw new Error(payload.error);
  return payload.rows ?? [];
}

function suggestMapping(headers: string[]): WorkbookSheetPreview["suggested"] & { confidence: number; reason: string } {
  const lower = headers.map((header) => header.trim().toLocaleLowerCase());
  const aliasMatches = (header: string, alias: string) => {
    const normalized = alias.toLocaleLowerCase();
    if (/[\u3400-\u9fff]/u.test(normalized)) return header.includes(normalized);
    if (normalized.length <= 2) {
      return new RegExp(`(^|[^a-z0-9])${normalized}([^a-z0-9]|$)`, "i").test(header);
    }
    return header.includes(normalized);
  };
  const find = (aliases: string[]) => {
    const index = lower.findIndex((header) => aliases.some((alias) => aliasMatches(header, alias)));
    return index >= 0 ? headers[index] : undefined;
  };
  const sourceColumn = find(SOURCE_ALIASES) ?? headers[0];
  const targetColumn = find(TARGET_ALIASES) ?? headers[1];
  const noteColumn = find(NOTE_ALIASES);
  const confidence = sourceColumn && targetColumn ? (lower.some((h) => TARGET_ALIASES.some((a) => h.includes(a))) ? 0.9 : 0.55) : 0.2;
  return {
    sourceColumn,
    targetColumn,
    noteColumn,
    confidence,
    reason:
      confidence >= 0.8
        ? "Matched common source/target column aliases."
        : "Low-confidence fallback to the first two columns; confirm mapping before importing.",
  };
}

function normalizedHeader(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function includesAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle.toLocaleLowerCase()));
}

function columnPurposeScore(header: string, purpose: "source" | "target" | "note"): number {
  const h = normalizedHeader(header);
  if (!h) return 0;
  const noisy = ["date", "update", "owner", "image", "status", "filename", "file name", "category", "type", "key", "no.", "模块", "分类", "图片", "状态", "日期", "更新人", "文件名"];
  if (purpose !== "note" && includesAny(h, noisy)) return -20;
  if (purpose === "note") {
    let score = 0;
    if (includesAny(h, ["note", "notes", "comment", "description", "context", "question", "answer", "备注", "注释", "描述", "释义", "问题", "回复"])) score += 70;
    if (includesAny(h, ["english", "target", "source", "term", "中文", "英文", "原文", "译文", "术语"])) score -= 10;
    return score;
  }

  let score = 0;
  const termish = ["term", "terms", "术语"];
  if (includesAny(h, termish)) score += 25;
  if (purpose === "source") {
    if (includesAny(h, ["source", "src", "cn", "zh", "chinese", "中文", "原文"])) score += 50;
    if (includesAny(h, ["old source", "old src", "改前原文"])) score += 8;
    if (includesAny(h, ["new source", "new src", "改后原文"])) score += 14;
    if (includesAny(h, ["target", "translation", "english", "en-us", "译文", "英文"])) score -= 35;
  } else {
    if (includesAny(h, ["target", "tgt", "translation", "english", "en", "英文", "译文"])) score += 50;
    if (includesAny(h, ["old target", "old tgt", "改前译文"])) score += 8;
    if (includesAny(h, ["new target", "new tgt", "改后译文"])) score += 14;
    if (includesAny(h, ["source", "src", "chinese", "zh", "中文", "原文"])) score -= 35;
  }
  if (includesAny(h, ["description", "notes", "描述", "备注"])) score -= 45;
  return score;
}

function sheetPurposeScore(sheetName: string, purpose: WorkbookMappingCandidates["purpose"]): number {
  const name = normalizedHeader(sheetName);
  let score = 0;
  if (purpose === "termbase" || purpose === "glossary") {
    if (includesAny(name, ["term", "terms", "termbase", "glossary", "术语", "词汇"])) score += 35;
    if (includesAny(name, ["archived terms", "归档术语"])) score += 45;
    if (includesAny(name, ["term change", "术语变更", "新增"])) score -= 40;
    if (includesAny(name, ["query", "答疑"])) score -= 12;
  }
  if (purpose === "tm") {
    if (includesAny(name, ["tm", "memory", "translation memory", "双语", "翻译记忆"])) score += 35;
    if (includesAny(name, ["term", "术语", "glossary"])) score -= 20;
  }
  if (includesAny(name, ["checklist", "reference", "issue", "项目要求", "参考", "问题", "审校"])) score -= 30;
  return score;
}

function isTermChangeLikeSheet(sheet: WorkbookSheetPreview): boolean {
  const name = normalizedHeader(sheet.sheetName);
  if (includesAny(name, ["term change", "术语变更"])) return true;
  const headerText = sheet.headers.map(normalizedHeader).join(" | ");
  const oldNewSignals = [
    "old source",
    "new source",
    "old target",
    "new target",
    "改前原文",
    "改后原文",
    "改前译文",
    "改后译文",
    "final confirm",
    "最终确认",
  ].filter((token) => includesAny(headerText, [token])).length;
  return oldNewSignals >= 4;
}

function rowPairQuality(sampleRows: string[][], sourceIndex: number, targetIndex: number): number {
  let inspected = 0;
  let usable = 0;
  for (const row of sampleRows.slice(0, 12)) {
    const source = (row[sourceIndex] ?? "").trim();
    const target = (row[targetIndex] ?? "").trim();
    if (!source && !target) continue;
    inspected += 1;
    if (!source || !target) continue;
    if (source === "N/A" || target === "N/A") continue;
    const sourceLooksCjk = /[\u3400-\u9fff]/u.test(source);
    const targetLooksLatin = /[A-Za-z]/.test(target);
    if (sourceLooksCjk && targetLooksLatin) usable += 1;
  }
  if (!inspected) return 0;
  return Math.min(20, Math.round((usable / inspected) * 20));
}

function bestNoteColumn(headers: string[], sourceIndex: number, targetIndex: number): string | undefined {
  let best: { header: string; score: number } | undefined;
  headers.forEach((header, index) => {
    if (index === sourceIndex || index === targetIndex) return;
    const score = columnPurposeScore(header, "note");
    if (!best || score > best.score) best = { header, score };
  });
  return best && best.score >= 40 ? best.header : undefined;
}

function oldNewClass(header: string): "old" | "new" | undefined {
  const h = normalizedHeader(header);
  if (includesAny(h, ["old source", "old target", "old src", "old tgt", "改前原文", "改前译文"])) return "old";
  if (includesAny(h, ["new source", "new target", "new src", "new tgt", "改后原文", "改后译文"])) return "new";
  return undefined;
}

function pairCompatibilityScore(sourceHeader: string, targetHeader: string): number {
  const sourceClass = oldNewClass(sourceHeader);
  const targetClass = oldNewClass(targetHeader);
  if (!sourceClass && !targetClass) return 0;
  if (sourceClass && targetClass && sourceClass === targetClass) return 14;
  if (sourceClass && targetClass && sourceClass !== targetClass) return -24;
  return -6;
}

function candidateReason(sheetName: string, sourceColumn: string, targetColumn: string, score: number, sampleQuality: number): string {
  const parts = [`sheet="${sheetName}"`, `source="${sourceColumn}"`, `target="${targetColumn}"`];
  if (sampleQuality > 0) parts.push(`sample_quality=${sampleQuality}`);
  parts.push(score >= 95 ? "high confidence termbase-style mapping" : score >= 75 ? "medium confidence mapping; confirm before import" : "low confidence; ask user before import");
  return parts.join("; ");
}

function generateSheetCandidates(
  sheet: WorkbookSheetPreview,
  purpose: WorkbookMappingCandidates["purpose"],
): WorkbookMappingCandidate[] {
  if ((purpose === "termbase" || purpose === "glossary") && isTermChangeLikeSheet(sheet)) {
    return [];
  }
  const sheetScore = sheetPurposeScore(sheet.sheetName, purpose);
  const sourceScores = sheet.headers.map((header, index) => ({ index, header, score: columnPurposeScore(header, "source") }));
  const targetScores = sheet.headers.map((header, index) => ({ index, header, score: columnPurposeScore(header, "target") }));
  const candidates: WorkbookMappingCandidate[] = [];
  for (const source of sourceScores) {
    if (source.score < 20) continue;
    for (const target of targetScores) {
      if (target.index === source.index || target.score < 20) continue;
      const sampleQuality = rowPairQuality(sheet.sampleRows, source.index, target.index);
      const rowScore = sheet.rowCount >= 1000 ? 12 : sheet.rowCount >= 100 ? 8 : sheet.rowCount >= 10 ? 4 : 0;
      const pairScore = pairCompatibilityScore(source.header, target.header);
      const score = Math.max(0, sheetScore + source.score + target.score + sampleQuality + rowScore + pairScore);
      if (score < 55) continue;
      candidates.push({
        sheetName: sheet.sheetName,
        sourceColumn: source.header,
        targetColumn: target.header,
        noteColumn: bestNoteColumn(sheet.headers, source.index, target.index),
        rowCount: sheet.rowCount,
        confidence: Math.min(0.99, Math.max(0.25, score / 140)),
        score,
        reason: candidateReason(sheet.sheetName, source.header, target.header, score, sampleQuality),
        sampleRows: sheet.sampleRows.slice(0, 3),
      });
    }
  }

  const deduped = new Map<string, WorkbookMappingCandidate>();
  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    const key = `${candidate.sourceColumn}\u0000${candidate.targetColumn}`;
    if (!deduped.has(key)) deduped.set(key, candidate);
  }
  return Array.from(deduped.values()).slice(0, 4);
}

export async function readWorkbookRows(path: string): Promise<WorkbookRows[]> {
  const ext = extname(path).toLocaleLowerCase();
  if (ext === ".xlsx") {
    const payload = await runOpenpyxl(path, "workbook", {});
    return payload.sheets ?? [];
  }
  if ([".csv", ".tsv", ".txt", ".md", ".markdown"].includes(ext)) {
    const rows = rowsFromDelimited(decodeText(await readFile(path)), ext);
    if (!rows.length) return [];
    return [{ sheetName: "Sheet1", headers: rows[0] ?? [], rows: rows.slice(1) }];
  }
  throw new Error(`Unsupported workbook/table extension ${ext || "unknown"}. Supported: xlsx/csv/tsv/txt/md.`);
}

export async function readWorkbookNativePreview(
  workspaceRoot: string,
  options: { projectId: string; assetPath: string },
): Promise<WorkbookNativePreview> {
  const resolvedPath = await resolveProjectPath(workspaceRoot, options.projectId, options.assetPath);
  const ext = extname(resolvedPath).toLocaleLowerCase();
  if (ext !== ".xlsx") {
    throw new Error(`Unsupported native workbook preview extension ${ext || "unknown"}. Supported: xlsx.`);
  }
  const payload = await runOpenpyxl(resolvedPath, "native_preview", {});
  if (payload.error) throw new Error(payload.error);
  return {
    projectId: options.projectId,
    assetPath: options.assetPath,
    resolvedPath,
    engine: payload.engine ?? "openpyxl_read_only",
    sheets: payload.sheets ?? [],
  };
}

export async function readWorkbookSheetPage(
  workspaceRoot: string,
  options: { projectId: string; assetPath: string; sheetName?: string; offset?: number; limit?: number },
): Promise<WorkbookSheetPage> {
  const resolvedPath = await resolveProjectPath(workspaceRoot, options.projectId, options.assetPath);
  const ext = extname(resolvedPath).toLocaleLowerCase();
  if (ext !== ".xlsx") {
    throw new Error(`Unsupported native workbook row preview extension ${ext || "unknown"}. Supported: xlsx.`);
  }
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 200)));
  const payload = await runOpenpyxl(resolvedPath, "sheet_page", {
    sheetName: options.sheetName,
    offset,
    limit,
  });
  if (payload.error) throw new Error(payload.error);
  return {
    projectId: options.projectId,
    assetPath: options.assetPath,
    resolvedPath,
    engine: payload.engine ?? "openpyxl_read_only",
    sheetName: payload.sheetName ?? options.sheetName ?? "Sheet1",
    headers: payload.headers ?? [],
    rows: payload.rows ?? [],
    offset,
    limit,
    rowCount: payload.rowCount ?? 0,
    columnCount: payload.columnCount ?? 0,
    hasMore: Boolean(payload.hasMore),
    mergedRanges: payload.mergedRanges ?? [],
    columnWidths: payload.columnWidths ?? [],
    rowHeights: payload.rowHeights ?? {},
  };
}

export async function previewWorkbookMapping(
  workspaceRoot: string,
  options: { projectId: string; assetPath: string; maxSheets?: number; sampleRows?: number; sheetOffset?: number },
): Promise<WorkbookPreview> {
  const resolvedPath = await resolveProjectPath(workspaceRoot, options.projectId, options.assetPath);
  const ext = extname(resolvedPath).toLocaleLowerCase();
  const sampleRows = options.sampleRows ?? 5;
  if (ext === ".xlsx") {
    const preview = await previewXlsxWorkbook(resolvedPath, options);
    return {
      projectId: options.projectId,
      assetPath: options.assetPath,
      resolvedPath,
      engine: preview.engine,
      sheets: preview.sheets.map((sheet) => {
        const suggested = suggestMapping(sheet.headers);
        return {
          sheetName: sheet.sheetName,
          headers: sheet.headers,
          sampleRows: sheet.sampleRows.slice(0, sampleRows),
          rowCount: sheet.rowCount,
          engine: preview.engine,
          suggested: {
            sourceColumn: suggested.sourceColumn,
            targetColumn: suggested.targetColumn,
            noteColumn: suggested.noteColumn,
          },
          confidence: suggested.confidence,
          reason: suggested.reason,
        };
      }),
      sheetCoverage: preview.sheetCoverage,
    };
  }

  const sheets = await readWorkbookRows(resolvedPath);
  const sheetOffset = Math.max(0, Math.floor(options.sheetOffset ?? 0));
  const sheetLimit = Math.max(1, Math.floor(options.maxSheets ?? 8));
  const selectedSheets = sheets.slice(sheetOffset, sheetOffset + sheetLimit);
  return {
    projectId: options.projectId,
    assetPath: options.assetPath,
    resolvedPath,
    engine: "delimited",
    sheets: selectedSheets.map((sheet) => {
      const suggested = suggestMapping(sheet.headers);
      return {
        sheetName: sheet.sheetName,
        headers: sheet.headers,
        sampleRows: sheet.rows.slice(0, sampleRows),
        rowCount: sheet.rows.length,
        engine: "delimited",
        suggested: {
          sourceColumn: suggested.sourceColumn,
          targetColumn: suggested.targetColumn,
          noteColumn: suggested.noteColumn,
        },
        confidence: suggested.confidence,
        reason: suggested.reason,
      };
    }),
    sheetCoverage: {
      totalSheets: sheets.length,
      scannedSheets: selectedSheets.length,
      visibleSheets: selectedSheets.length,
      offset: sheetOffset,
      limit: sheetLimit,
      hasMore: sheetOffset + selectedSheets.length < sheets.length,
      nextOffset: sheetOffset + selectedSheets.length < sheets.length ? sheetOffset + selectedSheets.length : undefined,
    },
  };
}

export async function suggestWorkbookMappingCandidates(
  workspaceRoot: string,
  options: {
    projectId: string;
    assetPath: string;
    purpose?: WorkbookMappingCandidates["purpose"];
    maxSheets?: number;
    sheetOffset?: number;
    sampleRows?: number;
    limit?: number;
  },
): Promise<WorkbookMappingCandidates> {
  const purpose = options.purpose ?? "termbase";
  const preview = await previewWorkbookMapping(workspaceRoot, {
    projectId: options.projectId,
    assetPath: options.assetPath,
    maxSheets: options.maxSheets ?? 12,
    sheetOffset: options.sheetOffset ?? 0,
    sampleRows: Math.max(options.sampleRows ?? 12, 8),
  });
  const candidates = preview.sheets
    .flatMap((sheet) => generateSheetCandidates(sheet, purpose))
    .sort((a, b) => b.score - a.score || b.rowCount - a.rowCount)
    .slice(0, options.limit ?? 8);
  return {
    projectId: preview.projectId,
    assetPath: preview.assetPath,
    resolvedPath: preview.resolvedPath,
    purpose,
    engine: preview.engine,
    inspectedSheets: preview.sheets.length,
    sheetCoverage: preview.sheetCoverage,
    candidates,
  };
}

export async function extractMappedRows(
  workspaceRoot: string,
  options: {
    projectId: string;
    assetPath: string;
    sheetName?: string;
    sourceColumn: string;
    targetColumn: string;
    noteColumn?: string;
  },
): Promise<Array<{ source: string; target: string; note?: string; rowNo: number; sheetName: string }>> {
  const resolvedPath = await resolveProjectPath(workspaceRoot, options.projectId, options.assetPath);
  const ext = extname(resolvedPath).toLocaleLowerCase();
  if (ext === ".xlsx") {
    return extractMappedXlsxRows(resolvedPath, options);
  }
  const sheets = await readWorkbookRows(resolvedPath);
  const sheet = options.sheetName ? sheets.find((candidate) => candidate.sheetName === options.sheetName) : sheets[0];
  if (!sheet) throw new Error(`Sheet not found: ${options.sheetName ?? "(first sheet)"}`);
  const srcIndex = sheet.headers.indexOf(options.sourceColumn);
  const tgtIndex = sheet.headers.indexOf(options.targetColumn);
  const noteIndex = options.noteColumn ? sheet.headers.indexOf(options.noteColumn) : -1;
  if (srcIndex < 0 || tgtIndex < 0) {
    throw new Error(`Column mapping failed. source=${options.sourceColumn}, target=${options.targetColumn}, headers=${sheet.headers.join(", ")}`);
  }
  const rows: Array<{ source: string; target: string; note?: string; rowNo: number; sheetName: string }> = [];
  for (const [index, row] of sheet.rows.entries()) {
    const source = (row[srcIndex] ?? "").trim();
    const target = (row[tgtIndex] ?? "").trim();
    if (!source || !target) continue;
    rows.push({
      source,
      target,
      note: noteIndex >= 0 ? row[noteIndex] : undefined,
      rowNo: index + 2,
      sheetName: sheet.sheetName,
    });
  }
  return rows;
}
