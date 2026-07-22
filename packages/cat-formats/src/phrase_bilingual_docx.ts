import JSZip from "jszip";
import { readFile } from "node:fs/promises";

export interface PhraseDocxTargetWrite {
  id: string;
  target: string;
}

export interface PhraseDocxWriteResult {
  buffer: Buffer;
  updatedIds: string[];
  missingIds: string[];
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

function cellText(cellXml: string): string {
  return Array.from(cellXml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g))
    .map((match) => decodeXml(match[1] ?? ""))
    .join("");
}

function tableCells(rowXml: string): string[] {
  return Array.from(rowXml.matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)).map((match) => match[0]);
}

function replaceNthCell(rowXml: string, cellIndex: number, nextCell: string): string {
  let seen = 0;
  return rowXml.replace(/<w:tc\b[\s\S]*?<\/w:tc>/g, (cell) => {
    if (seen === cellIndex) {
      seen += 1;
      return nextCell;
    }
    seen += 1;
    return cell;
  });
}

function preserveSpaceAttrs(attrs: string): string {
  if (/\bxml:space\s*=/.test(attrs)) {
    return attrs.replace(/\s+xml:space\s*=\s*(["']).*?\1/i, ' xml:space="preserve"');
  }
  return `${attrs} xml:space="preserve"`;
}

function rewriteCellText(cellXml: string, value: string): string {
  const text = encodeXmlText(value);
  let wrote = false;
  let sawText = false;
  const next = cellXml.replace(/<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/g, (_full, attrs) => {
    sawText = true;
    if (!wrote) {
      wrote = true;
      return `<w:t${preserveSpaceAttrs(attrs ?? "")}>${text}</w:t>`;
    }
    return `<w:t${attrs ?? ""}></w:t>`;
  });
  if (sawText) return next;

  const close = /<\/w:tc>\s*$/i;
  const insert = `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  return close.test(cellXml) ? cellXml.replace(close, `${insert}</w:tc>`) : cellXml;
}

export function writePhraseDocxDocumentXml(
  documentXml: string,
  writes: PhraseDocxTargetWrite[],
): { documentXml: string; updatedIds: string[]; missingIds: string[] } {
  const byId = new Map(writes.map((write) => [write.id, write]));
  const updatedIds: string[] = [];

  const nextXml = documentXml.replace(/<w:tr\b[\s\S]*?<\/w:tr>/g, (row) => {
    const cells = tableCells(row);
    if (cells.length < 5) return row;

    const id = cellText(cells[0]).trim();
    const write = byId.get(id);
    if (!write) return row;

    updatedIds.push(id);
    return replaceNthCell(row, 4, rewriteCellText(cells[4], write.target));
  });

  const updated = new Set(updatedIds);
  return {
    documentXml: nextXml,
    updatedIds,
    missingIds: writes.map((write) => write.id).filter((id) => !updated.has(id)),
  };
}

export async function writePhraseBilingualDocxTargets(
  templateDocxPath: string,
  writes: PhraseDocxTargetWrite[],
): Promise<PhraseDocxWriteResult> {
  const input = await readFile(templateDocxPath);
  const zip = await JSZip.loadAsync(input);
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) throw new Error(`DOCX ${templateDocxPath} has no word/document.xml.`);

  const documentXml = await documentFile.async("string");
  const result = writePhraseDocxDocumentXml(documentXml, writes);
  zip.file("word/document.xml", result.documentXml);
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return {
    buffer,
    updatedIds: result.updatedIds,
    missingIds: result.missingIds,
  };
}
