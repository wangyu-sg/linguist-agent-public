import JSZip from "jszip";
import { access, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename, dirname, extname, join } from "node:path";

export interface ExtractedDocumentBlock {
  ordinal: number;
  blockType: "heading" | "table" | "text" | "image";
  text: string;
  page?: number;
  sheet?: string;
  slide?: number;
  bbox?: [number, number, number, number];
  parserVersion?: string;
}

const execFileAsync = promisify(execFile);
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp"]);

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function wordElementText(xml: string): string {
  const parts: string[] = [];
  const tokenPattern = /<w:(t|tab|br)\b[^>]*>([\s\S]*?)<\/w:\1>|<w:(tab|br)\b[^>]*\/>/g;
  for (const match of xml.matchAll(tokenPattern)) {
    const kind = match[1] ?? match[3];
    if (kind === "tab") {
      parts.push("\t");
    } else if (kind === "br") {
      parts.push("\n");
    } else {
      parts.push(decodeXml(match[2] ?? ""));
    }
  }
  return normalizeText(parts.join(""));
}

function drawingElementText(xml: string): string {
  return normalizeText(
    Array.from(xml.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g))
      .map((match) => decodeXml(match[1] ?? ""))
      .join(" "),
  );
}

function paragraphBlock(paragraphXml: string, ordinal: number): ExtractedDocumentBlock | undefined {
  const text = wordElementText(paragraphXml);
  if (!text) return undefined;
  const style = /<w:pStyle\b[^>]*\bw:val=(["'])(.*?)\1/i.exec(paragraphXml)?.[2] ?? "";
  const blockType = /^heading/i.test(style) || /^title$/i.test(style) ? "heading" : "text";
  return { ordinal, blockType, text };
}

function tableRowBlocks(tableXml: string, ordinalStart: number): ExtractedDocumentBlock[] {
  const blocks: ExtractedDocumentBlock[] = [];
  let ordinal = ordinalStart;
  for (const row of tableXml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)) {
    const cells = Array.from((row[0] ?? "").matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g))
      .map((cell) => wordElementText(cell[0]))
      .filter(Boolean);
    if (!cells.length) continue;
    blocks.push({ ordinal, blockType: "table", text: cells.join(" | ") });
    ordinal += 1;
  }
  return blocks;
}

export function extractDocxBlocksFromDocumentXml(documentXml: string): ExtractedDocumentBlock[] {
  const body = /<w:body\b[^>]*>([\s\S]*?)<\/w:body>/i.exec(documentXml)?.[1] ?? documentXml;
  const blocks: ExtractedDocumentBlock[] = [];
  let ordinal = 1;
  const topLevelPattern = /<w:(p|tbl)\b[\s\S]*?<\/w:\1>/g;
  for (const match of body.matchAll(topLevelPattern)) {
    const xml = match[0] ?? "";
    const kind = match[1];
    if (kind === "tbl") {
      const tableBlocks = tableRowBlocks(xml, ordinal);
      blocks.push(...tableBlocks);
      ordinal += tableBlocks.length;
      continue;
    }
    const block = paragraphBlock(xml, ordinal);
    if (!block) continue;
    blocks.push(block);
    ordinal += 1;
  }
  return blocks;
}

export async function extractDocxBlocks(path: string): Promise<ExtractedDocumentBlock[]> {
  const zip = await JSZip.loadAsync(await readFile(path));
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) throw new Error(`DOCX ${path} has no word/document.xml.`);
  return extractDocxBlocksFromDocumentXml(await documentFile.async("string"));
}

export async function readDocxText(path: string): Promise<string> {
  const blocks = await extractDocxBlocks(path);
  return blocks.map((block) => block.text).join("\n");
}

function slideNumber(path: string): number {
  return Number(/slide(\d+)\.xml$/i.exec(path)?.[1] ?? "0");
}

