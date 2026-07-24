import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("composer surface consumes the elevation token and the slash menu the radius engine", async () => {
  const composer = await readFile(new URL("src/renderer/composer/composer.css", root), "utf8");
  assert.match(
    composer,
    /\.agent-composer__surface\s*\{[\s\S]*?box-shadow:\s*var\(--la-elevation-prominent\)/,
    "composer surface shadow is the spec elevation token",
  );
  assert.match(composer, /\.agent-composer__surface\s*\{[\s\S]*?backdrop-filter:\s*blur\(20px\) saturate\(125%\)/, "default surface keeps the 90% backdrop blur");
  assert.match(composer, /corner-shape:\s*superellipse\(1\.5\)/, "surface keeps the superellipse corner engine");
  assert.match(
    composer,
    /\.agent-composer__slash-menu\s*\{[\s\S]*?border-radius:\s*var\(--la-radius-takeover\)/,
    "slash menu uses the 16px-base radius token",
  );
  assert.match(composer, /\.agent-composer__attachments\s*\{[\s\S]*?padding:\s*8px 8px 6px/, "attachment area keeps the spec 8px/6px padding");
  assert.match(composer, /\.agent-composer__attachment\s*\{[\s\S]*?border-radius:\s*12px/, "attachment chips use the composer-radius-minus-8 geometry");
});

test("the composer placeholder renders through the spec pseudo-element mechanism", async () => {
  const [component, composer] = await Promise.all([
    readFile(new URL("src/renderer/composer/AgentComposer.tsx", root), "utf8"),
    readFile(new URL("src/renderer/composer/composer.css", root), "utf8"),
  ]);
  assert.match(component, /data-placeholder=\{placeholder\}/, "the input label carries the placeholder text for the pseudo-element");
  assert.match(
    composer,
    /\.agent-composer__input:has\(textarea:placeholder-shown\)::after\s*\{[\s\S]*?content:\s*attr\(data-placeholder\)/,
    "the pseudo-element renders the placeholder copy",
  );
  const placeholderRule = /\.agent-composer__input:has\(textarea:placeholder-shown\)::after\s*\{(?<body>[\s\S]*?)\}/.exec(composer)?.groups?.body ?? "";
  for (const declaration of [
    /white-space:\s*nowrap/,
    /text-overflow:\s*ellipsis/,
    /opacity:\s*0\.5/,
    /pointer-events:\s*none/,
    /position:\s*absolute/,
  ]) {
    assert.match(placeholderRule, declaration, `placeholder pseudo-element keeps ${declaration}`);
  }
  assert.match(composer, /\.agent-composer textarea::placeholder\s*\{[\s\S]*?color:\s*transparent/, "the native placeholder stays accessible but visually transparent");
});

test("batch-ready and task conversation share one composer asset/model control assembly", async () => {
  const [workbench, workspace, conversation, index] = await Promise.all([
    readFile(new URL("src/renderer/composer/composer-workbench.tsx", root), "utf8"),
    readFile(new URL("src/renderer/workspace/Workspace.tsx", root), "utf8"),
    readFile(new URL("src/renderer/conversation/TaskConversation.tsx", root), "utf8"),
    readFile(new URL("src/renderer/composer/index.ts", root), "utf8"),
  ]);
  assert.match(workbench, /export function ComposerAssetControls/);
  assert.match(workbench, /export function ComposerModelControls/);
  assert.match(index, /composer-workbench\.tsx/, "the shared assembly is exported through the composer index");
  assert.match(workspace, /<ComposerAssetControls/, "BatchReady consumes the shared asset controls");
  assert.match(workspace, /<ComposerModelControls/, "BatchReady consumes the shared model controls");
  assert.match(conversation, /<ComposerModelControls/, "TaskConversation consumes the shared model controls");
  assert.match(conversation, /<ComposerAssetControls/, "TaskConversation consumes the shared asset controls");
  assert.doesNotMatch(workspace, /<ComposerAddDisclosure/, "BatchReady no longer hand-wires the asset disclosure");
  assert.doesNotMatch(conversation, /<ContextUsageDisclosure/, "TaskConversation no longer hand-wires the usage disclosure");
});
