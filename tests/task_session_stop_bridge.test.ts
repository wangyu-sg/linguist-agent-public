import assert from "node:assert/strict";
import {
  TaskSessionForcedStopError,
  createTaskSessionStopBridge,
} from "../packages/cat-server/src/task_session_stop_bridge.js";
import { ActiveAgentRunRegistry } from "../packages/cat-server/src/active_agent_runs.js";

let abortCalls = 0;
let disposeCalls = 0;
const bridge = createTaskSessionStopBridge();
const realSession = {
  abort: async () => { abortCalls += 1; },
  dispose: () => { disposeCalls += 1; },
};
bridge.bind(realSession);
await bridge.registrySession.abort();
assert.equal(abortCalls, 1);
bridge.registrySession.dispose();
await assert.rejects(bridge.forcedStop, TaskSessionForcedStopError);
assert.equal(disposeCalls, 1, "forced Stop must synchronously dispose the bound Pi session");
bridge.registrySession.dispose();
assert.equal(disposeCalls, 1, "repeated Stop must not dispose a Pi session twice");

const lateBridge = createTaskSessionStopBridge();
await lateBridge.registrySession.abort();
lateBridge.registrySession.dispose();
let lateAbortCalls = 0;
let lateDisposeCalls = 0;
assert.throws(
  () => lateBridge.bind({
    abort: async () => { lateAbortCalls += 1; },
    dispose: () => { lateDisposeCalls += 1; },
  }),
  TaskSessionForcedStopError,
  "a Session that finishes constructing after Stop must be disposed instead of starting a prompt",
);
assert.equal(lateAbortCalls, 0);
assert.equal(lateDisposeCalls, 1);

const abortBeforeBind = createTaskSessionStopBridge();
await abortBeforeBind.registrySession.abort();
let deferredAbortCalls = 0;
abortBeforeBind.bind({
  abort: async () => { deferredAbortCalls += 1; },
  dispose: () => undefined,
});
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(deferredAbortCalls, 1, "an abort requested during setup must reach the Session after binding");

const promptBridge = createTaskSessionStopBridge();
promptBridge.bind({ abort: async () => undefined, dispose: () => undefined });
const neverEndingPrompt = new Promise<void>(() => undefined);
const promptRace = Promise.race([neverEndingPrompt, promptBridge.forcedStop]);
promptBridge.registrySession.dispose();
await assert.rejects(promptRace, TaskSessionForcedStopError);
assert.equal(promptBridge.isForcedStopError(await promptRace.catch((error) => error)), true);

const boundedRegistry = new ActiveAgentRunRegistry(0, 5);
const boundedBridge = createTaskSessionStopBridge();
let boundedDisposeCalls = 0;
boundedBridge.bind({
  abort: async () => new Promise<void>(() => undefined),
  dispose: () => { boundedDisposeCalls += 1; },
});
boundedRegistry.register({
  turnId: "forced-stop-after-abort-timeout",
  scope: "project",
  session: boundedBridge.registrySession,
});
const boundedPrompt = Promise.race([new Promise<void>(() => undefined), boundedBridge.forcedStop]);
const boundedResult = await boundedRegistry.stop({ turnId: "forced-stop-after-abort-timeout" });
assert.deepEqual(boundedResult.errors, ["session abort timed out within the 5ms Stop budget"]);
await assert.rejects(boundedPrompt, TaskSessionForcedStopError);
assert.equal(boundedDisposeCalls, 1, "registry disposal must terminate the prompt even when abort never settles");

console.log("task_session_stop_bridge tests passed");
