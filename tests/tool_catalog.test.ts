import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCatTools, catToolMetadataFor, createWebFetchTool, listCatToolMetadata, prepareCatToolArguments, renderCatToolCatalog } from "@linguist-agent/cat-tools";
import { createWorkspace } from "@linguist-agent/cat-data";

const metadata = listCatToolMetadata();
const workspaceRoot = await mkdtemp(join(tmpdir(), "la-tool-catalog-"));
const tools = buildCatTools(createWorkspace(workspaceRoot, "tool-catalog"));
const toolNames = tools.map((tool) => tool.name).sort();
const metadataNames = metadata.map((tool) => tool.name).sort();
const childOnlyToolNames = new Set(["team_artifact_read"]);

assert.deepEqual(metadataNames.filter((name) => !childOnlyToolNames.has(name)), toolNames, "public tool metadata must match registered CAT tools");
assert.equal(new Set(metadataNames).size, metadataNames.length, "tool metadata names must be unique");
assert.equal(metadata.find((tool) => tool.name === "team_artifact_read")?.mutatesProject, false);

const segmentWrite = metadata.find((tool) => tool.name === "segment_set_target");
assert.ok(segmentWrite);
assert.equal(segmentWrite.access, "write");
assert.equal(segmentWrite.writesSegments, true);
assert.deepEqual(segmentWrite.requiresEvidenceFor, ["term", "terminology"]);
assert.equal(segmentWrite.executionMode, "sequential");

const batchDraftWrite = metadata.find((tool) => tool.name === "batch_set_targets");
assert.ok(batchDraftWrite);
assert.equal(batchDraftWrite.access, "write");
assert.equal(batchDraftWrite.writesSegments, true);
assert.deepEqual(batchDraftWrite.allowedModes, ["translate", "maintenance"]);
assert.equal(batchDraftWrite.executionMode, "sequential");

const deliveryAcceptRisk = metadata.find((tool) => tool.name === "delivery_accept_risk");
assert.ok(deliveryAcceptRisk);
assert.equal(deliveryAcceptRisk.access, "write");
assert.equal(deliveryAcceptRisk.writesSegments, false);
assert.deepEqual(deliveryAcceptRisk.allowedModes, ["delivery", "maintenance"]);

const webFetchMetadata = metadata.find((tool) => tool.name === "web_fetch");
assert.ok(webFetchMetadata);
assert.equal(webFetchMetadata.category, "bridge");
assert.equal(webFetchMetadata.access, "read");
assert.equal(webFetchMetadata.writesSegments, false);
assert.equal(webFetchMetadata.executionMode, "parallel");

const webSearchMetadata = metadata.find((tool) => tool.name === "web_search");
assert.ok(webSearchMetadata);
assert.equal(webSearchMetadata.category, "bridge");
assert.equal(webSearchMetadata.access, "read");
assert.equal(webSearchMetadata.mutatesProject, false);

const evidencePackMetadata = metadata.find((tool) => tool.name === "evidence_pack");
assert.ok(evidencePackMetadata);

for (const name of ["assistant_library_search", "assistant_library_list"]) {
  const libraryMetadata = metadata.find((tool) => tool.name === name);
  assert.ok(libraryMetadata);
  assert.equal(libraryMetadata.category, "library");
  assert.equal(libraryMetadata.access, "read");
  assert.equal(libraryMetadata.mutatesProject, false);
  assert.equal(libraryMetadata.writesSegments, false);
}

const constraintPackMetadata = metadata.find((tool) => tool.name === "constraint_pack");
assert.ok(constraintPackMetadata);

const qualityAuditMetadata = metadata.find((tool) => tool.name === "quality_audit");
assert.ok(qualityAuditMetadata);

const deliveryQaMetadata = metadata.find((tool) => tool.name === "delivery_qa");
assert.ok(deliveryQaMetadata);
assert.equal(deliveryQaMetadata.access, "write");
assert.equal(deliveryQaMetadata.mutatesProject, true);
assert.equal(deliveryQaMetadata.writesSegments, false);

