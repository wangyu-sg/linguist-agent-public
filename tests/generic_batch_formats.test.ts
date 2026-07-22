import { strict as assert } from "node:assert";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import JSZip from "jszip";
import {
  exportCsvBatch,
  exportGenericXliff,
  exportXlsxBatch,
  importCsvBatch,
  importGenericXliffBatch,
  importXlsxBatch,
  readBatch,
  updateSegmentTarget,
} from "@linguist-agent/cat-data";
import { parseGenericXliff, parseTableCsv } from "@linguist-agent/cat-formats";

const xliff12 = `<?xml version="1.0" encoding="utf-8"?>
<xliff xmlns="urn:oasis:names:tc:xliff:document:1.2" version="1.2">
  <file original="sample.txt" source-language="zh-CN" target-language="en-US">
    <body>
      <trans-unit id="s1"><source>暗影徽记</source><target state="needs-translation"></target></trans-unit>
      <trans-unit id="s2" translate="no"><source>锁定</source><target>Locked</target></trans-unit>
    </body>
  </file>
</xliff>`;

const xliff12Inline = `<?xml version="1.0" encoding="utf-8"?>
<xliff xmlns="urn:oasis:names:tc:xliff:document:1.2" version="1.2">
  <file original="tagged.txt" source-language="zh-CN" target-language="en-US">
    <body>
      <trans-unit id="tagged"><source>点击 <x id="1"/></source><target></target></trans-unit>
    </body>
  </file>
</xliff>`;

const xliff20 = `<?xml version="1.0" encoding="utf-8"?>
<xliff xmlns="urn:oasis:names:tc:xliff:document:2.0" version="2.0" srcLang="zh-CN" trgLang="en-US">
  <file id="f1" original="sample.txt">
    <unit id="u1"><segment id="s1" state="initial"><source>勇者徽记</source><target></target></segment></unit>
    <unit id="u2" translate="no"><segment id="s1"><source>锁定</source><target>Locked</target></segment></unit>
  </file>
</xliff>`;

const csvBatch = `SegmentID,Source,Target,Note
1,暗影徽记,,first
2,勇者徽记,Hero Emblem,second
`;

const csvBatchStringEnus = `SegmentID,Source,String/en-US
1,暗影徽记,
`;

async function writeSimpleXlsx(
  path: string,
  options: { worksheetTarget?: string; relationshipOrder?: "id-first" | "target-first" } = {},
): Promise<void> {
  const worksheetTarget = options.worksheetTarget ?? "worksheets/sheet1.xml";
  const worksheetRelationship = options.relationshipOrder === "target-first"
    ? `<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${worksheetTarget}" Id="rId1"/>`
    : `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${worksheetTarget}"/>`;
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);
  zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${worksheetRelationship}
</Relationships>`);
  zip.file("xl/worksheets/sheet1.xml", `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>SegmentID</t></is></c><c r="B1" t="inlineStr"><is><t>Source</t></is></c><c r="C1" t="inlineStr"><is><t>Target</t></is></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>1</t></is></c><c r="B2" t="inlineStr"><is><t>暗影徽记</t></is></c><c r="C2" t="inlineStr"><is><t></t></is></c></row>
    <row r="3"><c r="A3" t="inlineStr"><is><t>2</t></is></c><c r="B3" t="inlineStr"><is><t>勇者徽记</t></is></c><c r="C3" t="inlineStr"><is><t>Hero Emblem</t></is></c></row>
  </sheetData>
