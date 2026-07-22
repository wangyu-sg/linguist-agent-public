import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyProposalSet,
  createProposalSet,
  importPhraseBatch,
  listProposalSets,
  readBatch,
  readProposalSet,
  renderProposalSetMarkdown,
  runDeliveryCheck,
  writeProposalReport,
} from "@linguist-agent/cat-data";
import { createProposalApplyTool, createProposalCreateTool, createProposalReadTool, createProposalReportTool } from "@linguist-agent/cat-tools";

const masterFixture = `<?xml version="1.0"?>
<xliff version="1.2"><file source-language="zh-CN" target-language="en-US"><body>
  <trans-unit id="1001"><source>暗影徽记</source><target>Shadow Emblem</target></trans-unit>
  <trans-unit id="1002"><source>勇者徽记</source><target>Hero Emblem</target></trans-unit>
  <trans-unit id="1003"><source>锁定文本</source><target>Locked Text</target></trans-unit>
</body></file></xliff>`;

const mxliffFixture = `<?xml version="1.0"?>
<xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file original="master.xliff" source-language="zh-cn" target-language="en-us"><body>
  <group id="1" m:para-id="1"><context-group><context context-type="x-key">1001</context></context-group>
    <trans-unit id="job:1" m:para-id="1" m:locked="false"><source>暗影徽记</source><target>Shadow Emblem</target></trans-unit>
  </group>
  <group id="2" m:para-id="2"><context-group><context context-type="x-key">1002</context></context-group>
    <trans-unit id="job:2" m:para-id="2" m:locked="false"><source>勇者徽记</source><target>Hero Emblem</target></trans-unit>
  </group>
  <group id="3" m:para-id="3"><context-group><context context-type="x-key">1003</context></context-group>
    <trans-unit id="job:3" m:para-id="3" m:locked="true"><source>锁定文本</source><target>Locked Text</target></trans-unit>
  </group>
</body></file></xliff>`;

const workspaceRoot = await mkdtemp(join(tmpdir(), "la-proposals-test-"));
const mxliffPath = join(workspaceRoot, "sample.mxliff");
const masterPath = join(workspaceRoot, "master.xliff");
await writeFile(mxliffPath, mxliffFixture, "utf8");
await writeFile(masterPath, masterFixture, "utf8");
await importPhraseBatch(workspaceRoot, {
  projectId: "proj",
  mxliffPath,
  masterXliffPath: masterPath,
  batchId: "b1",
});

await assert.rejects(
  () =>
    createProposalSet(workspaceRoot, "proj", "b1", {
      proposalSetId: "review-no-evidence",
      title: "Invalid evidence gate",
      proposals: [
        {
          segmentId: "job:2",
          proposedTarget: "Hero Emblem",
          reason: "Term rewrite without evidence should not be persisted",
          changeType: "term",
        },
      ],
    }),
  /requires citable evidenceSources/,
);

await assert.rejects(
  () =>
    createProposalSet(workspaceRoot, "proj", "b1", {
      proposalSetId: "review-audit-only-evidence",
      title: "Invalid audit-only evidence",
      proposals: [
        {
          segmentId: "job:2",
          proposedTarget: "Hero Emblem",
          reason: "Tool trace is not citable terminology evidence",
          changeType: "term",
          evidenceSources: ["tool_trace:abc123"],
        },
      ],
    }),
  /audit-only evidence/,
);

const { proposalSet } = await createProposalSet(workspaceRoot, "proj", "b1", {
  proposalSetId: "review-1",
  title: "Review pass",
  proposals: [
    {
      segmentId: "job:1",
      proposedTarget: "Shadow Emblem",
      reason: "Glossary row confirms possessive item style",
      changeType: "term",
      evidenceSources: ["glossary:row:1"],
      severity: "L2",
    },
    {
      segmentId: "job:3",
      proposedTarget: "Locked Rewrite",
      reason: "Locked proposal should be skipped",
      changeType: "style",
    },
  ],
});

assert.equal(proposalSet.proposals.length, 2);
assert.equal(proposalSet.proposals[0].originalTarget, "Shadow Emblem");
const listedBeforeApply = (await listProposalSets(workspaceRoot, "proj", "b1"))[0];
assert.deepEqual(listedBeforeApply.proposalSetId, "review-1");
assert.equal(listedBeforeApply.rejected, 0);
const initialMarkdown = renderProposalSetMarkdown(proposalSet, { generatedAt: "2026-05-28T00:00:00.000Z" });
assert.match(initialMarkdown, /Generated: 2026-05-28T00:00:00\.000Z/);
assert.match(initialMarkdown, /Set status: active/);
assert.match(initialMarkdown, /Status summary: proposed:2 · applied:0 · rejected:0 · skipped:0/);
assert.match(initialMarkdown, /source \| original target \| proposed target \| reason \/ rule \| evidence/);
const report = await writeProposalReport(workspaceRoot, "proj", "b1", "review-1", { generatedAt: "2026-05-28T00:01:00.000Z" });
assert.match(report.markdown, /Shadow Emblem/);
assert.equal(report.generatedAt, "2026-05-28T00:01:00.000Z");
assert.match(report.path ?? "", /review-1\.md$/);

let delivery = await runDeliveryCheck(workspaceRoot, "proj", "b1");
assert.equal(delivery.warnings.some((issue) => issue.code === "UNAPPLIED_PROPOSALS"), true);
assert.equal(delivery.summary.unappliedProposalRows, 2);

const apply = await applyProposalSet(workspaceRoot, "proj", "b1", "review-1", { confirm: true });
assert.deepEqual(apply.applied, [proposalSet.proposals[0].proposalId]);
assert.equal(apply.skipped.length, 1);
assert.match(apply.skipped[0].reason, /locked segment/);

