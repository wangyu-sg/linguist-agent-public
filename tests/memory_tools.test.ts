import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createWorkspace } from "@linguist-agent/cat-data";
import { buildCatTools, legacyTdaiMemoryRuntimeStatus } from "@linguist-agent/cat-tools";

const status = legacyTdaiMemoryRuntimeStatus();
assert.deepEqual(status, {
  capture: "disabled",
  store: "disabled",
  recall: "disabled",
  reason: "explicit_read_only_candidate_migration_required",
});

const toolNames = buildCatTools(createWorkspace("/tmp/la-memory-tools", "proj"), { includeWebBridges: false }).map((tool) => tool.name);
assert.equal(toolNames.includes("memory_search"), false, "legacy TDAI recall must not be an Agent tool");
assert.equal(toolNames.includes("memory_store"), false, "legacy TDAI store must not be an Agent tool");

const root = process.cwd();
const [toolSource, extensionSource, setupScript, startScript] = await Promise.all([
  readFile(join(root, "packages", "cat-tools", "src", "memory-tools.ts"), "utf8"),
  readFile(join(root, ".pi", "extensions", "memory.ts"), "utf8"),
  readFile(join(root, "scripts", "tdai-setup.sh"), "utf8"),
  readFile(join(root, "scripts", "tdai-start.sh"), "utf8"),
]);
for (const source of [toolSource, extensionSource]) {
  assert.equal(source.includes("registerTool"), false);
  assert.equal(source.includes("/capture"), false);
  assert.equal(source.includes("/search/memories"), false);
}
for (const script of [setupScript, startScript]) {
  assert.match(script, /exit 1/);
  assert.equal(script.includes("git clone"), false);
  assert.equal(script.includes("npm install"), false);
  assert.equal(script.includes("gateway\/server"), false);
}

console.log("memory_tools tests passed");
