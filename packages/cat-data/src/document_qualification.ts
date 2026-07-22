export interface OcrQualificationBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrQualificationFixture {
  id: string;
  language: "en" | "zh";
  quality: "clean" | "low";
  referenceText: string;
  predictedText: string;
  referenceBoxes: OcrQualificationBox[];
  predictedBoxes: OcrQualificationBox[];
  retainedConfidence: boolean;
  retainedOverlay: boolean;
}

export interface OcrQualificationReport {
  passed: boolean;
  cleanFixtureCount: number;
  languages: Array<"en" | "zh">;
  characterErrorRate: number;
  boxRecall: number;
  lowQualityEvidenceRetained: boolean;
  thresholds: { maximumCharacterErrorRate: 0.05; minimumBoxRecall: 0.9 };
  failures: string[];
}

function ocrCharacters(value: string): string[] {
  return Array.from(value.normalize("NFKC").replace(/\s+/gu, ""));
}

function editDistance(left: string[], right: string[]): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const current = [leftIndex + 1];
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      current.push(Math.min(
        current[rightIndex]! + 1,
        previous[rightIndex + 1]! + 1,
        previous[rightIndex]! + (left[leftIndex] === right[rightIndex] ? 0 : 1),
      ));
    }
    previous = current;
  }
  return previous[right.length] ?? left.length;
}

export function characterErrorRate(reference: string, predicted: string): number {
  const expected = ocrCharacters(reference);
  const actual = ocrCharacters(predicted);
  if (!expected.length) return actual.length ? 1 : 0;
  return editDistance(expected, actual) / expected.length;
}

function area(box: OcrQualificationBox): number {
  return Math.max(0, box.width) * Math.max(0, box.height);
}

export function boxIntersectionOverUnion(left: OcrQualificationBox, right: OcrQualificationBox): number {
  const x1 = Math.max(left.x, right.x);
  const y1 = Math.max(left.y, right.y);
  const x2 = Math.min(left.x + left.width, right.x + right.width);
  const y2 = Math.min(left.y + left.height, right.y + right.height);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = area(left) + area(right) - intersection;
  return union > 0 ? intersection / union : 0;
}

export function textBoxRecall(reference: OcrQualificationBox[], predicted: OcrQualificationBox[], minimumIou = 0.5): number {
  if (!reference.length) return 1;
  const remaining = new Set(predicted.map((_, index) => index));
  let matched = 0;
  for (const expected of reference) {
    let bestIndex = -1;
    let bestIou = 0;
    for (const index of remaining) {
      const iou = boxIntersectionOverUnion(expected, predicted[index]!);
      if (iou > bestIou) {
        bestIou = iou;
        bestIndex = index;
      }
    }
    if (bestIndex >= 0 && bestIou >= minimumIou) {
      matched += 1;
      remaining.delete(bestIndex);
    }
  }
  return matched / reference.length;
}

export function evaluateOcrQualification(fixtures: OcrQualificationFixture[]): OcrQualificationReport {
  const clean = fixtures.filter((fixture) => fixture.quality === "clean");
  const low = fixtures.filter((fixture) => fixture.quality === "low");
  const referenceCharacters = clean.reduce((sum, fixture) => sum + ocrCharacters(fixture.referenceText).length, 0);
  const errors = clean.reduce((sum, fixture) => sum + editDistance(ocrCharacters(fixture.referenceText), ocrCharacters(fixture.predictedText)), 0);
  const referenceBoxes = clean.reduce((sum, fixture) => sum + fixture.referenceBoxes.length, 0);
  const matchedBoxes = clean.reduce((sum, fixture) => sum + textBoxRecall(fixture.referenceBoxes, fixture.predictedBoxes) * fixture.referenceBoxes.length, 0);
  const cer = referenceCharacters ? errors / referenceCharacters : 1;
  const recall = referenceBoxes ? matchedBoxes / referenceBoxes : 0;
  const languages = [...new Set(clean.map((fixture) => fixture.language))].sort() as Array<"en" | "zh">;
  const lowQualityEvidenceRetained = low.length > 0 && low.every((fixture) => fixture.retainedConfidence && fixture.retainedOverlay);
  const failures: string[] = [];
  if (!languages.includes("en") || !languages.includes("zh")) failures.push("Clean OCR qualification must include English and Chinese fixtures.");
  if (cer > 0.05) failures.push(`Clean scan CER ${cer.toFixed(4)} exceeds 0.0500.`);
  if (recall < 0.9) failures.push(`Clean scan box recall ${recall.toFixed(4)} is below 0.9000.`);
  if (!lowQualityEvidenceRetained) failures.push("Low-quality fixtures must retain confidence and overlay evidence.");
  return {
    passed: failures.length === 0,
    cleanFixtureCount: clean.length,
    languages,
    characterErrorRate: cer,
    boxRecall: recall,
    lowQualityEvidenceRetained,
    thresholds: { maximumCharacterErrorRate: 0.05, minimumBoxRecall: 0.9 },
    failures,
  };
}

export type OfficeQualificationFormat = "docx" | "xlsx" | "pptx" | "pdf";

export interface OfficeQualificationFixture {
  id: string;
  format: OfficeQualificationFormat;
  sourceUnchanged: boolean;
  outputReopened: boolean;
  referencesPreserved: boolean;
  formulasPreserved: boolean;
}

export interface OfficeQualificationReport {
  passed: boolean;
  fixtureCounts: Record<OfficeQualificationFormat, number>;
  outboundCustomerFileRequests: number;
  failures: string[];
}

export function evaluateOfficeQualification(fixtures: OfficeQualificationFixture[], outboundCustomerFileRequests: number): OfficeQualificationReport {
  const formats: OfficeQualificationFormat[] = ["docx", "xlsx", "pptx", "pdf"];
  const fixtureCounts = Object.fromEntries(formats.map((format) => [format, fixtures.filter((fixture) => fixture.format === format).length])) as Record<OfficeQualificationFormat, number>;
  const failures: string[] = [];
  for (const format of formats) {
    if (fixtureCounts[format] < 20) failures.push(`${format.toUpperCase()} qualification requires at least 20 structure fixtures.`);
  }
  for (const fixture of fixtures) {
    if (!fixture.sourceUnchanged) failures.push(`${fixture.id}: source digest changed.`);
    if (!fixture.outputReopened) failures.push(`${fixture.id}: output did not reopen.`);
    if (!fixture.referencesPreserved) failures.push(`${fixture.id}: references were not preserved.`);
    if (!fixture.formulasPreserved) failures.push(`${fixture.id}: formulas were not preserved.`);
  }
  if (outboundCustomerFileRequests !== 0) failures.push(`Expected zero outbound customer-file requests, observed ${outboundCustomerFileRequests}.`);
  return { passed: failures.length === 0, fixtureCounts, outboundCustomerFileRequests, failures: [...new Set(failures)] };
}
