import { readFile, realpath } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { readProjectManifest } from "./project_manifest.js";
import { readDocxText, readImageText, readPdfText, readPptxText } from "./document_assets.js";

export interface AssetGrepHit {
  relPath: string;
  lineNo: number;
  text: string;
}

export interface AssetReadResult {
  relPath: string;
  text: string;
  truncated: boolean;
  skippedReason?: string;
}

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp"]);
const READABLE_EXTS = new Set([".md", ".txt", ".csv", ".tsv", ".docx", ".pptx", ".pdf", ...IMAGE_EXTS]);

async function manifestAndPath(workspaceRoot: string, projectId: string, assetPath: string) {
  const manifest = await readProjectManifest(workspaceRoot, projectId);
  const requested = isAbsolute(assetPath) ? resolve(assetPath) : assetPath.replace(/^\.\//, "");
  const asset = manifest.scan.assets.find((row) =>
    isAbsolute(assetPath) ? resolve(row.path) === requested : row.relPath === requested,
  );
  if (!asset) throw new Error(`Asset is not listed in project ${projectId}: ${assetPath}`);
  const [projectRoot, absolute] = await Promise.all([realpath(manifest.root), realpath(asset.path)]);
  const rel = relative(projectRoot, absolute);
  if (rel === ".." || rel.startsWith("../") || rel.startsWith("..\\") || isAbsolute(rel)) {
    throw new Error(`Project asset escaped its manifest root: ${asset.relPath}`);
  }
  const relPath = asset.relPath;
  return { manifest, absolute, relPath };
}

function assertReadable(path: string): string | undefined {
  const ext = extname(path).toLocaleLowerCase();
  if (!READABLE_EXTS.has(ext)) return `Unsupported readable asset extension ${ext || "unknown"}. Supported: md/txt/csv/tsv/docx/pptx/pdf/images.`;
  return undefined;
}

async function readReadableAsset(path: string): Promise<string> {
  const ext = extname(path).toLocaleLowerCase();
  if (ext === ".docx") return readDocxText(path);
  if (ext === ".pptx") return readPptxText(path);
  if (ext === ".pdf") return readPdfText(path);
  if (IMAGE_EXTS.has(ext)) return readImageText(path);
  return readFile(path, "utf8");
}

export async function readAssetText(
  workspaceRoot: string,
  options: { projectId: string; assetPath: string; maxChars?: number },
): Promise<AssetReadResult> {
  const { absolute, relPath } = await manifestAndPath(workspaceRoot, options.projectId, options.assetPath);
  const skippedReason = assertReadable(absolute);
  if (skippedReason) return { relPath, text: "", truncated: false, skippedReason };
  const maxChars = options.maxChars ?? 12000;
  const text = await readReadableAsset(absolute);
  return {
    relPath,
    text: text.length > maxChars ? text.slice(0, maxChars) : text,
    truncated: text.length > maxChars,
  };
}

export async function grepAssets(
  workspaceRoot: string,
  options: { projectId: string; query: string; limit?: number },
): Promise<AssetGrepHit[]> {
  const manifest = await readProjectManifest(workspaceRoot, options.projectId);
  const query = options.query.trim().toLocaleLowerCase();
  if (!query) return [];
  const limit = options.limit ?? 20;
  const hits: AssetGrepHit[] = [];
  for (const asset of manifest.scan.assets) {
    if (!["reference", "style_guide", "glossary", "source_table", "image"].includes(asset.role)) continue;
    if (assertReadable(asset.path)) continue;
    const { absolute } = await manifestAndPath(workspaceRoot, options.projectId, asset.relPath);
    const text = await readReadableAsset(absolute);
    const lines = text.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      if (!line.toLocaleLowerCase().includes(query)) continue;
      hits.push({ relPath: asset.relPath, lineNo: index + 1, text: line.trim() });
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}
