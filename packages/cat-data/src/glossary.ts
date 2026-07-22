import { readFile } from "node:fs/promises";
import { extname, isAbsolute, resolve } from "node:path";
import { readProjectManifest } from "./project_manifest.js";
import { createWorkspace, readJsonFile, workspacePath, writeJsonFile } from "./workspace.js";

export interface GlossaryEntry {
  id: string;
  source: string;
  target: string;
  note?: string;
  sourceFile: string;
  rowNo: number;
}

export interface GlossaryImportResult {
  projectId: string;
  imported: number;
  skipped: number;
  path: string;
  sample: GlossaryEntry[];
  warnings: string[];
}

export interface GlossaryMatch extends GlossaryEntry {
  matchType: "exact" | "contains";
}

/**
 * Glossary rows remain readable evidence, but duplicate source terms with
 * competing targets cannot silently become binding QA authority.
 */
export function resolvePreferredGlossaryEntries(entries: GlossaryEntry[]): GlossaryEntry[] {
  const groups = new Map<string, GlossaryEntry[]>();
  for (const entry of entries) {
    const key = entry.source.trim().toLocaleLowerCase();
    if (!key) continue;
    const bucket = groups.get(key) ?? [];
    bucket.push(entry);
    groups.set(key, bucket);
  }
  return Array.from(groups.values()).flatMap((group) => {
    const targets = new Set(group.map((entry) => entry.target.trim()).filter(Boolean));
    return targets.size === 1 && group[0] ? [group[0]] : [];
  });
}

export async function readPreferredGlossaryEntries(workspaceRoot: string, projectId: string): Promise<GlossaryEntry[]> {
  return resolvePreferredGlossaryEntries(await readJsonFile<GlossaryEntry[]>(glossaryPath(workspaceRoot, projectId), []));
}

export function glossaryPath(workspaceRoot: string, projectId: string): string {
  return workspacePath(createWorkspace(workspaceRoot, projectId), "glossary.json");
}

async function resolveProjectPath(workspaceRoot: string, projectId: string, path: string): Promise<string> {
  if (isAbsolute(path)) return path;
  const manifest = await readProjectManifest(workspaceRoot, projectId);
  return resolve(manifest.root, path);
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
    if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) continue;
    const cells = trimmed
      .slice(1, -1)
      .split("|")
      .map((cell) => cell.trim());
    if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;
    rows.push(cells);
  }
  return rows;
}

function parseRows(text: string, ext: string): string[][] {
  if (ext === ".md") {
    const table = parseMarkdownTable(text);
    if (table.length) return table;
  }
  const delimiter = ext === ".tsv" ? "\t" : ",";
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => splitDelimitedLine(line, delimiter));
}

function indexOfColumn(headers: string[], names: string[], fallback: number): number {
  const normalized = headers.map((header) => header.trim().toLocaleLowerCase());
  for (const name of names) {
    const index = normalized.findIndex((header) => header.includes(name));
    if (index >= 0) return index;
  }
  return fallback;
}

export async function importGlossaryTable(
  workspaceRoot: string,
  options: {
    projectId: string;
    assetPath: string;
    sourceColumn?: string;
    targetColumn?: string;
    noteColumn?: string;
    append?: boolean;
  },
): Promise<GlossaryImportResult> {
  const path = await resolveProjectPath(workspaceRoot, options.projectId, options.assetPath);
  const ext = extname(path).toLocaleLowerCase();
  if (![".md", ".txt", ".csv", ".tsv"].includes(ext)) {
    throw new Error(`Glossary import currently supports md/txt/csv/tsv. Received ${ext || "unknown"}; use a mapping preview/export first.`);
  }
  const text = await readFile(path, "utf8");
  const rows = parseRows(text, ext);
  const warnings: string[] = [];
  if (!rows.length) throw new Error(`No glossary-like rows found in ${path}.`);

  const headers = rows[0];
  const hasHeader = headers.some((cell) => /source|term|zh|中文|target|en|英文|translation/i.test(cell));
  const inferredSourceIndex = hasHeader ? indexOfColumn(headers, ["source", "src", "term", "zh", "中文", "原文"], 0) : 0;
  const inferredTargetIndex = hasHeader
    ? indexOfColumn(headers, ["target", "tgt", "translation", "english", "en", "英文", "译文"], 1)
    : 1;
  let sourceIndex = inferredSourceIndex;
  let targetIndex = inferredTargetIndex;
  if (options.sourceColumn) {
    const explicit = headers.indexOf(options.sourceColumn);
    if (explicit >= 0) sourceIndex = explicit;
    else warnings.push(`sourceColumn '${options.sourceColumn}' not found; inferred '${headers[sourceIndex] ?? sourceIndex}'.`);
  }
  if (options.targetColumn) {
    const explicit = headers.indexOf(options.targetColumn);
    if (explicit >= 0) targetIndex = explicit;
    else warnings.push(`targetColumn '${options.targetColumn}' not found; inferred '${headers[targetIndex] ?? targetIndex}'.`);
  }
  const noteIndex = options.noteColumn ? headers.indexOf(options.noteColumn) : -1;

  if (sourceIndex < 0 || targetIndex < 0) {
    throw new Error(`Column mapping failed for ${path}. Provide sourceColumn and targetColumn explicitly.`);
  }

  const dataRows = hasHeader ? rows.slice(1) : rows;
  const existing = options.append ? await readJsonFile<GlossaryEntry[]>(glossaryPath(workspaceRoot, options.projectId), []) : [];
  const entries: GlossaryEntry[] = [];
  let skipped = 0;
  for (const [rowOffset, row] of dataRows.entries()) {
    const source = (row[sourceIndex] ?? "").trim();
    const target = (row[targetIndex] ?? "").trim();
    if (!source || !target) {
      skipped += 1;
      continue;
    }
    entries.push({
      id: `${entries.length + existing.length + 1}`,
      source,
      target,
      note: noteIndex >= 0 ? row[noteIndex] : undefined,
      sourceFile: path,
      rowNo: rowOffset + (hasHeader ? 2 : 1),
    });
  }
  if (!entries.length) warnings.push("No non-empty source/target pairs were imported.");
  const combined = [...existing, ...entries];
  const output = glossaryPath(workspaceRoot, options.projectId);
  await writeJsonFile(output, combined);
  return {
    projectId: options.projectId,
    imported: entries.length,
    skipped,
    path: output,
    sample: entries.slice(0, 5),
    warnings,
  };
}

export async function lookupGlossary(
  workspaceRoot: string,
  options: { projectId: string; term: string; limit?: number },
): Promise<GlossaryMatch[]> {
  const limit = options.limit ?? 10;
  const entries = await readJsonFile<GlossaryEntry[]>(glossaryPath(workspaceRoot, options.projectId), []);
  const term = options.term.trim().toLocaleLowerCase();
  if (!term) return [];
  const matches: GlossaryMatch[] = [];
  for (const entry of entries) {
    const source = entry.source.toLocaleLowerCase();
    if (source === term) matches.push({ ...entry, matchType: "exact" });
    else if (source.includes(term) || term.includes(source)) matches.push({ ...entry, matchType: "contains" });
  }
  return matches.slice(0, limit);
}
