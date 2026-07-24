import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, sep } from "node:path";
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

export interface StoredLibraryDocumentV1 {
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
  /** Published only by the SQLite authority; legacy JSON has no content ref. */
  contentBlobRefId?: string;
}

export interface StoredLibraryCatalogV1 {
  schemaVersion: 1;
  scope: LibraryScope;
  documents: StoredLibraryDocumentV1[];
  updatedAt: string;
}

type StoredLibraryDocument = StoredLibraryDocumentV1;
type StoredLibraryCatalog = StoredLibraryCatalogV1;

export interface LibraryBlockV1 extends AssetBlock {
  documentId: string;
}

export interface LibraryMetadataFileV1 {
  schemaVersion: 1;
  scope: LibraryScope;
  documents: StoredLibraryDocumentV1[];
  blocks: LibraryBlockV1[];
  updatedAt: string;
}

export interface LibraryPersistence {
  read(scope: LibraryScope): Promise<LibraryMetadataFileV1 | null>;
  write(scope: LibraryScope, value: LibraryMetadataFileV1, expected: LibraryMetadataFileV1 | null): Promise<void>;
  putDocument(input: {
    scope: LibraryScope;
    documentId: string;
    originalName: string;
    bytes: Uint8Array;
    expectedSha256: string;
  }): Promise<{ managedRelPath: string; contentBlobRefId?: string }>;
  materializeDocument(scope: LibraryScope, document: StoredLibraryDocumentV1): Promise<{ path: string; cleanup?: () => Promise<void> }>;
  removeDocument(scope: LibraryScope, document: StoredLibraryDocumentV1): Promise<void>;
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

type LibraryBlock = LibraryBlockV1;

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

export function libraryCatalogPath(runtimeRoot: string, scope: LibraryScope): string {
  return join(libraryScopeRoot(runtimeRoot, scope), "catalog.json");
}

export function libraryBlocksPath(runtimeRoot: string, scope: LibraryScope): string {
  return join(libraryScopeRoot(runtimeRoot, scope), "blocks.jsonl");
}

export function libraryVectorsPath(runtimeRoot: string, scope: LibraryScope): string {
  return join(libraryScopeRoot(runtimeRoot, scope), "vectors.jsonl");
}

const SQLITE_AUTHORITY_MARKER = "data/runtime/assistant-library-sqlite-v1/authority-v1.json";

function isoTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO timestamp.`);
  return value;
}

function parseLibraryScope(value: unknown, label: string): LibraryScope {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid.`);
  const row = value as Record<string, unknown>;
  if (row.kind === "personal") return { kind: "personal" };
  if (row.kind === "project" && typeof row.projectId === "string") {
    return { kind: "project", projectId: validateProjectId(row.projectId) };
  }
  throw new Error(`${label} is invalid.`);
}

