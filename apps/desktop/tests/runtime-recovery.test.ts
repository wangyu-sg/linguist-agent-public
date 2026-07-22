import assert from "node:assert/strict";
import test from "node:test";
import { canInstallOrRepairRuntime } from "../src/renderer/workspace/runtime-recovery.ts";

test("runtime repair is offered only for installation failures, not credential recovery", () => {
  assert.equal(canInstallOrRepairRuntime("offline"), true);
  assert.equal(canInstallOrRepairRuntime("incompatible"), true);
  assert.equal(canInstallOrRepairRuntime("error"), true);
  assert.equal(canInstallOrRepairRuntime("credential-unavailable"), false);
  assert.equal(canInstallOrRepairRuntime("credential-rejected"), false);
  assert.equal(canInstallOrRepairRuntime("ready"), false);
});
