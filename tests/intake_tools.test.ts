import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import {
  buildAssetBlocks,
  createProjectManifest,
  extractDocxBlocksFromDocumentXml,
  extractPptxBlocksFromSlideXml,
  importTmTable,
  importTmxMemory,
  importTbxTermbase,
  importTermbaseTable,
  importWorkbookAssetPlan,
  confirmTypedAssetCandidates,
  lookupTermbase,
  createTmStore,
  pairsFromSdltbIndexes,
  importSdltmMemory,
  parseTmxRows,
  parseSdltmRows,
  parseSdltbConceptsCsv,
  previewWorkbookMapping,
  suggestWorkbookMappingCandidates,
  parseSdltbIndexCsv,
  planWorkbookAssetImport,
  readAssetTypedIndex,
  readAssetVectorIndexSummary,
  readPreferredTermbaseEntries,
  refreshProjectManifest,
  searchAssetBlocks,
  sdltbTableForLang,
  upsertWorkflowAuthorityEvidence,
} from "@linguist-agent/cat-data";
import {
  createAssetBlocksBuildTool,
  createAssetBlockSearchTool,
  createTermbaseImportTableTool,
  createTermbaseImportSdltbTool,
  createTermbaseImportTbxTool,
  createTermbaseConflictAuditTool,
  createTermbaseLookupTool,
  createTmConcordanceTool,
  createTmImportSdltmTool,
  createTmImportTableTool,
  createTmImportTmxTool,
  createTmLookupTool,
  createWorkbookMappingCandidatesTool,
  createWorkbookPreviewTool,
  createProjectOnboardTool,
  createProjectRefreshTool,
} from "@linguist-agent/cat-tools";

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function writeMinimalXlsx(path: string, rows: string[][]): Promise<void> {
  const zip = new JSZip();
  const strings: string[] = [];
  const indexFor = (value: string) => {
    let index = strings.indexOf(value);
    if (index < 0) {
      strings.push(value);
      index = strings.length - 1;
    }
    return index;
  };
  const colName = (index: number) => String.fromCharCode(65 + index);
  const sheetRows = rows
    .map(
      (row, rowIndex) =>
        `<row r="${rowIndex + 1}">${row
          .map((cell, colIndex) => `<c r="${colName(colIndex)}${rowIndex + 1}" t="s"><v>${indexFor(cell)}</v></c>`)
          .join("")}</row>`,
    )
    .join("");
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);
  zip.file("xl/workbook.xml", `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Terms" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`);
  zip.file("xl/worksheets/sheet1.xml", `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`);
  zip.file(
    "xl/sharedStrings.xml",
    `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings
      .map((value) => `<si><t>${xmlEscape(value)}</t></si>`)
      .join("")}</sst>`,
  );
  await writeFile(path, await zip.generateAsync({ type: "nodebuffer" }));
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sdlSegment(value: string): string {
  return `<Segment xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><Elements><Text><Value>${xmlEscape(value)}</Value></Text></Elements></Segment>`;
}

function writeMinimalSdltm(path: string): void {
  execFileSync(
    "sqlite3",
    [path],
    {
      input: `
CREATE TABLE translation_memories(
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  source_language TEXT NOT NULL,
  target_language TEXT NOT NULL,
  tucount INT NOT NULL DEFAULT 0
);
CREATE TABLE translation_units(
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  translation_memory_id INT NOT NULL,
  source_segment TEXT,
  target_segment TEXT
);
INSERT INTO translation_memories(id, source_language, target_language, tucount) VALUES (1, 'zh-CN', 'en-US', 2);
INSERT INTO translation_units(translation_memory_id, source_segment, target_segment) VALUES
  (1, ${sqlString(sdlSegment("合成峡谷"))}, ${sqlString(sdlSegment("Synthetic Gorge"))}),
  (1, ${sqlString(sdlSegment("星港花"))}, ${sqlString(sdlSegment("Starport blossoms"))});
`,
      encoding: "utf8",
    },
  );
}

async function writeMultiSheetXlsx(path: string, sheets: Array<{ name: string; rows: string[][] }>): Promise<void> {
  const zip = new JSZip();
  const strings: string[] = [];
  const indexFor = (value: string) => {
    let index = strings.indexOf(value);
    if (index < 0) {
      strings.push(value);
      index = strings.length - 1;
    }
    return index;
  };
  const colName = (index: number) => {
    let value = "";
    let n = index + 1;
    while (n > 0) {
      const rem = (n - 1) % 26;
      value = String.fromCharCode(65 + rem) + value;
      n = Math.floor((n - 1) / 26);
    }
    return value;
  };
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("\n")}
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
      .map((sheet, index) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
      .join("")}</sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
      .map(
        (_, index) =>
          `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
      )
      .join("")}</Relationships>`,
  );
  for (const [sheetIndex, sheet] of sheets.entries()) {
    const sheetRows = sheet.rows
      .map(
        (row, rowIndex) =>
          `<row r="${rowIndex + 1}">${row
            .map((cell, colIndex) => `<c r="${colName(colIndex)}${rowIndex + 1}" t="s"><v>${indexFor(cell)}</v></c>`)
            .join("")}</row>`,
      )
      .join("");
    zip.file(
      `xl/worksheets/sheet${sheetIndex + 1}.xml`,
      `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`,
    );
  }
  zip.file(
    "xl/sharedStrings.xml",
    `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings
      .map((value) => `<si><t>${xmlEscape(value)}</t></si>`)
      .join("")}</sst>`,
  );
  await writeFile(path, await zip.generateAsync({ type: "nodebuffer" }));
}

