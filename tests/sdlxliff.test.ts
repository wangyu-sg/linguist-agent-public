import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportSdlxliff, importSdlxliffBatch, readBatch, runDeliveryCheck, updateSegmentTarget } from "@linguist-agent/cat-data";
import { parseSdlxliff, writeSdlxliffTargets } from "@linguist-agent/cat-formats";

const sdlxliffFixture = `<?xml version="1.0" encoding="utf-8"?>
<xliff xmlns="urn:oasis:names:tc:xliff:document:1.2" xmlns:sdl="http://sdl.com/FileTypes/SdlXliff/1.0" version="1.2">
  <sdl:doc-info>
    <sdl:seg-defs>
      <sdl:seg id="1" conf="Translated"><sdl:value key="modified_on">old</sdl:value></sdl:seg>
      <sdl:seg id="2" conf="ApprovedTranslation" locked="true"><sdl:value key="modified_on">old</sdl:value></sdl:seg>
      <sdl:seg id="3" conf="Translated"><sdl:value key="modified_on">old</sdl:value></sdl:seg>
    </sdl:seg-defs>
  </sdl:doc-info>
  <file original="sample.docx" source-language="zh-CN" target-language="en-US">
    <body>
      <trans-unit id="tu1">
        <source>unused aggregate source</source>
        <seg-source>
          <mrk mtype="seg" mid="1">点击 <ph id="1" equiv-text="{0}">{0}</ph> 开始</mrk>
          <mrk mtype="seg" mid="2">锁定文本</mrk>
          <mrk mtype="seg" mid="3">按 <ph id="3"/> 继续</mrk>
        </seg-source>
        <target>
          <mrk mtype="seg" mid="1">Click <ph id="1" equiv-text="{0}">{0}</ph> start</mrk>
          <mrk mtype="seg" mid="2">Locked Text</mrk>
          <mrk mtype="seg" mid="3">Press <ph id="3"/> continue</mrk>
        </target>
      </trans-unit>
    </body>
  </file>
</xliff>`;

{
  const batch = parseSdlxliff(sdlxliffFixture, { fileName: "sample.sdlxliff" });
  assert.equal(batch.format, "sdlxliff");
  assert.equal(batch.sourceLanguage, "zh-CN");
  assert.equal(batch.targetLanguage, "en-US");
  assert.equal(batch.segments.length, 3);
  assert.equal(batch.segments[0].id, "1");
  assert.equal(batch.segments[0].source, "点击 {0} 开始");
  assert.equal(batch.segments[0].target, "Click {0} start");
  assert.equal(batch.segments[0].confirmationLevel, "Translated");
  assert.equal(batch.segments[1].locked, true);
  assert.equal(batch.segments[2].source, "按 {3} 继续");
  assert.equal(batch.segments[2].target, "Press {3} continue");
}

{
  const duplicateDisplayFixture = `<?xml version="1.0" encoding="utf-8"?>
  <xliff xmlns="urn:oasis:names:tc:xliff:document:1.2" version="1.2">
    <file original="dup.docx" source-language="zh-CN" target-language="en-US">
      <body>
        <trans-unit id="tu-dup">
          <source>点 <ph id="1" equiv-text="{X}">{X}</ph> 再点 <ph id="2" equiv-text="{X}">{X}</ph></source>
          <target>Click <ph id="1" equiv-text="{X}">{X}</ph> then <ph id="2" equiv-text="{X}">{X}</ph></target>
        </trans-unit>
      </body>
    </file>
  </xliff>`;
  const result = writeSdlxliffTargets(
    duplicateDisplayFixture,
    [{ id: "tu-dup", target: "Tap {X} then {X}" }],
  );
  assert.match(
    result.content,
    /Tap <ph id="1" equiv-text="\{X\}">\{X\}<\/ph> then <ph id="2" equiv-text="\{X\}">\{X\}<\/ph>/,
  );
}

{
  const result = writeSdlxliffTargets(
    sdlxliffFixture,
    [
      { id: "1", target: "Tap {0} to begin" },
      { id: "2", target: "Changed locked text" },
      { id: "3", target: "Press {3} to continue" },
    ],
    { confirmationLevel: "ApprovedTranslation" },
  );
  assert.deepEqual(result.updatedIds, ["1", "3"]);
  assert.deepEqual(result.skippedLockedIds, ["2"]);
  assert.match(result.content, /Tap <ph id="1" equiv-text="\{0\}">\{0\}<\/ph> to begin/);
  assert.match(result.content, /Press <ph id="3"\/> to continue/);
  assert.match(result.content, /<sdl:seg id="1" conf="ApprovedTranslation">/);
  assert.match(result.content, /<mrk mtype="seg" mid="2">Locked Text<\/mrk>/);
}

