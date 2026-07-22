import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportMqxliff, importMqxliffBatch, readBatch, runDeliveryCheck, updateSegmentTarget } from "@linguist-agent/cat-data";
import { parseMqxliff, writeMqxliffDefects, writeMqxliffTargets } from "@linguist-agent/cat-formats";

const fixturePath = new URL("./fixtures/memoq/sample.mqxliff", import.meta.url).pathname;

{
  const fixture = await readFile(fixturePath, "utf8");
  const batch = parseMqxliff(fixture, { fileName: "sample.mqxliff" });
  assert.equal(batch.format, "mqxliff");
  assert.equal(batch.sourceLanguage, "zh-CN");
  assert.equal(batch.targetLanguage.toLowerCase(), "en-us");
  assert.equal(batch.segments.length, 4);
  assert.equal(batch.segments[0].id, "1");
  assert.equal(batch.segments[0].source, "合成菜单标题");
  assert.equal(batch.segments[0].target, "Synthetic Menu Title");
  assert.equal(batch.segments[0].status, "PartiallyEdited");
  assert.equal(batch.segments[0].note, "Synthetic fixture note; no customer content.");
}

{
  const fixture = await readFile(fixturePath, "utf8");
  const batch = parseMqxliff(fixture, { fileName: "sample.mqxliff" });
  const tagged = batch.segments.find((segment) => segment.id === "4");
  assert.ok(tagged);
  assert.doesNotMatch(tagged.source, /<bpt|<ept|<ph\b/);
  assert.match(tagged.source, /<color=#5a9142>/);
  assert.match(tagged.source, /<\/color>/);
  assert.match(tagged.source, /\{0\}/);
  assert.match(tagged.source, /\\n/);
  assert.match(tagged.target, /<color=#5a9142>/);
  assert.equal(tagged.sourceTags.length > 0, true);
}

{
  const fixture = await readFile(fixturePath, "utf8");
  const batch = parseMqxliff(fixture, { fileName: "sample.mqxliff" });
  const placeholder = batch.segments.find((segment) => segment.id === "3");
  assert.ok(placeholder);
  assert.equal(placeholder.source, "获得第{0}枚徽章！");
  assert.equal(placeholder.target, "Earn badge #{0}!");
}

{
  const fixture = await readFile(fixturePath, "utf8");
  const original = parseMqxliff(fixture, { fileName: "sample.mqxliff" });
  const tagged = original.segments.find((segment) => segment.id === "4");
  assert.ok(tagged);
  const result = writeMqxliffTargets(fixture, [
    { id: "1", target: "ROUND-TRIP Synthetic Menu Title" },
    { id: "4", target: tagged.target },
  ]);
  assert.deepEqual(result.updatedIds, ["1"]);
  const reParsed = parseMqxliff(result.content, { fileName: "out.mqxliff" });
  assert.equal(reParsed.segments.find((segment) => segment.id === "1")?.target, "ROUND-TRIP Synthetic Menu Title");
  assert.equal(reParsed.segments.find((segment) => segment.id === "4")?.target, tagged.target);
  const unit4 = /<trans-unit id="4"[\s\S]*?<\/trans-unit>/.exec(result.content)?.[0] ?? "";
  assert.match(unit4, /<target\b[\s\S]*<bpt\b/);
  assert.match(unit4, /<target\b[\s\S]*<ept\b/);
  assert.match(unit4, /<target\b[\s\S]*<ph\b/);
}

{
  const fixture = await readFile(fixturePath, "utf8");
  const lockedFixture = fixture.replace('<trans-unit id="1"', '<trans-unit id="1" translate="no" mq:locked="locked"');
  const result = writeMqxliffTargets(lockedFixture, [
    { id: "1", target: "BAD" },
    { id: "2", target: "Editable MQXLIFF target" },
  ]);
  assert.deepEqual(result.updatedIds, ["2"]);
  assert.deepEqual(result.skippedLockedIds, ["1"]);
  const reParsed = parseMqxliff(result.content, { fileName: "locked.mqxliff" });
  assert.equal(reParsed.segments.find((segment) => segment.id === "1")?.target, "Synthetic Menu Title");
  assert.equal(reParsed.segments.find((segment) => segment.id === "2")?.target, "Editable MQXLIFF target");
}

{
  const fixture = await readFile(fixturePath, "utf8");
  const result = writeMqxliffTargets(fixture, [{ id: "1", target: "x" }]);
  assert.doesNotMatch(result.content, /xml:space="preserve"\s+xml:space/);
  assert.doesNotMatch(result.content, /ns0:/);
}

{
  const fixture = await readFile(fixturePath, "utf8");
  const original = parseMqxliff(fixture, { fileName: "sample.mqxliff" });
  const tagged = original.segments.find((segment) => segment.id === "4");
  assert.ok(tagged);
  const targetWithDroppedTag = tagged.target.replace("<color=#5a9142>", "");
  const result = writeMqxliffTargets(fixture, [{ id: "4", target: targetWithDroppedTag }]);
  const reParsed = parseMqxliff(result.content, { fileName: "dropped-tag.mqxliff" });
  assert.equal(reParsed.segments.find((segment) => segment.id === "4")?.target, targetWithDroppedTag);
}

{
  const fixture = await readFile(fixturePath, "utf8");
  const result = writeMqxliffDefects(fixture, [
    {
      id: "1",
      suggested: "Edited Synthetic Menu Title",
      severity: "major",
      issueType: "accuracy",
      disposition: "defect",
      comment: "Use the synthetic approved label.",
    },
    {
      id: "2",
      severity: "minor",
      issueType: "query",
      disposition: "needs_review",
      comment: "Please confirm the synthetic instruction wording.",
    },
  ]);
  assert.deepEqual(result.updatedIds, ["1"]);
  assert.deepEqual(result.commentedIds, ["1", "2"]);
  assert.match(result.content, /mq:status="Edited"/);
  assert.match(result.content, /origin="ai_review"/);
  assert.match(result.content, /\[major accuracy \/ defect\] Use the synthetic approved label\. \| suggested=Edited Synthetic Menu Title/);
  assert.match(result.content, /\[minor query \/ needs_review\] Please confirm the synthetic instruction wording\./);
  const reParsed = parseMqxliff(result.content, { fileName: "defects.mqxliff" });
  assert.equal(reParsed.segments.find((segment) => segment.id === "1")?.target, "Edited Synthetic Menu Title");
  assert.equal(reParsed.segments.find((segment) => segment.id === "2")?.target, "Synthetic Quest Instruction");
}

{
  const workspaceRoot = await mkdtemp(join(tmpdir(), "la-mqxliff-test-"));
  const mqxliffPath = join(workspaceRoot, "sample.mqxliff");
  await cp(fixturePath, mqxliffPath);
  const { batch } = await importMqxliffBatch(workspaceRoot, {
    projectId: "proj",
    mqxliffPath,
    batchId: "mq",
  });
  assert.equal(batch.format, "mqxliff");
  assert.equal(batch.segments.length, 4);
  assert.equal(batch.segments[0].contextNote, "Synthetic fixture note; no customer content.");
  assert.equal(batch.segments[0].status, "draft");
  assert.equal(batch.segments[0].confirmationLevel, "PartiallyEdited");

  const updated = await updateSegmentTarget(workspaceRoot, "proj", "mq", {
    segmentId: "1",
    target: "ROUND-TRIP Synthetic Menu Title",
    confirm: true,
    reason: "test",
    changeType: "user_approved",
  });
  assert.deepEqual(updated.changedSegmentIds, ["1"]);

  await assert.rejects(
    () =>
      updateSegmentTarget(workspaceRoot, "proj", "mq", {
        segmentId: "3",
        target: "Drop all source tags",
        confirm: false,
        reason: "intentional MQXLIFF tag damage for write-policy regression",
        changeType: "user_approved",
      }),
    /tag signature policy/,
  );

  const corruptedBatch = await readBatch(workspaceRoot, "proj", "mq");
  const corrupted = corruptedBatch.segments.find((segment) => segment.id === "3");
  assert.ok(corrupted);
  corrupted.target = "Drop all source tags";
  await writeFile(join(workspaceRoot, "data/projects/proj/batches/mq/batch.json"), `${JSON.stringify(corruptedBatch, null, 2)}\n`, "utf8");
  const damagedReport = await runDeliveryCheck(workspaceRoot, "proj", "mq");
  assert.equal(damagedReport.status, "fail");
  assert.equal(damagedReport.blockers.some((issue) => issue.code === "TAG_SIGNATURE_MISMATCH"), true);

  const original = parseMqxliff(await readFile(fixturePath, "utf8"), { fileName: "sample.mqxliff" });
  const placeholder = original.segments.find((segment) => segment.id === "3");
  assert.ok(placeholder);
  await updateSegmentTarget(workspaceRoot, "proj", "mq", {
    segmentId: "3",
    target: placeholder.target,
    confirm: false,
    reason: "restore MQXLIFF tag signature",
    changeType: "user_approved",
  });

  const exported = await exportMqxliff(workspaceRoot, { projectId: "proj", batchId: "mq", force: true });
  const output = await readFile(exported.outputPath, "utf8");
  const parsedOut = parseMqxliff(output, { fileName: "exported.mqxliff" });
  assert.equal(parsedOut.segments.find((segment) => segment.id === "1")?.target, "ROUND-TRIP Synthetic Menu Title");
  assert.match(output, /mq:status="ConfirmedTranslator"/);
}

console.log("mqxliff tests passed");
