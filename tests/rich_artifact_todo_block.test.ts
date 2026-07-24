import assert from "node:assert/strict";
import test from "node:test";
import {
  parseRichArtifactDocument,
  renderRichArtifactHtml,
} from "../packages/cat-data/src/rich_artifact.ts";

const todoDocument = {
  schemaVersion: 1,
  title: "Release plan",
  createdAt: "2026-07-24T08:00:00.000Z",
  generator: "Linguist Agent · test",
  blocks: [{
    id: "todos",
    type: "todo_list",
    caption: "Launch checklist",
    items: [
      { id: "step-1", text: "Freeze the schema", status: "completed" },
      { id: "step-2", text: "Wire the host tool", status: "in_progress" },
      { id: "step-3", text: "Ship the Plan card", status: "pending" },
    ],
  }],
};

test("todo_list blocks parse with strict item status", () => {
  const document = parseRichArtifactDocument(todoDocument);
  const [block] = document.blocks;
  assert.equal(block.type, "todo_list");
  if (block.type !== "todo_list") return;
  assert.equal(block.caption, "Launch checklist");
  assert.deepEqual(
    block.items.map((item) => [item.id, item.status]),
    [["step-1", "completed"], ["step-2", "in_progress"], ["step-3", "pending"]],
  );
});

test("todo_list rejects unknown status, duplicate item ids, and empty items", () => {
  assert.throws(() => parseRichArtifactDocument({
    ...todoDocument,
    blocks: [{ id: "todos", type: "todo_list", items: [{ id: "x", text: "bad", status: "done" }] }],
  }), /status/);
  assert.throws(() => parseRichArtifactDocument({
    ...todoDocument,
    blocks: [{ id: "todos", type: "todo_list", items: [
      { id: "x", text: "one", status: "pending" },
      { id: "x", text: "two", status: "pending" },
    ] }],
  }), /unique/);
  assert.throws(() => parseRichArtifactDocument({
    ...todoDocument,
    blocks: [{ id: "todos", type: "todo_list", items: [] }],
  }), /must not be empty/);
});

test("the inert HTML export renders completed todos with strikethrough", () => {
  const html = renderRichArtifactHtml(parseRichArtifactDocument(todoDocument));
  assert.match(html, /todo/);
  assert.match(html, /text-decoration:\s*line-through/);
  assert.match(html, /Freeze the schema/);
  assert.match(html, /data-status="completed"/);
});
