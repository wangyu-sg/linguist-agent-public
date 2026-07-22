import assert from "node:assert/strict";
import { mergeCustomModelConfig, mergeCustomModelProviderConfig } from "../packages/cat-server/src/customModelsDocument.js";

const provider = mergeCustomModelProviderConfig(
  {
    baseUrl: "https://old.example/v1",
    headers: { "x-existing": "$EXISTING" },
    compat: { supportsDeveloperRole: false },
    unknownProviderField: "keep-me",
    models: [{ id: "model-a", unknownModelField: true }],
  },
  {
    providerId: "proxy",
    baseUrl: "https://new.example/v1",
    headers: { "x-new": "$NEW" },
    modelOverrides: {
      "builtin-model": {
        headers: { "x-model": "$MODEL" },
        compat: { supportsReasoningEffort: false },
      },
    },
    compat: { supportsReasoningEffort: false },
  },
);

assert.equal(provider.baseUrl, "https://new.example/v1");
assert.deepEqual(provider.headers, { "x-new": "$NEW" });
assert.deepEqual(provider.modelOverrides, {
  "builtin-model": {
    headers: { "x-model": "$MODEL" },
    compat: { supportsReasoningEffort: false },
  },
});
assert.deepEqual(provider.compat, { supportsReasoningEffort: false });
assert.equal(provider.unknownProviderField, "keep-me");
assert.deepEqual(provider.models, [{ id: "model-a", unknownModelField: true }]);

const providerUnset = mergeCustomModelProviderConfig(
  {
    baseUrl: "https://old.example/v1",
    api: "openai-completions",
    authHeader: true,
    headers: { "x-existing": "$EXISTING" },
    modelOverrides: { "builtin-model": { name: "Routed" } },
    compat: { supportsDeveloperRole: false },
    unknownProviderField: "keep-me",
    models: [{ id: "model-a", unknownModelField: true }],
  },
  { providerId: "proxy", unset: ["headers", "modelOverrides", "compat"] },
);

assert.equal("headers" in providerUnset, false);
assert.equal("modelOverrides" in providerUnset, false);
assert.equal("compat" in providerUnset, false);
assert.equal(providerUnset.baseUrl, "https://old.example/v1");
assert.equal(providerUnset.api, "openai-completions");
assert.equal(providerUnset.authHeader, true);
assert.equal(providerUnset.unknownProviderField, "keep-me");
assert.deepEqual(providerUnset.models, [{ id: "model-a", unknownModelField: true }]);

assert.throws(
  () => mergeCustomModelProviderConfig({}, { providerId: "proxy", unset: ["models"] }),
  /Unsupported custom provider unset field 'models'/,
);

const model = mergeCustomModelConfig(
  { id: "model-a", unknownModelField: true, headers: { "x-old": "$OLD" } },
  {
    id: "model-a",
    thinkingLevelMap: { off: null, high: "high" },
    cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0 },
    headers: { "x-new": "$NEW" },
    compat: { maxTokensField: "max_tokens" },
  },
);

assert.equal(model.id, "model-a");
assert.deepEqual(model.thinkingLevelMap, { off: null, high: "high" });
assert.deepEqual(model.cost, { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0 });
assert.deepEqual(model.headers, { "x-new": "$NEW" });
assert.deepEqual(model.compat, { maxTokensField: "max_tokens" });
assert.equal(model.unknownModelField, true);

const modelUnset = mergeCustomModelConfig(
  {
    id: "model-a",
    name: "Old Name",
    api: "openai-completions",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 128000,
    maxTokens: 8192,
    thinkingLevelMap: { high: "high" },
    cost: { input: 0.1, output: 0.2 },
    headers: { "x-old": "$OLD" },
    compat: { supportsReasoningEffort: false },
    unknownModelField: true,
  },
  { id: "model-a", unset: ["cost", "thinkingLevelMap", "headers", "compat"] },
);

assert.equal("cost" in modelUnset, false);
assert.equal("thinkingLevelMap" in modelUnset, false);
assert.equal("headers" in modelUnset, false);
assert.equal("compat" in modelUnset, false);
assert.equal(modelUnset.name, "Old Name");
assert.equal(modelUnset.api, "openai-completions");
assert.equal(modelUnset.reasoning, true);
assert.deepEqual(modelUnset.input, ["text", "image"]);
assert.equal(modelUnset.contextWindow, 128000);
assert.equal(modelUnset.maxTokens, 8192);
assert.equal(modelUnset.unknownModelField, true);

assert.throws(
  () => mergeCustomModelConfig({ id: "model-a" }, { id: "model-a", unset: ["id"] }),
  /Unsupported custom model unset field 'id'/,
);

console.log("custom_models_document tests passed");
