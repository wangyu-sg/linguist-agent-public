import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, delimiter, extname, isAbsolute, join, resolve } from "node:path";
import JSZip from "jszip";
import { readProjectManifest } from "./project_manifest.js";
import { assetCacheDirName, readRuntimeCacheManifest, runtimeProjectCachePath, writeRuntimeCacheManifest } from "./runtime_storage.js";
import { planWorkbookAssetImport, type WorkbookAssetSheetOverride } from "./workbook_asset_plan.js";
import { previewWorkbookMapping, suggestWorkbookMappingCandidates } from "./workbook_mapping.js";
import {
  authorityTierForWorkbookAction,
  type AssetColumnMapping,
  type AssetConfirmedMapping,
  type AssetMappingPurpose,
  type AssetMappingSuggestion,
  type AssetMappingSuggestionResult,
  type AssetMinerUBlock,
  type AssetMinerUBlockType,
  type AssetParseComparison,
  type AssetParseMode,
  type AssetParsePreview,
  type AssetParsePreviewOptions,
  type AssetParseResult,
  type AssetStructuredSheet,
} from "./asset_ingestion_contract.js";

const MINERU_DEFAULT_ARGS = "-p {input} -o {output}";
const MINERU_CACHE_VERSION = 1;
const WORKBOOK_MAPPING_ROLES = [
  "termbase",
  "termbase_delta",
  "candidate_terms",
  "glossary",
  "style_guide",
  "project_requirements",
  "qa_reference",
  "issue_log",
  "checklist",
  "source_table",
  "reference",
] as const;

export type AskAssetMappingModel = (input: {
  prompt: string;
  parse: AssetParseResult;
  purpose: AssetMappingPurpose;
}) => Promise<string>;

async function resolveProjectPath(workspaceRoot: string, projectId: string, assetPath: string): Promise<string> {
  if (isAbsolute(assetPath)) return assetPath;
  const manifest = await readProjectManifest(workspaceRoot, projectId);
  return resolve(manifest.root, assetPath);
}

function splitArgs(template: string, input: string, output: string): string[] {
  return template
    .split(/\s+/)
    .filter(Boolean)
    .map((arg) => arg.replaceAll("{input}", input).replaceAll("{output}", output));
}

type MinerUCacheManifest = {
  version: number;
  sourcePath: string;
  size: number;
  mtimeMs: number;
  command: string;
  executable: string;
  argsTemplate: string;
  warnings: string[];
  createdAt: string;
};

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

async function fileIsAccessible(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveExecutable(command: string): Promise<string | undefined> {
  if (isAbsolute(command) || command.includes("/")) {
    return (await fileIsAccessible(command)) ? command : undefined;
  }
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, command);
    if (await fileIsAccessible(candidate)) return candidate;
  }
  return undefined;
}