async function writeMinimalDocx(path: string): Promise<void> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Combat Notes</w:t></w:r></w:p>
    <w:p><w:r><w:t>Use title case for Gem item names.</w:t></w:r></w:p>
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>术语</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>English</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>勇者徽记</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Hero Emblem</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>`);
  await writeFile(path, await zip.generateAsync({ type: "nodebuffer" }));
}

async function writeMinimalPptx(path: string): Promise<void> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`);
  zip.file("ppt/presentation.xml", `<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`);
  zip.file("ppt/slides/slide1.xml", `<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:txBody><a:p><a:r><a:t>Gem Slide</a:t></a:r></a:p></p:txBody></p:sp>
    <p:graphicFrame><a:graphic><a:graphicData><a:tbl>
      <a:tr><a:tc><a:txBody><a:p><a:r><a:t>暗影徽记</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>Shadow Emblem</a:t></a:r></a:p></a:txBody></a:tc></a:tr>
    </a:tbl></a:graphicData></a:graphic></p:graphicFrame>
  </p:spTree></p:cSld>
</p:sld>`);
  await writeFile(path, await zip.generateAsync({ type: "nodebuffer" }));
}

async function writeMinimalPdf(path: string, text: string): Promise<void> {
  const escaped = text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const chunks = [
    "%PDF-1.4\n",
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
  ];
  const stream = `BT /F1 18 Tf 72 720 Td (${escaped}) Tj ET`;
  chunks.push(`4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`);
  chunks.push("5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n");
  let offset = 0;
  const offsets = chunks.map((chunk) => {
    const current = offset;
    offset += Buffer.byteLength(chunk);
    return current;
  });
  const xrefOffset = offset;
  const xref = [
    "xref\n0 6\n0000000000 65535 f \n",
    ...offsets.map((value) => `${String(value).padStart(10, "0")} 00000 n \n`),
    `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  ].join("");
  await writeFile(path, `${chunks.join("")}${xref}`, "utf8");
}

const workspaceRoot = await mkdtemp(join(tmpdir(), "la-intake-test-"));
const projectRoot = join(workspaceRoot, "customer");
await mkdir(projectRoot, { recursive: true });

const xlsxPath = join(projectRoot, "terms.xlsx");
await writeMinimalXlsx(xlsxPath, [
  ["中文", "English", "Note"],
  ["勇者徽记", "Hero Emblem", "item"],
  ["暗影徽记", "Shadow Emblem", "item"],
]);
await writeMinimalXlsx(join(projectRoot, "source-table.xlsx"), [
  ["Key", "Source", "Context"],
  ["item_001", "坦克宝石", "Shop item"],
  ["item_002", "射手宝石", "Shop item"],
]);

await writeFile(
  join(projectRoot, "terms.tbx"),
  `<?xml version="1.0"?><martif><text><body>
<termEntry id="c1"><langSet xml:lang="zh-CN"><tig><term>法师宝石</term></tig></langSet><langSet xml:lang="en-US"><tig><term>Mage Gem</term></tig></langSet></termEntry>
</body></text></martif>`,
  "utf8",
);
await writeFile(
  join(projectRoot, "memory.tmx"),
  `<?xml version="1.0"?><tmx version="1.4"><body>
<tu><tuv xml:lang="zh-CN"><seg>勇者徽记</seg></tuv><tuv xml:lang="en-US"><seg>Hero Emblem</seg></tuv></tu>
<tu><tuv xml:lang="zh-CN"><seg>暗影徽记</seg></tuv><tuv xml:lang="en-US"><seg>Shadow Emblem</seg></tuv></tu>
</body></tmx>`,
  "utf8",
);
await writeFile(join(projectRoot, "style.md"), "# Style\nUse Gem for 宝石 item names.\n", "utf8");
writeMinimalSdltm(join(projectRoot, "legacy.sdltm"));
const docxPath = join(projectRoot, "reference.docx");
await writeMinimalDocx(docxPath);
const pptxPath = join(projectRoot, "slides.pptx");
await writeMinimalPptx(pptxPath);
const pdfPath = join(projectRoot, "guide.pdf");
await writeMinimalPdf(pdfPath, "PDF says Mage Gem is approved.");
const imagePath = join(projectRoot, "screen.png");
await writeFile(imagePath, Buffer.from([]));
await writeFile(join(projectRoot, "screen.png.ocr.txt"), "Screenshot says Tank Gem appears in the shop.", "utf8");
await assert.rejects(
  () => createProjectManifest(workspaceRoot, projectRoot, { projectId: "missing-locale" }),
  /explicit sourceLanguage/,
);
const createdManifest = await createProjectManifest(workspaceRoot, projectRoot, {
  projectId: "proj",
  projectName: "Customer Launch Sprint",
  sourceLanguage: "zh-CN",
  targetLanguage: "en-US",
  assetRoleOverrides: [{ relPath: "terms.xlsx", role: "termbase", status: "confirmed", reason: "wizard confirmed terminology table" }],
});
assert.equal(createdManifest.manifest.projectName, "Customer Launch Sprint");
assert.equal(createdManifest.manifest.sourceLanguage, "zh-CN");
assert.equal(createdManifest.manifest.targetLanguage, "en-US");
assert.equal(createdManifest.manifest.assetRoleDecisions.find((decision) => decision.relPath === "terms.xlsx")?.role, "termbase");
assert.equal(createdManifest.manifest.assetRoleDecisions.find((decision) => decision.relPath === "terms.xlsx")?.status, "confirmed");
const suggestedActions = createdManifest.manifest.scan.suggestedActions;
assert.equal(suggestedActions.some((action) => action.assetPath === "memory.tmx" && action.tool === "tm_import_tmx"), true);
assert.equal(suggestedActions.some((action) => action.assetPath === "legacy.sdltm" && action.tool === "tm_import_sdltm"), true);
assert.equal(suggestedActions.some((action) => action.assetPath === "terms.tbx" && action.tool === "termbase_import_tbx"), true);
assert.equal(
  suggestedActions.some((action) => action.assetPath === "terms.xlsx" && action.tool === "workbook_preview -> termbase_import_table"),
  true,
);
assert.equal(suggestedActions.some((action) => action.assetPath === "style.md" && action.tool === "asset_blocks_build"), true);
assert.equal(suggestedActions.some((action) => action.assetPath === "guide.pdf" && action.tool === "asset_blocks_build"), true);
assert.equal(suggestedActions.some((action) => action.assetPath === "screen.png" && action.tool === "asset_blocks_build"), true);

const localeManifest = await createProjectManifest(workspaceRoot, projectRoot, {
  projectId: "locale-project",
  sourceLanguage: "ja-JP",
  targetLanguage: "fr-FR",
});
assert.equal(localeManifest.manifest.sourceLanguage, "ja-JP");
assert.equal(localeManifest.manifest.targetLanguage, "fr-FR");
await importTermbaseTable(workspaceRoot, {
  projectId: "locale-project",
  assetPath: "terms.xlsx",
  sheetName: "Terms",
  sourceColumn: "中文",
  targetColumn: "English",
});
await importTmTable(workspaceRoot, {
  projectId: "locale-project",
  assetPath: "terms.xlsx",
  sheetName: "Terms",
  sourceColumn: "中文",
  targetColumn: "English",
});
assert.deepEqual(
  (await lookupTermbase(workspaceRoot, { projectId: "locale-project", term: "勇者徽记" })).map((entry) => `${entry.srcLang}->${entry.tgtLang}`),
  ["ja-JP->fr-FR"],
);
assert.equal(
  (await createTmStore({ root: workspaceRoot, projectId: "locale-project" }).list()).every((entry) => entry.srcLang === "ja-JP" && entry.tgtLang === "fr-FR"),
  true,
);
await writeFile(join(projectRoot, "memory_update.tmx"), `<?xml version="1.0"?><tmx version="1.4"><body></body></tmx>`, "utf8");
const refreshed = await refreshProjectManifest(workspaceRoot, "proj");
assert.deepEqual(refreshed.changes.added, ["memory_update.tmx"]);
assert.equal(refreshed.manifest.projectName, "Customer Launch Sprint");
assert.equal(refreshed.manifest.sourceLanguage, "zh-CN");
assert.equal(refreshed.manifest.targetLanguage, "en-US");
assert.equal(refreshed.manifest.assetRoleDecisions.find((decision) => decision.relPath === "terms.xlsx")?.role, "termbase");
assert.equal(refreshed.manifest.assetRoleDecisions.find((decision) => decision.relPath === "terms.xlsx")?.status, "confirmed");
assert.equal(refreshed.manifest.scan.suggestedActions.some((action) => action.assetPath === "memory_update.tmx" && action.tool === "tm_import_tmx"), true);

{
  const previousCwd = process.cwd();
  process.chdir(workspaceRoot);
  try {
    const onboardTool = createProjectOnboardTool();
    const output = await onboardTool.execute("tool-call", {
      rootPath: projectRoot,
      projectId: "proj-tool",
      sourceLanguage: "zh-CN",
      targetLanguage: "en-US",
      assetRoleOverrides: [{ relPath: "terms.xlsx", role: "termbase", status: "confirmed", reason: "wizard selected termbase" }],
    } as any);
    assert.match(output.content[0].text, /Default languages: zh-CN -> en-US/);
    assert.match(output.content[0].text, /terms\.xlsx: termbase/);
  } finally {
    process.chdir(previousCwd);
  }
}

const preview = await previewWorkbookMapping(workspaceRoot, { projectId: "proj", assetPath: "terms.xlsx" });
assert.equal(preview.engine, "openpyxl_read_only");
assert.equal(preview.sheets[0].sheetName, "Terms");
assert.equal(preview.sheets[0].engine, "openpyxl_read_only");
assert.equal(preview.sheets[0].suggested.sourceColumn, "中文");
assert.equal(preview.sheets[0].suggested.targetColumn, "English");

const largeXlsxPath = join(projectRoot, "large_terms.xlsx");
const largeRows = [
  ["中文", "English", "Note"],
  ...Array.from({ length: 80 }, (_, index) => [`术语${index + 1}`, `Term ${index + 1}`, `note ${index + 1}`]),
];
await writeMinimalXlsx(largeXlsxPath, largeRows);
const largePreview = await previewWorkbookMapping(workspaceRoot, { projectId: "proj", assetPath: "large_terms.xlsx", sampleRows: 3 });
assert.equal(largePreview.engine, "openpyxl_read_only");
assert.equal(largePreview.sheets[0].rowCount, 80);
assert.equal(largePreview.sheets[0].sampleRows.length, 3);
const largeImported = await importTermbaseTable(workspaceRoot, {
  projectId: "proj",
  assetPath: "large_terms.xlsx",
  sheetName: "Terms",
  sourceColumn: "中文",
  targetColumn: "English",
  noteColumn: "Note",
  append: true,
});
assert.equal(largeImported.imported, 80);

const coverageWorkbookPath = join(projectRoot, "coverage-workbook.xlsx");
await writeMultiSheetXlsx(
  coverageWorkbookPath,
  Array.from({ length: 10 }, (_, index) => ({
    name: `Sheet ${index + 1}`,
    rows: [["中文", "English"], [`词${index + 1}`, `Term ${index + 1}`]],
  })),
);
const firstCoveragePage = await previewWorkbookMapping(workspaceRoot, {
  projectId: "proj",
  assetPath: "coverage-workbook.xlsx",
  maxSheets: 3,
});
assert.deepEqual(firstCoveragePage.sheetCoverage, {
  totalSheets: 10,
  scannedSheets: 3,
  visibleSheets: 3,
  offset: 0,
  limit: 3,
  hasMore: true,
  nextOffset: 3,
});
const secondCoveragePage = await previewWorkbookMapping(workspaceRoot, {
  projectId: "proj",
  assetPath: "coverage-workbook.xlsx",
  maxSheets: 3,
  sheetOffset: firstCoveragePage.sheetCoverage.nextOffset,
});
assert.equal(secondCoveragePage.sheets[0]?.sheetName, "Sheet 4");
assert.equal(secondCoveragePage.sheetCoverage.offset, 3);
assert.equal(secondCoveragePage.sheetCoverage.hasMore, true);
await assert.rejects(
  () =>
    importTermbaseTable(workspaceRoot, {
      projectId: "proj",
      assetPath: "large_terms.xlsx",
      sheetName: "Missing",
      sourceColumn: "中文",
      targetColumn: "English",
    }),
  /Sheet not found: Missing/,
);
await assert.rejects(
  () =>
    importTermbaseTable(workspaceRoot, {
      projectId: "proj",
      assetPath: "large_terms.xlsx",
      sheetName: "Terms",
      sourceColumn: "Missing Source",
      targetColumn: "English",
    }),
  /Column mapping failed/,
);

const multiSheetPath = join(projectRoot, "mixed-workbook.xlsx");
await writeMultiSheetXlsx(multiSheetPath, [
  {
    name: "参考信息 Reference",
    rows: [
      ["No.", "filename", "Usage"],
      ["1", "notes.docx", "context only"],
      ["2", "style.xlsx", "reference"],
    ],
  },
  {
    name: "术语变更新增 Term Change Log",
    rows: [
      ["类型\nType", "类别\nCategory", "Update Date", "Updated By", "术语 - 改前原文\nTerm - Old Source", "术语 - 改后原文\nTerm - New Source", "术语 - 改前译文\nTerm - Old Target", "术语 - 改后译文\nTerm - New Target", "更新原因\nUpdate Notes", "Loc Comment", "Dev Comment", "最终确认\nFinal Confirm"],
      ["Change 变更", "character", "2026-05-30", "Reviewer A", "小星灵", "N/A", "Stella", "Little Stella", "official change", "Stella not Stela", "Use nickname form", "Approved 已监修"],
      ["New 新增", "ui wording", "2026-05-31", "Reviewer B", "棋手", "棋手", "Player", "Contestant", "approved terminology", "", "", "Pending 讨论中"],
      ["Deleted 已废弃", "deprecated", "2026-05-31", "Reviewer B", "废弃术语", "", "Old Term", "", "deleted", "", "", "Approved 已监修"],
      ["Change 变更", "ability", "2026-06-01", "Reviewer C", "闪现", "", "Leap", "Flash", "later change without final confirm", "", "", ""],
    ],
  },
  {
    name: "归档术语表 Archived Terms",
    rows: [
      ["Terms - CN\n术语 - 中文", "Terms - EN\n术语 - 英文", "Description&Notes\n描述与备注 - 英语"],
      ["星海战棋", "Starsea Tactics", "game title"],
      ["勇者徽记", "Hero Emblem", "item name"],
    ],
  },
]);
const mappingCandidates = await suggestWorkbookMappingCandidates(workspaceRoot, {
  projectId: "proj",
  assetPath: "mixed-workbook.xlsx",
  purpose: "termbase",
});
const archivedCandidate = mappingCandidates.candidates.find((candidate) => candidate.sheetName === "归档术语表 Archived Terms");
assert.ok(archivedCandidate);
assert.equal(archivedCandidate.sourceColumn, "Terms - CN\n术语 - 中文");
assert.equal(archivedCandidate.targetColumn, "Terms - EN\n术语 - 英文");
assert.equal(mappingCandidates.candidates.some((candidate) => candidate.sheetName === "术语变更新增 Term Change Log"), false);
assert.equal(mappingCandidates.candidates.some((candidate) => candidate.sheetName === "参考信息 Reference"), false);

const assetPlan = await planWorkbookAssetImport(workspaceRoot, {
  projectId: "plan-proj",
  assetPath: multiSheetPath,
});
assert.equal(assetPlan.summary.importableTermRows, 2);
assert.equal(assetPlan.summary.dedupeTermPairs, 2);
assert.equal(assetPlan.summary.referenceBlocks, 2);
assert.equal(assetPlan.summary.needsResolution, 1);
const termChangePlan = assetPlan.sheets.find((sheet) => sheet.sheetName === "术语变更新增 Term Change Log");
assert.equal(termChangePlan?.action, "resolve_term_history");
assert.equal(termChangePlan?.importableTerms, 0);
assert.equal(termChangePlan?.referenceBlocks, 1);
assert.equal(termChangePlan?.diagnostics.some((item) => item.label === "old/new target diffs" && item.value === 3), true);
assert.equal(termChangePlan?.diagnostics.some((item) => item.label === "blank-confirm later changes" && item.value === 1), true);
assert.equal(termChangePlan?.diagnostics.some((item) => item.label === "category: character" && item.value === 1), true);
assert.equal(termChangePlan?.diagnostics.some((item) => item.label === "type: Change 变更" && item.value === 2), true);
assert.equal(termChangePlan?.diagnostics.some((item) => item.label === "status: Approved 已监修" && item.value === 2), true);
assert.equal(termChangePlan?.warnings.some((warning) => warning.includes("Term history resolver required")), true);
assert.equal((assetPlan.summary.typedRows ?? 0) >= 7, true);
assert.equal((assetPlan.summary.candidateRows ?? 0) >= 5, true);
assert.equal(assetPlan.summary.typedBlocks, 1);
const preconfirmedImport = await importWorkbookAssetPlan(workspaceRoot, {
  projectId: "plan-proj-preconfirmed",
  assetPath: multiSheetPath,
  srcLang: "zh-CN",
  tgtLang: "en-US",
  confirmedTypedCandidateIds: assetPlan.typedIndex?.rows
    .filter((row) => row.kind === "term_candidate" || row.kind === "term_history_candidate")
    .map((row) => row.id) ?? [],
});
assert.equal(preconfirmedImport.importedTerms, 2);
assert.equal(preconfirmedImport.importedTermHistoryRows >= 3, true);
const assetPlanImport = await importWorkbookAssetPlan(workspaceRoot, {
  projectId: "plan-proj",
  assetPath: multiSheetPath,
  srcLang: "zh-CN",
  tgtLang: "en-US",
});
assert.equal(assetPlanImport.importedTerms, 0);
assert.equal(assetPlanImport.importedTermHistoryRows, 0);
assert.equal(assetPlanImport.typedRowsWritten, assetPlan.summary.typedRows);
assert.equal(assetPlanImport.candidateRowsWritten, assetPlan.summary.candidateRows);
assert.equal(assetPlanImport.writtenReferenceBlocks, 1);
assert.equal(assetPlanImport.sampleTerms.some((entry) => entry.source === "小星灵" && entry.target === "Little Stella"), false);
let preferredAfterHistory = await readPreferredTermbaseEntries(workspaceRoot, "plan-proj");
assert.equal(preferredAfterHistory.some((entry) => entry.source === "小星灵" && entry.target === "Little Stella"), false);
const typedIndex = await readAssetTypedIndex(workspaceRoot, "plan-proj");
assert.ok(typedIndex);
const confirmedTyped = await confirmTypedAssetCandidates(workspaceRoot, {
  projectId: "plan-proj",
  candidateIds: typedIndex.rows.filter((row) => row.kind === "term_candidate" || row.kind === "term_history_candidate").map((row) => row.id),
  append: true,
  srcLang: "zh-CN",
  tgtLang: "en-US",
});
assert.equal(confirmedTyped.confirmedTermRows, 2);
assert.equal(confirmedTyped.confirmedTermHistoryRows >= 3, true);
const termHistoryPayload = JSON.parse(await readFile(confirmedTyped.termHistoryPath, "utf8"));
assert.equal(termHistoryPayload.rows.length, confirmedTyped.confirmedTermHistoryRows);
assert.equal(termHistoryPayload.decisions.length >= 3, true);
assert.equal(termHistoryPayload.decisions.some((decision: any) => decision.source === "小星灵" && decision.status === "current" && decision.target === "Little Stella"), true);
const stellaDecision = termHistoryPayload.decisions.find((decision: any) => decision.source === "小星灵" && decision.status === "current");
assert.equal(stellaDecision?.evidenceRows[0]?.category, "character");
assert.equal(stellaDecision?.evidenceRows[0]?.updateDate, "2026-05-30");
assert.equal(stellaDecision?.evidenceRows[0]?.updatedBy, "Reviewer A");
assert.equal(stellaDecision?.evidenceRows[0]?.locComment, "Stella not Stela");
assert.equal(stellaDecision?.evidenceRows[0]?.devComment, "Use nickname form");
assert.equal(termHistoryPayload.decisions.some((decision: any) => decision.source === "小星灵" && decision.status === "deprecated" && decision.target === "Stella"), true);
assert.equal(termHistoryPayload.decisions.some((decision: any) => decision.source === "闪现" && decision.status === "unconfirmed_later_row" && decision.target === "Flash"), true);
await upsertWorkflowAuthorityEvidence(workspaceRoot, "plan-proj", {
  id: "phrase-term-history-stella",
  decisionKey: "小星灵",
  source: "小星灵",
  target: "Little Stella",
  tier: "phrase_final_stage",
  label: "Phrase CAT term detail",
  evidenceSource: "phrase_cat",
});
preferredAfterHistory = await readPreferredTermbaseEntries(workspaceRoot, "plan-proj");
assert.equal(preferredAfterHistory.some((entry) => entry.source === "小星灵" && entry.target === "Little Stella"), true);

const importedTable = await importTermbaseTable(workspaceRoot, {
  projectId: "proj",
  assetPath: "terms.xlsx",
  sheetName: "Terms",
  sourceColumn: "中文",
  targetColumn: "English",
  noteColumn: "Note",
});
assert.equal(importedTable.imported, 2);

const importedTbx = await importTbxTermbase(workspaceRoot, { projectId: "proj", assetPath: "terms.tbx", append: true });
assert.equal(importedTbx.imported, 1);

const sdltbSource = parseSdltbIndexCsv('sortterm,origterm,termid,conceptid,topterm\n"x","老夫子",1,369,1\n"x","夫子",2,369,0\n');
const sdltbTarget = parseSdltbIndexCsv('sortterm,origterm,termid,conceptid,topterm\n"x","Fuzi",3,369,1\n');
assert.deepEqual(pairsFromSdltbIndexes(sdltbSource, sdltbTarget), [
  { source: "老夫子", target: "Fuzi", conceptId: 369 },
  { source: "夫子", target: "Fuzi", conceptId: 369 },
]);
assert.equal(sdltbTableForLang(["I_ZH-CN", "I_EN-US"], "en"), "I_EN-US");
const conceptMeta = parseSdltbConceptsCsv(
  'conceptid,text\n369,"<conceptGrp><dG><d type=""Description"">Jixia teacher</d></dG><dG><d type=""Status"">Approved</d></dG></conceptGrp>"\n',
);
assert.equal(conceptMeta.get(369)?.descriptions[0], "Jixia teacher");
assert.equal(conceptMeta.get(369)?.fields.Status[0], "Approved");

const matches = await lookupTermbase(workspaceRoot, { projectId: "proj", term: "勇者徽记" });
assert.equal(matches[0].target, "Hero Emblem");
assert.equal(matches[0].origin, "table");

const termbaseJsonPath = join(workspaceRoot, "data", "projects", "proj", "termbase.json");
const termbaseRows = JSON.parse(await readFile(termbaseJsonPath, "utf8"));
termbaseRows.push(
  { id: "conflict-a-1", source: "冲突甲", target: "Alpha One", srcLang: "zh-CN", tgtLang: "en-US", sourceFile: "fixture", rowNo: 1, origin: "manual" },
  { id: "conflict-a-2", source: "冲突甲", target: "Alpha Two", srcLang: "zh-CN", tgtLang: "en-US", sourceFile: "fixture", rowNo: 2, origin: "manual" },
  { id: "conflict-b-1", source: "冲突乙", target: "Beta One", srcLang: "zh-CN", tgtLang: "en-US", sourceFile: "fixture", rowNo: 3, origin: "manual" },
  { id: "conflict-b-2", source: "冲突乙", target: "Beta Two", srcLang: "zh-CN", tgtLang: "en-US", sourceFile: "fixture", rowNo: 4, origin: "manual" },
);
await writeFile(termbaseJsonPath, `${JSON.stringify(termbaseRows, null, 2)}\n`, "utf8");

const parsedTmx = parseTmxRows(await readFile(join(projectRoot, "memory.tmx"), "utf8"), {
  srcLang: "zh-CN",
  tgtLang: "en-US",
});
assert.equal(parsedTmx.length, 2);
assert.equal(parsedTmx[0].target, "Hero Emblem");
const parsedSdltm = parseSdltmRows(join(projectRoot, "legacy.sdltm"), {
  srcLang: "zh-CN",
  tgtLang: "en-US",
});
assert.equal(parsedSdltm.length, 2);
assert.equal(parsedSdltm[0].source, "合成峡谷");
assert.equal(parsedSdltm[0].target, "Synthetic Gorge");

const tmStore = createTmStore({ root: workspaceRoot, projectId: "proj" });
await tmStore.upsertReviewed({
  source: "保留人工确认",
  target: "Keep Reviewed",
  srcLang: "zh-CN",
  tgtLang: "en-US",
  project: "proj",
});
const importedTmx = await importTmxMemory(workspaceRoot, { projectId: "proj", assetPath: "memory.tmx" });
assert.equal(importedTmx.imported, 2);
const importedSdltm = await importSdltmMemory(workspaceRoot, { projectId: "proj", assetPath: "legacy.sdltm", append: true });
assert.equal(importedSdltm.imported, 2);
const importedTmTable = await importTmTable(workspaceRoot, {
  projectId: "proj",
  assetPath: "terms.xlsx",
  sheetName: "Terms",
  sourceColumn: "中文",
  targetColumn: "English",
  append: false,
});
assert.equal(importedTmTable.replaced, 4);
const tmEntries = await tmStore.list();
assert.equal(tmEntries.some((entry) => entry.source === "保留人工确认" && entry.origin === "reviewed"), true);
assert.equal(tmEntries.some((entry) => entry.source === "勇者徽记" && entry.origin === "client_tm"), true);
const concordance = await tmStore.concordance({ query: "Emblem", field: "target", srcLang: "zh-CN", tgtLang: "en-US" });
assert.equal(concordance.some((match) => match.target === "Hero Emblem" && match.field === "target"), true);

const report = await buildAssetBlocks(workspaceRoot, { projectId: "proj" });
assert.equal(report.assetsProcessed >= 2, true);
const blockHits = await searchAssetBlocks(workspaceRoot, { projectId: "proj", query: "Gem" });
assert.equal(blockHits.some((hit) => hit.assetPath === "style.md"), true);
assert.equal(blockHits.some((hit) => hit.assetPath === "reference.docx" && hit.sourceEngine === "docx_asset"), true);
assert.equal(blockHits.some((hit) => hit.assetPath === "reference.docx" && hit.blockType === "table"), true);
assert.equal(blockHits.some((hit) => hit.assetPath === "slides.pptx" && hit.sourceEngine === "pptx_asset"), true);
assert.equal(blockHits.some((hit) => hit.assetPath === "guide.pdf" && hit.sourceEngine === "pdf_asset"), true);
const xlsxHits = await searchAssetBlocks(workspaceRoot, { projectId: "proj", query: "坦克宝石" });
assert.equal(xlsxHits.some((hit) => hit.assetPath === "source-table.xlsx" && hit.sourceEngine === "xlsx_asset"), true);
const imageHits = await searchAssetBlocks(workspaceRoot, { projectId: "proj", query: "Tank Gem" });
assert.equal(imageHits.some((hit) => hit.assetPath === "screen.png" && hit.sourceEngine === "image_asset"), true);

{
  const blocks = extractDocxBlocksFromDocumentXml(`<?xml version="1.0"?>
  <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
    <w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Asset Title</w:t></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
  </w:body></w:document>`);
  assert.deepEqual(blocks.map((block) => `${block.blockType}:${block.text}`), ["heading:Asset Title", "table:A | B"]);
}

{
  const blocks = extractPptxBlocksFromSlideXml(`<?xml version="1.0"?>
  <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
    <p:cSld><p:spTree>
      <p:sp><p:txBody><a:p><a:r><a:t>Slide Title</a:t></a:r></a:p></p:txBody></p:sp>
      <p:graphicFrame><a:graphic><a:graphicData><a:tbl>
        <a:tr><a:tc><a:txBody><a:p><a:r><a:t>A</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>B</a:t></a:r></a:p></a:txBody></a:tc></a:tr>
      </a:tbl></a:graphicData></a:graphic></p:graphicFrame>
    </p:spTree></p:cSld>
  </p:sld>`, 7);
  assert.deepEqual(blocks.map((block) => `${block.blockType}:${block.text}`), ["table:Slide 7: A | B", "text:Slide 7: Slide Title"]);
}

{
  const previousCwd = process.cwd();
  process.chdir(workspaceRoot);
  try {
    const previewTool = createWorkbookPreviewTool();
    const candidatesTool = createWorkbookMappingCandidatesTool();
    const tableTool = createTermbaseImportTableTool();
    const sdltbTool = createTermbaseImportSdltbTool();
    const tbxTool = createTermbaseImportTbxTool();
    const lookupTool = createTermbaseLookupTool();
    const conflictTool = createTermbaseConflictAuditTool();
    const tmImportTableTool = createTmImportTableTool();
    const tmImportTmxTool = createTmImportTmxTool();
    const tmImportSdltmTool = createTmImportSdltmTool();
    const tmConcordanceTool = createTmConcordanceTool({ root: workspaceRoot, projectId: "proj" });
    const tmLookupTool = createTmLookupTool({ root: workspaceRoot, projectId: "proj" });
    const buildBlocksTool = createAssetBlocksBuildTool();
    const searchBlocksTool = createAssetBlockSearchTool();
    const refreshTool = createProjectRefreshTool();
    const previewResult = await previewTool.execute("tool-call", { projectId: "proj", assetPath: "terms.xlsx" });
    assert.match(previewResult.content[0].text, /Terms/);
    const coveragePreviewTool = await previewTool.execute("tool-call", {
      projectId: "proj",
      assetPath: "coverage-workbook.xlsx",
      maxSheets: 3,
    } as any);
    assert.match(coveragePreviewTool.content[0].text, /3 visible \/ 3 scanned \/ 10 total/);
    assert.match(coveragePreviewTool.content[0].text, /sheetOffset=3/);
    const candidatesResult = await candidatesTool.execute("tool-call", { projectId: "proj", assetPath: "mixed-workbook.xlsx" });
    assert.match(candidatesResult.content[0].text, /归档术语表 Archived Terms/);
    assert.match(candidatesResult.content[0].text, /Terms - CN/);
    const tableResult = await tableTool.execute("tool-call", {
      projectId: "proj",
      assetPath: "terms.xlsx",
      sheetName: "Terms",
      sourceColumn: "中文",
      targetColumn: "English",
      append: true,
    } as any);
    assert.match(tableResult.content[0].text, /Imported/);
    const tbxResult = await tbxTool.execute("tool-call", { projectId: "proj", assetPath: "terms.tbx", append: true });
    assert.match(tbxResult.content[0].text, /Imported/);
    const lookupResult = await lookupTool.execute("tool-call", { projectId: "proj", term: "法师宝石" });
    assert.match(lookupResult.content[0].text, /Mage Gem/);
    const conflictPage = await conflictTool.execute("tool-page", { projectId: "proj", start: 1, limit: 1 });
    assert.equal(conflictPage.details.returned, 1);
    assert.equal(conflictPage.details.nextStart, 2);
    assert.match(conflictPage.content[0].text, /Showing 1\/2 conflict/);
    const tmTmxResult = await tmImportTmxTool.execute("tool-call", { projectId: "proj", assetPath: "memory.tmx", append: true });
    assert.match(tmTmxResult.content[0].text, /Imported/);
    const tmSdltmResult = await tmImportSdltmTool.execute("tool-call", { projectId: "proj", assetPath: "legacy.sdltm", append: true });
    assert.match(tmSdltmResult.content[0].text, /Synthetic Gorge/);
    const tmTableResult = await tmImportTableTool.execute("tool-call", {
      projectId: "proj",
      assetPath: "terms.xlsx",
      sheetName: "Terms",
      sourceColumn: "中文",
      targetColumn: "English",
      append: false,
    } as any);
    assert.match(tmTableResult.content[0].text, /replaced/);
    const tmLookupResult = await tmLookupTool.execute("tool-call", { source: "勇者徽记", threshold: 0.9 });
    assert.match(tmLookupResult.content[0].text, /Hero Emblem/);
    const tmConcordanceResult = await tmConcordanceTool.execute("tool-call", { query: "Emblem", field: "target" });
    assert.match(tmConcordanceResult.content[0].text, /Hero Emblem/);
    await assert.rejects(
      () => sdltbTool.execute("tool-call", { projectId: "proj", assetPath: "terms.tbx" }),
      /SDLTB import expects .sdltb/,
    );
    const blockBuild = await buildBlocksTool.execute("tool-call", { projectId: "proj" });
    assert.match(blockBuild.content[0].text, /Asset blocks built/);
    assert.match(blockBuild.content[0].text, /lexical-only/);
    assert.equal((await readAssetVectorIndexSummary(workspaceRoot, "proj")).state, "absent");
    const blockSearch = await searchBlocksTool.execute("tool-call", { projectId: "proj", query: "Gem" });
    assert.match(blockSearch.content[0].text, /Semantic state: blocked_missing_vector_index \(absent\)/);
    assert.match(blockSearch.content[0].text, /style\.md/);
    const refreshOutput = await refreshTool.execute("tool-call", { projectId: "proj" });
    assert.match(refreshOutput.content[0].text, /Project Refreshed/);
  } finally {
    process.chdir(previousCwd);
  }
}

console.log("intake_tools tests passed");