</worksheet>`);
  await writeFile(path, await zip.generateAsync({ type: "nodebuffer" }));
}

const root = await mkdtemp(join(tmpdir(), "la-generic-formats-"));

{
  const parsed = parseGenericXliff(xliff12, { fileName: "plain.xliff" });
  assert.equal(parsed.format, "xliff_1_2");
  assert.equal(parsed.segments.length, 2);
  assert.equal(parsed.segments[0].source, "暗影徽记");
  assert.equal(parsed.segments[1].locked, true);
}

{
  const path = join(root, "plain.xliff");
  await writeFile(path, xliff12, "utf8");
  const { batch } = await importGenericXliffBatch(root, { projectId: "proj", xliffPath: path, batchId: "x12" });
  assert.equal(batch.format, "xliff_1_2");
  assert.equal(batch.segments[0].status, "new");
  await updateSegmentTarget(root, "proj", "x12", {
    segmentId: "s1",
    target: "Shadow Emblem",
    changeType: "user_approved",
    reason: "test",
    confirm: true,
  });
  const exported = await exportGenericXliff(root, { projectId: "proj", batchId: "x12", force: true });
  const out = await readFile(exported.outputPath, "utf8");
  assert.match(out, /<target[^>]*state="translated"[^>]*>Shadow Emblem<\/target>/);
  assert.match(out, /<target>Locked<\/target>/);
}

{
  const path = join(root, "tagged.xliff");
  await writeFile(path, xliff12Inline, "utf8");
  const { batch } = await importGenericXliffBatch(root, { projectId: "proj", xliffPath: path, batchId: "x12-tags" });
  assert.equal(batch.segments[0].source, '点击 <x id="1"/>');
  await updateSegmentTarget(root, "proj", "x12-tags", {
    segmentId: "tagged",
    target: 'Tap <x id="1"/>',
    changeType: "user_approved",
    reason: "test",
    confirm: true,
  });
  const exported = await exportGenericXliff(root, { projectId: "proj", batchId: "x12-tags", force: true });
  const out = await readFile(exported.outputPath, "utf8");
  assert.match(out, /<target[^>]*>Tap <x id="1"\/><\/target>/);
}

{
  const path = join(root, "plain2.xlf");
  await writeFile(path, xliff20, "utf8");
  const { batch } = await importGenericXliffBatch(root, { projectId: "proj", xliffPath: path, batchId: "x20" });
  assert.equal(batch.format, "xliff_2_0");
  assert.equal(batch.segments[0].id, "f1:u1:s1");
  await updateSegmentTarget(root, "proj", "x20", {
    segmentId: "f1:u1:s1",
    target: "Hero Emblem",
    changeType: "user_approved",
    reason: "test",
    confirm: true,
  });
  const exported = await exportGenericXliff(root, { projectId: "proj", batchId: "x20", force: true });
  const out = await readFile(exported.outputPath, "utf8");
  assert.match(out, /<segment[^>]*id="s1"[^>]*state="translated"[^>]*>[\s\S]*<target>Hero Emblem<\/target>/);
}

{
  const parsed = parseTableCsv(csvBatch, { fileName: "paste.csv", srcLang: "zh-CN", tgtLang: "en-US" });
  assert.equal(parsed.format, "csv_paste");
  assert.equal(parsed.segments.length, 2);
  assert.equal(parsed.segments[0].note, "first");
  const path = join(root, "paste.csv");
  await writeFile(path, csvBatch, "utf8");
  const { batch } = await importCsvBatch(root, { projectId: "proj", csvPath: path, batchId: "csv", sourceLanguage: "zh-CN", targetLanguage: "en-US" });
  assert.equal(batch.format, "csv_paste");
  await updateSegmentTarget(root, "proj", "csv", {
    segmentId: "1",
    target: "Shadow Emblem",
    changeType: "user_approved",
    reason: "test",
    confirm: true,
  });
  const exported = await exportCsvBatch(root, { projectId: "proj", batchId: "csv", force: true });
  const out = await readFile(exported.outputPath, "utf8");
  assert.match(out, /"1","暗影徽记","Shadow Emblem","first"/);
}

{
  const parsed = parseTableCsv(csvBatchStringEnus, { fileName: "string-enus.csv", srcLang: "zh-CN", tgtLang: "en-US" });
  assert.equal(parsed.segments[0].target, "");
}

{
  const path = join(root, "paste.xlsx");
  await writeSimpleXlsx(path);
  const { batch } = await importXlsxBatch(root, { projectId: "proj", xlsxPath: path, batchId: "xlsx", sourceLanguage: "zh-CN", targetLanguage: "en-US" });
  assert.equal(batch.format, "xlsx_paste");
  assert.equal(batch.segments[0].source, "暗影徽记");
  await updateSegmentTarget(root, "proj", "xlsx", {
    segmentId: "1",
    target: "Shadow Emblem",
    changeType: "user_approved",
    reason: "test",
    confirm: true,
  });
  const exported = await exportXlsxBatch(root, { projectId: "proj", batchId: "xlsx", force: true });
  const reimported = await importXlsxBatch(root, { projectId: "proj", xlsxPath: exported.outputPath, batchId: "xlsx-out", overwrite: true, sourceLanguage: "zh-CN", targetLanguage: "en-US" });
  assert.equal((await readBatch(root, "proj", reimported.batch.batchId)).segments[0].target, "Shadow Emblem");
}

{
  const path = join(root, "paste-target-first.xlsx");
  await writeSimpleXlsx(path, { worksheetTarget: "/xl/worksheets/sheet1.xml", relationshipOrder: "target-first" });
  const { batch } = await importXlsxBatch(root, { projectId: "proj", xlsxPath: path, batchId: "xlsx-target-first", sourceLanguage: "zh-CN", targetLanguage: "en-US" });
  assert.equal(batch.format, "xlsx_paste");
  assert.equal(batch.segments[0].source, "暗影徽记");
  await updateSegmentTarget(root, "proj", "xlsx-target-first", {
    segmentId: "1",
    target: "Shadow Emblem",
    changeType: "user_approved",
    reason: "test",
    confirm: true,
  });
  const exported = await exportXlsxBatch(root, { projectId: "proj", batchId: "xlsx-target-first", force: true });
  const reimported = await importXlsxBatch(root, { projectId: "proj", xlsxPath: exported.outputPath, batchId: "xlsx-target-first-out", overwrite: true, sourceLanguage: "zh-CN", targetLanguage: "en-US" });
  assert.equal((await readBatch(root, "proj", reimported.batch.batchId)).segments[0].target, "Shadow Emblem");
}

console.log("generic batch format tests passed");
