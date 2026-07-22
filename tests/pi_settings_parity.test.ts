import assert from "node:assert/strict";
import { assertCanonicalTeamProjectSettingsDocument } from "@linguist-agent/cat-runtime";
import {
  OFFICIAL_PI_SETTING_PATHS,
  PI_SETTING_DEFINITIONS,
  findProjectRawGlobalOnlySettings,
  validatePiSettingDefinitionValue,
} from "../packages/cat-server/src/piSettingsDefinitions.js";

assert.equal(OFFICIAL_PI_SETTING_PATHS.length, 55, "Pi 0.80.10 settings.md documents 55 setting fields");

const definitions = new Map(PI_SETTING_DEFINITIONS.map((definition) => [definition.path, definition]));

for (const path of OFFICIAL_PI_SETTING_PATHS) {
  assert.ok(definitions.has(path), `LA Pi settings catalog must include official setting ${path}`);
}

assert.equal(definitions.get("markdown.codeBlockIndent")?.defaultValue, "  ", "Pi official default is two spaces");
assert.equal(definitions.get("defaultProjectTrust")?.globalOnly, true, "defaultProjectTrust is global-only in official Pi docs");
assert.equal(definitions.get("httpProxy")?.globalOnly, true, "httpProxy is global-only in official Pi docs");
assert.deepEqual(definitions.get("defaultThinkingLevel")?.options, ["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
assert.equal(definitions.get("showCacheMissNotices")?.defaultValue, false);
assert.deepEqual(definitions.get("treeFilterMode")?.options, ["default", "no-tools", "user-only", "labeled-only", "all"]);
assert.deepEqual(definitions.get("transport")?.options, ["sse", "websocket", "websocket-cached", "auto"]);
assert.equal(definitions.get("externalEditor")?.type, "string");
assert.equal(definitions.get("outputPad")?.defaultValue, 1);
assert.equal(definitions.get("outputPad")?.maximum, 1);
assert.equal(definitions.get("npmCommand")?.itemType, "string");
assert.equal(definitions.get("enabledModels")?.itemType, "string");
assert.equal(definitions.get("extensions")?.itemType, "string");
assert.deepEqual(definitions.get("thinkingBudgets")?.objectFields?.map((field) => field.path), ["minimal", "low", "medium", "high"]);
assert.equal(definitions.get("editorPaddingX")?.maximum, 3);
assert.equal(definitions.get("autocompleteMaxVisible")?.minimum, 3);
validatePiSettingDefinitionValue(definitions.get("transport")!, "websocket-cached");
assert.throws(() => validatePiSettingDefinitionValue(definitions.get("transport")!, "long-poll"), /one of/);
validatePiSettingDefinitionValue(definitions.get("editorPaddingX")!, 3);
assert.throws(() => validatePiSettingDefinitionValue(definitions.get("editorPaddingX")!, 4), /<= 3/);
validatePiSettingDefinitionValue(definitions.get("outputPad")!, 0);
assert.throws(() => validatePiSettingDefinitionValue(definitions.get("outputPad")!, 2), /<= 1/);
validatePiSettingDefinitionValue(definitions.get("enabledModels")!, ["claude-*", "gpt-4o"]);
assert.throws(() => validatePiSettingDefinitionValue(definitions.get("enabledModels")!, ["claude-*", 4]), /only strings/);
validatePiSettingDefinitionValue(definitions.get("thinkingBudgets")!, { minimal: 1024, high: 32768, xhigh: 65536 });
assert.throws(() => validatePiSettingDefinitionValue(definitions.get("thinkingBudgets")!, { high: "32768" }), /thinkingBudgets.high must be number/);
assert.deepEqual(
  findProjectRawGlobalOnlySettings({ httpProxy: "http://127.0.0.1:7890", compaction: { reserveTokens: 4096 } }),
  ["httpProxy"],
  "project raw JSON validation must catch global-only fields before writing .pi/settings.json",
);
assert.throws(
  () => assertCanonicalTeamProjectSettingsDocument({
    subagents: { agentOverrides: { "la-team-translator": { disabled: true } } },
  }),
  /do not allow project Pi subagents settings or Agent overrides/,
  "raw project settings must not be able to rewrite a canonical Team profile",
);
assert.doesNotThrow(() => assertCanonicalTeamProjectSettingsDocument({ theme: "default", extensions: [] }));

console.log("pi_settings_parity tests passed");
