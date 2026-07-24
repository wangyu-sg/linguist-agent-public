import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  architectureImportExceptions,
  validateArchitectureImportGraph,
} from "../scripts/architecture-import-guard.js";

const root = path.resolve(import.meta.dirname, "..");
const queue = readFileSync(path.join(root, "docs/roadmap/IMPLEMENTATION_QUEUE.md"), "utf8");
const deletionCandidates = readFileSync(path.join(root, "docs/roadmap/DELETION_CANDIDATES.md"), "utf8");

const forbiddenFixture = validateArchitectureImportGraph([
  {
    path: "packages/cat-server/src/routes/forbidden-route.ts",
    source: 'import { readFile } from "node:fs/promises";\nexport { readFile };\n',
  },
], []);
assert.deepEqual(forbiddenFixture, [
  "packages/cat-server/src/routes/forbidden-route.ts -> node:fs/promises: routes must not import node:fs directly",
]);

assert.deepEqual(
  validateArchitectureImportGraph([
    {
      path: "packages/cat-server/src/application/forbidden-application.ts",
      source: 'import { handleTaskWorkspaceRoute } from "../routes/task_workspace_routes.js";\nexport { handleTaskWorkspaceRoute };\n',
    },
  ], []),
  [
    "packages/cat-server/src/application/forbidden-application.ts -> ../routes/task_workspace_routes.js: application must not depend on routes or the server composition root",
  ],
);

for (const exception of architectureImportExceptions) {
  assert.match(exception.owner, /^LA-\d+$/u, "every exception needs an exact removal owner");
  assert.ok(exception.reason.trim(), "every exception needs an audited reason");
  assert.match(queue, new RegExp(`\\| ${exception.owner} \\|`, "u"), "every exception owner must be an executable queue entry");
  assert.match(deletionCandidates, new RegExp(exception.owner, "u"), "every exception owner must be listed in deletion coverage");
}

assert.deepEqual(
  validateArchitectureImportGraph.fromRepository(root),
  [],
  "the repository import graph must satisfy the route/application/composition boundary",
);

console.log("architecture import graph tests passed");
