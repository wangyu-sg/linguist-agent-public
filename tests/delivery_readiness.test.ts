import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildDeliveryReadinessReport,
  createProjectManifest,
  createProposalSet,
  exportPhraseMxliff,
  importPhraseBatch,
  readExportAuditRecords,
  readQualityDecisionLedger,
  runRcReadinessReport,
  runDeliveryCheck,
  updateSegmentTarget,
  upsertDeliveryRiskWaiver,
} from "@linguist-agent/cat-data";

const masterFixture = `<?xml version="1.0"?>
<xliff version="1.2"><file source-language="zh-CN" target-language="en-US"><body>
  <trans-unit id="1001"><source>暗影徽记</source><target>Shadow Emblem</target></trans-unit>
  <trans-unit id="1002"><source>勇者徽记</source><target>Hero Emblem</target></trans-unit>
</body></file></xliff>`;

const mxliffFixture = `<?xml version="1.0"?>
<xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file original="master.xliff" source-language="zh-cn" target-language="en-us"><body>
  <group id="1" m:para-id="1"><context-group><context context-type="x-key">1001</context></context-group>
    <trans-unit id="job:1" m:para-id="1" m:locked="false"><source>暗影徽记</source><target>Shadow Emblem</target></trans-unit>
  </group>
  <group id="2" m:para-id="2"><context-group><context context-type="x-key">1002</context></context-group>
    <trans-unit id="job:2" m:para-id="2" m:locked="false"><source>勇者徽记</source><target>Hero Emblem</target></trans-unit>
  </group>
</body></file></xliff>`;

const richTextMxliffFixture = `<?xml version="1.0"?>
<xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file original="rich.xliff" source-language="zh-cn" target-language="en-us"><body>
  <group id="1" m:para-id="1"><context-group><context context-type="x-key">2001</context></context-group>
    <trans-unit id="job:rich" m:para-id="1" m:locked="false"><source>&lt;u&gt;名称&lt;/u&gt;</source><target>&lt;u&gt;Name&lt;/u&gt;</target></trans-unit>
  </group>
</body></file></xliff>`;

const richTextStrippedMxliffFixture = `<?xml version="1.0"?>
<xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file original="rich-stripped.xliff" source-language="zh-cn" target-language="en-us"><body>
  <group id="1" m:para-id="1"><context-group><context context-type="x-key">2001</context></context-group>
    <trans-unit id="job:rich" m:para-id="1" m:locked="false"><source>&lt;u&gt;名称&lt;/u&gt;</source><target>Hero Name</target></trans-unit>
  </group>
</body></file></xliff>`;

const newlineMismatchMxliffFixture = `<?xml version="1.0"?>
<xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file original="newline-mismatch.xliff" source-language="zh-cn" target-language="en-us"><body>
  <group id="1" m:para-id="1"><context-group><context context-type="x-key">4001</context></context-group>
    <trans-unit id="job:1" m:para-id="1" m:locked="false"><source>暗影徽记</source><target>Assassin
Gem</target></trans-unit>
  </group>
  <group id="2" m:para-id="2"><context-group><context context-type="x-key">4002</context></context-group>
    <trans-unit id="job:2" m:para-id="2" m:locked="false"><source>勇者徽记</source><target>Fighter\\nGem</target></trans-unit>
  </group>
</body></file></xliff>`;

const literalNewlineConvertedFixture = `<?xml version="1.0"?>
<xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file original="literal-newline.xliff" source-language="zh-cn" target-language="en-us"><body>
  <group id="1" m:para-id="1"><context-group><context context-type="x-key">3001</context></context-group>
    <trans-unit id="job:literal" m:para-id="1" m:locked="false"><source>第一行\\n第二行</source><target>First line
Second line</target></trans-unit>
  </group>
</body></file></xliff>`;

