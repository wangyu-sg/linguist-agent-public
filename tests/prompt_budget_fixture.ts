import { ModelContextRegistry, type PromptRequestBudget } from "@linguist-agent/cat-data";

/** Explicit, synthetic model metadata for tests that start a new Run. */
export function verifiedPromptRequestBudget(provider = "fixture", modelId = "verified"): PromptRequestBudget {
  return {
    registry: new ModelContextRegistry([{ provider, modelId, contextWindow: 200_000, outputReserveTokens: 64_000 }]),
    provider,
    modelId,
    toolSchemaTokens: 0,
    historyTokens: 0,
    providerFramingTokens: 8,
    safetyMarginTokens: 0,
    compactionReserveTokens: 0,
  };
}
