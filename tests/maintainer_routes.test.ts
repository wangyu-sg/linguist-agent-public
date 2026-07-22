import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createStandaloneFileGrant,
  createTaskWorkspace,
} from "@linguist-agent/cat-data";
import { handleMaintainerRoute } from "../packages/cat-server/src/routes/maintainer_routes.ts";
import type { MaintenanceCandidate, MaintenancePlan } from "../packages/cat-server/src/maintainer.ts";

const root = await mkdtemp(join(tmpdir(), "la-maintainer-routes-"));
const repo = join(root, "granted-repo");
const taskId = "maintainer-chat";
await mkdir(join(repo, ".git"), { recursive: true });
await createTaskWorkspace(root).create({ owner: { kind: "standalone" }, taskId, title: "Upgrade LA", intent: "Upgrade Pi safely", kind: "general" });
const readWrite = await createStandaloneFileGrant(root, { taskId, path: repo, kind: "directory", access: "read_write", recursive: true });
const readOnly = await createStandaloneFileGrant(root, { taskId, path: repo, kind: "directory", access: "read", recursive: true });
let lastPlan: MaintenancePlan | undefined;
let buildCount = 0;

async function request(method: string, path: string, body: unknown = {}): Promise<{ status: number; data: any }> {
  const url = new URL(path, "http://127.0.0.1");
  let output: { status: number; data: any } | undefined;
  const handled = await handleMaintainerRoute(
    Object.assign(new EventEmitter(), { method }) as IncomingMessage,
    {} as ServerResponse,
    url.pathname.split("/").filter(Boolean),
    {
      repoRoot: root,
      json: (_res, status, data) => { output = { status, data }; },
      readBody: async () => body,
      preview: async (input) => {
        const plan: MaintenancePlan = {
          schemaVersion: 1,
          mode: "preview",
          planHash: "a".repeat(64),
          repository: { path: input.repoPath, head: "b".repeat(40), branch: "main", dirty: true, changedPaths: ["notes.txt"], packageLockSha256: "c".repeat(64), headPackageLockSha256: "d".repeat(64) },
          current: { productVersion: "2.32.7", piVersion: "0.80.10", apiProtocolVersion: 2 },
          workingTree: { productVersion: "2.32.7", piVersion: "0.80.10", packageLockSha256: "c".repeat(64) },
          target: { piVersion: input.targetPiVersion },
          candidate: { strategy: "isolated_git_worktree", root: input.candidateRoot, branch: "codex/maintainer-test" },
          expectedChanges: ["package.json", "package-lock.json"],
          validationCommands: [["npm", "run", "typecheck"]],
          rollback: "retained old runtime",
          mutationsCurrentRuntime: false,
        };
        lastPlan = plan;
        return plan;
      },
      build: async ({ plan }) => {
        buildCount += 1;
        return {
          schemaVersion: 1,
          status: "validated",
          planHash: plan.planHash,
          candidateRoot: plan.candidate.root,
          candidateBranch: plan.candidate.branch,
          disposition: "runtime_candidate",
          currentApiProtocolVersion: 2,
          candidateApiProtocolVersion: 2,
          commit: plan.repository.head,
          treeHash: "d".repeat(64),
          reportSha256: "e".repeat(64),
          changedPaths: ["package.json", "package-lock.json"],
          migration: { status: "completed", summary: "Pi compatibility inspected.", sessionId: "maintainer-session" },
          validation: [{ command: ["npm", "run", "typecheck"], status: "passed", durationMs: 1 }],
          activationRequiresSecondApproval: true,
        } satisfies MaintenanceCandidate;
      },
    },
  );
  assert.equal(handled, true);
  assert.ok(output);
  return output;
}

try {
  const denied = await request("POST", `/api/tasks/${taskId}/maintenance/preview`, { grantId: readOnly.grant.id, targetPiVersion: "0.80.11" });
  assert.equal(denied.status, 400);
  assert.match(denied.data.error.message, /read_write/i);

  const preview = await request("POST", `/api/tasks/${taskId}/maintenance/preview`, { grantId: readWrite.grant.id, targetPiVersion: "0.80.11" });
  assert.equal(preview.status, 201);
  assert.equal(preview.data.plan.planHash, "a".repeat(64));
  assert.equal(preview.data.snapshot.artifacts.at(-1).type, "maintenance_plan");
  assert.equal(preview.data.snapshot.artifacts.at(-1).status, "reviewable");
  assert.equal(preview.data.snapshot.agentThreads.at(-1).identity.displayName, "Maintainer");
  assert.equal(lastPlan?.repository.path, readWrite.grant.realPath);

  const started = await request("POST", `/api/tasks/${taskId}/maintenance/build`, { planHash: "a".repeat(64) });
  assert.equal(started.status, 202);
  assert.equal(started.data.job.status, "running");
  let built = await request("GET", `/api/tasks/${taskId}/maintenance/build`);
  for (let attempt = 0; built.data.job.status === "running" && attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1));
    built = await request("GET", `/api/tasks/${taskId}/maintenance/build`);
  }
  assert.equal(built.data.job.status, "complete");
  assert.equal(built.data.job.candidate.disposition, "runtime_candidate");
  assert.equal(buildCount, 1);
  assert.equal(built.data.job.snapshot.activities.at(-1).title, "Maintenance candidate validated");
  assert.equal(built.data.job.snapshot.agentThreads.at(-1).identity.disclosureLabel, "Agent");

  const stale = await request("POST", `/api/tasks/${taskId}/maintenance/build`, { planHash: "0".repeat(64) });
  assert.equal(stale.status, 404);

  const activation = await request("POST", `/api/tasks/${taskId}/maintenance/activate`, {
    reportSha256: "e".repeat(64),
    confirmation: "activate eeeeeeeeeeee",
  });
  assert.equal(activation.status, 200);
  assert.equal(activation.data.handoff.action, "electron_runtime_installer");
  assert.equal(activation.data.handoff.serverPerformedSwitch, false);

  console.log("Maintainer route tests passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
