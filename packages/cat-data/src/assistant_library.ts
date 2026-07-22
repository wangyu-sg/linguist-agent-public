import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, sep } from "node:path";
import {
  createLocalAssetVectorRecords,
  searchLocalAssetVectorRecords,
  writeAssetVectorRecords,
  type AssetVectorRecord,
} from "./asset_vectors.js";
import type { AssetBlock } from "./asset_blocks.js";
import {
  extractDocxBlocks,
  extractImageBlocks,
  extractPdfBlocks,
  extractPptxBlocks,
  extractXlsxBlocks,
  type ExtractedDocumentBlock,
} from "./document_assets.js";
import {
  createLocalE5Embedder,
  inspectLocalEmbeddingPack,
  LOCAL_E5_MODEL_NAME,
  type LocalTextEmbedder,
} from "./local_embeddings.js";
import { readJsonFile, readJsonlFile, writeJsonFile } from "./workspace.js";

export type LibraryScope = { kind: "personal" } | { kind: "project"; projectId: string };
export type LibraryRetrievalMode = "lexical" | "vector" | "hybrid";

interface StoredLibraryDocument {
  id: string;
  originalName: string;
  managedRelPath: string;
  sourceDigest: string;
  sizeBytes: number;
  extension: string;
  importedAt: string;
  updatedAt: string;
  blockCount: number;
  parserVersions: string[];
}

interface StoredLibraryCatalog {
  schemaVersion: 1;
  scope: LibraryScope;
  documents: StoredLibraryDocument[];
  updatedAt: string;
}

export interface LibraryDocument extends Omit<StoredLibraryDocument, "managedRelPath"> {
  scope: LibraryScope;
  managedPath: string;
}

export interface LibraryCatalog {
  schemaVersion: 1;
  scope: LibraryScope;
  documents: LibraryDocument[];
  updatedAt: string;
}

interface LibraryBlock extends AssetBlock {
  documentId: string;
}

export interface LibraryIndexReport {
  scope: LibraryScope;
  documents: LibraryDocument[];
  blocks: number;
  semanticState: "ready" | "lexical_only" | "blocked";
  embeddingModel?: string;
  message?: string;
}

export interface LibrarySearchHit extends LibraryBlock {
  scope: LibraryScope;
  documentId: string;
  originalName: string;
  managedPath: string;
  score: number;
  retrievalMode: "lexical" | "vector" | "hybrid";
  scoreBreakdown: { lexical: number; semantic?: number; combined: number };
}

export interface LibrarySearchReport {
  scope: LibraryScope;
  query: string;
  retrievalMode: LibraryRetrievalMode;
  semanticState: {
    state: "ready" | "lexical_only" | "blocked";
    embeddingModel?: string;
    message?: string;
  };
  hits: LibrarySearchHit[];
}

const SUPPORTED_EXTENSIONS = new Set([".md", ".txt", ".csv", ".tsv", ".docx", ".pptx", ".pdf", ".xlsx", ".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp"]);
const RRF_K = 60;
const CANDIDATE_LIMIT = 50;

function validateProjectId(projectId: string): string {
  const value = projectId.trim();
  if (!value || value === "." || value === ".." || value.includes("/") || value.includes("\\") || value.includes("\0")) {
    throw new Error("Project Library requires a safe projectId.");
  }
  return value;
}

export function libraryScopeRoot(runtimeRoot: string, scope: LibraryScope): string {
  return scope.kind === "personal"
    ? join(runtimeRoot, "data", "assistant", "library", "personal")
    : join(runtimeRoot, "data", "projects", validateProjectId(scope.projectId), "library");
}

function catalogPath(runtimeRoot: string, scope: LibraryScope): string {
  return join(libraryScopeRoot(runtimeRoot, scope), "catalog.json");
}

function blocksPath(runtimeRoot: string, scope: LibraryScope): string {
  return join(libraryScopeRoot(runtimeRoot, scope), "blocks.jsonl");
}

function vectorsPath(runtimeRoot: string, scope: LibraryScope): string {
  return join(libraryScopeRoot(runtimeRoot, scope), "vectors.jsonl");
}

function sameScope(left: LibraryScope, right: LibraryScope): boolean {
  return left.kind === right.kind && (left.kind === "personal" || (right.kind === "project" && left.projectId === right.projectId));
}

function defaultCatalog(scope: LibraryScope): StoredLibraryCatalog {
  return { schemaVersion: 1, scope, documents: [], updatedAt: new Date(0).toISOString() };
}

