import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProjectManifest, importPhraseBatch, runBetaDeliveryCandidate } from "@linguist-agent/cat-data";

const masterFixture = `<?xml version="1.0"?>
<xliff version="1.2"><file source-language="zh-CN" target-language="en-US"><body>
  <trans-unit id="1001"><source>暗影徽记</source><target>Shadow Emblem</target></trans-unit>
  <trans-unit id="1002"><source>勇者徽记</source><target>Hero Emblem</target></trans-unit>
</body></file></xliff>`;

function mxliffFixture(target1: string, target2: string): string {
  return `<?xml version="1.0"?>
<xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file original="master.xliff" source-language="zh-cn" target-language="en-us"><body>
  <group id="1" m:para-id="1"><context-group><context context-type="x-key">1001</context></context-group>
    <trans-unit id="job:1" m:para-id="1" m:locked="false"><source>暗影徽记</source><target>${target1}</target></trans-unit>
  </group>
  <group id="2" m:para-id="2"><context-group><context context-type="x-key">1002</context></context-group>
    <trans-unit id="job:2" m:para-id="2" m:locked="false"><source>勇者徽记</source><target>${target2}</target></trans-unit>
  </group>
</body></file></xliff>`;
}

const workspaceRoot = await mkdtemp(join(tmpdir(), "la-beta-test-"));
const customerRoot = join(workspaceRoot, "customer");
await mkdir(customerRoot, { recursive: true });
await writeFile(join(customerRoot, "reference.md"), "# Style\nUse title case for item names.\n", "utf8");
await writeFile(join(customerRoot, "master.xliff"), masterFixture, "utf8");
await writeFile(join(customerRoot, "batch-a.mxliff"), mxliffFixture("Shadow Emblem", "Hero Emblem"), "utf8");
await writeFile(join(customerRoot, "batch-b.mxliff"), mxliffFixture("Shadow Emblem", "Hero Emblem"), "utf8");

await createProjectManifest(workspaceRoot, customerRoot, {
  projectId: "beta",
  sourceLanguage: "zh-CN",
  targetLanguage: "en-US",
});
await importPhraseBatch(workspaceRoot, {
  projectId: "beta",
  mxliffPath: "batch-a.mxliff",
  masterXliffPath: "master.xliff",
  batchId: "a",
});
await importPhraseBatch(workspaceRoot, {
  projectId: "beta",
  mxliffPath: "batch-b.mxliff",
  masterXliffPath: "master.xliff",
  batchId: "b",
});

const pass = await runBetaDeliveryCandidate(workspaceRoot, { projectId: "beta", batchIds: ["a", "b"] });
assert.equal(pass.failures.length, 0);
assert.equal(pass.batchCount, 2);
assert.equal(pass.alpha.batches.every((batch) => batch.delivery.status === "pass" && batch.export), true);
assert.match(await readFile(pass.reportPath, "utf8"), /LA Beta Delivery Candidate Report/);

const fail = await runBetaDeliveryCandidate(workspaceRoot, { projectId: "beta", batchIds: ["a"], minBatches: 2 });
assert.equal(fail.status, "fail");
assert.match(fail.failures.join("\n"), /requires at least 2/);

console.log("beta_candidate tests passed");
