import assert from "node:assert/strict";
import {
  addPiMessageUsageTotals,
  emptySessionUsageTotals,
  sessionCacheHitRatePercent,
} from "../packages/cat-server/src/session_stats.js";

let totals = emptySessionUsageTotals();
totals = addPiMessageUsageTotals(totals, { input: 100, cacheRead: 900, cacheWrite: 0 });
totals = addPiMessageUsageTotals(totals, { input: 50, cacheRead: 450, cacheWrite: 100 });

assert.deepEqual(totals, {
  inputTokens: 150,
  cacheReadTokens: 1350,
  cacheWriteTokens: 100,
});
assert.equal(sessionCacheHitRatePercent(totals), 84);

const withInvalidValues = addPiMessageUsageTotals(totals, {
  input: -1,
  cacheRead: "not-a-number",
  cacheWrite: 0,
});

assert.deepEqual(withInvalidValues, totals);
assert.equal(sessionCacheHitRatePercent(emptySessionUsageTotals()), undefined);

console.log("session_stats tests passed");
