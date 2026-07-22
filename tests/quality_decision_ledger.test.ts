import { strict as assert } from "node:assert";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendQualityDecisionLedger,
  appendQualityDecisionLedgerOnce,
  authorizeQualityLedgerExport,
  qualityDecisionLedgerPath,
  readDeliveryRiskWaivers,
  readQualityFindingWaivers,
  readQualityDecisionLedger,
  summarizeQualityDecisionLedger,
  upsertDeliveryRiskWaiver,
  upsertQualityFindingWaiver,
} from "@linguist-agent/cat-data";

const root = await mkdtemp(join(tmpdir(), "la-quality-ledger-"));
try {
  const writes = await Promise.all([
    appendQualityDecisionLedger(root, {
      projectId: "project-1",
      batchId: "batch-1",
      segmentId: "s1",
      findingId: "f1",
      code: "TERM_PREFERRED_MISSING",
      kind: "quality_finding",
      decision: "open",
      evidenceRefs: ["termbase:foo"],
      recordedAt: "2026-07-10T00:00:00.000Z",
    }),
    appendQualityDecisionLedger(root, {
      projectId: "project-1",
      batchId: "batch-1",
      segmentId: "s1",
      findingId: "f1",
      code: "TERM_PREFERRED_MISSING",
      kind: "quality_waiver",
      decision: "ignore_with_reason",
      reason: "Client-approved proper noun.",
      actor: "user",
      recordedAt: "2026-07-10T00:00:01.000Z",
    }),
    appendQualityDecisionLedger(root, {
      projectId: "project-1",
      batchId: "batch-1",
      kind: "export_authorization",
      decision: "authorized",
      reason: "All remaining findings reviewed.",
      actor: "lead_linguist",
      recordedAt: "2026-07-10T00:00:02.000Z",
    }),
  ]);
  assert.deepEqual(writes.map((event) => event.sequence).sort((a, b) => a - b), [1, 2, 3]);
  const events = await readQualityDecisionLedger(root, "project-1");
  assert.equal(events.length, 3);
  assert.equal(events[1]?.previousHash, events[0]?.hash);
  assert.equal(events[2]?.previousHash, events[1]?.hash);
  assert.equal(summarizeQualityDecisionLedger(events).acceptedRisks, 1);
  assert.equal(summarizeQualityDecisionLedger(events).exportAuthorizations, 1);
  assert.equal(summarizeQualityDecisionLedger(events).openFindings, 0);
  assert.equal((await readFile(qualityDecisionLedgerPath(root, "project-1"), "utf8")).trim().split("\n").length, 3);

  await assert.rejects(
    appendQualityDecisionLedger(root, { projectId: "project-1", kind: "quality_waiver", decision: "ignore_with_reason" }),
    /requires a reason/,
  );
  await assert.rejects(
    appendQualityDecisionLedger(root, { projectId: "../escape", kind: "quality_finding", decision: "open" }),
    /safe projectId/,
  );

  await upsertQualityFindingWaiver(root, "ledger-only", {
    batchId: "batch-1",
    segmentId: "s1",
    findingId: "quality-1",
    code: "TERM_PREFERRED_MISSING",
    reason: "Approved wording.",
    acceptedBy: "user",
  });
  await upsertDeliveryRiskWaiver(root, "ledger-only", {
    batchId: "batch-1",
    segmentId: "s1",
    code: "TAG_SIGNATURE_MISMATCH",
    reason: "Approved delivery exception.",
    acceptedBy: "user",
  });
  assert.equal((await readQualityFindingWaivers(root, "ledger-only"))[0]?.findingId, "quality-1");
  assert.equal((await readDeliveryRiskWaivers(root, "ledger-only"))[0]?.code, "TAG_SIGNATURE_MISMATCH");
  assert.equal((await readQualityDecisionLedger(root, "ledger-only")).length, 2);
  await upsertQualityFindingWaiver(root, "ledger-only", {
    batchId: "batch-1",
    segmentId: "s1",
    findingId: "quality-1",
    code: "TERM_PREFERRED_MISSING",
    reason: "Approved wording.",
    acceptedBy: "user",
  });
  assert.equal((await readQualityDecisionLedger(root, "ledger-only")).length, 2, "an identical waiver replay must not append");
  await upsertQualityFindingWaiver(root, "ledger-only", {
    batchId: "batch-1",
    segmentId: "s1",
    findingId: "quality-1",
    code: "TERM_PREFERRED_MISSING",
    reason: "Updated approval rationale.",
    acceptedBy: "user",
  });
  assert.equal((await readQualityFindingWaivers(root, "ledger-only"))[0]?.reason, "Updated approval rationale.");
  assert.equal((await readQualityDecisionLedger(root, "ledger-only")).length, 3);
  await assert.rejects(access(join(root, "data/projects/ledger-only/quality_waivers.json")), { code: "ENOENT" });
  await assert.rejects(access(join(root, "data/projects/ledger-only/delivery_waivers.json")), { code: "ENOENT" });

  await appendQualityDecisionLedger(root, {
    projectId: "authorization",
    batchId: "batch-1",
    workflowId: "workflow-1",
    findingId: "finding-1",
    kind: "team_finding",
    decision: "open",
  });
  const blockedInput = {
    projectId: "authorization",
    batchId: "batch-1",
    workflowId: "workflow-1",
    blockerFindingIds: ["finding-1"],
    unreviewedFindingIds: ["finding-1"],
  } as const;
  assert.equal((await authorizeQualityLedgerExport(root, blockedInput)).authorized, false);
  assert.deepEqual(
    await authorizeQualityLedgerExport(root, {
      projectId: "authorization",
      batchId: "batch-1",
      workflowId: "workflow-1",
    }),
    {
      authorized: false,
      blockers: [],
      unreviewedFindingIds: ["finding-1"],
      waivedFindingIds: [],
    },
    "authorization must derive unresolved findings from the scoped ledger instead of trusting a caller-supplied subset",
  );
  assert.equal((await authorizeQualityLedgerExport(root, {
    ...blockedInput,
    blockerFindingIds: ["finding-1", "finding-1"],
  })).authorized, false, "input order and duplicates must not create another authorization state");
  await appendQualityDecisionLedger(root, {
    projectId: "authorization",
    batchId: "batch-1",
    workflowId: "workflow-1",
    findingId: "finding-1",
    kind: "team_decision",
    decision: "accept",
    reason: "User accepted the finding.",
    actor: "user",
  });
  assert.equal((await authorizeQualityLedgerExport(root, blockedInput)).authorized, true);
  assert.equal((await authorizeQualityLedgerExport(root, blockedInput)).authorized, true);
  const authorizationEvents = (await readQualityDecisionLedger(root, "authorization"))
    .filter((event) => event.kind === "export_authorization");
  assert.deepEqual(authorizationEvents.map((event) => event.decision), ["blocked", "blocked", "authorized"]);
  assert.equal(new Set(authorizationEvents.map((event) => event.logicalEventId)).size, 3);

  await appendQualityDecisionLedger(root, {
    projectId: "batch-authorization",
    batchId: "batch-1",
    workflowId: "workflow-1",
    findingId: "team-blocker",
    severity: "blocker",
    kind: "team_finding",
    decision: "open",
  });
  const batchAuthorization = await authorizeQualityLedgerExport(root, {
    projectId: "batch-authorization",
    batchId: "batch-1",
  });
  assert.deepEqual(batchAuthorization.blockers, ["team-blocker"], "a Team blocker must block ordinary batch export");
  assert.deepEqual(batchAuthorization.unreviewedFindingIds, ["team-blocker"]);

  await appendQualityDecisionLedgerOnce(root, [{
    projectId: "finding-scope",
    batchId: "batch-1",
    workflowId: "workflow-1",
    segmentId: "s1",
    findingId: "shared-id",
    kind: "quality_finding",
    decision: "open",
    logicalEventId: "quality:shared-id",
  }]);
  await assert.rejects(appendQualityDecisionLedgerOnce(root, [{
    projectId: "finding-scope",
    batchId: "batch-1",
    workflowId: "workflow-1",
    segmentId: "s1",
    findingId: "shared-id",
    kind: "delivery_finding",
    decision: "open",
    logicalEventId: "delivery:shared-id",
  }]), /conflicting source or segment scope/);

  const ledgerPath = qualityDecisionLedgerPath(root, "project-1");
  const original = await readFile(ledgerPath, "utf8");
  await writeFile(ledgerPath, original.replace("Client-approved", "tampered"), "utf8");
  await assert.rejects(readQualityDecisionLedger(root, "project-1"), /hash is invalid|hash chain is broken/);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("quality_decision_ledger tests passed");
