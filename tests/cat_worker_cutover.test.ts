import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../packages/cat-server/src/server.ts", import.meta.url), "utf8");
const projectCoordinatorSource = await readFile(new URL("../packages/cat-server/src/application/project_task_run_coordinator.ts", import.meta.url), "utf8");
const projectStart = projectCoordinatorSource.indexOf("async run(");
const projectEnd = projectCoordinatorSource.lastIndexOf("\n}");
assert.ok(projectStart >= 0 && projectEnd > projectStart);
const projectRun = projectCoordinatorSource.slice(projectStart, projectEnd);
assert.match(projectRun, /this\.deps\.workerRuntime\.createSession\(/u);
assert.doesNotMatch(projectRun, /createCatAgentSession\(/u);
assert.match(projectRun, /bindWorkerIdentity\(turnId/u);
assert.match(projectRun, /setExecutionSnapshot\(snapshot\)/u);

const evalStart = source.indexOf("async function runPrivateEvalSingle(");
const evalEnd = source.indexOf("type TaskAgentRunOptions", evalStart);
assert.ok(evalStart >= 0 && evalEnd > evalStart);
const evalRun = source.slice(evalStart, evalEnd);
assert.match(evalRun, /catWorkerRuntime\.createSession\(/u);
assert.doesNotMatch(evalRun, /createCatAgentSession\(/u);
assert.match(evalRun, /workerId: workerCreation\.workerId/u);
assert.match(evalRun, /runtimeEpochId: workerCreation\.runtimeEpochId/u);

console.log("cat worker cutover tests passed");
