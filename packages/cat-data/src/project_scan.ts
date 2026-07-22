import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve } from "node:path";

export type AssetRole =
  | "phrase_mxliff"
  | "master_xliff"
  | "xliff"
  | "mqxliff"
  | "sdlxliff"
  | "csv_batch"
  | "xlsx_batch"
  | "tm"
  | "termbase"
  | "glossary"
  | "source_table"
  | "style_guide"
  | "reference"
  | "image"
  | "unknown";

export interface DiscoveredAsset {
  path: string;
  relPath: string;
  name: string;
  ext: string;
  sizeBytes: number;
  role: AssetRole;
  confidence: number;
  reasons: string[];
  metrics?: TextAssetMetrics;
}

export interface TextAssetMetrics {
  transUnits?: number;
  sourceCount?: number;
  duplicateSourceGroups?: number;
  lockedMarkers?: number;
  placeholderMarkers?: number;
  targetCount?: number;
}

export interface PhraseTagPair {
  mxliff: string;
  masterXliff?: string;
  confidence: number;
  reason: string;
}

export interface ProjectScanReport {
  root: string;
  scannedAt: string;
  assets: DiscoveredAsset[];
  phraseTagPairs: PhraseTagPair[];
  warnings: string[];
  questions: string[];
  importPlan: string[];
  suggestedActions: SuggestedImportAction[];
  countsByRole: Record<string, number>;
}

export interface SuggestedImportAction {
  assetPath: string;
  role: AssetRole;
  action: string;
  tool?: string;
  prerequisites: string[];
  reason: string;
  confidence: number;
}

const TEXT_EXTS = new Set([
  ".md",
  ".txt",
  ".csv",
  ".tsv",
  ".xlf",
  ".xliff",
  ".mxliff",
  ".mqxliff",
  ".sdlxliff",
  ".tmx",
  ".tbx",
]);

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp"]);

function hasAny(value: string, needles: string[]): boolean {
  const lower = value.toLocaleLowerCase();
  return needles.some((needle) => lower.includes(needle.toLocaleLowerCase()));
}

function normalizeStem(name: string): string {
  return basename(name, extname(name))
    .toLocaleLowerCase()
    .replace(/\b\d{2}\.\d{2}\b/g, " ")
    .replace(/\bzh[_-]?cn\b|\ben[_-]?us\b|\br\b/g, " ")
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenOverlapScore(a: string, b: string): number {
  const aTokens = new Set(normalizeStem(a).split(/\s+/).filter(Boolean));
  const bTokens = new Set(normalizeStem(b).split(/\s+/).filter(Boolean));
  if (!aTokens.size || !bTokens.size) return 0;
  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap += 1;
  }
  return overlap / Math.max(aTokens.size, bTokens.size);
}