function runCommand(command: string, args: string[], options: { timeoutMs: number; stdin?: string }): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${command} timed out after ${options.timeoutMs}ms.`));
    }, options.timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolvePromise({ stdout, stderr });
      } else {
        reject(new Error(`${command} exited with ${code ?? "unknown"}${stderr.trim() ? `: ${stderr.trim()}` : ""}`));
      }
    });
    if (options.stdin) child.stdin.write(options.stdin);
    child.stdin.end();
  });
}

async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry);
      const info = await stat(path).catch(() => undefined);
      if (!info) continue;
      if (info.isDirectory()) {
        await walk(path);
      } else {
        out.push(path);
      }
    }
  }
  await walk(root);
  return out;
}

function blockTypeForMarkdown(chunk: string): AssetMinerUBlockType {
  const trimmed = chunk.trim();
  if (/^#{1,6}\s/m.test(trimmed)) return "heading";
  if (/^\s*\|.+\|\s*$/m.test(trimmed)) return "table";
  if (/^\s*[-*]\s+/m.test(trimmed) || /^\s*\d+\.\s+/m.test(trimmed)) return "list";
  return trimmed ? "paragraph" : "unknown";
}

function blocksFromMarkdown(text: string, source: string): AssetMinerUBlock[] {
  const chunks = text
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  return chunks.map((chunk, index) => ({
    id: `${source}:block-${index + 1}`,
    blockType: blockTypeForMarkdown(chunk),
    text: chunk,
    source,
  }));
}

function blocksFromJson(value: unknown, source: string): AssetMinerUBlock[] {
  const blocks: AssetMinerUBlock[] = [];
  const pushText = (raw: unknown, indexHint: string, type: AssetMinerUBlockType = "unknown") => {
    if (typeof raw !== "string" || !raw.trim()) return;
    blocks.push({
      id: `${source}:${indexHint}`,
      blockType: type,
      text: raw.trim(),
      source,
    });
  };
  const visit = (node: unknown, path: string) => {
    if (!node) return;
    if (typeof node === "string") {
      pushText(node, path);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${path}-${index}`));
      return;
    }
    if (typeof node === "object") {
      const row = node as Record<string, unknown>;
      const blockType = typeof row.type === "string" ? row.type.toLocaleLowerCase() : typeof row.blockType === "string" ? row.blockType.toLocaleLowerCase() : "";
      const mappedType: AssetMinerUBlockType = ["heading", "paragraph", "table", "list", "image"].includes(blockType)
        ? blockType as AssetMinerUBlockType
        : "unknown";
      pushText(row.text ?? row.content ?? row.markdown, path, mappedType);
      for (const key of ["blocks", "children", "items", "tables", "pages"]) {
        if (key in row) visit(row[key], `${path}-${key}`);
      }
    }
  };
  visit(value, "json");
  return blocks;
}

async function readMinerUBlocks(outputDir: string): Promise<AssetMinerUBlock[]> {
  const files = (await listFiles(outputDir))
    .filter((file) => [".md", ".markdown", ".txt", ".json"].includes(extname(file).toLocaleLowerCase()))
    .sort((a, b) => {
      const extA = extname(a).toLocaleLowerCase();
      const extB = extname(b).toLocaleLowerCase();
      const priority = (ext: string) => ext === ".json" ? 1 : 0;
      return priority(extA) - priority(extB) || a.localeCompare(b);
    });
  const blocks: AssetMinerUBlock[] = [];
  for (const file of files) {
    const rel = file.slice(outputDir.length + 1);
    const ext = extname(file).toLocaleLowerCase();
    const raw = await readFile(file, "utf8");
    if (ext === ".json") {
      try {
        blocks.push(...blocksFromJson(JSON.parse(raw), rel));
      } catch {
        blocks.push(...blocksFromMarkdown(raw, rel));
      }
    } else {
      blocks.push(...blocksFromMarkdown(raw, rel));
    }
  }
  return blocks;
}

function mineruCacheKey(input: {
  resolvedPath: string;
  size: number;
  mtimeMs: number;
  command: string;
  executable: string;
  argsTemplate: string;
}): string {
  return createHash("sha1")
    .update(JSON.stringify({ version: MINERU_CACHE_VERSION, ...input }))
    .digest("hex")
    .slice(0, 10);
}

async function pruneSiblingMinerUCaches(mineruRoot: string, currentDir: string, assetName: string): Promise<void> {
  const prefix = `${assetName.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "asset"}-`;
  const entries = await readdir(mineruRoot, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isDirectory() || !entry.name.startsWith(prefix)) return;
    const path = join(mineruRoot, entry.name);
    if (path === currentDir) return;
    await rm(path, { recursive: true, force: true });
  }));
}

function worksheetPathForRelationships(path: string): string | undefined {
  const match = path.match(/^xl\/worksheets\/_rels\/(.+)\.rels$/);
  return match ? `xl/worksheets/${match[1]}` : undefined;
}

function stripHyperlinkRelationships(xml: string): { xml: string; ids: string[] } {
  const ids: string[] = [];
  const cleaned = xml.replace(/<Relationship\b(?=[^>]*relationships\/hyperlink)[^>]*\/>/g, (entry) => {
    const id = entry.match(/\bId="([^"]+)"/)?.[1];
    if (id) ids.push(id);
    return "";
  });
  return { xml: cleaned, ids };
}

