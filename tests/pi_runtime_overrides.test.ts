import assert from "node:assert/strict";
import { buildSharedPiRuntimeOverrides } from "@linguist-agent/cat-runtime";

assert.deepEqual(
  buildSharedPiRuntimeOverrides({}),
  {},
  "LA must not apply compaction/retry fallback overrides when the user did not set LA_PI_* env vars",
);

assert.deepEqual(
  buildSharedPiRuntimeOverrides({
    LA_PI_COMPACT_RESERVE_TOKENS: "4096",
    LA_PI_COMPACT_KEEP_RECENT_TOKENS: "8192",
    LA_PI_RETRY_MAX_RETRIES: "5",
    LA_PI_RETRY_BASE_DELAY_MS: "2500",
    LA_PI_PROVIDER_MAX_RETRIES: "2",
    LA_PI_PROVIDER_MAX_RETRY_DELAY_MS: "120000",
  }),
  {
    compaction: {
      reserveTokens: 4096,
      keepRecentTokens: 8192,
    },
    retry: {
      maxRetries: 5,
      baseDelayMs: 2500,
      provider: {
        maxRetries: 2,
        maxRetryDelayMs: 120000,
      },
    },
  },
);

assert.throws(
  () => buildSharedPiRuntimeOverrides({ LA_PI_RETRY_MAX_RETRIES: "not-a-number" }),
  /LA_PI_RETRY_MAX_RETRIES/,
  "invalid explicit env overrides must fail visibly",
);

console.log("pi_runtime_overrides tests passed");
