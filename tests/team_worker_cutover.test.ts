import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../packages/cat-server/src/server.ts", import.meta.url), "utf8");
const start = source.indexOf("async function spawnWorkflowSubagent(");
const end = source.indexOf("function workflowRouteDeps(", start);
assert.ok(start >= 0 && end > start);
const launch = source.slice(start, end);

assert.match(launch, /catWorkerRuntime\.createSession\(/u, "new Team specialist transport Sessions must use Supervisor Worker authority");
assert.doesNotMatch(launch, /createCatAgentSession\(/u, "new Team specialist transport Sessions must never execute in the Host");
assert.match(launch, /profile:\s*"team"/u);
assert.match(launch, /readTeamEvidenceChildScope/u, "the server-authored child evidence scope must be validated before Worker launch");
assert.match(launch, /childScope\.projectId !== projectId[\s\S]*childScope\.workflowId !== workflowId[\s\S]*childScope\.roleId !== roleId/u, "a sibling or cross-Project evidence scope must be rejected");
assert.match(launch, /childScope\.allowedTools/u, "the exact read-only child tool subset must remain attested");
assert.match(launch, /workerId:\s*createdSession\.workerId/u);
assert.match(launch, /runtimeEpochId:\s*createdSession\.runtimeEpochId/u);

console.log("Team worker cutover tests passed");
