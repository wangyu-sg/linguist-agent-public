import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";

export type GenericXliffFormat = "xliff_1_2" | "xliff_2_0";

export interface GenericXliffSegment {
  index: number;
  id: string;
  source: string;
  target: string;
  locked: boolean;
  state?: string;
  note?: string;
  duplicateKey: string;
}

export interface GenericXliffBatch {
  format: GenericXliffFormat;
  batchId: string;
  fileName: string;
  sourceLanguage: string;
  targetLanguage: string;
  original?: string;
  segments: GenericXliffSegment[];
}

export interface GenericXliffTargetWrite {
  id: string;
  target: string;
}

export interface GenericXliffWriteResult {
  content: string;
  updatedIds: string[];
  skippedLockedIds: string[];
  missingIds: string[];
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function decodeXmlInline(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
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

function encodeXmlInline(value: string): string {
  const tagPattern = /<\/?[\w:.-]+\b[^>]*\/?>/g;
  let cursor = 0;
  let next = "";
  for (const match of value.matchAll(tagPattern)) {
    next += encodeXmlText(value.slice(cursor, match.index));
    next += match[0];
    cursor = (match.index ?? 0) + match[0].length;
  }
  next += encodeXmlText(value.slice(cursor));
  return next;
}

function encodeXmlAttr(value: string): string {
  return encodeXmlText(value).replace(/"/g, "&quot;");
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([\w:.-]+)\s*=\s*(["'])(.*?)\2/g;
  for (const match of raw.matchAll(pattern)) attrs[match[1]] = decodeXml(match[3] ?? "");
  return attrs;
}

function setAttr(attrsRaw: string, name: string, value: string): string {
  const encoded = encodeXmlAttr(value);
  const pattern = new RegExp(`(\\s${name}\\s*=\\s*)(["'])(.*?)\\2`, "i");
  if (pattern.test(attrsRaw)) return attrsRaw.replace(pattern, `$1$2${encoded}$2`);
  return `${attrsRaw} ${name}="${encoded}"`;
}

function translateNo(attrs: Record<string, string>): boolean {
  return (attrs.translate ?? "").trim().toLowerCase() === "no";
}

function findFirst(block: string, name: string): { full: string; attrsRaw: string; attrs: Record<string, string>; inner: string } | undefined {
  const pattern = new RegExp(`<((?:[\\w.-]+:)?${name})\\b([^>]*)>([\\s\\S]*?)<\\/\\1>`, "i");
  const match = pattern.exec(block);
  if (!match) return undefined;
  return { full: match[0], attrsRaw: match[2] ?? "", attrs: parseAttrs(match[2] ?? ""), inner: match[3] ?? "" };
}

function detectFormat(content: string): GenericXliffFormat {
  const version = /<((?:[\w.-]+:)?xliff)\b([^>]*)>/i.exec(content)?.[2] ?? "";
  const attrs = parseAttrs(version);
  const value = attrs.version ?? "";
  if (value.startsWith("2.")) return "xliff_2_0";
  return "xliff_1_2";
}

function parseXliff12(content: string, fileName: string): GenericXliffBatch {
  const filePattern = /<((?:[\w.-]+:)?file)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  const segments: GenericXliffSegment[] = [];
  let sourceLanguage = "";
  let targetLanguage = "";
  let original = "";
  for (const fileMatch of content.matchAll(filePattern)) {
    const fileAttrs = parseAttrs(fileMatch[2] ?? "");
    sourceLanguage ||= fileAttrs["source-language"] ?? "";
    targetLanguage ||= fileAttrs["target-language"] ?? "";
    original ||= fileAttrs.original ?? "";
    const fileLocked = translateNo(fileAttrs);
    const tuPattern = /<((?:[\w.-]+:)?trans-unit)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    for (const tuMatch of (fileMatch[3] ?? "").matchAll(tuPattern)) {
      const attrs = parseAttrs(tuMatch[2] ?? "");
      const id = attrs.id ?? "";
      if (!id) continue;
      const source = findFirst(tuMatch[3] ?? "", "source");
      const target = findFirst(tuMatch[3] ?? "", "target");
      const note = findFirst(tuMatch[3] ?? "", "note");
      segments.push({
        index: segments.length + 1,
        id,
        source: decodeXmlInline(source?.inner ?? ""),
        target: decodeXmlInline(target?.inner ?? ""),
        locked: fileLocked || translateNo(attrs),
        state: target?.attrs.state,
        note: decodeXml(note?.inner ?? "").trim(),
        duplicateKey: decodeXmlInline(source?.inner ?? "").trim(),
      });
    }
  }
  return {
    format: "xliff_1_2",
    batchId: basename(fileName, extname(fileName)),
    fileName: basename(fileName),
    sourceLanguage,
    targetLanguage,
    original,
    segments,
  };
}

function parseXliff20(content: string, fileName: string): GenericXliffBatch {
  const rootAttrs = parseAttrs(/<((?:[\w.-]+:)?xliff)\b([^>]*)>/i.exec(content)?.[2] ?? "");
  const sourceLanguage = rootAttrs.srcLang ?? "";
  const targetLanguage = rootAttrs.trgLang ?? "";
  const segments: GenericXliffSegment[] = [];
  const filePattern = /<((?:[\w.-]+:)?file)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  for (const fileMatch of content.matchAll(filePattern)) {
    const fileAttrs = parseAttrs(fileMatch[2] ?? "");
    const fileId = fileAttrs.id ?? "f1";
    const fileLocked = translateNo(fileAttrs);
    const unitPattern = /<((?:[\w.-]+:)?unit)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    for (const unitMatch of (fileMatch[3] ?? "").matchAll(unitPattern)) {
      const unitAttrs = parseAttrs(unitMatch[2] ?? "");
      const unitId = unitAttrs.id ?? "u1";
      const unitLocked = fileLocked || translateNo(unitAttrs);
      const segmentPattern = /<((?:[\w.-]+:)?segment)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
      for (const segmentMatch of (unitMatch[3] ?? "").matchAll(segmentPattern)) {
        const attrs = parseAttrs(segmentMatch[2] ?? "");
        const localId = attrs.id ?? "1";
        const source = findFirst(segmentMatch[3] ?? "", "source");
        const target = findFirst(segmentMatch[3] ?? "", "target");
        const id = `${fileId}:${unitId}:${localId}`;
        segments.push({
          index: segments.length + 1,
          id,
          source: decodeXmlInline(source?.inner ?? ""),
          target: decodeXmlInline(target?.inner ?? ""),
          locked: unitLocked || translateNo(attrs),
          state: attrs.state,
          duplicateKey: decodeXmlInline(source?.inner ?? "").trim(),
        });
      }
    }
  }
  return {
    format: "xliff_2_0",
    batchId: basename(fileName, extname(fileName)),
    fileName: basename(fileName),
    sourceLanguage,
    targetLanguage,
    segments,
  };
}

export function parseGenericXliff(content: string, options: { fileName?: string } = {}): GenericXliffBatch {
  if (!/<(?:[\w.-]+:)?xliff\b/i.test(content)) throw new Error("generic_xliff: root is not an XLIFF document.");
  const fileName = options.fileName ?? "batch.xliff";
  return detectFormat(content) === "xliff_2_0" ? parseXliff20(content, fileName) : parseXliff12(content, fileName);
}

export async function readGenericXliff(path: string): Promise<GenericXliffBatch> {
  return parseGenericXliff(await readFile(path, "utf8"), { fileName: path });
}

function writeXliff12Targets(content: string, writes: Map<string, string>): GenericXliffWriteResult {
  const updatedIds: string[] = [];
  const skippedLockedIds: string[] = [];
  const seen = new Set<string>();
  const filePattern = /<((?:[\w.-]+:)?file)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  const next = content.replace(filePattern, (_fileFull, fileTag, fileAttrsRaw, fileInner) => {
    const fileLocked = translateNo(parseAttrs(fileAttrsRaw ?? ""));
    const tuPattern = /<((?:[\w.-]+:)?trans-unit)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    const nextInner = String(fileInner).replace(tuPattern, (tuFull, _tuTag, tuAttrsRaw, tuInner) => {
      const attrs = parseAttrs(tuAttrsRaw ?? "");
      const id = attrs.id ?? "";
      if (!writes.has(id)) return tuFull;
      seen.add(id);
      if (fileLocked || translateNo(attrs)) {
        skippedLockedIds.push(id);
        return tuFull;
      }
      const targetText = encodeXmlInline(writes.get(id) ?? "");
      const target = findFirst(tuInner, "target");
      updatedIds.push(id);
      if (target) {
        const attrsRaw = setAttr(target.attrsRaw, "state", "translated");
        return String(tuFull).replace(target.full, `<target${attrsRaw}>${targetText}</target>`);
      }
      const source = findFirst(tuInner, "source");
      if (!source) return tuFull;
      return String(tuFull).replace(source.full, `${source.full}<target state="translated" xml:space="preserve">${targetText}</target>`);
    });
    return `<${fileTag}${fileAttrsRaw}>${nextInner}</${fileTag}>`;
  });
  return { content: next, updatedIds, skippedLockedIds, missingIds: Array.from(writes.keys()).filter((id) => !seen.has(id)) };
}

function writeXliff20Targets(content: string, writes: Map<string, string>): GenericXliffWriteResult {
  const updatedIds: string[] = [];
  const skippedLockedIds: string[] = [];
  const seen = new Set<string>();
  const filePattern = /<((?:[\w.-]+:)?file)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  const next = content.replace(filePattern, (_fileFull, fileTag, fileAttrsRaw, fileInner) => {
    const fileAttrs = parseAttrs(fileAttrsRaw ?? "");
    const fileId = fileAttrs.id ?? "f1";
    const fileLocked = translateNo(fileAttrs);
    const unitPattern = /<((?:[\w.-]+:)?unit)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    const nextFileInner = String(fileInner).replace(unitPattern, (_unitFull, unitTag, unitAttrsRaw, unitInner) => {
      const unitAttrs = parseAttrs(unitAttrsRaw ?? "");
      const unitId = unitAttrs.id ?? "u1";
      const unitLocked = fileLocked || translateNo(unitAttrs);
      const segmentPattern = /<((?:[\w.-]+:)?segment)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
      const nextUnitInner = String(unitInner).replace(segmentPattern, (segmentFull, segmentTag, segmentAttrsRaw, segmentInner) => {
        const attrs = parseAttrs(segmentAttrsRaw ?? "");
        const localId = attrs.id ?? "1";
        const id = `${fileId}:${unitId}:${localId}`;
        if (!writes.has(id)) return segmentFull;
        seen.add(id);
        if (unitLocked || translateNo(attrs)) {
          skippedLockedIds.push(id);
          return segmentFull;
        }
        const targetText = encodeXmlInline(writes.get(id) ?? "");
        const target = findFirst(segmentInner, "target");
        const attrsRaw = setAttr(segmentAttrsRaw ?? "", "state", "translated");
        updatedIds.push(id);
        if (target) {
          return `<${segmentTag}${attrsRaw}>${String(segmentInner).replace(target.full, `<target${target.attrsRaw}>${targetText}</target>`)}</${segmentTag}>`;
        }
        const source = findFirst(segmentInner, "source");
        if (!source) return segmentFull;
        return `<${segmentTag}${attrsRaw}>${String(segmentInner).replace(source.full, `${source.full}<target>${targetText}</target>`)}</${segmentTag}>`;
      });
      return `<${unitTag}${unitAttrsRaw}>${nextUnitInner}</${unitTag}>`;
    });
    return `<${fileTag}${fileAttrsRaw}>${nextFileInner}</${fileTag}>`;
  });
  return { content: next, updatedIds, skippedLockedIds, missingIds: Array.from(writes.keys()).filter((id) => !seen.has(id)) };
}

export function writeGenericXliffTargets(content: string, writes: GenericXliffTargetWrite[]): GenericXliffWriteResult {
  const byId = new Map(writes.map((write) => [write.id, write.target]));
  return detectFormat(content) === "xliff_2_0" ? writeXliff20Targets(content, byId) : writeXliff12Targets(content, byId);
}