function decodeXmlText(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

function countMatches(value: string, regex: RegExp): number {
  return Array.from(value.matchAll(regex)).length;
}

async function readTextSample(path: string, sizeBytes: number): Promise<string | undefined> {
  const ext = extname(path).toLocaleLowerCase();
  if (!TEXT_EXTS.has(ext)) return undefined;
  if (sizeBytes > 15 * 1024 * 1024) {
    const raw = await readFile(path);
    return raw.subarray(0, 2 * 1024 * 1024).toString("utf8");
  }
  return readFile(path, "utf8");
}

async function collectMetrics(path: string, sizeBytes: number): Promise<TextAssetMetrics | undefined> {
  const text = await readTextSample(path, sizeBytes);
  if (!text) return undefined;

  const sources = Array.from(text.matchAll(/<source\b[^>]*>([\s\S]*?)<\/source>/gi)).map((m) =>
    decodeXmlText(m[1] ?? ""),
  );
  const sourceCounts = new Map<string, number>();
  for (const source of sources) {
    if (!source) continue;
    sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
  }

  return {
    transUnits: countMatches(text, /<trans-unit\b/gi),
    sourceCount: sources.length,
    targetCount: countMatches(text, /<target\b/gi),
    duplicateSourceGroups: Array.from(sourceCounts.values()).filter((count) => count > 1).length,
    lockedMarkers: countMatches(text, /(?:translate=["']no["']|locked=["'](?:true|1|locked)["']|m:locked=["']true["']|mq:locked=["']locked["'])/gi),
    placeholderMarkers: countMatches(text, /\{\d+\}/g),
  };
}

function classifyFile(relPath: string, name: string, ext: string): Pick<DiscoveredAsset, "role" | "confidence" | "reasons"> {
  const full = `${relPath} ${name}`;
  const lowerExt = ext.toLocaleLowerCase();
  const reasons: string[] = [];

  if (lowerExt === ".mxliff") {
    return { role: "phrase_mxliff", confidence: 0.98, reasons: ["Phrase/Memsource MXLIFF bilingual file"] };
  }
  if (lowerExt === ".mqxliff") {
    return { role: "mqxliff", confidence: 0.98, reasons: ["memoQ MQXLIFF bilingual file"] };
  }
  if (lowerExt === ".sdlxliff") {
    return { role: "sdlxliff", confidence: 0.98, reasons: ["Trados SDLXLIFF bilingual file"] };
  }
  if (lowerExt === ".xlf" || lowerExt === ".xliff") {
    if (hasAny(full, ["phrase", "源文件", "master", "batch"])) {
      return { role: "master_xliff", confidence: 0.82, reasons: ["XLIFF may be Phrase master/tag companion"] };
    }
    return { role: "xliff", confidence: 0.75, reasons: ["Generic XLIFF bilingual file"] };
  }
  if (lowerExt === ".sdltm" || lowerExt === ".tmx") {
    return { role: "tm", confidence: 0.98, reasons: ["Translation Memory format"] };
  }
  if (lowerExt === ".sdltb" || lowerExt === ".tbx") {
    return { role: "termbase", confidence: 0.98, reasons: ["Termbase format"] };
  }
  if (IMAGE_EXTS.has(lowerExt)) {
    return { role: "image", confidence: 0.9, reasons: ["Image/reference asset"] };
  }

  if (lowerExt === ".csv" || lowerExt === ".xlsx") {
    if (hasAny(full, ["batch", "bilingual", "segments", "句段", "双语", "csv paste", "xlsx paste"])) {
      return {
        role: lowerExt === ".csv" ? "csv_batch" : "xlsx_batch",
        confidence: 0.72,
        reasons: [`filename suggests ${lowerExt === ".csv" ? "CSV" : "XLSX"} bilingual batch table`],
      };
    }
  }

  if (lowerExt === ".xlsx" || lowerExt === ".csv" || lowerExt === ".tsv" || lowerExt === ".txt" || lowerExt === ".md") {
    if (hasAny(full, ["术语", "glossary", "term", "query", "tb"])) {
      reasons.push("filename suggests terminology/query table");
      return { role: "glossary", confidence: 0.82, reasons };
    }
    if (hasAny(full, ["tm", "translation memory", "翻译记忆"])) {
      reasons.push("filename suggests TM table");
      return { role: "tm", confidence: 0.78, reasons };
    }
    if (hasAny(full, ["style", "guide", "风格", "规范"])) {
      reasons.push("filename suggests style guide");
      return { role: "style_guide", confidence: 0.82, reasons };
    }
    if (hasAny(full, ["源文件", "source", "中文未审校"])) {
      reasons.push("filename suggests source spreadsheet");
      return { role: "source_table", confidence: 0.82, reasons };
    }
    return { role: "reference", confidence: 0.62, reasons: ["readable project reference/table"] };
  }

  if (lowerExt === ".docx" || lowerExt === ".pdf" || lowerExt === ".pptx") {
    return { role: "reference", confidence: 0.75, reasons: ["reference document"] };
  }

  return { role: "unknown", confidence: 0.2, reasons: ["unclassified extension"] };
}

async function walkFiles(root: string, maxDepth: number): Promise<string[]> {
  const files: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === ".DS_Store" || entry.name === "node_modules" || entry.name === ".git") continue;
      if (entry.name.startsWith(".") && entry.name !== ".pi") continue;
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
  }

  await walk(root, 0);
  return files;
}

function buildPhraseTagPairs(assets: DiscoveredAsset[]): PhraseTagPair[] {
  const mxliffs = assets.filter((asset) => asset.role === "phrase_mxliff");
  const masters = assets.filter((asset) => asset.role === "master_xliff" || asset.role === "xliff");
  const pairs: PhraseTagPair[] = [];

  for (const mxliff of mxliffs) {
    const sameDir = masters.filter((candidate) => dirname(candidate.path) === dirname(mxliff.path));
    const candidates = (sameDir.length ? sameDir : masters)
      .map((candidate) => ({
        candidate,
        score: (dirname(candidate.path) === dirname(mxliff.path) ? 0.45 : 0) + tokenOverlapScore(mxliff.name, candidate.name),
      }))
      .sort((a, b) => b.score - a.score);

    const best = candidates[0];
    if (best && best.score >= 0.45) {
      pairs.push({
        mxliff: mxliff.relPath,
        masterXliff: best.candidate.relPath,
        confidence: Math.min(0.98, best.score),
        reason:
          dirname(best.candidate.path) === dirname(mxliff.path)
            ? "same folder master XLIFF candidate with filename overlap"
            : "best available XLIFF filename overlap",
      });
    } else {
      pairs.push({
        mxliff: mxliff.relPath,
        confidence: 0,
        reason: "no master XLIFF candidate found; tags may stay as raw placeholders",
      });
    }
  }

  return pairs;
}

function buildWarnings(assets: DiscoveredAsset[], pairs: PhraseTagPair[]): string[] {
  const warnings: string[] = [];
  for (const pair of pairs) {
    if (!pair.masterXliff) {
      warnings.push(`${pair.mxliff}: no master XLIFF paired; inline tag rehydration is unsafe.`);
    }
  }
  for (const asset of assets) {
    if (asset.role === "phrase_mxliff" && (asset.metrics?.placeholderMarkers ?? 0) > 0) {
      warnings.push(`${asset.relPath}: contains ${asset.metrics?.placeholderMarkers} raw {n} placeholder markers.`);
    }
    if ((asset.metrics?.duplicateSourceGroups ?? 0) > 0) {
      warnings.push(`${asset.relPath}: has ${asset.metrics?.duplicateSourceGroups} repeated source groups; repeated-segment propagation should be enabled.`);
    }
  }
  return warnings;
}

function buildQuestions(assets: DiscoveredAsset[], pairs: PhraseTagPair[]): string[] {
  const questions: string[] = [];
  if (!assets.some((asset) => asset.role === "tm")) {
    questions.push("No TM file/table detected. Should this project start with an empty TM, or is there a TM elsewhere?");
  }
  if (!assets.some((asset) => asset.role === "termbase" || asset.role === "glossary")) {
    questions.push("No TB/glossary detected. Is terminology embedded in another reference file?");
  }
  if (pairs.some((pair) => !pair.masterXliff)) {
    questions.push("Some MXLIFF files lack a master XLIFF companion. Can you provide the Phrase master export for tag restoration?");
  }
  return questions;
}

function buildImportPlan(assets: DiscoveredAsset[], pairs: PhraseTagPair[]): string[] {
  const plan: string[] = [];
  if (assets.some((asset) => asset.role === "tm")) plan.push("Import TM assets first.");
  if (assets.some((asset) => asset.role === "termbase" || asset.role === "glossary")) plan.push("Import TB/glossary assets with column mapping preview.");
  if (assets.some((asset) => asset.role === "style_guide" || asset.role === "reference")) plan.push("Register reference/style assets for retrieval.");
  for (const pair of pairs) {
    if (pair.masterXliff) {
      plan.push(`Create batch from ${pair.mxliff} with master tag companion ${pair.masterXliff}.`);
    } else {
      plan.push(`Hold ${pair.mxliff} until master XLIFF is confirmed, or import with explicit tag-risk warning.`);
    }
  }
  if (assets.some((asset) => asset.role === "source_table")) plan.push("Keep source spreadsheet as reference for context and source-row provenance.");
  return plan.length ? plan : ["No safe import plan could be inferred from discovered files."];
}

const TABLE_EXTS = new Set([".xlsx", ".csv", ".tsv", ".txt", ".md"]);

function suggestedAction(
  asset: Pick<DiscoveredAsset, "relPath" | "role" | "confidence">,
  action: string,
  options: { tool?: string; prerequisites?: string[]; reason: string; confidence?: number },
): SuggestedImportAction {
  return {
    assetPath: asset.relPath,
    role: asset.role,
    action,
    tool: options.tool,
    prerequisites: options.prerequisites ?? [],
    reason: options.reason,
    confidence: options.confidence ?? asset.confidence,
  };
}

function buildSuggestedActions(assets: DiscoveredAsset[], pairs: PhraseTagPair[]): SuggestedImportAction[] {
  const actions: SuggestedImportAction[] = [];

  for (const asset of assets) {
    if (asset.role === "tm") {
      if (asset.ext === ".tmx") {
        actions.push(
          suggestedAction(asset, "Import TMX into project TM.", {
            tool: "tm_import_tmx",
            reason: "TMX is a supported deterministic translation-memory import format.",
          }),
        );
      } else if (asset.ext === ".sdltm") {
        actions.push(
          suggestedAction(asset, "Import SDLTM into project TM.", {
            tool: "tm_import_sdltm",
            reason: "SDLTM is a supported deterministic Trados translation-memory import format.",
          }),
        );
      } else if (TABLE_EXTS.has(asset.ext)) {
        actions.push(
          suggestedAction(asset, "Preview table mapping, then import as project TM.", {
            tool: "workbook_preview -> tm_import_table",
            prerequisites: ["Confirm source and target columns from workbook_preview before importing."],
            reason: "Filename suggests a TM table; table columns must be confirmed before import.",
          }),
        );
      }
    }

    if (asset.role === "termbase") {
      if (asset.ext === ".tbx") {
        actions.push(
          suggestedAction(asset, "Import TBX into project termbase.", {
            tool: "termbase_import_tbx",
            reason: "TBX is a supported deterministic termbase import format.",
          }),
        );
      } else if (asset.ext === ".sdltb") {
        actions.push(
          suggestedAction(asset, "Import SDLTB into project termbase via mdbtools.", {
            tool: "termbase_import_sdltb",
            prerequisites: ["mdbtools must be installed and available on PATH."],
            reason: "SDLTB is supported through deterministic mdbtools extraction.",
          }),
        );
      } else if (TABLE_EXTS.has(asset.ext)) {
        actions.push(
          suggestedAction(asset, "Preview table mapping, then import as project termbase.", {
            tool: "workbook_preview -> termbase_import_table",
            prerequisites: ["Confirm source and target columns from workbook_preview before importing."],
            reason: "Terminology tables require explicit column mapping before import.",
          }),
        );
      }
    }

    if (asset.role === "glossary") {
      if ([".csv", ".tsv", ".txt", ".md"].includes(asset.ext)) {
        actions.push(
          suggestedAction(asset, "Import readable glossary table into project glossary.", {
            tool: "glossary_import_table",
            prerequisites: ["Confirm source and target columns if headers are ambiguous."],
            reason: "Readable glossary tables are supported by glossary_import_table.",
          }),
        );
      } else if (asset.ext === ".xlsx") {
        actions.push(
          suggestedAction(asset, "Preview workbook mapping, then import as termbase if this is official terminology.", {
            tool: "workbook_preview -> termbase_import_table",
            prerequisites: ["Confirm whether this is authoritative terminology or only a loose glossary."],
            reason: "XLSX glossary import needs workbook mapping; authoritative terminology should enter the termbase.",
            confidence: Math.min(asset.confidence, 0.74),
          }),
        );
      }
    }

    if (asset.role === "style_guide" || asset.role === "reference" || asset.role === "source_table" || asset.role === "image") {
      actions.push(
        suggestedAction(asset, "Index as retrieval evidence blocks.", {
          tool: "asset_blocks_build",
          reason:
            asset.role === "source_table"
              ? "Source tables are useful for row provenance and context retrieval."
              : asset.role === "image"
                ? "Images can be indexed as metadata blocks or OCR sidecar text before visual review."
              : "Reference/style assets should be searchable before T/E/P decisions.",
        }),
      );
    }

    if (asset.role === "sdlxliff") {
      actions.push(
        suggestedAction(asset, "Create Trados batch workspace.", {
          tool: "batch_import_sdlxliff",
          reason: "SDLXLIFF import preserves locked rows and confirmation metadata.",
        }),
      );
    }

    if (asset.role === "mqxliff") {
      actions.push(
        suggestedAction(asset, "Create memoQ batch workspace.", {
          tool: "batch_import_mqxliff",
          reason: "Plain MQXLIFF import preserves memoQ inline carriers, locked rows, and segment status.",
        }),
      );
    }

    if (asset.role === "xliff") {
      actions.push(
        suggestedAction(asset, "Create generic XLIFF batch workspace.", {
          tool: "batch_import_xliff",
          prerequisites: ["Confirm whether this file is a deliverable batch or reference bilingual file."],
          reason: "Generic XLIFF 1.2/2.0 import preserves source/target/lock state without vendor-specific assumptions.",
          confidence: Math.min(asset.confidence, 0.72),
        }),
      );
    }

    if (asset.role === "csv_batch" || asset.role === "xlsx_batch") {
      actions.push(
        suggestedAction(asset, `Create ${asset.role === "csv_batch" ? "CSV" : "XLSX"} table batch workspace.`, {
          tool: asset.role === "csv_batch" ? "batch_import_csv" : "batch_import_xlsx",
          prerequisites: ["Confirm SegmentID/Source/Target columns before treating the table as a deliverable batch."],
          reason: "Table batch import supports paste-style bilingual files while keeping export round-trip explicit.",
          confidence: Math.min(asset.confidence, 0.7),
        }),
      );
    }
  }

  for (const pair of pairs) {
    const mxliffAsset = assets.find((asset) => asset.relPath === pair.mxliff);
    if (!mxliffAsset) continue;
    if (pair.masterXliff) {
      actions.push(
        suggestedAction(mxliffAsset, "Create Phrase batch workspace with master XLIFF tag companion.", {
          tool: "batch_import_phrase",
          prerequisites: [`masterXliff=${pair.masterXliff}`],
          reason: pair.reason,
          confidence: pair.confidence,
        }),
      );
    } else {
      actions.push(
        suggestedAction(mxliffAsset, "Hold Phrase MXLIFF until its master XLIFF companion is provided.", {
          prerequisites: ["Ask for Phrase master XLIFF export before importing if inline tags matter."],
          reason: pair.reason,
          confidence: 0,
        }),
      );
    }
  }

  return actions.sort((a, b) => a.assetPath.localeCompare(b.assetPath, "zh-CN") || b.confidence - a.confidence);
}

export async function scanProjectFolder(rootInput: string, options: { maxDepth?: number } = {}): Promise<ProjectScanReport> {
  const root = resolve(rootInput);
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) {
    throw new Error(`Project onboarding root is not a directory: ${root}`);
  }

  const files = await walkFiles(root, options.maxDepth ?? 6);
  const assets: DiscoveredAsset[] = [];

  for (const path of files) {
    const fileStat = await stat(path);
    const name = basename(path);
    const ext = extname(path).toLocaleLowerCase();
    const relPath = relative(root, path);
    const classified = classifyFile(relPath, name, ext);
    const metrics = await collectMetrics(path, fileStat.size);
    assets.push({
      path,
      relPath,
      name,
      ext,
      sizeBytes: fileStat.size,
      ...classified,
      metrics,
    });
  }

  assets.sort((a, b) => a.relPath.localeCompare(b.relPath, "zh-CN"));
  const phraseTagPairs = buildPhraseTagPairs(assets);
  const countsByRole: Record<string, number> = {};
  for (const asset of assets) {
    countsByRole[asset.role] = (countsByRole[asset.role] ?? 0) + 1;
  }

  return {
    root,
    scannedAt: new Date().toISOString(),
    assets,
    phraseTagPairs,
    warnings: buildWarnings(assets, phraseTagPairs),
    questions: buildQuestions(assets, phraseTagPairs),
    importPlan: buildImportPlan(assets, phraseTagPairs),
    suggestedActions: buildSuggestedActions(assets, phraseTagPairs),
    countsByRole,
  };
}
