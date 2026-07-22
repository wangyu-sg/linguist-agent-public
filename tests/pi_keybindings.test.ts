import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PI_KEYBINDING_ACTIONS,
  buildPiKeybindingsCatalog,
  normalizePiKeybindingKeys,
  upsertPiKeybindingAction,
} from "../packages/cat-server/src/pi_keybindings.js";

const piDocs = readFileSync("node_modules/@earendil-works/pi-coding-agent/docs/keybindings.md", "utf8");
const documentedIds = Array.from(new Set([...piDocs.matchAll(/^\| `([^`]+)` \|/gm)].map((match) => match[1])));
assert.deepEqual(PI_KEYBINDING_ACTIONS.map((action) => action.id), documentedIds);

assert.deepEqual(normalizePiKeybindingKeys(["alt+ctrl+x", "ctrl+alt+x", ",", "pageup"]), ["ctrl+alt+x", ",", "pageUp"]);
assert.deepEqual(normalizePiKeybindingKeys("ctrl++"), ["ctrl++"]);
assert.throws(() => normalizePiKeybindingKeys("cmd+x"), /Unsupported Pi keybinding modifier/);

let raw: Record<string, unknown> = {};
raw = upsertPiKeybindingAction(raw, { id: "tui.editor.cursorUp", keys: ["up", "ctrl+p"] });
raw = upsertPiKeybindingAction(raw, { id: "extension.customAction", keys: "ctrl+x" });
assert.deepEqual(raw["tui.editor.cursorUp"], ["up", "ctrl+p"]);
assert.equal(raw["extension.customAction"], "ctrl+x");

const catalog = buildPiKeybindingsCatalog({
  keybindingsPath: "/Users/me/.pi/agent/keybindings.json",
  keybindings: raw,
});
assert.equal(catalog.path, "/Users/me/.pi/agent/keybindings.json");
assert.equal(catalog.actions.length, documentedIds.length + 1);
assert.equal(catalog.sections.at(-1)?.label, "Custom / Extension Actions");
assert.deepEqual(catalog.actions.find((action) => action.id === "tui.editor.cursorUp")?.effectiveKeys, ["up", "ctrl+p"]);
assert.ok(catalog.conflicts.some((conflict) => conflict.key === "ctrl+p" && conflict.actionIds.includes("tui.editor.cursorUp")));

raw = upsertPiKeybindingAction(raw, { id: "tui.editor.cursorUp", unset: true });
assert.equal(raw["tui.editor.cursorUp"], undefined);
assert.equal(raw["extension.customAction"], "ctrl+x");

console.log("pi_keybindings tests passed");
