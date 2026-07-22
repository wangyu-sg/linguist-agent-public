import assert from "node:assert/strict";
import { createMemorySearchTool, createMemoryStoreTool } from "@linguist-agent/cat-tools";

const originalFetch = globalThis.fetch;
const calls: Array<{ url: string; body: any }> = [];

globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ url: String(url), body });
  if (String(url).endsWith("/search/memories")) {
    return new Response(
      JSON.stringify({
        results: "- Client prefers Gem, not Jewel\n- Use Shadow Emblem for 暗影徽记",
        total: 2,
        strategy: "hybrid",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  if (String(url).endsWith("/capture")) {
    return new Response(JSON.stringify({ l0_recorded: 1, scheduler_notified: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  throw new Error(`unexpected fetch ${String(url)}`);
}) as typeof fetch;

try {
  const config = { enabled: true, gatewayUrl: "http://127.0.0.1:8420" };
  const search = createMemorySearchTool(config, "proj");
  const searchResult = await search.execute("tool-call", { query: "Gem preference", limit: 3 });
  const searchText = searchResult.content[0]?.type === "text" ? searchResult.content[0].text : "";
  assert.match(searchText, /Memory recall \(2 total, strategy: hybrid\)/);
  assert.match(searchText, /Freshness: queried_at /);
  assert.match(searchText, /Provenance: memory:proj via TencentDB-Agent-Memory/);
  assert.match(searchText, /tool_tail_only/);
  assert.match(searchText, /not citable CAT evidence/);
  assert.equal((searchResult.details as any).source, "tencentdb-agent-memory");
  assert.equal((searchResult.details as any).projectId, "proj");
  assert.equal((searchResult.details as any).limit, 3);
  assert.equal((searchResult.details as any).cacheSafety, "tool_tail_only");
  assert.equal((searchResult.details as any).evidencePolicy, "memory_is_recall_not_citable_evidence");
  assert.deepEqual(calls[0]?.body, { query: "Gem preference", limit: 3, scene: "proj" });

  const store = createMemoryStoreTool(config, "proj");
  const storeResult = await store.execute("tool-call", { content: "Use Gem for 宝石.", context: "Wangzhe Auto Chess" });
  const storeText = storeResult.content[0]?.type === "text" ? storeResult.content[0].text : "";
  assert.match(storeText, /Stored to project memory/);
  assert.equal(calls[1]?.body.session_key, "proj");
  assert.match(calls[1]?.body.assistant_content, /Use Gem/);
} finally {
  globalThis.fetch = originalFetch;
}

console.log("memory_tools tests passed");