const workspaceRoot = await mkdtemp(join(tmpdir(), "la-readiness-test-"));
const customerRoot = join(workspaceRoot, "customer");
await mkdir(customerRoot, { recursive: true });
await writeFile(join(customerRoot, "master.xliff"), masterFixture, "utf8");
await writeFile(join(customerRoot, "batch.mxliff"), mxliffFixture, "utf8");
await writeFile(join(customerRoot, "rich.mxliff"), richTextMxliffFixture, "utf8");
await writeFile(join(customerRoot, "rich-stripped.mxliff"), richTextStrippedMxliffFixture, "utf8");
await writeFile(join(customerRoot, "newline-mismatch.mxliff"), newlineMismatchMxliffFixture, "utf8");
await writeFile(join(customerRoot, "literal-newline.mxliff"), literalNewlineConvertedFixture, "utf8");

await createProjectManifest(workspaceRoot, customerRoot, {
  projectId: "ready",
  sourceLanguage: "zh-CN",
  targetLanguage: "en-US",
});
await importPhraseBatch(workspaceRoot, {
  projectId: "ready",
  mxliffPath: "batch.mxliff",
  masterXliffPath: "master.xliff",
  batchId: "b1",
});

let readiness = await buildDeliveryReadinessReport(workspaceRoot, "ready", "b1");
assert.equal(readiness.status, "pass");
assert.equal(readiness.exportAuditCount, 0);
assert.equal(readiness.files.every((file) => file.exists), true);
assert.match(readiness.nextActions.join("\n"), /No export audit exists yet/);

await createProposalSet(workspaceRoot, "ready", "b1", {
  proposalSetId: "style-pass",
  title: "Style pass",
  proposals: [
    {
      segmentId: "job:1",
      proposedTarget: "Shadow Emblem",
      reason: "style normalization",
      changeType: "style",
    },
  ],
});

readiness = await buildDeliveryReadinessReport(workspaceRoot, "ready", "b1");
assert.equal(readiness.status, "warn");
assert.equal(readiness.proposals.proposed, 1);
assert.match(readiness.nextActions.join("\n"), /Review\/apply\/reject 1 proposed/);

const exported = await exportPhraseMxliff(workspaceRoot, { projectId: "ready", batchId: "b1", force: true });
assert.ok(exported.auditId);
assert.ok(exported.auditPath);
const audits = await readExportAuditRecords(workspaceRoot, "ready", "b1");
assert.equal(audits.length, 1);
assert.equal(audits[0].format, "phrase_mxliff");
assert.equal(audits[0].force, true);
assert.equal(audits[0].warningCodes.includes("UNAPPLIED_PROPOSALS"), true);

readiness = await buildDeliveryReadinessReport(workspaceRoot, "ready", "b1");
assert.equal(readiness.exportAuditCount, 1);
assert.equal(readiness.latestExport?.auditId, exported.auditId);

const rc = await runRcReadinessReport(workspaceRoot, { projectId: "ready", batchIds: ["b1"] });
assert.equal(rc.status, "warn");
assert.match(await readFile(rc.reportPath, "utf8"), /LA RC Readiness Report/);

await createProjectManifest(workspaceRoot, customerRoot, {
  projectId: "newline",
  sourceLanguage: "zh-CN",
  targetLanguage: "en-US",
});
await importPhraseBatch(workspaceRoot, {
  projectId: "newline",
  mxliffPath: "newline-mismatch.mxliff",
  batchId: "b1",
});
const newlineDelivery = await runDeliveryCheck(workspaceRoot, "newline", "b1");
assert.equal(newlineDelivery.status, "fail");
assert.equal(newlineDelivery.blockers.some((issue) => issue.code === "HARD_NEWLINE_MISMATCH" && issue.segmentIds.includes("job:1")), true);
assert.equal(newlineDelivery.blockers.some((issue) => issue.code === "LITERAL_NEWLINE_MISMATCH" && issue.segmentIds.includes("job:2")), true);
assert.equal(newlineDelivery.summary.hardNewlineMismatchSegments, 1);
assert.equal(newlineDelivery.summary.literalNewlineMismatchSegments, 1);

