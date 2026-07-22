import assert from "node:assert/strict";
import { matchReadinessDecisions, summarizeReadinessDecisions } from "@linguist-agent/cat-data";

const accepted = {
  ts: "2026-05-29T00:00:00.000Z",
  projectId: "p",
  kind: "accept_warning" as const,
  warningPattern: "mapping candidates",
  reason: "Not required for this delivery phase.",
  decidedBy: "test",
};

const matches = matchReadinessDecisions(["glossary has 6 mapping candidates ready"], [accepted]);
assert.equal(matches[0]?.decision?.reason, "Not required for this delivery phase.");

const reopened = matchReadinessDecisions(
  ["glossary has 6 mapping candidates ready"],
  [
    accepted,
    {
      ts: "2026-05-29T00:01:00.000Z",
      projectId: "p",
      kind: "reopen_warning",
      warningPattern: "mapping candidates",
      reason: "Now required.",
      decidedBy: "test",
    },
  ],
);
assert.equal(reopened[0]?.decision, undefined);

const summary = summarizeReadinessDecisions("/tmp/la", "p", [accepted]);
assert.equal(summary.total, 1);
assert.equal(summary.accepted.length, 1);
assert.match(summary.path, /readiness_decisions\.jsonl/);

console.log("readiness_decisions tests passed");
