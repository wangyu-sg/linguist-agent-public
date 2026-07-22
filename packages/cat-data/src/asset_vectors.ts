import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createWorkspace, readJsonlFile, workspacePath } from "./workspace.js";
import type { AssetBlock } from "./asset_blocks.js";
import {
  createLocalE5Embedder,
  LOCAL_E5_DIM,
  LOCAL_E5_MODEL_NAME,
  type LocalTextEmbedder,
} from "./local_embeddings.js";
import { embedTextsWithTdai, probeTdaiEmbeddingBridge, type TdaiEmbeddingBridgeStatus } from "./tdai_embedding_bridge.js";

export const ASSET_VECTOR_DIM = LOCAL_E5_DIM;
export const ASSET_VECTOR_MODEL = LOCAL_E5_MODEL_NAME;
export const LEGACY_ASSET_VECTOR_DIM = 96;
export const LEGACY_ASSET_VECTOR_MODEL = "la-local-hash-v1";
export type AssetVectorBackend = "local_e5" | "legacy_hash" | "tdai_embedding";
type StoredAssetVectorBackend = AssetVectorBackend | "local_hash";

export interface AssetVectorRecord {
  blockId: string;
  chunkIndex?: number;
  vector: number[];
  embeddingModel: string;
  dim: number;
  builtAt: string;
  backend?: StoredAssetVectorBackend;
  provider?: string;
}

export interface AssetVectorHit {
  blockId: string;
  score: number;
  distance: number;
  embeddingModel: string;
  backend: AssetVectorBackend;
}

export interface AssetVectorBuildReport {
  projectId: string;
  path: string;
  embeddingModel: string;
  backend: AssetVectorBackend;
  provider?: string;
  dim: number;
  indexedBlocks: number;
  indexedChunks: number;
  skipped: Array<{ blockId: string; reason: string }>;
  builtAt: string;
  bridge?: TdaiEmbeddingBridgeStatus;
}

export interface AssetVectorIndexSummary {
  path: string;
  state: "absent" | "legacy" | "ready";
  embeddingModel?: string;
  backend?: AssetVectorBackend;
  provider?: string;
  dim?: number;
  indexedBlocks: number;
  indexedChunks?: number;
  builtAt?: string;
  message?: string;
}

export interface LocalAssetVectorRecords {
  records: AssetVectorRecord[];
  skipped: Array<{ blockId: string; reason: string }>;
  builtAt: string;
}

export function assetVectorsPath(workspaceRoot: string, projectId: string): string {
  return workspacePath(createWorkspace(workspaceRoot, projectId), "asset_vectors.jsonl");
}

function indexedAssetBlocksPath(workspaceRoot: string, projectId: string): string {
  return workspacePath(createWorkspace(workspaceRoot, projectId), "asset_blocks.jsonl");
}

function hashToken(token: string): number {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function terms(value: string): string[] {
  const normalized = value.toLocaleLowerCase().normalize("NFKC");
  const tokens = normalized.split(/[\s,.;:!?，。！？、；："'()[\]{}<>《》【】]+/u).filter(Boolean);
  const cjk = normalized.match(/[\p{Script=Han}]{2,}/gu) ?? [];
  for (const run of cjk) {
    for (let i = 0; i < run.length - 1; i += 1) tokens.push(run.slice(i, i + 2));
  }
  return tokens;
}

/** Read-only compatibility for legacy indexes. New indexes must use multilingual E5. */
export function embedAssetTextLocal(text: string, dim = LEGACY_ASSET_VECTOR_DIM): number[] {
  const vector = Array.from({ length: dim }, () => 0);
  for (const token of terms(text)) {
    const hash = hashToken(token);
    vector[hash % dim] += hash & 1 ? 1 : -1;
  }
  return normalizeVector(vector);
}

export function normalizeVector(vector: number[]): number[] {
  const norm = Math.hypot(...vector);
  return norm > 0 ? vector.map((value) => value / norm) : vector;
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error(`Cannot compare vector dimensions ${a.length} and ${b.length}.`);
  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    aNorm += a[i] * a[i];
    bNorm += b[i] * b[i];
  }
  if (aNorm === 0 || bNorm === 0) return 0;
  return Math.max(0, Math.min(1, dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm))));
}

