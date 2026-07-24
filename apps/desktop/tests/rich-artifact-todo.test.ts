import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("the Electron rich artifact preview renders todo_list blocks", async () => {
  const [preview, inspectorCss] = await Promise.all([
    readFile(new URL("src/renderer/inspector/RichArtifactPreview.tsx", root), "utf8"),
    readFile(new URL("src/renderer/inspector/inspector.css", root), "utf8"),
  ]);
  assert.match(preview, /block\.type === "todo_list"/);
  assert.match(preview, /rich-artifact__todo/);
  assert.match(preview, /data-status=\{item\.status\}/, "each todo row exposes its status");
  assert.match(inspectorCss, /\.rich-artifact__todo\[data-status="completed"\] \.rich-artifact__todo-text\s*\{[\s\S]*?text-decoration:\s*line-through/, "completed todos render with strikethrough");
  assert.match(inspectorCss, /\.rich-artifact__todo\[data-status="in_progress"\]/, "in-progress todos carry a distinct state");
});
