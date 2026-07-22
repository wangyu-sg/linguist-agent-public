import { strict as assert } from "node:assert";
import {
  LA_API_PROTOCOL_VERSION,
  buildRuntimeHandshake,
  evaluateRuntimeCompatibility,
  runtimeInstanceId,
} from "../packages/cat-server/src/runtime_compatibility.js";

assert.equal(runtimeInstanceId("/tmp/la/runtime"), runtimeInstanceId("/tmp/la/runtime/../runtime"));
assert.notEqual(runtimeInstanceId("/tmp/la/runtime"), runtimeInstanceId("/tmp/la/other"));

const handshake = buildRuntimeHandshake({
  repoRoot: "/private/runtime",
  productVersion: "3.0.0",
  piVersion: "0.80.3",
  dataSchemaVersion: 2,
  capabilities: ["local-auth", "runtime-migrations", "task-workspace-v2"],
});
assert.equal(handshake.ok, true);
assert.equal(handshake.apiProtocolVersion, LA_API_PROTOCOL_VERSION);
assert.equal(handshake.authRequired, true);
assert.equal("repoRoot" in handshake, false);

assert.deepEqual(
  evaluateRuntimeCompatibility(handshake, {
    protocolVersion: LA_API_PROTOCOL_VERSION,
    requiredCapabilities: ["local-auth"],
  }),
  { compatible: true, missingCapabilities: [] },
);
assert.deepEqual(
  evaluateRuntimeCompatibility(handshake, {
    protocolVersion: LA_API_PROTOCOL_VERSION,
    requiredCapabilities: ["team-preflight"],
  }),
  { compatible: false, reason: "missing_capabilities", missingCapabilities: ["team-preflight"] },
);

console.log("runtime_compatibility tests passed");
