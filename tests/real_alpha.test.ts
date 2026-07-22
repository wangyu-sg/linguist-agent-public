import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProjectManifest, importPhraseBatch, runRealAlpha } from "@linguist-agent/cat-data";

const masterFixture = `<?xml version="1.0"?>
<xliff version="1.2"><file source-language="zh-CN" target-language="en-US"><body>
  <trans-unit id="1001"><source>暗影徽记</source><target>Shadow Emblem</target></trans-unit>
  <trans-unit id="1002"><source>获得&lt;color=#ffffff&gt;30%攻击速度&lt;/color&gt;。</source><target>Gain &lt;color=#ffffff&gt;30% Attack Speed&lt;/color&gt;.</target></trans-unit>
</body></file></xliff>`;

const mxliffFixture = `<?xml version="1.0"?>
<xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file original="master.xliff" source-language="zh-cn" target-language="en-us"><body>
  <group id="1" m:para-id="1"><context-group><context context-type="x-key">1001</context></context-group>
    <trans-unit id="job:1" m:para-id="1" m:locked="false"><source>暗影徽记</source><target>Shadow Emblem</target></trans-unit>
  </group>
  <group id="2" m:para-id="2"><context-group><context context-type="x-key">1002</context></context-group>
    <trans-unit id="job:2" m:para-id="2" m:locked="false"><source>获得{1}30%攻击速度{2}。</source><target>Gain {1}30% Attack Speed{2}.</target></trans-unit>
  </group>
</body></file></xliff>`;

const workspaceRoot = await mkdtemp(join(tmpdir(), "la-alpha-test-"));
const customerRoot = join(workspaceRoot, "customer");
await mkdir(customerRoot, { recursive: true });
await writeFile(join(customerRoot, "reference.md"), "# Style\nUse title case for item names.\n", "utf8");
await writeFile(join(customerRoot, "translation memory.csv"), "中文,English,Note\n暗影徽记,Shadow Emblem,item\n", "utf8");
const mxliffPath = join(customerRoot, "sample.mxliff");
const masterPath = join(customerRoot, "master.xliff");
await writeFile(mxliffPath, mxliffFixture, "utf8");
await writeFile(masterPath, masterFixture, "utf8");

await createProjectManifest(workspaceRoot, customerRoot, {
  projectId: "real-alpha",
  sourceLanguage: "zh-CN",
  targetLanguage: "en-US",
});
await importPhraseBatch(workspaceRoot, {
  projectId: "real-alpha",
  mxliffPath,
  masterXliffPath: masterPath,
  batchId: "b1",
});

const report = await runRealAlpha(workspaceRoot, { projectId: "real-alpha", batchIds: ["b1"] });
assert.equal(report.projectId, "real-alpha");
assert.equal(report.p0p1DeliveryRisks.length, 0);
assert.equal(report.batches[0]?.delivery.status, "pass");
assert.equal(report.batches[0]?.export?.updatedSegments, 0);
assert.ok(report.assetBlocks && report.assetBlocks.blocksWritten > 0);
await stat(report.batches[0]?.export?.outputPath ?? "");
const markdown = await readFile(report.reportPath, "utf8");
assert.match(markdown, /No P0\/P1 delivery blockers/);
assert.match(markdown, /b1/);
assert.equal(report.mappingCandidates.some((row) => row.assetPath === "translation memory.csv" && row.candidates.length), true);
assert.match(markdown, /## Mapping Candidates/);
assert.match(markdown, /translation memory\.csv/);
console.log("real_alpha tests passed");
