import assert from "node:assert/strict";
import type { ExtensionAPI, ToolInfo } from "@earendil-works/pi-coding-agent";
import {
  CAPABILITY_SEARCH_TOOL,
  createDynamicToolLoadingExtension,
  rankCapabilityTools,
  type CapabilityActivation,
} from "@linguist-agent/cat-runtime";

const sourceInfo = (path: string) => ({ source: "fixture", path, scope: "temporary", origin: "top-level" } as const);
const tools: ToolInfo[] = [
  { name: "read", description: "Read files", parameters: {}, sourceInfo: sourceInfo("<builtin:read>") },
  { name: "browser_open", description: "Open and inspect a web page", parameters: {}, sourceInfo: sourceInfo("browser.ts") },
  { name: "spreadsheet_edit", description: "Edit Excel workbooks and tables", parameters: {}, sourceInfo: sourceInfo("office.ts") },
  { name: "subagent", description: "Spawn an unmanaged child process", parameters: {}, sourceInfo: sourceInfo("pi-subagents.ts") },
];

assert.deepEqual(rankCapabilityTools(tools, "inspect web page", 2).map((tool) => tool.name), ["browser_open"]);
assert.deepEqual(rankCapabilityTools(tools, "Excel 表格", 2).map((tool) => tool.name), ["spreadsheet_edit"]);
assert.deepEqual(rankCapabilityTools(tools, "", 2), []);

let active = ["read", "browser_open", "spreadsheet_edit"];
let registered: any;
let sessionStart: (() => void) | undefined;
const activations: CapabilityActivation[] = [];
const api = {
  registerTool(tool: unknown) {
    registered = tool;
    tools.push({
      name: (tool as { name: string }).name,
      description: (tool as { description: string }).description,
      parameters: {},
      sourceInfo: sourceInfo("dynamic-loader.ts"),
    });
  },
  on(event: string, handler: () => void) {
    if (event === "session_start") sessionStart = handler;
  },
  getAllTools: () => tools,
  getActiveTools: () => active,
  setActiveTools(names: string[]) {
    active = names;
  },
} as unknown as ExtensionAPI;

createDynamicToolLoadingExtension({
  initialToolNames: ["read"],
  blockedToolNames: ["subagent"],
  onActivation: (activation) => activations.push(activation),
})(api);
assert.equal(registered.name, CAPABILITY_SEARCH_TOOL);
sessionStart?.();
assert.deepEqual(active, ["read", CAPABILITY_SEARCH_TOOL]);

const result = await registered.execute("call-1", { query: "Excel workbook", limit: 3 });
assert.equal(result.details.addedToolNames.includes("spreadsheet_edit"), true);
assert.deepEqual(active, ["read", CAPABILITY_SEARCH_TOOL, "spreadsheet_edit"]);

const blocked = await registered.execute("call-3", { query: "spawn child subagent", limit: 3 });
assert.deepEqual(blocked.details.matchedToolNames, []);
assert.equal(active.includes("subagent"), false, "server-owned delegation tools must not be activated through Package discovery");
assert.equal(activations.length, 1);
assert.deepEqual(activations[0]?.addedToolNames, ["spreadsheet_edit"]);

await registered.execute("call-2", { query: "Excel workbook", limit: 3 });
assert.equal(activations[1]?.addedToolNames.length, 0);
assert.deepEqual(active, ["read", CAPABILITY_SEARCH_TOOL, "spreadsheet_edit"]);

console.log("dynamic tool loading tests passed");
