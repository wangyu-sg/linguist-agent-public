import assert from "node:assert/strict";
import test from "node:test";
import {
  createProjectFromPicker,
  importBatchesFromPicker,
  shouldDismissBatchImport,
  type ProjectDraft,
} from "../src/renderer/onboarding/actions.ts";
import type { BatchImportResponse, CreateProjectResponse } from "../src/renderer/data/workspace-client.ts";

const handles = {
  project: { id: "la-native-file-00000000-0000-4000-8000-000000000001", name: "project-one" },
  one: { id: "la-native-file-00000000-0000-4000-8000-000000000002", name: "one.xlf" },
  bad: { id: "la-native-file-00000000-0000-4000-8000-000000000003", name: "bad.xlf" },
  two: { id: "la-native-file-00000000-0000-4000-8000-000000000004", name: "two.xlf" },
} as const;

const createdProject: CreateProjectResponse = {
  manifest: {
    projectId: "project-one",
    projectName: "Project One",
    root: "/private/project-one",
    sourceLanguage: "zh-CN",
    targetLanguage: "en-US",
    updatedAt: "2026-07-16T00:00:00.000Z",
  },
  path: "/runtime/projects/project-one/project.json",
};

function importedBatch(batchId: string): BatchImportResponse {
  return {
    path: `/runtime/projects/project-one/batches/${batchId}/batch.json`,
    batch: {
      schemaVersion: 1,
      format: "xliff_1_2",
      projectId: "project-one",
      batchId,
      sourceFile: `${batchId}.xlf`,
      sourceLanguage: "zh-CN",
      targetLanguage: "en-US",
      createdAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:00:00.000Z",
      segments: [],
    },
  };
}

test("new project uses picker then canonical create, refresh, and select", async () => {
  const sequence: string[] = [];
  let requestBody: unknown;
  const result = await createProjectFromPicker(
    { name: " Project One ", sourceLocale: " zh-CN ", targetLocale: " en-US " },
    {
      pickProjectFolder: async () => { sequence.push("picker"); return handles.project; },
      createProject: async (input) => { sequence.push("POST /api/projects"); requestBody = input; return createdProject; },
      refreshProjects: async () => { sequence.push("GET /api/projects"); },
      selectProject: async (projectId) => { sequence.push(`select:${projectId}`); },
    },
  );
  assert.deepEqual(sequence, ["picker", "POST /api/projects", "GET /api/projects", "select:project-one"]);
  assert.deepEqual(requestBody, {
    rootHandle: handles.project,
    projectName: "Project One",
    sourceLanguage: "zh-CN",
    targetLanguage: "en-US",
  });
  assert.deepEqual(result, { status: "created", projectId: "project-one", folder: handles.project });
  assert.equal(sequence.some((entry) => /agent|task|run/i.test(entry)), false);
});

test("new project cancellation and errors preserve the caller draft", async () => {
  let createCalls = 0;
  const cancelled = await createProjectFromPicker(
    { name: "Project", sourceLocale: "zh-CN", targetLocale: "en-US" },
    {
      pickProjectFolder: async () => null,
      createProject: async () => { createCalls += 1; return createdProject; },
      refreshProjects: async () => undefined,
      selectProject: async () => undefined,
    },
  );
  assert.deepEqual(cancelled, { status: "cancelled" });
  assert.equal(createCalls, 0);

  const draft: ProjectDraft = { name: "Keep me", sourceLocale: "zh-CN", targetLocale: "en-US" };
  const before = structuredClone(draft);
  let selectedFolder = "";
  await assert.rejects(() => createProjectFromPicker(draft, {
    pickProjectFolder: async () => handles.project,
    createProject: async () => { throw new Error("create failed"); },
    refreshProjects: async () => assert.fail("refresh must not run after create failure"),
    selectProject: async () => assert.fail("select must not run after create failure"),
    onFolderSelected: (folder) => { selectedFolder = folder.name; },
  }), /create failed/);
  assert.deepEqual(draft, before);
  assert.equal(selectedFolder, "project-one");
});

test("batch import reports each file, then refreshes and opens the last success", async () => {
  const sequence: string[] = [];
  const outcome = await importBatchesFromPicker("project-one", {
    pickImportFiles: async () => {
      sequence.push("picker");
      return [handles.one, handles.bad, handles.two];
    },
    importBatch: async (_projectId, file) => {
      sequence.push(`POST:${file.name}`);
      if (file.name === "bad.xlf") throw new Error("invalid XLIFF");
      return importedBatch(file.name === "one.xlf" ? "one" : "two");
    },
    refreshProjects: async () => { sequence.push("refresh"); },
    openBatch: async (_projectId, batchId) => { sequence.push(`open:${batchId}`); },
  });
  assert.deepEqual(sequence, [
    "picker",
    "POST:one.xlf",
    "POST:bad.xlf",
    "POST:two.xlf",
    "refresh",
    "open:two",
  ]);
  assert.deepEqual(outcome.results.map((result) => [result.file.name, result.status]), [
    ["one.xlf", "imported"],
    ["bad.xlf", "failed"],
    ["two.xlf", "imported"],
  ]);
  assert.equal(outcome.openedBatchId, "two");
  assert.equal(shouldDismissBatchImport(outcome), false, "mixed imports must keep failed rows visible");
  assert.equal(sequence.some((entry) => /agent|task|run/i.test(entry)), false);
});

test("batch import dismisses only after every selected file imported and the selected Batch opened", () => {
  assert.equal(shouldDismissBatchImport({
    results: [
      { file: handles.one, status: "imported", batchId: "one" },
      { file: handles.two, status: "imported", batchId: "two" },
    ],
    openedBatchId: "two",
  }), true);
  assert.equal(shouldDismissBatchImport({
    results: [{ file: handles.one, status: "imported", batchId: "one" }],
    openedBatchId: "one",
    followUpError: "Batch could not be opened.",
  }), false);
  assert.equal(shouldDismissBatchImport({ results: [] }), false);
});

test("batch picker cancellation performs no import or refresh", async () => {
  let calls = 0;
  const outcome = await importBatchesFromPicker("project-one", {
    pickImportFiles: async () => [],
    importBatch: async () => { calls += 1; return importedBatch("never"); },
    refreshProjects: async () => { calls += 1; },
    openBatch: async () => { calls += 1; },
  });
  assert.deepEqual(outcome, { results: [] });
  assert.equal(calls, 0);
});
