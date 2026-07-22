import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createProjectManifest,
  importPhraseBatch,
  readWorkflowArtifacts,
  runPhraseQaWorkflow,
  runPlatformBackfillWorkflow,
  runPlatformWriteGate,
  type PhrasePlatformAdapter,
} from "@linguist-agent/cat-data";

const mxliffFixture = `<?xml version="1.0"?>
<xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file original="ops.xliff" source-language="zh-cn" target-language="en-us"><body>
  <group id="1" m:para-id="1"><context-group><context context-type="x-key">1001</context></context-group>
    <trans-unit id="job:1" m:para-id="1" m:locked="false"><source>&lt;u&gt;名称&lt;/u&gt;</source><target>&lt;u&gt;Name&lt;/u&gt;</target></trans-unit>
  </group>
  <group id="2" m:para-id="2"><context-group><context context-type="x-key">1002</context></context-group>
    <trans-unit id="job:2" m:para-id="2" m:locked="false"><source>获得1个奖励</source><target>Gain 1 reward</target></trans-unit>
  </group>
</body></file></xliff>`;

const workspaceRoot = await mkdtemp(join(tmpdir(), "la-platform-ops-test-"));
const customerRoot = join(workspaceRoot, "customer");
await mkdir(customerRoot, { recursive: true });
await writeFile(join(customerRoot, "ops.mxliff"), mxliffFixture, "utf8");

await createProjectManifest(workspaceRoot, customerRoot, {
  projectId: "ops",
  sourceLanguage: "zh-CN",
  targetLanguage: "en-US",
});
await importPhraseBatch(workspaceRoot, {
  projectId: "ops",
  mxliffPath: "ops.mxliff",
  batchId: "b1",
});

let gate = await runPlatformWriteGate(workspaceRoot, "ops", "b1", "job:1", "Hero Name");
assert.equal(gate.ok, false);
assert.equal(gate.blockers.some((item) => item.code === "UNDERLINE_SIGNATURE_MISMATCH"), true);

gate = await runPlatformWriteGate(workspaceRoot, "ops", "b1", "job:1", "<u>Hero Name</u>");
assert.equal(gate.ok, true);

const phraseTargets = new Map<string, string>([
  ["job:1", "<u>Name</u>"],
  ["job:2", "Gain 1 reward"],
]);
const adapter: PhrasePlatformAdapter = {
  async readSegment(segmentId) {
    return { segmentId, target: phraseTargets.get(segmentId) ?? "" };
  },
  async writeTarget(segmentId, target) {
    phraseTargets.set(segmentId, target);
  },
  async readTarget(segmentId) {
    return phraseTargets.get(segmentId) ?? "";
  },
};

let backfill = await runPlatformBackfillWorkflow(workspaceRoot, "ops", [
  {
    batchId: "b1",
    segmentId: "job:1",
    target: "<u>Hero Name</u>",
    expectedCurrentTarget: "<u>Name</u>",
  },
], adapter);
assert.equal(backfill.verified, 1);
assert.equal(backfill.blocked, 0);
assert.equal(phraseTargets.get("job:1"), "<u>Hero Name</u>");

let artifacts = await readWorkflowArtifacts(workspaceRoot, "ops");
assert.equal(artifacts.backfillRows.find((row) => row.segmentId === "job:1")?.state, "readback_verified");
assert.equal(artifacts.browserAutomationChecks.some((row) => row.operation === "readback" && row.status === "verified" && row.lastVerifiedSegmentId === "job:1"), true);
assert.equal(artifacts.authorityDecisions.find((row) => row.decisionKey === "job:1")?.winner.tier, "phrase_final_stage");

backfill = await runPlatformBackfillWorkflow(workspaceRoot, "ops", [
  {
    id: "bf-strip",
    batchId: "b1",
    segmentId: "job:1",
    target: "Hero Name",
    expectedCurrentTarget: "<u>Hero Name</u>",
  },
], adapter);
assert.equal(backfill.blocked, 1);
assert.equal(backfill.stopped, true);
assert.equal(phraseTargets.get("job:1"), "<u>Hero Name</u>");
artifacts = await readWorkflowArtifacts(workspaceRoot, "ops");
assert.equal(artifacts.backfillRows.find((row) => row.id === "bf-strip")?.state, "blocked");
assert.equal(artifacts.browserAutomationChecks.some((row) => row.operation === "backfill" && row.status === "blocked" && /UNDERLINE_SIGNATURE_MISMATCH/.test(row.error ?? "")), true);

let qaCaptureIndex = 0;
const qaCaptures = [
  {
    hasLoadMore: true,
    rows: [
      { id: "qa-1", segmentId: "job:1", category: "Formatting", message: "Underline formatting issue", evidence: "Phrase QA row 1" },
    ],
  },
  {
    hasLoadMore: false,
    rows: [
      { id: "qa-1", segmentId: "job:1", category: "Formatting", message: "Underline formatting issue", evidence: "Phrase QA row 1" },
      { id: "qa-2", segmentId: "job:2", category: "Unconfirmed", message: "未确认句段", evidence: "Phrase QA row 2" },
      { id: "qa-3", segmentId: "job:2", category: "Number", message: "false positive number warning", evidence: "Phrase QA row 3" },
    ],
  },
];
const qaResult = await runPhraseQaWorkflow(workspaceRoot, "ops", {
  async runQa() {
    qaCaptureIndex = 0;
  },
  async captureQa() {
    return qaCaptures[qaCaptureIndex];
  },
  async loadMoreQa() {
    qaCaptureIndex = 1;
    return qaCaptures[qaCaptureIndex];
  },
});
assert.equal(qaResult.capturedRows, 3);
assert.equal(qaResult.hasLoadMore, false);
artifacts = await readWorkflowArtifacts(workspaceRoot, "ops");
assert.equal(artifacts.phraseQaRows.find((row) => row.id === "qa-2")?.disposition, "retained_unconfirmed");
assert.equal(artifacts.phraseQaRows.find((row) => row.id === "qa-3")?.disposition, "ignored_false_positive");
assert.equal(artifacts.browserAutomationChecks.some((row) => row.operation === "qa_load_more" && row.status === "verified" && row.hasLoadMore === false), true);
assert.equal(artifacts.browserAutomationChecks.find((row) => row.id === "qa:final")?.status, "verified");

console.log("platform_ops tests passed");
