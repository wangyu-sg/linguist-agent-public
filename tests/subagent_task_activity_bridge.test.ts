import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readSubagentTaskActivityDrafts } from "../packages/cat-server/src/subagent_task_activity_bridge.js";

const root = await mkdtemp(join(tmpdir(), "la-subagent-activity-"));
const asyncDir = join(root, "subagent-real-shape");
await mkdir(asyncDir, { recursive: true });
const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "pi-subagents-events.v1.jsonl");
await writeFile(join(asyncDir, "events.jsonl"), `${await readFile(fixture, "utf8")}{\"type\":`, "utf8");

const input = {
  asyncRoot: root,
  asyncDir,
  subagentRunId: "subagent-real-shape",
  taskId: "task-one",
  runId: "workflow-one",
  agentThreadId: "workflow-one.editor",
  roleId: "editor",
  displayName: "Editor",
  firstSeq: 7,
  fallbackTimestamp: "2026-07-10T12:00:00.000Z",
};
const drafts = await readSubagentTaskActivityDrafts(input);
const activities = drafts.flatMap((draft) => draft.activity ? [draft.activity] : []);

assert.deepEqual(activities.map((row) => row.seq), activities.map((_, index) => index + 7));
assert.equal(activities.some((row) => row.type === "evidence_read" && row.tool?.name === "tm_lookup" && row.refs.evidenceRefs.includes("tm:synthetic:1")), true);
assert.equal(activities.some((row) => row.type === "evidence_read" && row.tool?.name === "batch_read"), true);
assert.equal(activities.some((row) => row.type === "tool_action" && row.tool?.name === "read"), true);
assert.equal(activities.some((row) => row.tool?.name === "read" && row.type === "evidence_read"), false, "generic read must never become CAT evidence");
assert.equal(activities.some((row) => row.body?.includes("private reasoning")), false, "hidden thinking must not enter TaskWorkspace");
assert.equal(activities.some((row) => row.status === "blocked" && /needs attention/.test(row.title)), true);
assert.equal(activities.filter((row) => row.status === "error").length, 2);
assert.equal(activities.some((row) => row.id.includes("future.unknown")), false);

const manyRefsDir = join(root, "subagent-many-refs");
await mkdir(manyRefsDir, { recursive: true });
const manyRefs = Array.from({ length: 30 }, (_, index) => `Evidence: tm:bulk:${index + 1}`).join("\n");
await writeFile(join(manyRefsDir, "events.jsonl"), `${JSON.stringify({
  type: "tool_execution_end",
  toolCallId: "call_many_refs",
  toolName: "tm_lookup",
  result: { content: [{ type: "text", text: manyRefs }] },
  isError: false,
  observedAt: 1783684801000,
})}\n`, "utf8");
const manyRefDrafts = await readSubagentTaskActivityDrafts({
  ...input,
  asyncDir: manyRefsDir,
  subagentRunId: "subagent-many-refs",
  firstSeq: 1,
});
assert.equal(manyRefDrafts[0]?.activity?.refs.evidenceRefs.length, 30, "Task activity must preserve every evidence ref from a paged CAT tool result");
assert.equal(manyRefDrafts[0]?.activity?.refs.evidenceRefs.at(-1), "tm:bulk:30");

const repeated = await readSubagentTaskActivityDrafts({
  ...input,
  existingActivityIds: activities.map((row) => row.id),
  firstSeq: 100,
});
assert.deepEqual(repeated, [], "stable source-line ids must make projection idempotent");

await assert.rejects(
  readSubagentTaskActivityDrafts({ ...input, asyncDir: dirname(root) }),
  /must be inside/,
);

console.log("subagent task activity bridge tests passed");
