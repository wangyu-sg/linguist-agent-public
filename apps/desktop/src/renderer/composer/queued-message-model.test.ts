import { moveQueuedMessage } from "./queued-message-model.ts";

function equal(actual: string[], expected: string[]): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${expected.join(",")}, received ${actual.join(",")}`);
}

equal(moveQueuedMessage(["a", "b", "c"], "a", "c"), ["b", "c", "a"]);
equal(moveQueuedMessage(["a", "b", "c"], "c", "a"), ["c", "a", "b"]);
equal(moveQueuedMessage(["a", "b"], "missing", "a"), ["a", "b"]);
