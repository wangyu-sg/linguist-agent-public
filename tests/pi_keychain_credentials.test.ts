import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Credential } from "@earendil-works/pi-ai";
import {
  ambientCredentialStatusForProvider,
  apiKeyEnvVarsForProvider,
  buildKeychainCredentialCommand,
  keychainGenericPasswordWriteArgs,
  keychainServiceForProvider,
  removePiProviderKeychainCredential,
  savePiProviderKeychainCredential,
  sanitizeKeychainProviderId,
  testPiProviderKeychainCredential,
  updatePiProviderScopedEnvCredential,
} from "../packages/cat-server/src/keychain_credentials.js";
import { PiAuthCredentialStore } from "../packages/cat-server/src/pi_model_runtime.js";

assert.equal(sanitizeKeychainProviderId("deepseek"), "deepseek");
assert.equal(sanitizeKeychainProviderId("tavily-search"), "tavily-search");
assert.equal(sanitizeKeychainProviderId("OpenRouter Pro"), "openrouter-pro");
assert.equal(sanitizeKeychainProviderId("weird/../../provider"), "weird-provider");
assert.throws(() => sanitizeKeychainProviderId("___"), /provider id/i);

assert.equal(keychainServiceForProvider("deepseek"), "com.linguist-agent.pi.deepseek");
assert.equal(keychainServiceForProvider("Tavily Search"), "com.linguist-agent.pi.tavily-search");
assert.deepEqual(apiKeyEnvVarsForProvider("Cloudflare AI Gateway"), ["CLOUDFLARE_API_KEY"]);
assert.deepEqual(apiKeyEnvVarsForProvider("amazon-bedrock"), []);
assert.deepEqual(apiKeyEnvVarsForProvider("tavily-search"), []);

const vertexAmbient = ambientCredentialStatusForProvider(
  "google-vertex",
  {
    GOOGLE_APPLICATION_CREDENTIALS: "/tmp/pi-adc.json",
    GOOGLE_CLOUD_PROJECT: "project-id",
    GOOGLE_CLOUD_LOCATION: "us-central1",
  },
  (path) => path === "/tmp/pi-adc.json",
);
assert.equal(vertexAmbient?.configured, true);
assert.equal(vertexAmbient?.checks.find((check) => check.id === "vertex-adc")?.configured, true);
assert.equal(vertexAmbient?.checks.find((check) => check.id === "vertex-api-key")?.secret, true);
const vertexAdcChecks: string[] = [];
const missingExplicitVertexAmbient = ambientCredentialStatusForProvider(
  "google-vertex",
  {
    GOOGLE_APPLICATION_CREDENTIALS: "/tmp/missing-adc.json",
    GOOGLE_CLOUD_PROJECT: "project-id",
    GOOGLE_CLOUD_LOCATION: "us-central1",
  },
  (path) => {
    vertexAdcChecks.push(path);
    return path.includes("application_default_credentials.json");
  },
);
assert.equal(missingExplicitVertexAmbient?.configured, false);
assert.deepEqual(vertexAdcChecks, ["/tmp/missing-adc.json"]);

const bedrockAmbient = ambientCredentialStatusForProvider("amazon-bedrock", { AWS_PROFILE: "production" });
assert.equal(bedrockAmbient?.configured, true);
assert.equal(bedrockAmbient?.checks.find((check) => check.id === "bedrock-profile")?.configured, true);
assert.equal(bedrockAmbient?.checks.find((check) => check.id === "bedrock-iam")?.secret, true);
assert.equal(ambientCredentialStatusForProvider("tavily-search"), undefined);

const command = buildKeychainCredentialCommand({
  account: "translator",
  service: "com.linguist-agent.pi.deepseek",
});
assert.equal(
  command,
  "!security find-generic-password -a 'translator' -s 'com.linguist-agent.pi.deepseek' -w",
);
assert.equal(command.includes("sk-"), false);
assert.equal(command.includes("DEEPSEEK_API_KEY"), false);

assert.deepEqual(
  keychainGenericPasswordWriteArgs({
    account: "translator",
    service: "com.linguist-agent.local-transport",
    password: "test-local-token",
    trustedApplicationPaths: ["/usr/bin/security"],
  }),
  [
    "add-generic-password", "-U", "-a", "translator",
    "-s", "com.linguist-agent.local-transport",
    "-T", "/usr/bin/security",
    "-w", "test-local-token",
  ],
);

const stored = new Map<string, Credential>();
const fakeCredentialStore = {
  async read(provider: string) {
    const credential = stored.get(provider);
    return credential?.type === "api_key" && credential.key?.startsWith("!")
      ? { ...credential, key: "resolved-key" }
      : credential;
  },
  async modify(provider: string, update: (current: Credential | undefined) => Promise<Credential | undefined>) {
    const next = await update(stored.get(provider));
    if (next !== undefined) stored.set(provider, next);
    return next ?? stored.get(provider);
  },
  async delete(provider: string) {
    stored.delete(provider);
  },
};
let refreshCalls = 0;
const fakeModelRuntime = {
  async refresh() {
    refreshCalls += 1;
    return { aborted: false, errors: new Map() };
  },
};
const keychainWrites: Array<{ service: string; password: string }> = [];

