import { readFile } from "node:fs/promises";
import { basename } from "node:path";

export interface InlineTag {
  index: number;
  placeholder: string;
  raw: string;
  name: string;
  kind: "open" | "close" | "self" | "variable";
}

export interface PhraseSegment {
  index: number;
  id: string;
  source: string;
  target: string;
  rehydratedSource: string;
  rehydratedTarget: string;
  sourceTags: InlineTag[];
  masterId?: string;
  resname?: string;
  paraId?: string;
  state?: string;
  locked: boolean;
  confirmed?: string;
  transOrigin?: string;
  contextNote?: string;
  duplicateKey: string;
  placeholderCount: number;
  unresolvedPlaceholderCount: number;
  unresolvedRuntimePlaceholderCount: number;
  unresolvedTagPlaceholderCount: number;
  unresolvedPlaceholders: string[];
  unresolvedRuntimePlaceholders: string[];
  unresolvedTagPlaceholders: string[];
}

export interface DuplicateSourceGroup {
  duplicateKey: string;
  source: string;
  count: number;
  segmentIds: string[];
  firstSegmentId: string;
}

export interface MasterXliffUnit {
  id: string;
  resname?: string;
  sourceRich: string;
  targetRich: string;
  sourcePlain: string;
}

export interface MasterXliffIndex {
  byId: Record<string, MasterXliffUnit>;
  byResname: Record<string, MasterXliffUnit>;
  bySourcePlain: Record<string, MasterXliffUnit>;
  units: MasterXliffUnit[];
}

export interface TagRehydrationReport {
  totalSegments: number;
  placeholderSegments: number;
  masterMatchedSegments: number;
  masterUnmatchedSegments: number;
  replacedPlaceholders: number;
  unresolvedPlaceholders: number;
  unresolvedRuntimePlaceholders: number;
  unresolvedTagPlaceholders: number;
  tagCountMismatches: number;
}

export interface PhraseMxliffBatch {
  format: "phrase_mxliff";
  batchId: string;
  fileName: string;
  sourceLanguage: string;
  targetLanguage: string;
  original?: string;
  segments: PhraseSegment[];
  duplicateSourceGroups: DuplicateSourceGroup[];
  tagReport: TagRehydrationReport;
}

export interface PhraseTargetWrite {
  id: string;
  target: string;
  rawSource: string;
  richSource: string;
  targetChanged?: boolean;
  nativeConfirmed?: string;
  modifiedAt?: string;
  levelEdited?: string;
}

export interface PhraseMxliffWriteResult {
  content: string;
  updatedIds: string[];
  missingIds: string[];
}

interface GroupContext {
  masterId?: string;
  note?: string;
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([\w:.-]+)\s*=\s*(["'])(.*?)\2/g;
  for (const match of raw.matchAll(pattern)) {
    attrs[match[1]] = decodeXml(match[3] ?? "");
  }
  return attrs;
}

function extractElement(block: string, name: string): { attrs: Record<string, string>; inner: string } | undefined {
  const pattern = new RegExp(
    `<(?:[\\w.-]+:)?${name}\\b([^>]*)>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${name}>`,
    "i",
  );
  const match = pattern.exec(block);
  if (!match) return undefined;
  return {
    attrs: parseAttrs(match[1] ?? ""),
    inner: decodeXml(match[2] ?? ""),
  };
}

function extractBlocks(content: string, name: string): Array<{ attrs: Record<string, string>; block: string; inner: string }> {
  const pattern = new RegExp(
    `<(?:[\\w.-]+:)?${name}\\b([^>]*)>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${name}>`,
    "gi",
  );
  return Array.from(content.matchAll(pattern)).map((match) => ({
    attrs: parseAttrs(match[1] ?? ""),
    block: match[0],
    inner: match[2] ?? "",
  }));
}

function isLocked(attrs: Record<string, string>): boolean {
  const locked = attrs["m:locked"] ?? attrs.locked;
  return ["1", "true", "yes", "locked"].includes((locked ?? "").trim().toLowerCase()) ||
    (attrs.translate ?? "").trim().toLowerCase() === "no";
}

function countPlaceholders(value: string): number {
  return Array.from(value.matchAll(/\{\d+\}|\{\d+>\}|<\d+\}/g)).length;
}

export function countPhrasePlaceholders(value: string): number {
  return countPlaceholders(value);
}

function tagName(raw: string): string {
  if (raw.startsWith("{")) return "variable";
  if (raw === "{u>" || raw === "<u}") return "change";
  const match = /^<\/?\s*([^\s=>/]+)/.exec(raw);
  return match?.[1] ?? "tag";
}

function inlineTagPattern(): RegExp {
  return /<(bpt|ept|ph|it|mrk|g|x|bx|ex)\b[^>]*>[\s\S]*?<\/\1>|\{u>|<u}|<\/?[A-Za-z][^>]*?>|\{(?!\d+\})[^{}]+\}/gi;
}

