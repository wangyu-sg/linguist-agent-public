import assert from "node:assert/strict";
import test from "node:test";
import {
  ingestProjectAssets,
  projectRelativeAssetPath,
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
  projectName: "Project One",
  rootPath: "/project",
  sourceLanguage: "zh-CN",
  targetLanguage: "en-US",
};

test("project-relative asset paths cannot escape the canonical root", () => {
  assert.equal(projectRelativeAssetPath("/project/", "/project/refs/terms.xlsx"), "refs/terms.xlsx");
  assert.equal(projectRelativeAssetPath("/project", "/project-other/terms.xlsx"), null);
  assert.equal(projectRelativeAssetPath("/project", "/outside/terms.xlsx"), null);
});

test("asset picker cancellation performs no scan, parse, or model work", async () => {
  const calls: string[] = [];
  const outcome = await ingestProjectAssets(context, {
    pickImportFiles: async () => [],
    refreshProject: async () => { calls.push("refresh"); },
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
    pickImportFiles: async () => [
      "/project/refs/terms.xlsx",
      "/outside/private.tmx",
      "/project/refs/guide.pdf",
    ],
    refreshProject: async (input) => { calls.push(`refresh:${input.projectId}`); },
    listAssets: async () => { calls.push("list-assets"); return catalog; },
    parseAsset: async (_projectId, path) => { calls.push(`parse:${path}`); return parsed; },
    readAsset: async (_projectId, path) => {
      calls.push(`read:${path}`);
      return { relPath: "refs/guide.pdf", text: "Style guide", truncated: false };
    },
    onChange: (files) => snapshots.push(files.map((file) => file.status)),
  });

  assert.deepEqual(calls, [
    "refresh:project-one",
    "list-assets",
    "parse:/project/refs/terms.xlsx",
    "read:/project/refs/guide.pdf",
  ]);
  assert.deepEqual(outcome.files.map((file) => file.status), ["ready", "failed", "ready"]);
  assert.match(outcome.files[1]?.error ?? "", /不会复制客户文件/);
  assert.equal(snapshots.some((statuses) => statuses.includes("parsing")), true);
  assert.equal(calls.some((call) => /agent|task|chat|model/i.test(call)), false);
});

test("keeps a registered file visible when parsing fails", async () => {
  const outcome = await ingestProjectAssets(context, {
    pickImportFiles: async () => ["/project/refs/terms.xlsx"],
    refreshProject: async () => undefined,
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
