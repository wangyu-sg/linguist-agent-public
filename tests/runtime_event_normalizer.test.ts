import assert from "node:assert/strict";
import { normalizePiRuntimeEvent } from "../packages/cat-runtime/src/index.js";

const mapped = [
  { type: "turn_start" },
  { type: "message_update", message: { role: "assistant" }, assistantMessageEvent: { type: "text_delta", delta: "Hello" } },
  { type: "tool_execution_start", toolCallId: "tool-1", toolName: "read", args: { path: "fixture.txt" } },
  { type: "tool_execution_update", toolCallId: "tool-1", toolName: "read", args: { path: "fixture.txt" }, partialResult: { content: "partial" } },
  { type: "tool_execution_end", toolCallId: "tool-1", toolName: "read", result: { content: "done" }, isError: false },
  { type: "queue_update", steering: ["now"], followUp: ["later"] },
  { type: "compaction_end", reason: "manual", result: { tokensBefore: 100, estimatedTokensAfter: 40 }, aborted: false, willRetry: false },
  { type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 25, errorMessage: "retry" },
  { type: "auto_retry_end", success: true, attempt: 1 },
  { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Hello" }] } },
] as const;

const normalized = mapped.map((event) => normalizePiRuntimeEvent(event));
assert.deepEqual(normalized.map((event) => event.type), [
  "lifecycle",
  "message.delta",
  "tool.started",
  "tool.updated",
  "tool.completed",
  "queue.changed",
  "compaction.completed",
  "retry.started",
  "retry.completed",
  "message.completed",
]);
assert.deepEqual(normalized[1], { type: "message.delta", channel: "text", delta: "Hello" });
assert.deepEqual(normalized[4], { type: "tool.completed", toolCallId: "tool-1", toolName: "read", result: { content: "done" }, isError: false });
assert.deepEqual(normalized[5], { type: "queue.changed", steering: ["now"], followUp: ["later"] });
assert.deepEqual(normalized[7], { type: "retry.started", attempt: 1, maxAttempts: 3, delayMs: 25, errorMessage: "retry" });

assert.deepEqual(normalizePiRuntimeEvent({ type: "future_pi_event", payload: 1 }), {
  type: "runtime.diagnostic",
  code: "UNMAPPED_NATIVE_EVENT",
  nativeType: "future_pi_event",
  message: "Unmapped Pi runtime event future_pi_event.",
});
assert.deepEqual(normalizePiRuntimeEvent({ type: "tool_execution_start", toolCallId: 1, toolName: "read" }), {
  type: "runtime.diagnostic",
  code: "INVALID_NATIVE_EVENT",
  nativeType: "tool_execution_start",
  message: "Pi runtime event tool_execution_start has an invalid toolCallId.",
});

process.stdout.write("runtime event normalizer tests passed\n");