function isStructuralInlineTag(raw: string): boolean {
  if (raw.startsWith("{")) return true;
  if (raw === "<u}") return true;
  const name = /^<\/?\s*([^\s=>/]+)/.exec(raw)?.[1] ?? "";
  const lower = name.toLowerCase();
  const known = new Set(["bpt", "ept", "ph", "it", "mrk", "g", "x", "bx", "ex", "color", "font", "a", "b", "i", "u", "br"]);
  return known.has(lower) || /\s(?:id|xid|rid|ctype|equiv-text)\s*=/i.test(raw);
}

export function extractInlineTags(richText: string): InlineTag[] {
  const tags: InlineTag[] = [];
  const pattern = inlineTagPattern();
  let index = 1;
  for (const match of richText.matchAll(pattern)) {
    const raw = match[0];
    if (!isStructuralInlineTag(raw)) continue;
    const name = tagName(raw);
    tags.push({
      index,
      placeholder: `{${index}}`,
      raw,
      name,
      kind: raw.startsWith("{")
        ? "variable"
        : raw.startsWith("</") || ["ept", "ex"].includes(name.toLowerCase())
          ? "close"
          : raw.endsWith("/>") || ["ph", "x", "it"].includes(name.toLowerCase())
            ? "self"
            : "open",
    });
    index += 1;
  }
  return tags;
}

export function stripInlineTags(value: string): string {
  return decodeXml(value)
    .replace(/<\/?([A-Za-z][^\s=>/]*)[^>]*?>/g, (raw, name) => {
      const lower = String(name ?? "").toLowerCase();
      const known = new Set(["bpt", "ept", "ph", "it", "mrk", "g", "x", "bx", "ex", "color", "font", "a", "b", "i", "u", "br"]);
      return known.has(lower) || /\s(?:id|xid|rid|ctype|equiv-text)\s*=/i.test(raw) ? "" : raw;
    })
    .replace(/\{(?!\d+\})[^{}]+\}/g, "")
    .replace(/\{u>/g, "")
    .replace(/<u}/g, "")
    .replace(/\{\d+\}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function phraseInlineTagSignature(value: string): string[] {
  return extractInlineTags(value).filter((tag) => isStructuralInlineTag(tag.raw)).map((tag) => tag.raw);
}

export function phrasePlaceholderSignature(value: string): string[] {
  return Array.from(value.matchAll(/\{\d+\}|\{\d+>\}|<\d+\}/g)).map((match) => match[0]);
}

function placeholderNumber(value: string): number {
  const raw = value.match(/\d+/)?.[0] ?? "0";
  return Number(raw);
}

function classifyUnresolvedPlaceholders(value: string, structuralTagCount: number): {
  all: string[];
  runtime: string[];
  tag: string[];
} {
  const all = phrasePlaceholderSignature(value);
  const runtime: string[] = [];
  const tag: string[] = [];
  for (const placeholder of all) {
    const index = placeholderNumber(placeholder);
    if (/^\{\d+\}$/.test(placeholder) && index > structuralTagCount) {
      runtime.push(placeholder);
    } else {
      tag.push(placeholder);
    }
  }
  return { all, runtime, tag };
}

