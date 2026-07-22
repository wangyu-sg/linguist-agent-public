import assert from "node:assert/strict";
import { join } from "node:path";
import { DETERMINISTIC_TEAM_ROLE_IDS, TEAM_ROLE_IDS } from "@linguist-agent/cat-data";
import { discoverAgents } from "../.pi/npm/node_modules/pi-subagents/src/agents/agents.ts";
import { buildPiArgs } from "../.pi/npm/node_modules/pi-subagents/src/runs/shared/pi-args.ts";

const repoRoot = process.cwd();
const modelRoleIds = TEAM_ROLE_IDS.filter((roleId) => !DETERMINISTIC_TEAM_ROLE_IDS.has(roleId));
const agentNameForRole = (roleId: (typeof TEAM_ROLE_IDS)[number]) => `la-team-${roleId.replaceAll("_", "-")}`;
const discovered = discoverAgents(repoRoot, "project");
for (const roleId of modelRoleIds) {
  const agentName = agentNameForRole(roleId);
  const agent = discovered.agents.find((row) => row.name === agentName);
  assert.ok(agent, `${agentName} must be discoverable by pi-subagents`);
  assert.ok(
    agent?.thinking === undefined || ["off", "minimal", "low", "medium", "high", "xhigh"].includes(agent.thinking),
    `${agentName} thinking must be a Pi-supported, replaceable profile default`,
  );
  assert.deepEqual(agent?.skills ?? [], []);
  assert.equal(agent?.completionGuard, false, `${agentName} uses proposal-only CAT tools and must not receive the mutation completion guard`);
  const built = buildPiArgs({
    baseArgs: ["--mode", "json"],
    task: "verify Team child tool isolation",
    sessionEnabled: true,
    sessionDir: join(repoRoot, "tmp", "team-role-agent-argv", agentName),
    inheritProjectContext: agent!.inheritProjectContext,
    inheritSkills: agent!.inheritSkills,
    requireReadTool: Boolean(agent!.skills?.length),
    tools: agent!.tools,
    extensions: agent!.extensions,
    subagentOnlyExtensions: agent!.subagentOnlyExtensions,
    cwd: repoRoot,
  });
  const toolsIndex = built.args.indexOf("--tools");
  assert.ok(toolsIndex >= 0);
  const activeTools = built.args[toolsIndex + 1]!.split(",");
  assert.equal(activeTools.includes("read"), false, `${agentName} must not receive Pi's builtin read tool`);
  assert.deepEqual(activeTools, agent!.tools);
  assert.equal(built.args.includes("--no-extensions"), true);
  assert.equal(built.args.some((value) => value.endsWith(".pi/extensions/team-evidence-child.ts")), true);
}

for (const roleId of DETERMINISTIC_TEAM_ROLE_IDS) {
  assert.equal(discovered.agents.some((row) => row.name === agentNameForRole(roleId)), false, `${roleId} must not have a model profile`);
}

console.log("team_role_agents tests passed");
