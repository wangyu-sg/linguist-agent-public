import { readFile } from "node:fs/promises";
import { basename } from "node:path";

export type SdlxliffConfirmationLevel =
  | "Draft"
  | "Translated"
  | "ApprovedTranslation"
  | "ApprovedSignOff"
  | "DraftInternal"
  | string;

export interface SdlxliffInlineTag {
  kind: string;
  value: string;
  rawXml: string;
}

export interface SdlxliffSegment {
  index: number;
  id: string;
  tuId: string;
  source: string;
  target: string;
  locked: boolean;
  confirmationLevel?: string;
  sourceTags: SdlxliffInlineTag[];
  duplicateKey: string;
}

export interface SdlxliffBatch {
  format: "sdlxliff";
  batchId: string;
  fileName: string;
  sourceLanguage: string;
  targetLanguage: string;
  original?: string;
  segments: SdlxliffSegment[];
}

export interface SdlxliffTargetWrite {
  id: string;
  target: string;
}

export interface SdlxliffWriteResult {
  content: string;
  updatedIds: string[];
  forcedConfirmationIds: string[];
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

function extractTransUnits(content: string): Array<{ full: string; attrs: Record<string, string>; attrsRaw: string; inner: string }> {
  const pattern = /<((?:[\w.-]+:)?trans-unit)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  return Array.from(content.matchAll(pattern)).map((match) => ({
    full: match[0],
    attrs: parseAttrs(match[2] ?? ""),
    attrsRaw: match[2] ?? "",
    inner: match[3] ?? "",
  }));
}

function extractMrkSegments(block: string | undefined): Array<{ full: string; attrs: Record<string, string>; attrsRaw: string; inner: string }> {
  if (!block) return [];
  const pattern = /<((?:[\w.-]+:)?mrk)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  return Array.from(block.matchAll(pattern))
    .map((match) => ({
      full: match[0],
      attrs: parseAttrs(match[2] ?? ""),
      attrsRaw: match[2] ?? "",
      inner: match[3] ?? "",
    }))
    .filter((mrk) => mrk.attrs.mtype === "seg");
}

function sdlxliffFallbackTagValue(kind: string, attrs: Record<string, string>, ordinal: number): string {
  const id = attrs.id ?? attrs["xid"] ?? String(ordinal);
  if (kind === "bpt") return `{${id}>`;
  if (kind === "ept") return `<${id}}`;
  if (kind === "it") return `{${id}/${attrs.pos ?? "it"}}`;
  return `{${id}}`;
}

function inlineDisplayValue(kind: string, attrs: Record<string, string>, inner: string, ordinal: number): string {
  const equiv = attrs["equiv-text"];
  if (equiv) return decodeXml(equiv);
  if (kind === "g" && inner.trim()) return decodeXml(inner.replace(/<[^>]+>/g, ""));
  return sdlxliffFallbackTagValue(kind, attrs, ordinal);
}

export function unwrapSdlxliffInlineXml(value: string): { text: string; tags: SdlxliffInlineTag[] } {
  const tags: SdlxliffInlineTag[] = [];
  const parts: string[] = [];
  const pattern = /<((?:[\w.-]+:)?(?:bpt|ept|ph|it|x|g))\b([^>]*)(?:\/>|>([\s\S]*?)<\/\1>)/gi;
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > cursor) parts.push(decodeXml(value.slice(cursor, start)));
    const rawXml = match[0];
    const attrsRaw = match[2] ?? "";
    const attrs = parseAttrs(attrsRaw);
    const inner = match[3];
    const kind = localName(match[1]);