function normalizeDuplicateKey(value: string): string {
  return decodeXml(value)
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

function tagId(raw: string): string | undefined {
  return /(?:\s|^)id\s*=\s*["']([^"']+)["']/i.exec(raw)?.[1];
}

function buildTagLookups(tags: InlineTag[]): {
  bySequence: Map<string, string>;
  allByPair: Map<string, string>;
  openingByPair: Map<string, string>;
  closingByPair: Map<string, string>;
  standaloneByPair: Map<string, string>;
} {
  const bySequence = new Map<string, string>();
  const allByPair = new Map<string, string>();
  const openingByPair = new Map<string, string>();
  const closingByPair = new Map<string, string>();
  const standaloneByPair = new Map<string, string>();
  const pairStack: string[] = [];
  let pairCounter = 1;

  for (const tag of tags) {
    const sequence = String(tag.index);
    bySequence.set(sequence, tag.raw);

    let pairId = tagId(tag.raw);
    if (!pairId) {
      if (tag.kind === "close") {
        pairId = pairStack.pop() ?? String(pairCounter++);
      } else {
        pairId = String(pairCounter++);
        if (tag.kind === "open") pairStack.push(pairId);
      }
    }

    allByPair.set(pairId, tag.raw);
    if (tag.kind === "close") {
      closingByPair.set(pairId, tag.raw);
    } else if (tag.kind === "self" || tag.kind === "variable") {
      standaloneByPair.set(pairId, tag.raw);
      openingByPair.set(pairId, tag.raw);
    } else {
      openingByPair.set(pairId, tag.raw);
    }
  }

  return { bySequence, allByPair, openingByPair, closingByPair, standaloneByPair };
}

function rehydratePlaceholders(value: string, tags: InlineTag[]): { text: string; replaced: number; unresolved: number } {
  let replaced = 0;
  const lookups = buildTagLookups(tags);
  const text = value.replace(/\{(\d+)\}|\{(\d+)>\}|<(\d+)\}/g, (raw, sequenceId, openingId, closingId) => {
    let replacement: string | undefined;
    if (sequenceId) {
      replacement =
        lookups.bySequence.get(sequenceId) ??
        lookups.standaloneByPair.get(sequenceId) ??
        lookups.openingByPair.get(sequenceId) ??
        lookups.closingByPair.get(sequenceId) ??
        lookups.allByPair.get(sequenceId);
    } else if (openingId) {
      replacement = lookups.openingByPair.get(openingId) ?? lookups.allByPair.get(openingId);
    } else if (closingId) {
      replacement = lookups.closingByPair.get(closingId) ?? lookups.allByPair.get(closingId);
    }
    if (!replacement) return raw;
    replaced += 1;
    return replacement;
  });
  return {
    text,
    replaced,
    unresolved: countPlaceholders(text),
  };
}

function firstContext(block: string, contextType: string): string | undefined {
  const pattern = new RegExp(
    `<(?:[\\w.-]+:)?context(?=\\s|>)([^>]*)>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?context>`,
    "gi",
  );
  for (const match of block.matchAll(pattern)) {
    const attrs = parseAttrs(match[1] ?? "");
    if (attrs["context-type"] === contextType) return decodeXml(match[2] ?? "").trim();
  }
  return undefined;
}

function parseGroupContexts(content: string): Map<string, GroupContext> {
  const contexts = new Map<string, GroupContext>();
  for (const group of extractBlocks(content, "group")) {
    const groupId = group.attrs.id ?? group.attrs["m:para-id"];
    if (!groupId) continue;
    contexts.set(groupId, {
      masterId: firstContext(group.block, "x-key"),
      note: firstContext(group.block, "x-key-note"),
    });
  }
  return contexts;
}

