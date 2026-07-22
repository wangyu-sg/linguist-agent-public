import assert from "node:assert/strict";
import {
  AgentTraceBuilder,
  AGENT_EVENT_SCHEMA_VERSION,
  previewValue,
} from "@linguist-agent/cat-server/agent_events";

const builder = new AgentTraceBuilder({
  projectId: "proj",
  sessionId: "session-1",
  sessionFile: "/tmp/session.jsonl",
  turnId: "turn-fixed",
  now: () => "2026-05-28T00:00:00.000Z",
});

const start = builder.event("turn_start", {
  text: "review batch",
  requestShapeHash: "a".repeat(64),
  activeToolCount: 11,
});
const tool = builder.event("tool_start", {
  toolCallId: "call-1",
  toolName: "tm_lookup",
  argsPreview: previewValue({ source: "勇者徽记" }),
});
const error = builder.event("error", {
  isError: true,
  errorMessage: "provider failed",
  recoveryKind: "retryable_provider",
});

assert.equal(start.version, AGENT_EVENT_SCHEMA_VERSION);
assert.equal(start.eventId, "turn-fixed:0001");
assert.equal(start.requestShapeHash, "a".repeat(64));
assert.equal(tool.eventId, "turn-fixed:0002");
assert.equal(tool.turnId, start.turnId);
assert.equal(tool.projectId, "proj");
assert.equal(tool.sessionId, "session-1");
assert.equal(tool.toolName, "tm_lookup");
assert.equal(error.eventId, "turn-fixed:0003");
assert.equal(error.recoveryKind, "retryable_provider");
assert.match(previewValue("x".repeat(900)), /\[truncated\]$/);

const sensitivePreview = previewValue({
  path: "/project/brief.pdf",
  password: "document-password",
  nested: {
    APIKey: "provider-key",
    Authorization: "Bearer abc",
    values: [{ PassPhrase: "key-passphrase" }, { refresh_token: "refresh-token" }],
  },
  COOKIE: "session-cookie",
  clientSecret: "client-secret",
});
assert.equal(sensitivePreview.includes("document-password"), false);
assert.equal(sensitivePreview.includes("provider-key"), false);
assert.equal(sensitivePreview.includes("Bearer abc"), false);
assert.equal(sensitivePreview.includes("key-passphrase"), false);
assert.equal(sensitivePreview.includes("refresh-token"), false);
assert.equal(sensitivePreview.includes("session-cookie"), false);
assert.equal(sensitivePreview.includes("client-secret"), false);
assert.match(sensitivePreview, /\[REDACTED\]/);
assert.match(sensitivePreview, /\/project\/brief\.pdf/);

const jsonStringPreview = previewValue(JSON.stringify({
  path: "/project/locked.pdf",
  PASSWORD: "json-password",
  headers: { authorization: "Basic xyz", Cookie: "json-cookie" },
  rows: [{ api_key: "json-api-key" }],
}));
assert.equal(jsonStringPreview.includes("json-password"), false);
assert.equal(jsonStringPreview.includes("Basic xyz"), false);
assert.equal(jsonStringPreview.includes("json-cookie"), false);
assert.equal(jsonStringPreview.includes("json-api-key"), false);
assert.match(jsonStringPreview, /\/project\/locked\.pdf/);

const cyclic: Record<string, unknown> = { label: "safe", password: "cycle-password" };
cyclic.self = cyclic;
const cyclicPreview = previewValue(cyclic);
assert.equal(cyclicPreview.includes("cycle-password"), false);
assert.match(cyclicPreview, /\[Circular\]/);

const boundedPreview = previewValue({ safe: "x".repeat(2_000), token: "bounded-secret" }, 120);
assert.ok(boundedPreview.length <= 120);
assert.equal(boundedPreview.includes("bounded-secret"), false);
assert.match(boundedPreview, /\[truncated\]$/);

const defendedTrace = builder.event("tool_start", {
  toolCallId: "call-password",
  toolName: "document_parse",
  argsPreview: JSON.stringify({ path: "/project/brief.pdf", password: "trace-password" }),
  errorMessage: JSON.stringify({ message: "Open failed", credential: "trace-credential" }),
});
assert.equal(defendedTrace.argsPreview?.includes("trace-password"), false);
assert.match(defendedTrace.argsPreview ?? "", /\[REDACTED\]/);
assert.equal(defendedTrace.errorMessage?.includes("trace-credential"), false);
assert.match(defendedTrace.errorMessage ?? "", /\[REDACTED\]/);

console.log("agent trace builder tests passed");
