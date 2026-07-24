import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("conversation timestamps reveal only on hover/focus per the spec density rule", async () => {
  const items = await readFile(new URL("src/renderer/conversation/conversation-items.css", root), "utf8");
  const baseRule = /\.conversation-activity time,[\s\S]*?\.conversation-artifact time\s*\{[\s\S]*?opacity:\s*0/;
  assert.match(items, baseRule, "activity/document/process/artifact timestamps default to hidden");
  const reveal = /:hover time,[\s\S]*?:focus-within time\s*\{[\s\S]*?opacity:\s*1/;
  assert.match(items, reveal, "hover and keyboard focus reveal the timestamp");
  assert.doesNotMatch(items, /\.conversation-run-boundary[\s\S]{0,200}opacity:\s*0/, "run boundary status labels stay visible");
});

test("the user bubble carries a hover-revealed spec copy action", async () => {
  const [component, items] = await Promise.all([
    readFile(new URL("src/renderer/conversation/ConversationItems.tsx", root), "utf8"),
    readFile(new URL("src/renderer/conversation/conversation-items.css", root), "utf8"),
  ]);
  assert.match(component, /className="conversation-human__copy"/);
  assert.match(component, /aria-label=\{copied \? "Copied" : "Copy message"\}/, "copy action carries the spec aria pair");
  assert.match(component, /navigator\.clipboard\.writeText/, "the action copies the message text");
  assert.match(
    items,
    /\.conversation-human__copy\s*\{[\s\S]*?opacity:\s*0/,
    "the copy action is hidden by default",
  );
  assert.match(
    items,
    /\.conversation-human:hover \.conversation-human__copy,[\s\S]*?\.conversation-human:focus-within \.conversation-human__copy\s*\{[\s\S]*?opacity:\s*1/,
    "hover and keyboard focus reveal the copy action",
  );
});
