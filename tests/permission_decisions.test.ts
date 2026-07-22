import assert from "node:assert/strict";
import { createPermissionDecisionRegistry } from "../packages/cat-server/src/permission_decisions.js";

const registry = createPermissionDecisionRegistry({ timeoutMs: 1_000 });
const pending = registry.request({
  toolName: "bash",
  domain: "bash",
  riskClass: "high",
  argsSummary: "pwd",
  sessionId: "session-1",
});

assert.equal(registry.pendingCount(), 1);
assert.equal(registry.decide(pending.request.requestId, { decision: "approve" }).ok, true);
assert.deepEqual(await pending.decision, { decision: "approve" });
assert.equal(registry.pendingCount(), 0);

const denied = registry.request({
  toolName: "web_search",
  domain: "webRead",
  riskClass: "medium",
  argsSummary: "query",
});
assert.equal(registry.decide(denied.request.requestId, { decision: "deny", reason: "not now" }).ok, true);
assert.deepEqual(await denied.decision, { decision: "deny", reason: "not now" });

const timeoutRegistry = createPermissionDecisionRegistry({ timeoutMs: 5 });
const timedOut = timeoutRegistry.request({
  toolName: "bash",
  domain: "bash",
  riskClass: "high",
  argsSummary: "sleep 1",
});
assert.deepEqual(await timedOut.decision, {
  decision: "deny",
  reason: "permission request timed out",
});
assert.equal(timeoutRegistry.pendingCount(), 0);
assert.equal(timeoutRegistry.decide("missing", { decision: "approve" }).ok, false);

const stoppedRegistry = createPermissionDecisionRegistry({ timeoutMs: 1_000 });
const stopped = stoppedRegistry.request({
  toolName: "bash",
  domain: "bash",
  riskClass: "high",
  argsSummary: "pwd",
  sessionId: "la-task-stopped",
});
const other = stoppedRegistry.request({
  toolName: "web_search",
  domain: "webRead",
  riskClass: "medium",
  argsSummary: "query",
  sessionId: "la-task-other",
});
assert.equal(stoppedRegistry.cancelForSession("la-task-stopped", "Task stopped"), 1);
assert.deepEqual(await stopped.decision, { decision: "deny", reason: "Task stopped" });
assert.equal(stoppedRegistry.pendingCount(), 1);
assert.equal(stoppedRegistry.decide(other.request.requestId, { decision: "deny" }).ok, true);

console.log("permission_decisions tests passed");
