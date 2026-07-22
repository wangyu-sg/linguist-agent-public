import assert from "node:assert/strict";
import { buildPiResourcePolicyReport, detectPiToolConflicts } from "@linguist-agent/cat-runtime";

const resources = [
  { source: "npm:@alexanderfortin/pi-tavily-tools", tools: ["web_search", "tavily_extract"] },
  { source: "npm:pi-web-access", tools: ["web_search", "fetch_content", "get_search_content"] },
  { source: ".pi/extensions/cat-tools.ts", tools: ["tm_lookup", "segment_set_target"] },
];

const conflicts = detectPiToolConflicts(resources);
assert.equal(conflicts.length, 1);
assert.equal(conflicts[0].toolName, "web_search");
assert.equal(conflicts[0].winner, "npm:@alexanderfortin/pi-tavily-tools");
assert.deepEqual(conflicts[0].shadowed, ["npm:pi-web-access"]);

const report = buildPiResourcePolicyReport(resources);
assert.equal(report.browserToolSurface, "isolated-la-cat+server-resources");
assert.equal(report.cliToolSurface, "pi-resource-discovery");
assert.equal(report.webSearchProvider, "npm:@alexanderfortin/pi-tavily-tools");
assert.match(report.decisions.join("\n"), /noExtensions=true/);
assert.match(report.decisions.join("\n"), /server-selected resources/);
assert.match(report.decisions.join("\n"), /data\/ write guard/);
assert.match(report.decisions.join("\n"), /citable:false/);
assert.match(report.decisions.join("\n"), /cannot bypass CAT evidence/);

const bridgeById = new Map(report.bridges.map((bridge) => [bridge.id, bridge]));
assert.equal(bridgeById.get("web_search")?.status, "implemented");
assert.equal(bridgeById.get("web_search")?.mutationRisk, "read_only");
assert.equal(bridgeById.get("web_search")?.desiredToolName, "web_search");
assert.equal(bridgeById.get("web_fetch")?.status, "implemented");
assert.equal(bridgeById.get("web_fetch")?.mutationRisk, "read_only");
assert.equal(bridgeById.get("web_fetch")?.desiredToolName, "fetch_content");
assert.equal(bridgeById.get("weather")?.status, "planned");
assert.equal(bridgeById.get("weather")?.mutationRisk, "read_only");
assert.equal(bridgeById.get("browser_automation")?.status, "blocked");
assert.equal(bridgeById.get("browser_automation")?.mutationRisk, "external_mutation_possible");
assert.match(bridgeById.get("browser_automation")?.blockedReason ?? "", /safeguards/);
assert.equal(bridgeById.get("mcp")?.status, "implemented");
assert.equal(bridgeById.get("mcp")?.mutationRisk, "per_tool_declared");
assert.equal(bridgeById.get("mcp")?.accessClass, "per_tool_declared");
assert.match(bridgeById.get("mcp")?.catEvidencePolicy ?? "", /advisory|cannot bypass/i);
assert.ok(bridgeById.get("mcp")?.controls.some((control) => control.id === "server_catalog" && control.state === "active"));
assert.ok(bridgeById.get("mcp")?.controls.some((control) => control.id === "per_tool_allowlist" && control.state === "active"));
assert.ok(bridgeById.get("mcp")?.controls.some((control) => control.id === "cat_write_gate" && control.state === "active"));

for (const bridge of report.bridges.filter((item) => item.status === "implemented")) {
  if (bridge.id === "mcp") {
    assert.equal(bridge.mutationRisk, "per_tool_declared", "MCP bridge is implemented as a catalog/allowlist foundation, not a single always-on read-only tool");
    continue;
  }
  assert.equal(bridge.mutationRisk, "read_only", `${bridge.id} is implemented in Web/API CAT sessions and must stay read-only`);
  assert.match(bridge.catEvidencePolicy, /cannot bypass|must attach/i, `${bridge.id} needs an explicit CAT non-bypass evidence policy`);
}

console.log("pi_resource_policy tests passed");
