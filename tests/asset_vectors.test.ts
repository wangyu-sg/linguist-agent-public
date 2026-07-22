import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assetVectorsPath,
  buildAssetBlocks,
  buildAssetVectorIndex,
  createProjectManifest,
  searchAssetVectors,
  type LocalTextEmbedder,
} from "@linguist-agent/cat-data";

const embeddedTexts: string[] = [];
const embedder: LocalTextEmbedder = {
  model: "test-multilingual-e5",
  dim: 4,
  provider: "transformers.js",
  split: (text) => [text],
  async embed(texts) {
    embeddedTexts.push(...texts);
    return texts.map((text) => text.toLocaleLowerCase().includes("lightning") || text.toLocaleLowerCase().includes("thunder")
      ? [1, 0, 0, 0]
      : [0, 1, 0, 0]);
  },
};

const workspaceRoot = await mkdtemp(join(tmpdir(), "la-asset-vectors-"));
const projectRoot = await mkdtemp(join(tmpdir(), "la-asset-vectors-project-"));
const projectId = "asset-vector-contract";

await writeFile(join(projectRoot, "style.md"), "Use Thunder for lightning-element damage.\nUse Gain for item acquisition.", "utf8");
await createProjectManifest(workspaceRoot, projectRoot, {
  projectId,
  sourceLanguage: "en-US",
  targetLanguage: "de-DE",
  assetRoleOverrides: [{ relPath: "style.md", role: "style_guide", status: "confirmed" }],
});
await buildAssetBlocks(workspaceRoot, { projectId });

const report = await buildAssetVectorIndex(workspaceRoot, { projectId, embedder });
assert.equal(report.projectId, projectId);
assert.equal(report.indexedBlocks, 2);
assert.equal(report.embeddingModel, "test-multilingual-e5");
assert.equal(report.backend, "local_e5");
assert.equal(report.dim, 4);
assert.equal(report.path, assetVectorsPath(workspaceRoot, projectId));

const hits = await searchAssetVectors(workspaceRoot, { projectId, query: "lightning damage", limit: 1, embedder });
assert.equal(hits.length, 1);
assert.equal(hits[0].blockId.includes("style.md"), true);
assert.equal(typeof hits[0].score, "number");
assert.equal("text" in hits[0], false);
assert.equal("assetPath" in hits[0], false);
assert.equal("lineNo" in hits[0], false);
assert.equal(embeddedTexts.some((text) => text.startsWith("passage: ")), true);
assert.equal(embeddedTexts.at(-1), "query: lightning damage");

console.log("asset_vectors tests passed");
