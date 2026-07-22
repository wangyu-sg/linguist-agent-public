import assert from "node:assert/strict";
import {
  buildAgentPermissionContract,
  evaluateAgentToolPermissionCall,
  resolveAgentToolPermissionDomain,
  type AgentPermissionRules,
} from "@linguist-agent/cat-runtime";
import { handleAgentPermissionRoute, normalizeAgentPermissionPatch } from "../packages/cat-server/src/routes/agent_permission_routes.js";

const defaultContract = buildAgentPermissionContract({ mode: "auto" });

function decision(domain: string): string | undefined {
  return defaultContract.effectivePolicy.find((entry) => entry.domain === domain)?.decision;
}

assert.equal(defaultContract.mode, "auto");
assert.equal(decision("fileRead"), "auto");
assert.equal(decision("fileWrite"), "auto");
assert.equal(decision("webRead"), "auto");
assert.equal(decision("bash"), "ask");
assert.equal(decision("bridge"), "ask");
assert.equal(defaultContract.effectivePolicy.every((entry) => typeof entry.riskClass === "string"), true);
assert.equal(defaultContract.effectivePolicy.every((entry) => typeof entry.locked === "boolean"), true);
assert.equal(defaultContract.effectivePolicy.find((entry) => entry.domain === "bash")?.riskClass, "high");
assert.equal(defaultContract.effectivePolicy.find((entry) => entry.domain === "bash")?.locked, false);

const fullContract = buildAgentPermissionContract({ mode: "full" });
assert.equal(fullContract.effectivePolicy.find((entry) => entry.domain === "catProposalFirst")?.riskClass, "non_picker");
assert.equal(fullContract.effectivePolicy.find((entry) => entry.domain === "catProposalFirst")?.locked, true);
assert.equal(fullContract.effectivePolicy.find((entry) => entry.domain === "catProposalFirst")?.decision, "ask");
assert.equal(fullContract.effectivePolicy.find((entry) => entry.domain === "lockedSegments")?.decision, "deny");

assert.equal(resolveAgentToolPermissionDomain("proposal_apply").controlledBy, "cat-governance");
assert.equal(resolveAgentToolPermissionDomain("segment_set_target").controlledBy, "cat-governance");
assert.equal(resolveAgentToolPermissionDomain("export_sdlxliff").controlledBy, "cat-governance");
assert.equal(resolveAgentToolPermissionDomain("bash").domain, "bash");
assert.equal(resolveAgentToolPermissionDomain("web_search").domain, "webRead");
assert.equal(resolveAgentToolPermissionDomain("write").domain, "fileWrite");
assert.equal(resolveAgentToolPermissionDomain("document_parse").domain, "fileRead");
assert.equal(resolveAgentToolPermissionDomain("document_search").domain, "fileRead");
assert.equal(resolveAgentToolPermissionDomain("document_screenshot").domain, "fileRead");
assert.equal(resolveAgentToolPermissionDomain("ask_user").controlledBy, "cat-governance");
assert.equal(resolveAgentToolPermissionDomain("prepare_team_execution").controlledBy, "cat-governance");

const customRules: AgentPermissionRules = {
  fileRead: "auto",
  fileWrite: "ask",
  webRead: "deny",
  bash: "ask",
  bridge: "deny",
};
const customContract = buildAgentPermissionContract({ mode: "custom", customRules });

const deniedWeb = await evaluateAgentToolPermissionCall({
  toolName: "web_search",
  input: { query: "terminology reference" },
  contract: customContract,
});
assert.equal(deniedWeb.block, true);
assert.match(deniedWeb.reason ?? "", /permission policy denied webRead/);

const canonicalAskUser = await evaluateAgentToolPermissionCall({
  toolName: "ask_user",
  input: { questions: [{ id: "scope", prompt: "Which scope?", options: [] }] },
  contract: customContract,
  requestDecision: async () => assert.fail("ask_user must not open a second Agent Autonomy request"),
});
assert.equal(canonicalAskUser, undefined);

const canonicalTeamProposal = await evaluateAgentToolPermissionCall({
  toolName: "prepare_team_execution",
  input: { reason: "Use a bounded Translator pass." },
  contract: buildAgentPermissionContract({ mode: "ask" }),
  requestDecision: async () => assert.fail("Team preparation must use its canonical Task approval instead of Agent Autonomy"),
});
assert.equal(canonicalTeamProposal, undefined);

let requestedTool = "";
const approvedBash = await evaluateAgentToolPermissionCall({
  toolName: "bash",
  input: { command: "pwd" },
  contract: customContract,
  requestDecision: async (request) => {
    requestedTool = request.toolName;
    return { decision: "approve" };
  },
});
assert.equal(requestedTool, "bash");
assert.equal(approvedBash?.block ?? false, false);

