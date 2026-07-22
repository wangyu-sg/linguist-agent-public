import assert from "node:assert/strict";
import test from "node:test";
import {
  createProjectFromPicker,
  importBatchesFromPicker,
  shouldDismissBatchImport,
  type ProjectDraft,
} from "../src/renderer/onboarding/actions.ts";
import type { BatchImportResponse, CreateProjectResponse } from "../src/renderer/data/workspace-client.ts";

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
      pickProjectFolder: async () => { sequence.push("picker"); return "/private/project-one"; },
      createProject: async (input) => { sequence.push("POST /api/projects"); requestBody = input; return createdProject; },
      refreshProjects: async () => { sequence.push("GET /api/projects"); },
      selectProject: async (projectId) => { sequence.push(`select:${projectId}`); },
    },
  );
  assert.deepEqual(sequence, ["picker", "POST /api/projects", "GET /api/projects", "select:project-one"]);
  assert.deepEqual(requestBody, {
    rootPath: "/private/project-one",
    projectName: "Project One",
    sourceLanguage: "zh-CN",
    targetLanguage: "en-US",
  });
  assert.deepEqual(result, { status: "created", projectId: "project-one", folderPath: "/private/project-one" });
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
    pickProjectFolder: async () => "/private/keep-me",
    createProject: async () => { throw new Error("create failed"); },
    refreshProjects: async () => assert.fail("refresh must not run after create failure"),
    selectProject: async () => assert.fail("select must not run after create failure"),
    onFolderSelected: (path) => { selectedFolder = path; },
  }), /create failed/);
  assert.deepEqual(draft, before);
  assert.equal(selectedFolder, "/private/keep-me");
});

test("batch import reports each file, then refreshes and opens the last success", async () => {
  const sequence: string[] = [];
  const outcome = await importBatchesFromPicker("project-one", {
    pickImportFiles: async () => {
      sequence.push("picker");
      return ["/files/one.xlf", "/files/bad.xlf", "/files/two.xlf"];
    },
    importBatch: async (_projectId, filePath) => {
      sequence.push(`POST:${filePath}`);
      if (filePath.endsWith("bad.xlf")) throw new Error("invalid XLIFF");
      return importedBatch(filePath.endsWith("one.xlf") ? "one" : "two");
    },
    refreshProjects: async () => { sequence.push("refresh"); },
    openBatch: async (_projectId, batchId) => { sequence.push(`open:${batchId}`); },
  });
  assert.deepEqual(sequence, [
    "picker",
    "POST:/files/one.xlf",
    "POST:/files/bad.xlf",
    "POST:/files/two.xlf",
    "refresh",
    "open:two",
  ]);
  assert.deepEqual(outcome.results.map((result) => [result.filePath, result.status]), [
    ["/files/one.xlf", "imported"],
    ["/files/bad.xlf", "failed"],
    ["/files/two.xlf", "imported"],
  ]);
  assert.equal(outcome.openedBatchId, "two");
  assert.equal(shouldDismissBatchImport(outcome), false, "mixed imports must keep failed rows visible");
  assert.equal(sequence.some((entry) => /agent|task|run/i.test(entry)), false);
});

test("batch import dismisses only after every selected file imported and the selected Batch opened", () => {
  assert.equal(shouldDismissBatchImport({
    results: [
      { filePath: "/files/one.xlf", status: "imported", batchId: "one" },
      { filePath: "/files/two.xlf", status: "imported", batchId: "two" },
    ],
    openedBatchId: "two",
  }), true);
  assert.equal(shouldDismissBatchImport({
    results: [{ filePath: "/files/one.xlf", status: "imported", batchId: "one" }],
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