const saved = await savePiProviderKeychainCredential({
  provider: "OpenRouter Pro",
  apiKey: "unit-test-secret",
  env: {
    OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
    OPENROUTER_API_KEY: "must-not-be-stored",
    EMPTY_VALUE: "",
  },
  credentialStore: fakeCredentialStore,
  modelRuntime: fakeModelRuntime as never,
  account: "translator",
  writeKeychain: async ({ service, password }) => {
    keychainWrites.push({ service, password });
  },
});
assert.equal(saved.provider, "openrouter-pro");
assert.equal(saved.service, "com.linguist-agent.pi.openrouter-pro");
assert.equal(keychainWrites[0].password, "unit-test-secret");
assert.equal(stored.get("openrouter-pro")?.key, "!security find-generic-password -a 'translator' -s 'com.linguist-agent.pi.openrouter-pro' -w");
assert.equal(stored.get("openrouter-pro")?.key.includes("unit-test-secret"), false);
assert.deepEqual(stored.get("openrouter-pro")?.env, { OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1" });

const tested = await testPiProviderKeychainCredential({ provider: "OpenRouter Pro", credentialStore: fakeCredentialStore });
assert.equal(tested.configured, true);

const envUpdated = await updatePiProviderScopedEnvCredential({
  provider: "OpenRouter Pro",
  env: {
    OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
    HTTP_PROXY: "http://127.0.0.1:7890",
    OPENROUTER_API_KEY: "must-not-be-stored",
  },
  credentialStore: fakeCredentialStore,
  modelRuntime: fakeModelRuntime as never,
});
assert.equal(envUpdated.storage, "auth-json-env");
assert.equal(stored.get("openrouter-pro")?.key, "!security find-generic-password -a 'translator' -s 'com.linguist-agent.pi.openrouter-pro' -w");
assert.deepEqual(stored.get("openrouter-pro")?.env, {
  OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
  HTTP_PROXY: "http://127.0.0.1:7890",
});

const envRemoved = await updatePiProviderScopedEnvCredential({
  provider: "OpenRouter Pro",
  env: { EMPTY_VALUE: "" },
  credentialStore: fakeCredentialStore,
  modelRuntime: fakeModelRuntime as never,
});
assert.equal(envRemoved.removedEnv, true);
assert.equal(stored.get("openrouter-pro")?.env, undefined);

const envOnly = await updatePiProviderScopedEnvCredential({
  provider: "Cloudflare AI Gateway",
  apiKeyEnvVar: "CLOUDFLARE_API_KEY",
  env: {
    CLOUDFLARE_ACCOUNT_ID: "account-id",
    CLOUDFLARE_GATEWAY_ID: "gateway-id",
    CLOUDFLARE_API_KEY: "must-not-be-stored",
  },
  credentialStore: fakeCredentialStore,
  modelRuntime: fakeModelRuntime as never,
});
assert.equal(envOnly.createdCredential, true);
assert.equal(envOnly.keyReference, "$CLOUDFLARE_API_KEY");
assert.deepEqual(stored.get("cloudflare-ai-gateway"), {
  type: "api_key",
  key: "$CLOUDFLARE_API_KEY",
  env: {
    CLOUDFLARE_ACCOUNT_ID: "account-id",
    CLOUDFLARE_GATEWAY_ID: "gateway-id",
  },
});

await assert.rejects(
  updatePiProviderScopedEnvCredential({
    provider: "amazon-bedrock",
    apiKeyEnvVar: "AWS_PROFILE",
    env: { AWS_PROFILE: "production" },
    credentialStore: fakeCredentialStore,
    modelRuntime: fakeModelRuntime as never,
  }),
  /choose an official API key environment variable/,
);

stored.set("oauth-provider", { type: "oauth", refresh: "refresh", access: "access", expires: Date.now() + 60_000 });
await assert.rejects(
  updatePiProviderScopedEnvCredential({
    provider: "oauth-provider",
    env: { HTTP_PROXY: "http://127.0.0.1:7890" },
    credentialStore: fakeCredentialStore,
    modelRuntime: fakeModelRuntime as never,
  }),
  /only supported for API-key auth entries/,
);

const deleted: string[] = [];
await removePiProviderKeychainCredential({
  provider: "OpenRouter Pro",
  credentialStore: fakeCredentialStore,
  modelRuntime: fakeModelRuntime as never,
  account: "translator",
  deleteKeychain: async ({ service }) => {
    deleted.push(service);
  },
});
assert.deepEqual(deleted, ["com.linguist-agent.pi.openrouter-pro"]);
assert.equal(stored.has("openrouter-pro"), false);
assert.equal(refreshCalls, 5);

const credentialTemp = await mkdtemp(join(tmpdir(), "la-pi-credentials-"));
const credentialPath = join(credentialTemp, "auth.json");
const credentialStore = new PiAuthCredentialStore(credentialPath);
const previousTestKey = process.env.LA_PI_CREDENTIAL_TEST;
process.env.LA_PI_CREDENTIAL_TEST = "resolved-test-key";
try {
  await credentialStore.modify("test-provider", async () => ({
    type: "api_key",
    key: "$LA_PI_CREDENTIAL_TEST",
    env: { TEST_REGION: "local" },
  }));
  assert.deepEqual(await credentialStore.list(), [{ providerId: "test-provider", type: "api_key" }]);
  assert.deepEqual(await credentialStore.readStored("test-provider"), {
    type: "api_key",
    key: "$LA_PI_CREDENTIAL_TEST",
    env: { TEST_REGION: "local" },
  });
  assert.deepEqual(await credentialStore.read("test-provider"), {
    type: "api_key",
    key: "resolved-test-key",
    env: { TEST_REGION: "local" },
  });
  assert.equal((await stat(credentialPath)).mode & 0o777, 0o600);
  await credentialStore.delete("test-provider");
  assert.equal(await credentialStore.read("test-provider"), undefined);
} finally {
  if (previousTestKey === undefined) delete process.env.LA_PI_CREDENTIAL_TEST;
  else process.env.LA_PI_CREDENTIAL_TEST = previousTestKey;
  await rm(credentialTemp, { recursive: true, force: true });
}

console.log("pi_keychain_credentials tests passed");
