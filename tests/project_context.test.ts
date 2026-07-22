import assert from "node:assert/strict";
import { mkdir, mkdtemp, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildProjectContextSnapshot,
  createProjectManifest,
  formatProjectContextSnapshot,
  importPhraseBatch,
  projectManifestPath,
  readProjectManifest,
} from "@linguist-agent/cat-data";
import { buildCatTools } from "@linguist-agent/cat-tools";
import { createWorkspace } from "@linguist-agent/cat-data";

const workspaceRoot = await mkdtemp(join(tmpdir(), "la-context-test-"));
const projectRoot = join(workspaceRoot, "client");
await mkdir(projectRoot, { recursive: true });

const masterFixture = `<?xml version="1.0"?>
<xliff version="1.2"><file source-language="zh-CN" target-language="en-US"><body>
  <trans-unit id="1001"><source>暗影徽记</source><target>Shadow Emblem</target></trans-unit>
</body></file></xliff>`;

const mxliffFixture = `<?xml version="1.0"?>
<xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file original="master.xliff" source-language="zh-cn" target-language="en-us"><body>
  <group id="1" m:para-id="1"><context-group><context context-type="x-key">1001</context></context-group>
    <trans-unit id="job:1" m:para-id="1" m:locked="false" m:confirmed="2"><source>暗影徽记</source><target>Shadow Emblem</target></trans-unit>
  </group>
</body></file></xliff>`;

await writeFile(join(projectRoot, "master.xliff"), masterFixture, "utf8");
await writeFile(join(projectRoot, "batch.mxliff"), mxliffFixture, "utf8");
await writeFile(join(projectRoot, "style.md"), "# Style\nUse Gem for 宝石.\n", "utf8");

await createProjectManifest(workspaceRoot, projectRoot, { projectId: "proj", sourceLanguage: "zh-CN", targetLanguage: "en-US" });
await importPhraseBatch(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  mxliffPath: "batch.mxliff",
  masterXliffPath: "master.xliff",
});

const snapshot = await buildProjectContextSnapshot(workspaceRoot, "proj", { includeHealth: true });
assert.equal(snapshot.projectId, "proj");
assert.equal(snapshot.sourceLanguage, "zh-CN");
assert.equal(snapshot.targetLanguage, "en-US");
assert.equal(snapshot.batches[0]?.batchId, "b1");
assert.equal(snapshot.batches[0]?.confirmed, 1);
assert.equal(snapshot.coverage.totalBatches, 1);
assert.equal(snapshot.coverage.visibleBatches, 1);
assert.equal(snapshot.freshness.assetsChecked, snapshot.freshness.assetsAvailable);
assert.equal(snapshot.contextPolicy.traceIsEvidence, false);
assert.equal(snapshot.contextPolicy.memoryIsRecallOnly, true);
assert.equal(snapshot.freshness.projectRootExists, true);
assert.equal(snapshot.freshness.missingBatchFiles.length, 0);
assert.ok(snapshot.health, "includeHealth should attach project health");

const text = formatProjectContextSnapshot(snapshot);
assert.match(text, /Linguist Agent CAT project context/);
assert.match(text, /project_default_language_pair: zh-CN -> en-US/);
assert.match(text, /imported_batches/);
assert.match(text, /project_health:/);
assert.match(text, /freshness:/);
assert.match(text, /showing 1\/1/);
assert.match(text, /project memory is recall context, not citable CAT evidence/);

const previousCwd = process.cwd();
process.chdir(workspaceRoot);
try {
  const tool = buildCatTools(createWorkspace(workspaceRoot, "proj")).find((item) => item.name === "project_context");
  assert.ok(tool, "project_context should be registered");
  const output = await tool.execute("tool-call", { projectId: "proj", includeHealth: true });
  assert.match(output.content[0]?.type === "text" ? output.content[0].text : "", /project_health:/);
  assert.equal((output.details as any).projectId, "proj");
} finally {
  process.chdir(previousCwd);
}

const fullScanRoot = await mkdtemp(join(tmpdir(), "la-context-full-scan-test-"));
const fullScanProject = join(fullScanRoot, "client");
await mkdir(fullScanProject, { recursive: true });
await Promise.all(Array.from({ length: 121 }, (_, index) =>
  writeFile(join(fullScanProject, `zz-asset-${String(index).padStart(3, "0")}.txt`), "asset", "utf8")
));
for (let index = 1; index <= 13; index += 1) {
  await writeFile(join(fullScanProject, `batch-${String(index).padStart(2, "0")}.mxliff`), mxliffFixture, "utf8");
}
await writeFile(join(fullScanProject, "master.xliff"), masterFixture, "utf8");
await createProjectManifest(fullScanRoot, fullScanProject, { projectId: "full-scan", sourceLanguage: "zh-CN", targetLanguage: "en-US" });
for (let index = 1; index <= 13; index += 1) {
  await importPhraseBatch(fullScanRoot, {
    projectId: "full-scan",
    batchId: `b${String(index).padStart(2, "0")}`,
    mxliffPath: `batch-${String(index).padStart(2, "0")}.mxliff`,
    masterXliffPath: "master.xliff",
  });
}
for (let index = 100; index <= 120; index += 1) {
  await unlink(join(fullScanProject, `zz-asset-${String(index).padStart(3, "0")}.txt`));
}
await unlink(join(fullScanProject, "batch-13.mxliff"));
await writeFile(join(fullScanProject, "zz-asset-000.txt"), "asset changed", "utf8");