function normalizedBackend(row: AssetVectorRecord): AssetVectorBackend {
  if (row.backend === "local_hash" || row.backend === "legacy_hash" || row.embeddingModel === LEGACY_ASSET_VECTOR_MODEL) return "legacy_hash";
  if (row.backend === "tdai_embedding") return "tdai_embedding";
  return "local_e5";
}

function validateIndexRows(rows: AssetVectorRecord[]): { backend: AssetVectorBackend; model: string; dim: number } | undefined {
  if (!rows.length) return undefined;
  const first = rows[0];
  const backend = normalizedBackend(first);
  for (const row of rows) {
    if (normalizedBackend(row) !== backend || row.embeddingModel !== first.embeddingModel || row.dim !== first.dim || row.vector.length !== first.dim) {
      throw new Error("Asset vector index mixes embedding backends, models, or dimensions; rebuild the index before semantic search.");
    }
  }
  return { backend, model: first.embeddingModel, dim: first.dim };
}

export async function writeAssetVectorRecords(path: string, rows: AssetVectorRecord[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${randomUUID()}`;
  const content = rows.map((row) => JSON.stringify(row)).join("\n");
  await writeFile(temporaryPath, content ? `${content}\n` : "", "utf8");
  await rename(temporaryPath, path);
}

function assertVectors(vectors: number[][], count: number, dim: number, label: string): void {
  if (vectors.length !== count) throw new Error(`${label} returned ${vectors.length} vectors for ${count} texts.`);
  if (vectors.some((vector) => vector.length !== dim)) throw new Error(`${label} returned a vector with the wrong dimension; expected ${dim}.`);
}

export async function buildAssetVectorIndex(
  workspaceRoot: string,
  options: { projectId: string; embedder?: LocalTextEmbedder; batchSize?: number },
): Promise<AssetVectorBuildReport> {
  const path = assetVectorsPath(workspaceRoot, options.projectId);
  const blocks = await readJsonlFile<AssetBlock>(indexedAssetBlocksPath(workspaceRoot, options.projectId));
  const embedder = options.embedder ?? await createLocalE5Embedder(workspaceRoot);
  const { records, skipped, builtAt } = await createLocalAssetVectorRecords(blocks, embedder, options.batchSize);
  await writeAssetVectorRecords(path, records);
  return {
    projectId: options.projectId,
    path,
    embeddingModel: embedder.model,
    backend: "local_e5",
    provider: embedder.provider,
    dim: embedder.dim,
    indexedBlocks: new Set(records.map((row) => row.blockId)).size,
    indexedChunks: records.length,
    skipped,
    builtAt,
  };
}

export async function createLocalAssetVectorRecords(
  blocks: ReadonlyArray<Pick<AssetBlock, "blockId" | "text">>,
  embedder: LocalTextEmbedder,
  requestedBatchSize = 16,
): Promise<LocalAssetVectorRecords> {
  const batchSize = Math.max(1, Math.min(requestedBatchSize, 64));
  const builtAt = new Date().toISOString();
  const skipped: LocalAssetVectorRecords["skipped"] = [];
  const chunks = blocks.flatMap((block) => embedder.split(block.text, 384, 64).map((text, chunkIndex) => ({ block, text, chunkIndex })));
  const records: AssetVectorRecord[] = [];
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const vectors = await embedder.embed(batch.map(({ text }) => `passage: ${text}`));
    assertVectors(vectors, batch.length, embedder.dim, embedder.model);
    for (const [index, item] of batch.entries()) {
      const vector = normalizeVector(vectors[index] ?? []);
      if (!vector.some((value) => value !== 0)) {
        skipped.push({ blockId: item.block.blockId, reason: "empty vector" });
        continue;
      }
      records.push({
        blockId: item.block.blockId,
        chunkIndex: item.chunkIndex,
        vector,
        embeddingModel: embedder.model,
        dim: embedder.dim,
        builtAt,
        backend: "local_e5",
        provider: embedder.provider,
      });
    }
  }
  return { records, skipped, builtAt };
}

export async function buildAssetVectorIndexWithTdai(
  workspaceRoot: string,
  options: { projectId: string; gatewayUrl: string; apiKey?: string; batchSize?: number; timeoutMs?: number },
): Promise<AssetVectorBuildReport> {
  const path = assetVectorsPath(workspaceRoot, options.projectId);
  const blocks = await readJsonlFile<AssetBlock>(indexedAssetBlocksPath(workspaceRoot, options.projectId));
  const builtAt = new Date().toISOString();
  const skipped: AssetVectorBuildReport["skipped"] = [];
  const records: AssetVectorRecord[] = [];
  const bridge = await probeTdaiEmbeddingBridge({ gatewayUrl: options.gatewayUrl, apiKey: options.apiKey, timeoutMs: options.timeoutMs });
  if (bridge.state !== "ready") {
    throw new Error(`TDAI embedding bridge is not ready: ${bridge.state}${bridge.message ? ` · ${bridge.message}` : ""}`);
  }
  const batchSize = Math.max(1, Math.min(options.batchSize ?? 16, 64));
  let embeddingModel = bridge.model ?? "tdai-embedding";
  let provider = bridge.provider ?? "tdai";
  let dim = bridge.dimensions ?? 0;
  for (let i = 0; i < blocks.length; i += batchSize) {
    const batch = blocks.slice(i, i + batchSize);
    const response = await embedTextsWithTdai(
      { gatewayUrl: options.gatewayUrl, apiKey: options.apiKey, timeoutMs: options.timeoutMs },
      batch.map((block) => block.text),
    );
    embeddingModel = response.model;
    provider = response.provider;
    dim = response.dimensions;
    assertVectors(response.vectors, batch.length, dim, embeddingModel);
    for (const [index, block] of batch.entries()) {
      const vector = normalizeVector(response.vectors[index] ?? []);
      if (!vector.some((value) => value !== 0)) {
        skipped.push({ blockId: block.blockId, reason: "empty vector" });
        continue;
      }
      records.push({ blockId: block.blockId, chunkIndex: 0, vector, embeddingModel, dim, builtAt, backend: "tdai_embedding", provider });
    }
  }
  validateIndexRows(records);
  await writeAssetVectorRecords(path, records);
  return {
    projectId: options.projectId,
    path,
    embeddingModel,
    backend: "tdai_embedding",
    provider,
    dim,
    indexedBlocks: new Set(records.map((row) => row.blockId)).size,
    indexedChunks: records.length,
    skipped,
    builtAt,
    bridge,
  };
}

export async function searchLocalAssetVectorRecords(
  rows: AssetVectorRecord[],
  options: { query: string; embedder: LocalTextEmbedder; limit?: number },
): Promise<AssetVectorHit[]> {
  const descriptor = validateIndexRows(rows);
  if (!descriptor) return [];
  if (descriptor.backend !== "local_e5") throw new Error(`Expected a local E5 index, received ${descriptor.backend}.`);
  if (options.embedder.model !== descriptor.model || options.embedder.dim !== descriptor.dim) {
    throw new Error("Local query embedding does not match the indexed model and dimension; rebuild the index.");
  }
  const vectors = await options.embedder.embed([`query: ${options.query}`]);
  assertVectors(vectors, 1, options.embedder.dim, options.embedder.model);
  const queryVector = normalizeVector(vectors[0] ?? []);
  if (!queryVector.some((value) => value !== 0)) return [];
  const bestByBlock = new Map<string, AssetVectorHit>();
  for (const row of rows) {
    const score = cosine(queryVector, row.vector);
    if (score <= 0) continue;
    const hit: AssetVectorHit = {
      blockId: row.blockId,
      score,
      distance: 1 - score,
      embeddingModel: row.embeddingModel,
      backend: "local_e5",
    };
    const current = bestByBlock.get(row.blockId);
    if (!current || hit.score > current.score) bestByBlock.set(row.blockId, hit);
  }
  return [...bestByBlock.values()]
    .sort((a, b) => b.score - a.score || a.blockId.localeCompare(b.blockId))
    .slice(0, options.limit ?? 50);
}

export async function readAssetVectorIndexSummary(workspaceRoot: string, projectId: string): Promise<AssetVectorIndexSummary> {
  const path = assetVectorsPath(workspaceRoot, projectId);
  const rows = await readJsonlFile<AssetVectorRecord>(path);
  if (!rows.length) return { path, state: "absent", indexedBlocks: 0 };
  try {
    const descriptor = validateIndexRows(rows)!;
    const latest = rows.at(-1);
    const legacy = descriptor.backend === "legacy_hash";
    return {
      path,
      state: legacy ? "legacy" : "ready",
      embeddingModel: descriptor.model,
      backend: descriptor.backend,
      provider: latest?.provider,
      dim: descriptor.dim,
      indexedBlocks: new Set(rows.map((row) => row.blockId)).size,
      indexedChunks: rows.length,
      builtAt: latest?.builtAt,
      message: legacy ? "The 96-dimensional token-hash index is legacy and must be rebuilt with multilingual E5." : undefined,
    };
  } catch (error) {
    return {
      path,
      state: "legacy",
      indexedBlocks: new Set(rows.map((row) => row.blockId)).size,
      indexedChunks: rows.length,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function searchAssetVectors(
  workspaceRoot: string,
  options: {
    projectId: string;
    query: string;
    limit?: number;
    gatewayUrl?: string;
    apiKey?: string;
    timeoutMs?: number;
    embedder?: LocalTextEmbedder;
  },
): Promise<AssetVectorHit[]> {
  const rows = await readJsonlFile<AssetVectorRecord>(assetVectorsPath(workspaceRoot, options.projectId));
  const descriptor = validateIndexRows(rows);
  if (!descriptor) return [];
  let queryVector: number[];
  if (descriptor.backend === "tdai_embedding") {
    if (!options.gatewayUrl) throw new Error("TDAI embedding gateway URL is required for tdai_embedding asset vector search.");
    const response = await embedTextsWithTdai(
      { gatewayUrl: options.gatewayUrl, apiKey: options.apiKey, timeoutMs: options.timeoutMs },
      [options.query],
    );
    if (response.model !== descriptor.model || response.dimensions !== descriptor.dim) {
      throw new Error("TDAI query embedding does not match the indexed model and dimension; rebuild the index.");
    }
    queryVector = response.vectors[0] ?? [];
  } else if (descriptor.backend === "legacy_hash") {
    queryVector = embedAssetTextLocal(options.query, descriptor.dim);
  } else {
    const embedder = options.embedder ?? await createLocalE5Embedder(workspaceRoot);
    if (embedder.model !== descriptor.model || embedder.dim !== descriptor.dim) {
      throw new Error("Local query embedding does not match the indexed model and dimension; rebuild the index.");
    }
    const vectors = await embedder.embed([`query: ${options.query}`]);
    assertVectors(vectors, 1, embedder.dim, embedder.model);
    queryVector = vectors[0] ?? [];
  }
  queryVector = normalizeVector(queryVector);
  if (!queryVector.some((value) => value !== 0)) return [];
  const bestByBlock = new Map<string, AssetVectorHit>();
  for (const row of rows) {
    const score = cosine(queryVector, row.vector);
    if (score <= 0) continue;
    const hit: AssetVectorHit = {
      blockId: row.blockId,
      score,
      distance: 1 - score,
      embeddingModel: row.embeddingModel,
      backend: descriptor.backend,
    };
    const current = bestByBlock.get(row.blockId);
    if (!current || hit.score > current.score) bestByBlock.set(row.blockId, hit);
  }
  return [...bestByBlock.values()]
    .sort((a, b) => b.score - a.score || a.blockId.localeCompare(b.blockId))
    .slice(0, options.limit ?? 50);
}
