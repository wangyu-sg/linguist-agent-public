import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { extname, isAbsolute, resolve } from "node:path";
import { createWorkspace, readJsonFile, workspacePath, writeJsonFile } from "./workspace.js";
import { readProjectLocalePair, readProjectManifest } from "./project_manifest.js";
import { promoteTermHistoryEntries, readTermHistoryIndex } from "./term_history.js";
import { extractMappedRows } from "./workbook_mapping.js";
import { workflowArtifactsPath, type WorkflowAuthorityDecision } from "./workflow_artifacts.js";
import type { TermHistoryDecision, TermHistoryIndex } from "./term_history.js";
import { localesMatch } from "./locale.js";
import { assertCatCoreLegacyAllowed, catCorePersistenceFor, readCatCoreReadCache } from "./cat_core_storage.js";

export interface TermbaseEntry {
  id: string;
  source: string;
  target: string;
  srcLang: string;
  tgtLang: string;
  note?: string;
  conceptId?: number;
  fields?: Record<string, string[]>;
  sourceFile: string;
  sheetName?: string;
  rowNo: number;
  origin: "sdltb" | "tbx" | "table" | "manual";
}

export interface TermbaseOverride {
  source: string;
  target: string;
  srcLang?: string;
  tgtLang?: string;
  reason?: string;
  decidedBy?: string;
  ts?: string;
}

export interface TermbaseConflict {
  source: string;
  srcLang?: string;
  tgtLang?: string;
  targets: string[];
  entries: Array<Pick<TermbaseEntry, "id" | "source" | "target" | "sourceFile" | "sheetName" | "rowNo" | "note"> & {
    historyStatus?: TermHistoryDecision["status"];
    historyReason?: string;
    historyRows?: TermHistoryDecision["evidenceRows"];
    authorityTier?: "term_history_current" | "term_history_deprecated" | "term_history_conflict" | "local_termbase";
  }>;
}

export interface TermbaseImportResult {
  projectId: string;
  imported: number;
  skipped: number;
  path: string;
  sample: TermbaseEntry[];
  warnings: string[];
}

export interface TermbaseMatch extends TermbaseEntry {
  matchType: "exact" | "contains";
  resolution?: "preferred" | "override" | "conflict" | "overridden";
  conflictTargets?: string[];
  overriddenBy?: string;
}

const execFileAsync = promisify(execFile);

export function termbasePath(workspaceRoot: string, projectId: string): string {
  return workspacePath(createWorkspace(workspaceRoot, projectId), "termbase.json");
}

export function termbaseOverridesPath(workspaceRoot: string, projectId: string): string {
  return workspacePath(createWorkspace(workspaceRoot, projectId), "termbase_overrides.json");
}

async function resolveProjectPath(workspaceRoot: string, projectId: string, path: string): Promise<string> {
  if (isAbsolute(path)) return path;
  const manifest = await readProjectManifest(workspaceRoot, projectId);
  return resolve(manifest.root, path);
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

function langMatches(value: string, expected: string): boolean {
  if (!value) return false;
  return value.toLocaleLowerCase().split("-", 1)[0] === expected.toLocaleLowerCase().split("-", 1)[0];
}

function splitCsvLine(line: string): string[] {
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

function parseCsvDicts(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = (cells[index] ?? "").trim();
    });
    return row;
  });
}

export function parseSdltbIndexCsv(text: string): Map<number, string[]> {
  const rows = parseCsvDicts(text);
  const out = new Map<number, string[]>();
  for (const row of rows) {
    const concept = Number(row.conceptid ?? row.conceptId ?? row.ConceptID ?? "");
    const term = (row.origterm ?? row.term ?? row.Term ?? "").trim();
    if (!Number.isFinite(concept) || !term) continue;
    const bucket = out.get(concept) ?? [];
    if (!bucket.includes(term)) bucket.push(term);
    out.set(concept, bucket);
  }
  return out;
}

export interface SdltbConceptMeta {
  descriptions: string[];
  fields: Record<string, string[]>;
}

function pushUnique(target: string[], value: string): void {
  const trimmed = value.trim();
  if (trimmed && !target.includes(trimmed)) target.push(trimmed);
}

