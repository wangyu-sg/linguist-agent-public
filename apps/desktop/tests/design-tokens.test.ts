import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("dark theme declarations have a single source resolved by theme-choice", async () => {
  const [tokens, themeChoice] = await Promise.all([
    readFile(new URL("src/renderer/styles/tokens.css", root), "utf8"),
    readFile(new URL("src/renderer/theme-choice.ts", root), "utf8"),
  ]);
  const darkBlocks = tokens.match(/:root\[data-theme="dark"\]/g) ?? [];
  assert.equal(darkBlocks.length, 1, "exactly one :root[data-theme=\"dark\"] block owns the dark theme");
  assert.doesNotMatch(tokens, /@media \(prefers-color-scheme: dark\)/, "no second dark declaration lives in a media-query fallback");
  assert.match(themeChoice, /matchMedia\?\.\("\(prefers-color-scheme: dark\)"\)/, "theme-choice resolves the system appearance");
  assert.match(themeChoice, /addEventListener\("change"/, "theme-choice follows OS theme changes while the choice is system");
  assert.match(themeChoice, /dataset\.theme = resolved/, "the resolved theme, not an absent attribute, drives the single dark source");
});

test("the superellipse radius engine scales radii only on supporting engines", async () => {
  const tokens = await readFile(new URL("src/renderer/styles/tokens.css", root), "utf8");
  assert.match(tokens, /--la-corner-radius-scale:\s*1;/, "the radius scale defaults to 1");
  assert.match(
    tokens,
    /@supports \(corner-shape: superellipse\(1\.5\)\)[\s\S]*?--la-corner-radius-scale:\s*1\.25/,
    "supporting engines adopt the 1.25 radius scale",
  );
  assert.match(
    tokens,
    /@supports \(corner-shape: superellipse\(1\.5\)\)[\s\S]*?--la-corner-shape:\s*superellipse\(1\.5\)/,
    "supporting engines adopt the superellipse corner shape",
  );
  assert.match(tokens, /--la-radius-control:\s*calc\(8px \* var\(--la-corner-radius-scale\)\)/);
  assert.match(tokens, /--la-radius-surface:\s*calc\(12px \* var\(--la-corner-radius-scale\)\)/);
  assert.match(tokens, /--la-radius-takeover:\s*calc\(16px \* var\(--la-corner-radius-scale\)\)/);
  assert.match(tokens, /--la-radius-pill:\s*9999px/);
});

test("semantic button four-state fills exist for primary, secondary, and tertiary", async () => {
  const tokens = await readFile(new URL("src/renderer/styles/tokens.css", root), "utf8");
  for (const kind of ["primary", "secondary", "tertiary"]) {
    for (const state of ["bg", "bg-hover", "bg-active", "bg-inactive"]) {
      assert.match(tokens, new RegExp(`--la-button-${kind}-${state}:`), `missing --la-button-${kind}-${state}`);
    }
  }
  assert.match(tokens, /--la-button-primary-text:/);
  const dark = tokens.slice(tokens.indexOf(':root[data-theme="dark"]'));
  assert.match(dark, /--la-button-primary-text:\s*#0d0d0d/, "dark primary buttons keep near-black text on the light ink fill");
});

test("spec elevations, icon scale, shell metrics, and z tiers are tokenized", async () => {
  const tokens = await readFile(new URL("src/renderer/styles/tokens.css", root), "utf8");
  assert.match(tokens, /--la-elevation-stroke:\s*0 0 0 0\.5px/);
  assert.match(tokens, /--la-elevation-prominent:/);
  assert.match(tokens, /--la-elevation-sidebar:/);
  assert.match(tokens, /--la-icon-2xs:\s*14px/);
  assert.match(tokens, /--la-icon-xs:\s*16px/);
  assert.match(tokens, /--la-icon-sm:\s*18px/);
  assert.match(tokens, /--la-icon-md:\s*24px/);
  assert.match(tokens, /--la-icon-lg:\s*28px/);
  assert.match(tokens, /--la-height-toolbar:\s*46px/);
  assert.match(tokens, /--la-height-toolbar-sm:\s*36px/);
  assert.match(tokens, /--la-height-toolbar-pane:\s*40px/);
  assert.match(tokens, /--la-sidebar-width:\s*clamp\(240px, 275px, min\(520px, calc\(100vw - 320px\)\)\)/);
  assert.match(tokens, /--la-height-nav-row:\s*29px/);
  assert.match(tokens, /--la-height-settings-row:\s*64px/);
  assert.match(tokens, /--la-composer-button-size:\s*28px/);
  assert.match(tokens, /--la-radius-composer-single-line:\s*22px/);
  assert.match(tokens, /--la-container-2xl:\s*42rem/);
  assert.match(tokens, /--la-container-3xl:\s*48rem/);
  assert.match(tokens, /--la-z-menu:\s*70/);
  assert.match(tokens, /--la-z-overlay-max:\s*2147480000/);
});

test("existing canonical tokens stay intact after the token-layer completion", async () => {
  const tokens = await readFile(new URL("src/renderer/styles/tokens.css", root), "utf8");
  assert.match(tokens, /--la-focus-ring:\s*#339cff/);
  assert.match(tokens, /--la-shimmer-base:/);
  assert.match(tokens, /--la-shimmer-contrast:/);
  assert.match(tokens, /--la-scrim:/);
  assert.match(tokens, /--la-ease-spring:\s*cubic-bezier\(0\.23, 1, 0\.32, 1\)/);
  assert.doesNotMatch(
    tokens,
    /--la-(surface-canvas|surface-subtle|surface-sidebar|surface-selected|text-primary|text-secondary|text-disabled|action-primary|information):/,
    "retired alias definitions stay deleted",
  );
});
