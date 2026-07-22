import assert from "node:assert/strict";
import { listCatToolMetadata } from "@linguist-agent/cat-tools";
import {
  buildAgentToolMetadataCatalog,
  createLeasedAgentToolCatalog,
} from "../packages/cat-server/src/agent_tool_catalog.js";
import {
  ActiveAgentRunRegistry,
  ActiveAgentRunResourceMutationError,
} from "../packages/cat-server/src/active_agent_runs.js";
import { handleAgentCatalogRoute } from "../packages/cat-server/src/routes/agent_catalog_routes.js";

const tools = buildAgentToolMetadataCatalog({
  catTools: listCatToolMetadata(),
  activeToolNames: [
    "ask_user",
    "document_parse",
    "read",
    "tm_lookup",
  ],
  tools: [
    {
      name: "read",
      description: "Read a file.",
      sourceInfo: { source: "builtin" },
    },
    {
      name: "grep",
      description: "Search files.",
      sourceInfo: { source: "builtin" },
    },
    {
      name: "find",
      description: "Find files.",
      sourceInfo: { source: "builtin" },
    },
    {
      name: "ls",
      description: "List files.",
      sourceInfo: { source: "builtin" },
    },
    {
      name: "ask_user",
      description: "Ask the user a structured question.",
      sourceInfo: { source: "cli" },
    },
    {
      name: "document_parse",
      description: "Parse a document.",
      sourceInfo: { source: "cli" },
    },
    {
      name: "tm_lookup",
      description: "Look up Translation Memory.",
      sourceInfo: { source: "sdk" },
    },
  ],
});

const byName = new Map(tools.map((tool) => [tool.name, tool]));

assert.deepEqual(tools.map((tool) => tool.name), ["ask_user", "document_parse", "read", "tm_lookup"]);
assert.equal(byName.get("tm_lookup")?.source, "cat-native");
assert.equal(byName.get("ask_user")?.source, "pi-package");
assert.equal(byName.get("ask_user")?.description, "Ask the user a structured question.");
assert.equal(byName.get("document_parse")?.source, "pi-package");
assert.equal(byName.get("read")?.source, "builtin");
assert.equal(byName.has("grep"), false, "inactive Pi tools must not be advertised");
assert.equal(byName.has("find"), false, "inactive Pi tools must not be advertised");
assert.equal(byName.has("ls"), false, "inactive Pi tools must not be advertised");
assert.equal(byName.has("web_search"), false);
assert.equal(byName.has("web_fetch"), false);
assert.equal(new Set(tools.map((tool) => tool.name)).size, tools.length, "active tool catalog names must be unique");

const resourceRegistry = new ActiveAgentRunRegistry(0);
let loadCount = 0;
let markCatalogStarted!: () => void;
let releaseCatalogLoad!: () => void;
const catalogStarted = new Promise<void>((resolve) => { markCatalogStarted = resolve; });
const catalogLoadGate = new Promise<void>((resolve) => { releaseCatalogLoad = resolve; });
const leasedCatalog = createLeasedAgentToolCatalog({
  acquireResourceRead: () => resourceRegistry.acquireRunStartLease(),
  load: async () => {
    loadCount += 1;
    markCatalogStarted();
    await catalogLoadGate;
    return tools;
  },
});
const firstCatalogLoad = leasedCatalog.list();
await catalogStarted;
assert.equal(
  resourceRegistry.tryAcquireResourceMutationLease(),
  undefined,
  "Package mutation must not enter while the catalog is loading managed Extension code",
);
releaseCatalogLoad();
assert.deepEqual(await firstCatalogLoad, tools);
assert.equal(loadCount, 1);
const releaseCatalogMutation = resourceRegistry.tryAcquireResourceMutationLease();
assert.ok(releaseCatalogMutation);
leasedCatalog.invalidate();
await assert.rejects(
  () => leasedCatalog.list(),
  ActiveAgentRunResourceMutationError,
  "catalog loading must not execute Extension code while Package mutation is active",
);
releaseCatalogMutation();
assert.deepEqual(await leasedCatalog.list(), tools);
assert.equal(loadCount, 2, "Package mutation invalidation must force the catalog to resolve the new resource tree");

let response: unknown;
const handled = await handleAgentCatalogRoute(
  { method: "GET" } as never,
  {} as never,
  new URL("http://127.0.0.1/api/agent/tools"),
  {
    json: (_res, status, data) => {
      assert.equal(status, 200);
      response = data;
    },
    listAgentSkills: async () => [],
    listAgentPrompts: async () => [],
    readModelDefaults: async () => ({}),
    listAgentToolMetadata: async () => tools,
    readAgentBridgeCatalog: async () => ({}),
  },
);
assert.equal(handled, true);
assert.deepEqual(response, { tools });

console.log("agent_tool_catalog tests passed");
