import { createHash } from "node:crypto";
import { appendFile, rm, readFile } from "node:fs/promises";
import { extname } from "node:path";
import { createWorkspace, workspacePath, readJsonlFile } from "./workspace.js";
import { readProjectManifest } from "./project_manifest.js";
import {
  extractDocxBlocks,
  extractImageBlocks,
  extractPdfBlocks,
  extractPptxBlocks,
  extractXlsxBlocks,
  type ExtractedDocumentBlock,
} from "./document_assets.js";
import { readAssetVectorIndexSummary, searchAssetVectors, type AssetVectorIndexSummary } from "./asset_vectors.js";
import type { LocalTextEmbedder } from "./local_embeddings.js";

export interface AssetBlock {
  blockId: string;
  assetPath: string;
  lineNo: number;
  blockType: "heading" | "table" | "text" | "image";
  text: string;
  sourceEngine: "text_asset" | "docx_asset" | "pptx_asset" | "pdf_asset" | "xlsx_asset" | "image_asset";
  role?: string;
  parserKind?: string;
  typedRowId?: string;
  authorityTier?: string;
  sourceDigest?: string;
  page?: number;
  sheet?: string;
  slide?: number;
  bbox?: [number, number, number, number];
  parserVersion?: string;
}

export interface AssetBlockBuildReport {
  projectId: string;
  path: string;
  assetsProcessed: number;
  blocksWritten: number;
  skipped: Array<{ relPath: string; reason: string }>;
}

export interface AssetBlockSearchHit extends AssetBlock {
  score: number;
  retrievalMode: "lexical" | "vector" | "hybrid";
  scoreBreakdown: {
    lexical: number;
    semantic?: number;
    combined: number;
  };
  semanticState?: AssetSemanticState;
}

export interface AssetSemanticState {
  state: "disabled" | "blocked_missing_vector_index" | "blocked_legacy_vector_index" | "blocked_embedding_bridge_unavailable" | "blocked_local_embedding_unavailable" | "ready";
  assetVectorIndex: AssetVectorIndexSummary["state"];
  embeddingModel?: string;
  backend?: AssetVectorIndexSummary["backend"];
  provider?: string;
  dim?: number;
  indexedBlocks?: number;
  builtAt?: string;
  message?: string;
}

export interface AssetBlockSearchReport {
  projectId: string;
  query: string;
  retrievalMode: "lexical" | "vector" | "hybrid";
  semanticState: AssetSemanticState;
  hits: AssetBlockSearchHit[];
}

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp"]);
const READABLE_EXTS = new Set([".md", ".txt", ".csv", ".tsv", ".docx", ".pptx", ".pdf", ".xlsx", ...IMAGE_EXTS]);
const RRF_K = 60;
const RETRIEVAL_CANDIDATE_LIMIT = 50;
const DEFAULT_RETRIEVAL_LIMIT = 8;

export function assetBlocksPath(workspaceRoot: string, projectId: string): string {
  return workspacePath(createWorkspace(workspaceRoot, projectId), "asset_blocks.jsonl");
}