await createProjectManifest(workspaceRoot, customerRoot, {
  projectId: "format-risk",
  sourceLanguage: "zh-CN",
  targetLanguage: "en-US",
});
await importPhraseBatch(workspaceRoot, {
  projectId: "format-risk",
  mxliffPath: "rich.mxliff",
  batchId: "b1",
});
let formatDelivery = await runDeliveryCheck(workspaceRoot, "format-risk", "b1");
assert.equal(formatDelivery.status, "pass");
await updateSegmentTarget(workspaceRoot, "format-risk", "b1", {
  segmentId: "job:rich",
  target: "<u>Hero Name</u>",
  confirm: true,
  propagateDuplicates: false,
  reason: "format safety risk regression",
  changeType: "user_approved",
});
formatDelivery = await runDeliveryCheck(workspaceRoot, "format-risk", "b1");
assert.equal(formatDelivery.status, "warn");
assert.equal(formatDelivery.blockers.length, 0);
assert.equal(formatDelivery.summary.richTextSegments, 1);
assert.equal(formatDelivery.summary.underlineSegments, 1);
assert.equal(formatDelivery.summary.nativeTagSegments, 1);
assert.equal(formatDelivery.warnings.some((issue) => issue.code === "UNDERLINE_PRESENT" && issue.segmentIds.includes("job:rich")), true);

await createProjectManifest(workspaceRoot, customerRoot, {
  projectId: "format-stripped",
  sourceLanguage: "zh-CN",
  targetLanguage: "en-US",
});
await importPhraseBatch(workspaceRoot, {
  projectId: "format-stripped",
  mxliffPath: "rich-stripped.mxliff",
  batchId: "b1",
});
formatDelivery = await runDeliveryCheck(workspaceRoot, "format-stripped", "b1");
assert.equal(formatDelivery.status, "fail");
assert.equal(formatDelivery.blockers.some((issue) => issue.code === "RICH_TEXT_SIGNATURE_MISMATCH" && issue.segmentIds.includes("job:rich")), true);
assert.equal(formatDelivery.blockers.some((issue) => issue.code === "UNDERLINE_SIGNATURE_MISMATCH" && issue.segmentIds.includes("job:rich")), true);
assert.equal(formatDelivery.summary.richTextMismatchSegments, 1);
assert.equal(formatDelivery.summary.underlineMismatchSegments, 1);
await upsertDeliveryRiskWaiver(workspaceRoot, "format-stripped", {
  batchId: "b1",
  segmentId: "job:rich",
  code: "TAG_SIGNATURE_MISMATCH",
  reason: "Reviewer accepted stripped markup for this client handoff.",
});
await upsertDeliveryRiskWaiver(workspaceRoot, "format-stripped", {
  batchId: "b1",
  segmentId: "job:rich",
  code: "RICH_TEXT_SIGNATURE_MISMATCH",
  reason: "Reviewer accepted stripped markup for this client handoff.",
});
await upsertDeliveryRiskWaiver(workspaceRoot, "format-stripped", {
  batchId: "b1",
  segmentId: "job:rich",
  code: "UNDERLINE_SIGNATURE_MISMATCH",
  reason: "Reviewer accepted stripped markup for this client handoff.",
});
const waivedReadiness = await buildDeliveryReadinessReport(workspaceRoot, "format-stripped", "b1");
assert.equal(waivedReadiness.status, "warn");
assert.equal(waivedReadiness.delivery.blockers.length, 0);
assert.equal(waivedReadiness.delivery.waived.length, 3);
const waiverLedger = await readQualityDecisionLedger(workspaceRoot, "format-stripped");
assert.equal(waiverLedger.filter((event) => event.kind === "delivery_waiver").every((event) => Boolean(event.findingId)), true);
assert.match(waivedReadiness.nextActions.join("\n"), /Accepted delivery risks remain waived/);
assert.match(waivedReadiness.nextActions.join("\n"), /No export audit exists yet/);

await createProjectManifest(workspaceRoot, customerRoot, {
  projectId: "literal-newline-converted",
  sourceLanguage: "zh-CN",
  targetLanguage: "en-US",
});
await importPhraseBatch(workspaceRoot, {
  projectId: "literal-newline-converted",
  mxliffPath: "literal-newline.mxliff",
  batchId: "b1",
});
const literalConvertedDelivery = await runDeliveryCheck(workspaceRoot, "literal-newline-converted", "b1");
assert.equal(literalConvertedDelivery.status, "pass");
assert.equal(literalConvertedDelivery.summary.hardNewlineMismatchSegments, 0);
assert.equal(literalConvertedDelivery.summary.literalNewlineMismatchSegments, 0);

console.log("delivery_readiness tests passed");
