import assert from "node:assert/strict";
import { mkdtemp, mkdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deleteProjectWorkspace, listProjectsWithDiagnostics } from "@linguist-agent/cat-server/projects_index";
import { appendServerDiagnostics, readServerDiagnostics } from "@linguist-agent/cat-server/server_diagnostics";

const root = await mkdtemp(join(tmpdir(), "la-projects-index-test-"));
const projectsRoot = join(root, "data", "projects");

await mkdir(join(projectsRoot, "bad-manifest"), { recursive: true });
await writeFile(join(projectsRoot, "bad-manifest", "project.json"), "{not json", "utf8");

await mkdir(join(projectsRoot, "good", "batches", "broken-batch"), { recursive: true });
await writeFile(
  join(projectsRoot, "good", "project.json"),
  JSON.stringify(
    {
      schemaVersion: 1,
      projectId: "good",
      projectName: "Good Client Project",
      root: "/customer/good",
      createdAt: "2026-05-29T00:00:00.000Z",
      updatedAt: "2026-05-29T00:00:00.000Z",
      scan: { root: "/customer/good", assets: [], phraseTagPairs: [], importPlan: [], warnings: [], questions: [] },
      assetRoleDecisions: [],
      phraseTagPairs: [],
      importPlan: [],
      warnings: [],
      questions: [],
    },
    null,
    2,
  ),
  "utf8",
);
await writeFile(join(projectsRoot, "good", "batches", "broken-batch", "batch.json"), "{not json", "utf8");

const result = await listProjectsWithDiagnostics(root, () => "2026-05-29T00:00:00.000Z");
assert.equal(result.projects.length, 1);
assert.equal(result.projects[0].projectId, "good");
assert.equal(result.projects[0].name, "Good Client Project");
assert.deepEqual(result.projects[0].batches, []);
assert.equal(result.diagnostics.length, 2);
assert.deepEqual(
  result.diagnostics.map((diagnostic) => diagnostic.code).sort(),
  ["project_batch_unreadable", "project_manifest_unreadable"],
);
assert.ok(result.diagnostics.every((diagnostic) => diagnostic.path?.startsWith(root)));

await appendServerDiagnostics(root, result.diagnostics);
const persisted = await readServerDiagnostics(root);
assert.equal(persisted.length, 2);
assert.equal(persisted[0].ts, "2026-05-29T00:00:00.000Z");

const deleteResult = await deleteProjectWorkspace(root, "good");
assert.equal(deleteResult.deleted, true);
await assert.rejects(stat(join(projectsRoot, "good")), { code: "ENOENT" });

const missingDelete = await deleteProjectWorkspace(root, "missing");
assert.equal(missingDelete.deleted, false);

await assert.rejects(
  deleteProjectWorkspace(root, "../outside"),
  /Refusing to delete project outside data\/projects/,
);

console.log("projects_index tests passed");