function parseLibraryDocument(value: unknown, label: string): StoredLibraryDocumentV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid.`);
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !row.id.trim()
    || typeof row.originalName !== "string" || !row.originalName.trim()
    || typeof row.managedRelPath !== "string" || !row.managedRelPath.trim()
    || typeof row.sourceDigest !== "string" || !/^[a-f0-9]{64}$/u.test(row.sourceDigest)
    || typeof row.sizeBytes !== "number" || !Number.isSafeInteger(row.sizeBytes) || row.sizeBytes < 0
    || typeof row.extension !== "string" || !row.extension.startsWith(".")
    || !Number.isFinite(Date.parse(String(row.importedAt))) || !Number.isFinite(Date.parse(String(row.updatedAt)))
    || !Number.isSafeInteger(row.blockCount) || Number(row.blockCount) < 0
    || !Array.isArray(row.parserVersions) || !row.parserVersions.every((entry) => typeof entry === "string" && Boolean(entry.trim()))) {
    throw new Error(`${label} has invalid fields.`);
  }
  if (row.contentBlobRefId !== undefined && (typeof row.contentBlobRefId !== "string" || !/^[a-f0-9]{64}$/u.test(row.contentBlobRefId))) {
    throw new Error(`${label}.contentBlobRefId is invalid.`);
  }
  return {
    id: row.id.trim(),
    originalName: row.originalName,
    managedRelPath: row.managedRelPath,
    sourceDigest: row.sourceDigest,
    sizeBytes: Number(row.sizeBytes),
    extension: row.extension,
    importedAt: isoTimestamp(row.importedAt, `${label}.importedAt`),
    updatedAt: isoTimestamp(row.updatedAt, `${label}.updatedAt`),
    blockCount: Number(row.blockCount),
    parserVersions: row.parserVersions as string[],
    ...(typeof row.contentBlobRefId === "string" ? { contentBlobRefId: row.contentBlobRefId } : {}),
  };
}

function parseLibraryBlock(value: unknown, label: string): LibraryBlockV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid.`);
  const row = value as Record<string, unknown>;
  if (typeof row.blockId !== "string" || !row.blockId.trim()
    || typeof row.documentId !== "string" || !row.documentId.trim()
    || typeof row.assetPath !== "string"
    || !Number.isSafeInteger(row.lineNo) || Number(row.lineNo) < 1
    || !["heading", "table", "text", "image"].includes(String(row.blockType))
    || typeof row.text !== "string"
    || !["text_asset", "docx_asset", "pptx_asset", "pdf_asset", "xlsx_asset", "image_asset"].includes(String(row.sourceEngine))
    || (row.sourceDigest !== undefined && (typeof row.sourceDigest !== "string" || !/^[a-f0-9]{64}$/u.test(row.sourceDigest)))) {
    throw new Error(`${label} has invalid fields.`);
  }
  return {
    blockId: row.blockId,
    documentId: row.documentId,
    assetPath: row.assetPath,
    lineNo: Number(row.lineNo),
    blockType: row.blockType as AssetBlock["blockType"],
    text: row.text,
    sourceEngine: row.sourceEngine as AssetBlock["sourceEngine"],
    ...(typeof row.role === "string" ? { role: row.role } : {}),
    ...(typeof row.parserKind === "string" ? { parserKind: row.parserKind } : {}),
    ...(typeof row.typedRowId === "string" ? { typedRowId: row.typedRowId } : {}),
    ...(typeof row.authorityTier === "string" ? { authorityTier: row.authorityTier } : {}),
    ...(typeof row.sourceDigest === "string" ? { sourceDigest: row.sourceDigest } : {}),
    ...(typeof row.page === "number" ? { page: row.page } : {}),
    ...(typeof row.sheet === "string" ? { sheet: row.sheet } : {}),
    ...(typeof row.slide === "number" ? { slide: row.slide } : {}),
    ...(Array.isArray(row.bbox) ? { bbox: row.bbox as [number, number, number, number] } : {}),
    ...(typeof row.parserVersion === "string" ? { parserVersion: row.parserVersion } : {}),
  };
}