for (const tool of tools) {
  const toolMetadata = catToolMetadataFor(tool.name);
  assert.ok(toolMetadata, `${tool.name} must have catalog metadata`);
  assert.equal(tool.executionMode, toolMetadata.executionMode, `${tool.name} executionMode must come from catalog metadata`);
}

assert.deepEqual(
  prepareCatToolArguments({
    project_id: "p1",
    batch_id: "b1",
    segment_id: "s1",
    change_type: "term",
    evidence_sources: ["termbase:Gem"],
    filePath: "@/tmp/source.xlsx",
    proposals: [{ proposed_target: "Gem", evidence_sources: ["tm:1"] }],
  }),
  {
    projectId: "p1",
    batchId: "b1",
    segmentId: "s1",
    changeType: "term",
    evidenceSources: ["termbase:Gem"],
    filePath: "/tmp/source.xlsx",
    proposals: [{ proposedTarget: "Gem", evidenceSources: ["tm:1"] }],
  },
  "prepareCatToolArguments should normalize common model argument shapes",
);

const setTargetTool = tools.find((tool) => tool.name === "segment_set_target");
assert.ok(setTargetTool);
await assert.rejects(
  () =>
    setTargetTool.execute(
      "tool-call",
      {
        projectId: "p1",
        batchId: "b1",
        segmentId: "s1",
        target: "Gem",
        reason: "Terminology update",
        changeType: "term",
      },
      undefined,
      undefined,
      undefined as never,
    ),
  /evidence gate blocked segment_set_target/,
  "selection/write tools must reject evidence-required changes before data writes",
);

const editCatalog = renderCatToolCatalog({ mode: "edit", includeWriteTools: true });
assert.match(editCatalog, /segment_set_target/);
assert.match(editCatalog, /proposal_create/);
assert.match(editCatalog, /evidence_required:term\/terminology/);
assert.doesNotMatch(editCatalog, /project_onboard/);

const translateCatalog = renderCatToolCatalog({ mode: "translate", includeWriteTools: true });
assert.match(translateCatalog, /batch_set_targets/);
assert.doesNotMatch(translateCatalog, /proposal_create/);

const readOnlyCatalog = renderCatToolCatalog({ mode: "edit", includeWriteTools: false });
assert.match(readOnlyCatalog, /tm_lookup/);
assert.match(readOnlyCatalog, /asset_block_search/);
assert.doesNotMatch(readOnlyCatalog, /segment_set_target/);

const listTool = tools.find((tool) => tool.name === "cat_tools_list");
assert.ok(listTool);
const output = await listTool.execute("tool-call", { mode: "edit", includeWriteTools: false });
assert.match(output.content[0].text, /Mode filter: edit/);
assert.match(output.content[0].text, /tm_lookup/);
assert.doesNotMatch(output.content[0].text, /segment_set_target/);
assert.equal(output.details.tools.some((tool) => tool.name === "tm_lookup"), true);

const server = createServer((_req, res) => {
  res.setHeader("content-type", "text/html");
  res.end("<html><head><title>Bridge Evidence</title></head><body><main>Term evidence from a public reference page.</main></body></html>");
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  const address = server.address();
  assert.equal(typeof address, "object");
  const port = address && typeof address === "object" ? address.port : 0;
  const webFetchTool = createWebFetchTool({ allowPrivateNetwork: true });
  const result = await webFetchTool.execute("tool-call", { url: `http://127.0.0.1:${port}/evidence`, maxChars: 200 }, undefined, undefined, undefined as never);
  assert.match(result.content[0].text, /Evidence: http:\/\/127\.0\.0\.1:/);
  assert.match(result.content[0].text, /Fetched:/);
  assert.match(result.content[0].text, /Excerpt:/);
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

console.log("tool_catalog tests passed");
