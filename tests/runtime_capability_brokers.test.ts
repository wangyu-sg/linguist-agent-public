import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  NetworkCapabilityBroker,
  ProcessCapabilityBroker,
  SecretCapabilityBroker,
} from "@linguist-agent/cat-data";
import { guardRuntimeCapabilities } from "@linguist-agent/cat-runtime";
import { authorizeStoredWebCredentialReference } from "@linguist-agent/cat-tools";

const network = NetworkCapabilityBroker.create({
  grants: [
    { id: "search", toolName: "web_search", hosts: ["api.tavily.com"], schemes: ["https"] },
    { id: "fetch", toolName: "web_fetch", hosts: ["docs.example.com"], schemes: ["https"] },
  ],
});
assert.equal(network.authorizeUrl("web_search", "https://api.tavily.com/search").grantId, "search");
assert.equal(network.authorizeUrl("web_fetch", "https://docs.example.com/reference").host, "docs.example.com");
assert.throws(() => network.authorizeUrl("web_fetch", "http://docs.example.com/reference"), /NETWORK_CAPABILITY_DENIED/);
assert.throws(() => network.authorizeUrl("web_fetch", "https://sub.docs.example.com/reference"), /NETWORK_CAPABILITY_DENIED/);
assert.throws(() => network.authorizeUrl("web_fetch", "https://user:pass@docs.example.com/reference"), /NETWORK_CAPABILITY_DENIED/);
assert.throws(() => network.authorizeUrl("web_fetch", "https://127.0.0.1/reference"), /NETWORK_CAPABILITY_DENIED/);
assert.throws(() => NetworkCapabilityBroker.create({
  grants: [{ id: "wildcard", toolName: "web_fetch", hosts: ["*.example.com"], schemes: ["https"] }],
}), /NETWORK_CAPABILITY_INVALID/);
assert.equal(NetworkCapabilityBroker.create({
  grants: [{ id: "local-test", toolName: "web_fetch", hosts: ["127.0.0.1"], schemes: ["http"], ports: [43123], allowPrivateNetwork: true }],
}).authorizeUrl("web_fetch", "http://127.0.0.1:43123/reference").port, 43123);

const processBroker = ProcessCapabilityBroker.create({
  grants: [{ id: "sandbox", toolName: "bash", templateIds: ["sandboxed-shell"] }],
});
assert.equal(processBroker.authorize("bash", "sandboxed-shell").grantId, "sandbox");
assert.throws(() => processBroker.authorize("bash", "raw-shell"), /PROCESS_CAPABILITY_DENIED/);
assert.throws(() => processBroker.authorize("node", "sandboxed-shell"), /PROCESS_CAPABILITY_DENIED/);

const secrets = SecretCapabilityBroker.create({
  grants: [{ id: "tavily", consumer: "web_search", secretIds: ["provider:tavily"] }],
});
assert.deepEqual(secrets.authorize("web_search", "provider:tavily"), {
  grantId: "tavily",
  secretId: "provider:tavily",
  consumer: "web_search",
});
assert.throws(() => secrets.authorize("web_fetch", "provider:tavily"), /SECRET_CAPABILITY_DENIED/);
assert.equal(JSON.stringify(secrets.authorize("web_search", "provider:tavily")).includes("secret-value"), false);

assert.equal(guardRuntimeCapabilities({ toolName: "web_fetch", input: { url: "https://docs.example.com/reference" } }), undefined);
assert.match(guardRuntimeCapabilities({ toolName: "web_fetch", input: { url: "ftp://docs.example.com/reference" } })?.reason ?? "", /NETWORK_CAPABILITY_DENIED/);
assert.equal(guardRuntimeCapabilities({ toolName: "web_search", input: { query: "terminology" } }), undefined);
assert.match(guardRuntimeCapabilities({ toolName: "browser", input: { url: "https://example.com" } })?.reason ?? "", /no exact approved bridge grant/);
assert.equal(guardRuntimeCapabilities({ toolName: "bash", input: { command: "pwd" } }), undefined);
assert.match(guardRuntimeCapabilities({ toolName: "bash", input: {} })?.reason ?? "", /PROCESS_CAPABILITY_DENIED/);
assert.deepEqual(authorizeStoredWebCredentialReference("tavily", "$TAVILY_API_KEY"), { kind: "env", envName: "TAVILY_API_KEY" });
assert.deepEqual(
  authorizeStoredWebCredentialReference("tavily", "!security find-generic-password -a 'user' -s 'com.linguist-agent.pi.tavily' -w"),
  { kind: "keychain", account: "user", service: "com.linguist-agent.pi.tavily" },
);
assert.throws(() => authorizeStoredWebCredentialReference("tavily", "$AWS_SECRET_ACCESS_KEY"), /SECRET_CAPABILITY_DENIED/);
assert.throws(() => authorizeStoredWebCredentialReference("tavily", "plaintext-secret"), /SECRET_CAPABILITY_DENIED/);
assert.throws(
  () => authorizeStoredWebCredentialReference("tavily", "!security find-generic-password -a 'user' -s 'unrelated-service' -w"),
  /SECRET_CAPABILITY_DENIED/,
);

const [generalRuntimeSource, catRuntimeSource, sandboxSource, webBridgeSource] = await Promise.all([
  readFile(new URL("../packages/cat-runtime/src/generalRuntimeExtension.ts", import.meta.url), "utf8"),
  readFile(new URL("../packages/cat-runtime/src/catRuntimeExtension.ts", import.meta.url), "utf8"),
  readFile(new URL("../packages/cat-runtime/src/catSandbox.ts", import.meta.url), "utf8"),
  readFile(new URL("../packages/cat-tools/src/web_bridge_tools.ts", import.meta.url), "utf8"),
]);
assert.match(generalRuntimeSource, /guardRuntimeCapabilities/);
assert.match(catRuntimeSource, /guardRuntimeCapabilities/);
assert.match(sandboxSource, /ProcessCapabilityBroker/);
assert.match(webBridgeSource, /NetworkCapabilityBroker/);
assert.match(webBridgeSource, /SecretCapabilityBroker/);
assert.doesNotMatch(webBridgeSource, /if \(!credential\.key\.startsWith\("!"\)\) return credential\.key/);

console.log("runtime capability broker tests passed");
