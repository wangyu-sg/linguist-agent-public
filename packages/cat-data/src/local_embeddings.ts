import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline as streamPipeline } from "node:stream/promises";
import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

export const LOCAL_E5_MODEL_ID = "Xenova/multilingual-e5-small";
export const LOCAL_E5_REVISION = "761b726dd34fb83930e26aab4e9ac3899aa1fa78";
export const LOCAL_E5_DIM = 384;
export const LOCAL_E5_MODEL_SHA256 = "ee13574a23e4384619a172d4c0c8c6b825528fde30258c56130d5e3efcc9c8f1";
export const LOCAL_E5_TOKENIZER_SHA256 = "0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39";
export const LOCAL_E5_MODEL_NAME = `${LOCAL_E5_MODEL_ID}@${LOCAL_E5_REVISION}`;

const REQUIRED_FILES = [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "special_tokens_map.json",
  "quant_config.json",
  "onnx/model_uint8.onnx",
] as const;

export interface LocalEmbeddingPackLock {
  schemaVersion: 1;
  modelId: typeof LOCAL_E5_MODEL_ID;
  revision: typeof LOCAL_E5_REVISION;
  dimensions: typeof LOCAL_E5_DIM;
  installedAt: string;
  files: Array<{ path: string; sha256: string; sizeBytes: number }>;
}

export interface LocalEmbeddingPackStatus {
  state: "missing" | "corrupt" | "ready";
  path: string;
  modelId: string;
  revision: string;
  dimensions: number;
  message?: string;
  lock?: LocalEmbeddingPackLock;
}

export interface LocalTextEmbedder {
  model: string;
  dim: number;
  provider: "transformers.js";
  embed(texts: string[]): Promise<number[][]>;
  split(text: string, maxTokens?: number, overlapTokens?: number): string[];
}

export class LocalEmbeddingPackUnavailableError extends Error {
  readonly code = "local_embedding_pack_unavailable";

  constructor(message: string) {
    super(message);
    this.name = "LocalEmbeddingPackUnavailableError";
  }
}

export function localEmbeddingPackPath(workspaceRoot: string): string {
  return join(workspaceRoot, "data", "assistant", "capabilities", "embeddings", "multilingual-e5-small", LOCAL_E5_REVISION);
}

function lockPath(packPath: string): string {
  return join(packPath, "capability-lock.json");
}

async function sha256File(path: string): Promise<{ sha256: string; sizeBytes: number }> {
  const value = await readFile(path);
  return {
    sha256: createHash("sha256").update(value).digest("hex"),
    sizeBytes: value.byteLength,
  };
}

