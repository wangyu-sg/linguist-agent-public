import assert from "node:assert/strict";
import { normalizePiRuntimeModel } from "@linguist-agent/cat-runtime";

const opencodeGoModel = normalizePiRuntimeModel({
  provider: "opencode-go",
  id: "glm-5.2",
  name: "GLM 5.2",
  api: "openai-completions",
  baseUrl: "https://opencode.ai/zen/go/v1",
  contextWindow: 200_000,
  compat: {
    supportsDeveloperRole: false,
  },
});

assert.equal(
  opencodeGoModel.compat.supportsLongCacheRetention,
  false,
  "OpenCode Go completion models must not receive Pi long-cache prompt_cache_retention",
);
assert.equal(
  opencodeGoModel.compat.supportsDeveloperRole,
  false,
  "provider compatibility normalization must preserve existing compat fields",
);

const regularOpenAIModel = normalizePiRuntimeModel({
  provider: "openai",
  id: "gpt-5.5",
  name: "GPT 5.5",
  api: "responses",
  contextWindow: 400_000,
  compat: {
    supportsLongCacheRetention: true,
  },
});

assert.equal(
  regularOpenAIModel.compat.supportsLongCacheRetention,
  true,
  "non-OpenCode providers keep their declared cache-retention capability",
);

const opencodeBaseUrlModel = normalizePiRuntimeModel({
  provider: "custom-provider",
  id: "glm-5.2",
  name: "GLM 5.2",
  api: "openai-completions",
  baseUrl: "https://api.opencode.ai/zen/go/v1",
  contextWindow: 200_000,
  compat: {},
});

assert.equal(
  opencodeBaseUrlModel.compat.supportsLongCacheRetention,
  false,
  "OpenCode-compatible base URLs should also suppress unsupported long-cache parameters",
);

console.log("pi_model_compat tests passed");
