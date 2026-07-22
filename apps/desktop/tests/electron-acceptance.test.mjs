import assert from "node:assert/strict";
import test from "node:test";
import {
  assertAcceptanceHandshakePath,
  assertIsolatedRuntimeURL,
  frameSummary,
  inspectFixture,
  nearestRank,
  parseArguments,
  summarize,
} from "../scripts/electron-acceptance-lib.mjs";

test("acceptance runtime is loopback, isolated, and never the managed port", () => {
  assert.equal(assertIsolatedRuntimeURL("http://127.0.0.1:8799"), "http://127.0.0.1:8799");
  assert.equal(assertIsolatedRuntimeURL("http://localhost:18799"), "http://localhost:18799");
  assert.throws(() => assertIsolatedRuntimeURL("http://127.0.0.1:8787"), /reserved/);
  assert.throws(() => assertIsolatedRuntimeURL("http://localhost:8787"), /reserved/);
  assert.throws(() => assertIsolatedRuntimeURL("https://127.0.0.1:8799"), /loopback HTTP/);
  assert.throws(() => assertIsolatedRuntimeURL("http://example.com:8799"), /loopback HTTP/);
  assert.throws(() => assertIsolatedRuntimeURL("http://127.0.0.1:8799/private"), /only loopback host and port/);
});

test("activity observer handshake requires a matched token and a /tmp path", () => {
  assert.deepEqual(parseArguments([
    "--only=activity-append",
    "--activity-run-token=round-1",
    "--activity-handshake=/private/tmp/la-activity/ready.json",
  ]), {
    allowGaps: false,
    only: ["activity-append"],
    activityRunToken: "round-1",
    activityHandshake: "/private/tmp/la-activity/ready.json",
  });
  assert.equal(assertAcceptanceHandshakePath("/tmp/la-activity.json"), "/tmp/la-activity.json");
  assert.throws(() => parseArguments(["--activity-run-token=round-1"]), /provided together/);
  assert.throws(() => parseArguments(["--activity-handshake=/private/tmp/ready.json"]), /provided together/);
  assert.throws(() => assertAcceptanceHandshakePath("/Users/example/ready.json"), /under \/tmp/);
});

test("five-run summaries use nearest-rank p95 without cherry-picking", () => {
  assert.equal(nearestRank([9, 1, 5, 3, 7], 0.95), 9);
  assert.deepEqual(summarize([9, 1, 5, 3, 7]), { count: 5, min: 1, median: 5, p95: 9, max: 9 });
});

test("frame summary reports cadence, hitches, and 100ms freezes", () => {
  const summary = frameSummary([0, 16, 32, 52, 68, 188], 60);
  assert.equal(summary.frames, 5);
  assert.equal(summary.hitchCount, 1);
  assert.equal(summary.freezeCount, 1);
  assert.equal(summary.maxFrameMs, 120);
});

test("fixture preflight reports real shortfalls instead of manufacturing stress data", async (context) => {
  const taskId = "task-small";
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (input, init) => {
    assert.equal(init?.method, undefined);
    const path = new URL(input).pathname;
    if (path === "/api/health") return Response.json({ productVersion: "test", apiProtocolVersion: 2, dataSchemaVersion: 2, runtimeInstanceId: "isolated" });
    if (path === "/api/projects") return Response.json({ projects: [{ projectId: "project-small", batches: [{ batchId: "batch-small", segments: 5 }] }] });
    if (path === "/api/projects/project-small/tasks") return Response.json({ tasks: [{ id: taskId, status: "active" }] });
    if (path === `/api/projects/project-small/tasks/${taskId}`) return Response.json({
      task: { id: taskId }, activities: [{ id: "one", type: "message" }], artifacts: [], decisions: [],
    });
    return Response.json({}, { status: 404 });
  };
  const report = await inspectFixture({
    scenarios: {
      activity465: { projectId: "project-small", taskId },
      cat1040: { projectId: "project-small", batchId: "batch-small", taskId },
    },
  }, "http://127.0.0.1:8799", "fixture-token");
  assert.ok(report.gaps.includes("activity465: batchId is required for deterministic navigation"));
  assert.ok(report.gaps.includes("activity465: 1 complete activities, requires at least 465"));
  assert.ok(report.gaps.includes("cat1040: 5 complete segments, requires at least 1040"));
  assert.equal(report.inventory.projects[0].batches[0].segments, 5);
  assert.match(report.inventory.projects[0].id, /^sha256:/);
});