let observablePermissionRequest: { argsSummary: string } | undefined;
const documentAskContract = buildAgentPermissionContract({
  mode: "custom",
  customRules: { ...customRules, fileRead: "ask" },
});
const approvedDocument = await evaluateAgentToolPermissionCall({
  toolName: "document_parse",
  input: {
    path: "/project/customer.pdf",
    password: "permission-doc-password",
    nested: {
      pass_phrase: "permission-doc-passphrase",
      options: [{ token: "permission-token", apiKey: "permission-api-key" }],
      serialized: JSON.stringify({ credential: "permission-credential", keep: "visible-value" }),
    },
  },
  contract: documentAskContract,
  requestDecision: async (request) => {
    observablePermissionRequest = request;
    return { decision: "approve" };
  },
});
assert.equal(approvedDocument?.block ?? false, false);
assert.ok(observablePermissionRequest);
const observableSsePayload = JSON.stringify({ type: "permission_request", permissionRequest: observablePermissionRequest });
assert.equal(observableSsePayload.includes("permission-doc-password"), false);
assert.equal(observableSsePayload.includes("permission-doc-passphrase"), false);
assert.equal(observableSsePayload.includes("permission-token"), false);
assert.equal(observableSsePayload.includes("permission-api-key"), false);
assert.equal(observableSsePayload.includes("permission-credential"), false);
assert.match(observableSsePayload, /\[REDACTED\]/);
assert.match(observableSsePayload, /visible-value/);

const deniedBash = await evaluateAgentToolPermissionCall({
  toolName: "bash",
  input: { command: "rm -rf scratch" },
  contract: customContract,
  requestDecision: async () => ({ decision: "deny", reason: "manual denial" }),
});
assert.equal(deniedBash.block, true);
assert.match(deniedBash.reason ?? "", /manual denial/);

const noRequester = await evaluateAgentToolPermissionCall({
  toolName: "bash",
  input: { command: "pwd" },
  contract: customContract,
});
assert.equal(noRequester.block, true);
assert.match(noRequester.reason ?? "", /requires approval/);

const catToolStillAllowedByPermissionLayer = await evaluateAgentToolPermissionCall({
  toolName: "proposal_apply",
  input: { projectId: "p", batchId: "b", proposalSetId: "ps" },
  contract: fullContract,
});
assert.equal(catToolStillAllowedByPermissionLayer?.block ?? false, false);
assert.equal(catToolStillAllowedByPermissionLayer?.reason, undefined);

assert.deepEqual(normalizeAgentPermissionPatch({ mode: "full" }), { permissionMode: "full" });
assert.deepEqual(normalizeAgentPermissionPatch({ customRules }), { permissionRules: customRules });
assert.throws(() => normalizeAgentPermissionPatch({ permissionRules: { catProposalFirst: "auto" } }), /Unknown or locked permission domain/);

{
  const responses: Array<{ status: number; data: unknown }> = [];
  let body: Record<string, unknown> = { mode: "full" };
  let projectId = "";
  const deps = {
    json: (_res: never, status: number, data: unknown) => responses.push({ status, data }),
    readBody: async () => body,
    requireString: (value: unknown, label: string) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value: unknown) => typeof value === "string" && value ? value : undefined,
    permissionDecisionRegistry: {
      pending: () => [],
      decide: () => ({ ok: false }),
      request: () => {
        throw new Error("unused");
      },
      pendingCount: () => 0,
      cancelForSession: () => 0,
    },
    readAgentPermissionContract: async (id?: string) => {
      projectId = id ?? "";
      return buildAgentPermissionContract({ mode: "ask" });
    },
    writeGlobalAgentPermissionSettings: async (patch: ReturnType<typeof normalizeAgentPermissionPatch>) => patch,
    writeProjectAgentPermissionSettings: async (id: string, patch: ReturnType<typeof normalizeAgentPermissionPatch>) => {
      projectId = id;
      return patch;
    },
  };

  assert.equal(
    await handleAgentPermissionRoute({ method: "PUT" } as never, {} as never, new URL("http://x/api/agent/permissions"), ["api", "agent", "permissions"], deps),
    true,
  );
  assert.equal(responses[0].status, 200);
  assert.equal((responses[0].data as { mode?: string }).mode, "full");

  responses.length = 0;
  body = {};
  assert.equal(
    await handleAgentPermissionRoute({ method: "GET" } as never, {} as never, new URL("http://x/api/projects/p%201/agent/permissions"), ["api", "projects", "p%201", "agent", "permissions"], deps),
    true,
  );
  assert.equal(projectId, "p 1");
  assert.equal(responses[0].status, 200);
}

console.log("agent_permissions tests passed");
