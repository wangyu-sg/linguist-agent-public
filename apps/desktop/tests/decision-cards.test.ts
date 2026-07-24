import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("the approval surface keeps the spec shell and kbd hints", async () => {
  const [surface, items] = await Promise.all([
    readFile(new URL("src/renderer/conversation/PermissionRequestSurface.tsx", root), "utf8"),
    readFile(new URL("src/renderer/conversation/conversation-items.css", root), "utf8"),
  ]);
  assert.match(items, /\.permission-request-surface\s*\{[\s\S]*?border-radius:\s*20px/, "approval shell is the spec rounded-3xl 20px");
  assert.match(items, /\.permission-request-surface\s*\{[\s\S]*?box-shadow:\s*var\(--la-elevation-prominent\)/, "approval shell uses the spec elevation");
  assert.match(surface, /className="permission-request-surface__kbd" aria-hidden="true">Enter</, "Allow once carries the Enter kbd hint");
  assert.match(surface, /className="permission-request-surface__kbd" aria-hidden="true">Esc</, "Deny carries the Esc kbd hint");
  const kbdRule = /\.permission-request-surface__kbd\s*\{(?<body>[\s\S]*?)\}/.exec(items)?.groups?.body ?? "";
  for (const declaration of [/height:\s*16px/, /min-width:\s*16px/, /border-radius:\s*6px/, /currentColor 10%/]) {
    assert.match(kbdRule, declaration, `kbd hint keeps ${declaration}`);
  }
});

test("model changes render as an inline divider derived from canonical execution snapshots", async () => {
  const [model, component, items] = await Promise.all([
    readFile(new URL("src/renderer/conversation/conversation-model.ts", root), "utf8"),
    readFile(new URL("src/renderer/conversation/ConversationItems.tsx", root), "utf8"),
    readFile(new URL("src/renderer/conversation/conversation-items.css", root), "utf8"),
  ]);
  assert.match(model, /kind: "model-change"/, "the conversation model derives model-change items");
  assert.match(model, /executionSnapshots/, "the derivation reads canonical execution snapshots");
  assert.match(component, /case "model-change": return/, "the estimator sizes model-change rows");
  assert.match(component, /function ModelChangeDivider/);
  assert.match(component, /Model changed from/);
  assert.match(component, /role="separator"/);
  assert.match(component, /切换模型后表现可能变化。/, "warning tooltip line 1");
  assert.match(component, /上下文可能自动压缩；从下一 Turn 生效。/, "warning tooltip line 2");
  assert.match(items, /\.conversation-model-change__rule\s*\{[\s\S]*?flex:\s*1[\s\S]*?border-top:\s*1px solid var\(--la-border-default\)/, "divider keeps the flanking hairlines");
  assert.match(items, /\.conversation-model-change__tooltip\s*\{[\s\S]*?opacity:\s*0/, "warning lives in a reveal tooltip");
});