async function readLock(packPath: string): Promise<LocalEmbeddingPackLock | undefined> {
  try {
    return JSON.parse(await readFile(lockPath(packPath), "utf8")) as LocalEmbeddingPackLock;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function inspectLocalEmbeddingPack(workspaceRoot: string): Promise<LocalEmbeddingPackStatus> {
  const path = localEmbeddingPackPath(workspaceRoot);
  const lock = await readLock(path);
  if (!lock) {
    return {
      state: "missing",
      path,
      modelId: LOCAL_E5_MODEL_ID,
      revision: LOCAL_E5_REVISION,
      dimensions: LOCAL_E5_DIM,
      message: "The multilingual E5 managed pack is not installed. Semantic retrieval is lexical-only until the user installs it.",
    };
  }
  if (
    lock.schemaVersion !== 1
    || lock.modelId !== LOCAL_E5_MODEL_ID
    || lock.revision !== LOCAL_E5_REVISION
    || lock.dimensions !== LOCAL_E5_DIM
  ) {
    return {
      state: "corrupt",
      path,
      modelId: LOCAL_E5_MODEL_ID,
      revision: LOCAL_E5_REVISION,
      dimensions: LOCAL_E5_DIM,
      message: "The multilingual E5 capability lock does not match LA's pinned model.",
      lock,
    };
  }
  try {
    for (const relativePath of REQUIRED_FILES) await access(join(path, relativePath));
    const [model, tokenizer] = await Promise.all([
      sha256File(join(path, "onnx", "model_uint8.onnx")),
      sha256File(join(path, "tokenizer.json")),
    ]);
    if (model.sha256 !== LOCAL_E5_MODEL_SHA256 || tokenizer.sha256 !== LOCAL_E5_TOKENIZER_SHA256) {
      return {
        state: "corrupt",
        path,
        modelId: LOCAL_E5_MODEL_ID,
        revision: LOCAL_E5_REVISION,
        dimensions: LOCAL_E5_DIM,
        message: "The multilingual E5 model or tokenizer failed SHA-256 verification.",
        lock,
      };
    }
  } catch (error) {
    return {
      state: "corrupt",
      path,
      modelId: LOCAL_E5_MODEL_ID,
      revision: LOCAL_E5_REVISION,
      dimensions: LOCAL_E5_DIM,
      message: error instanceof Error ? error.message : String(error),
      lock,
    };
  }
  return {
    state: "ready",
    path,
    modelId: LOCAL_E5_MODEL_ID,
    revision: LOCAL_E5_REVISION,
    dimensions: LOCAL_E5_DIM,
    lock,
  };
}

async function downloadFile(relativePath: string, targetPath: string): Promise<void> {
  const url = `https://huggingface.co/${LOCAL_E5_MODEL_ID}/resolve/${LOCAL_E5_REVISION}/${relativePath}`;
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${relativePath}: HTTP ${response.status}`);
  }
  await mkdir(join(targetPath, relativePath, ".."), { recursive: true });
  await streamPipeline(Readable.fromWeb(response.body as never), createWriteStream(join(targetPath, relativePath), { flags: "wx" }));
}

export async function installLocalEmbeddingPack(
  workspaceRoot: string,
  options: { onProgress?: (event: { file: string; completed: number; total: number }) => void } = {},
): Promise<LocalEmbeddingPackStatus> {
  const target = localEmbeddingPackPath(workspaceRoot);
  const parent = join(target, "..");
  const quarantine = `${target}.quarantine-${randomUUID()}`;
  await mkdir(parent, { recursive: true });
  await rm(quarantine, { recursive: true, force: true });
  await mkdir(quarantine, { recursive: true });
  try {
    for (const [index, relativePath] of REQUIRED_FILES.entries()) {
      await downloadFile(relativePath, quarantine);
      options.onProgress?.({ file: relativePath, completed: index + 1, total: REQUIRED_FILES.length });
    }
    const fileLocks = await Promise.all(REQUIRED_FILES.map(async (relativePath) => ({
      path: relativePath,
      ...await sha256File(join(quarantine, relativePath)),
    })));
    const model = fileLocks.find((file) => file.path === "onnx/model_uint8.onnx");
    const tokenizer = fileLocks.find((file) => file.path === "tokenizer.json");
    if (model?.sha256 !== LOCAL_E5_MODEL_SHA256) throw new Error("Downloaded multilingual E5 model failed SHA-256 verification.");
    if (tokenizer?.sha256 !== LOCAL_E5_TOKENIZER_SHA256) throw new Error("Downloaded multilingual E5 tokenizer failed SHA-256 verification.");
    const lock: LocalEmbeddingPackLock = {
      schemaVersion: 1,
      modelId: LOCAL_E5_MODEL_ID,
      revision: LOCAL_E5_REVISION,
      dimensions: LOCAL_E5_DIM,
      installedAt: new Date().toISOString(),
      files: fileLocks,
    };
    await writeFile(lockPath(quarantine), `${JSON.stringify(lock, null, 2)}\n`, "utf8");
    await rm(target, { recursive: true, force: true });
    await rename(quarantine, target);
  } catch (error) {
    await rm(quarantine, { recursive: true, force: true });
    throw error;
  }
  return inspectLocalEmbeddingPack(workspaceRoot);
}

const pipelines = new Map<string, Promise<FeatureExtractionPipeline>>();

async function loadPipeline(workspaceRoot: string): Promise<FeatureExtractionPipeline> {
  const pack = await inspectLocalEmbeddingPack(workspaceRoot);
  if (pack.state !== "ready") throw new LocalEmbeddingPackUnavailableError(pack.message ?? `Local embedding pack is ${pack.state}.`);
  let pending = pipelines.get(pack.path);
  if (!pending) {
    pending = pipeline("feature-extraction", pack.path, {
      local_files_only: true,
      dtype: "uint8",
    });
    pipelines.set(pack.path, pending);
    pending.catch(() => pipelines.delete(pack.path));
  }
  return pending;
}

function normalizedRows(value: unknown): number[][] {
  if (!Array.isArray(value)) return [];
  if (value.length && typeof value[0] === "number") return [value as number[]];
  return value as number[][];
}

export async function createLocalE5Embedder(workspaceRoot: string): Promise<LocalTextEmbedder> {
  const extractor = await loadPipeline(workspaceRoot);
  return {
    model: LOCAL_E5_MODEL_NAME,
    dim: LOCAL_E5_DIM,
    provider: "transformers.js",
    async embed(texts) {
      if (!texts.length) return [];
      const output = await extractor(texts, { pooling: "mean", normalize: true });
      const rows = normalizedRows(output.tolist());
      if (rows.length !== texts.length || rows.some((row) => row.length !== LOCAL_E5_DIM)) {
        throw new Error(`multilingual E5 returned ${rows.length} vector(s); expected ${texts.length} x ${LOCAL_E5_DIM}.`);
      }
      return rows;
    },
    split(text, maxTokens = 384, overlapTokens = 64) {
      const tokenIds = extractor.tokenizer.encode(text, { add_special_tokens: false });
      if (tokenIds.length <= maxTokens) return [text];
      const step = Math.max(1, maxTokens - Math.max(0, Math.min(overlapTokens, maxTokens - 1)));
      const chunks: string[] = [];
      for (let start = 0; start < tokenIds.length; start += step) {
        const chunk = extractor.tokenizer.decode(tokenIds.slice(start, start + maxTokens), { skip_special_tokens: true }).trim();
        if (chunk) chunks.push(chunk);
        if (start + maxTokens >= tokenIds.length) break;
      }
      return chunks.length ? chunks : [text];
    },
  };
}