export function parseSdltbConceptsCsv(text: string): Map<number, SdltbConceptMeta> {
  const concepts = new Map<number, SdltbConceptMeta>();
  for (const row of parseCsvDicts(text)) {
    const conceptId = Number(row.conceptid ?? row.conceptId ?? row.ConceptID ?? "");
    const xml = row.text ?? row.Text ?? "";
    if (!Number.isFinite(conceptId) || !xml) continue;
    const meta: SdltbConceptMeta = { descriptions: [], fields: {} };
    for (const desc of xml.matchAll(/<d\b([^>]*)>([\s\S]*?)<\/d>/g)) {
      const attrs = desc[1] ?? "";
      const type = decodeXml(attrs.match(/\btype="([^"]+)"/)?.[1] ?? "Description") || "Description";
      const value = decodeXml(desc[2] ?? "");
      if (!value) continue;
      const bucket = meta.fields[type] ?? [];
      pushUnique(bucket, value);
      meta.fields[type] = bucket;
      if (type.toLocaleLowerCase() === "description") pushUnique(meta.descriptions, value);
    }
    if (meta.descriptions.length || Object.keys(meta.fields).length) concepts.set(conceptId, meta);
  }
  return concepts;
}

export function pairsFromSdltbIndexes(
  sourceTerms: Map<number, string[]>,
  targetTerms: Map<number, string[]>,
): Array<{ source: string; target: string; conceptId: number }> {
  const rows: Array<{ source: string; target: string; conceptId: number }> = [];
  for (const [conceptId, sources] of sourceTerms.entries()) {
    const targets = targetTerms.get(conceptId) ?? [];
    for (const source of sources) {
      for (const target of targets) {
        rows.push({ source, target, conceptId });
      }
    }
  }
  return rows;
}

export function sdltbTableForLang(tables: string[], lang: string): string {
  const normalized = lang.toUpperCase();
  const exact = `I_${normalized}`;
  if (tables.includes(exact)) return exact;
  const primary = normalized.split("-", 1)[0];
  const candidates = tables.filter((table) => table.toUpperCase().startsWith(`I_${primary}`));
  if (candidates.length === 1) return candidates[0];
  throw new Error(`SDLTB language table not found for ${lang}. Available tables: ${tables.join(", ")}`);
}

async function runMdb(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(args[0], args.slice(1), { maxBuffer: 128 * 1024 * 1024 });
    return String(stdout);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("mdbtools not found. Install with `brew install mdbtools` before importing SDLTB.");
    }
    const stderr = (error as { stderr?: string | Buffer }).stderr;
    throw new Error(`${args[0]} failed: ${stderr ? String(stderr).trim() : (error as Error).message}`);
  }
}

async function listSdltbTables(path: string): Promise<string[]> {
  return (await runMdb(["mdb-tables", "-1", path]))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function exportSdltbTable(path: string, table: string): Promise<string> {
  return runMdb(["mdb-export", path, table]);
}

function localName(tag: string): string {
  return tag.includes(":") ? tag.split(":").pop() ?? tag : tag;
}

function collectTermsForLang(entryXml: string, lang: string): string[] {
  const terms: string[] = [];
  const sectionRegex = /<([A-Za-z0-9:_-]+)\b([^>]*)>([\s\S]*?)<\/\1>/g;
  for (const match of entryXml.matchAll(sectionRegex)) {
    const tag = localName(match[1] ?? "");
    if (tag !== "langSet" && tag !== "langSec") continue;
    const attrs = match[2] ?? "";
    const langAttr = attrs.match(/(?:xml:lang|lang)="([^"]+)"/)?.[1] ?? "";
    if (!langMatches(langAttr, lang)) continue;
    for (const termMatch of (match[3] ?? "").matchAll(/<[^>/:\s]*:?term\b[^>]*>([\s\S]*?)<\/[^>/:\s]*:?term>/g)) {
      const term = decodeXml(termMatch[1] ?? "");
      if (term && !terms.includes(term)) terms.push(term);
    }
  }
  return terms;
}

