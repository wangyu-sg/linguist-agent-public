import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  confirmProjectTagRule,
  createManualProjectTagRuleCandidate,
  declareNoProjectTagRules,
  disableProjectTagRule,
  exportCsvBatch,
  importCsvBatch,
  readBatch,
  readExportAuditRecords,
  readProjectTagRules,
  readWorkflowArtifacts,
  runDeliveryCheck,
  runQualityAudit,
  runPlatformWriteGate,
  updateSegmentTarget,
  upsertDeliveryRiskWaiver,
  upsertQualityFindingWaiver,
  writeProjectTagRuleCandidates,
  type TagRule,
} from "@linguist-agent/cat-data";

const rule: TagRule = {
  id: "quest-tag",
  class: "formatting",
  pattern: "<\\/?quest(?:=[^>]+)?>",
  flags: "g",
  origin: "llm",
  status: "candidate",
  confidence: 0.99,
  occurrences: 2,
  segmentCoverage: 1,
  examples: [{ batchId: "b1", segmentId: "s1", text: "<quest=main>" }],
};

async function makeProject(
  projectId: string,
  initialTarget = "<quest=main>Main Quest</quest>",
  source = "<quest=main>主线任务</quest>",
): Promise<{ root: string; csvPath: string }> {
  const root = await mkdtemp(join(tmpdir(), "la-tag-rules-gate-"));
  const csvPath = join(root, "batch.csv");
  await writeFile(
    csvPath,
    [
      "SegmentID,Source,Target",
      `"s1","${source}","${initialTarget}"`,
    ].join("\n"),
    "utf8",
  );
  await importCsvBatch(root, { projectId, batchId: "b1", csvPath, sourceLanguage: "zh-CN", targetLanguage: "en-US" });
  return { root, csvPath };
}

