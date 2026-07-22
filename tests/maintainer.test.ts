import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  MaintenanceError,
  buildMaintenanceCandidate,
  previewMaintenance,
} from "../packages/cat-server/src/maintainer.ts";

test("Maintainer preview reports dirty state and produces a stable isolated-worktree plan", async () => {
  const root = await mkdtemp(join(tmpdir(), "la-maintainer-preview-"));
  await mkdir(join(root, ".git"));
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    name: "linguist-agent",
    version: "2.32.7",
    dependencies: {
      "@earendil-works/pi-ai": "0.80.10",
      "@earendil-works/pi-coding-agent": "0.80.10",
    },
  })}\n`);
  await writeFile(join(root, "package-lock.json"), "{}\n");
  const execute = async (_command: string, args: string[]) => {
    const key = args.join(" ");
    if (key === "rev-parse --show-toplevel") return { stdout: `${root}\n`, stderr: "" };
    if (key === "rev-parse HEAD") return { stdout: `${"a".repeat(40)}\n`, stderr: "" };
    if (key === "branch --show-current") return { stdout: "main\n", stderr: "" };
    if (key === "status --porcelain=v1 --untracked-files=normal") return { stdout: " M package.json\n?? notes.txt\n", stderr: "" };
    if (key === "show HEAD:package.json") return { stdout: await import("node:fs/promises").then(({ readFile }) => readFile(join(root, "package.json"), "utf8")), stderr: "" };
    if (key === "show HEAD:package-lock.json") return { stdout: "{}\n", stderr: "" };
    throw new Error(`unexpected command: ${key}`);
  };

  const first = await previewMaintenance({
    repoPath: root,
    targetPiVersion: "0.80.11",
    candidateRoot: join(root, "data", "candidate"),
    execute,
  });
  const second = await previewMaintenance({
    repoPath: root,
    targetPiVersion: "0.80.11",
    candidateRoot: join(root, "data", "candidate"),
    execute,
  });

  assert.equal(first.repository.dirty, true);
  assert.deepEqual(first.repository.changedPaths, ["notes.txt", "package.json"]);
  assert.equal(first.current.piVersion, "0.80.10");
  assert.equal(first.workingTree.piVersion, "0.80.10");
  assert.match(first.repository.headPackageLockSha256, /^[a-f0-9]{64}$/);
  assert.equal(first.target.piVersion, "0.80.11");
  assert.equal(first.candidate.strategy, "isolated_git_worktree");
  assert.equal(first.mutationsCurrentRuntime, false);
  assert.equal(first.planHash, second.planHash);
  assert.match(first.planHash, /^[a-f0-9]{64}$/);
});

test("Maintainer rejects a stale plan hash before creating a worktree", async () => {
  let commands = 0;
  await assert.rejects(
    buildMaintenanceCandidate({
      plan: {
        schemaVersion: 1,
        mode: "preview",
        planHash: "a".repeat(64),
        repository: {
          path: "/tmp/repo",
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
        candidate: { strategy: "isolated_git_worktree", root: "/tmp/candidate", branch: "codex/maintainer-pi-0.80.11-test" },
        expectedChanges: ["package.json", "package-lock.json"],
        validationCommands: [["npm", "run", "typecheck"]],
        rollback: "remove candidate",
        mutationsCurrentRuntime: false,
      },
      approvedPlanHash: "0".repeat(64),
      execute: async () => {
        commands += 1;
        return { stdout: "", stderr: "" };
      },
    }),
    (error: unknown) => error instanceof MaintenanceError && error.code === "plan_hash_mismatch",
  );
  assert.equal(commands, 0);
});

test("Maintainer builds only in the isolated worktree and requires a full app for protocol mismatch", async () => {
  const root = await mkdtemp(join(tmpdir(), "la-maintainer-build-"));
  const candidateRoot = join(root, "data", "candidate");
  await mkdir(join(root, ".git"));
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    name: "linguist-agent",
    version: "2.32.7",
    dependencies: {
      "@earendil-works/pi-ai": "0.80.10",
      "@earendil-works/pi-coding-agent": "0.80.10",
    },
  })}\n`);
  await writeFile(join(root, "package-lock.json"), "{}\n");
  const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
  const execute = async (command: string, args: string[], options?: { cwd?: string }) => {
    calls.push({ command, args, cwd: options?.cwd });
    const key = args.join(" ");
    if (key === "rev-parse --show-toplevel") return { stdout: `${root}\n`, stderr: "" };
    if (key === "rev-parse HEAD") return { stdout: `${"a".repeat(40)}\n`, stderr: "" };
    if (key === "branch --show-current") return { stdout: "main\n", stderr: "" };
    if (key === "status --porcelain=v1 --untracked-files=normal") {
      return { stdout: options?.cwd === candidateRoot ? " M package.json\n M package-lock.json\n" : " M notes.txt\n", stderr: "" };
    }
    if (key === "show HEAD:package.json") return { stdout: await import("node:fs/promises").then(({ readFile }) => readFile(join(root, "package.json"), "utf8")), stderr: "" };
    if (key === "show HEAD:package-lock.json") return { stdout: "{}\n", stderr: "" };
    if (args[0] === "worktree" && args[1] === "add") {
      await mkdir(join(candidateRoot, "packages", "cat-server", "src"), { recursive: true });
      await writeFile(join(candidateRoot, "package.json"), "{}\n");
      await writeFile(join(candidateRoot, "package-lock.json"), "{}\n");
      await writeFile(join(candidateRoot, "packages", "cat-server", "src", "runtime_compatibility.ts"), "export const LA_API_PROTOCOL_VERSION = 3;\n");
      return { stdout: "prepared", stderr: "" };
    }
    if (key === "diff --binary --no-ext-diff") return { stdout: "candidate diff", stderr: "" };
    if (key === "rev-parse HEAD" && options?.cwd === candidateRoot) return { stdout: `${"a".repeat(40)}\n`, stderr: "" };
    if (command === "/usr/bin/env" && args[0] === "npm") return { stdout: "ok", stderr: "" };
    throw new Error(`unexpected command: ${command} ${key}`);
  };
  const plan = await previewMaintenance({ repoPath: root, targetPiVersion: "0.80.11", candidateRoot, execute });
  plan.validationCommands = [["npm", "run", "typecheck"], ["npm", "test"]];
  // The route persists the exact returned document. Recompute the approval hash
  // after the intentionally shortened test-only validation list.
  const crypto = await import("node:crypto");
  const stable = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
    return JSON.stringify(value);
  };
  const { planHash: _ignored, ...unsigned } = plan;
  plan.planHash = crypto.createHash("sha256").update(stable(unsigned)).digest("hex");

  let migrated = false;
  const candidate = await buildMaintenanceCandidate({
    plan,
    approvedPlanHash: plan.planHash,
    execute,
    migrate: async ({ candidateRoot: migratedRoot }) => {
      assert.equal(migratedRoot, candidateRoot);
      migrated = true;
      return { status: "completed", summary: "Pi compatibility inspected.", sessionId: "maintainer-session" };
    },
  });

  assert.equal(candidate.disposition, "full_app_candidate");
  assert.equal(candidate.candidateApiProtocolVersion, 3);
  assert.equal(candidate.currentApiProtocolVersion, 2);
  assert.equal(candidate.validation.length, 2);
  assert.equal(candidate.migration.status, "completed");
  assert.equal(migrated, true);
  assert.equal(calls.some((call) => call.args[0] === "worktree" && call.cwd === plan.repository.path), true);
  assert.equal(calls.filter((call) => call.command === "/usr/bin/env" && call.args[0] === "npm").every((call) => call.cwd === candidateRoot), true);
  assert.equal(calls.some((call) => call.cwd === root && call.command === "/usr/bin/env"), false);
  assert.equal(calls.some((call) => call.args.join(" ") === "npm ci --ignore-scripts" && call.cwd === candidateRoot), true);
  assert.equal(calls.some((call) => call.args.join(" ") === "npm --prefix apps/desktop ci --ignore-scripts" && call.cwd === candidateRoot), true);
  assert.match(candidate.treeHash, /^[a-f0-9]{64}$/);
});