function stripWorksheetHyperlinks(xml: string, ids: string[]): string {
  let cleaned = xml;
  for (const id of ids) {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    cleaned = cleaned.replace(new RegExp(`<hyperlink\\b(?=[^>]*\\br:id="${escaped}")[^>]*/>`, "g"), "");
  }
  return cleaned.replace(/<hyperlinks>\s*<\/hyperlinks>/g, "");
}

async function normalizedMinerUXlsxInput(inputPath: string, outputDir: string): Promise<{ path: string; warnings: string[] }> {
  if (extname(inputPath).toLocaleLowerCase() !== ".xlsx") return { path: inputPath, warnings: [] };
  const zip = await JSZip.loadAsync(await readFile(inputPath));
  let removed = 0;
  for (const name of Object.keys(zip.files)) {
    if (!name.startsWith("xl/worksheets/_rels/") || !name.endsWith(".rels")) continue;
    const file = zip.files[name];
    const relXml = await file.async("string");
    const stripped = stripHyperlinkRelationships(relXml);
    if (!stripped.ids.length) continue;
    removed += stripped.ids.length;
    zip.file(name, stripped.xml);
    const sheetPath = worksheetPathForRelationships(name);
    const sheetFile = sheetPath ? zip.files[sheetPath] : undefined;
    if (sheetPath && sheetFile) {
      zip.file(sheetPath, stripWorksheetHyperlinks(await sheetFile.async("string"), stripped.ids));
    }
  }
  if (!removed) return { path: inputPath, warnings: [] };
  const normalizedPath = join(outputDir, "mineru-input-normalized.xlsx");
  await writeFile(normalizedPath, await zip.generateAsync({ type: "nodebuffer" }));
  return {
    path: normalizedPath,
    warnings: [`MinerU input normalized: removed ${removed} external workbook hyperlink relationships from a temporary copy.`],
  };
}

function summarizeMinerUError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const jsonError = raw.match(/"error":\s*"([^"]+)"/)?.[1];
  if (jsonError) return jsonError.replace(/\\"/g, "\"");
  const valueError = raw.match(/(?:ValueError|TypeError|Error):[^\n]+/g)?.at(-1);
  if (valueError) return valueError;
  return raw.slice(0, 800);
}

function diagnosticsForSheet(sheet: Pick<AssetStructuredSheet, "headers" | "sampleRows" | "rowCount">): Array<{ label: string; value: string | number }> {
  return [
    { label: "headers", value: sheet.headers.filter(Boolean).length },
    { label: "sample rows", value: sheet.sampleRows.length },
    { label: "rows", value: sheet.rowCount },
  ];
}

