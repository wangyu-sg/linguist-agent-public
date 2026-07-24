import { agentPresentDocument } from "./present-model.ts";
import type { TaskArtifact } from "../../../../../packages/cat-data/src/task_workspace_contract.ts";

const assert = {
  equal(actual: unknown, expected: unknown): void {
    if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  },
  ok(actual: unknown, message: string): void {
    if (!actual) throw new Error(`Expected a truthy value: ${message}`);
  },
};

function test(name: string, run: () => void): void {
  try {
    run();
  } catch (cause) {
    throw new Error(name, { cause });
  }
}

const canonicalDocument = {
  schemaVersion: 1,
  title: "Release comparison",
  createdAt: "2026-07-24T09:00:00.000Z",
  generator: "Linguist Agent · agent_present",
  blocks: [
    { id: "intro", type: "markdown", markdown: "# Findings" },
    {
      id: "comparison",
      type: "table",
      caption: "Options",
      columns: [{ key: "option", label: "Option" }],
      rows: [{ option: "A" }, { option: "B" }],
    },
    {
      id: "trend",
      type: "chart",
      kind: "bar",
      series: [{ label: "Weekly", points: [{ label: "W1", value: 4 }] }],
    },
  ],
};

function presentArtifact(document: unknown): TaskArtifact {
  return {
    id: "agent-present:chat:1",
    taskId: "chat",
    runId: "run",
    type: "agent_present",
    status: "reviewable",
    title: "Release comparison",
    summary: "3 个内容块的可视化回答",
    scope: { kind: "standalone", fileGrantIds: [] },
    version: 1,
    provenance: { agentThreadId: "run.main", activityId: "a1", evidenceRefs: [], parentArtifactIds: [] },
    availableDecisions: [],
    content: { document },
    createdAt: "2026-07-24T09:00:00.000Z",
    updatedAt: "2026-07-24T09:00:00.000Z",
  } as TaskArtifact;
}

test("agentPresentDocument parses the canonical document and preserves block order", () => {
  const document = agentPresentDocument(presentArtifact(canonicalDocument));
  assert.ok(document, "a valid present artifact yields a document");
  assert.equal(document!.title, "Release comparison");
  assert.equal(document!.blocks.map((block) => block.type).join(","), "markdown,table,chart");
  assert.equal(document!.blocks.map((block) => block.id).join(","), "intro,comparison,trend");
});

test("agentPresentDocument rejects non-present artifacts and corrupt payloads instead of fabricating", () => {
  assert.equal(agentPresentDocument(presentArtifact(canonicalDocument) && { ...presentArtifact(canonicalDocument), type: "agent_plan" as TaskArtifact["type"] }), null);
  assert.equal(agentPresentDocument(presentArtifact(undefined)), null);
  assert.equal(agentPresentDocument(presentArtifact({ schemaVersion: 2, title: "x", createdAt: "2026-07-24T09:00:00.000Z", generator: "g", blocks: [{ id: "a", type: "markdown", markdown: "x" }] })), null);
  assert.equal(agentPresentDocument(presentArtifact({ ...canonicalDocument, blocks: [{ id: "m", type: "markdown", markdown: "<script>alert(1)</script>" }] })), null);
});
