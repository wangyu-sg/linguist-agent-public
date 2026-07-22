import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { LA_API_PROTOCOL_VERSION } from "./runtime_compatibility.js";

const execFileAsync = promisify(execFile);
const PI_PACKAGES = ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent"] as const;
const ALLOWED_VALIDATIONS = new Set([
  "npm test",
  "npm run typecheck",
  "npm run mac:build",
  "npm run mac:test",
  "npm run mac:verify",
  "npm run release:check",
  "npm run release:mac -- --dry-run",
  "npm run runtime:health",
  "npm run rc:status",
]);

export type MaintainerExecute = (
  command: string,
  args: string[],
  options?: { cwd?: string; timeout?: number; env?: NodeJS.ProcessEnv },
) => Promise<{ stdout: string | Buffer; stderr: string | Buffer }>;

export interface MaintenancePlan {
  schemaVersion: 1;
  mode: "preview";
  planHash: string;
  repository: {
    path: string;
    head: string;
    branch: string;
    dirty: boolean;
    changedPaths: string[];
    /** Working-tree lock captured for stale-plan detection. */
    packageLockSha256: string;
    /** Exact lock in repository.head, which seeds the isolated candidate. */
    headPackageLockSha256: string;
  };
  current: { productVersion: string; piVersion: string; apiProtocolVersion: number };
  workingTree: { productVersion: string; piVersion: string; packageLockSha256: string };
  target: { piVersion: string };
  candidate: {
    strategy: "isolated_git_worktree";
    root: string;
    branch: string;
  };
  expectedChanges: string[];
  validationCommands: string[][];
  rollback: string;
  mutationsCurrentRuntime: false;
}

export class MaintenanceError extends Error {
  constructor(
    public readonly code: "plan_hash_mismatch" | "plan_document_invalid" | "repository_changed" | "candidate_exists" | "candidate_failed",
    message: string,
  ) {
    super(message);
    this.name = "MaintenanceError";
  }
}

export interface MaintenanceCandidate {
  schemaVersion: 1;
  status: "validated";
  planHash: string;
  candidateRoot: string;
  candidateBranch: string;
  disposition: "runtime_candidate" | "full_app_candidate";
  currentApiProtocolVersion: number;
  candidateApiProtocolVersion: number;
  commit: string;
  treeHash: string;
  reportSha256: string;
  changedPaths: string[];
  migration: MaintenanceMigrationReport;
  validation: Array<{ command: string[]; status: "passed"; durationMs: number }>;
  activationRequiresSecondApproval: true;
}

export interface MaintenanceMigrationReport {
  status: "not_run" | "completed";
  summary: string;
  sessionId?: string;
}

export type MaintenanceMigrate = (input: {
  candidateRoot: string;
  plan: MaintenancePlan;
}) => Promise<MaintenanceMigrationReport>;

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function maintenancePlanHash(plan: Omit<MaintenancePlan, "planHash">): string {
  return sha256(stable(plan));
}

function exactVersion(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value)) {
    throw new Error(`${label} must be an exact semantic version.`);
  }
  return value;
}

function statusPath(line: string): string {
  const raw = line.slice(3).trim();
  const renamed = raw.includes(" -> ") ? raw.split(" -> ").at(-1)! : raw;
  return renamed.replace(/^"|"$/g, "");
}

async function defaultExecute(command: string, args: string[], options: { cwd?: string; timeout?: number; env?: NodeJS.ProcessEnv } = {}) {
  return execFileAsync(command, args, { ...options, maxBuffer: 16 * 1024 * 1024 });
}

