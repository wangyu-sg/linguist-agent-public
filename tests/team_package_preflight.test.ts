import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCatWorkflowRun, type TeamRoleId } from "@linguist-agent/cat-data";
import { preflightTeamWorkflowRun } from "../packages/cat-server/src/routes/workflow_routes.js";
import type { TaskPackageRunResources } from "../packages/cat-server/src/task_package_profile.js";

const repoRoot = await mkdtemp(join(tmpdir(), "la-team-package-preflight-"));
await createCatWorkflowRun(repoRoot, {
  projectId: "project-one",
  taskId: "task-one",
  workflowId: "workflow-one",
  intent: "game_localization_team_run",
  includeReadiness: false,
});

const deps = {
  repoRoot,
  json: () => undefined,
  readBody: async () => ({}),
  requireString: (value: unknown, label: string) => {
    if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
    return value;
  },
  optionalString: (value: unknown) => typeof value === "string" && value ? value : undefined,
  optionalStringArray: (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
  optionalBoolean: (value: unknown) => value === undefined ? undefined : Boolean(value),
  readTaskPackageRunResources: async (): Promise<TaskPackageRunResources> => ({
    profileRevision: 1,
    profileHash: "sha256-profile",
    selections: [],
    resolvedResources: [{
      packageSource: "npm:example-package@1.2.3",
      resourceType: "extension",
      resourceId: "ui.ts",
      path: "/not-used-by-preflight",
      version: "1.2.3",
      integrity: "sha256-resource",
      packageName: "example-package",
      enabledByPi: true,
      executable: true,
      origin: "package",
      scope: "global",
    }],
    isolatedResources: {},
    packages: [],
  }),
};

const plan = await preflightTeamWorkflowRun({
  projectId: "project-one",
  workflowId: "workflow-one",
  project: false,
  deps,
});

assert.equal(plan.readiness.status, "blocked");
assert.equal(plan.selectedRoleIds.includes("loc_engineer_gate" as TeamRoleId), true);
assert.match(plan.readiness.blockers.join("\n"), /Team child RPC could not verify/);
assert.match(plan.readiness.blockers.join("\n"), /example-package@1\.2\.3/);

console.log("team package preflight tests passed");