export function parseTbxPairs(text: string, options: { srcLang: string; tgtLang: string }): Array<{ source: string; target: string; note?: string }> {
  if (!/<(?:[^:>\s]+:)?(?:martif|tbx)\b/i.test(text)) {
    throw new Error("TBX root not found. Expected <martif> or <tbx>.");
  }
  const pairs: Array<{ source: string; target: string; note?: string }> = [];
  const entryRegex = /<([A-Za-z0-9:_-]*:?(?:termEntry|conceptEntry))\b[^>]*>([\s\S]*?)<\/\1>/g;
  for (const match of text.matchAll(entryRegex)) {
    const tag = localName(match[1] ?? "");
    if (tag !== "termEntry" && tag !== "conceptEntry") continue;
    const body = match[2] ?? "";
    const sources = collectTermsForLang(body, options.srcLang);
    const targets = collectTermsForLang(body, options.tgtLang);
    const note = decodeXml(body.match(/<[^>/:\s]*:?(?:descrip|note)\b[^>]*>([\s\S]*?)<\/[^>/:\s]*:?(?:descrip|note)>/)?.[1] ?? "");
    for (const source of sources) {
      for (const target of targets) {
        pairs.push({ source, target, note: note || undefined });
      }
    }
  }
  return pairs;
}

async function persistTerms(
  workspaceRoot: string,
  options: {
    projectId: string;
    rows: Array<{ source: string; target: string; note?: string; conceptId?: number; fields?: Record<string, string[]>; rowNo: number; sheetName?: string }>;
    sourceFile: string;
    origin: TermbaseEntry["origin"];
    srcLang?: string;
    tgtLang?: string;
    append?: boolean;
  },
): Promise<TermbaseImportResult> {
  const locales = await readProjectLocalePair(workspaceRoot, options.projectId, {
    sourceLanguage: options.srcLang,
    targetLanguage: options.tgtLang,
  });
  const path = termbasePath(workspaceRoot, options.projectId);
  const existing = options.append ? await readTermbaseEntries(workspaceRoot, options.projectId) : [];
  const seen = new Set(existing.map((entry) => `${entry.source}\u0000${entry.target}\u0000${entry.sourceFile}\u0000${entry.rowNo}`));
  const entries: TermbaseEntry[] = [];
  let skipped = 0;
  for (const row of options.rows) {
    const source = row.source.trim();
    const target = row.target.trim();
    if (!source || !target) {
      skipped += 1;
      continue;
    }
    const key = `${source}\u0000${target}\u0000${options.sourceFile}\u0000${row.rowNo}`;
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    entries.push({
      id: `tb-${existing.length + entries.length + 1}`,
      source,
      target,
      srcLang: locales.sourceLanguage,
      tgtLang: locales.targetLanguage,
      note: row.note,
      conceptId: row.conceptId,
      fields: row.fields,
      sourceFile: options.sourceFile,
      sheetName: row.sheetName,
      rowNo: row.rowNo,
      origin: options.origin,
    });
  }
  await writeTermbaseEntries(workspaceRoot, options.projectId, [...existing, ...entries], existing);
  return {
    projectId: options.projectId,
    imported: entries.length,
    skipped,
    path,
    sample: entries.slice(0, 5),
    warnings: entries.length ? [] : ["No source/target term pairs were imported."],
  };
}

