import assert from "node:assert/strict";
import test from "node:test";
import {
  characterErrorRate,
  evaluateOcrQualification,
  evaluateOfficeQualification,
  textBoxRecall,
  type OfficeQualificationFixture,
} from "../packages/cat-data/src/document_qualification.ts";

test("OCR qualification enforces CER, unique box recall, bilingual coverage, and low-quality evidence retention", () => {
  assert.equal(characterErrorRate("Hello 世界", "Hello 世界"), 0);
  assert.equal(textBoxRecall(
    [{ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 0, width: 10, height: 10 }],
    [{ x: 0, y: 0, width: 10, height: 10 }],
  ), 0.5, "one prediction cannot satisfy two reference boxes");
  const report = evaluateOcrQualification([
    { id: "en-clean", language: "en", quality: "clean", referenceText: "Localization", predictedText: "Localization", referenceBoxes: [{ x: 0, y: 0, width: 20, height: 10 }], predictedBoxes: [{ x: 0, y: 0, width: 20, height: 10 }], retainedConfidence: true, retainedOverlay: true },
    { id: "zh-clean", language: "zh", quality: "clean", referenceText: "游戏本地化", predictedText: "游戏本地化", referenceBoxes: [{ x: 2, y: 2, width: 30, height: 12 }], predictedBoxes: [{ x: 2, y: 2, width: 30, height: 12 }], retainedConfidence: true, retainedOverlay: true },
    { id: "low", language: "zh", quality: "low", referenceText: "模糊", predictedText: "摸糊", referenceBoxes: [], predictedBoxes: [], retainedConfidence: true, retainedOverlay: true },
  ]);
  assert.equal(report.passed, true);
  assert.equal(report.characterErrorRate, 0);
  assert.equal(report.boxRecall, 1);
});

test("Office qualification cannot pass with fewer than 20 real observations per format or any source/network violation", () => {
  const formats = ["docx", "xlsx", "pptx", "pdf"] as const;
  const fixtures: OfficeQualificationFixture[] = formats.flatMap((format) => Array.from({ length: 20 }, (_, index) => ({
    id: `${format}-${index + 1}`,
    format,
    sourceUnchanged: true,
    outputReopened: true,
    referencesPreserved: true,
    formulasPreserved: true,
  })));
  const passing = evaluateOfficeQualification(fixtures, 0);
  assert.equal(passing.passed, true);
  assert.deepEqual(passing.fixtureCounts, { docx: 20, xlsx: 20, pptx: 20, pdf: 20 });
  assert.equal(evaluateOfficeQualification(fixtures.slice(1), 0).passed, false);
  assert.equal(evaluateOfficeQualification(fixtures, 1).passed, false);
});
