import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("the 46px toolbar is the single draggable title bar with a tokenized traffic-light inset", async () => {
  const [stylesEntry, main, productCss, tokens] = await Promise.all([
    readFile(new URL("src/renderer/styles.css", root), "utf8"),
    readFile(new URL("src/renderer/main.tsx", root), "utf8"),
    readFile(new URL("src/renderer/shell/product-workspace.css", root), "utf8"),
    readFile(new URL("src/renderer/styles/tokens.css", root), "utf8"),
  ]);
  assert.doesNotMatch(main, /desktop-drag-region/, "the redundant 28px drag strip is removed from the app root");
  assert.doesNotMatch(stylesEntry, /\.desktop-drag-region/, "the 28px drag strip rule is deleted");
  assert.match(productCss, /\.product-toolbar\s*\{[\s\S]*?height:\s*var\(--la-height-toolbar\)/, "the title bar consumes the 46px toolbar token");
  assert.match(productCss, /\.product-toolbar\s*\{[\s\S]*?-webkit-app-region:\s*drag/, "the title bar itself is the drag region");
  assert.match(productCss, /\.product-toolbar :where\(button, summary, input\)\s*\{[\s\S]*?-webkit-app-region:\s*no-drag/, "interactive chrome stays no-drag");
  assert.match(tokens, /--la-safe-header-left:\s*78px/, "the traffic-light safe inset is a token");
  assert.match(productCss, /product-toolbar__show-sidebar\s*\{[\s\S]*?margin-left:\s*var\(--la-safe-header-left\)/, "the show-sidebar button clears the traffic lights via the token");
});

test("product-workspace.css has exactly one import site", async () => {
  const [stylesEntry, productWorkspace] = await Promise.all([
    readFile(new URL("src/renderer/styles.css", root), "utf8"),
    readFile(new URL("src/renderer/shell/ProductWorkspace.tsx", root), "utf8"),
  ]);
  assert.doesNotMatch(stylesEntry, /product-workspace\.css/, "the global stylesheet no longer double-imports the product workspace css");
  assert.match(productWorkspace, /import "\.\/product-workspace\.css"/, "the component keeps the single import");
});

test("the Workspace shell no longer carries a fallback toolbar", async () => {
  const [workspace, workspaceCss] = await Promise.all([
    readFile(new URL("src/renderer/workspace/Workspace.tsx", root), "utf8"),
    readFile(new URL("src/renderer/workspace/workspace.css", root), "utf8"),
  ]);
  assert.doesNotMatch(workspace, /workspace-toolbar/, "the duplicate fallback toolbar markup is removed");
  assert.doesNotMatch(workspaceCss, /\.workspace-toolbar/, "the fallback toolbar styles are removed");
  assert.match(workspace, /renderToolbar: \(input: WorkspaceToolbarInput\) => ReactNode/, "the toolbar renderer is a required shell input");
});
