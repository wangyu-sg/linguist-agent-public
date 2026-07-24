import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("the sidebar consumes the shared width token and the spec footer height", async () => {
  const workspaceCss = await readFile(new URL("src/renderer/workspace/workspace.css", root), "utf8");
  assert.match(workspaceCss, /--workspace-sidebar-width:\s*var\(--la-sidebar-width\)/, "sidebar width is the shared clamp token");
  assert.match(
    workspaceCss,
    /\.workspace-sidebar-footer\s*\{[\s\S]*?min-height:\s*72px/,
    "sidebar footer keeps the 72px spec height",
  );
  assert.match(workspaceCss, /\.workspace-sidebar\s*\{[\s\S]*?transform:\s*translateX\(-8px\)/, "collapsed sidebar keeps the spec entrance offset");
});

test("the command palette follows the cmdk dialog anatomy", async () => {
  const paletteCss = await readFile(new URL("src/renderer/command/command-palette.css", root), "utf8");
  assert.match(paletteCss, /width:\s*min\(520px, 92vw\)/, "dialog width caps at the cmdk 520px");
  assert.match(paletteCss, /border-radius:\s*var\(--la-radius-takeover\)/, "dialog uses the 16px-base radius");
  assert.match(paletteCss, /max-height:\s*min\(440px, calc\(90vh - 64px\)\)/, "global command list caps at 440px with viewport headroom");
  assert.match(paletteCss, /\.command-palette__group-heading\s*\{/, "group headings have a dedicated style");
});

test("palette results render as typed groups with stable flat indices", async () => {
  const [palette, model] = await Promise.all([
    readFile(new URL("src/renderer/command/CommandPalette.tsx", root), "utf8"),
    readFile(new URL("src/renderer/command/command-model.ts", root), "utf8"),
  ]);
  assert.match(model, /export function groupCommandResults/, "the grouping helper lives in the command model");
  assert.match(palette, /groupCommandResults\(results\)/, "the palette groups its results");
  assert.match(palette, /className="command-palette__group-heading"/, "each group renders a heading");
  assert.match(palette, /id=\{`command-result-\$\{item\.index\}`\}/, "option ids keep the flat result index for aria-activedescendant");
  assert.match(palette, /aria-activedescendant=\{activeResult \? `command-result-\$\{resolvedActiveIndex\}` : undefined\}/, "active descendant still targets the flat index");
});