{
  const result = writeSdlxliffTargets(
    sdlxliffFixture,
    [{ id: "1", target: "Click {0} start" }],
    { confirmationLevel: "ApprovedSignOff", forceConfirmation: true },
  );
  assert.deepEqual(result.updatedIds, []);
  assert.deepEqual(result.forcedConfirmationIds, ["1"]);
  assert.match(result.content, /<sdl:seg id="1" conf="ApprovedSignOff">/);
}

{
  const workspaceRoot = await mkdtemp(join(tmpdir(), "la-sdlxliff-test-"));
  const sdlxliffPath = join(workspaceRoot, "sample.sdlxliff");
  await writeFile(sdlxliffPath, sdlxliffFixture, "utf8");
  const { batch } = await importSdlxliffBatch(workspaceRoot, {
    projectId: "proj",
    sdlxliffPath,
    batchId: "sdl",
  });
  assert.equal(batch.segments[1].locked, true);

  const updated = await updateSegmentTarget(workspaceRoot, "proj", "sdl", {
    segmentId: "1",
    target: "Tap {0} to begin",
    confirm: true,
    reason: "test",
    changeType: "user_approved",
  });
  assert.deepEqual(updated.changedSegmentIds, ["1"]);

  const skipped = await updateSegmentTarget(workspaceRoot, "proj", "sdl", {
    segmentId: "2",
    target: "Should not write",
    confirm: true,
    reason: "locked test",
    changeType: "user_approved",
  });
  assert.deepEqual(skipped.changedSegmentIds, []);
  assert.deepEqual(skipped.skippedLockedIds, ["2"]);

  await assert.rejects(
    () =>
      updateSegmentTarget(workspaceRoot, "proj", "sdl", {
        segmentId: "3",
        target: "Press to continue",
        confirm: false,
        reason: "intentional SDLXLIFF tag damage for write-policy regression",
        changeType: "user_approved",
      }),
    /tag signature policy/,
  );
  const corruptedBatch = await readBatch(workspaceRoot, "proj", "sdl");
  corruptedBatch.segments[2].target = "Press to continue";
  await writeFile(join(workspaceRoot, "data/projects/proj/batches/sdl/batch.json"), `${JSON.stringify(corruptedBatch, null, 2)}\n`, "utf8");
  const damagedReport = await runDeliveryCheck(workspaceRoot, "proj", "sdl");
  assert.equal(damagedReport.status, "fail");
  assert.equal(damagedReport.blockers.some((issue) => issue.code === "TAG_SIGNATURE_MISMATCH"), true);

  await updateSegmentTarget(workspaceRoot, "proj", "sdl", {
    segmentId: "3",
    target: "Press {3} to continue",
    confirm: false,
    reason: "restore SDLXLIFF tag signature",
    changeType: "user_approved",
  });

  const exported = await exportSdlxliff(workspaceRoot, { projectId: "proj", batchId: "sdl", role: "P", force: true });
  const content = await readFile(exported.outputPath, "utf8");
  assert.match(content, /Tap <ph id="1" equiv-text="\{0\}">\{0\}<\/ph> to begin/);
  assert.match(content, /Press <ph id="3"\/> to continue/);
  assert.match(content, /<sdl:seg id="1" conf="ApprovedSignOff">/);
  assert.match(content, /<mrk mtype="seg" mid="2">Locked Text<\/mrk>/);

  const exportDir = join(workspaceRoot, "exports-to-directory");
  await mkdir(exportDir, { recursive: true });
  const exportedToDirectory = await exportSdlxliff(workspaceRoot, {
    projectId: "proj",
    batchId: "sdl",
    outputPath: exportDir,
    role: "P",
    force: true,
  });
  assert.equal(exportedToDirectory.outputPath, join(exportDir, "sdl.sdlxliff"));
  assert.match(await readFile(exportedToDirectory.outputPath, "utf8"), /Tap <ph id="1" equiv-text="\{0\}">\{0\}<\/ph> to begin/);
}

console.log("sdlxliff tests passed");
