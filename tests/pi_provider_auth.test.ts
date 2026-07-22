import assert from "node:assert/strict";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { piProviderUsesOAuth } from "../packages/cat-server/src/pi_provider_auth.js";

const runtime = await ModelRuntime.create({
  allowModelNetwork: false,
  credentials: new InMemoryCredentialStore(),
  modelsPath: null,
});
const allModels = [...runtime.getModels()] as Array<{ provider?: string; id?: string; name?: string; reasoning?: boolean }>;
const modelKeys = new Set(allModels.map((model) => `${model.provider}/${model.id}`));
const openAiCodexModels = runtime.getModels("openai-codex");

assert.ok(openAiCodexModels.length > 0, "openai-codex models should exist in the pinned Pi catalog");
assert.ok(modelKeys.has("openai/gpt-5.5"), "Pi 0.80.10 OpenAI catalog should expose gpt-5.5");
assert.ok(modelKeys.has("openai-codex/gpt-5.5"), "Pi 0.80.10 OpenAI Codex catalog should expose gpt-5.5");
assert.ok(modelKeys.has("anthropic/claude-sonnet-5"), "Pi 0.80.10 Anthropic catalog should expose Claude Sonnet 5");
assert.ok(modelKeys.has("amazon-bedrock/anthropic.claude-sonnet-5"), "Pi 0.80.10 Bedrock catalog should expose Claude Sonnet 5");
assert.equal(allModels.find((model) => `${model.provider}/${model.id}` === "anthropic/claude-sonnet-5")?.reasoning, true);
assert.equal(piProviderUsesOAuth("openai-codex", runtime), true);
assert.equal(
  piProviderUsesOAuth(
    "api-key-provider",
    { getProvider: () => ({ auth: {} }), isUsingOAuth: () => false },
  ),
  false,
);
assert.equal(
  piProviderUsesOAuth(
    "stored-oauth",
    { getProvider: () => ({ auth: {} }), isUsingOAuth: () => true },
  ),
  true,
);

console.log("pi_provider_auth tests passed");