const batch = await readBatch(workspaceRoot, "proj", "b1");
assert.equal(batch.segments.find((segment) => segment.id === "job:1")?.target, "Shadow Emblem");
assert.equal(batch.segments.find((segment) => segment.id === "job:1")?.status, "confirmed");
assert.equal(batch.segments.find((segment) => segment.id === "job:2")?.target, "Hero Emblem");
assert.equal(batch.segments.find((segment) => segment.id === "job:3")?.target, "Locked Text");

const after = await readProposalSet(workspaceRoot, "proj", "b1", "review-1");
assert.equal(after.proposals[0].status, "applied");
assert.equal(after.proposals[1].status, "skipped");
const afterMarkdown = renderProposalSetMarkdown(after, { generatedAt: "2026-05-28T00:02:00.000Z" });
assert.match(afterMarkdown, /Status summary: proposed:0 · applied:1 · rejected:0 · skipped:1/);
assert.match(afterMarkdown, /applied at /);
assert.match(afterMarkdown, /skipped: locked segment/);

delivery = await runDeliveryCheck(workspaceRoot, "proj", "b1");
assert.equal(delivery.warnings.some((issue) => issue.code === "UNAPPLIED_PROPOSALS"), false);

{
  const previousCwd = process.cwd();
  process.chdir(workspaceRoot);
  try {
    const createTool = createProposalCreateTool();
    const readTool = createProposalReadTool();
    const reportTool = createProposalReportTool();
    const applyTool = createProposalApplyTool();
    const created = await createTool.execute("tool-call", {
      projectId: "proj",
      batchId: "b1",
      proposalSetId: "review-2",
      title: "Language polish",
      proposals: [
        {
          segmentId: "job:2",
          proposedTarget: "Fighter's Gem",
          reason: "fluency polish",
          changeType: "fluency",
        },
      ],
    } as any);
    assert.match(created.content[0].text, /Proposal Set Created/);
    const read = await readTool.execute("tool-call", { projectId: "proj", batchId: "b1", proposalSetId: "review-2" });
    assert.match(read.content[0].text, /Fighter's Gem/);
    const reportOutput = await reportTool.execute("tool-call", { projectId: "proj", batchId: "b1", proposalSetId: "review-2", writeFile: false });
    assert.match(reportOutput.content[0].text, /reason \/ rule/);
    const applied = await applyTool.execute("tool-call", { projectId: "proj", batchId: "b1", proposalSetId: "review-2", confirm: false } as any);
    assert.match(applied.content[0].text, /Applied:/);
    const draftBatch = await readBatch(workspaceRoot, "proj", "b1");
    const draftSegment = draftBatch.segments.find((segment) => segment.id === "job:2");
    assert.equal(draftSegment?.target, "Fighter's Gem");
    assert.equal(draftSegment?.status, "draft");

    const rejectSet = await createTool.execute("tool-call", {
      projectId: "proj",
      batchId: "b1",
      proposalSetId: "review-3",
      title: "Reject persistence",
      proposals: [
        {
          segmentId: "job:2",
          proposedTarget: "Hero Emblem!",
          reason: "user rejected style punctuation",
          changeType: "style",
        },
        {
          segmentId: "job:1",
          proposedTarget: "Shadow Emblem!",
          reason: "still pending reviewer decision",
          changeType: "style",
        },
      ],
    } as any);
    assert.match(rejectSet.content[0].text, /review-3/);
    const rejected = await applyTool.execute("tool-call", {
      projectId: "proj",
      batchId: "b1",
      proposalSetId: "review-3",
      rejectProposalIds: ["p0001-job_2"],
    } as any);
    assert.match(rejected.content[0].text, /Rejected: p0001-job_2/);
    assert.match(rejected.content[0].text, /Applied: none/);
    const listedAfterReject = (await listProposalSets(workspaceRoot, "proj", "b1")).find((row) => row.proposalSetId === "review-3");
    assert.equal(listedAfterReject?.rejected, 1);
    assert.equal(listedAfterReject?.proposed, 1);
    const afterRejectOnly = await readProposalSet(workspaceRoot, "proj", "b1", "review-3");
    assert.equal(afterRejectOnly.status, "active");
    assert.equal(afterRejectOnly.proposals[0]?.status, "rejected");
    assert.equal(afterRejectOnly.proposals[1]?.status, "proposed");
    assert.equal((await readBatch(workspaceRoot, "proj", "b1")).segments.find((segment) => segment.id === "job:1")?.target, "Shadow Emblem");

    const supersedingSet = await createTool.execute("tool-call", {
      projectId: "proj",
      batchId: "b1",
      proposalSetId: "review-4",
      title: "Superseding review",
      supersedesProposalSetId: "review-3",
      proposals: [
        {
          segmentId: "job:2",
          proposedTarget: "Hero Emblem",
          reason: "later merged decision restores platform target",
          changeType: "style",
        },
      ],
    } as any);
    assert.match(supersedingSet.content[0].text, /Supersedes: review-3/);
    const superseded = await readProposalSet(workspaceRoot, "proj", "b1", "review-3");
    assert.equal(superseded.status, "superseded");
    assert.equal(superseded.supersededByProposalSetId, "review-4");
    const activeSuperseding = await readProposalSet(workspaceRoot, "proj", "b1", "review-4");
    assert.equal(activeSuperseding.status, "active");
    assert.equal(activeSuperseding.supersedesProposalSetId, "review-3");
  } finally {
    process.chdir(previousCwd);
  }
}

console.log("proposals tests passed");
