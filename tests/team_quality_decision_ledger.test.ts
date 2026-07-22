import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readQualityDecisionLedger,
  syncTeamQualityDecisionLedger,
  type DeliveryQaFinding,
  type TeamDecision,
  type TeamRoleFinding,
} from "@linguist-agent/cat-data";

function teamFinding(id: string, segmentId: string): TeamRoleFinding {
  return {
    id,
    workflowId: "workflow-1",
    roleId: "editor",
    segmentId,
    severity: "major",
    type: "accuracy",
    message: `Review ${segmentId}.`,
    evidenceRefs: [`tm:${segmentId}`],
  };
}

function deliveryFinding(id: string, segmentId: string): DeliveryQaFinding {
  return {
    id,
    type: "placeholder_mismatch",
    severity: "blocker",
    segmentId,
    message: `Placeholder mismatch in ${segmentId}.`,
    evidence: [`constraint:${segmentId}`],
  };
}

function decision(id: string, findingId: string, segmentId: string, decidedBy: TeamDecision["decidedBy"] = "user"): TeamDecision {
  return {
    id,
    workflowId: "workflow-1",
    segmentId,
    decision: decidedBy === "user" ? "accepted_risk" : "query",
    reason: decidedBy === "user" ? "User accepted the scoped risk." : "Lead linguist requests clarification.",
    findingIds: [findingId],
    evidenceRefs: [`decision:${id}`],
    decidedBy,
  };
}

const root = await mkdtemp(join(tmpdir(), "la-team-quality-ledger-"));
try {
  const input = {
    projectId: "replay",
    batchId: "batch-1",
    workflowId: "workflow-1",
    teamFindings: [teamFinding("team-f1", "s1")],
    deliveryQaFindings: [deliveryFinding("delivery-f1", "s2")],
    decisions: [
      decision("decision-1", "team-f1", "s1"),
      decision("decision-2", "delivery-f1", "s2", "lead_linguist"),
    ],
  } as const;
  const first = await syncTeamQualityDecisionLedger(root, input);
  const replay = await syncTeamQualityDecisionLedger(root, input);
  assert.deepEqual({ appended: first.appended, skipped: first.skipped }, { appended: 4, skipped: 0 });
  assert.deepEqual({ appended: replay.appended, skipped: replay.skipped }, { appended: 0, skipped: 4 });
  let ledger = await readQualityDecisionLedger(root, "replay");
  assert.equal(ledger.length, 4);
  assert.deepEqual(ledger.map((event) => event.sequence), [1, 2, 3, 4]);
  assert.equal(new Set(ledger.map((event) => event.logicalEventId)).size, 4);
  assert.equal(ledger.find((event) => event.findingId === "team-f1" && event.decision === "open")?.severity, "major");
  assert.equal(ledger.find((event) => event.findingId === "delivery-f1" && event.decision === "open")?.severity, "blocker");
  assert.equal(ledger.find((event) => event.findingId === "team-f1" && event.kind === "team_decision")?.actor, "user");

  const projectFinding = { ...teamFinding("project-finding", "unused"), segmentId: undefined };
  await syncTeamQualityDecisionLedger(root, {
    projectId: "project-context",
    batchId: "batch-1",
    workflowId: "workflow-1",
    teamFindings: [projectFinding],
    decisions: [decision("segment-decision", "project-finding", "s1")],
  });
  const projectContextLedger = await readQualityDecisionLedger(root, "project-context");
  assert.equal(projectContextLedger.find((event) => event.kind === "team_decision")?.segmentId, "s1");

  const concurrentInput = {
    projectId: "concurrent",
    batchId: "batch-1",
    workflowId: "workflow-1",
    teamFindings: [teamFinding("team-f1", "s1")],
    decisions: [decision("decision-1", "team-f1", "s1")],
  } as const;
  const concurrent = await Promise.all(Array.from({ length: 20 }, () => syncTeamQualityDecisionLedger(root, concurrentInput)));
  assert.equal(concurrent.reduce((total, result) => total + result.appended, 0), 2);
  assert.equal(concurrent.reduce((total, result) => total + result.skipped, 0), 38);
  ledger = await readQualityDecisionLedger(root, "concurrent");
  assert.equal(ledger.length, 2);
  assert.equal(ledger[1]?.previousHash, ledger[0]?.hash);

  await syncTeamQualityDecisionLedger(root, {
    projectId: "scope",
    batchId: "batch-1",
    workflowId: "workflow-1",
    teamFindings: [teamFinding("team-f1", "s1")],
    decisions: [decision("decision-1", "team-f1", "s1")],
  });
  await assert.rejects(syncTeamQualityDecisionLedger(root, {
    projectId: "scope",
    batchId: "batch-1",
    workflowId: "workflow-2",
    decisions: [{ ...decision("cross-workflow", "team-f1", "s1"), workflowId: "workflow-2" }],
  }), /outside batch-1\/workflow-2/);
  await assert.rejects(syncTeamQualityDecisionLedger(root, {
    projectId: "scope",
    batchId: "batch-1",
    workflowId: "workflow-1",
    decisions: [decision("wrong-segment", "team-f1", "s2")],
  }), /segment scope does not match/);
  await assert.rejects(syncTeamQualityDecisionLedger(root, {
    projectId: "scope",
    batchId: "batch-1",
    workflowId: "workflow-1",
    teamFindings: [teamFinding("shared-id", "s1")],
    deliveryQaFindings: [deliveryFinding("shared-id", "s1")],
  }), /conflicting source or segment scope/);
  await assert.rejects(syncTeamQualityDecisionLedger(root, {
    projectId: "scope",
    batchId: "batch-1",
    workflowId: "workflow-1",
    teamFindings: [teamFinding("team-f1", "s1")],
    decisions: [{ ...decision("decision-1", "team-f1", "s1"), reason: "Mutated replay payload." }],
  }), /conflicts with its recorded payload/);
  assert.equal((await readQualityDecisionLedger(root, "scope")).length, 2, "a rejected replay must not append a partial batch");
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("team quality decision ledger tests passed");