export function extractPptxBlocksFromSlideXml(slideXml: string, slideNo = 1, ordinalStart = 1): ExtractedDocumentBlock[] {
  const blocks: ExtractedDocumentBlock[] = [];
  let ordinal = ordinalStart;
  const withoutTables = slideXml.replace(/<a:tbl\b[\s\S]*?<\/a:tbl>/g, (tableXml) => {
    for (const row of tableXml.matchAll(/<a:tr\b[\s\S]*?<\/a:tr>/g)) {
      const cells = Array.from((row[0] ?? "").matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/g))
        .map((cell) => drawingElementText(cell[0]))
        .filter(Boolean);
      if (!cells.length) continue;
      blocks.push({ ordinal, blockType: "table", text: `Slide ${slideNo}: ${cells.join(" | ")}`, slide: slideNo, parserVersion: "la-pptx-xml-v1" });
      ordinal += 1;
    }
    return "";
  });

  for (const paragraph of withoutTables.matchAll(/<a:p\b[\s\S]*?<\/a:p>/g)) {
    const text = drawingElementText(paragraph[0] ?? "");
    if (!text) continue;
    blocks.push({ ordinal, blockType: blocks.length === 0 ? "heading" : "text", text: `Slide ${slideNo}: ${text}`, slide: slideNo, parserVersion: "la-pptx-xml-v1" });
    ordinal += 1;
  }
  return blocks;
}

export async function extractPptxBlocks(path: string): Promise<ExtractedDocumentBlock[]> {
  const zip = await JSZip.loadAsync(await readFile(path));
  const slidePaths = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => slideNumber(a) - slideNumber(b));
  const blocks: ExtractedDocumentBlock[] = [];
  let ordinal = 1;
  for (const slidePath of slidePaths) {
    const slideFile = zip.file(slidePath);
    if (!slideFile) continue;
    const slideBlocks = extractPptxBlocksFromSlideXml(await slideFile.async("string"), slideNumber(slidePath), ordinal);
    blocks.push(...slideBlocks);
    ordinal += slideBlocks.length;
  }
  if (!slidePaths.length) throw new Error(`PPTX ${path} has no ppt/slides/slide*.xml files.`);
  return blocks;
}

export async function readPptxText(path: string): Promise<string> {
  const blocks = await extractPptxBlocks(path);
  return blocks.map((block) => block.text).join("\n");
}

const XLSX_STREAM_SCRIPT = String.raw`
import json
import sys
import zipfile
import xml.etree.ElementTree as ET

def cell_to_text(value):
    if value is None:
        return ""
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    return str(value).strip()

path = sys.argv[1]
max_sheets = int(sys.argv[2])
max_rows = int(sys.argv[3])
blocks = []
ordinal = 1

def add_row(sheet_name, row_no, cells):
    global ordinal
    while cells and not cells[-1]:
        cells.pop()
    if not any(cell.strip() for cell in cells):
        return False
    blocks.append({
        "ordinal": ordinal,
        "blockType": "table",
        "text": f"Sheet {sheet_name} row {row_no}: " + " | ".join(cells),
        "sheet": sheet_name,
        "parserVersion": "la-xlsx-stream-v1",
    })
    ordinal += 1
    return True

def run_openpyxl():
    from openpyxl import load_workbook
    wb = load_workbook(filename=path, read_only=True, data_only=True)
    for ws in wb.worksheets[:max_sheets]:
        rows_seen = 0
        for row_no, row in enumerate(ws.iter_rows(values_only=True), start=1):
            if add_row(ws.title, row_no, [cell_to_text(value) for value in row]):
                rows_seen += 1
            if rows_seen >= max_rows:
                break

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
    return sheets[:max_sheets]

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

def run_zip_stream():
    with zipfile.ZipFile(path) as zipf:
        shared = read_shared_strings(zipf)
        for sheet_name, sheet_path in workbook_sheets(zipf):
            rows_seen = 0
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
                    if add_row(sheet_name, row_no, cells):
                        rows_seen += 1
                    elem.clear()
                    if rows_seen >= max_rows:
                        break

try:
    try:
        run_openpyxl()
    except Exception:
        run_zip_stream()
except Exception as exc:
    print(json.dumps({"error": str(exc)}, ensure_ascii=False))
    sys.exit(0)

print(json.dumps({"blocks": blocks}, ensure_ascii=False))
`;

