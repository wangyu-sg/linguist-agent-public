import assert from "node:assert/strict";
import { findCustomerReturnChanges, formatCustomerReturnMarkdown, type CatBatch, type TableBatchRow } from "@linguist-agent/cat-data";

const batch: CatBatch = {
  schemaVersion: 1,
  format: "xlsx_paste",
  projectId: "proj",
  batchId: "b1",
  sourceFile: "/tmp/source.xlsx",
  sourceLanguage: "zh-CN",
  targetLanguage: "en-US",
  createdAt: "2026-06-30T00:00:00.000Z",
  updatedAt: "2026-06-30T00:00:00.000Z",
  tagReport: {
    totalSegments: 3,
    placeholderSegments: 0,
    masterMatchedSegments: 3,
    masterUnmatchedSegments: 0,
    replacedPlaceholders: 0,
    unresolvedPlaceholders: 0,
    unresolvedRuntimePlaceholders: 0,
    unresolvedTagPlaceholders: 0,
    tagCountMismatches: 0,
  },
  duplicateSourceGroups: [],
  segments: [
    {
      index: 1,
      id: "row-1",
      source: "小虎表情秀",
      target: "Little Tiger Emote Show",
      rawSource: "小虎表情秀",
      rawTarget: "Little Tiger Emote Show",
      locked: false,
      status: "draft",
      duplicateKey: "小虎表情秀",
      placeholderCount: 0,
      unresolvedPlaceholderCount: 0,
    },
    {
      index: 2,
      id: "row-2",
      source: "天星引",
      target: "Star Lead",
      rawSource: "天星引",
      rawTarget: "Star Lead",
      locked: false,
      status: "draft",
      duplicateKey: "天星引",
      placeholderCount: 0,
      unresolvedPlaceholderCount: 0,
    },
    {
      index: 3,
      id: "row-3",
      source: "空译文",
      target: "Existing",
      rawSource: "空译文",
      rawTarget: "Existing",
      locked: false,
      status: "draft",
      duplicateKey: "空译文",
      placeholderCount: 0,
      unresolvedPlaceholderCount: 0,
    },
  ],
};

const rows: TableBatchRow[] = [
  { index: 1, id: "row-1", source: "小虎表情秀", target: "Cubby Emote Show", duplicateKey: "小虎表情秀", rowNo: 2 },
  { index: 2, id: "row-2", source: "天星引", target: "Star Lead", duplicateKey: "天星引", rowNo: 3 },
  { index: 3, id: "row-3", source: "空译文", target: "", duplicateKey: "空译文", rowNo: 4 },
  { index: 4, id: "missing", source: "不存在", target: "Missing", duplicateKey: "不存在", rowNo: 5 },
];

const changes = findCustomerReturnChanges(batch, rows, "customer_return:review.xlsx:Sheet1");
assert.equal(changes.length, 1);
assert.equal(changes[0].segmentId, "row-1");
assert.equal(changes[0].previousTarget, "Little Tiger Emote Show");
assert.equal(changes[0].returnedTarget, "Cubby Emote Show");
assert.equal(changes[0].evidenceSource, "customer_return:review.xlsx:Sheet1");

const markdown = formatCustomerReturnMarkdown({
  schemaVersion: 1,
  projectId: "proj",
  batchId: "b1",
  learnedAt: "2026-06-30T00:00:00.000Z",
  sourceFile: "/tmp/review.xlsx",
  changedRows: changes.length,
  reviewedTmUpdated: 1,
  rows: changes,
});
assert.match(markdown, /Customer Return Learn/);
assert.match(markdown, /Cubby Emote Show/);

console.log("customer_returns tests passed");
