import assert from "node:assert/strict";
import {
  createRuntimeEventPipeline,
  type AgentRuntimeEvent,
} from "../packages/cat-runtime/src/index.js";

function fakeScheduler() {
  const queued: Array<() => void> = [];
  const delays: number[] = [];
  return {
    schedule(callback: () => void, delayMs: number): () => void {
      queued.push(callback);
      delays.push(delayMs);
      return () => {
        const index = queued.indexOf(callback);
        if (index >= 0) queued.splice(index, 1);
      };
    },
    runNext(): void {
      const callback = queued.shift();
      if (!callback) throw new Error("No scheduled flush is available.");
      callback();
    },
    count: () => queued.length,
    delays,
  };
}

function assistantFailure(message = "provider overloaded"): AgentRuntimeEvent {
  return {
    type: "message.completed",
    message: { role: "assistant", stopReason: "error", errorMessage: message, content: [] },
  };
}

{
  const scheduler = fakeScheduler();
  const emitted: AgentRuntimeEvent[] = [];
  const pipeline = createRuntimeEventPipeline({
    emit: (event) => emitted.push(event),
    schedule: scheduler.schedule,
  });

  pipeline.accept(assistantFailure());
  assert.deepEqual(emitted, [], "an attempt failure waits for Pi's retry decision");
  pipeline.accept({ type: "lifecycle", phase: "agent_end", willRetry: true });
  pipeline.accept({ type: "retry.started", attempt: 1, maxAttempts: 3, delayMs: 25, errorMessage: "provider overloaded" });
  assert.equal(emitted.some((event) => event.type === "run.failed"), false, "a retryable attempt is never terminal");
  assert.deepEqual(emitted.find((event) => event.type === "attempt.failed"), {
    type: "attempt.failed",
    errorMessage: "provider overloaded",
    willRetry: true,
  }, "a retrying attempt remains observable without becoming a Run terminal");

  pipeline.accept({ type: "retry.completed", success: true, attempt: 1 });
  pipeline.accept({ type: "message.completed", message: { role: "assistant", stopReason: "stop", content: [] } });
  pipeline.accept({ type: "lifecycle", phase: "agent_end", willRetry: false });
  pipeline.settle();
  assert.equal(emitted.filter((event) => event.type === "run.failed").length, 0);
}

{
  const emitted: AgentRuntimeEvent[] = [];
  const pipeline = createRuntimeEventPipeline({ emit: (event) => emitted.push(event) });
  pipeline.accept({ type: "lifecycle", phase: "agent_end", willRetry: false });
  pipeline.accept(assistantFailure("quota exhausted"));
  pipeline.settle();
  pipeline.settle();
  assert.deepEqual(emitted.filter((event) => event.type === "run.failed"), [{
    type: "run.failed",
    errorMessage: "quota exhausted",
  }], "a terminal failure is emitted exactly once even when retry decision arrives first");
}

{
  const emitted: AgentRuntimeEvent[] = [];
  const pipeline = createRuntimeEventPipeline({ emit: (event) => emitted.push(event) });
  pipeline.accept(assistantFailure());
  pipeline.accept({ type: "lifecycle", phase: "agent_end", willRetry: true });
  pipeline.cancel();
  pipeline.settle();
  assert.equal(emitted.some((event) => event.type === "run.failed"), false, "cancellation during retry cannot become terminal failure");
}

{
  const scheduler = fakeScheduler();
  const emitted: AgentRuntimeEvent[] = [];
  const pipeline = createRuntimeEventPipeline({
    emit: (event) => emitted.push(event),
    schedule: scheduler.schedule,
  });
  pipeline.accept({ type: "message.delta", channel: "text", delta: "A" });
  pipeline.accept({ type: "message.delta", channel: "text", delta: "B" });
  pipeline.accept({ type: "message.delta", channel: "text", delta: "C" });
  assert.equal(scheduler.count(), 1, "many deltas schedule at most one 50ms flush window");
  assert.deepEqual(scheduler.delays, [50], "the default coalescing window caps ordinary text updates at 20fps");
  assert.deepEqual(emitted, []);
  scheduler.runNext();
  assert.deepEqual(emitted, [{ type: "message.delta", channel: "text", delta: "ABC" }]);

  pipeline.accept({ type: "message.delta", channel: "text", delta: "D" });
  pipeline.accept({ type: "message.completed", message: { role: "assistant", stopReason: "stop", content: [] } });
  assert.deepEqual(emitted.slice(-2).map((event) => event.type), ["message.delta", "message.completed"], "final events flush pending text first");
  assert.equal((emitted.at(-2) as { delta?: string }).delta, "D");
  assert.equal(scheduler.count(), 0, "an immediate final cancels the pending timer");
}

console.log("runtime event pipeline tests passed");
