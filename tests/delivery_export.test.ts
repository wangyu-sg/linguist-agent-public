import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  exportPhraseMxliff,
  importPhraseBatch,
  readBatch,
  runDeliveryCheck,
  updateSegmentTarget,
} from "@linguist-agent/cat-data";
import { dehydratePhraseTarget, writePhraseDocxDocumentXml } from "@linguist-agent/cat-formats";

const masterFixture = `<?xml version="1.0"?>
<xliff version="1.2"><file source-language="zh-CN" target-language="en-US"><body>
  <trans-unit id="1001"><source>获得&lt;color=#ffffff&gt;30%攻击速度&lt;/color&gt;。</source><target>Gain &lt;color=#ffffff&gt;30% Attack Speed&lt;/color&gt;.</target></trans-unit>
  <trans-unit id="1002"><source>重复文本</source><target>Repeated Text</target></trans-unit>
</body></file></xliff>`;

const mxliffFixture = `<?xml version="1.0"?>
<xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file original="master.xliff" source-language="zh-cn" target-language="en-us"><body>
  <group id="1" m:para-id="1"><context-group><context context-type="x-key">1001</context></context-group>
    <trans-unit id="job:1" m:para-id="1" m:locked="false"><source>获得{1}30%攻击速度{2}。</source><target>Gain {1}30% Attack Speed{2}.</target></trans-unit>
  </group>
  <group id="2" m:para-id="2"><context-group><context context-type="x-key">1002</context></context-group>
    <trans-unit id="job:2" m:para-id="2" m:locked="false"><source>重复文本</source><target>Repeated Text</target></trans-unit>
  </group>
  <group id="3" m:para-id="3"><context-group><context context-type="x-key">1002</context></context-group>
    <trans-unit id="job:3" m:para-id="3" m:locked="false"><source>重复文本</source><target>Repeated Text</target></trans-unit>
  </group>
</body></file></xliff>`;

function row(id: string, source: string, target: string): string {
  return `<w:tr><w:tc><w:p><w:r><w:t>${id}</w:t></w:r></w:p></w:tc><w:tc><w:p/></w:tc><w:tc><w:p/></w:tc><w:tc><w:p><w:r><w:t>${source}</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:w="5005" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>${target}</w:t></w:r></w:p></w:tc><w:tc><w:p/></w:tc><w:tc><w:p/></w:tc></w:tr>`;
}

function minimalDocumentXml(): string {
  return `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl>${row("job:1", "源", "old target")}${row("missing", "源", "unchanged")}</w:tbl></w:body></w:document>`;
}

{
  const dehydrated = dehydratePhraseTarget(
    "Gain <color=#ffffff>30% Attack Speed</color>.",
    "获得{1}30%攻击速度{2}。",
    "获得<color=#ffffff>30%攻击速度</color>。",
  );
  assert.equal(dehydrated, "Gain {1}30% Attack Speed{2}.");
}

{
  const duplicateTags = dehydratePhraseTarget(
    `Tap <x id="1"/> then <x id="1"/>.`,
    "点击{1}然后{2}。",
    `点击<x id="1"/>然后<x id="1"/>。`,
  );
  assert.equal(duplicateTags, `Tap {1} then {2}.`);
}

{
  const variant = dehydratePhraseTarget(
    `Enter <bpt id="1">&lt;color=#ff0&gt;</bpt>battle<ept id="1">&lt;/color&gt;</ept>`,
    "进入{1>}战斗<1}",
    `进入<bpt id="1">&lt;color=#ff0&gt;</bpt>战斗<ept id="1">&lt;/color&gt;</ept>`,
  );
  assert.equal(variant, "Enter {1>}battle&lt;1}");
}

{
  const result = writePhraseDocxDocumentXml(minimalDocumentXml(), [{ id: "job:1", target: "New & Better <Target>" }]);
  assert.deepEqual(result.updatedIds, ["job:1"]);
  assert.deepEqual(result.missingIds, []);
  assert.match(result.documentXml, /New &amp; Better &lt;Target&gt;/);
  assert.match(result.documentXml, /<w:tcW w:w="5005" w:type="dxa"\/>/);
  assert.match(result.documentXml, /unchanged/);
}

const workspaceRoot = await mkdtemp(join(tmpdir(), "la-delivery-test-"));
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

let report = await runDeliveryCheck(workspaceRoot, "proj", "b1");
assert.equal(report.status, "pass");

const noOpMxliffExport = await exportPhraseMxliff(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  outputPath: join(workspaceRoot, "noop.mxliff"),
  force: true,
});
assert.equal(noOpMxliffExport.updatedSegments, 0);
assert.equal(await readFile(noOpMxliffExport.outputPath, "utf8"), mxliffFixture);

