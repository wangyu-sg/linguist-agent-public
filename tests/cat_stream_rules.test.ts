import assert from "node:assert/strict";
import { buildCatStreamRetryInstruction, createCatStreamRuleMonitor, shouldAbortForCatStreamViolation } from "@linguist-agent/cat-runtime";

const monitor = createCatStreamRuleMonitor({
  targetLocale: "en-US",
  forbiddenTerms: ["WrongTerm"],
});

assert.deepEqual(monitor.observeDelta("Assassin"), []);

const punct = monitor.observeDelta("，Gem");
assert.equal(punct.length, 1);
assert.equal(punct[0].code, "cjk_punctuation");
assert.equal(punct[0].severity, "warning");
assert.equal(punct[0].action, "observe_only");

assert.deepEqual(monitor.observeDelta(" plus "), []);

const placeholder = monitor.observeDelta("{1}");
assert.equal(placeholder.length, 1);
assert.equal(placeholder[0].code, "raw_placeholder");
assert.equal(placeholder[0].match, "{1}");

const forbidden = monitor.observeDelta(" WrongTerm");
assert.equal(forbidden.length, 1);
assert.equal(forbidden[0].code, "forbidden_term");
assert.equal(forbidden[0].severity, "blocker");
assert.equal(forbidden[0].action, "abort_and_retry");
assert.equal(shouldAbortForCatStreamViolation(forbidden[0]), true);
assert.match(buildCatStreamRetryInstruction(forbidden[0]).correctiveInstruction, /WrongTerm/);

assert.equal(monitor.observeDelta(" WrongTerm").length, 0, "duplicate matches should not re-emit");
assert.match(monitor.currentText(), /Assassin，Gem plus \{1\} WrongTerm/);

const zhTarget = createCatStreamRuleMonitor({ targetLocale: "zh-CN" });
assert.deepEqual(zhTarget.observeDelta("可以使用中文标点。"), [], "CJK punctuation is allowed for non-English targets");

const required = createCatStreamRuleMonitor({ sourceText: "{u}暗影徽记{u}", targetLocale: "en-US" });
required.observeDelta("Shadow Emblem");
const missing = required.finalize();
assert.equal(missing.length, 1);
assert.equal(missing[0].code, "missing_required_fragment");
assert.equal(missing[0].severity, "warning");
assert.equal(missing[0].action, "observe_only");
assert.equal(missing[0].match, "{u}");
assert.equal(shouldAbortForCatStreamViolation(missing[0]), false);
assert.match(buildCatStreamRetryInstruction(missing[0]).reason, /\{u\}/);
assert.equal(required.finalize().length, 0, "finalize should not re-emit missing fragments");

const present = createCatStreamRuleMonitor({ requiredFragments: ["<ph/>"], targetLocale: "en-US" });
present.observeDelta("Use <ph/> here.");
assert.deepEqual(present.finalize(), []);

const ordinaryConversation = createCatStreamRuleMonitor();
assert.deepEqual(
  ordinaryConversation.observeDelta("我会检查 {1} 和中文标点。"),
  [],
  "ordinary chat must not be misclassified as an English CAT target",
);

console.log("cat_stream_rules tests passed");