export function parseMasterXliff(content: string): MasterXliffIndex {
  const units: MasterXliffUnit[] = [];
  const byId: Record<string, MasterXliffUnit> = {};
  const byResname: Record<string, MasterXliffUnit> = {};
  const bySourcePlain: Record<string, MasterXliffUnit> = {};

  for (const tu of extractBlocks(content, "trans-unit")) {
    const source = extractElement(tu.block, "seg-source") ?? extractElement(tu.block, "source");
    if (!source) continue;
    const target = extractElement(tu.block, "target");
    const unit: MasterXliffUnit = {
      id: tu.attrs.id ?? "",
      resname: tu.attrs.resname,
      sourceRich: source.inner,
      targetRich: target?.inner ?? "",
      sourcePlain: stripInlineTags(source.inner),
    };
    units.push(unit);
    if (unit.id) byId[unit.id] = unit;
    if (unit.resname) byResname[unit.resname] = unit;
    if (unit.sourcePlain) bySourcePlain[unit.sourcePlain] = unit;
  }

  return { byId, byResname, bySourcePlain, units };
}

function findMasterUnit(
  segmentAttrs: Record<string, string>,
  source: string,
  groupContext: GroupContext | undefined,
  master: MasterXliffIndex | undefined,
): MasterXliffUnit | undefined {
  if (!master) return undefined;
  const contextId = groupContext?.masterId;
  const resname = segmentAttrs.resname;
  if (contextId && master.byId[contextId]) return master.byId[contextId];
  if (resname && master.byResname[resname]) return master.byResname[resname];
  const plain = stripInlineTags(source);
  return plain ? master.bySourcePlain[plain] : undefined;
}

function buildDuplicateGroups(segments: PhraseSegment[]): DuplicateSourceGroup[] {
  const byKey = new Map<string, PhraseSegment[]>();
  for (const segment of segments) {
    if (!segment.duplicateKey) continue;
    const list = byKey.get(segment.duplicateKey) ?? [];
    list.push(segment);
    byKey.set(segment.duplicateKey, list);
  }
  return Array.from(byKey.entries())
    .filter(([, list]) => list.length > 1)
    .map(([duplicateKey, list]) => ({
      duplicateKey,
      source: list[0].rehydratedSource,
      count: list.length,
      segmentIds: list.map((segment) => segment.id),
      firstSegmentId: list[0].id,
    }));
}

function fileAttrs(content: string): Record<string, string> {
  const match = /<(?:[\w.-]+:)?file\b([^>]*)>/i.exec(content);
  return match ? parseAttrs(match[1] ?? "") : {};
}

