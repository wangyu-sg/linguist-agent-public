import assert from "node:assert/strict";
import {
  settingsPermissionApplicationPort,
  type AgentPermissionRules,
} from "../packages/cat-server/src/application/settings_permission_application_port.js";

const customRules: AgentPermissionRules = {
  fileRead: "auto",
  fileWrite: "ask",
  webRead: "deny",
  bash: "ask",
  bridge: "deny",
};

assert.deepEqual(
  settingsPermissionApplicationPort.normalizePermissionPatch({ customRules }),
  { permissionRules: customRules },
);
assert.throws(
  () => settingsPermissionApplicationPort.normalizePermissionPatch({ mode: "full" }),
  /permission mode/i,
);
assert.throws(
  () => settingsPermissionApplicationPort.normalizePermissionPatch({ permissionRules: { catProposalFirst: "auto" } }),
  /Unknown or locked permission domain/,
);
assert.equal(
  settingsPermissionApplicationPort.buildPermissionContract({ permissionMode: "ask" }).mode,
  "ask",
);

console.log("settings permission application port tests passed");