export async function structuredAssetPreview(
  workspaceRoot: string,
  options: AssetParsePreviewOptions & { sheetOverrides?: WorkbookAssetSheetOverride[]; purpose?: AssetMappingPurpose },
): Promise<AssetParsePreview> {
  try {
    const [preview, plan, candidates] = await Promise.all([
      previewWorkbookMapping(workspaceRoot, {
        projectId: options.projectId,
        assetPath: options.assetPath,
        maxSheets: options.maxSheets ?? 12,
        sheetOffset: options.sheetOffset ?? 0,
        sampleRows: options.sampleRows ?? 5,
      }),
      planWorkbookAssetImport(workspaceRoot, {
        projectId: options.projectId,
        assetPath: options.assetPath,
        sampleRows: options.sampleRows ?? 5,
        sheetOverrides: options.sheetOverrides,
      }),
      suggestWorkbookMappingCandidates(workspaceRoot, {
        projectId: options.projectId,
        assetPath: options.assetPath,
        purpose: options.purpose === "tm" ? "tm" : options.purpose === "glossary" ? "glossary" : "termbase",
        maxSheets: options.maxSheets ?? 12,
        sheetOffset: options.sheetOffset ?? 0,
        sampleRows: Math.max(options.sampleRows ?? 8, 8),
        limit: 16,
      }),
    ]);
    const planBySheet = new Map(plan.sheets.map((sheet) => [sheet.sheetName, sheet]));
    const structuredSheets = preview.sheets.map((sheet): AssetStructuredSheet => {
      const sheetPlan = planBySheet.get(sheet.sheetName);
      const action = sheetPlan?.action ?? "needs_mapping";
      const needsColumnMapping = actionNeedsColumnMapping(action);
      return {
        sheetName: sheet.sheetName,
        role: sheetPlan?.role ?? "candidate_terms",
        action,
        authorityTier: authorityTierForWorkbookAction(action),
        rowCount: sheet.rowCount,
        headers: sheet.headers,
        sampleRows: sheet.sampleRows,
        engine: sheet.engine ?? preview.engine,
        suggested: needsColumnMapping ? sheet.suggested : {},
        confidence: sheet.confidence,
        reason: sheetPlan?.reason ?? sheet.reason,
        diagnostics: [
          ...diagnosticsForSheet(sheet),
          ...(sheetPlan?.diagnostics ?? []),
        ],
        warnings: sheetPlan?.warnings ?? [],
        mappingCandidates: needsColumnMapping ? candidates.candidates.filter((candidate) => candidate.sheetName === sheet.sheetName) : [],
        parserKind: sheetPlan?.parserKind,
        parserStatus: sheetPlan?.parserStatus,
        typedRowCount: sheetPlan?.typedRowCount,
        candidateCount: sheetPlan?.candidateCount,
        blockCount: sheetPlan?.blockCount,
        trace: sheetPlan?.trace,
      };
    });
    return {
      projectId: options.projectId,
      assetPath: options.assetPath,
      resolvedPath: preview.resolvedPath,
      mode: options.mode ?? "structured",
      parser: "structured",
      status: "ready",
      generatedAt: new Date().toISOString(),
      structuredSheets,
      structuredSheetCoverage: preview.sheetCoverage,
      warnings: [
        ...plan.warnings,
        ...(preview.sheetCoverage.hasMore
          ? [`Structured workbook preview shows ${preview.sheetCoverage.visibleSheets} visible sheets from ${preview.sheetCoverage.totalSheets} total; continue at sheetOffset=${preview.sheetCoverage.nextOffset} or use workbook_asset_plan before concluding the workbook is complete.`]
          : []),
      ],
    };
  } catch (error) {
    return {
      projectId: options.projectId,
      assetPath: options.assetPath,
      mode: options.mode ?? "structured",
      parser: "structured",
      status: "error",
      generatedAt: new Date().toISOString(),
      warnings: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function mineruAssetPreview(workspaceRoot: string, options: AssetParsePreviewOptions): Promise<AssetParsePreview> {
  const resolvedPath = await resolveProjectPath(workspaceRoot, options.projectId, options.assetPath);
  const command = options.mineruCommand ?? process.env.LA_MINERU_COMMAND ?? "mineru";
  const executable = await resolveExecutable(command);
  if (!executable) {
    return {
      projectId: options.projectId,
      assetPath: options.assetPath,
      resolvedPath,
      mode: options.mode ?? "mineru",
      parser: "mineru",
      status: "unavailable",
      generatedAt: new Date().toISOString(),
      mineruBlocks: [],
      warnings: [`MinerU parser is unavailable. Install ${command} or set LA_MINERU_COMMAND to a valid executable.`],
    };
  }
  const inputStat = await stat(resolvedPath);
  const argsTemplate = process.env.LA_MINERU_ARGS ?? MINERU_DEFAULT_ARGS;
  const key = mineruCacheKey({
    resolvedPath,
    size: inputStat.size,
    mtimeMs: inputStat.mtimeMs,
    command,
    executable,
    argsTemplate,
  });
  const mineruRoot = runtimeProjectCachePath(workspaceRoot, options.projectId, "asset_parse", "mineru");
  const outputDir = join(mineruRoot, assetCacheDirName(resolvedPath, key));
  const cached = await readRuntimeCacheManifest<MinerUCacheManifest>(outputDir);
  if (
    cached?.version === MINERU_CACHE_VERSION &&
    cached.sourcePath === resolvedPath &&
    cached.size === inputStat.size &&
    cached.mtimeMs === inputStat.mtimeMs &&
    cached.command === command &&
    cached.executable === executable &&
    cached.argsTemplate === argsTemplate
  ) {
    const blocks = await readMinerUBlocks(outputDir).catch(() => []);
    if (blocks.length) {
      return {
        projectId: options.projectId,
        assetPath: options.assetPath,
        resolvedPath,
        mode: options.mode ?? "mineru",
        parser: "mineru",
        status: "ready",
        generatedAt: new Date().toISOString(),
        mineruBlocks: blocks,
        warnings: cached.warnings,
      };
    }
  }
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  const normalized = await normalizedMinerUXlsxInput(resolvedPath, outputDir).catch((error) => ({
    path: resolvedPath,
    warnings: [`MinerU input normalization failed: ${summarizeMinerUError(error)}`],
  }));
  const args = splitArgs(argsTemplate, normalized.path, outputDir);
  try {
    const run = await runCommand(executable, args, { timeoutMs: options.mineruTimeoutMs ?? 180_000 });
    if (run.stdout.trim()) {
      await writeFile(join(outputDir, "mineru.stdout.txt"), run.stdout, "utf8");
    }
    if (run.stderr.trim()) {
      await writeFile(join(outputDir, "mineru.stderr.txt"), run.stderr, "utf8");
    }
    const blocks = await readMinerUBlocks(outputDir);
    if (blocks.length) {
      await writeRuntimeCacheManifest(outputDir, {
        version: MINERU_CACHE_VERSION,
        sourcePath: resolvedPath,
        size: inputStat.size,
        mtimeMs: inputStat.mtimeMs,
        command,
        executable,
        argsTemplate,
        warnings: normalized.warnings,
        createdAt: new Date().toISOString(),
      } satisfies MinerUCacheManifest);
      await pruneSiblingMinerUCaches(mineruRoot, outputDir, basename(resolvedPath));
    }
    return {
      projectId: options.projectId,
      assetPath: options.assetPath,
      resolvedPath,
      mode: options.mode ?? "mineru",
      parser: "mineru",
      status: blocks.length ? "ready" : "error",
      generatedAt: new Date().toISOString(),
      mineruBlocks: blocks,
      warnings: blocks.length ? normalized.warnings : [...normalized.warnings, `MinerU command completed but no markdown/json/text blocks were found in ${outputDir}.`],
      error: blocks.length ? undefined : "MinerU produced no parseable blocks.",
    };
  } catch (error) {
    const message = summarizeMinerUError(error);
    const blocks = await readMinerUBlocks(outputDir).catch(() => []);
    if (blocks.length) {
      const warnings = uniqueStrings([...normalized.warnings, `MinerU exited with a non-zero status after writing parse output: ${message}`]);
      await writeRuntimeCacheManifest(outputDir, {
        version: MINERU_CACHE_VERSION,
        sourcePath: resolvedPath,
        size: inputStat.size,
        mtimeMs: inputStat.mtimeMs,
        command,
        executable,
        argsTemplate,
        warnings,
        createdAt: new Date().toISOString(),
      } satisfies MinerUCacheManifest);
      await pruneSiblingMinerUCaches(mineruRoot, outputDir, basename(resolvedPath));
      return {
        projectId: options.projectId,
        assetPath: options.assetPath,
        resolvedPath,
        mode: options.mode ?? "mineru",
        parser: "mineru",
        status: "ready",
        generatedAt: new Date().toISOString(),
        mineruBlocks: blocks,
        warnings,
      };
    }
    return {
      projectId: options.projectId,
      assetPath: options.assetPath,
      resolvedPath,
      mode: options.mode ?? "mineru",
      parser: "mineru",
      status: "error",
      generatedAt: new Date().toISOString(),
      mineruBlocks: [],
      warnings: normalized.warnings,
      error: message,
    };
  }
}

export function compareAssetParses(structured: AssetParsePreview, mineru: AssetParsePreview): AssetParseComparison {
  const structuredSheets = structured.structuredSheets ?? [];
  const mineruBlocks = mineru.mineruBlocks ?? [];
  const mineruTables = mineruBlocks.filter((block) => block.blockType === "table");
  const structuredRowCount = structuredSheets.reduce((sum, sheet) => sum + sheet.rowCount, 0);
  return {
    projectId: structured.projectId,
    assetPath: structured.assetPath,
    generatedAt: new Date().toISOString(),
    structuredStatus: structured.status,
    mineruStatus: mineru.status,
    structuredSheetCount: structuredSheets.length,
    mineruBlockCount: mineruBlocks.length,
    structuredRowCount,
    mineruTableBlockCount: mineruTables.length,
    structuredHeaders: structuredSheets.map((sheet) => ({ sheetName: sheet.sheetName, headers: sheet.headers })),
    mineruTableSamples: mineruTables.slice(0, 8).map((block) => ({ blockId: block.id, text: block.text.slice(0, 500) })),
    structuredOnlySheets: structuredSheets.map((sheet) => sheet.sheetName),
    mineruOnlyBlocks: mineruBlocks.slice(0, 16).map((block) => block.id),
    rowCountDelta: mineruTables.length ? structuredRowCount - mineruTables.length : undefined,
    warnings: uniqueStrings([
      ...(structured.status === "error" ? [`Structured parser failed: ${structured.error ?? "unknown error"}`] : []),
      ...(mineru.status !== "ready" ? [`MinerU parser is ${mineru.status}: ${mineru.error ?? mineru.warnings.join("; ")}`] : []),
      ...(structured.status === "ready" && mineru.status === "ready" ? ["Dual parse comparison is advisory. Confirm mappings before import."] : []),
    ]),
  };
}

export async function parseAsset(workspaceRoot: string, options: AssetParsePreviewOptions & { sheetOverrides?: WorkbookAssetSheetOverride[]; purpose?: AssetMappingPurpose }): Promise<AssetParseResult> {
  const mode: AssetParseMode = options.mode ?? "structured";
  const generatedAt = new Date().toISOString();
  if (mode === "manual") {
    return {
      projectId: options.projectId,
      assetPath: options.assetPath,
      mode,
      generatedAt,
      warnings: ["Manual mapping mode selected. Confirm sheet roles and source/target columns before import."],
    };
  }
  if (mode === "structured") {
    const structuredPreview = await structuredAssetPreview(workspaceRoot, { ...options, mode });
    return {
      projectId: options.projectId,
      assetPath: options.assetPath,
      mode,
      generatedAt,
      structuredPreview,
      warnings: structuredPreview.warnings,
    };
  }
  if (mode === "mineru") {
    const mineruPreview = await mineruAssetPreview(workspaceRoot, { ...options, mode });
    return {
      projectId: options.projectId,
      assetPath: options.assetPath,
      mode,
      generatedAt,
      mineruPreview,
      warnings: mineruPreview.warnings,
    };
  }
  const [structuredPreview, mineruPreview] = await Promise.all([
    structuredAssetPreview(workspaceRoot, { ...options, mode }),
    mineruAssetPreview(workspaceRoot, { ...options, mode }),
  ]);
  const comparison = compareAssetParses(structuredPreview, mineruPreview);
  return {
    projectId: options.projectId,
    assetPath: options.assetPath,
    mode,
    generatedAt,
    structuredPreview,
    mineruPreview,
    comparison,
    warnings: comparison.warnings,
  };
}

function roleForPurpose(purpose: AssetMappingPurpose): Pick<AssetConfirmedMapping, "role" | "action" | "authorityTier"> {
  if (purpose === "tm" || purpose === "reference") {
    return { role: "reference", action: "index_reference", authorityTier: "reference" };
  }
  return { role: purpose === "glossary" ? "glossary" : "termbase", action: purpose === "glossary" ? "needs_mapping" : "import_terms", authorityTier: purpose === "glossary" ? "proposal_only" : "termbase" };
}

function actionNeedsColumnMapping(action: AssetConfirmedMapping["action"]): boolean {
  return action === "import_terms" || action === "needs_mapping";
}

function deterministicSuggestions(parse: AssetParseResult, purpose: AssetMappingPurpose): AssetMappingSuggestion[] {
  const role = roleForPurpose(purpose);
  const sheets = parse.structuredPreview?.structuredSheets ?? [];
  return sheets.flatMap((sheet) => {
    const candidates = sheet.mappingCandidates.length
      ? sheet.mappingCandidates
      : sheet.suggested.sourceColumn && sheet.suggested.targetColumn
        ? [{
            sheetName: sheet.sheetName,
            sourceColumn: sheet.suggested.sourceColumn,
            targetColumn: sheet.suggested.targetColumn,
            noteColumn: sheet.suggested.noteColumn,
            rowCount: sheet.rowCount,
            confidence: sheet.confidence,
            score: Math.round(sheet.confidence * 100),
            reason: sheet.reason,
            sampleRows: sheet.sampleRows,
          }]
        : [];
    return candidates.slice(0, 3).map((candidate): AssetMappingSuggestion => ({
      ...role,
      sheetName: candidate.sheetName,
      sourceColumn: candidate.sourceColumn,
      targetColumn: candidate.targetColumn,
      noteColumn: candidate.noteColumn,
      confidence: candidate.confidence,
      reason: candidate.reason,
      warnings: sheet.warnings,
      source: "deterministic",
      purpose,
      sourceEvidence: [
        `${candidate.sheetName}: ${candidate.sourceColumn} -> ${candidate.targetColumn}`,
        ...candidate.sampleRows.slice(0, 2).map((row) => row.join(" | ")),
      ],
    }));
  });
}

function buildMappingPrompt(parse: AssetParseResult, purpose: AssetMappingPurpose): string {
  const sheets = parse.structuredPreview?.structuredSheets ?? [];
  return [
    "You are assisting Linguist Agent asset import mapping.",
    `Purpose: ${purpose}`,
    `Return strict JSON: {"suggestions":[{"sheetName":"...","sourceColumn":"...","targetColumn":"...","noteColumn":"...","role":"${WORKBOOK_MAPPING_ROLES.join("|")}","action":"import_terms|needs_mapping|index_reference|resolve_term_history|import_term_delta","confidence":0.0,"reason":"..."}]}.`,
    "Do not invent sheet or column names. Only use headers listed below.",
    "For index_reference sheets, omit sourceColumn/targetColumn unless the sheet truly has bilingual source/target columns.",
    "",
    ...sheets.map((sheet) => [
      `Sheet: ${sheet.sheetName}`,
      `Headers: ${sheet.headers.join(" | ")}`,
      `Samples: ${sheet.sampleRows.slice(0, 3).map((row) => row.join(" | ")).join(" / ")}`,
      `Current deterministic action: ${sheet.action}`,
    ].join("\n")),
  ].join("\n");
}

function validateLlmSuggestions(raw: unknown, parse: AssetParseResult, purpose: AssetMappingPurpose): AssetMappingSuggestion[] {
  const rows = typeof raw === "object" && raw && Array.isArray((raw as { suggestions?: unknown[] }).suggestions)
    ? (raw as { suggestions: unknown[] }).suggestions
    : [];
  const sheets = new Map((parse.structuredPreview?.structuredSheets ?? []).map((sheet) => [sheet.sheetName, sheet]));
  const out: AssetMappingSuggestion[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const sheetName = typeof item.sheetName === "string" ? item.sheetName : "";
    const sheet = sheets.get(sheetName);
    if (!sheet) continue;
    const action = typeof item.action === "string" && ["import_terms", "import_term_delta", "resolve_term_history", "index_reference", "needs_mapping"].includes(item.action)
      ? item.action as AssetConfirmedMapping["action"]
      : roleForPurpose(purpose).action;
    const role = typeof item.role === "string" && WORKBOOK_MAPPING_ROLES.includes(item.role as (typeof WORKBOOK_MAPPING_ROLES)[number])
      ? item.role as AssetConfirmedMapping["role"]
      : roleForPurpose(purpose).role;
    const sourceColumn = typeof item.sourceColumn === "string" && sheet.headers.includes(item.sourceColumn) ? item.sourceColumn : undefined;
    const targetColumn = typeof item.targetColumn === "string" && sheet.headers.includes(item.targetColumn) ? item.targetColumn : undefined;
    if (actionNeedsColumnMapping(action) && (!sourceColumn || !targetColumn)) continue;
    const confidence = typeof item.confidence === "number" ? Math.max(0, Math.min(1, item.confidence)) : 0.7;
    const noteColumn = typeof item.noteColumn === "string" && sheet.headers.includes(item.noteColumn) ? item.noteColumn : undefined;
    out.push({
      sheetName,
      role,
      action,
      authorityTier: authorityTierForWorkbookAction(action),
      sourceColumn,
      targetColumn,
      noteColumn,
      confidence,
      reason: typeof item.reason === "string" ? item.reason : "LLM-assisted mapping suggestion.",
      warnings: sheet.warnings,
      source: "llm",
      purpose,
      sourceEvidence: [`${sheetName}: ${sourceColumn} -> ${targetColumn}`],
    });
  }
  return out;
}

function parseModelJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced ? fenced[1] : trimmed);
}

export async function suggestAssetMappings(
  workspaceRoot: string,
  options: AssetParsePreviewOptions & {
    purpose?: AssetMappingPurpose;
    sheetOverrides?: WorkbookAssetSheetOverride[];
    askModel?: AskAssetMappingModel;
    assistantModel?: string;
  },
): Promise<AssetMappingSuggestionResult> {
  const purpose = options.purpose ?? "termbase";
  const parseMode = options.mode ?? "structured";
  const parse = await parseAsset(workspaceRoot, { ...options, mode: parseMode });
  const promptPreview = buildMappingPrompt(parse, purpose);
  const deterministic = deterministicSuggestions(parse, purpose);
  if (!options.askModel) {
    return {
      projectId: options.projectId,
      assetPath: options.assetPath,
      parseMode,
      purpose,
      generatedAt: new Date().toISOString(),
      assistantStatus: "not_configured",
      suggestions: deterministic,
      promptPreview,
      warnings: uniqueStrings(parse.warnings),
    };
  }
  try {
    const raw = await options.askModel({ prompt: promptPreview, parse, purpose });
    const llm = validateLlmSuggestions(parseModelJson(raw), parse, purpose).map((suggestion) => ({
      ...suggestion,
      llmPromptPreview: promptPreview.slice(0, 4000),
    }));
    return {
      projectId: options.projectId,
      assetPath: options.assetPath,
      parseMode,
      purpose,
      generatedAt: new Date().toISOString(),
      assistantStatus: "ready",
      assistantModel: options.assistantModel,
      suggestions: [...llm, ...deterministic],
      promptPreview,
      warnings: uniqueStrings(parse.warnings),
    };
  } catch (error) {
    return {
      projectId: options.projectId,
      assetPath: options.assetPath,
      parseMode,
      purpose,
      generatedAt: new Date().toISOString(),
      assistantStatus: "error",
      assistantModel: options.assistantModel,
      suggestions: deterministic,
      promptPreview,
      warnings: uniqueStrings(parse.warnings),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function columnMappingFromSuggestion(suggestion: AssetMappingSuggestion): AssetColumnMapping {
  return {
    sourceColumn: suggestion.sourceColumn,
    targetColumn: suggestion.targetColumn,
    noteColumn: suggestion.noteColumn,
    statusColumn: suggestion.statusColumn,
    categoryColumn: suggestion.categoryColumn,
    dateColumn: suggestion.dateColumn,
    commentColumn: suggestion.commentColumn,
  };
}
