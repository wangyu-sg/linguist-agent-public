import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import {
  PI_THEME_REQUIRED_COLOR_TOKENS,
  buildPiThemesCatalog,
  preparePiThemeDocument,
  writePiThemeFile,
} from "../packages/cat-server/src/pi_themes.js";

const piDocs = readFileSync("node_modules/@earendil-works/pi-coding-agent/docs/themes.md", "utf8");
const tokenBlock = piDocs.slice(piDocs.indexOf("### Core UI"), piDocs.indexOf("### HTML Export"));
const documentedTokens = Array.from(new Set([...tokenBlock.matchAll(/^\| `([^`]+)` \|/gm)].map((match) => match[1])));
assert.equal(documentedTokens.length, 52);
assert.match(piDocs, /`thinkingMax` is optional/);
assert.deepEqual(PI_THEME_REQUIRED_COLOR_TOKENS, documentedTokens.filter((token) => token !== "thinkingMax"));

function completeTheme(name: string) {
  return {
    "$schema": "https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/src/modes/interactive/theme/theme-schema.json",
    name,
    vars: { primary: "#00aaff", secondary: 242 },
    colors: Object.fromEntries(PI_THEME_REQUIRED_COLOR_TOKENS.map((token) => [token, token === "text" ? "" : "primary"])),
    export: { pageBg: "#101010" },
  };
}

const prepared = preparePiThemeDocument({ scope: "global", theme: completeTheme("la-test") });
assert.equal(prepared.name, "la-test");
assert.equal(Object.keys(prepared.document.colors as Record<string, unknown>).length, 51);
assert.throws(() => preparePiThemeDocument({ scope: "global", theme: { name: "bad/theme", colors: {} } }), /must not contain/);
assert.throws(() => preparePiThemeDocument({ scope: "global", theme: { name: "missing", colors: {} } }), /missing color tokens/);

const root = await mkdtemp(join(tmpdir(), "la-pi-themes-"));
try {
  const globalDir = join(root, "global-themes");
  const projectDir = join(root, "project", ".pi", "themes");
  const extraDir = join(root, "extra");
  await writePiThemeFile({ scope: "global", theme: completeTheme("global-blue"), paths: { globalDir, projectDir } });
  await writePiThemeFile({ scope: "project", theme: completeTheme("project-green"), paths: { globalDir, projectDir } });
  await writePiThemeFile({ scope: "global", theme: completeTheme("extra-gold"), paths: { globalDir: extraDir, projectDir } });

  const catalog = await buildPiThemesCatalog({
    globalSettings: { theme: "global-blue", themes: [extraDir] },
    projectSettings: { theme: "project-green" },
    paths: {
      globalDir,
      projectDir,
      globalSettings: join(root, "settings.json"),
      projectSettings: join(root, "project", ".pi", "settings.json"),
    },
    homeDir: root,
    repoRoot: join(root, "project"),
  });
  assert.equal(catalog.selected.effective, "project-green");
  assert.equal(catalog.selected.source, "project");
  assert.ok(catalog.themes.some((theme) => theme.name === "dark" && theme.scope === "built-in"));
  assert.ok(catalog.themes.some((theme) => theme.name === "global-blue" && theme.scope === "global"));
  assert.ok(catalog.themes.some((theme) => theme.name === "project-green" && theme.selected));
  assert.ok(catalog.themes.some((theme) => theme.name === "extra-gold" && theme.scope === "settings"));
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("pi_themes tests passed");