const fullManifest = await readProjectManifest(fullScanRoot, "full-scan");
fullManifest.assetRoleDecisions = fullManifest.assetRoleDecisions.map((decision, index) => ({
  ...decision,
  status: index < 25 ? "confirmed" : decision.status,
}));
fullManifest.warnings = ["top-level warning", "shared warning"];
fullManifest.scan.warnings = ["shared warning", "scan warning"];
fullManifest.questions = ["shared question"];
fullManifest.scan.questions = ["shared question", "scan question"];
await writeFile(projectManifestPath(fullScanRoot, "full-scan"), `${JSON.stringify(fullManifest, null, 2)}\n`, "utf8");

const fullScan = await buildProjectContextSnapshot(fullScanRoot, "full-scan");
assert.equal(fullScan.coverage.totalBatches, 13);
assert.equal(fullScan.coverage.visibleBatches, 12, "batch details remain a prompt preview");
assert.equal(fullScan.coverage.totalWarnings, 3, "manifest and scan warnings must not be counted twice");
assert.equal(fullScan.coverage.totalQuestions, 2, "manifest and scan questions must not be counted twice");
assert.equal(fullScan.freshness.assetsChecked > fullScan.freshness.assetsAvailable, true, "freshness must distinguish scanned and available assets");
assert.equal(fullScan.freshness.detectedMissingAssets, 22);
assert.equal(fullScan.freshness.assetsAvailable, fullScan.freshness.assetsChecked - fullScan.freshness.detectedMissingAssets);
assert.equal(fullScan.freshness.detectedChangedAssets, 1);
assert.equal(fullScan.freshness.batchesChecked, 13, "freshness must scan beyond the visible batch page");
assert.equal(fullScan.freshness.detectedMissingBatchFiles, 1);
assert.equal(fullScan.freshness.missingBatchFiles[0]?.batchId, "b13");
assert.match(formatProjectContextSnapshot(fullScan), /showing 12\/13; all 13 batch records were scanned/);
assert.match(formatProjectContextSnapshot(fullScan), /missing_asset_paths: showing 20\/22; page with project_context section=missing_assets/);
assert.match(formatProjectContextSnapshot(fullScan), /changed_asset_paths: showing 1\/1; page with project_context section=changed_assets/);
assert.match(formatProjectContextSnapshot(fullScan), /missing_batch_files: showing 1\/1; page with project_context section=missing_batch_files/);

process.chdir(fullScanRoot);
try {
  const pagedTool = buildCatTools(createWorkspace(fullScanRoot, "full-scan")).find((item) => item.name === "project_context");
  assert.ok(pagedTool);
  const batchPage = await pagedTool.execute("batch-page", {
    projectId: "full-scan",
    section: "batches",
    start: 13,
    limit: 1,
  } as any);
  assert.deepEqual((batchPage.details as any).items.map((item: any) => item.batchId), ["b13"]);
  assert.equal((batchPage.details as any).pageComplete, true);
  assert.match(batchPage.content[0]?.type === "text" ? batchPage.content[0].text : "", /Page complete: yes/);

  const missingAssetPage = await pagedTool.execute("missing-assets-page", {
    projectId: "full-scan",
    section: "missing_assets",
    start: 21,
    limit: 2,
  } as any);
  assert.equal((missingAssetPage.details as any).total, 22);
  assert.equal((missingAssetPage.details as any).returned, 2);
  assert.equal((missingAssetPage.details as any).pageComplete, true);
  assert.match(missingAssetPage.content[0]?.type === "text" ? missingAssetPage.content[0].text : "", /zz-asset-120\.txt/);

  const changedAssetPage = await pagedTool.execute("changed-assets-page", {
    projectId: "full-scan",
    section: "changed_assets",
  } as any);
  assert.deepEqual((changedAssetPage.details as any).items, ["zz-asset-000.txt"]);

  const missingBatchPage = await pagedTool.execute("missing-batch-page", {
    projectId: "full-scan",
    section: "missing_batch_files",
  } as any);
  assert.deepEqual((missingBatchPage.details as any).items.map((item: any) => ({ batchId: item.batchId, kind: item.kind })), [{ batchId: "b13", kind: "source" }]);
  assert.match(missingBatchPage.content[0]?.type === "text" ? missingBatchPage.content[0].text : "", /b13 source/);

  const rolePage = await pagedTool.execute("role-page", {
    projectId: "full-scan",
    section: "confirmed_asset_roles",
    start: 1,
    limit: 20,
  } as any);
  assert.equal((rolePage.details as any).total, 25);
  assert.equal((rolePage.details as any).returned, 20);
  assert.equal((rolePage.details as any).nextStart, 21);
  assert.equal((rolePage.details as any).pageComplete, false);
  assert.match(rolePage.content[0]?.type === "text" ? rolePage.content[0].text : "", /Continue with section=confirmed_asset_roles, start=21/);

  const warningPage = await pagedTool.execute("warning-page", {
    projectId: "full-scan",
    section: "warnings",
    start: 2,
    limit: 2,
  } as any);
  assert.deepEqual((warningPage.details as any).items, ["shared warning", "scan warning"]);
  assert.equal((warningPage.details as any).pageComplete, true);
} finally {
  process.chdir(previousCwd);
}

console.log("project_context tests passed");