async function readStoredCatalog(runtimeRoot: string, scope: LibraryScope): Promise<StoredLibraryCatalog> {
  const catalog = await readJsonFile<StoredLibraryCatalog>(catalogPath(runtimeRoot, scope), defaultCatalog(scope));
  if (catalog.schemaVersion !== 1 || !sameScope(catalog.scope, scope) || !Array.isArray(catalog.documents)) {
    throw new Error("Library catalog scope or schema does not match its managed storage root.");
  }
  return catalog;
}

function managedPath(runtimeRoot: string, scope: LibraryScope, document: StoredLibraryDocument): string {
  const root = libraryScopeRoot(runtimeRoot, scope);
  const path = join(root, document.managedRelPath);
  const rel = relative(root, path);
  if (!rel || rel.startsWith("..") || isAbsolute(rel) || rel.split(sep).includes("..")) throw new Error("Library document path escapes its managed scope.");
  return path;
}

function publicDocument(runtimeRoot: string, scope: LibraryScope, document: StoredLibraryDocument): LibraryDocument {
  const { managedRelPath: _managedRelPath, ...rest } = document;
  return { ...rest, scope, managedPath: managedPath(runtimeRoot, scope, document) };
}

export async function readLibraryCatalog(runtimeRoot: string, scope: LibraryScope): Promise<LibraryCatalog> {
  const catalog = await readStoredCatalog(runtimeRoot, scope);
  return {
    schemaVersion: 1,
    scope,
    documents: catalog.documents.map((document) => publicDocument(runtimeRoot, scope, document)),
    updatedAt: catalog.updatedAt,
  };
}

async function sha256File(path: string): Promise<{ digest: string; sizeBytes: number }> {
  const value = await readFile(path);
  return { digest: createHash("sha256").update(value).digest("hex"), sizeBytes: value.byteLength };
}

function safeName(value: string): string {
  const clean = value.normalize("NFKC").replace(/[\0/\\]/g, "-").replace(/^\.+/, "").trim();
  return clean.slice(0, 180) || "document";
}

function textBlocks(text: string): ExtractedDocumentBlock[] {
  return text.split(/\r?\n/).flatMap((raw, index) => {
    const value = raw.trim();
    if (!value) return [];
    return [{
      ordinal: index + 1,
      blockType: /^\s{0,3}#{1,6}\s+/.test(raw) ? "heading" as const : value.startsWith("|") && value.includes("|", 1) ? "table" as const : "text" as const,
      text: value,
      parserVersion: "la-library-text-v1",
    }];
  });
}

async function extractBlocks(path: string, extension: string): Promise<ExtractedDocumentBlock[]> {
  if (extension === ".docx") return extractDocxBlocks(path);
  if (extension === ".pptx") return extractPptxBlocks(path);
  if (extension === ".pdf") return extractPdfBlocks(path);
  if (extension === ".xlsx") return extractXlsxBlocks(path);
  if (IMAGE_EXTENSIONS.has(extension)) return extractImageBlocks(path);
  return textBlocks(await readFile(path, "utf8"));
}

function sourceEngine(extension: string): AssetBlock["sourceEngine"] {
  if (extension === ".docx") return "docx_asset";
  if (extension === ".pptx") return "pptx_asset";
  if (extension === ".pdf") return "pdf_asset";
  if (extension === ".xlsx") return "xlsx_asset";
  if (IMAGE_EXTENSIONS.has(extension)) return "image_asset";
  return "text_asset";
}