export function parsePhraseMxliff(content: string, options: { fileName?: string; master?: MasterXliffIndex } = {}): PhraseMxliffBatch {
  const attrs = fileAttrs(content);
  const groupContexts = parseGroupContexts(content);
  const segments: PhraseSegment[] = [];
  const report: TagRehydrationReport = {
    totalSegments: 0,
    placeholderSegments: 0,
    masterMatchedSegments: 0,
    masterUnmatchedSegments: 0,
    replacedPlaceholders: 0,
    unresolvedPlaceholders: 0,
    unresolvedRuntimePlaceholders: 0,
    unresolvedTagPlaceholders: 0,
    tagCountMismatches: 0,
  };

  for (const tu of extractBlocks(content, "trans-unit")) {
    const sourceEl = extractElement(tu.block, "source");
    const targetEl = extractElement(tu.block, "target");
    const source = sourceEl?.inner ?? "";
    const target = targetEl?.inner ?? "";
    const paraId = tu.attrs["m:para-id"];
    const groupContext = paraId ? groupContexts.get(paraId) : undefined;
    const masterUnit = findMasterUnit(tu.attrs, source, groupContext, options.master);
    const tags = masterUnit ? extractInlineTags(masterUnit.sourceRich) : [];
    const sourceResult = rehydratePlaceholders(source, tags);
    const targetResult = rehydratePlaceholders(target, tags);
    const placeholderCount = countPlaceholders(source) + countPlaceholders(target);
    const sourceUnresolved = classifyUnresolvedPlaceholders(sourceResult.text, tags.length);
    const targetUnresolved = classifyUnresolvedPlaceholders(targetResult.text, tags.length);
    const unresolvedPlaceholders = [...sourceUnresolved.all, ...targetUnresolved.all];
    const unresolvedRuntimePlaceholders = [...sourceUnresolved.runtime, ...targetUnresolved.runtime];
    const unresolvedTagPlaceholders = [...sourceUnresolved.tag, ...targetUnresolved.tag];
    const unresolved = unresolvedPlaceholders.length;

    report.totalSegments += 1;
    if (placeholderCount > 0) report.placeholderSegments += 1;
    if (masterUnit) report.masterMatchedSegments += 1;
    else if (placeholderCount > 0) report.masterUnmatchedSegments += 1;
    report.replacedPlaceholders += sourceResult.replaced + targetResult.replaced;
    report.unresolvedPlaceholders += unresolved;
    report.unresolvedRuntimePlaceholders += unresolvedRuntimePlaceholders.length;
    report.unresolvedTagPlaceholders += unresolvedTagPlaceholders.length;
    if (unresolvedTagPlaceholders.length > 0) {
      report.tagCountMismatches += 1;
    }

    segments.push({
      index: segments.length + 1,
      id: tu.attrs.id ?? String(segments.length + 1),
      source,
      target,
      rehydratedSource: sourceResult.text,
      rehydratedTarget: targetResult.text,
      sourceTags: tags,
      masterId: groupContext?.masterId,
      resname: tu.attrs.resname,
      paraId,
      state: targetEl?.attrs.state,
      locked: isLocked(tu.attrs),
      confirmed: tu.attrs["m:confirmed"],
      transOrigin: tu.attrs["m:trans-origin"],
      contextNote: groupContext?.note,
      duplicateKey: normalizeDuplicateKey(sourceResult.text),
      placeholderCount,
      unresolvedPlaceholderCount: unresolved,
      unresolvedRuntimePlaceholderCount: unresolvedRuntimePlaceholders.length,
      unresolvedTagPlaceholderCount: unresolvedTagPlaceholders.length,
      unresolvedPlaceholders,
      unresolvedRuntimePlaceholders,
      unresolvedTagPlaceholders,
    });
  }

  return {
    format: "phrase_mxliff",
    batchId: basename(options.fileName ?? attrs.original ?? "phrase-batch", ".mxliff"),
    fileName: options.fileName ?? "",
    sourceLanguage: attrs["source-language"] ?? "",
    targetLanguage: attrs["target-language"] ?? "",
    original: attrs.original,
    segments,
    duplicateSourceGroups: buildDuplicateGroups(segments),
    tagReport: report,
  };
}

export async function readMasterXliff(path: string): Promise<MasterXliffIndex> {
  return parseMasterXliff(await readFile(path, "utf8"));
}

export async function readPhraseMxliff(
  path: string,
  options: { masterPath?: string } = {},
): Promise<PhraseMxliffBatch> {
  const master = options.masterPath ? await readMasterXliff(options.masterPath) : undefined;
  return parsePhraseMxliff(await readFile(path, "utf8"), { fileName: basename(path), master });
}

function encodeXmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function placeholderSequence(rawSource: string): string[] {
  return Array.from(rawSource.matchAll(/\{\d+\}|\{\d+>\}|<\d+\}/g)).map((match) => match[0]);
}