export async function previewMaintenance(input: {
  repoPath: string;
  targetPiVersion: string;
  candidateRoot: string;
  execute?: MaintainerExecute;
}): Promise<MaintenancePlan> {
  const execute = input.execute ?? defaultExecute;
  const repoPath = await realpath(resolve(input.repoPath));
  if (!(await stat(repoPath)).isDirectory()) throw new Error("Maintainer repository grant must be a directory.");
  const topLevel = String((await execute("/usr/bin/git", ["rev-parse", "--show-toplevel"], { cwd: repoPath, timeout: 15_000 })).stdout).trim();
  if (await realpath(topLevel) !== repoPath) throw new Error("Maintainer grant must target the Git repository root exactly.");
  const [workingPackageRaw, workingLockRaw, headResult, branchResult, statusResult, headPackageResult, headLockResult] = await Promise.all([
    readFile(`${repoPath}/package.json`, "utf8"),
    readFile(`${repoPath}/package-lock.json`),
    execute("/usr/bin/git", ["rev-parse", "HEAD"], { cwd: repoPath, timeout: 15_000 }),
    execute("/usr/bin/git", ["branch", "--show-current"], { cwd: repoPath, timeout: 15_000 }),
    execute("/usr/bin/git", ["status", "--porcelain=v1", "--untracked-files=normal"], { cwd: repoPath, timeout: 15_000 }),
    execute("/usr/bin/git", ["show", "HEAD:package.json"], { cwd: repoPath, timeout: 15_000 }),
    execute("/usr/bin/git", ["show", "HEAD:package-lock.json"], { cwd: repoPath, timeout: 15_000 }),
  ]);
  const headPackageDocument = JSON.parse(String(headPackageResult.stdout)) as { version?: unknown; dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
  const workingPackageDocument = JSON.parse(workingPackageRaw) as { version?: unknown; dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
  const packageVersions = (document: typeof headPackageDocument, label: string) => {
    const piVersions = PI_PACKAGES.map((name) => document.dependencies?.[name] ?? document.devDependencies?.[name]);
    if (piVersions.some((version) => version !== piVersions[0])) throw new Error(`${label} Pi package versions must be pinned together before Maintainer can upgrade them.`);
    return {
      productVersion: exactVersion(document.version, `${label} product version`),
      piVersion: exactVersion(piVersions[0], `${label} Pi version`),
    };
  };
  const current = packageVersions(headPackageDocument, "HEAD");
  const workingTree = packageVersions(workingPackageDocument, "Working-tree");
  const targetPiVersion = exactVersion(input.targetPiVersion, "Target Pi version");
  const statusLines = String(statusResult.stdout).split(/\r?\n/).filter(Boolean);
  const changedPaths = statusLines.map(statusPath).sort();
  const candidateRoot = resolve(input.candidateRoot);
  const seed = sha256(`${repoPath}\0${String(headResult.stdout).trim()}\0${targetPiVersion}\0${candidateRoot}`).slice(0, 12);
  const unsigned: Omit<MaintenancePlan, "planHash"> = {
    schemaVersion: 1,
    mode: "preview",
    repository: {
      path: repoPath,
      head: String(headResult.stdout).trim(),
      branch: String(branchResult.stdout).trim() || "detached",
      dirty: changedPaths.length > 0,
      changedPaths,
      packageLockSha256: sha256(workingLockRaw),
      headPackageLockSha256: sha256(String(headLockResult.stdout)),
    },
    current: {
      ...current,
      apiProtocolVersion: LA_API_PROTOCOL_VERSION,
    },
    workingTree: { ...workingTree, packageLockSha256: sha256(workingLockRaw) },
    target: { piVersion: targetPiVersion },
    candidate: {
      strategy: "isolated_git_worktree",
      root: candidateRoot,
      branch: `codex/maintainer-pi-${targetPiVersion.replace(/[^0-9A-Za-z.-]/g, "-")}-${seed}`,
    },
    expectedChanges: ["package.json", "package-lock.json", "Pi compatibility migrations if validation requires them"],
    validationCommands: [
      ["npm", "test"],
      ["npm", "run", "typecheck"],
      ["npm", "run", "mac:build"],
      ["npm", "run", "mac:test"],
      ["npm", "run", "mac:verify"],
      ["npm", "run", "release:check"],
      ["npm", "run", "release:mac", "--", "--dry-run"],
      ["npm", "run", "runtime:health"],
      ["npm", "run", "rc:status"],
    ],
    rollback: "Remove the isolated worktree and branch before activation, or let the Electron runtime installer restore its retained runtime backup after a failed health check.",
    mutationsCurrentRuntime: false,
  };
  return { ...unsigned, planHash: maintenancePlanHash(unsigned) };
}

export async function buildMaintenanceCandidate(input: {
  plan: MaintenancePlan;
  approvedPlanHash: string;
  execute?: MaintainerExecute;
  migrate?: MaintenanceMigrate;
}): Promise<MaintenanceCandidate> {
  if (input.approvedPlanHash !== input.plan.planHash) {
    throw new MaintenanceError("plan_hash_mismatch", "Maintenance plan changed; preview and approve the current plan before building a candidate.");
  }
  const { planHash: _planHash, ...unsigned } = input.plan;
  if (maintenancePlanHash(unsigned) !== input.plan.planHash) {
    throw new MaintenanceError("plan_document_invalid", "Maintenance plan content does not match its planHash.");
  }
  const execute = input.execute ?? defaultExecute;
  const [head, lock] = await Promise.all([
    execute("/usr/bin/git", ["rev-parse", "HEAD"], { cwd: input.plan.repository.path, timeout: 15_000 }),
    readFile(`${input.plan.repository.path}/package-lock.json`),
  ]);
  if (String(head.stdout).trim() !== input.plan.repository.head || sha256(lock) !== input.plan.repository.packageLockSha256) {
    throw new MaintenanceError("repository_changed", "Repository HEAD or dependency lock changed after preview; create a new maintenance plan.");
  }
  if (await access(input.plan.candidate.root).then(() => true, () => false)) {
    throw new MaintenanceError("candidate_exists", "The approved candidate path already exists; preview again to obtain a new isolated path.");
  }
  for (const command of input.plan.validationCommands) {
    if (!ALLOWED_VALIDATIONS.has(command.join(" "))) {
      throw new MaintenanceError("plan_document_invalid", `Maintenance validation command is not allowed: ${command.join(" ")}`);
    }
  }
  await mkdir(dirname(input.plan.candidate.root), { recursive: true });
  const validation: MaintenanceCandidate["validation"] = [];
  try {
    await execute("/usr/bin/git", [
      "worktree", "add", "-b", input.plan.candidate.branch,
      input.plan.candidate.root, input.plan.repository.head,
    ], { cwd: input.plan.repository.path, timeout: 60_000 });
    const candidateBaselineLock = await readFile(`${input.plan.candidate.root}/package-lock.json`);
    if (sha256(candidateBaselineLock) !== input.plan.repository.headPackageLockSha256) {
      throw new Error("candidate package lock does not match the approved HEAD baseline");
    }
    await execute("/usr/bin/env", [
      "npm", "install", "--package-lock-only", "--ignore-scripts", "--save-exact",
      ...PI_PACKAGES.map((name) => `${name}@${input.plan.target.piVersion}`),
    ], { cwd: input.plan.candidate.root, timeout: 10 * 60_000 });
    await execute("/usr/bin/env", ["npm", "ci", "--ignore-scripts"], { cwd: input.plan.candidate.root, timeout: 15 * 60_000 });
    await execute("/usr/bin/env", ["npm", "--prefix", "apps/desktop", "ci", "--ignore-scripts"], { cwd: input.plan.candidate.root, timeout: 15 * 60_000 });
    const migration = input.migrate
      ? await input.migrate({ candidateRoot: input.plan.candidate.root, plan: input.plan })
      : { status: "not_run" as const, summary: "No Maintainer migration Agent was configured." };
    for (const command of input.plan.validationCommands) {
      const startedAt = Date.now();
      await execute("/usr/bin/env", command, { cwd: input.plan.candidate.root, timeout: 45 * 60_000 });
      validation.push({ command, status: "passed", durationMs: Date.now() - startedAt });
    }
    const protocolSource = await readFile(`${input.plan.candidate.root}/packages/cat-server/src/runtime_compatibility.ts`, "utf8");
    const match = protocolSource.match(/LA_API_PROTOCOL_VERSION\s*=\s*(\d+)/);
    if (!match) throw new Error("candidate runtime protocol is unreadable");
    const candidateApiProtocolVersion = Number(match[1]);
    const [candidateHead, status, diff, candidateLock] = await Promise.all([
      execute("/usr/bin/git", ["rev-parse", "HEAD"], { cwd: input.plan.candidate.root, timeout: 15_000 }),
      execute("/usr/bin/git", ["status", "--porcelain=v1", "--untracked-files=normal"], { cwd: input.plan.candidate.root, timeout: 15_000 }),
      execute("/usr/bin/git", ["diff", "--binary", "--no-ext-diff"], { cwd: input.plan.candidate.root, timeout: 30_000 }),
      readFile(`${input.plan.candidate.root}/package-lock.json`),
    ]);
    const treeHash = sha256(stable({
      head: String(candidateHead.stdout).trim(),
      status: String(status.stdout),
      diff: String(diff.stdout),
      packageLockSha256: sha256(candidateLock),
    }));
    const changedPaths = String(status.stdout).split(/\r?\n/).filter(Boolean).map(statusPath).sort();
    const reportCore = {
      schemaVersion: 1 as const,
      status: "validated" as const,
      planHash: input.plan.planHash,
      candidateRoot: input.plan.candidate.root,
      candidateBranch: input.plan.candidate.branch,
      disposition: candidateApiProtocolVersion === input.plan.current.apiProtocolVersion
        ? "runtime_candidate" as const
        : "full_app_candidate" as const,
      currentApiProtocolVersion: input.plan.current.apiProtocolVersion,
      candidateApiProtocolVersion,
      commit: String(candidateHead.stdout).trim(),
      treeHash,
      changedPaths,
      migration,
      validation,
      activationRequiresSecondApproval: true as const,
    };
    return { ...reportCore, reportSha256: sha256(stable(reportCore)) };
  } catch (error) {
    if (error instanceof MaintenanceError) throw error;
    const cause = error instanceof Error ? error.message : String(error);
    throw new MaintenanceError("candidate_failed", `Maintenance candidate remains isolated at ${input.plan.candidate.root}; validation failed: ${cause}`);
  }
}