    // H4: a paired <g ...>translatable</g> wraps EDITABLE content. Model it as a
    // distinct open/close token pair around the (recursively unwrapped) inner text,
    // so the inner stays translatable and the formatting span survives round-trip.
    // Previously <g> collapsed to its source inner text as a single display value,
    // which dropped the span whenever the translation changed the text.
    if (kind === "g" && inner !== undefined && inner.trim()) {
      const gid = attrs.id ?? String(tags.length + 1);
      const openValue = `{g${gid}}`;
      const closeValue = `{/g${gid}}`;
      tags.push({ kind: "g", value: openValue, rawXml: `<${match[1]}${attrsRaw}>` });
      parts.push(openValue);
      const innerResult = unwrapSdlxliffInlineXml(inner);
      tags.push(...innerResult.tags);
      parts.push(innerResult.text);
      tags.push({ kind: "g", value: closeValue, rawXml: `</${match[1]}>` });
      parts.push(closeValue);
      cursor = start + rawXml.length;
      continue;
    }

    const tag = {
      kind,
      value: inlineDisplayValue(kind, attrs, inner ?? "", tags.length + 1),
      rawXml,
    };
    tags.push(tag);
    parts.push(tag.value);
    cursor = start + rawXml.length;
  }
  if (cursor < value.length) parts.push(decodeXml(value.slice(cursor)));
  return { text: parts.join(""), tags };
}

export function sdlxliffInlineTagSignatureFromTags(tags: SdlxliffInlineTag[]): string[] {
  return tags.map((tag) => tag.value).filter(Boolean);
}

