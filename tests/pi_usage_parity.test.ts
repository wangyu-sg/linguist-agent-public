import assert from "node:assert/strict";
import { readPiUsageParityCatalog } from "../packages/cat-server/src/pi_usage.js";

const catalog = readPiUsageParityCatalog();

assert.equal(catalog.docs.usage, "https://pi.dev/docs/latest/usage");
assert.equal(catalog.docs.sdk, "https://pi.dev/docs/latest/sdk");
assert.equal(catalog.docs.rpc, "https://pi.dev/docs/latest/rpc");
assert.ok(catalog.pinnedSources.some((source) => source.endsWith("/cli/args.js")));
assert.ok(catalog.pinnedSources.some((source) => source.endsWith("/modes/rpc/rpc-mode.js")));
assert.ok(catalog.policy.some((entry) => entry.includes("Literal one-shot API keys")));

const byId = new Map(catalog.items.map((item) => [item.id, item]));
for (const id of [
  "auth.api_key",
  "prompt.system_prompt",
  "startup.tools_resources",
  "mode.json",
  "mode.rpc",
  "rpc.session_entries_tree",
  "input.file_args",
  "metadata.list_models",
]) {
  assert.ok(byId.has(id), `missing Pi usage parity item ${id}`);
}

assert.equal(byId.get("auth.api_key")?.status, "intentionally_unsupported");
assert.match(byId.get("auth.api_key")?.notes ?? "", /URLs, logs, docs, and app state/);
assert.equal(byId.get("prompt.system_prompt")?.status, "intentionally_unsupported");
assert.equal(byId.get("startup.tools_resources")?.status, "implemented");
assert.equal(byId.get("mode.rpc")?.status, "intentionally_unsupported");
assert.match(byId.get("mode.rpc")?.notes ?? "", /raw stdin\/stdout Pi RPC/);
assert.equal(byId.get("rpc.session_entries_tree")?.status, "native_equivalent");
assert.match(byId.get("rpc.session_entries_tree")?.laSurface ?? "", /sessions\/entries/);
assert.equal(byId.get("input.file_args")?.status, "intentionally_unsupported");
assert.match(byId.get("input.file_args")?.notes ?? "", /future composer attachment/);

const validStatuses = new Set(["implemented", "native_equivalent", "intentionally_unsupported"]);
for (const item of catalog.items) {
  assert.ok(validStatuses.has(item.status), `${item.id} has invalid status ${item.status}`);
  assert.ok(item.official.trim().length > 0, `${item.id} must name official option(s)`);
  assert.ok(item.laSurface.trim().length > 0, `${item.id} must describe LA surface`);
  assert.ok(item.tests.length > 0, `${item.id} must cite tests`);
}

console.log("pi_usage_parity tests passed");
