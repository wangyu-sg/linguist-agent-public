import assert from "node:assert/strict";
import { promptPrivateEvalSession } from "../packages/cat-server/src/private_eval_session.js";

let aborts = 0;
await assert.rejects(
  promptPrivateEvalSession({
    prompt: async () => new Promise<void>(() => undefined),
    abort: async () => { aborts += 1; },
  }, "prompt", { label: "Private Eval translator", timeoutMs: 5 }),
  /Private Eval translator timed out after 1 seconds/,
);
assert.equal(aborts, 1);

let completedAborts = 0;
await promptPrivateEvalSession({
  prompt: async () => undefined,
  abort: async () => { completedAborts += 1; },
}, "prompt", { label: "Private Eval editor", timeoutMs: 50 });
assert.equal(completedAborts, 0);

await assert.rejects(
  promptPrivateEvalSession({ prompt: async () => undefined, abort: async () => undefined }, "prompt", { label: "invalid", timeoutMs: 0 }),
  /positive finite duration/,
);

console.log("private eval session tests passed");