export function dehydratePhraseTarget(target: string, rawSource: string, richSource: string): string {
  const placeholderQueues = new Map<string, string[]>();
  const richTags = extractInlineTags(richSource);
  const placeholders = placeholderSequence(rawSource);
  for (const [index, tag] of richTags.entries()) {
    const placeholder = placeholders[index] ?? tag.placeholder;
    const list = placeholderQueues.get(tag.raw) ?? [];
    list.push(placeholder);
    placeholderQueues.set(tag.raw, list);
  }
  let text = "";
  let cursor = 0;
  for (const match of target.matchAll(inlineTagPattern())) {
    const start = match.index ?? 0;
    text += target.slice(cursor, start);
    const raw = match[0];
    const queue = placeholderQueues.get(raw);
    text += queue?.length ? queue.shift() : raw;
    cursor = start + raw.length;
  }
  text += target.slice(cursor);
  return encodeXmlText(text)
    .replace(/\{(\d+)\}/g, "{$1}")
    .replace(/\{(\d+)&gt;\}/g, "{$1>}");
}

function attrValue(rawAttrs: string, name: string): string | undefined {
  const pattern = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`, "i");
  return pattern.exec(rawAttrs)?.[2];
}

function replaceTargetInUnit(block: string, encodedTarget: string): string {
  const targetPattern = /(<(?:[\w.-]+:)?target\b[^>]*>)([\s\S]*?)(<\/(?:[\w.-]+:)?target>)/i;
  if (targetPattern.test(block)) {
    return block.replace(targetPattern, (_match, open, _oldTarget, close) => `${open}${encodedTarget}${close}`);
  }
  const sourceClose = /<\/(?:[\w.-]+:)?source>/i;
  return block.replace(sourceClose, (match) => `${match}<target>${encodedTarget}</target>`);
}

function encodeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function setRawAttr(rawAttrs: string, name: string, value: string | undefined): string {
  if (value === undefined) return rawAttrs;
  const attrPattern = new RegExp(`(\\s${escapeRegExp(name)}\\s*=\\s*)(["'])(.*?)\\2`, "i");
  if (attrPattern.test(rawAttrs)) {
    return rawAttrs.replace(attrPattern, (_match, prefix, quote) => `${prefix}${quote}${encodeXmlAttr(value)}${quote}`);
  }
  return `${rawAttrs} ${name}="${encodeXmlAttr(value)}"`;
}

function updateTransUnitAttrs(block: string, updates: Record<string, string | undefined>): string {
  if (Object.values(updates).every((value) => value === undefined)) return block;
  return block.replace(/^<([A-Za-z0-9_.-]+:)?trans-unit\b([^>]*)>/i, (_open, prefix = "", rawAttrs = "") => {
    let nextAttrs = rawAttrs;
    for (const [name, value] of Object.entries(updates)) {
      nextAttrs = setRawAttr(nextAttrs, name, value);
    }
    return `<${prefix}trans-unit${nextAttrs}>`;
  });
}

export function writePhraseMxliffTargetsWithReport(content: string, writes: PhraseTargetWrite[]): PhraseMxliffWriteResult {
  const byId = new Map(writes.map((write) => [write.id, write]));
  const updatedIds: string[] = [];
  const unitPattern = /<([A-Za-z0-9_.-]+:)?trans-unit\b([^>]*)>[\s\S]*?<\/\1?trans-unit>/gi;
  const next = content.replace(unitPattern, (block, _prefix, attrs) => {
    const id = attrValue(attrs ?? "", "id");
    if (!id) return block;
    const write = byId.get(decodeXml(id));
    if (!write) return block;
    let nextBlock = block;
    if (write.targetChanged !== false) {
      nextBlock = replaceTargetInUnit(nextBlock, dehydratePhraseTarget(write.target, write.rawSource, write.richSource));
    }
    nextBlock = updateTransUnitAttrs(nextBlock, {
      "m:confirmed": write.nativeConfirmed,
      "m:modified-at": write.modifiedAt,
      "m:level-edited": write.levelEdited,
    });
    if (nextBlock !== block) updatedIds.push(write.id);
    return nextBlock;
  });
  const updated = new Set(updatedIds);
  return {
    content: next,
    updatedIds,
    missingIds: writes.map((write) => write.id).filter((id) => !updated.has(id)),
  };
}

export function writePhraseMxliffTargets(content: string, writes: PhraseTargetWrite[]): string {
  return writePhraseMxliffTargetsWithReport(content, writes).content;
}
