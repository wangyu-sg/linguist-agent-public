import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendMemoryAudit, buildMemoryStatus, createWorkspace, readMemoryAuditSummary, readMemoryConfig } from "@linguist-agent/cat-data";

const disabled = buildMemoryStatus({ enabled: false, gatewayUrl: "http://127.0.0.1:8420" });
assert.equal(disabled.status, "disabled");
assert.equal(disabled.toolsAvailable, false);
assert.equal(disabled.captureEnabled, false);
assert.equal(disabled.cacheSafety, "tool_tail_only");
assert.equal(disabled.userIdStrategy, "project_id");
assert.equal(disabled.semantic.state, "disabled");

const unreachable = buildMemoryStatus({ enabled: true, gatewayUrl: "http://127.0.0.1:8420" }, false);
assert.equal(unreachable.status, "gateway_unreachable");
assert.equal(unreachable.gatewayReachable, false);
assert.match(unreachable.nextAction ?? "", /tdai:start/);

const ready = buildMemoryStatus({ enabled: true, gatewayUrl: "http://127.0.0.1:8420" }, true);
assert.equal(ready.status, "ready");
assert.equal(ready.toolsAvailable, true);
assert.equal(ready.captureEnabled, false);
assert.match(ready.nextAction ?? "", /read-only project recall/);
assert.equal(ready.semantic.assetVectorIndex, "absent");

const readyWithSemantic = buildMemoryStatus(
  { enabled: true, gatewayUrl: "http://127.0.0.1:8420" },
  true,
  undefined,
  { state: "ready", assetVectorIndex: "ready", embeddingModel: "la-local-hash-v1", indexedBlocks: 12 },
);
assert.equal(readyWithSemantic.semantic.state, "ready");
assert.equal(readyWithSemantic.semantic.indexedBlocks, 12);

const root = await mkdtemp(join(tmpdir(), "la-memory-audit-"));
const workspace = createWorkspace(root, "proj");
const defaultConfig = await readMemoryConfig(workspace);
assert.equal(defaultConfig.enabled, false);
assert.equal(defaultConfig.gatewayUrl, "http://127.0.0.1:8420");

await appendMemoryAudit(workspace, {
  kind: "capture_failed",
  gatewayUrl: "http://127.0.0.1:8420",
  error: "boom",
});
await appendMemoryAudit(workspace, {
  kind: "capture_success",
  gatewayUrl: "http://127.0.0.1:8420",
  sessionId: "s1",
  contentPreview: "hello",
});
await appendMemoryAudit(workspace, {
  kind: "search_success",
  gatewayUrl: "http://127.0.0.1:8420",
  query: "term",
  resultCount: 2,
  strategy: "vector",
});
const audit = await readMemoryAuditSummary(workspace);
assert.equal(audit.total, 3);
assert.equal(audit.lastCaptureError, undefined);
assert.ok(audit.lastCaptureAt);
assert.ok(audit.lastSearchAt);
const readyWithAudit = buildMemoryStatus({ enabled: true, gatewayUrl: "http://127.0.0.1:8420" }, true, audit);
assert.equal(readyWithAudit.audit?.total, 3);

console.log("memory_status tests passed");
