import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assetBlocksPath,
  buildAssetBlocks,
  buildAssetVectorIndex,
  createProjectManifest,
  searchAssetBlocksWithReport,
  type LocalTextEmbedder,
} from "@linguist-agent/cat-data";

const vectorFor = (text: string): number[] => {
  const lower = text.toLocaleLowerCase();
  if (lower.includes("seeking") || lower.includes("homing") || lower.includes("chase") || lower.includes("projectile")) return [1, 0, 0, 0];
  if (lower.includes("thunder") || lower.includes("lightning")) return [0, 1, 0, 0];
  return [0, 0, 1, 0];
};
const embedder: LocalTextEmbedder = {
  model: "test-multilingual-e5",
  dim: 4,
  provider: "transformers.js",
  split: (text) => [text],
  embed: async (texts) => texts.map(vectorFor),
};

const workspaceRoot = await mkdtemp(join(tmpdir(), "la-asset-rag-"));
const projectRoot = await mkdtemp(join(tmpdir(), "la-asset-rag-project-"));
const projectId = "asset-rag-contract";

await writeFile(
  join(projectRoot, "style.md"),
  [
    "Thunder must remain Thunder for the elemental damage keyword.",
    "Orb projectiles that chase targets should use homing orb wording.",
    "Never rewrite native tags or placeholders from asset suggestions.",
  ].join("\n"),
  "utf8",
);
await createProjectManifest(workspaceRoot, projectRoot, {
  projectId,
  sourceLanguage: "en-US",
  targetLanguage: "de-DE",
  assetRoleOverrides: [{ relPath: "style.md", role: "style_guide", status: "confirmed" }],
});
await buildAssetBlocks(workspaceRoot, { projectId });

const blocked = await searchAssetBlocksWithReport(workspaceRoot, {
  projectId,
  query: "seeking projectile wording",
  retrievalMode: "hybrid",
});
assert.equal(blocked.semanticState.state, "blocked_missing_vector_index");
assert.equal(blocked.semanticState.assetVectorIndex, "absent");
assert.equal(blocked.hits.every((hit) => hit.assetPath && hit.lineNo), true);

await buildAssetVectorIndex(workspaceRoot, { projectId, embedder });
const hybrid = await searchAssetBlocksWithReport(workspaceRoot, {
  projectId,
  query: "Thunder",
  retrievalMode: "hybrid",
  limit: 3,
  localEmbedder: embedder,
});
assert.equal(hybrid.semanticState.state, "ready");
assert.equal(hybrid.hits[0].text.includes("Thunder"), true);
assert.equal(hybrid.hits[0].scoreBreakdown.lexical, 1);
assert.equal(hybrid.hits[0].score > 0 && hybrid.hits[0].score < 0.1, true);
assert.equal(hybrid.hits.some((hit) => hit.scoreBreakdown.semantic !== undefined), true);
assert.equal(hybrid.hits.every((hit) => hit.assetPath === "style.md"), true);
assert.equal(hybrid.hits.every((hit) => typeof hit.lineNo === "number"), true);

const vectorOnly = await searchAssetBlocksWithReport(workspaceRoot, {
  projectId,
  query: "seeking projectile wording",
  retrievalMode: "hybrid",
  limit: 3,
  localEmbedder: embedder,
});
assert.equal(vectorOnly.hits.some((hit) => hit.retrievalMode === "vector" || hit.retrievalMode === "hybrid"), true);
assert.equal(vectorOnly.hits.every((hit) => typeof hit.text === "string" && hit.text.length > 0), true);

const authorityProjectId = "asset-authority-sort";
await createProjectManifest(workspaceRoot, projectRoot, { projectId: authorityProjectId, sourceLanguage: "en-US", targetLanguage: "de-DE" });
await writeFile(
  assetBlocksPath(workspaceRoot, authorityProjectId),
  [
    JSON.stringify({
      blockId: "reference",
      assetPath: "reference.xlsx",
      lineNo: 1,
      blockType: "text",
      text: "Use Gem for item names.",
      sourceEngine: "xlsx_asset",
      role: "reference",
      parserKind: "reference_index",
      authorityTier: "reference",
    }),
    JSON.stringify({
      blockId: "style",
      assetPath: "style.xlsx",
      lineNo: 1,
      blockType: "text",
      text: "Use Gem for item names.",
      sourceEngine: "xlsx_asset",
      role: "style_guide",
      parserKind: "style_guide",
      authorityTier: "style_guide",
    }),
  ].join("\n") + "\n",
  "utf8",
);
const authoritySorted = await searchAssetBlocksWithReport(workspaceRoot, {
  projectId: authorityProjectId,
  query: "Gem item names",
  retrievalMode: "lexical",
  limit: 2,
});
assert.equal(authoritySorted.hits[0].parserKind, "style_guide");

console.log("asset_rag_hybrid tests passed");