export async function extractXlsxBlocks(path: string, options: { maxSheets?: number; maxRowsPerSheet?: number } = {}): Promise<ExtractedDocumentBlock[]> {
  const maxSheets = String(options.maxSheets ?? 8);
  const maxRowsPerSheet = String(options.maxRowsPerSheet ?? 200);
  try {
    const { stdout } = await execFileAsync("python3", ["-c", XLSX_STREAM_SCRIPT, path, maxSheets, maxRowsPerSheet], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 120_000,
    });
    const parsed = JSON.parse(stdout) as { blocks?: ExtractedDocumentBlock[]; error?: string };
    if (parsed.error) throw new Error(parsed.error);
    return parsed.blocks ?? [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`XLSX asset extraction failed for ${path}: ${message}`);
  }
}

export async function readXlsxText(path: string): Promise<string> {
  const blocks = await extractXlsxBlocks(path);
  return blocks.map((block) => block.text).join("\n");
}

function linesToBlocks(text: string, prefix: (pageNo: number) => string): ExtractedDocumentBlock[] {
  const blocks: ExtractedDocumentBlock[] = [];
  let ordinal = 1;
  const pages = text.split("\f");
  for (const [pageIndex, page] of pages.entries()) {
    const pageNo = pageIndex + 1;
    for (const raw of page.split(/\r?\n/)) {
      const line = normalizeText(raw);
      if (!line) continue;
      blocks.push({ ordinal, blockType: "text", text: `${prefix(pageNo)}${line}`, page: pageNo, parserVersion: "la-pdf-text-v1" });
      ordinal += 1;
    }
  }
  return blocks;
}

export async function extractPdfBlocks(path: string): Promise<ExtractedDocumentBlock[]> {
  try {
    const { stdout } = await execFileAsync("pdftotext", ["-layout", path, "-"], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      timeout: 60_000,
    });
    return linesToBlocks(stdout, (pageNo) => `Page ${pageNo}: `);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`PDF text extraction failed for ${path}: ${message}. Install poppler pdftotext or provide an OCR/text sidecar.`);
  }
}

export async function readPdfText(path: string): Promise<string> {
  const blocks = await extractPdfBlocks(path);
  return blocks.map((block) => block.text).join("\n");
}

async function firstExisting(paths: string[]): Promise<string | undefined> {
  for (const candidate of paths) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next deterministic sidecar path.
    }
  }
  return undefined;
}

export function imageOcrSidecarCandidates(path: string): string[] {
  const ext = extname(path);
  const stem = ext ? path.slice(0, -ext.length) : path;
  return [
    `${path}.ocr.txt`,
    `${path}.txt`,
    `${stem}.ocr.txt`,
    `${stem}.txt`,
    join(dirname(path), `${basename(stem)}.ocr.txt`),
    join(dirname(path), `${basename(stem)}.txt`),
  ];
}

export async function extractImageBlocks(path: string): Promise<ExtractedDocumentBlock[]> {
  const ext = extname(path).toLocaleLowerCase();
  if (!IMAGE_EXTS.has(ext)) {
    throw new Error(`Unsupported image asset extension ${ext || "unknown"}.`);
  }
  const sidecar = await firstExisting(imageOcrSidecarCandidates(path));
  if (!sidecar) {
    return [{
      ordinal: 1,
      blockType: "image",
      text: `Image asset ${basename(path)}. OCR text unavailable; add ${basename(path)}.ocr.txt or ${basename(path)}.txt to make visible text searchable.`,
      parserVersion: "la-image-sidecar-v1",
    }];
  }
  const text = await readFile(sidecar, "utf8");
  const blocks = linesToBlocks(text, () => `OCR ${basename(sidecar)}: `);
  return blocks.length
    ? blocks
    : [{
      ordinal: 1,
      blockType: "image",
      text: `Image asset ${basename(path)} has empty OCR sidecar ${basename(sidecar)}.`,
      parserVersion: "la-image-sidecar-v1",
    }];
}

export async function readImageText(path: string): Promise<string> {
  const blocks = await extractImageBlocks(path);
  return blocks.map((block) => block.text).join("\n");
}