export function sdlxliffInlineTagSignatureFromText(text: string, tags: SdlxliffInlineTag[]): string[] {
  const values = Array.from(new Set(sdlxliffInlineTagSignatureFromTags(tags))).sort((a, b) => b.length - a.length);
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

function normalizeDuplicateKey(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function isLockedAttr(value: string | undefined): boolean {
  return ["1", "true", "yes", "locked"].includes((value ?? "").trim().toLowerCase());
}

function parseSegDefs(content: string): Map<string, { conf?: string; locked: boolean }> {
  const defs = new Map<string, { conf?: string; locked: boolean }>();
  const pattern = /<((?:sdl:)?seg)(?=[\s>/])([^>]*)(?:\/>|>[\s\S]*?<\/\1>)/gi;
  for (const match of content.matchAll(pattern)) {
    const attrs = parseAttrs(match[2] ?? "");
    if (!attrs.id) continue;
    defs.set(attrs.id, {
      conf: attrs.conf,
      locked: isLockedAttr(attrs.locked),
    });
  }
  return defs;
}

function firstFileAttrs(content: string): Record<string, string> {
  const match = /<((?:[\w.-]+:)?file)\b([^>]*)>/i.exec(content);
  return match ? parseAttrs(match[2] ?? "") : {};
}

function statusFromConfirmation(target: string, conf: string | undefined): "new" | "draft" | "confirmed" {
  if (!target.trim()) return "new";
  if (conf === "ApprovedTranslation" || conf === "ApprovedSignOff") return "confirmed";
  return "draft";
}

export function segmentStatusFromSdlxliff(target: string, conf: string | undefined): "new" | "draft" | "confirmed" {
  return statusFromConfirmation(target, conf);
}

export function parseSdlxliff(content: string, options: { fileName?: string } = {}): SdlxliffBatch {
  const fileAttrs = firstFileAttrs(content);
  const segDefs = parseSegDefs(content);
  const segments: SdlxliffSegment[] = [];

  for (const tu of extractTransUnits(content)) {
    const tuId = tu.attrs.id ?? "";
    const segSource = findElement(tu.full, "seg-source");
    const target = findElement(tu.full, "target");
    const sourceMrks = extractMrkSegments(segSource?.inner);
    const targetMrks = new Map(extractMrkSegments(target?.inner).map((mrk) => [mrk.attrs.mid ?? "", mrk]));

    if (!sourceMrks.length) {
      const source = findElement(tu.full, "source");
      if (!source) continue;
      const sourceText = unwrapSdlxliffInlineXml(source.inner);
      const targetText = unwrapSdlxliffInlineXml(target?.inner ?? "");
      const locked = (tu.attrs.translate ?? "").toLowerCase() === "no";
      segments.push({
        index: segments.length + 1,
        id: tuId || String(segments.length + 1),
        tuId,
        source: sourceText.text,
        target: targetText.text,
        locked,
        sourceTags: sourceText.tags,
        duplicateKey: normalizeDuplicateKey(sourceText.text),
      });
      continue;
    }

    // M7: a trans-unit-level translate="no" locks ALL its mrk segments, not just
    // the non-segmented fallback. Previously the mrk branch only honored the
    // seg-def lock attr and ignored the unit-level translate="no".
    const tuTranslateNo = (tu.attrs.translate ?? "").toLowerCase() === "no";
    for (const srcMrk of sourceMrks) {
      const mid = srcMrk.attrs.mid;
      if (!mid) continue;
      const source = unwrapSdlxliffInlineXml(srcMrk.inner);
      const targetMrk = targetMrks.get(mid);
      const targetText = unwrapSdlxliffInlineXml(targetMrk?.inner ?? "");
      const def = segDefs.get(mid);
      segments.push({
        index: segments.length + 1,
        id: mid,
        tuId,
        source: source.text,
        target: targetText.text,
        locked: (def?.locked ?? false) || tuTranslateNo,
        confirmationLevel: def?.conf,
        sourceTags: source.tags,
        duplicateKey: normalizeDuplicateKey(source.text),
      });
    }
  }

  return {
    format: "sdlxliff",
    batchId: basename(options.fileName ?? fileAttrs.original ?? "sdlxliff-batch", ".sdlxliff"),
    fileName: options.fileName ?? "",
    sourceLanguage: fileAttrs["source-language"] ?? "",
    targetLanguage: fileAttrs["target-language"] ?? "",
    original: fileAttrs.original,
    segments,
  };
}

export async function readSdlxliff(path: string): Promise<SdlxliffBatch> {
  return parseSdlxliff(await readFile(path, "utf8"), { fileName: basename(path) });
}

function rewrapSdlxliffText(text: string, tags: SdlxliffInlineTag[]): string {
  if (!tags.length || !text) return encodeXmlText(text);
  const sorted = Array.from(new Set(tags.map((tag) => tag.value).filter(Boolean))).sort((a, b) => b.length - a.length);
  const queues = new Map<string, SdlxliffInlineTag[]>();
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

function getMrkTextByMid(targetInner: string | undefined, mid: string): string {
  if (!targetInner) return "";
  const mrk = extractMrkSegments(targetInner).find((item) => item.attrs.mid === mid);
  return mrk ? unwrapSdlxliffInlineXml(mrk.inner).text : "";
}

function replaceMrkInner(targetInner: string, mid: string, nextInner: string): { inner: string; found: boolean } {
  let found = false;
  const pattern = /<((?:[\w.-]+:)?mrk)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  const inner = targetInner.replace(pattern, (full, tagName, attrsRaw) => {
    const attrs = parseAttrs(attrsRaw ?? "");
    if (attrs.mtype !== "seg" || attrs.mid !== mid) return full;
    found = true;
    return `<${tagName}${attrsRaw}>${nextInner}</${tagName}>`;
  });
  return { inner, found };
}

function setAttr(attrsRaw: string, name: string, value: string): string {
  const pattern = new RegExp(`(\\s${escapeRegExp(name)}\\s*=\\s*)(["'])(.*?)\\2`, "i");
  if (pattern.test(attrsRaw)) {
    return attrsRaw.replace(pattern, (_match, pre, quote) => `${pre}${quote}${encodeXmlAttr(value)}${quote}`);
  }
  return `${attrsRaw} ${name}="${encodeXmlAttr(value)}"`;
}

function updateModifiedOn(body: string, valuePrefix: string): string {
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  const valueTag = `${valuePrefix}value`;
  const pattern = new RegExp(`(<${escapeRegExp(valueTag)}\\b[^>]*\\bkey=(["'])modified_on\\2[^>]*>)([\\s\\S]*?)(<\\/${escapeRegExp(valueTag)}>)`, "i");
  if (pattern.test(body)) {
    return body.replace(pattern, (_match, open, _quote, _old, close) => `${open}${now}${close}`);
  }
  return `${body}<${valueTag} key="modified_on">${now}</${valueTag}>`;
}

function markSegDef(content: string, mid: string, conf: SdlxliffConfirmationLevel): string {
  let marked = false;
  const pattern = /<((?:sdl:)?seg)(?=[\s>/])([^>]*)(?:\/>|>([\s\S]*?)<\/\1>)/gi;
  let next = content.replace(pattern, (full, tagName, attrsRaw, body) => {
    const attrs = parseAttrs(attrsRaw ?? "");
    if (attrs.id !== mid) return full;
    marked = true;
    const nextAttrs = setAttr(attrsRaw ?? "", "conf", conf);
    const prefix = tagName.includes(":") ? `${tagName.split(":")[0]}:` : "";
    const nextBody = updateModifiedOn(body ?? "", prefix);
    return `<${tagName}${nextAttrs}>${nextBody}</${tagName}>`;
  });
  if (!marked) {
    const insert = `<sdl:seg id="${encodeXmlAttr(mid)}" conf="${encodeXmlAttr(conf)}"><sdl:value key="modified_on">${new Date().toISOString().replace("T", " ").slice(0, 19)}</sdl:value></sdl:seg>`;
    const defsClose = /<\/sdl:seg-defs>/i;
    if (defsClose.test(next)) next = next.replace(defsClose, `${insert}</sdl:seg-defs>`);
  }
  return next;
}

function writeTransUnit(
  unit: { full: string; attrs: Record<string, string> },
  writes: Map<string, SdlxliffTargetWrite>,
  segDefs: Map<string, { conf?: string; locked: boolean }>,
  forceConfirmation: boolean,
  confirmableSet: Set<string> | undefined,
): { full: string; updatedIds: string[]; forcedConfirmationIds: string[]; skippedLockedIds: string[]; seenIds: string[] } {
  const updatedIds: string[] = [];
  const forcedConfirmationIds: string[] = [];
  const skippedLockedIds: string[] = [];
  const seenIds: string[] = [];

  const segSource = findElement(unit.full, "seg-source");
  const target = findElement(unit.full, "target");
  const sourceMrks = extractMrkSegments(segSource?.inner);

  if (!sourceMrks.length) {
    const tuId = unit.attrs.id ?? "";
    const write = writes.get(tuId);
    if (!write) return { full: unit.full, updatedIds, forcedConfirmationIds, skippedLockedIds, seenIds };
    seenIds.push(tuId);
    if ((unit.attrs.translate ?? "").toLowerCase() === "no") {
      skippedLockedIds.push(tuId);
      return { full: unit.full, updatedIds, forcedConfirmationIds, skippedLockedIds, seenIds };
    }
    const source = findElement(unit.full, "source");
    const sourceTags = unwrapSdlxliffInlineXml(source?.inner ?? "").tags;
    const existing = unwrapSdlxliffInlineXml(target?.inner ?? "").text;
    if (existing === write.target) return { full: unit.full, updatedIds, forcedConfirmationIds, skippedLockedIds, seenIds };
    const nextTarget = `<target xml:space="preserve">${rewrapSdlxliffText(write.target, sourceTags)}</target>`;
    const full = target ? unit.full.replace(target.full, nextTarget) : unit.full.replace(/<\/((?:[\w.-]+:)?source)>/i, (close) => `${close}${nextTarget}`);
    updatedIds.push(tuId);
    return { full, updatedIds, forcedConfirmationIds, skippedLockedIds, seenIds };
  }

  let full = unit.full;
  let targetInner = target?.inner ?? "";
  const appendMrks: string[] = [];
  // M7: trans-unit translate="no" locks every mrk segment in the unit.
  const tuTranslateNo = (unit.attrs.translate ?? "").toLowerCase() === "no";

  for (const srcMrk of sourceMrks) {
    const mid = srcMrk.attrs.mid;
    if (!mid) continue;
    const write = writes.get(mid);
    if (!write) continue;
    seenIds.push(mid);
    if (segDefs.get(mid)?.locked || tuTranslateNo) {
      skippedLockedIds.push(mid);
      continue;
    }
    const sourceTags = unwrapSdlxliffInlineXml(srcMrk.inner).tags;
    const existing = getMrkTextByMid(targetInner, mid);
    if (existing === write.target) {
      // M6: only force-confirm (E/P sign-off) segments LA actually reviewed, not
      // every stored target that happens to already match the source file.
      if (forceConfirmation && (!confirmableSet || confirmableSet.has(mid))) forcedConfirmationIds.push(mid);
      continue;
    }
    const nextInner = rewrapSdlxliffText(write.target, sourceTags);
    const replaced = replaceMrkInner(targetInner, mid, nextInner);
    if (replaced.found) {
      targetInner = replaced.inner;
    } else {
      appendMrks.push(`<mrk mtype="seg" mid="${encodeXmlAttr(mid)}">${nextInner}</mrk>`);
    }
    updatedIds.push(mid);
  }

  if (updatedIds.length || appendMrks.length) {
    targetInner += appendMrks.join("");
    const nextTarget = target
      ? `<${target.tagName}${target.attrsRaw}>${targetInner}</${target.tagName}>`
      : `<target xml:space="preserve">${targetInner}</target>`;
    full = target ? full.replace(target.full, nextTarget) : full.replace(segSource?.full ?? "", `${segSource?.full ?? ""}${nextTarget}`);
  }

  return { full, updatedIds, forcedConfirmationIds, skippedLockedIds, seenIds };
}

export function writeSdlxliffTargets(
  content: string,
  writes: SdlxliffTargetWrite[],
  options: { confirmationLevel?: SdlxliffConfirmationLevel; forceConfirmation?: boolean; confirmableIds?: ReadonlyArray<string> } = {},
): SdlxliffWriteResult {
  const confirmationLevel = options.confirmationLevel ?? "Translated";
  const forceConfirmation = options.forceConfirmation ?? false;
  const confirmableSet = options.confirmableIds ? new Set(options.confirmableIds) : undefined;
  const byId = new Map(writes.map((write) => [write.id, write]));
  const segDefs = parseSegDefs(content);
  const updatedIds: string[] = [];
  const forcedConfirmationIds: string[] = [];
  const skippedLockedIds: string[] = [];
  const seenIds: string[] = [];

  const unitPattern = /<((?:[\w.-]+:)?trans-unit)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let next = content.replace(unitPattern, (full, _tagName, attrsRaw) => {
    const result = writeTransUnit(
      { full, attrs: parseAttrs(attrsRaw ?? "") },
      byId,
      segDefs,
      forceConfirmation,
      confirmableSet,
    );
    updatedIds.push(...result.updatedIds);
    forcedConfirmationIds.push(...result.forcedConfirmationIds);
    skippedLockedIds.push(...result.skippedLockedIds);
    seenIds.push(...result.seenIds);
    return result.full;
  });

  for (const id of [...updatedIds, ...forcedConfirmationIds]) {
    next = markSegDef(next, id, confirmationLevel);
  }

  const seen = new Set(seenIds);
  const skipped = new Set(skippedLockedIds);
  return {
    content: next,
    updatedIds,
    forcedConfirmationIds,
    skippedLockedIds,
    missingIds: writes.map((write) => write.id).filter((id) => !seen.has(id) && !skipped.has(id)),
  };
}
