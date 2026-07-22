import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProjectManifest, importPhraseBatch, runProjectHealthCheck, updateSegmentTarget } from "@linguist-agent/cat-data";
import { createProjectHealthTool } from "@linguist-agent/cat-tools";

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
    <trans-unit id="job:2" m:para-id="2" m:locked="false"><source>勇者徽记</source><target></target></trans-unit>
  </group>
</body></file></xliff>`;

const workspaceRoot = await mkdtemp(join(tmpdir(), "la-health-test-"));
const projectRoot = join(workspaceRoot, "client");
await mkdir(projectRoot, { recursive: true });
await writeFile(join(projectRoot, "master.xliff"), masterFixture, "utf8");
await writeFile(join(projectRoot, "batch.mxliff"), mxliffFixture, "utf8");
await writeFile(join(projectRoot, "memory.tmx"), `<?xml version="1.0"?><tmx version="1.4"><body></body></tmx>`, "utf8");
await writeFile(join(projectRoot, "translation memory.csv"), "中文,English\n勇者徽记,Hero Emblem\n", "utf8");
await writeFile(join(projectRoot, "style.md"), "# Style\nUse Gem for 宝石.\n", "utf8");

await createProjectManifest(workspaceRoot, projectRoot, {
  projectId: "proj",
  sourceLanguage: "zh-CN",
  targetLanguage: "en-US",
});
await importPhraseBatch(workspaceRoot, {
  projectId: "proj",
  mxliffPath: "batch.mxliff",
  masterXliffPath: "master.xliff",
  batchId: "b1",
});

let health = await runProjectHealthCheck(workspaceRoot, "proj");
assert.equal(health.status, "fail");
assert.equal(health.summary.batches, 1);
assert.equal(health.summary.deliveryFailures, 1);
assert.equal(health.issues.some((issue) => issue.code === "SUGGESTED_IMPORTS_NOT_SATISFIED"), true);
assert.equal(health.missingSuggestedActions.some((action) => action.assetPath === "translation memory.csv" && action.tool === "workbook_preview -> tm_import_table"), true);
assert.equal(
  health.issues.some((issue) => issue.nextActions?.some((action) => action.includes("workbook_mapping_candidates") && action.includes("translation memory.csv"))),
  true,
);
assert.equal(health.issues.some((issue) => issue.code === "BATCH_DELIVERY_BLOCKED"), true);

await updateSegmentTarget(workspaceRoot, "proj", "b1", {
  segmentId: "job:2",
  target: "Hero Emblem",
  confirm: false,
  reason: "fill test target",
  changeType: "user_approved",
});
await writeFile(join(projectRoot, "new-reference.md"), "new file", "utf8");
health = await runProjectHealthCheck(workspaceRoot, "proj");
assert.equal(health.status, "warn");
assert.equal(health.summary.addedAssets, 1);
assert.equal(health.issues.some((issue) => issue.code === "ASSET_ADDED_SINCE_MANIFEST"), true);

{
  const previousCwd = process.cwd();
  process.chdir(workspaceRoot);
  try {
    const tool = createProjectHealthTool();
    const output = await tool.execute("tool-call", { projectId: "proj" });
    assert.match(output.content[0].text, /Project Health/);
    assert.match(output.content[0].text, /ASSET_ADDED_SINCE_MANIFEST/);
    assert.match(output.content[0].text, /workbook_mapping_candidates/);
  } finally {
    process.chdir(previousCwd);
  }
}

console.log("project_health tests passed");
