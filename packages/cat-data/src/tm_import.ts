import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, resolve } from "node:path";
import { createTmStore, type TmBulkImportResult } from "./tm.js";
import { createWorkspace } from "./workspace.js";
import { readProjectLocalePair, readProjectManifest } from "./project_manifest.js";
import { extractMappedRows } from "./workbook_mapping.js";

export interface TmImportRow {
  source: string;
  target: string;
  note?: string;
  rowNo: number;
}

export interface TmImportResult extends TmBulkImportResult {
  projectId: string;
  sourceFile: string;
  warnings: string[];
}

async function resolveProjectPath(workspaceRoot: string, projectId: string, assetPath: string): Promise<string> {
  if (isAbsolute(assetPath)) return assetPath;
  const manifest = await readProjectManifest(workspaceRoot, projectId);
  return resolve(manifest.root, assetPath);
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

function decodeSdlSegment(value: string): string {
  const values = Array.from(value.matchAll(/<Value\b[^>]*>([\s\S]*?)<\/Value>/g), (match) => decodeXml(match[1] ?? "")).filter(Boolean);
  return values.length ? values.join("") : decodeXml(value);
}

function langMatches(value: string, expected: string): boolean {
  if (!value || !expected) return false;
  const actual = value.toLocaleLowerCase();
  const want = expected.toLocaleLowerCase();
  return actual === want || actual.split("-", 1)[0] === want.split("-", 1)[0];
}

function localName(tag: string): string {
  return tag.includes(":") ? tag.split(":").pop() ?? tag : tag;
}

function collectTuvSegments(tuXml: string): Array<{ lang: string; text: string }> {
  const segments: Array<{ lang: string; text: string }> = [];
  const tuvRegex = /<([A-Za-z0-9:_-]*:?tuv)\b([^>]*)>([\s\S]*?)<\/\1>/g;
  for (const match of tuXml.matchAll(tuvRegex)) {
    if (localName(match[1] ?? "") !== "tuv") continue;
    const attrs = match[2] ?? "";
    const lang = attrs.match(/(?:xml:lang|lang)="([^"]+)"/)?.[1] ?? "";
    const body = match[3] ?? "";
    const seg = body.match(/<[^>/:\s]*:?seg\b[^>]*>([\s\S]*?)<\/[^>/:\s]*:?seg>/)?.[1] ?? "";
    const text = decodeXml(seg);
    if (lang && text) segments.push({ lang, text });
  }
  return segments;
}

export function parseTmxRows(text: string, options: { srcLang: string; tgtLang: string }): TmImportRow[] {
  if (!/<(?:[^:>\s]+:)?tmx\b/i.test(text)) {
    throw new Error("TMX root not found. Expected <tmx>.");
  }
  const rows: TmImportRow[] = [];
  const tuRegex = /<([A-Za-z0-9:_-]*:?tu)\b[^>]*>([\s\S]*?)<\/\1>/g;
  for (const [index, match] of Array.from(text.matchAll(tuRegex)).entries()) {
    if (localName(match[1] ?? "") !== "tu") continue;
    const segments = collectTuvSegments(match[2] ?? "");
    const sources = segments.filter((segment) => langMatches(segment.lang, options.srcLang));
    const targets = segments.filter((segment) => langMatches(segment.lang, options.tgtLang));
    for (const source of sources) {
      for (const target of targets) {
        rows.push({ source: source.text, target: target.text, rowNo: index + 1 });
      }
    }
  }
  return rows;
}

interface SdltmSqlRow {
  rowNo: number;
  source: string;
  target: string;
  srcLang: string;
  tgtLang: string;
}

function sqliteJsonRows(path: string, sql: string): SdltmSqlRow[] {
  let stdout = "";
  try {
    stdout = execFileSync("sqlite3", ["-readonly", "-json", path, sql], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`SDLTM import failed to read SQLite database via sqlite3: ${message}`);
  }
  if (!stdout.trim()) return [];
  try {
    return JSON.parse(stdout) as SdltmSqlRow[];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`SDLTM import failed to parse sqlite3 JSON output: ${message}`);
  }
}

