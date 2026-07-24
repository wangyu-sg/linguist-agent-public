import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  validateExecutionGateLedgerDocuments,
  validateRoadmap,
  validateRoadmapDocuments,
  validateStorageAuthorityBoundaries,
  type ExecutionGateLedgerDocuments,
  type RoadmapDocuments,
} from "../scripts/validate-roadmap.js";

const root = process.cwd();
const current: RoadmapDocuments = {
  queue: readFileSync(path.join(root, "docs/roadmap/IMPLEMENTATION_QUEUE.md"), "utf8"),
  risks: readFileSync(path.join(root, "docs/roadmap/RISK_REGISTER.md"), "utf8"),
  deletions: readFileSync(path.join(root, "docs/roadmap/DELETION_CANDIDATES.md"), "utf8"),
};

assert.deepEqual(validateRoadmapDocuments(current), []);
assert.deepEqual(validateStorageAuthorityBoundaries(current.queue), []);
assert.deepEqual(validateRoadmap(root), []);

function expectError(documents: RoadmapDocuments, fragment: string): void {
  assert.ok(
    validateRoadmapDocuments(documents).some((error) => error.includes(fragment)),
    `expected validator error containing: ${fragment}`,
  );
}

const firstTicketRow = "| LA-000 | ticket | R-029 | yes | LA-BASE | 0 |";
expectError({ ...current, queue: current.queue.replace(firstTicketRow, `${firstTicketRow}\n${firstTicketRow}`) }, "duplicate ticket");
expectError({ ...current, queue: current.queue.replace("| LA-000 | ticket | R-029 | yes | LA-BASE | 0 |", "| LA-000 | ticket | R-029 | yes | LA-001 | 0 |") }, "dependency cycle");
expectError({ ...current, queue: current.queue.replace("LA-043, LA-044", "LA-043-044") }, "forbidden ticket range");
expectError({ ...current, queue: current.queue.replace("| LA-005 | ticket | R-005 |", "| LA-005 | ticket | — |") }, "risk/ticket mismatch");
expectError({ ...current, queue: current.queue.replace("| LA-017 | epic | R-002 | no |", "| LA-017 | epic | R-002 | yes |") }, "epic must not be executable");
expectError(
  { ...current, queue: current.queue.replace("| LA-084 | ticket | R-011 | yes | LA-022, LA-023 | 3 |\n", "") },
  "storage epic child is missing or non-executable: LA-024 -> LA-084",
);
expectError({ ...current, deletions: current.deletions.replace("| full-permission-preset | LA-006 |", "| full-permission-preset | LA-999 |") }, "deletion candidate references unknown ticket");
expectError({ ...current, queue: current.queue.replace("| LA-059 | decision | R-030 | no | LA-000 | 0 |", "| LA-059 | decision | R-030 | no | LA-000 | 7 |") }, "P0 risk lacks Phase 0");
expectError(
  { ...current, queue: current.queue.replace("<!-- TASK_AGGREGATE_CUTOVER_OWNER: LA-089 -->", "") },
  "Task aggregate must have exactly one production cutover owner",
);
expectError(
  { ...current, queue: current.queue.replace("<!-- TASK_AGGREGATE_CUTOVER_OWNER: LA-089 -->", "<!-- TASK_AGGREGATE_CUTOVER_OWNER: LA-087 -->") },
  "Task aggregate production cutover owner must be LA-089",
);
expectError(
  { ...current, queue: current.queue.replace("| LA-087 | ticket | R-011 | yes | LA-086, LA-102 | 3 |", "| LA-087 | ticket | R-011 | yes | LA-086 | 3 |") },
  "LA-087 must depend on LA-102",
);
assert.ok(
  validateStorageAuthorityBoundaries(
    current.queue.replace("<!-- PROJECT_QUALITY_LEDGER_CUTOVER_OWNER: LA-098 -->", ""),
  ).some((error) => error.includes("Project quality ledger must have exactly one production cutover owner")),
);
assert.ok(
  validateStorageAuthorityBoundaries(
    current.queue.replace("<!-- TASK_AGGREGATE_EXCLUDES_PROJECT_QUALITY_LEDGER -->", ""),
  ).some((error) => error.includes("Task aggregate boundary must exclude the Project quality ledger")),
);

const gateLedger: ExecutionGateLedgerDocuments = {
  markdown: "## Stage Gate G1 — Stopgaps\n\n## Stage Gate G2 — Runtime Contract\n",
  json: JSON.stringify({ stageGates: [{ id: "G1" }, { id: "G2" }] }),
  reportFiles: ["G1_STOPGAPS_REPORT.md", "G2_RUNTIME_CONTRACT_REPORT.md"],
};
assert.deepEqual(validateExecutionGateLedgerDocuments(gateLedger), []);
assert.ok(
  validateExecutionGateLedgerDocuments({
    ...gateLedger,
    json: JSON.stringify({ stageGates: [{ id: "G1" }] }),
  }).some((error) => error.includes("Gate report missing JSON ledger entry: G2")),
);
assert.ok(
  validateExecutionGateLedgerDocuments({
    ...gateLedger,
    markdown: "## Stage Gate G1 — Stopgaps\n",
  }).some((error) => error.includes("Gate report missing Markdown ledger entry: G2")),
);

process.stdout.write("roadmap validator tests passed\n");
