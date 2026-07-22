import assert from "node:assert/strict";
import {
  compactSessionTitle,
  generateAgentTitle,
  sanitizeGeneratedSessionTitle,
} from "../packages/cat-server/src/session_titles.js";

assert.equal(
  sanitizeGeneratedSessionTitle("标题：\"修复 Agent Rail 卡死。\"", "fallback"),
  "修复 Agent Rail 卡死",
);

assert.equal(
  compactSessionTitle("Review the complete imported batch without dropping any rows.", "Task"),
  "Review the complete imported batch without dropping any rows.",
);

let generatedCalls = 0;
const generated = await generateAgentTitle({
  projectId: "synthetic-rpg",
  userMessage: "接手这个项目，把剩余句段做完",
  assistantText: "The task was created and scoped.",
  generateTitle: async () => {
    generatedCalls += 1;
    return {
      text: "接手续翻译提案",
      usage: {
        inputTokens: 100,
        outputTokens: 8,
        cacheReadTokens: 20,
        cacheWriteTokens: 0,
        totalTokens: 128,
        costUSD: 0.0012,
        modelCalls: 1,
      },
    };
  },
});
assert.equal(generatedCalls, 1);
assert.deepEqual(generated, {
  title: "接手续翻译提案",
  usage: {
    inputTokens: 100,
    outputTokens: 8,
    cacheReadTokens: 20,
    cacheWriteTokens: 0,
    totalTokens: 128,
    costUSD: 0.0012,
    modelCalls: 1,
  },
});

console.log("session_titles tests passed");
