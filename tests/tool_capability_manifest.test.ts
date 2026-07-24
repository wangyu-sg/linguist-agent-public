import assert from "node:assert/strict";
import { listCatToolMetadata } from "@linguist-agent/cat-tools";
import {
  assertProductionToolCapabilities,
  buildAgentPermissionContract,
  evaluateAgentToolPermissionCall,
  resolveToolCapabilityManifest,
} from "@linguist-agent/cat-runtime";
import { buildAgentToolMetadataCatalog } from "../packages/cat-server/src/agent_tool_catalog.js";

const read = resolveToolCapabilityManifest("read");
assert.ok(read);
assert.equal(read.permissionDomain, "fileRead");
assert.deepEqual(read.capabilities, [
  { kind: "filesystem", operations: ["read"], scope: "workspace-or-explicit-grant" },
]);

const catWrite = resolveToolCapabilityManifest("segment_set_target");
assert.ok(catWrite);
assert.equal(catWrite.authority, "cat-governance");
assert.equal(catWrite.mutatesProject, true);
assert.equal(catWrite.capabilities.some((capability) => capability.kind === "cat-project-write"), true);

for (const tool of listCatToolMetadata()) {
  assert.ok(resolveToolCapabilityManifest(tool.name), `${tool.name} must have a structured capability manifest`);
}

assert.equal(resolveToolCapabilityManifest("Read"), undefined, "case aliases must not inherit a reviewed capability");
assert.equal(resolveToolCapabilityManifest("read_file_alias"), undefined, "name aliases must be declared explicitly");
assert.equal(resolveToolCapabilityManifest("office_document_operate")?.permissionDomain, "fileWrite");
assert.throws(
  () => assertProductionToolCapabilities(["read", "undeclared_fixture_tool"]),
  /TOOL_CAPABILITY_UNDECLARED.*undeclared_fixture_tool/,
);

const unknown = await evaluateAgentToolPermissionCall({
  toolName: "undeclared_fixture_tool",
  input: {},
  contract: buildAgentPermissionContract({
    mode: "custom",
    customRules: { bridge: "auto" },
  }),
});
assert.equal(unknown?.block, true);
assert.match(unknown?.reason ?? "", /TOOL_CAPABILITY_UNDECLARED/);

assert.throws(
  () => buildAgentToolMetadataCatalog({
    catTools: listCatToolMetadata(),
    activeToolNames: ["undeclared_fixture_tool"],
    tools: [{
      name: "undeclared_fixture_tool",
      description: "An undeclared production tool.",
      sourceInfo: { source: "builtin" },
    }],
  }),
  /TOOL_CAPABILITY_UNDECLARED/,
);

console.log("tool capability manifest tests passed");
