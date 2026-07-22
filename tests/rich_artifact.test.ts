import assert from "node:assert/strict";
import test from "node:test";

import {
  createMineruRichArtifact,
  parseRichArtifactDocument,
  renderRichArtifactHtml,
  richArtifactDocumentFromContent,
  type RichArtifactDocumentV1,
} from "../packages/cat-data/src/rich_artifact.ts";

const fixture: RichArtifactDocumentV1 = {
  schemaVersion: 1,
  title: "Document review",
  createdAt: "2026-07-20T00:00:00.000Z",
  generator: "Linguist Agent document capability",
  blocks: [{
    id: "summary",
    type: "markdown",
    markdown: "# Review\n\nSource remained unchanged.",
  }, {
    id: "facts",
    type: "table",
    caption: "Validation",
    columns: [{ key: "check", label: "Check" }, { key: "passed", label: "Passed", align: "center" }],
    rows: [{ check: "Reopen", passed: true }],
  }, {
    id: "scores",
    type: "chart",
    kind: "bar",
    caption: "Coverage",
    series: [{ label: "Evidence", points: [{ label: "Pages", value: 12 }] }],
  }, {
    id: "preview",
    type: "image",
    file: { path: "/tmp/preview.png", label: "Preview", role: "reference", mimeType: "image/png" },
    alt: "Rendered page preview",
    width: 1200,
    height: 900,
  }, {
    id: "overlay",
    type: "page_overlay",
    page: 1,
    width: 100,
    height: 80,
    regions: [{ polygon: [[0, 0], [10, 0], [10, 8], [0, 8]], label: "Text", confidence: 0.9 }],
  }, {
    id: "change",
    type: "diff",
    label: "Text replacement",
    before: "Old",
    after: "New",
  }, {
    id: "output",
    type: "file_reference",
    file: { path: "/tmp/output.docx", label: "Output copy", role: "output", sha256: "a".repeat(64) },
  }],
};

test("RichArtifactDocumentV1 accepts only the seven declarative block families", () => {
  const parsed = parseRichArtifactDocument(fixture);
  assert.deepEqual(parsed.blocks.map((block) => block.type), [
    "markdown",
    "table",
    "chart",
    "image",
    "page_overlay",
    "diff",
    "file_reference",
  ]);
  assert.deepEqual(richArtifactDocumentFromContent({ document: fixture }), parsed);
  assert.equal(richArtifactDocumentFromContent({ legacy: true }), null);
});

test("RichArtifactDocumentV1 rejects executable markup, remote files, invalid geometry, and duplicate ids", () => {
  assert.throws(() => parseRichArtifactDocument({
    ...fixture,
    blocks: [{ id: "unsafe", type: "markdown", markdown: "<script>alert(1)</script>" }],
  }), /cannot contain executable/);
  assert.throws(() => parseRichArtifactDocument({
    ...fixture,
    blocks: [{ id: "remote", type: "file_reference", file: { path: "https://example.com/a", label: "Remote", role: "reference" } }],
  }), /local path/);
  assert.throws(() => parseRichArtifactDocument({
    ...fixture,
    blocks: [{ id: "overlay", type: "page_overlay", page: 1, width: 10, height: 10, regions: [{ polygon: [[20, 1], [2, 2]] }] }],
  }), /at most 10/);
  assert.throws(() => parseRichArtifactDocument({
    ...fixture,
    blocks: [fixture.blocks[0], fixture.blocks[0]],
  }), /ids must be unique/);
});

test("HTML export is script-free, network-free, and escapes document content", () => {
  const html = renderRichArtifactHtml({
    ...fixture,
    title: "Review & proof",
    blocks: [{ id: "summary", type: "markdown", markdown: "Literal <b> is text & stays local." }],
  });
  assert.match(html, /name="la-rich-artifact" content="v1"/);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /Review &amp; proof/);
  assert.match(html, /Literal &lt;b&gt; is text &amp; stays local/);
  assert.doesNotMatch(html, /<script|<iframe|https?:\/\//i);
});

test("MinerU results project a bounded locked-file table instead of executable output", () => {
  const document = createMineruRichArtifact({
    sourcePath: "/tmp/source.pdf",
    sourceSha256: "b".repeat(64),
    outputDirectory: "/tmp/mineru-output",
    files: [{ path: "source/pages/1.md", sha256: "c".repeat(64), sizeBytes: 42 }],
  }, { createdAt: "2026-07-20T00:00:00.000Z" });
  assert.deepEqual(document.blocks.map((block) => block.type), ["markdown", "table", "file_reference", "file_reference"]);
  assert.equal(document.blocks[1]?.type === "table" ? document.blocks[1].rows[0]?.path : null, "source/pages/1.md");
});