export function parseLibraryMetadataFile(value: unknown, label = "Library metadata"): LibraryMetadataFileV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid.`);
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== 1 || !row.scope || !Array.isArray(row.documents) || !Array.isArray(row.blocks)) throw new Error(`${label} schema is invalid.`);
  const scope = parseLibraryScope(row.scope, `${label}.scope`);
  const documents = row.documents.map((document, index) => parseLibraryDocument(document, `${label}.documents[${index}]`));
  const blocks = row.blocks.map((block, index) => parseLibraryBlock(block, `${label}.blocks[${index}]`));
  if (new Set(documents.map((document) => document.id)).size !== documents.length
    || blocks.some((block) => !documents.some((document) => document.id === block.documentId))) {
    throw new Error(`${label} contains duplicate document IDs or orphan blocks.`);
  }
  return { schemaVersion: 1, scope, documents, blocks, updatedAt: isoTimestamp(row.updatedAt, `${label}.updatedAt`) };
}

function sameScope(left: LibraryScope, right: LibraryScope): boolean {
  return left.kind === right.kind && (left.kind === "personal" || (right.kind === "project" && left.projectId === right.projectId));
}

function defaultCatalog(scope: LibraryScope): StoredLibraryCatalog {
  return { schemaVersion: 1, scope, documents: [], updatedAt: new Date(0).toISOString() };
}

function defaultMetadata(scope: LibraryScope): LibraryMetadataFileV1 {
  return { ...defaultCatalog(scope), blocks: [] };
}

async function assertLegacyAuthorityAvailable(runtimeRoot: string): Promise<void> {
  try {
    await stat(join(runtimeRoot, SQLITE_AUTHORITY_MARKER));
    throw new Error("SQLite Library storage is authoritative; legacy JSON Library access is read-only and must use the injected store.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function readLegacyMetadata(runtimeRoot: string, scope: LibraryScope): Promise<LibraryMetadataFileV1> {
  await assertLegacyAuthorityAvailable(runtimeRoot);
  const catalogValue = await readJsonFile<unknown>(libraryCatalogPath(runtimeRoot, scope), defaultCatalog(scope));
  const catalog = catalogValue && typeof catalogValue === "object" && !Array.isArray(catalogValue)
    ? catalogValue as Record<string, unknown>
    : null;
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog) || catalog.schemaVersion !== 1 || !catalog.scope || !Array.isArray(catalog.documents)) {
    throw new Error("Library catalog scope or schema does not match its managed storage root.");
  }
  const blocks = await readJsonlFile<unknown>(libraryBlocksPath(runtimeRoot, scope));
  return parseLibraryMetadataFile({ ...catalog, blocks }, "Legacy Library metadata");
}

function legacyLibraryPersistence(runtimeRoot: string): LibraryPersistence {
  return {
    async read(scope) {
      const catalogFile = await readLegacyMetadata(runtimeRoot, scope);
      return catalogFile;
    },
    async write(scope, value, expected) {
      await assertLegacyAuthorityAvailable(runtimeRoot);
      if (!sameScope(value.scope, scope)) throw new Error("Library metadata scope does not match its managed storage root.");
      const current = await readLegacyMetadata(runtimeRoot, scope);
      if (expected && !sameJson(current, expected)) throw new Error(`Library ${scope.kind} metadata revision conflict.`);
      await writeJsonFile(libraryCatalogPath(runtimeRoot, scope), { schemaVersion: 1, scope, documents: value.documents, updatedAt: value.updatedAt });
      await writeJsonlAtomic(libraryBlocksPath(runtimeRoot, scope), value.blocks);
    },
    async putDocument(input) {
      await assertLegacyAuthorityAvailable(runtimeRoot);
      const managedRelPath = join("sources", input.documentId, safeName(input.originalName));
      const target = join(libraryScopeRoot(runtimeRoot, input.scope), managedRelPath);
      const digest = createHash("sha256").update(input.bytes).digest("hex");
      if (digest !== input.expectedSha256) throw new Error(`Library source digest mismatch for ${input.originalName}.`);
      const quarantine = `${target}.quarantine-${process.pid}-${Date.now()}`;
      await mkdir(dirname(target), { recursive: true });
      await writeFile(quarantine, Buffer.from(input.bytes), { flag: "wx", mode: 0o600 });
      const copied = await sha256File(quarantine);
      if (copied.digest !== input.expectedSha256 || copied.sizeBytes !== input.bytes.byteLength) {
        await rm(quarantine, { force: true });
        throw new Error(`Library source copy verification failed for ${input.originalName}.`);
      }
      await rename(quarantine, target);
      return { managedRelPath };
    },
    async materializeDocument(scope, document) {
      return { path: managedPath(runtimeRoot, scope, document) };
    },
    async removeDocument(scope, document) {
      await assertLegacyAuthorityAvailable(runtimeRoot);
      await rm(join(libraryScopeRoot(runtimeRoot, scope), "sources", document.id), { recursive: true, force: true });
    },
  };
}

function managedPath(runtimeRoot: string, scope: LibraryScope, document: StoredLibraryDocumentV1): string {
  const root = libraryScopeRoot(runtimeRoot, scope);
  const path = join(root, document.managedRelPath);
  const rel = relative(root, path);
  if (!rel || rel.startsWith("..") || isAbsolute(rel) || rel.split(sep).includes("..")) throw new Error("Library document path escapes its managed scope.");
  return path;
}

function publicDocument(runtimeRoot: string, scope: LibraryScope, document: StoredLibraryDocument): LibraryDocument {
  const { managedRelPath: _managedRelPath, contentBlobRefId: _contentBlobRefId, ...rest } = document;
  return { ...rest, scope, managedPath: managedPath(runtimeRoot, scope, document) };
}

async function readMetadata(runtimeRoot: string, scope: LibraryScope, persistence?: LibraryPersistence): Promise<LibraryMetadataFileV1> {
  const value = persistence ? await persistence.read(scope) : await legacyLibraryPersistence(runtimeRoot).read(scope);
  return value ?? defaultMetadata(scope);
}

export async function readLibraryCatalog(runtimeRoot: string, scope: LibraryScope, options: { persistence?: LibraryPersistence } = {}): Promise<LibraryCatalog> {
  const catalog = await readMetadata(runtimeRoot, scope, options.persistence);
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

async function rebuildBlocks(
  scope: LibraryScope,
  catalog: StoredLibraryCatalog,
  persistence: LibraryPersistence,
): Promise<LibraryBlock[]> {
  const blocks: LibraryBlock[] = [];
  const nextDocuments: StoredLibraryDocument[] = [];
  for (const document of catalog.documents) {
    const materialized = await persistence.materializeDocument(scope, document);
    let extracted: ExtractedDocumentBlock[];
    try {
      extracted = await extractBlocks(materialized.path, document.extension);
    } finally {
      await materialized.cleanup?.();
    }
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
  return blocks;
}

export async function reindexLibrary(
  runtimeRoot: string,
  options: { scope: LibraryScope; semantic?: boolean; embedder?: LocalTextEmbedder; persistence?: LibraryPersistence },
): Promise<LibraryIndexReport> {
  const persistence = options.persistence ?? legacyLibraryPersistence(runtimeRoot);
  const metadata = await readMetadata(runtimeRoot, options.scope, persistence);
  const catalog: StoredLibraryCatalog = { schemaVersion: 1, scope: metadata.scope, documents: metadata.documents, updatedAt: metadata.updatedAt };
  const blocks = await rebuildBlocks(options.scope, catalog, persistence);
  catalog.updatedAt = new Date().toISOString();
  await persistence.write(options.scope, { schemaVersion: 1, scope: options.scope, documents: catalog.documents, blocks, updatedAt: catalog.updatedAt }, metadata);
  if (options.semantic === false) {
    await rm(libraryVectorsPath(runtimeRoot, options.scope), { force: true });
    return { scope: options.scope, documents: catalog.documents.map((document) => publicDocument(runtimeRoot, options.scope, document)), blocks: blocks.length, semanticState: "lexical_only" };
  }
  let embedder = options.embedder;
  if (!embedder) {
    const pack = await inspectLocalEmbeddingPack(runtimeRoot);
    if (pack.state !== "ready") {
      await rm(libraryVectorsPath(runtimeRoot, options.scope), { force: true });
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
    await writeAssetVectorRecords(libraryVectorsPath(runtimeRoot, options.scope), built.records);
    return {
      scope: options.scope,
      documents: catalog.documents.map((document) => publicDocument(runtimeRoot, options.scope, document)),
      blocks: blocks.length,
      semanticState: "ready",
      embeddingModel: embedder.model,
      message: built.skipped.length ? `${built.skipped.length} empty block(s) were not indexed.` : undefined,
    };
  } catch (error) {
    await rm(libraryVectorsPath(runtimeRoot, options.scope), { force: true });
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
  options: { scope: LibraryScope; sourcePaths: string[]; semantic?: boolean; embedder?: LocalTextEmbedder; persistence?: LibraryPersistence },
): Promise<LibraryIndexReport> {
  if (!Array.isArray(options.sourcePaths) || !options.sourcePaths.length) throw new Error("Choose at least one document to import into Library.");
  const persistence = options.persistence ?? legacyLibraryPersistence(runtimeRoot);
  const metadata = await readMetadata(runtimeRoot, options.scope, persistence);
  const catalog: StoredLibraryCatalog = { schemaVersion: 1, scope: metadata.scope, documents: metadata.documents, updatedAt: metadata.updatedAt };
  const documents = new Map(catalog.documents.map((document) => [document.id, document]));
  for (const selectedPath of options.sourcePaths) {
    const source = await realpath(selectedPath);
    const info = await stat(source);
    if (!info.isFile()) throw new Error(`Library import accepts explicitly selected files only: ${selectedPath}`);
    const extension = extname(source).toLocaleLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(extension)) throw new Error(`Library does not support ${extension || "extensionless"} documents yet.`);
    const bytes = await readFile(source);
    const digest = createHash("sha256").update(bytes).digest("hex");
    const sizeBytes = bytes.byteLength;
    const id = `library_${digest.slice(0, 24)}`;
    const originalName = safeName(basename(source));
    if (!documents.has(id)) {
      const stored = await persistence.putDocument({ scope: options.scope, documentId: id, originalName, bytes, expectedSha256: digest });
      const now = new Date().toISOString();
      documents.set(id, {
        id,
        originalName,
        managedRelPath: stored.managedRelPath,
        sourceDigest: digest,
        sizeBytes,
        extension,
        importedAt: now,
        updatedAt: now,
        blockCount: 0,
        parserVersions: [],
        ...(stored.contentBlobRefId ? { contentBlobRefId: stored.contentBlobRefId } : {}),
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
  await persistence.write(options.scope, { schemaVersion: 1, scope: options.scope, documents: next.documents, blocks: metadata.blocks, updatedAt: next.updatedAt }, metadata);
  return reindexLibrary(runtimeRoot, { scope: options.scope, semantic: options.semantic, embedder: options.embedder, persistence });
}

export async function removeLibraryDocument(
  runtimeRoot: string,
  options: { scope: LibraryScope; documentId: string; embedder?: LocalTextEmbedder; persistence?: LibraryPersistence },
): Promise<LibraryIndexReport> {
  const persistence = options.persistence ?? legacyLibraryPersistence(runtimeRoot);
  const metadata = await readMetadata(runtimeRoot, options.scope, persistence);
  const catalog: StoredLibraryCatalog = { schemaVersion: 1, scope: metadata.scope, documents: metadata.documents, updatedAt: metadata.updatedAt };
  const document = catalog.documents.find((candidate) => candidate.id === options.documentId);
  if (!document) throw new Error(`Library document not found in this scope: ${options.documentId}`);
  catalog.documents = catalog.documents.filter((candidate) => candidate.id !== options.documentId);
  catalog.updatedAt = new Date().toISOString();
  await persistence.write(options.scope, { schemaVersion: 1, scope: options.scope, documents: catalog.documents, blocks: metadata.blocks.filter((block) => block.documentId !== document.id), updatedAt: catalog.updatedAt }, metadata);
  // Metadata is authoritative; remove only the derived managed source after the CAS commit.
  // If cleanup fails, the source/blob remains recoverable and can be collected by a later gate.
  await persistence.removeDocument(options.scope, document);
  return reindexLibrary(runtimeRoot, { scope: options.scope, embedder: options.embedder, persistence });
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
  options: { scope: LibraryScope; query: string; retrievalMode: LibraryRetrievalMode; embedder?: LocalTextEmbedder; persistence?: LibraryPersistence },
): Promise<LibrarySearchReport> {
  const catalog = await readLibraryCatalog(runtimeRoot, options.scope, { persistence: options.persistence });
  const documents = new Map(catalog.documents.map((document) => [document.id, document]));
  const blocks = (await readMetadata(runtimeRoot, options.scope, options.persistence)).blocks;
  const lexicalScores = new Map(blocks.map((block) => [block.blockId, lexicalScore(options.query, block.text)]));
  const lexical = options.retrievalMode === "vector" ? [] : blocks
    .filter((block) => (lexicalScores.get(block.blockId) ?? 0) > 0)
    .sort((left, right) => (lexicalScores.get(right.blockId) ?? 0) - (lexicalScores.get(left.blockId) ?? 0) || left.blockId.localeCompare(right.blockId))
    .slice(0, CANDIDATE_LIMIT);
  let semanticState: LibrarySearchReport["semanticState"] = { state: "lexical_only" };
  let semantic: Awaited<ReturnType<typeof searchLocalAssetVectorRecords>> = [];
  if (options.retrievalMode !== "lexical") {
    const rows = await readJsonlFile<AssetVectorRecord>(libraryVectorsPath(runtimeRoot, options.scope));
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
  options: { scope: LibraryScope; query: string; includePersonal?: boolean; retrievalMode?: LibraryRetrievalMode; limit?: number; embedder?: LocalTextEmbedder; persistence?: LibraryPersistence },
): Promise<LibrarySearchReport> {
  const query = options.query.trim();
  if (!query) throw new Error("Library search query is required.");
  const retrievalMode = options.retrievalMode ?? "hybrid";
  const scopes: LibraryScope[] = options.scope.kind === "project" && options.includePersonal !== false
    ? [options.scope, { kind: "personal" }]
    : [options.scope];
  const reports = await Promise.all(scopes.map((scope) => searchSingleScope(runtimeRoot, { scope, query, retrievalMode, embedder: options.embedder, persistence: options.persistence })));
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
