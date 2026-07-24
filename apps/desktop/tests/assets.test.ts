import assert from "node:assert/strict";
import test from "node:test";
import {
  ingestProjectAssets,
} from "../src/renderer/assets/actions.ts";
import type {
  AssetParseResult,
  ProjectAssetsCatalog,
} from "../src/renderer/data/workspace-client.ts";

const catalog: ProjectAssetsCatalog = {
  projectId: "project-one",
  sourceLanguage: "zh-CN",
  targetLanguage: "en-US",
  assets: [
    {
      relPath: "refs/terms.xlsx",
      role: "glossary",
      selectedRole: "glossary",
      roleStatus: "inferred",
      confidence: 0.82,
      sizeBytes: 1024,
      kind: "workbook",
      reasons: ["filename suggests terminology table"],
      roleReasons: ["filename suggests terminology table"],
    },
    {
      relPath: "refs/guide.pdf",
      role: "reference",
      selectedRole: "reference",
      roleStatus: "inferred",
      confidence: 0.72,
      sizeBytes: 2048,
      kind: "document",
      reasons: ["readable project reference"],
      roleReasons: ["readable project reference"],
    },
  ],
};

const parsed: AssetParseResult = {
  projectId: "project-one",
  assetPath: "/project/refs/terms.xlsx",
  mode: "structured",
  generatedAt: "2026-07-16T02:00:00.000Z",
  structuredPreview: {
    projectId: "project-one",
    assetPath: "/project/refs/terms.xlsx",
    mode: "structured",
    parser: "structured",
    status: "ready",
    generatedAt: "2026-07-16T02:00:00.000Z",
    structuredSheets: [],
    warnings: [],
  },
  warnings: [],
};

const context = {
  projectId: "project-one",
};

const handles = {
  terms: { id: "la-native-file-00000000-0000-4000-8000-000000000011", name: "terms.xlsx" },
  guide: { id: "la-native-file-00000000-0000-4000-8000-000000000012", name: "guide.pdf" },
  outside: { id: "la-native-file-00000000-0000-4000-8000-000000000013", name: "private.tmx" },
} as const;

test("asset picker cancellation performs no scan, parse, or model work", async () => {
  const calls: string[] = [];
  const outcome = await ingestProjectAssets(context, {
    pickImportFiles: async () => [],
    refreshProjectAssets: async () => { calls.push("refresh"); return { files: [] }; },
    listAssets: async () => { calls.push("list"); return catalog; },
    parseAsset: async () => { calls.push("parse"); return parsed; },
    readAsset: async () => { calls.push("read"); return { relPath: "", text: "", truncated: false }; },
  });
  assert.deepEqual(outcome, { files: [] });
  assert.deepEqual(calls, []);
});

test("registers in-root files once, then reports each deterministic parse result", async () => {
  const calls: string[] = [];
  const snapshots: string[][] = [];
  const outcome = await ingestProjectAssets(context, {
    pickImportFiles: async () => [handles.terms, handles.guide],
    refreshProjectAssets: async (input) => {
      calls.push(`refresh:${input.projectId}`);
      return { files: [
        { ...handles.terms, relPath: "refs/terms.xlsx" },
        { ...handles.guide, relPath: "refs/guide.pdf" },
      ] };
    },
    listAssets: async () => { calls.push("list-assets"); return catalog; },
    parseAsset: async (_projectId, assetPath) => { calls.push(`parse:${assetPath}`); return parsed; },
    readAsset: async (_projectId, assetPath) => {
      calls.push(`read:${assetPath}`);
      return { relPath: "refs/guide.pdf", text: "Style guide", truncated: false };
    },
    onChange: (files) => snapshots.push(files.map((file) => file.status)),
  });

  assert.deepEqual(calls, [
    "refresh:project-one",
    "list-assets",
    "parse:refs/terms.xlsx",
    "read:refs/guide.pdf",
  ]);
  assert.deepEqual(outcome.files.map((file) => file.status), ["ready", "ready"]);
  assert.equal(snapshots.some((statuses) => statuses.includes("parsing")), true);
  assert.equal(calls.some((call) => /agent|task|chat|model/i.test(call)), false);
});

test("keeps a registered file visible when parsing fails", async () => {
  const outcome = await ingestProjectAssets(context, {
    pickImportFiles: async () => [handles.terms],
    refreshProjectAssets: async () => ({ files: [{ ...handles.terms, relPath: "refs/terms.xlsx" }] }),
    listAssets: async () => catalog,
    parseAsset: async () => ({
      ...parsed,
      structuredPreview: { ...parsed.structuredPreview!, status: "error", error: "bad workbook" },
    }),
    readAsset: async () => ({ relPath: "", text: "", truncated: false }),
  });
  assert.equal(outcome.files[0]?.status, "registered");
  assert.equal(outcome.files[0]?.asset?.relPath, "refs/terms.xlsx");
  assert.match(outcome.files[0]?.error ?? "", /bad workbook/);
});

test("a rejected canonical native selection never scans or parses an outside Project file", async () => {
  const calls: string[] = [];
  const outcome = await ingestProjectAssets(context, {
    pickImportFiles: async () => [handles.outside],
    refreshProjectAssets: async () => { calls.push("refresh"); throw new Error("Selected native file is not inside the canonical Project root."); },
    listAssets: async () => { calls.push("list"); return catalog; },
    parseAsset: async () => { calls.push("parse"); return parsed; },
    readAsset: async () => { calls.push("read"); return { relPath: "", text: "", truncated: false }; },
  });
  assert.deepEqual(calls, ["refresh"]);
  assert.equal(outcome.files[0]?.status, "failed");
  assert.match(outcome.files[0]?.error ?? "", /canonical Project root/);
});
