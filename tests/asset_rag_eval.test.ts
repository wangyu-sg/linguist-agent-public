import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildAssetBlocks,
  buildAssetVectorIndex,
  buildAssetVectorIndexWithTdai,
  createProjectManifest,
  searchAssetBlocksWithReport,
  type LocalTextEmbedder,
} from "@linguist-agent/cat-data";

async function readJsonBody(req: IncomingMessage): Promise<{ texts?: string[] }> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as { texts?: string[] };
}

function vectorFor(text: string): number[] {
  const lower = text.toLocaleLowerCase();
  if (lower.includes("seeking") || lower.includes("missile") || lower.includes("homing") || lower.includes("chase")) {
    return [1, 0, 0, 0];
  }
  if (lower.includes("thunder") || lower.includes("lightning")) return [0, 1, 0, 0];
  return [0, 0, 1, 0];
}

const localEmbedder: LocalTextEmbedder = {
  model: "test-multilingual-e5",
  dim: 4,
  provider: "transformers.js",
  split: (text) => [text],
  embed: async (texts) => texts.map(vectorFor),
};

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method === "POST" && req.url === "/embed") {
    const body = await readJsonBody(req);
    const texts = body.texts ?? [];
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      provider: "local",
      model: "embeddinggemma-300m-qat-Q8_0.gguf",
      dimensions: 4,
      ready: true,
      count: texts.length,
      vectors: texts.map(vectorFor),
    }));
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.equal(typeof address, "object");
const gatewayUrl = `http://127.0.0.1:${address!.port}`;

try {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "la-asset-rag-eval-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "la-asset-rag-eval-project-"));
  const projectId = "asset-rag-eval";

  await writeFile(
    join(projectRoot, "style.md"),
    [
      "Use Thunder for lightning-element damage.",
      "Orb projectiles that chase targets should use homing orb wording.",
      "Do not rewrite native tags, placeholders, or line breaks from suggestions.",
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

  const lexical = await searchAssetBlocksWithReport(workspaceRoot, {
    projectId,
    query: "seeking missile behavior",
    retrievalMode: "lexical",
  });
  assert.equal(lexical.retrievalMode, "lexical");
  assert.equal(lexical.hits.every((hit) => hit.scoreBreakdown.semantic === undefined), true);

  const localReport = await buildAssetVectorIndex(workspaceRoot, { projectId, embedder: localEmbedder });
  assert.equal(localReport.backend, "local_e5");
  const localHybrid = await searchAssetBlocksWithReport(workspaceRoot, {
    projectId,
    query: "seeking missile behavior",
    retrievalMode: "hybrid",
    limit: 3,
    localEmbedder,
  });
  assert.equal(localHybrid.semanticState.state, "ready");
  assert.equal(localHybrid.semanticState.backend, "local_e5");
  assert.equal(localHybrid.hits.every((hit) => hit.assetPath === "style.md" && typeof hit.lineNo === "number"), true);

  const tdaiReport = await buildAssetVectorIndexWithTdai(workspaceRoot, { projectId, gatewayUrl });
  assert.equal(tdaiReport.backend, "tdai_embedding");
  assert.equal(tdaiReport.embeddingModel, "embeddinggemma-300m-qat-Q8_0.gguf");
  const tdaiHybrid = await searchAssetBlocksWithReport(workspaceRoot, {
    projectId,
    query: "seeking missile behavior",
    retrievalMode: "hybrid",
    embeddingGatewayUrl: gatewayUrl,
    limit: 1,
  });
  assert.equal(tdaiHybrid.semanticState.state, "ready");
  assert.equal(tdaiHybrid.semanticState.backend, "tdai_embedding");
  assert.equal(tdaiHybrid.hits[0].assetPath, "style.md");
  assert.equal(tdaiHybrid.hits[0].lineNo, 2);
  assert.match(tdaiHybrid.hits[0].text, /homing orb/);
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

console.log("asset_rag_eval tests passed");