await updateSegmentTarget(workspaceRoot, "proj", "b1", {
  segmentId: "job:1",
  target: "Gain <color=#ffffff>30% Attack Speed</color>.",
  confirm: true,
  propagateDuplicates: false,
  reason: "human reviewed without target edit",
  changeType: "user_approved",
});
const confirmOnlyExport = await exportPhraseMxliff(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  outputPath: join(workspaceRoot, "confirm-only.mxliff"),
  force: true,
});
const confirmOnlyMxliff = await readFile(confirmOnlyExport.outputPath, "utf8");
assert.equal(confirmOnlyExport.updatedSegments, 1);
assert.match(confirmOnlyMxliff, /<trans-unit id="job:1"[^>]*m:confirmed="3"/);
assert.match(confirmOnlyMxliff, /<target>Gain \{1\}30% Attack Speed\{2\}\.<\/target>/);

await updateSegmentTarget(workspaceRoot, "proj", "b1", {
  segmentId: "job:2",
  target: "Repeated Copy",
  confirm: false,
  propagateDuplicates: false,
  reason: "test divergent duplicate",
  changeType: "user_approved",
});

report = await runDeliveryCheck(workspaceRoot, "proj", "b1");
assert.equal(report.status, "warn");
assert.equal(report.warnings[0].code, "DUPLICATE_TARGET_DIVERGENCE");
await assert.rejects(
  () => exportPhraseMxliff(workspaceRoot, { projectId: "proj", batchId: "b1" }),
  /unreviewed finding/,
  "an unreviewed delivery warning must block normal export through the quality ledger",
);

await updateSegmentTarget(workspaceRoot, "proj", "b1", {
  segmentId: "job:2",
  target: "Repeated Copy",
  confirm: true,
  propagateDuplicates: true,
  reason: "test align duplicate",
  changeType: "user_approved",
});

report = await runDeliveryCheck(workspaceRoot, "proj", "b1");
assert.equal(report.status, "pass");

await assert.rejects(
  () =>
    updateSegmentTarget(workspaceRoot, "proj", "b1", {
      segmentId: "job:1",
      target: "Gain 30% Attack Speed.",
      confirm: false,
      propagateDuplicates: false,
      reason: "intentional tag damage for write-policy regression",
      changeType: "user_approved",
    }),
  /tag signature policy/,
);
{
  const batch = await readBatch(workspaceRoot, "proj", "b1");
  batch.segments[0].target = "Gain 30% Attack Speed.";
  await writeFile(join(workspaceRoot, "data/projects/proj/batches/b1/batch.json"), `${JSON.stringify(batch, null, 2)}\n`, "utf8");
}
report = await runDeliveryCheck(workspaceRoot, "proj", "b1");
assert.equal(report.status, "fail");
assert.equal(report.blockers.some((issue) => issue.code === "TAG_SIGNATURE_MISMATCH"), true);

await updateSegmentTarget(workspaceRoot, "proj", "b1", {
  segmentId: "job:1",
  target: "Gain <color=#ffffff>30% Attack Speed</color>.",
  confirm: false,
  propagateDuplicates: false,
  reason: "restore tag signature",
  changeType: "user_approved",
});
report = await runDeliveryCheck(workspaceRoot, "proj", "b1");
assert.equal(report.status, "pass");

const mxliffExport = await exportPhraseMxliff(workspaceRoot, { projectId: "proj", batchId: "b1" });
const exportedMxliff = await readFile(mxliffExport.outputPath, "utf8");
assert.match(exportedMxliff, /<target>Repeated Copy<\/target>/);
assert.match(exportedMxliff, /<target>Gain \{1\}30% Attack Speed\{2\}\.<\/target>/);
assert.match(exportedMxliff, /<trans-unit id="job:2"[^>]*m:confirmed="3"/);
assert.match(exportedMxliff, /<trans-unit id="job:3"[^>]*m:confirmed="3"/);

{
  const batch = await readBatch(workspaceRoot, "proj", "b1");
  batch.segments[0].id = "missing-job";
  await writeFile(join(workspaceRoot, "data/projects/proj/batches/b1/batch.json"), `${JSON.stringify(batch, null, 2)}\n`, "utf8");
  await assert.rejects(
    () => exportPhraseMxliff(workspaceRoot, { projectId: "proj", batchId: "b1" }),
    /Phrase MXLIFF source is missing 1 segment ids/,
  );
  const forced = await exportPhraseMxliff(workspaceRoot, { projectId: "proj", batchId: "b1", force: true });
  assert.deepEqual(forced.missingIds, ["missing-job"]);
  batch.segments[0].id = "job:1";
  await writeFile(join(workspaceRoot, "data/projects/proj/batches/b1/batch.json"), `${JSON.stringify(batch, null, 2)}\n`, "utf8");
}

{
  const batch = await readBatch(workspaceRoot, "proj", "b1");
  batch.segments[2].locked = true;
  batch.segments[2].target = "Illegal locked mutation";
  await writeFile(join(workspaceRoot, "data/projects/proj/batches/b1/batch.json"), `${JSON.stringify(batch, null, 2)}\n`, "utf8");
  const forced = await exportPhraseMxliff(workspaceRoot, { projectId: "proj", batchId: "b1", force: true });
  const forcedContent = await readFile(forced.outputPath, "utf8");
  assert.doesNotMatch(forcedContent, /Illegal locked mutation/);
}

console.log("delivery_export tests passed");
