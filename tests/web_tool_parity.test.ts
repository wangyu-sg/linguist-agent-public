import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BROWSER_SESSION_POLICY,
  DEFAULT_PROJECT_SESSION_MODE,
  CAT_WEB_SESSION_BRIDGE_POLICIES,
  createCatAgentSession,
} from "@linguist-agent/cat-runtime";
import { WEB_BRIDGE_USER_AGENT, buildCatTools, catToolMetadataFor } from "@linguist-agent/cat-tools";
import { createWorkspace } from "@linguist-agent/cat-data";

// Single-source policy guard (M2): the health surface reads these same constants,
// so they must encode the real session stance.
assert.equal(BROWSER_SESSION_POLICY.noExtensions, true, "product sessions must not inherit user-global Pi resources");
assert.equal(BROWSER_SESSION_POLICY.useCustomTools, true, "web sessions must keep explicit LA CAT custom tools");
assert.equal(BROWSER_SESSION_POLICY.builtinTools, true, "web sessions must keep Pi built-in tools");
assert.equal(BROWSER_SESSION_POLICY.dataStoreWriteGuard, true, "web sessions must guard data/ writes through the runtime hook");
assert.equal(DEFAULT_PROJECT_SESSION_MODE, "project", "default web session mode must be the durable project thread");
assert.equal(WEB_BRIDGE_USER_AGENT.includes("2.4"), false, "web bridge user-agent must not hardcode stale LA versions");
assert.equal(CAT_WEB_SESSION_BRIDGE_POLICIES.find((bridge) => bridge.id === "browser_automation")?.status, "blocked");

const workspaceRoot = await mkdtemp(join(tmpdir(), "la-web-parity-test-"));
const workspace = createWorkspace(workspaceRoot, "proj");

// The full legacy CAT tool builder still includes bridge shims for explicit CLI
// callers. Product sessions exclude them and activate external capabilities only
// through a server-selected Run resource profile.
const registered = new Set(buildCatTools(workspace).map((tool) => tool.name));
const inheritedModeCustomTools = new Set(
  buildCatTools(workspace, { includeWebBridges: false }).map((tool) => tool.name),
);
assert.ok(registered.has("web_search"), "legacy CAT tool build must still support LA web_search");
assert.ok(registered.has("web_fetch"), "legacy CAT tool build must still support LA web_fetch");
assert.ok(!inheritedModeCustomTools.has("web_search"), "product CAT sessions must not inject the legacy LA web_search bridge");
assert.ok(!inheritedModeCustomTools.has("web_fetch"), "product CAT sessions must not inject the legacy LA web_fetch bridge");

// A product session keeps the complete LA CAT surface while excluding generic
// lifecycle/write tools that could bypass canonical Task/Run authority.
const { session } = await createCatAgentSession({ workspace, sessionMode: "memory" });
const enabled = new Set(
  session.agent.state.tools.map((tool) => (tool as { name?: string }).name).filter((name): name is string => Boolean(name)),
);
session.dispose();

const mustHave = [
  "read",
  "proposal_create",
  "proposal_read",
  "proposal_report",
  "proposal_apply",
  "tm_import_tmx",
  "tm_import_sdltm",
  "tm_import_table",
  "tm_concordance",
  "termbase_import_tbx",
  "termbase_import_sdltb",
  "asset_blocks_build",
  "asset_block_search",
  "workbook_preview",
  "project_refresh",
  "project_health",
];
for (const name of mustHave) {
  if (name !== "read") {
    assert.ok(inheritedModeCustomTools.has(name), `inherited-mode CAT custom tools must register ${name}`);
  }
  assert.ok(enabled.has(name), `web/server session must ENABLE ${name} (regression: tool filtered out of browser chat)`);
}
for (const genericWrite of ["bash", "edit", "write"]) {
  assert.ok(!enabled.has(genericWrite), `CAT sessions must keep generic ${genericWrite} outside the CAT write gates`);
}
assert.ok(!enabled.has("web_search"), "global web_search must not leak into the default product Session");
assert.ok(!enabled.has("fetch_content"), "global fetch_content must not leak into the default product Session");
for (const name of ["web_search", "web_fetch"]) {
  const metadata = catToolMetadataFor(name);
  assert.equal(metadata?.category, "bridge");
  assert.equal(metadata?.access, "read");
  assert.equal(metadata?.mutatesProject, false);
  assert.equal(metadata?.writesSegments, false);
}
for (const name of enabled) {
  assert.ok(!name.startsWith("mcp__"), `MCP bridge tool ${name} must not be auto-registered without explicit per-tool allowlist`);
}
// The enabled set is the CAT custom surface plus Pi's safe read/search built-ins.
assert.ok(enabled.size >= inheritedModeCustomTools.size + 1, "product session must retain CAT custom tools plus safe built-ins");

// Runtime settings: disabledTools must remove exactly those tools from the session surface
// (Settings → Tools toggles persist as disabledTools and apply on the next turn).
const { session: limited } = await createCatAgentSession({ workspace, sessionMode: "memory", disabledTools: ["tm_concordance", "proposal_apply"] });
const limitedNames = new Set(
  limited.agent.state.tools.map((tool) => (tool as { name?: string }).name).filter((name): name is string => Boolean(name)),
);
limited.dispose();
assert.ok(!limitedNames.has("tm_concordance"), "disabledTools must remove tm_concordance from the session");
assert.ok(!limitedNames.has("proposal_apply"), "disabledTools must remove proposal_apply from the session");
assert.ok(limitedNames.has("tm_lookup"), "disabledTools must not affect other tools");
for (const builtin of ["read"]) {
  assert.ok(limitedNames.has(builtin), `disabledTools must not drop inherited built-in ${builtin}`);
}

console.log("web_tool_parity tests passed");