function blockTypeForLine(line: string): AssetBlock["blockType"] {
  if (/^\s{0,3}#{1,6}\s+/.test(line)) return "heading";
  if (line.trim().startsWith("|") && line.includes("|", 1)) return "table";
  return "text";
}

function assetAuthorityRank(block: Pick<AssetBlock, "authorityTier" | "parserKind" | "role">): number {
  if (block.authorityTier === "style_guide" || block.parserKind === "style_guide" || block.role === "style_guide") return 40;
  if (block.parserKind === "issue_log" || block.role === "issue_log") return 30;
  if (block.parserKind === "query" || block.role === "qa_reference") return 20;
  if (block.parserKind === "reference_index" || block.role === "reference") return 10;
  return 0;
}

const SPLIT_RE = /[\s,.;:!?，。！？、；："'()[\]{}<>《》【】]+/u;

function charBigrams(value: string): Set<string> {
  const v = value.replace(/\s+/g, "");
  if (v.length <= 2) return new Set(v ? [v] : []);
  const grams = new Set<string>();
  for (let i = 0; i <= v.length - 2; i += 1) grams.add(v.slice(i, i + 2));
  return grams;
}

// v1.6: was token-substring counting (0 for any CJK near-match). Now: exact-substring fast
// path → max(per-token substring recall, char-bigram Dice). Bigram Dice gives non-zero
// partial scores for paraphrased / reordered / CJK reference text.
function scoreText(query: string, text: string): number {
  const q = query.toLocaleLowerCase().trim();
  const t = text.toLocaleLowerCase();
  if (!q) return 0;
  if (t.includes(q)) return 1;
  const qTokens = q.split(SPLIT_RE).filter(Boolean);
  let tokenScore = 0;
  if (qTokens.length) {
    let hits = 0;
    for (const token of qTokens) if (t.includes(token)) hits += 1;
    tokenScore = hits / qTokens.length;
  }
  const qGrams = charBigrams(q);
  const tGrams = charBigrams(t);
  let intersection = 0;
  for (const gram of qGrams) if (tGrams.has(gram)) intersection += 1;
  const diceScore = qGrams.size && tGrams.size ? (2 * intersection) / (qGrams.size + tGrams.size) : 0;
  return Math.max(tokenScore, diceScore);
}

function disabledSemanticState(): AssetSemanticState {
  return { state: "disabled", assetVectorIndex: "absent" };
}

function semanticStateFromIndex(summary: AssetVectorIndexSummary): AssetSemanticState {
  if (summary.state === "legacy") {
    return {
      state: "blocked_legacy_vector_index",
      assetVectorIndex: "legacy",
      embeddingModel: summary.embeddingModel,
      backend: summary.backend,
      provider: summary.provider,
      dim: summary.dim,
      indexedBlocks: summary.indexedBlocks,
      builtAt: summary.builtAt,
      message: summary.message,
    };
  }
  if (summary.state !== "ready") {
    return {
      state: "blocked_missing_vector_index",
      assetVectorIndex: summary.state,
      indexedBlocks: summary.indexedBlocks,
    };
  }
  return {
    state: "ready",
    assetVectorIndex: "ready",
    embeddingModel: summary.embeddingModel,
    backend: summary.backend,
    provider: summary.provider,
    dim: summary.dim,
    indexedBlocks: summary.indexedBlocks,
    builtAt: summary.builtAt,
  };
}

export async function buildAssetBlocks(workspaceRoot: string, options: { projectId: string }): Promise<AssetBlockBuildReport> {
  const manifest = await readProjectManifest(workspaceRoot, options.projectId);
  const output = assetBlocksPath(workspaceRoot, options.projectId);
  await rm(output, { force: true });
  let assetsProcessed = 0;
  let blocksWritten = 0;
  const skipped: AssetBlockBuildReport["skipped"] = [];
  const roleByRelPath = new Map(manifest.assetRoleDecisions.map((decision) => [decision.relPath, decision.role]));

  for (const asset of manifest.scan.assets) {
    const role = roleByRelPath.get(asset.relPath) ?? asset.role;
    if (!["reference", "style_guide", "glossary", "source_table", "image"].includes(role)) continue;
    const ext = extname(asset.path).toLocaleLowerCase();
    if (!READABLE_EXTS.has(ext)) {
      skipped.push({ relPath: asset.relPath, reason: `unsupported readable extension ${ext || "unknown"}` });
      continue;
    }
    assetsProcessed += 1;
    const sourceDigest = createHash("sha256").update(await readFile(asset.path)).digest("hex");
    if (ext === ".docx" || ext === ".pptx" || ext === ".pdf" || ext === ".xlsx" || IMAGE_EXTS.has(ext)) {
      let blocks: ExtractedDocumentBlock[];
      try {
        blocks = ext === ".docx"
          ? await extractDocxBlocks(asset.path)
          : ext === ".pptx"
            ? await extractPptxBlocks(asset.path)
            : ext === ".pdf"
              ? await extractPdfBlocks(asset.path)
              : ext === ".xlsx"
                ? await extractXlsxBlocks(asset.path)
                : await extractImageBlocks(asset.path);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        skipped.push({ relPath: asset.relPath, reason: message });
        continue;
      }
      for (const blockData of blocks) {
        const block: AssetBlock = {
          blockId: `${asset.relPath}:${ext.slice(1)}:${blockData.ordinal}`,
          assetPath: asset.relPath,
          lineNo: blockData.ordinal,
          blockType: blockData.blockType,
          text: blockData.text,
          sourceEngine: ext === ".docx" ? "docx_asset" : ext === ".pptx" ? "pptx_asset" : ext === ".pdf" ? "pdf_asset" : ext === ".xlsx" ? "xlsx_asset" : "image_asset",
          role,
          sourceDigest,
          page: blockData.page,
          sheet: blockData.sheet,
          slide: blockData.slide,
          bbox: blockData.bbox,
          parserVersion: blockData.parserVersion ?? "la-document-assets-v1",
        };
        await appendFile(output, `${JSON.stringify(block)}\n`, "utf8");
        blocksWritten += 1;
      }
      continue;
    }
    const text = await readFile(asset.path, "utf8");
    const lines = text.split(/\r?\n/);
    for (const [index, raw] of lines.entries()) {
      const line = raw.trim();
      if (!line) continue;
      const block: AssetBlock = {
        blockId: `${asset.relPath}:${index + 1}`,
        assetPath: asset.relPath,
        lineNo: index + 1,
        blockType: blockTypeForLine(raw),
        text: line,
        sourceEngine: "text_asset",
        role,
        sourceDigest,
        parserVersion: "la-text-assets-v1",
      };
      await appendFile(output, `${JSON.stringify(block)}\n`, "utf8");
      blocksWritten += 1;
    }
  }
  return { projectId: options.projectId, path: output, assetsProcessed, blocksWritten, skipped };
}

export async function searchAssetBlocks(
  workspaceRoot: string,
  options: { projectId: string; query: string; limit?: number },
): Promise<AssetBlockSearchHit[]> {
  return (await searchAssetBlocksWithReport(workspaceRoot, options)).hits;
}

export async function searchAssetBlocksWithReport(
  workspaceRoot: string,
  options: { projectId: string; query: string; limit?: number; retrievalMode?: "lexical" | "vector" | "hybrid"; embeddingGatewayUrl?: string; embeddingApiKey?: string; embeddingTimeoutMs?: number; localEmbedder?: LocalTextEmbedder },
): Promise<AssetBlockSearchReport> {
  const requestedMode = options.retrievalMode ?? "lexical";
  const blocks = await readJsonlFile<AssetBlock>(assetBlocksPath(workspaceRoot, options.projectId));
  let semanticState = requestedMode === "lexical"
    ? disabledSemanticState()
    : semanticStateFromIndex(await readAssetVectorIndexSummary(workspaceRoot, options.projectId));
  let vectorHits: Awaited<ReturnType<typeof searchAssetVectors>> = [];
  if (semanticState.state === "ready") {
    try {
      vectorHits = await searchAssetVectors(workspaceRoot, {
        projectId: options.projectId,
        query: options.query,
        limit: Math.max(options.limit ?? 20, 50),
        gatewayUrl: options.embeddingGatewayUrl,
        apiKey: options.embeddingApiKey,
        timeoutMs: options.embeddingTimeoutMs,
        embedder: options.localEmbedder,
      });
    } catch (error) {
      semanticState = {
        ...semanticState,
        state: semanticState.backend === "tdai_embedding" ? "blocked_embedding_bridge_unavailable" : "blocked_local_embedding_unavailable",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
  const semanticScores = new Map(vectorHits.map((hit) => [hit.blockId, hit.score]));
  const lexicalScores = new Map<string, number>();
  for (const block of blocks) {
    const lexical = scoreText(options.query, block.text);
    lexicalScores.set(block.blockId, lexical);
  }
  const blockById = new Map(blocks.map((block) => [block.blockId, block]));
  const lexicalRanked = requestedMode === "vector"
    ? []
    : blocks
      .filter((block) => (lexicalScores.get(block.blockId) ?? 0) > 0)
      .sort((a, b) => (lexicalScores.get(b.blockId) ?? 0) - (lexicalScores.get(a.blockId) ?? 0) || assetAuthorityRank(b) - assetAuthorityRank(a) || a.assetPath.localeCompare(b.assetPath) || a.lineNo - b.lineNo)
      .slice(0, RETRIEVAL_CANDIDATE_LIMIT);
  const vectorRanked = requestedMode === "lexical" ? [] : vectorHits.slice(0, RETRIEVAL_CANDIDATE_LIMIT);
  const lexicalRanks = new Map(lexicalRanked.map((block, index) => [block.blockId, index + 1]));
  const vectorRanks = new Map(vectorRanked.map((hit, index) => [hit.blockId, index + 1]));
  const candidateIds = new Set([...lexicalRanks.keys(), ...vectorRanks.keys()]);
  const semanticReady = semanticState.state === "ready";
  const hits = [...candidateIds]
    .map((blockId): AssetBlockSearchHit | undefined => {
      const block = blockById.get(blockId);
      if (!block) return undefined;
      const lexical = lexicalScores.get(blockId) ?? 0;
      const semantic = semanticScores.get(blockId);
      const lexicalRank = lexicalRanks.get(blockId);
      const vectorRank = vectorRanks.get(blockId);
      const combined = requestedMode === "lexical" || (requestedMode === "hybrid" && !semanticReady)
        ? lexical
        : requestedMode === "vector"
          ? semantic ?? 0
          : (lexicalRank ? 1 / (RRF_K + lexicalRank) : 0) + (vectorRank ? 1 / (RRF_K + vectorRank) : 0);
      const retrievalMode: AssetBlockSearchHit["retrievalMode"] =
        lexical > 0 && semantic !== undefined
          ? "hybrid"
          : semantic !== undefined
            ? "vector"
            : "lexical";
      return {
        ...block,
        score: combined,
        retrievalMode,
        scoreBreakdown: { lexical, semantic, combined },
        semanticState,
      };
    })
    .filter((hit): hit is AssetBlockSearchHit => Boolean(hit && hit.score > 0))
    .sort((a, b) => b.score - a.score || assetAuthorityRank(b) - assetAuthorityRank(a) || a.assetPath.localeCompare(b.assetPath) || a.lineNo - b.lineNo)
    .slice(0, options.limit ?? DEFAULT_RETRIEVAL_LIMIT);
  return {
    projectId: options.projectId,
    query: options.query,
    retrievalMode: requestedMode,
    semanticState,
    hits,
  };
}
