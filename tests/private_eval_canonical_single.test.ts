import assert from "node:assert/strict";
import { runPrivateEvalCanonicalSingle } from "../packages/cat-server/src/private_eval_canonical_single.js";

let calls = 0;
let capturedPrompt = "";
let capturedRunOptions: Record<string, unknown> = {};
let capturedTimeoutMs: number | undefined;
const outputs = await runPrivateEvalCanonicalSingle({
  projectId: "project-1",
  parentRunId: "eval-run-1",
  evalSetId: "eval-set-1",
  sourceLocale: "zh-CN",
  targetLocale: "en-US",
  modelProvider: "opencode-go",
  modelId: "deepseek-v4-flash",
  thinkingLevel: "medium",
  segments: [
    { segmentId: "原始段-一", source: "打开 {0} 个宝箱", tags: ["{0}"], riskTypes: ["placeholder"], tmRefs: [], termRefs: [] },
    { segmentId: "原始段-二", source: "继续", tags: [], riskTypes: ["ui"], tmRefs: ["Continue"], termRefs: [] },
  ],
  generate: async (input) => {
    calls += 1;
    capturedPrompt = input.prompt;
    capturedRunOptions = input.runOptions as unknown as Record<string, unknown>;
    capturedTimeoutMs = input.timeoutMs;
    return {
      text: [
        "A partial object {not valid} may precede the final answer.",
        "```json",
        JSON.stringify({ candidates: [
          { segmentId: "eval-0001", target: "Open {0} treasure chests", notes: "Keep placeholder." },
          { segmentId: "eval-0002", target: "Continue" },
        ] }),
        "```",
      ].join("\n"),
      usage: { inputTokens: 50, cacheReadTokens: 100, outputTokens: 20, totalTokens: 70, costUsd: 0.001, modelCalls: 1 },
    };
  },
});

assert.equal(calls, 1, "the canonical Single adapter must translate one batch in one provider call");
assert.deepEqual([...outputs.keys()], ["原始段-一", "原始段-二"]);
assert.equal(outputs.get("原始段-一")?.target, "Open {0} treasure chests");
assert.equal(outputs.get("原始段-二")?.target, "Continue");
assert.equal(outputs.get("原始段-一")?.usage?.modelCalls, 1);
assert.equal(outputs.get("原始段-二")?.usage, undefined, "aggregate usage must be persisted once, not once per output");
assert.equal(outputs.get("原始段-一")?.executionManifest?.adapter, "canonical_single_batch");
assert.equal(outputs.get("原始段-一")?.executionManifest?.segmentIdMode, "eval_alias_v1");
assert.equal(outputs.get("原始段-一")?.executionManifest?.referenceIncluded, false);
assert.equal(outputs.get("原始段-一")?.executionManifest?.writeMode, "none");
assert.equal(outputs.get("原始段-一")?.promptManifest?.estimateScope, "compiled_business_prompt");
assert.equal(capturedRunOptions.noTools, "all");
assert.equal(capturedRunOptions.noSession, true);
assert.equal(capturedTimeoutMs, 180_000, "small batches keep the measured three-minute watchdog");
assert.match(capturedPrompt, /eval-0001/);
assert.doesNotMatch(capturedPrompt, /原始段-一/, "provider packet must use deterministic ASCII aliases");
assert.match(capturedPrompt, /Reference\/reviewed\/customer-return targets are unavailable/);

await assert.rejects(runPrivateEvalCanonicalSingle({
  projectId: "project-1",
  parentRunId: "eval-run-bad",
  evalSetId: "eval-set-1",
  sourceLocale: "zh-CN",
  targetLocale: "en-US",
  thinkingLevel: "medium",
  segments: [
    { segmentId: "one", source: "一", tags: [], riskTypes: [], tmRefs: [], termRefs: [] },
    { segmentId: "two", source: "二", tags: [], riskTypes: [], tmRefs: [], termRefs: [] },
  ],
  generate: async () => ({
    text: JSON.stringify({ candidates: [{ segmentId: "eval-0001", target: "One" }] }),
  }),
}), /coverage mismatch: missing=eval-0002/);

console.log("canonical private Eval Single tests passed");
