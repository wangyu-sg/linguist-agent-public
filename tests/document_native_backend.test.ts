import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { NativeTextDocumentBackend } from "@linguist-agent/cat-data";

test("native PDF backend emits page provenance without invoking OCR", async () => {
  const root = await mkdtemp(join(tmpdir(), "la-native-document-"));
  try {
    const path = join(root, "native.pdf");
    await writeFile(path, "native fixture", "utf8");
    const sha256 = createHash("sha256").update("native fixture").digest("hex");
    const backend = new NativeTextDocumentBackend({
      version: "native-test-v1",
      resolveStagedInput: async () => path,
      extractBlocks: async () => [
        { ordinal: 1, blockType: "text", text: "Page 1: native text", page: 1 },
        { ordinal: 2, blockType: "heading", text: "Page 2: heading", page: 2 },
      ],
    });
    const request = {
      source: { sha256, mimeType: "application/pdf" },
      input: { kind: "host-staged-file" as const, id: "staged-1", sourceDigest: sha256 },
    };

    assert.deepEqual(await backend.probe(request), {
      supported: true,
      reason: "Native text extraction is available.",
      pages: [
        { page: 1, nativeTextCharacters: 19, nativeTextCoverage: 1, readingOrder: "uncertain", layoutComplexity: "unknown" },
        { page: 2, nativeTextCharacters: 15, nativeTextCoverage: 1, readingOrder: "uncertain", layoutComplexity: "unknown" },
      ],
    });
    assert.deepEqual(await backend.parse(request), {
      schemaVersion: 1,
      source: { sha256, mimeType: "application/pdf" },
      blocks: [
        {
          id: `${sha256}:page:1:block:1`,
          kind: "paragraph",
          text: "Page 1: native text",
          locator: { kind: "page", page: 1 },
          readingOrder: 1,
          provenance: { sourceDigest: sha256, backend: { id: "native-text", version: "native-test-v1", ocr: false }, userCorrected: false },
        },
        {
          id: `${sha256}:page:2:block:2`,
          kind: "heading",
          text: "Page 2: heading",
          locator: { kind: "page", page: 2 },
          readingOrder: 2,
          provenance: { sourceDigest: sha256, backend: { id: "native-text", version: "native-test-v1", ocr: false }, userCorrected: false },
        },
      ],
    });
    assert.deepEqual(await backend.parse({ ...request, pages: [2] }), {
      schemaVersion: 1,
      source: { sha256, mimeType: "application/pdf" },
      blocks: [{
        id: `${sha256}:page:2:block:2`,
        kind: "heading",
        text: "Page 2: heading",
        locator: { kind: "page", page: 2 },
        readingOrder: 1,
        provenance: { sourceDigest: sha256, backend: { id: "native-text", version: "native-test-v1", ocr: false }, userCorrected: false },
      }],
    });
    await assert.rejects(
      () => backend.parse({
        source: { sha256: "0".repeat(64), mimeType: "application/pdf" },
        input: { kind: "host-staged-file", id: "staged-mismatch", sourceDigest: "0".repeat(64) },
      }),
      /Host-staged document bytes do not match the requested source digest/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("native PPTX backend keeps slide provenance through the built-in Office extractor", async () => {
  const root = await mkdtemp(join(tmpdir(), "la-native-document-"));
  try {
    const path = join(root, "office.pptx");
    const archive = new JSZip();
    archive.file("ppt/slides/slide1.xml", "<p:sld><a:p><a:r><a:t>Office title</a:t></a:r></a:p></p:sld>");
    const bytes = await archive.generateAsync({ type: "nodebuffer" });
    await writeFile(path, bytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const backend = new NativeTextDocumentBackend({
      version: "native-test-v1",
      resolveStagedInput: async () => path,
    });
    const request = {
      source: { sha256, mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
      input: { kind: "host-staged-file" as const, id: "staged-office", sourceDigest: sha256 },
    };

    assert.deepEqual(await backend.parse(request), {
      schemaVersion: 1,
      source: request.source,
      blocks: [{
        id: `${sha256}:slide:1:block:1`,
        kind: "heading",
        text: "Slide 1: Office title",
        locator: { kind: "slide", slide: 1 },
        readingOrder: 1,
        provenance: { sourceDigest: sha256, backend: { id: "native-text", version: "native-test-v1", ocr: false }, userCorrected: false },
      }],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