async function writeJsonlAtomic(path: string, rows: unknown[]): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  const content = rows.map((row) => JSON.stringify(row)).join("\n");
  try {
    await writeFile(temporary, content ? `${content}\n` : "", "utf8");
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function rebuildBlocks(runtimeRoot: string, scope: LibraryScope, catalog: StoredLibraryCatalog): Promise<LibraryBlock[]> {
  const blocks: LibraryBlock[] = [];
  const nextDocuments: StoredLibraryDocument[] = [];
  for (const document of catalog.documents) {
    const path = managedPath(runtimeRoot, scope, document);
    const extracted = await extractBlocks(path, document.extension);
    const parserVersions = new Set<string>();
    for (const block of extracted) {
      const parserVersion = block.parserVersion ?? "la-document-assets-v1";
      parserVersions.add(parserVersion);
      blocks.push({
        documentId: document.id,
        blockId: `${document.id}:${block.ordinal}`,
        assetPath: document.originalName,
        lineNo: block.ordinal,
        blockType: block.blockType,
        text: block.text,
        sourceEngine: sourceEngine(document.extension),
        role: scope.kind === "project" ? "project_library" : "personal_library",
        sourceDigest: document.sourceDigest,
        page: block.page,
        sheet: block.sheet,
        slide: block.slide,
        bbox: block.bbox,
        parserVersion,
      });
    }
    nextDocuments.push({ ...document, blockCount: extracted.length, parserVersions: [...parserVersions].sort() });
  }
  catalog.documents = nextDocuments;
  await writeJsonlAtomic(blocksPath(runtimeRoot, scope), blocks);
  return blocks;
}

export async function reindexLibrary(
  runtimeRoot: string,
  options: { scope: LibraryScope; semantic?: boolean; embedder?: LocalTextEmbedder },
): Promise<LibraryIndexReport> {
  const catalog = await readStoredCatalog(runtimeRoot, options.scope);
  const blocks = await rebuildBlocks(runtimeRoot, options.scope, catalog);
  catalog.updatedAt = new Date().toISOString();
  await writeJsonFile(catalogPath(runtimeRoot, options.scope), catalog);
  if (options.semantic === false) {
    await rm(vectorsPath(runtimeRoot, options.scope), { force: true });
    return { scope: options.scope, documents: catalog.documents.map((document) => publicDocument(runtimeRoot, options.scope, document)), blocks: blocks.length, semanticState: "lexical_only" };
  }
  let embedder = options.embedder;
  if (!embedder) {
    const pack = await inspectLocalEmbeddingPack(runtimeRoot);
    if (pack.state !== "ready") {
      await rm(vectorsPath(runtimeRoot, options.scope), { force: true });
      return {
        scope: options.scope,
        documents: catalog.documents.map((document) => publicDocument(runtimeRoot, options.scope, document)),
        blocks: blocks.length,
        semanticState: "lexical_only",
        message: pack.message,
      };
    }
    embedder = await createLocalE5Embedder(runtimeRoot);
  }
  try {
    const built = await createLocalAssetVectorRecords(blocks, embedder);
    await writeAssetVectorRecords(vectorsPath(runtimeRoot, options.scope), built.records);
    return {
      scope: options.scope,
      documents: catalog.documents.map((document) => publicDocument(runtimeRoot, options.scope, document)),
      blocks: blocks.length,
      semanticState: "ready",
      embeddingModel: embedder.model,
      message: built.skipped.length ? `${built.skipped.length} empty block(s) were not indexed.` : undefined,
    };
  } catch (error) {
    await rm(vectorsPath(runtimeRoot, options.scope), { force: true });
    return {
      scope: options.scope,
      documents: catalog.documents.map((document) => publicDocument(runtimeRoot, options.scope, document)),
      blocks: blocks.length,
      semanticState: "blocked",
      embeddingModel: embedder.model,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function importLibraryDocuments(
  runtimeRoot: string,
  options: { scope: LibraryScope; sourcePaths: string[]; semantic?: boolean; embedder?: LocalTextEmbedder },
): Promise<LibraryIndexReport> {
  if (!Array.isArray(options.sourcePaths) || !options.sourcePaths.length) throw new Error("Choose at least one document to import into Library.");
  const root = libraryScopeRoot(runtimeRoot, options.scope);
  const catalog = await readStoredCatalog(runtimeRoot, options.scope);
  const documents = new Map(catalog.documents.map((document) => [document.id, document]));
  await mkdir(join(root, "sources"), { recursive: true });
  for (const selectedPath of options.sourcePaths) {
    const source = await realpath(selectedPath);
    const info = await stat(source);
    if (!info.isFile()) throw new Error(`Library import accepts explicitly selected files only: ${selectedPath}`);
    const extension = extname(source).toLocaleLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(extension)) throw new Error(`Library does not support ${extension || "extensionless"} documents yet.`);
    const { digest, sizeBytes } = await sha256File(source);
    const id = `library_${digest.slice(0, 24)}`;
    const originalName = safeName(basename(source));
    const managedRelPath = join("sources", id, originalName);
    const target = join(root, managedRelPath);
    if (!documents.has(id)) {
      const quarantine = `${target}.quarantine-${process.pid}-${Date.now()}`;
      await mkdir(join(target, ".."), { recursive: true });
      await copyFile(source, quarantine);
      const copied = await sha256File(quarantine);
      if (copied.digest !== digest || copied.sizeBytes !== sizeBytes) {
        await rm(quarantine, { force: true });
        throw new Error(`Library source copy verification failed for ${originalName}.`);
      }
      await rename(quarantine, target);
      const now = new Date().toISOString();
      documents.set(id, {
        id,
        originalName,
        managedRelPath,
        sourceDigest: digest,
        sizeBytes,
        extension,
        importedAt: now,
        updatedAt: now,
        blockCount: 0,
        parserVersions: [],
      });
    }
  }
  const now = new Date().toISOString();
  const next: StoredLibraryCatalog = {
    schemaVersion: 1,
    scope: options.scope,
    documents: [...documents.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id)),
    updatedAt: now,
  };
  await writeJsonFile(catalogPath(runtimeRoot, options.scope), next);
  return reindexLibrary(runtimeRoot, { scope: options.scope, semantic: options.semantic, embedder: options.embedder });
}

export async function removeLibraryDocument(
  runtimeRoot: string,
  options: { scope: LibraryScope; documentId: string; embedder?: LocalTextEmbedder },
): Promise<LibraryIndexReport> {
  const catalog = await readStoredCatalog(runtimeRoot, options.scope);
  const document = catalog.documents.find((candidate) => candidate.id === options.documentId);
  if (!document) throw new Error(`Library document not found in this scope: ${options.documentId}`);
  catalog.documents = catalog.documents.filter((candidate) => candidate.id !== options.documentId);
  catalog.updatedAt = new Date().toISOString();
  await writeJsonFile(catalogPath(runtimeRoot, options.scope), catalog);
  await rm(join(libraryScopeRoot(runtimeRoot, options.scope), "sources", document.id), { recursive: true, force: true });
  return reindexLibrary(runtimeRoot, { scope: options.scope, embedder: options.embedder });
}

const SPLIT_RE = /[\s,.;:!?，。！？、；："'()[\]{}<>《》【】]+/u;

function charBigrams(value: string): Set<string> {
  const compact = value.replace(/\s+/g, "");
  if (compact.length <= 2) return new Set(compact ? [compact] : []);
  const grams = new Set<string>();
  for (let index = 0; index <= compact.length - 2; index += 1) grams.add(compact.slice(index, index + 2));
  return grams;
}

function lexicalScore(query: string, text: string): number {
  const normalizedQuery = query.toLocaleLowerCase().trim();
  const normalizedText = text.toLocaleLowerCase();
  if (!normalizedQuery) return 0;
  if (normalizedText.includes(normalizedQuery)) return 1;
  const tokens = normalizedQuery.split(SPLIT_RE).filter(Boolean);
  const tokenScore = tokens.length ? tokens.filter((token) => normalizedText.includes(token)).length / tokens.length : 0;
  const queryGrams = charBigrams(normalizedQuery);
  const textGrams = charBigrams(normalizedText);
  let intersection = 0;
  for (const gram of queryGrams) if (textGrams.has(gram)) intersection += 1;
  const dice = queryGrams.size && textGrams.size ? (2 * intersection) / (queryGrams.size + textGrams.size) : 0;
  return Math.max(tokenScore, dice);
}

async function searchSingleScope(
  runtimeRoot: string,
  options: { scope: LibraryScope; query: string; retrievalMode: LibraryRetrievalMode; embedder?: LocalTextEmbedder },
): Promise<LibrarySearchReport> {
  const catalog = await readLibraryCatalog(runtimeRoot, options.scope);
  const documents = new Map(catalog.documents.map((document) => [document.id, document]));
  const blocks = await readJsonlFile<LibraryBlock>(blocksPath(runtimeRoot, options.scope));
  const lexicalScores = new Map(blocks.map((block) => [block.blockId, lexicalScore(options.query, block.text)]));
  const lexical = options.retrievalMode === "vector" ? [] : blocks
    .filter((block) => (lexicalScores.get(block.blockId) ?? 0) > 0)
    .sort((left, right) => (lexicalScores.get(right.blockId) ?? 0) - (lexicalScores.get(left.blockId) ?? 0) || left.blockId.localeCompare(right.blockId))
    .slice(0, CANDIDATE_LIMIT);
  let semanticState: LibrarySearchReport["semanticState"] = { state: "lexical_only" };
  let semantic: Awaited<ReturnType<typeof searchLocalAssetVectorRecords>> = [];
  if (options.retrievalMode !== "lexical") {
    const rows = await readJsonlFile<AssetVectorRecord>(vectorsPath(runtimeRoot, options.scope));
    if (rows.length) {
      try {
        const embedder = options.embedder ?? await createLocalE5Embedder(runtimeRoot);
        semantic = await searchLocalAssetVectorRecords(rows, { query: options.query, embedder, limit: CANDIDATE_LIMIT });
        semanticState = { state: "ready", embeddingModel: rows[0]?.embeddingModel ?? LOCAL_E5_MODEL_NAME };
      } catch (error) {
        semanticState = { state: "blocked", message: error instanceof Error ? error.message : String(error) };
      }
    } else {
      const pack = await inspectLocalEmbeddingPack(runtimeRoot);
      semanticState = { state: "lexical_only", message: pack.state === "ready" ? "This Library scope has no semantic index; rebuild it." : pack.message };
    }
  }
  const lexicalRanks = new Map(lexical.map((block, index) => [block.blockId, index + 1]));
  const semanticRanks = new Map(semantic.map((hit, index) => [hit.blockId, index + 1]));
  const semanticScores = new Map(semantic.map((hit) => [hit.blockId, hit.score]));
  const blocksById = new Map(blocks.map((block) => [block.blockId, block]));
  const ids = new Set([...lexicalRanks.keys(), ...semanticRanks.keys()]);
  const hits = [...ids].flatMap((id): LibrarySearchHit[] => {
    const block = blocksById.get(id);
    if (!block) return [];
    const document = documents.get(block.documentId);
    if (!document || document.sourceDigest !== block.sourceDigest) return [];
    const lexicalValue = lexicalScores.get(id) ?? 0;
    const semanticValue = semanticScores.get(id);
    const lexicalRank = lexicalRanks.get(id);
    const semanticRank = semanticRanks.get(id);
    const combined = options.retrievalMode === "lexical" || (options.retrievalMode === "hybrid" && semanticState.state !== "ready")
      ? lexicalValue
      : options.retrievalMode === "vector"
        ? semanticValue ?? 0
        : (lexicalRank ? 1 / (RRF_K + lexicalRank) : 0) + (semanticRank ? 1 / (RRF_K + semanticRank) : 0);
    if (combined <= 0) return [];
    return [{
      ...block,
      scope: options.scope,
      originalName: document.originalName,
      managedPath: document.managedPath,
      score: combined,
      retrievalMode: lexicalValue > 0 && semanticValue !== undefined ? "hybrid" : semanticValue !== undefined ? "vector" : "lexical",
      scoreBreakdown: { lexical: lexicalValue, semantic: semanticValue, combined },
    }];
  }).sort((left, right) => right.score - left.score || left.blockId.localeCompare(right.blockId));
  return { scope: options.scope, query: options.query, retrievalMode: options.retrievalMode, semanticState, hits };
}

export async function searchLibrary(
  runtimeRoot: string,
  options: { scope: LibraryScope; query: string; includePersonal?: boolean; retrievalMode?: LibraryRetrievalMode; limit?: number; embedder?: LocalTextEmbedder },
): Promise<LibrarySearchReport> {
  const query = options.query.trim();
  if (!query) throw new Error("Library search query is required.");
  const retrievalMode = options.retrievalMode ?? "hybrid";
  const scopes: LibraryScope[] = options.scope.kind === "project" && options.includePersonal !== false
    ? [options.scope, { kind: "personal" }]
    : [options.scope];
  const reports = await Promise.all(scopes.map((scope) => searchSingleScope(runtimeRoot, { scope, query, retrievalMode, embedder: options.embedder })));
  const projectAuthority = (scope: LibraryScope) => scope.kind === "project" ? 1 : 0;
  const hits = reports.flatMap((report) => report.hits)
    .sort((left, right) => right.score - left.score || projectAuthority(right.scope) - projectAuthority(left.scope) || left.blockId.localeCompare(right.blockId))
    .slice(0, Math.max(1, Math.min(options.limit ?? 8, 50)));
  const semanticState = reports.some((report) => report.semanticState.state === "blocked")
    ? { state: "blocked" as const, message: reports.find((report) => report.semanticState.state === "blocked")?.semanticState.message }
    : reports.every((report) => report.semanticState.state === "ready")
      ? { state: "ready" as const, embeddingModel: reports[0]?.semanticState.embeddingModel }
      : { state: "lexical_only" as const, message: reports.find((report) => report.semanticState.state !== "ready")?.semanticState.message };
  return { scope: options.scope, query, retrievalMode, semanticState, hits };
}
