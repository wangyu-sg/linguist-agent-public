import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const serverSource = await readFile(new URL("../packages/cat-server/src/server.ts", import.meta.url), "utf8");
const workerRpcSource = await readFile(new URL("../packages/cat-server/src/cat_worker_rpc.ts", import.meta.url), "utf8");
const runtimePortSource = await readFile(new URL("../packages/cat-runtime/src/agentRuntimePort.ts", import.meta.url), "utf8");
const generalCoordinatorSource = await readFile(new URL("../packages/cat-server/src/general_agent_runs.ts", import.meta.url), "utf8");

assert.doesNotMatch(
  serverSource,
  /\bcreate(?:Cat|General)AgentSession\s*\(/u,
  "the production Server must not construct Pi Agent Sessions in the Host process",
);
assert.match(
  workerRpcSource,
  /\bcreateCatAgentSession\s*\(/u,
  "CAT-family Session construction must remain inside the CAT Worker application boundary",
);
assert.doesNotMatch(
  generalCoordinatorSource,
  /\.runtimePort\.createGeneralSession\s*\(/u,
  "standalone compaction, fork, and delegated children must not retain a Host Session fallback",
);
assert.match(
  generalCoordinatorSource,
  /\.workerRuntime\.createGeneralSession\s*\(/u,
  "all standalone General Session construction must use Worker authority",
);
assert.match(
  runtimePortSource,
  /\bcreateGeneralAgentSession\s*\(/u,
  "General Session construction must remain behind the Worker-owned runtime adapter",
);

for (const marker of [
  'profile: "cat"',
  'profile: "private_eval"',
  'profile: "team"',
] as const) {
  assert.match(serverSource, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
}

console.log("worker execution boundary tests passed");
