import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import {
  DefaultPackageManager,
  ProjectTrustStore,
  SettingsManager,
  getAgentDir,
  type PackageManager,
  type ProgressEvent,
} from "@earendil-works/pi-coding-agent";
import { NATIVE_CAPABILITY_PACKAGES } from "@linguist-agent/cat-runtime";
import type { PiPackageScope } from "./pi_packages.js";
import { applyNativeCapabilityPatch, type NativeCapabilityPatchId } from "./native_capability_patches.js";
import { invalidateTaskRunResourceCache } from "./task_run_resources.js";

export type PiPackageAction = "install" | "remove" | "update";

export class PiPackageActionError extends Error {
  constructor(
    public readonly status: 400 | 409,
    public readonly code: "invalid_request" | "plan_hash_required" | "plan_changed" | "project_untrusted" | "active_runs",
    message: string,
  ) {
    super(message);
    this.name = "PiPackageActionError";
  }
}

export interface PiPackageActionInput {
  action: PiPackageAction;
  scope?: PiPackageScope;
  source?: string;
  projectTrustOverride?: boolean;
  planHash?: string;
}

export interface PiPackageActionEnvironment {
  cwd: string;
  agentDir?: string;
  packageManager?: PackageManager;
  hasActiveRuns?: () => boolean;
  acquireResourceMutation?: () => (() => void) | undefined;
  invalidateResourceCatalogs?: () => void;
}

export interface PiPackageActionResult {
  docs: string;
  action: PiPackageAction;
  source?: string;
  scope: PiPackageScope;
  local: boolean;
  cwd: string;
  agentDir: string;
  projectTrusted: boolean;
  planHash: string;
  events: ProgressEvent[];
  configuredPackages: ReturnType<PackageManager["listConfiguredPackages"]>;
  message: string;
  patches: Array<{
    id: NativeCapabilityPatchId;
    changed: boolean;
    integrity: string;
    targetPaths: string[];
  }>;
  risk: {
    requiresConfirmation: true;
    executesThirdPartyCode: true;
    projectTrustRequired: boolean;
    updateDoesNotSelfUpdatePi: boolean;
    message: string;
  };
}

export interface PiPackageActionPreview {
  mode: "preview";
  action: PiPackageAction;
  source?: string;
  scope: PiPackageScope;
  local: boolean;
  projectTrusted: boolean;
  configuredPackages: ReturnType<PackageManager["listConfiguredPackages"]>;
  planHash: string;
}

const PACKAGE_DOCS = "https://pi.dev/docs/latest/packages";
const packageActionQueues = new Map<string, Promise<void>>();

async function withPackageActionLock<T>(cwd: string, agentDir: string, action: () => Promise<T>): Promise<T> {
  const key = `${resolve(cwd)}\0${resolve(agentDir)}`;
  const previous = packageActionQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolveGate) => { release = resolveGate; });
  const queued = previous.then(() => gate, () => gate);
  packageActionQueues.set(key, queued);
  await previous.catch(() => undefined);
  try {
    return await action();
  } finally {
    release();
    if (packageActionQueues.get(key) === queued) packageActionQueues.delete(key);
  }
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function npmInstallRoot(installedPath: string): string | undefined {
  let cursor = dirname(installedPath);
  while (dirname(cursor) !== cursor) {
    if (basename(cursor) === "node_modules") return dirname(cursor);
    cursor = dirname(cursor);
  }
  return undefined;
}