export function parseSdltmRows(path: string, options: { srcLang: string; tgtLang: string }): TmImportRow[] {
  const rows = sqliteJsonRows(
    path,
    `
select
  tu.id as rowNo,
  tu.source_segment as source,
  tu.target_segment as target,
  tm.source_language as srcLang,
  tm.target_language as tgtLang
from translation_units tu
join translation_memories tm on tm.id = tu.translation_memory_id
where coalesce(tu.source_segment, '') <> ''
  and coalesce(tu.target_segment, '') <> ''
order by tu.id
`.trim(),
  );
  return rows
    .filter((row) => langMatches(row.srcLang ?? "", options.srcLang) && langMatches(row.tgtLang ?? "", options.tgtLang))
    .map((row) => ({
      source: decodeSdlSegment(row.source ?? ""),
      target: decodeSdlSegment(row.target ?? ""),
      note: `SDLTM ${row.srcLang}->${row.tgtLang}`,
      rowNo: Number(row.rowNo) || 0,
    }))
    .filter((row) => row.source && row.target);
}

async function persistTmRows(
  workspaceRoot: string,
  options: {
    projectId: string;
    rows: TmImportRow[];
    sourceFile: string;
    srcLang?: string;
    tgtLang?: string;
    append?: boolean;
  },
): Promise<TmImportResult> {
  const locales = await readProjectLocalePair(workspaceRoot, options.projectId, {
    sourceLanguage: options.srcLang,
    targetLanguage: options.tgtLang,
  });
  const srcLang = locales.sourceLanguage;
  const tgtLang = locales.targetLanguage;
  const store = createTmStore(createWorkspace(workspaceRoot, options.projectId));
  const result = await store.importClientEntries(
    options.rows.map((row) => ({
      source: row.source,
      target: row.target,
      srcLang,
      tgtLang,
      origin: "client_tm",
      quality: 100,
      project: options.projectId,
      note: [row.note, `${options.sourceFile}:${row.rowNo}`].filter(Boolean).join(" | "),
    })),
    { append: options.append, srcLang, tgtLang, project: options.projectId },
  );
  return {
    ...result,
    projectId: options.projectId,
    sourceFile: options.sourceFile,
    warnings: result.imported + result.updated + result.unchanged > 0 ? [] : ["No source/target TM rows were imported."],
  };
}

export async function importTmxMemory(
  workspaceRoot: string,
  options: { projectId: string; assetPath: string; srcLang?: string; tgtLang?: string; append?: boolean },
): Promise<TmImportResult> {
  const resolvedPath = await resolveProjectPath(workspaceRoot, options.projectId, options.assetPath);
  const ext = extname(resolvedPath).toLocaleLowerCase();
  if (ext !== ".tmx") throw new Error(`TMX import expects .tmx. Received ${ext || "unknown"}.`);
  const locales = await readProjectLocalePair(workspaceRoot, options.projectId, {
    sourceLanguage: options.srcLang,
    targetLanguage: options.tgtLang,
  });
  const srcLang = locales.sourceLanguage;
  const tgtLang = locales.targetLanguage;
  const rows = parseTmxRows(await readFile(resolvedPath, "utf8"), { srcLang, tgtLang });
  return persistTmRows(workspaceRoot, {
    projectId: options.projectId,
    rows,
    sourceFile: resolvedPath,
    srcLang,
    tgtLang,
    append: options.append,
  });
}

export async function importSdltmMemory(
  workspaceRoot: string,
  options: { projectId: string; assetPath: string; srcLang?: string; tgtLang?: string; append?: boolean },
): Promise<TmImportResult> {
  const resolvedPath = await resolveProjectPath(workspaceRoot, options.projectId, options.assetPath);
  const ext = extname(resolvedPath).toLocaleLowerCase();
  if (ext !== ".sdltm") throw new Error(`SDLTM import expects .sdltm. Received ${ext || "unknown"}.`);
  const locales = await readProjectLocalePair(workspaceRoot, options.projectId, {
    sourceLanguage: options.srcLang,
    targetLanguage: options.tgtLang,
  });
  const srcLang = locales.sourceLanguage;
  const tgtLang = locales.targetLanguage;
  const rows = parseSdltmRows(resolvedPath, { srcLang, tgtLang });
  return persistTmRows(workspaceRoot, {
    projectId: options.projectId,
    rows,
    sourceFile: resolvedPath,
    srcLang,
    tgtLang,
    append: options.append,
  });
}

export async function importTmTable(
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
): Promise<TmImportResult> {
  const resolvedPath = await resolveProjectPath(workspaceRoot, options.projectId, options.assetPath);
  const rows = await extractMappedRows(workspaceRoot, options);
  return persistTmRows(workspaceRoot, {
    projectId: options.projectId,
    rows,
    sourceFile: resolvedPath,
    srcLang: options.srcLang,
    tgtLang: options.tgtLang,
    append: options.append,
  });
}
