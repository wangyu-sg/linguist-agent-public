import { strict as assert } from "node:assert";
import { buildTeamRunPlan, defaultTeamRoleProfiles, TEAM_ROLE_IDS } from "@linguist-agent/cat-data";

const adaptive = buildTeamRunPlan({
  projectId: "p1",
  workflowId: "w1",
  batchId: "b1",
  hasBrief: true,
  hasStrategy: true,
  pendingSegments: 12,
  hasCandidates: false,
  hasFindings: false,
  hasAttachments: false,
  profiles: defaultTeamRoleProfiles(),
});
assert.equal(adaptive.readiness.status, "ready");
for (const roleId of ["loc_engineer_gate", "delivery_manager"] as const) {
  assert.equal(adaptive.selectedRoleIds.includes(roleId), true);
}
assert.equal(adaptive.selectedRoleIds.includes("translator"), true, "pending untranslated segments need one candidate-producing role");
assert.equal(adaptive.selectedRoleIds.includes("editor"), false, "new Translator output does not justify an automatic rubber-stamp pass");
for (const roleId of ["producer", "lead_linguist_setup", "culturalization_reviewer", "pre_lqa_reviewer"] as const) {
  assert.equal(adaptive.selectedRoleIds.includes(roleId), false);
}
for (const roleId of ["proofreader", "lead_linguist_final"] as const) {
  assert.equal(adaptive.selectedRoleIds.includes(roleId), false, `${roleId} is conditional, not automatic ceremony`);
}
assert.equal(adaptive.estimatedCalls, adaptive.roles
  .filter((role) => adaptive.selectedRoleIds.includes(role.roleId))
  .reduce((total, role) => total + role.estimatedCalls, 0));
assert.equal(adaptive.roles.find((role) => role.roleId === "loc_engineer_gate")?.estimatedCalls, 0);
assert.equal(adaptive.roles.find((role) => role.roleId === "delivery_manager")?.modelRoute, undefined);
assert.ok(adaptive.roles.find((role) => role.roleId === "editor")?.reason);
assert.match(adaptive.planHash, /^[0-9a-f]{64}$/);

const singleOperational = buildTeamRunPlan({
  projectId: "p1",
  workflowId: "single-operational",
  batchId: "b1",
  hasBrief: false,
  hasStrategy: false,
  pendingSegments: 1,
  hasCandidates: false,
  hasFindings: false,
  hasAttachments: false,
  profiles: defaultTeamRoleProfiles(),
});
assert.deepEqual(singleOperational.selectedRoleIds, ["loc_engineer_gate", "translator", "delivery_manager"]);
assert.equal(singleOperational.estimatedCalls, 1);
assert.ok(singleOperational.roles.find((role) => role.roleId === "producer")?.reason);
assert.ok(singleOperational.roles.find((role) => role.roleId === "lead_linguist_final")?.reason);

const forced = buildTeamRunPlan({ projectId: "p1", workflowId: "w2", forceAllRoles: true, profiles: defaultTeamRoleProfiles() });
assert.deepEqual(forced.selectedRoleIds, TEAM_ROLE_IDS);
assert.equal(forced.estimatedCalls, TEAM_ROLE_IDS.length - 2);

const disabled = buildTeamRunPlan({
  projectId: "p1",
  workflowId: "w3",
  pendingSegments: 1,
  profiles: defaultTeamRoleProfiles().map((profile) => profile.roleId === "translator" ? { ...profile, enabled: false } : profile),
});
assert.equal(disabled.selectedRoleIds.includes("translator"), false);
assert.ok(disabled.roles.find((role) => role.roleId === "translator")?.reason);

console.log("team run plan tests passed");
