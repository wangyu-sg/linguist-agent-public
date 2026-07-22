import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { grepAssets, importGlossaryTable, lookupGlossary, readAssetText, readWorkbookNativePreview, readWorkbookSheetPage } from "@linguist-agent/cat-data";
import { createProjectManifest } from "@linguist-agent/cat-data";

const execFileAsync = promisify(execFile);
const workbookPythonCandidates = [
  process.env.LA_WORKBOOK_PYTHON,
  process.env.CODEX_PYTHON,
  join(homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "bin", "python3"),
  "python3",
].filter((candidate): candidate is string => Boolean(candidate));

function workbookPython(): string {
  return workbookPythonCandidates.find((candidate) => candidate === "python3" || existsSync(candidate)) ?? "python3";
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
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
  <w:p><w:r><w:t>Docx says use Hero Emblem for 勇者徽记.</w:t></w:r></w:p>
</w:body></w:document>`);
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
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>PPTX says Shadow Emblem is approved.</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`);
  await writeFile(path, await zip.generateAsync({ type: "nodebuffer" }));
}

async function writeMinimalPdf(path: string, text: string): Promise<void> {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream\nendobj\n`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body));
    body += object;
  }
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  await writeFile(path, body, "binary");
}

async function writeStyledXlsx(path: string): Promise<void> {
  await execFileAsync(workbookPython(), ["-c", `
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
wb = Workbook()
ws = wb.active
ws.title = "Terms"
ws["A1"] = "中文"
ws["B1"] = "English"
ws["A1"].font = Font(bold=True, color="FFFFFF")
ws["A1"].fill = PatternFill("solid", fgColor="1F4E79")
ws["B1"].font = Font(bold=True)
ws["B1"].alignment = Alignment(horizontal="center")
for i in range(2, 5002):
    ws.cell(i, 1).value = f"龙术语{i}"
    ws.cell(i, 2).value = f"Dragon Term {i}"
ws.merge_cells("C2:D2")
ws["C2"] = "Merged note"
ws.column_dimensions["A"].width = 18
ws.column_dimensions["B"].width = 24
wb.save(${JSON.stringify(path)})
`], { encoding: "utf8" });
}

const workspaceRoot = await mkdtemp(join(tmpdir(), "la-evidence-test-"));
const projectRoot = join(workspaceRoot, "customer");
await mkdir(projectRoot, { recursive: true });

await writeFile(
  join(projectRoot, "terms.tsv"),
  ["中文\tEnglish\tNote", "勇者徽记\tHero Emblem\titem", "暗影徽记\tShadow Emblem\titem"].join("\n"),
  "utf8",
);
await writeFile(join(projectRoot, "style.md"), "# Style\nUse Title Case for gem item names.\n", "utf8");
await writeMinimalDocx(join(projectRoot, "reference.docx"));
await writeMinimalPptx(join(projectRoot, "slides.pptx"));
await writeMinimalPdf(join(projectRoot, "guide.pdf"), "PDF says Mage Gem is approved.");
await writeStyledXlsx(join(projectRoot, "terms.xlsx"));
await writeFile(join(projectRoot, "screen.png"), "", "utf8");
await writeFile(join(projectRoot, "screen.png.ocr.txt"), "Screenshot says Tank Gem appears in the shop.", "utf8");

await createProjectManifest(workspaceRoot, projectRoot, { projectId: "proj", sourceLanguage: "zh-CN", targetLanguage: "en-US" });

const imported = await importGlossaryTable(workspaceRoot, {
  projectId: "proj",
  assetPath: "terms.tsv",
  sourceColumn: "zh-CN",
  targetColumn: "en-US",
});
assert.equal(imported.imported, 2);
assert.equal(imported.skipped, 0);
assert.equal(imported.sample[0].source, "勇者徽记");
assert.equal(imported.warnings.length, 2);

const matches = await lookupGlossary(workspaceRoot, { projectId: "proj", term: "勇者徽记" });
assert.equal(matches.length, 1);
assert.equal(matches[0].target, "Hero Emblem");
assert.equal(matches[0].matchType, "exact");

const hits = await grepAssets(workspaceRoot, { projectId: "proj", query: "Title Case" });
assert.equal(hits.length, 1);
assert.equal(hits[0].relPath, "style.md");
assert.equal(hits[0].lineNo, 2);

const read = await readAssetText(workspaceRoot, { projectId: "proj", assetPath: "style.md" });
assert.equal(read.truncated, false);
assert.match(read.text, /Title Case/);
const outsideAsset = join(workspaceRoot, "outside-secret.md");
await writeFile(outsideAsset, "must not escape project assets", "utf8");
await assert.rejects(() => readAssetText(workspaceRoot, { projectId: "proj", assetPath: outsideAsset }), /not listed/);
await assert.rejects(() => readAssetText(workspaceRoot, { projectId: "proj", assetPath: "../outside-secret.md" }), /not listed/);

const symlinkProjectRoot = join(workspaceRoot, "symlink-customer");
await mkdir(symlinkProjectRoot, { recursive: true });
await symlink(outsideAsset, join(symlinkProjectRoot, "leak.md"));
const symlinkManifestResult = await createProjectManifest(workspaceRoot, symlinkProjectRoot, { projectId: "symlink-proj", sourceLanguage: "zh-CN", targetLanguage: "en-US" });
symlinkManifestResult.manifest.scan.assets.push({
  path: join(symlinkProjectRoot, "leak.md"),
  relPath: "leak.md",
  name: "leak.md",
  ext: ".md",
  sizeBytes: 0,
  role: "reference",
  confidence: 1,
  reasons: ["Security fixture: manifest-listed symlink."],
});
await writeFile(symlinkManifestResult.path, `${JSON.stringify(symlinkManifestResult.manifest)}\n`, "utf8");
await assert.rejects(() => readAssetText(workspaceRoot, { projectId: "symlink-proj", assetPath: "leak.md" }), /escaped its manifest root/);

const docxHits = await grepAssets(workspaceRoot, { projectId: "proj", query: "Hero Emblem" });
assert.equal(docxHits.some((hit) => hit.relPath === "reference.docx"), true);
const docxRead = await readAssetText(workspaceRoot, { projectId: "proj", assetPath: "reference.docx" });
assert.equal(docxRead.truncated, false);
assert.match(docxRead.text, /Hero Emblem/);

const pptxHits = await grepAssets(workspaceRoot, { projectId: "proj", query: "Shadow Emblem" });
assert.equal(pptxHits.some((hit) => hit.relPath === "slides.pptx"), true);
const pptxRead = await readAssetText(workspaceRoot, { projectId: "proj", assetPath: "slides.pptx" });
assert.equal(pptxRead.truncated, false);
assert.match(pptxRead.text, /Shadow Emblem/);

const pdfHits = await grepAssets(workspaceRoot, { projectId: "proj", query: "Mage Gem" });
assert.equal(pdfHits.some((hit) => hit.relPath === "guide.pdf"), true);
const pdfRead = await readAssetText(workspaceRoot, { projectId: "proj", assetPath: "guide.pdf" });
assert.equal(pdfRead.truncated, false);
assert.match(pdfRead.text, /Mage Gem/);

const imageHits = await grepAssets(workspaceRoot, { projectId: "proj", query: "Tank Gem" });
assert.equal(imageHits.some((hit) => hit.relPath === "screen.png"), true);
const imageRead = await readAssetText(workspaceRoot, { projectId: "proj", assetPath: "screen.png" });
assert.equal(imageRead.truncated, false);
assert.match(imageRead.text, /Tank Gem/);

const workbookPreview = await readWorkbookNativePreview(workspaceRoot, { projectId: "proj", assetPath: "terms.xlsx" });
assert.equal(workbookPreview.sheets[0].sheetName, "Terms");
assert.equal(workbookPreview.sheets[0].rowCount, 5001);
assert.equal(workbookPreview.sheets[0].columnWidths[0], 18);

const workbookPage = await readWorkbookSheetPage(workspaceRoot, { projectId: "proj", assetPath: "terms.xlsx", sheetName: "Terms", offset: 200, limit: 25 });
assert.equal(workbookPage.rows.length, 25);
assert.equal(workbookPage.rows[0].rowNo, 201);
assert.match(workbookPage.rows[0].cells[1].displayValue, /Dragon Term 201/);
const headerPage = await readWorkbookSheetPage(workspaceRoot, { projectId: "proj", assetPath: "terms.xlsx", sheetName: "Terms", offset: 0, limit: 2 });
assert.equal(headerPage.rows[0].cells[0].style?.bold, true);
assert.equal(headerPage.rows[0].cells[0].style?.fillColor, "#1F4E79");
assert.equal(headerPage.mergedRanges.includes("C2:D2"), true);

console.log("evidence_tools tests passed");
