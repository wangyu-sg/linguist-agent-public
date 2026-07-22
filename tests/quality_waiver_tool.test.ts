import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createProjectManifest,
  createTmStore,
  createWorkspace,
  importCsvBatch,
  runQualityAudit,
} from "@linguist-agent/cat-data";
import { buildCatTools } from "@linguist-agent/cat-tools";

const root = await mkdtemp(join(tmpdir(), "la-quality-waiver-tool-"));
const customerRoot = join(root, "customer");
await mkdir(customerRoot, { recursive: true });
const csvPath = join(customerRoot, "batch.csv");
await writeFile(
  csvPath,
  ["SegmentID,Source,Target,Status", "s1,巅峰对决,Peak Duel,draft"].join("\n"),
  "utf8",
);

await createProjectManifest(root, customerRoot, {
  projectId: "qw",
  sourceLanguage: "zh-CN",
  targetLanguage: "en-US",
});
await importCsvBatch(root, { projectId: "qw", csvPath, batchId: "b1" });

const workspace = createWorkspace(root, "qw");
// TM only: an explicitly reviewed exact TM row whose target the draft does not match.
// No termbase entry, so quality_audit fires exactly one blocker
// (TM_EXACT_TARGET_MISMATCH) and the waiver test is unambiguous.
await createTmStore(workspace).seed([
  { id: "tm-peak", source: "巅峰对决", target: "The Pinnacle", srcLang: "zh-CN", tgtLang: "en-US", origin: "reviewed", quality: 100 },
]);

const tools = buildCatTools(workspace);
const qualityAuditTool = tools.find((tool) => tool.name === "quality_audit");
const qualityWaiverTool = tools.find((tool) => tool.name === "quality_waiver");
assert.ok(qualityAuditTool, "quality_audit tool must be registered");
assert.ok(qualityWaiverTool, "quality_waiver tool must be registered");

// Before waiver: the exact TM mismatch is an open blocker.
const before = await qualityAuditTool.execute("tool-call", { batchId: "b1" });
assert.equal(before.details.status, "fail");
assert.equal(before.details.blockers, 1);
const audited0 = await runQualityAudit(root, "qw", "b1");
const tmFinding = audited0.findings.find(
  (finding) => finding.segmentId === "s1" && finding.code === "TM_EXACT_TARGET_MISMATCH",
);
assert.ok(tmFinding, "expected a TM_EXACT_TARGET_MISMATCH finding on s1");

// The user explicitly accepts this specific quality risk.
const accepted = await qualityWaiverTool.execute("tool-call", {
  batchId: "b1",
  segmentId: "s1",
  findingId: tmFinding.id,
  code: tmFinding.code,
  reason: "Customer accepted this event title for the current handoff.",
  acceptedBy: "reviewer-a",
});
assert.match(accepted.content[0].text, /Quality Risk Accepted/);
assert.match(accepted.content[0].text, /stays visible in quality_audit reports/);
assert.equal(accepted.details.waivers.length, 1);
assert.equal(accepted.details.waivers[0].reason, "Customer accepted this event title for the current handoff.");
assert.equal(accepted.details.waivers[0].acceptedBy, "reviewer-a");

// After waiver: re-running quality_audit marks the finding ignored, not open.
const after = await qualityAuditTool.execute("tool-call", { batchId: "b1" });
assert.equal(after.details.ignored, 1, "waived finding must be counted as ignored");
assert.equal(after.details.blockers, 0, "no open blockers remain after the waiver");
assert.equal(after.details.status, "pass");

// The underlying finding is not erased: it is still present with status ignored.
const audited = await runQualityAudit(root, "qw", "b1");
const waivedFinding = audited.findings.find((finding) => finding.id === tmFinding.id);
assert.ok(waivedFinding);
assert.equal(waivedFinding.status, "ignored");
assert.equal(waivedFinding.ignoredReason, "Customer accepted this event title for the current handoff.");
assert.ok(waivedFinding.ignoredAt, "ignoredAt timestamp must be recorded");

// A waiver without a reason must be rejected (audit record integrity).
await assert.rejects(
  () =>
    qualityWaiverTool.execute("tool-call", {
      batchId: "b1",
      segmentId: "s1",
      findingId: tmFinding.id,
      code: tmFinding.code,
      reason: "   ",
    }),
  /reason/,
  "quality_waiver must reject an empty reason",
);

// A waiver whose segmentId does not match the finding must be rejected, so a
// mismatched segment/code cannot silently ignore the wrong finding.
await assert.rejects(
  () =>
    qualityWaiverTool.execute("tool-call", {
      batchId: "b1",
      segmentId: "s-wrong-segment",
      findingId: tmFinding.id,
      code: tmFinding.code,
      reason: "mismatched segment should be rejected",
    }),
  /segmentId mismatch/,
  "quality_waiver must reject a segmentId that does not match the finding",
);

// A waiver whose code does not match the finding must be rejected.
await assert.rejects(
  () =>
    qualityWaiverTool.execute("tool-call", {
      batchId: "b1",
      segmentId: "s1",
      findingId: tmFinding.id,
      code: "TERM_PREFERRED_MISSING",
      reason: "mismatched code should be rejected",
    }),
  /code mismatch/,
  "quality_waiver must reject a code that does not match the finding",
);

// A waiver for a finding id that does not exist in the batch must be rejected.
await assert.rejects(
  () =>
    qualityWaiverTool.execute("tool-call", {
      batchId: "b1",
      segmentId: "s1",
      findingId: "TM_EXACT_TARGET_MISMATCH:s1:deadbeefdead",
      code: tmFinding.code,
      reason: "nonexistent finding should be rejected",
    }),
  /not found/,
  "quality_waiver must reject a finding id that does not exist in the batch",
);

console.log("quality_waiver tool tests passed");
