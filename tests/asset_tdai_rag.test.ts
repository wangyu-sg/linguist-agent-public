import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assetVectorsPath,
  buildAssetBlocks,
  buildAssetVectorIndexWithTdai,
  createProjectManifest,
  readAssetVectorIndexSummary,
  searchAssetBlocksWithReport,
} from "@linguist-agent/cat-data";

async function readJsonBody(req: IncomingMessage): Promise<{ texts?: string[] }> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as { texts?: string[] };
}

function vectorFor(text: string): number[] {
  const lower = text.toLocaleLowerCase();
  if (lower.includes("seeking") || lower.includes("homing") || lower.includes("projectile")) return [1, 0, 0];
  if (lower.includes("thunder") || lower.includes("lightning")) return [0, 1, 0];
  return [0, 0, 1];
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method === "POST" && req.url === "/embed") {
    const body = await readJsonBody(req);
    const texts = body.texts ?? [];
    const json = JSON.stringify({
      provider: "local",
      model: "embeddinggemma-300m-qat-Q8_0.gguf",
      dimensions: 3,
      ready: true,
      count: texts.length,
      vectors: texts.map(vectorFor),
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(json);
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
  const workspaceRoot = await mkdtemp(join(tmpdir(), "la-asset-tdai-rag-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "la-asset-tdai-rag-project-"));
  const projectId = "asset-tdai-rag-contract";

  await writeFile(
    join(projectRoot, "style.md"),
    [
      "Use Thunder for lightning-element damage.",
      "Orb projectiles that chase targets should use homing orb wording.",
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

  const report = await buildAssetVectorIndexWithTdai(workspaceRoot, { projectId, gatewayUrl });
  assert.equal(report.backend, "tdai_embedding");
  assert.equal(report.provider, "local");
  assert.equal(report.embeddingModel, "embeddinggemma-300m-qat-Q8_0.gguf");
  assert.equal(report.dim, 3);
  assert.equal(report.indexedBlocks, 2);

  const records = (await readFile(assetVectorsPath(workspaceRoot, projectId), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.equal(records.length, 2);
  assert.equal(records.every((record) => record.backend === "tdai_embedding"), true);
  assert.equal(records.every((record) => !("text" in record)), true);
  assert.equal(records.every((record) => !("assetPath" in record)), true);
  assert.equal(records.every((record) => !("lineNo" in record)), true);

  const summary = await readAssetVectorIndexSummary(workspaceRoot, projectId);
  assert.equal(summary.backend, "tdai_embedding");
  assert.equal(summary.provider, "local");
  assert.equal(summary.dim, 3);

  const search = await searchAssetBlocksWithReport(workspaceRoot, {
    projectId,
    query: "seeking projectile wording",
    retrievalMode: "hybrid",
    embeddingGatewayUrl: gatewayUrl,
    limit: 1,
  });
  assert.equal(search.semanticState.state, "ready");
  assert.equal(search.semanticState.backend, "tdai_embedding");
  assert.equal(search.hits.length, 1);
  assert.equal(search.hits[0].assetPath, "style.md");
  assert.equal(search.hits[0].lineNo, 2);
  assert.match(search.hits[0].text, /homing orb/);
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

console.log("asset_tdai_rag tests passed");
