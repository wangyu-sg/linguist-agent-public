import assert from "node:assert/strict";
import test from "node:test";
import type { MaintenanceCandidate, MaintenancePlan } from "../packages/cat-server/src/maintainer.ts";
import { parseMaintainerCandidateArgs, runMaintainerCandidate } from "../scripts/maintainer-candidate.ts";

const plan: MaintenancePlan = {
  schemaVersion: 1,
  mode: "preview",
  planHash: "a".repeat(64),
  repository: {
    path: "/synthetic/repo",
    head: "b".repeat(40),
    branch: "main",
    dirty: false,
    changedPaths: [],
    packageLockSha256: "c".repeat(64),
    headPackageLockSha256: "c".repeat(64),
  },
  current: { productVersion: "2.32.7", piVersion: "0.80.10", apiProtocolVersion: 2 },
  workingTree: { productVersion: "2.32.7", piVersion: "0.80.10", packageLockSha256: "c".repeat(64) },
  target: { piVersion: "0.80.11" },
  candidate: { strategy: "isolated_git_worktree", root: "/synthetic/candidate", branch: "codex/synthetic" },
  expectedChanges: ["package.json", "package-lock.json"],
  validationCommands: [["npm", "run", "typecheck"]],
  rollback: "remove synthetic candidate",
  mutationsCurrentRuntime: false,
};

const candidate: MaintenanceCandidate = {
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
  changedPaths: ["package.json"],
  migration: { status: "not_run", summary: "Developer/CI tool never starts a product Agent." },
  validation: [{ command: ["npm", "run", "typecheck"], status: "passed", durationMs: 1 }],
  activationRequiresSecondApproval: true,
};

test("Maintainer candidate CLI requires explicit repository and candidate inputs", () => {
  assert.throws(() => parseMaintainerCandidateArgs(["preview", "--target-pi", "0.80.11"]), /--repo/);
  assert.throws(() => parseMaintainerCandidateArgs(["preview", "--repo", "/synthetic/repo", "--target-pi", "0.80.11"]), /--candidate-root/);
  assert.deepEqual(
    parseMaintainerCandidateArgs(["preview", "--repo", "/synthetic/repo", "--target-pi", "0.80.11", "--candidate-root", "/synthetic/candidate"]),
    { command: "preview", repoPath: "/synthetic/repo", targetPiVersion: "0.80.11", candidateRoot: "/synthetic/candidate" },
  );
});

test("Maintainer candidate CLI carries the exact preview plan hash into the existing isolated build", async () => {
  const calls: string[] = [];
  const result = await runMaintainerCandidate(
    ["build", "--plan", "/synthetic/plan.json", "--plan-hash", plan.planHash],
    {
      readPlan: async (path) => { calls.push(`read:${path}`); return plan; },
      preview: async () => assert.fail("build must not create a second preview"),
      build: async (input) => {
        calls.push(`build:${input.approvedPlanHash}`);
        assert.equal(input.plan, plan);
        return candidate;
      },
    },
  );
  assert.equal(result, candidate);
  assert.deepEqual(calls, [`read:/synthetic/plan.json`, `build:${plan.planHash}`]);
  await assert.rejects(
    runMaintainerCandidate(["build", "--plan", "/synthetic/plan.json", "--plan-hash", "f".repeat(64)], {
      readPlan: async () => plan,
      preview: async () => assert.fail("build must not create a preview"),
      build: async () => assert.fail("mismatched hash must fail in core validation"),
    }),
    /plan-hash/i,
  );
});
