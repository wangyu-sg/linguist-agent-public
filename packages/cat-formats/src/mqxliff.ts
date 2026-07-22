import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename } from "node:path";

export type MqxliffStatus = string;

export interface MqxliffInlineTag {
  kind: "bpt" | "ept" | "ph";
  value: string;
  rawXml: string;
}

export interface MqxliffSegment {
  index: number;
  id: string;
  source: string;
  target: string;
  locked: boolean;
  status?: MqxliffStatus;
  note?: string;
  sourceTags: MqxliffInlineTag[];
  duplicateKey: string;
}

export interface MqxliffBatch {
  format: "mqxliff";
  batchId: string;
  fileName: string;
  sourceLanguage: string;
  targetLanguage: string;
  original?: string;
  segments: MqxliffSegment[];
}

export interface MqxliffTargetWrite {
  id: string;
  target: string;
}

export interface MqxliffWriteResult {
  content: string;
  updatedIds: string[];
  skippedLockedIds: string[];
  missingIds: string[];
}

export interface MqxliffDefectWrite {
  id: string;
  suggested?: string;
  severity: string;
  issueType: string;
  comment: string;
  disposition?: string;
}

export interface MqxliffDefectWriteResult {
  content: string;
  updatedIds: string[];
  commentedIds: string[];
  skippedLockedIds: string[];
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

function encodeXmlAttr(value: string): string {
  return encodeXmlText(value).replace(/"/g, "&quot;");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([\w:.-]+)\s*=\s*(["'])(.*?)\2/g;
  for (const match of raw.matchAll(pattern)) {
    attrs[match[1]] = decodeXml(match[3] ?? "");
  }
  return attrs;
}

function localName(name: string): string {
  return name.includes(":") ? name.split(":").pop() ?? name : name;
}

function firstFileAttrs(content: string): Record<string, string> {
  const match = /<((?:[\w.-]+:)?file)\b([^>]*)>/i.exec(content);
  return match ? parseAttrs(match[2] ?? "") : {};
}

function extractTransUnits(content: string): Array<{ full: string; attrs: Record<string, string>; attrsRaw: string; inner: string }> {
  const pattern = /<((?:[\w.-]+:)?trans-unit)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  return Array.from(content.matchAll(pattern)).map((match) => ({
    full: match[0],
    attrs: parseAttrs(match[2] ?? ""),
    attrsRaw: match[2] ?? "",
    inner: match[3] ?? "",
  }));
}

function findElement(block: string, name: string): { full: string; tagName: string; attrs: Record<string, string>; attrsRaw: string; inner: string } | undefined {
  const pattern = new RegExp(`<((?:[\\w.-]+:)?${escapeRegExp(name)})\\b([^>]*)>([\\s\\S]*?)<\\/\\1>`, "i");
  const match = pattern.exec(block);
  if (!match) return undefined;
  return {
    full: match[0],
    tagName: match[1],
    attrs: parseAttrs(match[2] ?? ""),
    attrsRaw: match[2] ?? "",
    inner: match[3] ?? "",
  };
}

function isLockedAttr(value: string | undefined): boolean {
  return ["1", "true", "yes", "locked"].includes((value ?? "").trim().toLowerCase());
}

function isLockedTransUnit(attrs: Record<string, string>): boolean {
  return isLockedAttr(attrs["mq:locked"]) || (attrs.translate ?? "").trim().toLowerCase() === "no";
}

function mqInlineValue(rawInner: string): string {
  const decoded = decodeXml(rawInner);
  const match = /\bval\s*=\s*(["'])(.*?)\1/i.exec(decoded);
  return match ? decodeXml(match[2] ?? "") : "";
}

export function unwrapMqxliffInlineXml(value: string): { text: string; tags: MqxliffInlineTag[] } {
  const tags: MqxliffInlineTag[] = [];
  const parts: string[] = [];
  const pattern = /<((?:[\w.-]+:)?(?:bpt|ept|ph))\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > cursor) parts.push(decodeXml(value.slice(cursor, start)));
    const rawXml = match[0];
    const kind = localName(match[1]) as MqxliffInlineTag["kind"];
    const tag = { kind, value: mqInlineValue(match[2] ?? ""), rawXml };
    tags.push(tag);
    parts.push(tag.value);
    cursor = start + rawXml.length;
  }
  if (cursor < value.length) parts.push(decodeXml(value.slice(cursor)));
  return { text: parts.join(""), tags };
}

function normalizeDuplicateKey(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

export function segmentStatusFromMqxliff(target: string, status: string | undefined): "new" | "draft" | "confirmed" {
  if (!target.trim()) return "new";
  if (/confirmed|proofread|reviewed/i.test(status ?? "")) return "confirmed";
  return "draft";
}

export function parseMqxliff(content: string, options: { fileName?: string } = {}): MqxliffBatch {
  if (!/<(?:[\w.-]+:)?xliff\b/i.test(content)) {
    throw new Error("mqxliff: root is not an XLIFF document.");
  }
  const fileAttrs = firstFileAttrs(content);
  const segments: MqxliffSegment[] = [];
  for (const tu of extractTransUnits(content)) {
    const id = tu.attrs.id ?? "";
    if (!id) continue;
    const source = findElement(tu.full, "source");
    if (!source) continue;
    const target = findElement(tu.full, "target");
    const sourceText = unwrapMqxliffInlineXml(source.inner);
    const targetText = unwrapMqxliffInlineXml(target?.inner ?? "");
    const note = findElement(tu.full, "note")?.inner.trim();
    segments.push({
      index: segments.length + 1,
      id,
      source: sourceText.text,
      target: targetText.text,
      locked: isLockedTransUnit(tu.attrs),
      status: tu.attrs["mq:status"],
      note: note ? decodeXml(note) : undefined,
      sourceTags: sourceText.tags,
      duplicateKey: normalizeDuplicateKey(sourceText.text),
    });
  }
  return {
    format: "mqxliff",
    batchId: basename(options.fileName ?? fileAttrs.original ?? "mqxliff-batch", ".mqxliff"),
    fileName: options.fileName ?? "",
    sourceLanguage: fileAttrs["source-language"] ?? "",
    targetLanguage: fileAttrs["target-language"] ?? "",
    original: fileAttrs.original,
    segments,
  };
}

export async function readMqxliff(path: string): Promise<MqxliffBatch> {
  return parseMqxliff(await readFile(path, "utf8"), { fileName: basename(path) });
}

export function mqxliffInlineTagSignatureFromTags(tags: MqxliffInlineTag[]): string[] {
  return tags.map((tag) => tag.value).filter(Boolean);
}

export function mqxliffInlineTagSignatureFromText(text: string, tags: MqxliffInlineTag[]): string[] {
  const values = Array.from(new Set(mqxliffInlineTagSignatureFromTags(tags))).sort((a, b) => b.length - a.length);
  const signature: string[] = [];
  let pos = 0;
  while (pos < text.length) {
    const match = values.find((value) => text.startsWith(value, pos));
    if (!match) {
      pos += 1;
      continue;
    }
    signature.push(match);
    pos += match.length;
  }
  return signature;
}

function rewrapMqxliffText(text: string, tags: MqxliffInlineTag[]): string {
  if (!tags.length || !text) return encodeXmlText(text);
  const sorted = Array.from(new Set(tags.map((tag) => tag.value).filter(Boolean))).sort((a, b) => b.length - a.length);
  const queues = new Map<string, MqxliffInlineTag[]>();
  for (const tag of tags) {
    const list = queues.get(tag.value) ?? [];
    list.push(tag);
    queues.set(tag.value, list);
  }

  let out = "";
  let pos = 0;
  while (pos < text.length) {
    const match = sorted.find((value) => text.startsWith(value, pos));
    if (!match) {
      out += encodeXmlText(text[pos]);
      pos += 1;
      continue;
    }
    const list = queues.get(match) ?? [];
    const tag = list.shift() ?? tags.find((candidate) => candidate.value === match);
    out += tag?.rawXml ?? encodeXmlText(match);
    pos += match.length;
  }
  return out;
}

function setAttr(attrsRaw: string, name: string, value: string): string {
  const pattern = new RegExp(`(\\s${escapeRegExp(name)}\\s*=\\s*)(["'])(.*?)\\2`, "i");
  if (pattern.test(attrsRaw)) {
    return attrsRaw.replace(pattern, (_match, pre, quote) => `${pre}${quote}${encodeXmlAttr(value)}${quote}`);
  }
  return `${attrsRaw} ${name}="${encodeXmlAttr(value)}"`;
}

function writeTransUnit(unit: { full: string; attrs: Record<string, string>; attrsRaw: string }, writes: Map<string, MqxliffTargetWrite>): {
  full: string;
  updatedIds: string[];
  skippedLockedIds: string[];
  seenIds: string[];
} {
  const id = unit.attrs.id ?? "";
  const write = writes.get(id);
  if (!write) return { full: unit.full, updatedIds: [], skippedLockedIds: [], seenIds: [] };
  if (isLockedTransUnit(unit.attrs)) {
    return { full: unit.full, updatedIds: [], skippedLockedIds: [id], seenIds: [id] };
  }
  const source = findElement(unit.full, "source");
  const target = findElement(unit.full, "target");
  const sourceTags = unwrapMqxliffInlineXml(source?.inner ?? "").tags;
  const existing = unwrapMqxliffInlineXml(target?.inner ?? "").text;
  if (existing === write.target) return { full: unit.full, updatedIds: [], skippedLockedIds: [], seenIds: [id] };

  const nextInner = rewrapMqxliffText(write.target, sourceTags);
  const targetOpen = target
    ? `<${target.tagName}${setAttr(target.attrsRaw, "xml:space", "preserve")}>`
    : `<target xml:space="preserve">`;
  const nextTarget = `${targetOpen}${nextInner}</${target?.tagName ?? "target"}>`;
  let full = target
    ? unit.full.replace(target.full, nextTarget)
    : source
      ? unit.full.replace(source.full, `${source.full}${nextTarget}`)
      : unit.full.replace(/(<(?:[\w.-]+:)?trans-unit\b[^>]*>)/i, `$1${nextTarget}`);
  let nextAttrs = setAttr(unit.attrsRaw, "mq:status", "ConfirmedTranslator");
  nextAttrs = setAttr(nextAttrs, "mq:lastchangedtimestamp", new Date().toISOString().replace(/\.\d{3}Z$/, "Z"));
  full = full.replace(/<((?:[\w.-]+:)?trans-unit)\b[^>]*>/i, (_match, tagName) => `<${tagName}${nextAttrs}>`);
  return { full, updatedIds: [id], skippedLockedIds: [], seenIds: [id] };
}

function mqxliffTimestamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function writeTargetElement(full: string, nextTargetText: string, status: string): string {
  const source = findElement(full, "source");
  const target = findElement(full, "target");
  const sourceTags = unwrapMqxliffInlineXml(source?.inner ?? "").tags;
  const nextInner = rewrapMqxliffText(nextTargetText, sourceTags);
  const targetOpen = target
    ? `<${target.tagName}${setAttr(target.attrsRaw, "xml:space", "preserve")}>`
    : `<target xml:space="preserve">`;
  const nextTarget = `${targetOpen}${nextInner}</${target?.tagName ?? "target"}>`;
  let next = target
    ? full.replace(target.full, nextTarget)
    : source
      ? full.replace(source.full, `${source.full}${nextTarget}`)
      : full.replace(/(<(?:[\w.-]+:)?trans-unit\b[^>]*>)/i, `$1${nextTarget}`);
  const open = /<((?:[\w.-]+:)?trans-unit)\b([^>]*)>/i.exec(next);
  if (open) {
    let nextAttrs = setAttr(open[2] ?? "", "mq:status", status);
    nextAttrs = setAttr(nextAttrs, "mq:lastchangedtimestamp", mqxliffTimestamp());
    next = next.replace(/<((?:[\w.-]+:)?trans-unit)\b[^>]*>/i, (_match, tagName) => `<${tagName}${nextAttrs}>`);
  }
  return next;
}

function appendMqxliffComment(full: string, defect: MqxliffDefectWrite): string {
  const disposition = defect.disposition || "";
  const commentText = `[${defect.severity} ${defect.issueType} / ${disposition}] ${defect.comment}${defect.suggested ? ` | suggested=${defect.suggested}` : ""}`;
  const comment = `<mq:comment id="${randomUUID()}" creatoruser="linguist-agent" time="${mqxliffTimestamp()}" deleted="false" category="0" appliesto="Row" origin="ai_review">${encodeXmlText(commentText)}</mq:comment>`;
  const comments = findElement(full, "comments");
  if (comments) {
    const nextComments = comments.full.replace(new RegExp(`</${escapeRegExp(comments.tagName)}>`, "i"), `${comment}</${comments.tagName}>`);
    return full.replace(comments.full, nextComments);
  }
  return full.replace(/<\/((?:[\w.-]+:)?trans-unit)>/i, `<mq:comments>${comment}</mq:comments></$1>`);
}

function writeDefectTransUnit(unit: { full: string; attrs: Record<string, string>; attrsRaw: string }, defects: Map<string, MqxliffDefectWrite>): {
  full: string;
  updatedIds: string[];
  commentedIds: string[];
  skippedLockedIds: string[];
  seenIds: string[];
} {
  const id = unit.attrs.id ?? "";
  const defect = defects.get(id);
  if (!defect) return { full: unit.full, updatedIds: [], commentedIds: [], skippedLockedIds: [], seenIds: [] };
  if (isLockedTransUnit(unit.attrs)) {
    return { full: unit.full, updatedIds: [], commentedIds: [], skippedLockedIds: [id], seenIds: [id] };
  }
  const shouldUpdateTarget = defect.disposition === "defect" && Boolean(defect.suggested);
  const withTarget = shouldUpdateTarget ? writeTargetElement(unit.full, defect.suggested ?? "", "Edited") : unit.full;
  const withComment = appendMqxliffComment(withTarget, defect);
  return {
    full: withComment,
    updatedIds: shouldUpdateTarget ? [id] : [],
    commentedIds: [id],
    skippedLockedIds: [],
    seenIds: [id],
  };
}

export function writeMqxliffTargets(content: string, writes: MqxliffTargetWrite[]): MqxliffWriteResult {
  const byId = new Map(writes.map((write) => [write.id, write]));
  const updatedIds: string[] = [];
  const skippedLockedIds: string[] = [];
  const seenIds: string[] = [];
  const unitPattern = /<((?:[\w.-]+:)?trans-unit)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  const next = content.replace(unitPattern, (full, _tagName, attrsRaw) => {
    const result = writeTransUnit({ full, attrs: parseAttrs(attrsRaw ?? ""), attrsRaw: attrsRaw ?? "" }, byId);
    updatedIds.push(...result.updatedIds);
    skippedLockedIds.push(...result.skippedLockedIds);
    seenIds.push(...result.seenIds);
    return result.full;
  });
  const seen = new Set(seenIds);
  const skipped = new Set(skippedLockedIds);
  return {
    content: next,
    updatedIds,
    skippedLockedIds,
    missingIds: writes.map((write) => write.id).filter((id) => !seen.has(id) && !skipped.has(id)),
  };
}

export function writeMqxliffDefects(content: string, defects: MqxliffDefectWrite[]): MqxliffDefectWriteResult {
  const byId = new Map(defects.map((defect) => [defect.id, defect]));
  const updatedIds: string[] = [];
  const commentedIds: string[] = [];
  const skippedLockedIds: string[] = [];
  const seenIds: string[] = [];
  const unitPattern = /<((?:[\w.-]+:)?trans-unit)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  const next = content.replace(unitPattern, (full, _tagName, attrsRaw) => {
    const result = writeDefectTransUnit({ full, attrs: parseAttrs(attrsRaw ?? ""), attrsRaw: attrsRaw ?? "" }, byId);
    updatedIds.push(...result.updatedIds);
    commentedIds.push(...result.commentedIds);
    skippedLockedIds.push(...result.skippedLockedIds);
    seenIds.push(...result.seenIds);
    return result.full;
  });
  const seen = new Set(seenIds);
  const skipped = new Set(skippedLockedIds);
  return {
    content: next,
    updatedIds,
    commentedIds,
    skippedLockedIds,
    missingIds: defects.map((defect) => defect.id).filter((id) => !seen.has(id) && !skipped.has(id)),
  };
}
