import assert from "node:assert/strict";
import { buildCompletionAuditReport, renderCompletionAuditMarkdown, type CompletionAuditInput } from "@linguist-agent/cat-data";

const input: CompletionAuditInput & { reportPath: string } = {
  checkedAt: "2026-05-29T00:00:00.000Z",
  version: "2.32.7",
  projectId: "synthetic-game-project",
  reportPath: "/tmp/completion.md",
  primaryUse: {
    status: "pass",
    reportPath: "/tmp/primary.md",
    failures: [],
    warnings: [],
    checks: [],
  },
  runtimeHealthStatus: "pass",
  risks: [{ id: "KR-001", severity: "P2", status: "monitoring", area: "Frontend", summary: "Polish remains." }],
  trackedRuntimeFiles: [],
  implementation: {
    toolMetadata: true,
    runtimeHooks: true,
    noSilentFallbackTrace: true,
    deliveryAudit: true,
  },
};

const pass = buildCompletionAuditReport(input);
assert.equal(pass.status, "pass");
assert.match(renderCompletionAuditMarkdown(pass), /LA Production Completion Audit/);

const fail = buildCompletionAuditReport({
  ...input,
  runtimeHealthStatus: "fail",
  risks: [{ id: "KR-002", severity: "P1", status: "open", area: "Delivery", summary: "Unsafe export." }],
  trackedRuntimeFiles: ["data/projects/customer/batch.json"],
});
assert.equal(fail.status, "fail");
assert.match(fail.failures.join("\n"), /pi_runtime_health/);
assert.match(fail.failures.join("\n"), /no_tracked_customer_runtime_data/);

console.log("completion_audit tests passed");