function installedGitRevision(installedPath: string): string | undefined {
  const gitDir = join(installedPath, ".git");
  try {
    if (!statSync(gitDir).isDirectory()) return undefined;
    const head = readFileSync(join(gitDir, "HEAD"), "utf8").trim();
    if (/^[0-9a-f]{40,64}$/i.test(head)) return head.toLowerCase();
    const ref = head.startsWith("ref: ") ? head.slice(5).trim() : "";
    if (!/^refs\/[A-Za-z0-9._/-]+$/.test(ref) || ref.split("/").includes("..")) return undefined;
    try {
      const revision = readFileSync(join(gitDir, ref), "utf8").trim();
      if (/^[0-9a-f]{40,64}$/i.test(revision)) return revision.toLowerCase();
    } catch {
      const packed = readFileSync(join(gitDir, "packed-refs"), "utf8");
      const match = packed.split("\n").find((line) => line.endsWith(` ${ref}`))?.split(" ")[0];
      if (match && /^[0-9a-f]{40,64}$/i.test(match)) return match.toLowerCase();
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function installedPackageState(installedPath: string | undefined) {
  if (!installedPath) return null;
  const packageJsonPath = join(installedPath, "package.json");
  let raw: Buffer;
  try {
    raw = readFileSync(packageJsonPath);
  } catch {
    try {
      const stat = statSync(installedPath);
      return {
        name: null,
        version: null,
        integrity: null,
        revision: installedGitRevision(installedPath) ?? null,
        manifestHash: sha256(stat.isFile() ? readFileSync(installedPath) : `${stat.size}\0${stat.mtimeMs}`),
      };
    } catch {
      return null;
    }
  }
  try {
    let parsed: { name?: unknown; version?: unknown } = {};
    try {
      parsed = JSON.parse(raw.toString("utf8")) as { name?: unknown; version?: unknown };
    } catch {
      // Keep the raw manifest hash in the plan even when third-party JSON is malformed.
    }
    const name = typeof parsed.name === "string" ? parsed.name : undefined;
    const version = typeof parsed.version === "string" ? parsed.version : undefined;
    const installRoot = npmInstallRoot(installedPath);
    let integrity: string | undefined;
    if (installRoot) {
      const relativePackagePath = relative(join(installRoot, "node_modules"), installedPath);
      for (const lockName of ["package-lock.json", "npm-shrinkwrap.json"]) {
        try {
          const lock = JSON.parse(readFileSync(join(installRoot, lockName), "utf8")) as {
            packages?: Record<string, { integrity?: unknown }>;
            dependencies?: Record<string, { integrity?: unknown }>;
          };
          const value = lock.packages?.[`node_modules/${relativePackagePath}`]?.integrity
            ?? (name ? lock.dependencies?.[name]?.integrity : undefined);
          if (typeof value === "string") {
            integrity = value;
            break;
          }
        } catch {
          // npm integrity is optional; the manifest hash and Git revision still bind the installed state.
        }
      }
    }
    return {
      name: name ?? null,
      version: version ?? null,
      integrity: integrity ?? null,
      revision: installedGitRevision(installedPath) ?? null,
      manifestHash: sha256(raw),
    };
  } catch {
    return { name: null, version: null, integrity: null, revision: null, manifestHash: sha256(raw) };
  }
}

function cleanSource(input: PiPackageActionInput): string | undefined {
  const source = input.source?.trim();
  return source || undefined;
}

async function applyNativeCapabilityPatches(input: {
  action: PiPackageAction;
  source?: string;
  scope: PiPackageScope;
  packageManager: PackageManager;
}) {
  if (input.action === "remove" || input.scope !== "global") return [];
  const results: PiPackageActionResult["patches"] = [];
  for (const entry of NATIVE_CAPABILITY_PACKAGES) {
    if (!("patch" in entry) || (input.source !== undefined && input.source !== entry.source)) continue;
    const installedPath = input.packageManager.getInstalledPath(entry.source, "user");
    if (!installedPath) continue;
    const result = await applyNativeCapabilityPatch(entry.patch as NativeCapabilityPatchId, installedPath);
    results.push({ id: entry.patch as NativeCapabilityPatchId, ...result });
  }
  return results;
}

function actionMessage(input: {
  action: PiPackageAction;
  source?: string;
  scope: PiPackageScope;
}): string {
  if (input.action === "install") return `Installed ${input.source} in ${input.scope} Pi package scope.`;
  if (input.action === "remove") return `Removed ${input.source} from ${input.scope} Pi package scope.`;
  return input.source ? `Updated Pi package ${input.source}.` : "Updated configured Pi packages.";
}

function buildSettingsManager(cwd: string, agentDir: string, projectTrusted: boolean): SettingsManager {
  return SettingsManager.create(cwd, agentDir, { projectTrusted });
}

function resolveProjectTrusted(input: PiPackageActionInput, env: { cwd: string; agentDir: string }): boolean {
  if (input.projectTrustOverride !== undefined) return input.projectTrustOverride;
  return new ProjectTrustStore(env.agentDir).get(env.cwd) === true;
}

function normalizeAction(input: PiPackageActionInput): {
  action: PiPackageAction;
  scope: PiPackageScope;
  local: boolean;
  source?: string;
} {
  const scope = input.scope === "project" ? "project" : "global";
  const source = cleanSource(input);
  if ((input.action === "install" || input.action === "remove") && !source) {
    throw new PiPackageActionError(400, "invalid_request", `Pi package ${input.action} source is required.`);
  }
  return { action: input.action, scope, local: scope === "project", source };
}

function packageActionContext(
  input: PiPackageActionInput,
  env: PiPackageActionEnvironment,
  normalized = normalizeAction(input),
) {
  const agentDir = env.agentDir ?? getAgentDir();
  const projectTrusted = resolveProjectTrusted(input, { cwd: env.cwd, agentDir });
  const settingsManager = buildSettingsManager(env.cwd, agentDir, projectTrusted);
  const packageManager = env.packageManager ?? new DefaultPackageManager({ cwd: env.cwd, agentDir, settingsManager });
  return { ...normalized, agentDir, projectTrusted, settingsManager, packageManager };
}

function actionPreview(context: ReturnType<typeof packageActionContext>): PiPackageActionPreview {
  const configuredPackages = context.packageManager.listConfiguredPackages()
    .map((entry) => ({
      source: entry.source.trim(),
      scope: entry.scope,
      filtered: entry.filtered,
      ...(entry.installedPath === undefined ? {} : { installedPath: entry.installedPath }),
    }))
    .sort((a, b) => {
      const left = `${a.source}\0${a.scope}\0${a.filtered ? 1 : 0}\0${a.installedPath ?? ""}`;
      const right = `${b.source}\0${b.scope}\0${b.filtered ? 1 : 0}\0${b.installedPath ?? ""}`;
      return left < right ? -1 : left > right ? 1 : 0;
    });
  const planHash = createHash("sha256").update(JSON.stringify({
    action: context.action,
    scope: context.scope,
    source: context.source ?? null,
    projectTrusted: context.projectTrusted,
    configuredPackages: configuredPackages.map((entry) => ({
      source: entry.source,
      scope: entry.scope,
      filtered: entry.filtered,
      installedPath: entry.installedPath ?? null,
      installedState: installedPackageState(entry.installedPath),
    })),
  })).digest("hex");
  return {
    mode: "preview",
    action: context.action,
    source: context.source,
    scope: context.scope,
    local: context.local,
    projectTrusted: context.projectTrusted,
    configuredPackages,
    planHash,
  };
}

export async function previewPiPackageAction(
  input: PiPackageActionInput,
  env: PiPackageActionEnvironment,
): Promise<PiPackageActionPreview> {
  return actionPreview(packageActionContext(input, env));
}

export async function runPiPackageAction(input: PiPackageActionInput, env: PiPackageActionEnvironment): Promise<PiPackageActionResult> {
  const normalized = normalizeAction(input);
  if (!input.planHash) {
    throw new PiPackageActionError(400, "plan_hash_required", "Pi package action planHash is required.");
  }
  const agentDir = env.agentDir ?? getAgentDir();
  return withPackageActionLock(env.cwd, agentDir, async () => {
    env.invalidateResourceCatalogs?.();
    const releaseResourceMutation = env.acquireResourceMutation?.();
    try {
      if ((env.acquireResourceMutation && !releaseResourceMutation) || env.hasActiveRuns?.()) {
        throw new PiPackageActionError(
          409,
          "active_runs",
          "Stop every active Agent Run before installing, updating, or removing Pi Packages.",
        );
      }
      const context = packageActionContext(input, { ...env, agentDir }, normalized);
      if (context.local && !context.projectTrusted) {
        throw new PiPackageActionError(
          409,
          "project_untrusted",
          "Project is not trusted. Trust the project or approve this one package action before modifying project-local Pi packages.",
        );
      }
      const preview = actionPreview(context);
      if (preview.planHash !== input.planHash) {
        throw new PiPackageActionError(409, "plan_changed", "Pi package action plan changed; preview again before executing.");
      }
      const { action, scope, local, source, projectTrusted, settingsManager, packageManager } = context;
      const events: ProgressEvent[] = [];
      // Do not let a concurrent Run reuse a verification made before a Package
      // mutation starts, and also clear anything resolved against an
      // intermediate tree if the action fails after partially changing disk.
      invalidateTaskRunResourceCache();
      try {
        packageManager.setProgressCallback((event) => events.push(event));
        if (action === "install") {
          await packageManager.installAndPersist(source!, { local });
        } else if (action === "remove") {
          const removed = await packageManager.removeAndPersist(source!, { local });
          if (!removed) throw new Error(`No matching Pi package found for ${source}.`);
        } else {
          await packageManager.update(source);
        }
        const patches = await applyNativeCapabilityPatches({ action, source, scope, packageManager });
        await settingsManager.flush();
        const errors = settingsManager.drainErrors();
        if (errors.length > 0) {
          throw new Error(errors.map((entry) => `${entry.scope}: ${entry.error.message}`).join("; "));
        }
        return {
          docs: PACKAGE_DOCS,
          action,
          source,
          scope,
          local,
          cwd: env.cwd,
          agentDir,
          projectTrusted,
          planHash: preview.planHash,
          events,
          configuredPackages: packageManager.listConfiguredPackages(),
          message: actionMessage({ action, source, scope }),
          patches,
          risk: {
            requiresConfirmation: true,
            executesThirdPartyCode: true,
            projectTrustRequired: local,
            updateDoesNotSelfUpdatePi: true,
            message: "This action runs Pi's official package manager. npm/git package operations can execute third-party code with the current user's permissions. The LA UI does not run Pi self-update from this endpoint.",
          },
        };
      } finally {
        invalidateTaskRunResourceCache();
      }
    } finally {
      releaseResourceMutation?.();
      env.invalidateResourceCatalogs?.();
    }
  });
}