function normTerm(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function termGroupKey(entry: { source: string; srcLang?: string; tgtLang?: string }): string {
  return `${normTerm(entry.source)}\u0000${entry.srcLang ?? ""}\u0000${entry.tgtLang ?? ""}`;
}

function targetKey(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function overrideKey(override: TermbaseOverride): string {
  return termGroupKey(override);
}

function overrideMatchesEntry(override: TermbaseOverride, entry: { source: string; srcLang?: string; tgtLang?: string }): boolean {
  if (normTerm(override.source) !== normTerm(entry.source)) return false;
  if (override.srcLang && entry.srcLang && !localesMatch(override.srcLang, entry.srcLang)) return false;
  if (override.tgtLang && entry.tgtLang && !localesMatch(override.tgtLang, entry.tgtLang)) return false;
  return true;
}

function overrideToEntry(
  override: TermbaseOverride,
  index: number,
  sourceFile: string,
  locales: { sourceLanguage: string; targetLanguage: string },
): TermbaseEntry {
  return {
    id: `override-${index + 1}`,
    source: override.source,
    target: override.target,
    srcLang: override.srcLang ?? locales.sourceLanguage,
    tgtLang: override.tgtLang ?? locales.targetLanguage,
    note: [override.reason, override.decidedBy ? `Decided by: ${override.decidedBy}` : undefined, override.ts].filter(Boolean).join(" | "),
    sourceFile,
    rowNo: index + 1,
    origin: "manual",
  };
}

function historyForEntry(entry: TermbaseEntry, history?: TermHistoryIndex): TermHistoryDecision | undefined {
  if (!history?.decisions.length) return undefined;
  const source = normTerm(entry.source);
  const target = normTerm(entry.target);
  return history.decisions.find((decision) => {
    if (normTerm(decision.source) !== source) return false;
    if (decision.target && normTerm(decision.target) === target) return true;
    if (decision.deprecatedTargets?.some((item) => normTerm(item) === target)) return true;
    if (decision.conflictTargets?.some((item) => normTerm(item) === target)) return true;
    return false;
  });
}

function authorityTierForHistory(decision?: TermHistoryDecision): TermbaseConflict["entries"][number]["authorityTier"] {
  if (!decision) return "local_termbase";
  if (decision.status === "current") return "term_history_current";
  if (decision.status === "deprecated" || decision.status === "deleted" || decision.status === "pending" || decision.status === "unconfirmed_later_row") return "term_history_deprecated";
  return "term_history_conflict";
}

export function auditTermbaseConflicts(entries: TermbaseEntry[], overrides: TermbaseOverride[] = [], history?: TermHistoryIndex): TermbaseConflict[] {
  const overrideKeys = new Set(overrides.map(overrideKey));
  const groups = new Map<string, TermbaseEntry[]>();
  for (const entry of entries) {
    const key = termGroupKey(entry);
    const bucket = groups.get(key) ?? [];
    bucket.push(entry);
    groups.set(key, bucket);
  }
  const conflicts: TermbaseConflict[] = [];
  for (const [key, group] of groups.entries()) {
    if (overrideKeys.has(key)) continue;
    const targets = Array.from(new Map(group.map((entry) => [targetKey(entry.target), entry.target])).values());
    if (targets.length <= 1) continue;
    conflicts.push({
      source: group[0]?.source ?? "",
      srcLang: group[0]?.srcLang,
      tgtLang: group[0]?.tgtLang,
      targets,
      entries: group.map((entry) => {
        const historyDecision = historyForEntry(entry, history);
        return {
          id: entry.id,
          source: entry.source,
          target: entry.target,
          sourceFile: entry.sourceFile,
          sheetName: entry.sheetName,
          rowNo: entry.rowNo,
          note: entry.note,
          historyStatus: historyDecision?.status,
          historyReason: historyDecision?.reason,
          historyRows: historyDecision?.evidenceRows,
          authorityTier: authorityTierForHistory(historyDecision),
        };
      }),
    });
  }
  return conflicts.sort((a, b) => a.source.localeCompare(b.source));
}

export function resolvePreferredTermbaseEntries(
  entries: Array<{ source: string; target: string; srcLang?: string; tgtLang?: string; note?: string }>,
  overrides: TermbaseOverride[] = [],
): Array<{ source: string; target: string; srcLang?: string; tgtLang?: string; note?: string }> {
  const groups = new Map<string, Array<{ source: string; target: string; srcLang?: string; tgtLang?: string; note?: string }>>();
  for (const entry of entries) {
    const key = termGroupKey(entry);
    const bucket = groups.get(key) ?? [];
    bucket.push(entry);
    groups.set(key, bucket);
  }
  const preferred: Array<{ source: string; target: string; srcLang?: string; tgtLang?: string; note?: string }> = [];
  const usedOverrideKeys = new Set<string>();
  for (const [key, group] of groups.entries()) {
    const override = overrides.find((candidate) => overrideKey(candidate) === key || group.some((entry) => overrideMatchesEntry(candidate, entry)));
    if (override) {
      usedOverrideKeys.add(overrideKey(override));
      preferred.push({
        source: override.source,
        target: override.target,
        srcLang: override.srcLang ?? group[0]?.srcLang,
        tgtLang: override.tgtLang ?? group[0]?.tgtLang,
        note: override.reason,
      });
      continue;
    }
    const targets = new Set(group.map((entry) => targetKey(entry.target)));
    if (targets.size === 1 && group[0]) preferred.push(group[0]);
  }
  for (const override of overrides) {
    if (usedOverrideKeys.has(overrideKey(override))) continue;
    preferred.push({
      source: override.source,
      target: override.target,
      srcLang: override.srcLang,
      tgtLang: override.tgtLang,
      note: override.reason,
    });
  }
  return preferred;
}

export async function importTermbaseTable(
  workspaceRoot: string,
  options: {
    projectId: string;
    assetPath: string;
    sheetName?: string;
    sourceColumn: string;
    targetColumn: string;
    noteColumn?: string;
    srcLang?: string;
    tgtLang?: string;
    append?: boolean;
  },
): Promise<TermbaseImportResult> {
  const resolvedPath = await resolveProjectPath(workspaceRoot, options.projectId, options.assetPath);
  const rows = await extractMappedRows(workspaceRoot, options);
  return persistTerms(workspaceRoot, {
    projectId: options.projectId,
    rows,
    sourceFile: resolvedPath,
    origin: "table",
    srcLang: options.srcLang,
    tgtLang: options.tgtLang,
    append: options.append,
  });
}

export async function importTbxTermbase(
  workspaceRoot: string,
  options: { projectId: string; assetPath: string; srcLang?: string; tgtLang?: string; append?: boolean },
): Promise<TermbaseImportResult> {
  const resolvedPath = await resolveProjectPath(workspaceRoot, options.projectId, options.assetPath);
  const ext = extname(resolvedPath).toLocaleLowerCase();
  if (ext !== ".tbx") {
    throw new Error(`TBX import expects .tbx. SDLTB binary import is not implemented in LA yet; export TBX or table first. Received ${ext || "unknown"}.`);
  }
  const text = await readFile(resolvedPath, "utf8");
  const locales = await readProjectLocalePair(workspaceRoot, options.projectId, {
    sourceLanguage: options.srcLang,
    targetLanguage: options.tgtLang,
  });
  const pairs = parseTbxPairs(text, { srcLang: locales.sourceLanguage, tgtLang: locales.targetLanguage });
  return persistTerms(workspaceRoot, {
    projectId: options.projectId,
    rows: pairs.map((pair, index) => ({ ...pair, rowNo: index + 1 })),
    sourceFile: resolvedPath,
    origin: "tbx",
    srcLang: options.srcLang,
    tgtLang: options.tgtLang,
    append: options.append,
  });
}

export async function importSdltbTermbase(
  workspaceRoot: string,
  options: { projectId: string; assetPath: string; srcLang?: string; tgtLang?: string; append?: boolean },
): Promise<TermbaseImportResult & { sourceTable: string; targetTable: string }> {
  const resolvedPath = await resolveProjectPath(workspaceRoot, options.projectId, options.assetPath);
  const ext = extname(resolvedPath).toLocaleLowerCase();
  if (ext !== ".sdltb") {
    throw new Error(`SDLTB import expects .sdltb. Received ${ext || "unknown"}.`);
  }
  const locales = await readProjectLocalePair(workspaceRoot, options.projectId, {
    sourceLanguage: options.srcLang,
    targetLanguage: options.tgtLang,
  });
  const srcLang = locales.sourceLanguage;
  const tgtLang = locales.targetLanguage;
  const tables = await listSdltbTables(resolvedPath);
  const sourceTable = sdltbTableForLang(tables, srcLang);
  const targetTable = sdltbTableForLang(tables, tgtLang);
  const sourceTerms = parseSdltbIndexCsv(await exportSdltbTable(resolvedPath, sourceTable));
  const targetTerms = parseSdltbIndexCsv(await exportSdltbTable(resolvedPath, targetTable));
  const conceptMeta = tables.includes("mtConcepts")
    ? parseSdltbConceptsCsv(await exportSdltbTable(resolvedPath, "mtConcepts"))
    : new Map<number, SdltbConceptMeta>();
  const pairs = pairsFromSdltbIndexes(sourceTerms, targetTerms);
  const result = await persistTerms(workspaceRoot, {
    projectId: options.projectId,
    rows: pairs.map((pair, index) => ({
      source: pair.source,
      target: pair.target,
      conceptId: pair.conceptId,
      fields: conceptMeta.get(pair.conceptId)?.fields,
      note: [`SDLTB concept ${pair.conceptId}; ${sourceTable} -> ${targetTable}`, ...(conceptMeta.get(pair.conceptId)?.descriptions ?? [])].join(" | "),
      rowNo: index + 1,
    })),
    sourceFile: resolvedPath,
    origin: "sdltb",
    srcLang,
    tgtLang,
    append: options.append,
  });
  return { ...result, sourceTable, targetTable };
}

export async function readTermbaseEntries(workspaceRoot: string, projectId: string): Promise<TermbaseEntry[]> {
  const persistence = catCorePersistenceFor(workspaceRoot);
  if (persistence) return (await persistence.readTermbase(projectId)).entries;
  const cached = await readCatCoreReadCache<{ entries: TermbaseEntry[]; overrides: TermbaseOverride[] }>(workspaceRoot, "termbase", projectId);
  if (cached) return cached.entries;
  await assertCatCoreLegacyAllowed(workspaceRoot);
  return readJsonFile<TermbaseEntry[]>(termbasePath(workspaceRoot, projectId), []);
}

export async function readTermbaseOverrides(workspaceRoot: string, projectId: string): Promise<TermbaseOverride[]> {
  const persistence = catCorePersistenceFor(workspaceRoot);
  if (persistence) return (await persistence.readTermbase(projectId)).overrides;
  const cached = await readCatCoreReadCache<{ entries: TermbaseEntry[]; overrides: TermbaseOverride[] }>(workspaceRoot, "termbase", projectId);
  if (cached) return cached.overrides;
  await assertCatCoreLegacyAllowed(workspaceRoot);
  return readJsonFile<TermbaseOverride[]>(termbaseOverridesPath(workspaceRoot, projectId), []);
}

export async function writeTermbaseEntries(
  workspaceRoot: string,
  projectId: string,
  entries: TermbaseEntry[],
  expected: TermbaseEntry[] | null,
): Promise<void> {
  const persistence = catCorePersistenceFor(workspaceRoot);
  if (persistence) {
    const current = await persistence.readTermbase(projectId);
    await persistence.writeTermbase(projectId, { entries, overrides: current.overrides }, expected === null ? null : { entries: expected, overrides: current.overrides });
    return;
  }
  await assertCatCoreLegacyAllowed(workspaceRoot);
  await writeJsonFile(termbasePath(workspaceRoot, projectId), entries);
}

export async function writeTermbaseOverrides(workspaceRoot: string, projectId: string, overrides: TermbaseOverride[]): Promise<TermbaseOverride[]> {
  const persistence = catCorePersistenceFor(workspaceRoot);
  if (persistence) {
    const current = await persistence.readTermbase(projectId);
    await persistence.writeTermbase(projectId, { entries: current.entries, overrides }, current);
    return overrides;
  }
  await assertCatCoreLegacyAllowed(workspaceRoot);
  await writeJsonFile(termbaseOverridesPath(workspaceRoot, projectId), overrides);
  return overrides;
}

export async function upsertTermbaseOverride(
  workspaceRoot: string,
  projectId: string,
  override: TermbaseOverride,
): Promise<{ override: TermbaseOverride; total: number; path: string }> {
  const [existing, locales] = await Promise.all([
    readTermbaseOverrides(workspaceRoot, projectId),
    readProjectLocalePair(workspaceRoot, projectId, {
      sourceLanguage: override.srcLang,
      targetLanguage: override.tgtLang,
    }),
  ]);
  const normalized = {
    ...override,
    source: override.source.trim(),
    target: override.target.trim(),
    srcLang: locales.sourceLanguage,
    tgtLang: locales.targetLanguage,
    ts: override.ts ?? new Date().toISOString(),
  };
  if (!normalized.source || !normalized.target) throw new Error("Termbase override requires non-empty source and target.");
  const index = existing.findIndex((candidate) => overrideKey(candidate) === overrideKey(normalized));
  const next = [...existing];
  if (index >= 0) next[index] = normalized;
  else next.push(normalized);
  await writeTermbaseOverrides(workspaceRoot, projectId, next);
  return { override: normalized, total: next.length, path: termbaseOverridesPath(workspaceRoot, projectId) };
}

export async function readPreferredTermbaseEntries(workspaceRoot: string, projectId: string): Promise<Array<{ source: string; target: string; srcLang?: string; tgtLang?: string; note?: string }>> {
  const [entries, overrides, termHistory, workflowArtifacts, manifest] = await Promise.all([
    readTermbaseEntries(workspaceRoot, projectId),
    readTermbaseOverrides(workspaceRoot, projectId),
    readTermHistoryIndex(workspaceRoot, projectId),
    readJsonFile<Partial<{ authorityDecisions: WorkflowAuthorityDecision[] }>>(workflowArtifactsPath(workspaceRoot, projectId), {}),
    readProjectManifest(workspaceRoot, projectId).catch(() => null),
  ]);
  const promoted = promoteTermHistoryEntries(termHistory.decisions, workflowArtifacts.authorityDecisions ?? []);
  const historyOverrides: TermbaseOverride[] = promoted.map((entry) => ({
    source: entry.source,
    target: entry.target,
    reason: entry.note,
    srcLang: manifest?.sourceLanguage,
    tgtLang: manifest?.targetLanguage,
  }));
  const normalizedOverrides = overrides.map((override) => ({
    ...override,
    srcLang: override.srcLang ?? manifest?.sourceLanguage,
    tgtLang: override.tgtLang ?? manifest?.targetLanguage,
  }));
  return resolvePreferredTermbaseEntries(entries, [...normalizedOverrides, ...historyOverrides]);
}

export async function lookupTermbase(
  workspaceRoot: string,
  options: { projectId: string; term: string; srcLang?: string; tgtLang?: string; limit?: number },
): Promise<TermbaseMatch[]> {
  const [entries, overrides, locales] = await Promise.all([
    readTermbaseEntries(workspaceRoot, options.projectId),
    readTermbaseOverrides(workspaceRoot, options.projectId),
    readProjectLocalePair(workspaceRoot, options.projectId, {
      sourceLanguage: options.srcLang,
      targetLanguage: options.tgtLang,
    }),
  ]);
  const query = options.term.trim().toLocaleLowerCase();
  if (!query) return [];
  const conflictByKey = new Map(auditTermbaseConflicts(entries, overrides).map((conflict) => [termGroupKey(conflict), conflict]));
  const matches: TermbaseMatch[] = [];
  for (const [index, override] of overrides.entries()) {
    if (override.srcLang && !localesMatch(override.srcLang, locales.sourceLanguage)) continue;
    if (override.tgtLang && !localesMatch(override.tgtLang, locales.targetLanguage)) continue;
    const source = override.source.toLocaleLowerCase();
    if (source === query) matches.push({ ...overrideToEntry(override, index, termbaseOverridesPath(workspaceRoot, options.projectId), locales), matchType: "exact", resolution: "override" });
    else if (source.includes(query) || query.includes(source)) {
      matches.push({ ...overrideToEntry(override, index, termbaseOverridesPath(workspaceRoot, options.projectId), locales), matchType: "contains", resolution: "override" });
    }
  }
  for (const entry of entries) {
    if (!localesMatch(entry.srcLang, locales.sourceLanguage)) continue;
    if (!localesMatch(entry.tgtLang, locales.targetLanguage)) continue;
    const source = entry.source.toLocaleLowerCase();
    const override = overrides.find((candidate) => overrideMatchesEntry(candidate, entry));
    const conflict = conflictByKey.get(termGroupKey(entry));
    const resolution: TermbaseMatch["resolution"] = override ? "overridden" : conflict ? "conflict" : "preferred";
    const extra = {
      resolution,
      conflictTargets: conflict?.targets,
      overriddenBy: override?.target,
    };
    if (source === query) matches.push({ ...entry, matchType: "exact", ...extra });
    else if (source.includes(query) || query.includes(source)) matches.push({ ...entry, matchType: "contains", ...extra });
  }
  return matches.slice(0, options.limit ?? 10);
}
