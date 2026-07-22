import assert from "node:assert/strict";
import { buildPrimaryUseReadiness, renderPrimaryUseReadinessMarkdown, type PrimaryUseReadinessInput } from "@linguist-agent/cat-data";

const baseInput: PrimaryUseReadinessInput & { reportPath: string } = {
  checkedAt: "2026-05-29T00:00:00.000Z",
  version: "0.95.0",
  projectId: "synthetic-game-project",
  reportPath: "/tmp/primary.md",
  beta: {
    status: "pass",
    batchCount: 2,
    minBatches: 2,
    reportPath: "/tmp/beta.md",
    failures: [],
    warnings: [],
    alpha: {
      projectId: "synthetic-game-project",
      checkedAt: "2026-05-29T00:00:00.000Z",
      root: "/tmp/customer",
      manifestUpdatedAt: "2026-05-29T00:00:00.000Z",
      healthBefore: {} as never,
      healthAfter: {} as never,
      batches: [
        { batchId: "b1", format: "phrase_mxliff", delivery: { status: "pass", blockers: [], warnings: [] } as never, proposals: { sets: 0, proposed: 0, applied: 0, skipped: 0, rejected: 0 }, export: { auditId: "a1" } as never },
        { batchId: "b2", format: "phrase_mxliff", delivery: { status: "pass", blockers: [], warnings: [] } as never, proposals: { sets: 0, proposed: 0, applied: 0, skipped: 0, rejected: 0 }, export: { auditId: "a2" } as never },
      ],
      status: "pass",
      p0p1DeliveryRisks: [],
      warnings: [],
      mappingCandidates: [],
      reportPath: "/tmp/alpha.md",
    },
  },
  risks: [{ id: "KR-001", severity: "P2", status: "monitoring", area: "Frontend", summary: "Polish remains." }],
  readinessDecisions: {
    summary: { path: "/tmp/readiness_decisions.jsonl", total: 0, accepted: [] },
    matches: [],
  },
};

const pass = buildPrimaryUseReadiness(baseInput);
assert.equal(pass.status, "pass");
assert.match(renderPrimaryUseReadinessMarkdown(pass), /LA Primary-Use Readiness Report/);

const warningDecision = {
  ts: "2026-05-29T00:00:00.000Z",
  projectId: "synthetic-game-project",
  kind: "accept_warning" as const,
  warningPattern: "mapping candidates",
  reason: "Not required for this delivery phase.",
  decidedBy: "test",
};
const acceptedWarning = buildPrimaryUseReadiness({
  ...baseInput,
  beta: { ...baseInput.beta, status: "warn", warnings: ["Style guide has pending mapping candidates."] },
  readinessDecisions: {
    summary: { path: "/tmp/readiness_decisions.jsonl", total: 1, accepted: [warningDecision] },
    matches: [{ warning: "Style guide has pending mapping candidates.", decision: warningDecision }],
  },
});
assert.equal(acceptedWarning.status, "pass");
assert.match(renderPrimaryUseReadinessMarkdown(acceptedWarning), /Not required for this delivery phase/);

const fail = buildPrimaryUseReadiness({
  ...baseInput,
  risks: [{ id: "KR-002", severity: "P1", status: "open", area: "Delivery", summary: "Unsafe export." }],
});
assert.equal(fail.status, "fail");
assert.match(fail.failures.join("\n"), /no_open_p0_p1/);

console.log("primary_use_readiness tests passed");
