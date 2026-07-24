import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, mkdir, mkdtemp, readdir, realpath, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { finished } from "node:stream/promises";
import { promisify } from "node:util";
import type { DocumentStagedInputRef } from "./document_router_contract.js";

const execFileAsync = promisify(execFile);

export interface StagedDocument {
  source: { sha256: string; mimeType: string };
  input: DocumentStagedInputRef;
  pages: number[];
  resolveStagedInput(input: DocumentStagedInputRef): Promise<string>;
  dispose(): Promise<void>;
}

export interface StagedPdfDocument extends StagedDocument {
  source: { sha256: string; mimeType: "application/pdf" };
}

export interface StagePdfDocumentOptions {
  sourcePath: string;
  stagingRoot: string;
  maxInputBytes: number;
  maxPages?: number;
  inspectPageCount?: (stagedPath: string) => Promise<number>;
}

export interface StageSinglePageDocumentOptions {
  sourcePath: string;
  stagingRoot: string;
  maxInputBytes: number;
  mimeType: "image/png" | "image/jpeg" | "image/tiff";
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  return value;
}

async function copyAndDigest(sourcePath: string, targetPath: string, maxInputBytes: number): Promise<string> {
  const hash = createHash("sha256");
  let sizeBytes = 0;
  const target = createWriteStream(targetPath, { flags: "wx", mode: 0o600 });
  try {
    for await (const chunk of createReadStream(sourcePath)) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      sizeBytes += bytes.byteLength;
      if (sizeBytes > maxInputBytes) throw new Error("Document staging input exceeds the Host limit.");
      hash.update(bytes);
      if (!target.write(bytes)) await once(target, "drain");
    }
    target.end();
    await finished(target);
    return hash.digest("hex");
  } catch (error) {
    target.destroy();
    throw error;
  }
}

export async function inspectStagedPdfPageCount(stagedPath: string): Promise<number> {
  const { stdout } = await execFileAsync("pdfinfo", [stagedPath], { encoding: "utf8", timeout: 10_000, maxBuffer: 64 * 1024 });
  const value = /^Pages:\s*(\d+)\s*$/mu.exec(stdout)?.[1];
  return positiveInteger(Number(value), "PDF page count");
}

async function stageDocument(options: {
  sourcePath: string;
  stagingRoot: string;
  maxInputBytes: number;
  maxPages?: number;
  mimeType: string;
  inspectPageCount: (stagedPath: string) => Promise<number>;
}): Promise<StagedDocument> {
  positiveInteger(options.maxInputBytes, "Document staging maxInputBytes");
  if (options.maxPages !== undefined) positiveInteger(options.maxPages, "Document staging maxPages");
  await mkdir(options.stagingRoot, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(options.stagingRoot, "document-router-"));
  await chmod(directory, 0o700);
  const stagedPath = join(directory, "source.pdf");
  try {
    const sourcePath = await realpath(options.sourcePath);
    const sha256 = await copyAndDigest(sourcePath, stagedPath, options.maxInputBytes);
    let pageCount: number;
    try {
      pageCount = await options.inspectPageCount(stagedPath);
    } catch (error) {
      throw new Error(`PDF page inventory failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    pageCount = positiveInteger(pageCount, "PDF page count");
    if (options.maxPages !== undefined && pageCount > options.maxPages) throw new Error("Document staging page count exceeds the Host limit.");
    const pages = Array.from({ length: pageCount }, (_, index) => index + 1);
    const input: DocumentStagedInputRef = { kind: "host-staged-file", id: randomUUID(), sourceDigest: sha256 };
    let disposed = false;
    const resolveStagedInput = async (candidate: DocumentStagedInputRef): Promise<string> => {
      if (disposed || candidate.kind !== "host-staged-file" || candidate.id !== input.id || candidate.sourceDigest !== input.sourceDigest) {
        throw new Error("Host staged document handle is unavailable.");
      }
      return stagedPath;
    };
    return {
      source: { sha256, mimeType: options.mimeType },
      input,
      pages,
      resolveStagedInput,
      async dispose(): Promise<void> {
        if (disposed) return;
        disposed = true;
        await rm(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function stagePdfDocument(options: StagePdfDocumentOptions): Promise<StagedPdfDocument> {
  return stageDocument({
    ...options,
    mimeType: "application/pdf",
    inspectPageCount: options.inspectPageCount ?? inspectStagedPdfPageCount,
  }) as Promise<StagedPdfDocument>;
}

export function stageSinglePageDocument(options: StageSinglePageDocumentOptions): Promise<StagedDocument> {
  return stageDocument({ ...options, inspectPageCount: async () => 1 });
}

/** Remove only stale private staging directories left by a crashed Router. */
export async function cleanupExpiredDocumentStaging(options: {
  stagingRoot: string;
  maxAgeMs: number;
  now?: Date;
}): Promise<number> {
  if (!Number.isSafeInteger(options.maxAgeMs) || options.maxAgeMs < 1) throw new Error("Document staging maxAgeMs must be a positive integer.");
  let entries;
  try {
    entries = await readdir(options.stagingRoot, { withFileTypes: true });
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
  const cutoff = (options.now ?? new Date()).getTime() - options.maxAgeMs;
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("document-router-")) continue;
    const candidate = join(options.stagingRoot, entry.name);
    if ((await stat(candidate)).mtimeMs > cutoff) continue;
    await rm(candidate, { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}
