import assert from "node:assert/strict";
import { createKeyedSerialQueue, mapWithConcurrencyLimit } from "@linguist-agent/cat-runtime";

const runningCounts: number[] = [];
let running = 0;
const ordered = await mapWithConcurrencyLimit(
  [1, 2, 3, 4, 5],
  async (item) => {
    running += 1;
    runningCounts.push(running);
    await new Promise((resolve) => setTimeout(resolve, item === 1 ? 20 : 1));
    running -= 1;
    return item * 2;
  },
  { concurrency: 2 },
);
assert.equal(ordered.aborted, false);
assert.deepEqual(ordered.results, [2, 4, 6, 8, 10]);
assert.equal(Math.max(...runningCounts), 2, "worker pool must respect the concurrency limit");

await assert.rejects(
  () =>
    mapWithConcurrencyLimit(
      [1, 2, 3],
      async (item) => {
        if (item === 2) throw new Error("boom");
        return item;
      },
      { concurrency: 1 },
    ),
  /boom/,
  "non-abort mapper errors should fail fast",
);

const controller = new AbortController();
let seen = 0;
const aborted = await mapWithConcurrencyLimit(
  [1, 2, 3, 4],
  async (item) => {
    seen += 1;
    if (item === 2) controller.abort();
    return item;
  },
  { concurrency: 1, signal: controller.signal },
);
assert.equal(aborted.aborted, true);
assert.deepEqual(aborted.results, [1, 2]);
assert.equal(seen, 2);

const queue = createKeyedSerialQueue();

// Same key: tasks run strictly one-after-another even when the first is slower.
const sameKeyEvents: string[] = [];
const firstRun = queue("agent:p1", async () => {
  sameKeyEvents.push("a-start");
  await new Promise((resolve) => setTimeout(resolve, 20));
  sameKeyEvents.push("a-end");
  return "a";
});
const secondRun = queue("agent:p1", async () => {
  sameKeyEvents.push("b-start");
  await new Promise((resolve) => setTimeout(resolve, 1));
  sameKeyEvents.push("b-end");
  return "b";
});
assert.deepEqual(await Promise.all([firstRun, secondRun]), ["a", "b"]);
assert.deepEqual(sameKeyEvents, ["a-start", "a-end", "b-start", "b-end"], "same-key tasks must serialize");

// Different keys: tasks overlap instead of waiting on each other.
const crossKeyEvents: string[] = [];
const slowRun = queue("agent:p2", async () => {
  crossKeyEvents.push("slow-start");
  await new Promise((resolve) => setTimeout(resolve, 30));
  crossKeyEvents.push("slow-end");
});
const fastRun = queue("assistant", async () => {
  crossKeyEvents.push("fast-start");
  await new Promise((resolve) => setTimeout(resolve, 1));
  crossKeyEvents.push("fast-end");
});
await Promise.all([slowRun, fastRun]);
assert.deepEqual(crossKeyEvents, ["slow-start", "fast-start", "fast-end", "slow-end"], "different keys must run in parallel");

// A rejected predecessor must not poison the queue for queued successors.
const failingRun = queue("agent:p3", async () => {
  throw new Error("first failed");
});
const recoveredRun = queue("agent:p3", async () => "recovered");
await assert.rejects(failingRun, /first failed/);
assert.equal(await recoveredRun, "recovered");

console.log("concurrency tests passed");