{
  const { root } = await makeProject("manual-candidate");
  try {
    const manual = await createManualProjectTagRuleCandidate(root, "manual-candidate", {
      id: "manual-quest",
      class: "formatting",
      pattern: "<\\/?quest(?:=[^>]+)?>",
      flags: "g",
      note: "PM-added project rule.",
    });
    const rule = manual.rules.find((row) => row.id === "manual-quest");
    assert.equal(rule?.origin, "manual");
    assert.equal(rule?.status, "candidate");
    assert.equal(manual.onboarding.status, "pending", "manual candidates still require explicit confirm");
    await assert.rejects(
      () => createManualProjectTagRuleCandidate(root, "manual-candidate", {
        id: "bad-manual",
        class: "formatting",
        pattern: "(<quest=+",
      }),
      /regex rejected/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

{
  const { root } = await makeProject("candidate");
  try {
    await writeProjectTagRuleCandidates(root, "candidate", [rule]);
    await updateSegmentTarget(root, "candidate", "b1", {
      segmentId: "s1",
      target: "Main Quest",
      reason: "candidate rules must not block writes",
      changeType: "user_approved",
    });
    const platform = await runPlatformWriteGate(root, "candidate", "b1", "s1", "Main Quest");
    assert.equal(platform.ok, true);
    const delivery = await runDeliveryCheck(root, "candidate", "b1");
    assert.equal(delivery.blockers.some((issue) => issue.code === "PROJECT_TAG_SIGNATURE_MISMATCH"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

{
  const { root } = await makeProject("active");
  try {
    await writeProjectTagRuleCandidates(root, "active", [rule]);
    await confirmProjectTagRule(root, "active", "quest-tag");

    await assert.rejects(
      () => updateSegmentTarget(root, "active", "b1", {
        segmentId: "s1",
        target: "Main Quest",
        reason: "active project tag must block writes",
        changeType: "user_approved",
      }),
      /PROJECT_TAG_SIGNATURE_MISMATCH/,
    );

    await updateSegmentTarget(root, "active", "b1", {
      segmentId: "s1",
      target: "Main Quest",
      reason: "accepted risk override",
      changeType: "user_approved",
      acceptedRiskCodes: ["s1:PROJECT_TAG_SIGNATURE_MISMATCH"],
    });
    assert.equal((await readBatch(root, "active", "b1")).segments[0].target, "Main Quest");

    const platformBlocked = await runPlatformWriteGate(root, "active", "b1", "s1", "Main Quest");
    assert.equal(platformBlocked.ok, false);
    assert.equal(platformBlocked.blockers.some((item) => item.code === "PROJECT_TAG_SIGNATURE_MISMATCH"), true);
    const platformAccepted = await runPlatformWriteGate(root, "active", "b1", "s1", "Main Quest", ["PROJECT_TAG_SIGNATURE_MISMATCH"]);
    assert.equal(platformAccepted.ok, true);

    const delivery = await runDeliveryCheck(root, "active", "b1");
    assert.equal(delivery.status, "fail");
    assert.equal(delivery.rulesDigest.startsWith("sha256:"), true);
    assert.equal(delivery.activeProjectRuleCount, 1);
    assert.equal(delivery.candidateRuleCount, 0);
    assert.equal(delivery.blockers.some((issue) => issue.code === "PROJECT_TAG_SIGNATURE_MISMATCH"), true);
    const artifacts = await readWorkflowArtifacts(root, "active");
    const risk = artifacts.riskQueue.find((item) => item.segmentId === "s1");
    assert.ok(risk?.risks.includes("tag"));

    await assert.rejects(
      () => exportCsvBatch(root, { projectId: "active", batchId: "b1" }),
      /Quality decision ledger blocked export/,
    );
    const forced = await exportCsvBatch(root, { projectId: "active", batchId: "b1", force: true });
    assert.equal(forced.delivery.blockers.some((issue) => issue.code === "PROJECT_TAG_SIGNATURE_MISMATCH"), true);
    const audits = await readExportAuditRecords(root, "active", "b1");
    assert.equal(audits[0].rulesDigest, forced.delivery.rulesDigest);
    assert.equal(audits[0].activeProjectRuleCount, 1);
    assert.equal(audits[0].candidateRuleCount, 0);

    await upsertDeliveryRiskWaiver(root, "active", {
      batchId: "b1",
      segmentId: "s1",
      code: "TAG_SIGNATURE_MISMATCH",
      reason: "User confirmed the target intentionally drops the project markup.",
      acceptedBy: "test-user",
    });
    await upsertDeliveryRiskWaiver(root, "active", {
      batchId: "b1",
      segmentId: "s1",
      code: "PROJECT_TAG_SIGNATURE_MISMATCH",
      reason: "User confirmed the target intentionally drops the project markup.",
      acceptedBy: "test-user",
    });
    const waivedDelivery = await runDeliveryCheck(root, "active", "b1");
    assert.equal(waivedDelivery.status, "warn");
    assert.equal(waivedDelivery.blockers.some((issue) => issue.code === "PROJECT_TAG_SIGNATURE_MISMATCH"), false);
    assert.equal((waivedDelivery.waived ?? []).some((issue) => issue.code === "PROJECT_TAG_SIGNATURE_MISMATCH"), true);
    for (const warning of waivedDelivery.warnings) {
      for (const segmentId of warning.segmentIds.length ? warning.segmentIds : ["batch"]) {
        await upsertDeliveryRiskWaiver(root, "active", {
          batchId: "b1",
          segmentId,
          code: warning.code,
          reason: "User reviewed the remaining delivery warning for this test export.",
          acceptedBy: "test-user",
        });
      }
    }
    const explicitRiskExport = await exportCsvBatch(root, { projectId: "active", batchId: "b1" });
    assert.equal((explicitRiskExport.delivery.waived ?? []).some((issue) => issue.code === "PROJECT_TAG_SIGNATURE_MISMATCH"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

{
  const { root } = await makeProject("active-empty-target", "");
  try {
    await writeProjectTagRuleCandidates(root, "active-empty-target", [rule]);
    await confirmProjectTagRule(root, "active-empty-target", "quest-tag");

    const delivery = await runDeliveryCheck(root, "active-empty-target", "b1");
    assert.equal(delivery.blockers.some((issue) => issue.code === "UNTRANSLATED_EDITABLE"), true);
    assert.equal(delivery.blockers.some((issue) => issue.code === "TAG_SIGNATURE_MISMATCH"), false);
    assert.equal(delivery.blockers.some((issue) => issue.code === "PROJECT_TAG_SIGNATURE_MISMATCH"), false);
    assert.equal(delivery.summary.tagMismatchSegments, 0);
    assert.equal(delivery.summary.projectTagMismatchSegments, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

{
  const { root } = await makeProject("legacy-empty-target", "", "<b>主线任务</b>");
  try {
    const untranslated = await runDeliveryCheck(root, "legacy-empty-target", "b1");
    assert.equal(untranslated.blockers.some((issue) => issue.code === "UNTRANSLATED_EDITABLE"), true);
    assert.equal(untranslated.blockers.some((issue) => issue.code === "TAG_SIGNATURE_MISMATCH"), false);
    assert.equal(untranslated.summary.tagMismatchSegments, 0);

    const batch = await readBatch(root, "legacy-empty-target", "b1");
    batch.segments[0].target = "Main Quest";
    await writeFile(join(root, "data/projects/legacy-empty-target/batches/b1/batch.json"), `${JSON.stringify(batch, null, 2)}\n`, "utf8");

    const malformed = await runDeliveryCheck(root, "legacy-empty-target", "b1");
    assert.equal(malformed.blockers.some((issue) => issue.code === "TAG_SIGNATURE_MISMATCH"), true);
    assert.equal(malformed.summary.tagMismatchSegments, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

{
  const { root } = await makeProject("disabled");
  try {
    await writeProjectTagRuleCandidates(root, "disabled", [rule]);
    await confirmProjectTagRule(root, "disabled", "quest-tag");
    await disableProjectTagRule(root, "disabled", "quest-tag");
    await updateSegmentTarget(root, "disabled", "b1", {
      segmentId: "s1",
      target: "Main Quest",
      reason: "disabled rules must not block writes",
      changeType: "user_approved",
    });
    const disabledDelivery = await runDeliveryCheck(root, "disabled", "b1");
    assert.equal(disabledDelivery.blockers.some((issue) => issue.code === "PROJECT_TAG_SIGNATURE_MISMATCH"), false);
    for (const issue of [...disabledDelivery.blockers, ...disabledDelivery.warnings]) {
      for (const segmentId of issue.segmentIds.length ? issue.segmentIds : ["batch"]) {
        await upsertDeliveryRiskWaiver(root, "disabled", { batchId: "b1", segmentId, code: issue.code, reason: "Reviewed outside the disabled project-rule assertion.", acceptedBy: "test-user" });
      }
    }
    const disabledQuality = await runQualityAudit(root, "disabled", "b1");
    for (const finding of disabledQuality.findings.filter((row) => row.status === "open" && row.authority !== "delivery_signature")) {
      await upsertQualityFindingWaiver(root, "disabled", { batchId: "b1", segmentId: finding.segmentId, findingId: finding.id, code: finding.code, reason: "Reviewed outside the disabled project-rule assertion.", acceptedBy: "test-user" });
    }
    const exported = await exportCsvBatch(root, { projectId: "disabled", batchId: "b1" });
    assert.equal(exported.delivery.blockers.some((issue) => issue.code === "PROJECT_TAG_SIGNATURE_MISMATCH"), false);
    assert.equal((await readFile(exported.outputPath, "utf8")).includes("Main Quest"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

// D — onboarding marker: the two honest exits + self-healing.
{
  // Default: a fresh project has never been through discovery → "pending".
  const { root } = await makeProject("onboarding-default");
  try {
    const fresh = await readProjectTagRules(root, "onboarding-default");
    assert.equal(fresh.onboarding.status, "pending");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

{
  // Exit 1 — confirm ≥1 rule → "confirmed".
  const { root } = await makeProject("onboarding-confirm");
  try {
    const candidate = await writeProjectTagRuleCandidates(root, "onboarding-confirm", [rule]);
    assert.equal(candidate.onboarding.status, "pending", "candidates alone do not satisfy onboarding");
    const confirmed = await confirmProjectTagRule(root, "onboarding-confirm", "quest-tag");
    assert.equal(confirmed.onboarding.status, "confirmed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

{
  // Exit 2 — declare the project has no extra tag rules → "declared_none".
  const { root } = await makeProject("onboarding-declare");
  try {
    const declared = await declareNoProjectTagRules(root, "onboarding-declare");
    assert.equal(declared.onboarding.status, "declared_none");
    assert.ok(declared.onboarding.updatedAt, "declared_none records when it was decided");
    // Persists across reads.
    assert.equal((await readProjectTagRules(root, "onboarding-declare")).onboarding.status, "declared_none");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

{
  // Self-heal: a stored "declared_none" can never overstate coverage — once an
  // active rule exists the status derives to "confirmed" regardless of the marker.
  const { root } = await makeProject("onboarding-selfheal");
  try {
    await declareNoProjectTagRules(root, "onboarding-selfheal");
    await writeProjectTagRuleCandidates(root, "onboarding-selfheal", [rule]);
    await confirmProjectTagRule(root, "onboarding-selfheal", "quest-tag");
    assert.equal((await readProjectTagRules(root, "onboarding-selfheal")).onboarding.status, "confirmed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

console.log("tag_rules_gate tests passed");
