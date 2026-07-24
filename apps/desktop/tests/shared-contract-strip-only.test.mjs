import assert from "node:assert/strict";
import test from "node:test";
import {
  TaskRunTransitionError,
  transitionTaskRunStatus,
} from "../../../packages/cat-data/src/task_workspace_contract.ts";

test("the canonical Task contract loads in Node strip-only mode", () => {
  assert.equal(transitionTaskRunStatus("pending", "active"), "active");
  assert.throws(
    () => transitionTaskRunStatus("complete", "active"),
    (error) => error instanceof TaskRunTransitionError
      && error.code === "TASK_RUN_INVALID_STATE_TRANSITION"
      && error.from === "complete"
      && error.to === "active",
  );
});
