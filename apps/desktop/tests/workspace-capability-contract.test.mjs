import assert from "node:assert/strict";
import test from "node:test";

const contract = await import("../dist/electron/ipc-contract.cjs");

test("renderer requests only a declared workspace capability", () => {
  const capability = contract.workspaceCapabilityFor("GET", "/api/runtime/health");
  assert.equal(capability, "runtime-health-read");
  assert.deepEqual(contract.resolveWorkspaceCapabilityRequest({
    capability,
    path: "/api/runtime/health",
  }), {
    method: "GET",
    path: "/api/runtime/health",
    body: undefined,
  });
});

test("workspace capability refuses an invented path or mismatched capability", () => {
  assert.equal(contract.workspaceCapabilityFor("POST", "/api/runtime/health"), null);
  assert.equal(contract.workspaceCapabilityFor("GET", "/api/admin/erase"), null);
  assert.throws(
    () => contract.resolveWorkspaceCapabilityRequest({
      capability: "runtime-health-read",
      path: "/api/admin/erase",
    }),
    /does not match/i,
  );
  assert.throws(
    () => contract.resolveWorkspaceCapabilityRequest({
      capability: "runtime-health-read",
      path: "/api/runtime/health",
      method: "DELETE",
    }),
    /unsupported field/i,
  );
});
