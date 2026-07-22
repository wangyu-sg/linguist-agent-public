import {
  liveReplyMatchesDurableActivity,
  reduceLiveStreamEvent,
  type LiveReplyState,
  type LiveStreamEvent,
} from "./live-reply-model.ts";

const assert = {
  equal(actual: unknown, expected: unknown): void {
    if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  },
  deepEqual(actual: unknown, expected: unknown): void {
    const left = JSON.stringify(actual);
    const right = JSON.stringify(expected);
    if (left !== right) throw new Error(`Expected ${right}, received ${left}`);
  },
};

function test(name: string, run: () => void): void {
  try {
    run();
  } catch (cause) {
    throw new Error(name, { cause });
  }
}

const at = "2026-07-20T04:00:00.000Z";
const now = () => at;

function reduceAll(state: LiveReplyState | null, events: LiveStreamEvent[]): LiveReplyState | null {
  return events.reduce((current, event) => reduceLiveStreamEvent(current, event, now), state);
}

test("turn_start creates a fresh streaming state and resets a previous turn", () => {
  const started = reduceLiveStreamEvent(null, { type: "turn_start" }, now);
  assert.deepEqual(started, { startedAt: at, text: "", thinking: false, status: "streaming" });

  const dirty: LiveReplyState = { startedAt: "2026-07-19T00:00:00.000Z", text: "old text", thinking: true, status: "complete" };
  const reset = reduceLiveStreamEvent(dirty, { type: "turn_start" }, now);
  assert.deepEqual(reset, { startedAt: at, text: "", thinking: false, status: "streaming" });
});

test("turn identity prevents a delegated child reply from replacing the live Main reply", () => {
  const started = reduceLiveStreamEvent(null, { type: "turn_start", runId: "run-one" }, now);
  if (!started) throw new Error("Expected a live reply");
  assert.equal(liveReplyMatchesDurableActivity(started, {
    runId: "run-one",
    agentThreadId: "run-one.delegate.child",
    createdAt: at,
  }, "run-one.main"), false);
  assert.equal(liveReplyMatchesDurableActivity(started, {
    runId: "run-one",
    agentThreadId: "run-one.main",
    createdAt: at,
  }, "run-one.main"), true);
  assert.equal(liveReplyMatchesDurableActivity(started, {
    runId: "run-two",
    agentThreadId: "run-two.main",
    createdAt: at,
  }), false);
});

test("private reasoning is represented only by a content-free status", () => {
  const state = reduceAll(null, [
    { type: "assistant_delta", text: "Hello " },
    { type: "assistant_thinking_started" },
    { type: "assistant_delta", text: "world" },
    { type: "assistant_thinking_started" },
  ]);
  assert.deepEqual(state, {
    startedAt: at,
    text: "Hello world",
    thinking: true,
    status: "streaming",
  });
});

test("text reduction is independent of the thinking-status ordering", () => {
  const thinkingFirst = reduceAll(null, [
    { type: "assistant_thinking_started" },
    { type: "assistant_delta", text: "X" },
    { type: "assistant_delta", text: "Y" },
  ]);
  const textFirst = reduceAll(null, [
    { type: "assistant_delta", text: "X" },
    { type: "assistant_thinking_started" },
    { type: "assistant_delta", text: "Y" },
  ]);
  assert.deepEqual(thinkingFirst, textFirst);
});

test("empty deltas do not create state", () => {
  assert.equal(reduceLiveStreamEvent(null, { type: "assistant_delta" }, now), null);
});

test("assistant_final and done complete the reply and preserve content", () => {
  const streaming = reduceAll(null, [
    { type: "assistant_thinking_started" },
    { type: "assistant_delta", text: "answer" },
  ]);
  const finalized = reduceLiveStreamEvent(streaming, { type: "assistant_final" }, now);
  assert.deepEqual(finalized, { startedAt: at, text: "answer", thinking: true, status: "complete" });
  const done = reduceLiveStreamEvent(streaming, { type: "done" }, now);
  assert.deepEqual(done, finalized);
  // Terminal events never fabricate a reply that never started.
  assert.equal(reduceLiveStreamEvent(null, { type: "assistant_final" }, now), null);
  assert.equal(reduceLiveStreamEvent(null, { type: "done" }, now), null);
  assert.equal(reduceLiveStreamEvent(null, { type: "stopped", text: "halted" }, now), null);
});

test("stopped fails an in-flight reply with the stop reason", () => {
  const streaming = reduceLiveStreamEvent(null, { type: "assistant_delta", text: "partial" }, now);
  const stopped = reduceLiveStreamEvent(streaming, { type: "stopped" }, now);
  assert.deepEqual(stopped, {
    startedAt: at,
    text: "partial",
    thinking: false,
    status: "failed",
    error: "Agent run stopped.",
  });
});

test("error fails the reply, preferring errorMessage, and works from scratch", () => {
  const fromScratch = reduceLiveStreamEvent(null, { type: "error", errorMessage: "provider blew up" }, now);
  assert.deepEqual(fromScratch, {
    startedAt: at,
    text: "",
    thinking: false,
    status: "failed",
    error: "provider blew up",
  });
  const streaming = reduceLiveStreamEvent(null, { type: "assistant_thinking_started" }, now);
  const failed = reduceLiveStreamEvent(streaming, { type: "error", text: "fallback message" }, now);
  assert.deepEqual(failed, {
    startedAt: at,
    text: "",
    thinking: true,
    status: "failed",
    error: "fallback message",
  });
  const defaulted = reduceLiveStreamEvent(streaming, { type: "error" }, now);
  assert.equal(defaulted?.error, "Agent 回复中断。");
});

test("unrelated event types pass through without touching the reply", () => {
  const streaming = reduceLiveStreamEvent(null, { type: "assistant_delta", text: "answer" }, now);
  assert.equal(reduceLiveStreamEvent(streaming, { type: "permission_request" }, now), streaming);
  assert.equal(reduceLiveStreamEvent(streaming, { type: "accepted" }, now), streaming);
  assert.equal(reduceLiveStreamEvent(null, { type: "permission_request" }, now), null);
});

test("project turnId is normalized to the canonical Run identity", () => {
  const project = reduceLiveStreamEvent(null, { type: "turn_start", turnId: "run-project" }, now);
  assert.equal(project?.runId, "run-project");
  const standalone = reduceLiveStreamEvent(null, { type: "turn_start", runId: "run-chat" }, now);
  assert.equal(standalone?.runId, "run-chat");
});

test("terminal reply states absorb late done and delta events", () => {
  const streaming = reduceLiveStreamEvent(null, { type: "turn_start", turnId: "run-one" }, now);
  const failed = reduceLiveStreamEvent(streaming, { type: "error", errorMessage: "provider failed" }, now);
  const lateDone = reduceLiveStreamEvent(failed, { type: "done" }, now);
  const lateDelta = reduceLiveStreamEvent(lateDone, { type: "assistant_delta", text: "not delivered" }, now);
  assert.equal(lateDone?.status, "failed");
  assert.equal(lateDone?.error, "provider failed");
  assert.equal(lateDelta, lateDone);
});
