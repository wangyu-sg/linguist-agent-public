import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type {
  MissingSourceAction,
  PackageManager,
  ProgressCallback,
  ProgressEvent,
  ResolvedPaths,
} from "@earendil-works/pi-coding-agent";
import { NATIVE_CAPABILITY_PACKAGES } from "@linguist-agent/cat-runtime";
import {
  ActiveAgentRunRegistry,
  ActiveAgentRunResourceMutationError,
} from "../packages/cat-server/src/active_agent_runs.js";
import {
  PiPackageActionError,
  previewPiPackageAction,
  runPiPackageAction,
} from "../packages/cat-server/src/pi_package_executor.js";
import type { PiPackageActionInput } from "../packages/cat-server/src/pi_package_executor.js";
import { handlePiSettingsRoute, type PiSettingsRouteDeps } from "../packages/cat-server/src/routes/pi_settings_routes.js";

const emptyResolved: ResolvedPaths = { extensions: [], skills: [], prompts: [], themes: [] };

class FakePackageManager implements PackageManager {
  callback?: ProgressCallback;
  calls: Array<{ method: string; source?: string; local?: boolean }> = [];
  configuredPackages: ReturnType<PackageManager["listConfiguredPackages"]> = [
    { source: "npm:@demo/pkg", scope: "user", filtered: false, installedPath: "/tmp/pkg" },
  ];

  setProgressCallback(callback: ProgressCallback | undefined): void {
    this.callback = callback;
  }

  private emit(action: ProgressEvent["action"], source: string): void {
    this.callback?.({ type: "start", action, source, message: `${action} ${source}` });
  }

  async install(source: string, options?: { local?: boolean }): Promise<void> {
    this.calls.push({ method: "install", source, local: options?.local });
  }

  async installAndPersist(source: string, options?: { local?: boolean }): Promise<void> {
    this.calls.push({ method: "installAndPersist", source, local: options?.local });
    this.emit("install", source);
  }

  async remove(source: string, options?: { local?: boolean }): Promise<void> {
    this.calls.push({ method: "remove", source, local: options?.local });
  }

  async removeAndPersist(source: string, options?: { local?: boolean }): Promise<boolean> {
    this.calls.push({ method: "removeAndPersist", source, local: options?.local });
    this.emit("remove", source);
    return source !== "npm:missing";
  }

  async update(source?: string): Promise<void> {
    this.calls.push({ method: "update", source });
    this.emit("update", source ?? "*");
  }

  listConfiguredPackages() {
    return this.configuredPackages;
  }

  resolve(_onMissing?: (source: string) => Promise<MissingSourceAction>): Promise<ResolvedPaths> {
    return Promise.resolve(emptyResolved);
  }

  resolveExtensionSources(_sources: string[], _options?: { local?: boolean; temporary?: boolean }): Promise<ResolvedPaths> {
    return Promise.resolve(emptyResolved);
  }

  addSourceToSettings(_source: string, _options?: { local?: boolean }): boolean {
    return true;
  }

  removeSourceFromSettings(_source: string, _options?: { local?: boolean }): boolean {
    return true;
  }

  getInstalledPath(_source: string, _scope: "user" | "project"): string | undefined {
    return undefined;
  }
}

class MutatingUpdatePackageManager extends FakePackageManager {
  activeUpdates = 0;
  maxConcurrentUpdates = 0;

  constructor(private readonly installedPackageDir: string) {
    super();
    this.configuredPackages = [
      { source: "npm:@demo/pkg", scope: "user", filtered: false, installedPath: installedPackageDir },
    ];
  }

  override async update(source?: string): Promise<void> {
    this.calls.push({ method: "update", source });
    this.activeUpdates += 1;
    this.maxConcurrentUpdates = Math.max(this.maxConcurrentUpdates, this.activeUpdates);
    await new Promise((resolve) => setTimeout(resolve, 25));
    await writeFile(
      join(this.installedPackageDir, "package.json"),
      JSON.stringify({ name: "@demo/pkg", version: "1.0.1" }),
      "utf8",
    );
    this.activeUpdates -= 1;
  }
}

class PausingInstallPackageManager extends FakePackageManager {
  private releaseInstall!: () => void;
  private readonly installGate = new Promise<void>((resolve) => { this.releaseInstall = resolve; });
  private markStarted!: () => void;
  readonly started = new Promise<void>((resolve) => { this.markStarted = resolve; });

  override async installAndPersist(source: string, options?: { local?: boolean }): Promise<void> {
    this.calls.push({ method: "installAndPersist", source, local: options?.local });
    this.markStarted();
    await this.installGate;
  }

  finish(): void {
    this.releaseInstall();
  }
}

class NativePackageManager extends FakePackageManager {
  constructor(
    private readonly source: string,
    private readonly installedPath: string,
  ) {
    super();
    this.configuredPackages = [{ source, scope: "user", filtered: false, installedPath }];
  }

  override getInstalledPath(source: string, scope: "user" | "project"): string | undefined {
    return source === this.source && scope === "user" ? this.installedPath : undefined;
  }
}

const root = await mkdtemp(join(tmpdir(), "la-pi-package-executor-"));
try {
  const env = { cwd: join(root, "repo"), agentDir: join(root, "agent") };

  const askPackage = NATIVE_CAPABILITY_PACKAGES.find(({ id }) => id === "ask")!;
  const askPackageRoot = join(env.agentDir, "npm", "node_modules", "@eko24ive", "pi-ask");
  await mkdir(join(askPackageRoot, "src"), { recursive: true });
  await writeFile(join(askPackageRoot, "package.json"), JSON.stringify({ name: askPackage.packageName, version: askPackage.version }));
  await writeFile(
    join(askPackageRoot, "src", "index.ts"),
    await readFile(join(process.cwd(), "tests", "fixtures", "pi-ask-1.1.0", "index.ts")),
  );
  await writeFile(
    join(askPackageRoot, "src", "ask-tool.ts"),
    await readFile(join(process.cwd(), "tests", "fixtures", "pi-ask-1.1.0", "ask-tool.ts")),
  );
  const nativeManager = new NativePackageManager(askPackage.source, askPackageRoot);
  const nativePreview = await previewPiPackageAction(
    { action: "install", scope: "global", source: askPackage.source },
    { ...env, packageManager: nativeManager },
  );
  const nativeInstall = await runPiPackageAction(
    { action: "install", scope: "global", source: askPackage.source, planHash: nativePreview.planHash },
    { ...env, packageManager: nativeManager },
  );
  assert.deepEqual(nativeInstall.patches.map(({ id, changed, targetPaths }) => ({ id, changed, targetPaths })), [{
    id: "pi-ask-headless-v1",
    changed: true,
    targetPaths: ["src/index.ts", "src/ask-tool.ts"],
  }]);
  assert.deepEqual(
    await readFile(join(askPackageRoot, "src", "ask-tool.ts")),
    await readFile(join(process.cwd(), "patches", "pi-ask-headless-v1", "src", "ask-tool.ts")),
  );

  const previewManager = new FakePackageManager();
  previewManager.configuredPackages = [
    { source: "npm:z", scope: "project", filtered: true },
    { source: "npm:a", scope: "user", filtered: false, installedPath: "/tmp/a" },
  ];
  const preview = await previewPiPackageAction(
    { action: "install", scope: "project", source: "  npm:@demo/pkg  ", projectTrustOverride: true },
    { ...env, packageManager: previewManager },
  );
  assert.equal(preview.action, "install");
  assert.equal(preview.scope, "project");
  assert.equal(preview.source, "npm:@demo/pkg");
  assert.equal(preview.projectTrusted, true);
  assert.deepEqual(preview.configuredPackages.map(({ source }) => source), ["npm:a", "npm:z"]);
  assert.match(preview.planHash, /^[0-9a-f]{64}$/);

  const activeRunManager = new FakePackageManager();
  const activeRunRegistry = new ActiveAgentRunRegistry(0);
  activeRunRegistry.register({ turnId: "active-package-guard", scope: "project" });
  const activeRunPreview = await previewPiPackageAction(
    { action: "install", scope: "global", source: "npm:@demo/pkg" },
    { ...env, packageManager: activeRunManager },
  );
  await assert.rejects(
    () => runPiPackageAction(
      { action: "install", scope: "global", source: "npm:@demo/pkg", planHash: activeRunPreview.planHash },
      {
        ...env,
        packageManager: activeRunManager,
        acquireResourceMutation: () => activeRunRegistry.tryAcquireResourceMutationLease(),
      },
    ),
    (error: unknown) => error instanceof PiPackageActionError
      && error.status === 409
      && error.code === "active_runs",
    "Package mutations must not rewrite Extension or runner files while a canonical Run is active",
  );
  assert.deepEqual(activeRunManager.calls, []);
  activeRunRegistry.unregister("active-package-guard");

  const pausingManager = new PausingInstallPackageManager();
  const concurrentRegistry = new ActiveAgentRunRegistry(0);
  let catalogInvalidations = 0;
  const pausingPreview = await previewPiPackageAction(
    { action: "install", scope: "global", source: "npm:@demo/pkg" },
    { ...env, packageManager: pausingManager },
  );
  const pausingAction = runPiPackageAction(
    { action: "install", scope: "global", source: "npm:@demo/pkg", planHash: pausingPreview.planHash },
    {
      ...env,
      packageManager: pausingManager,
      acquireResourceMutation: () => concurrentRegistry.tryAcquireResourceMutationLease(),
      invalidateResourceCatalogs: () => { catalogInvalidations += 1; },
    },
  );
  await pausingManager.started;
  assert.throws(
    () => concurrentRegistry.acquireRunStartLease(),
    ActiveAgentRunResourceMutationError,
    "a Run must not enter resource resolution while a Package mutation owns the exclusive lease",
  );
  assert.throws(
    () => concurrentRegistry.register({ turnId: "late-run", scope: "project" }),
    ActiveAgentRunResourceMutationError,
    "direct registration must also reject the Package mutation window",
  );
  pausingManager.finish();
  await pausingAction;
  assert.equal(catalogInvalidations, 2, "Package mutation must invalidate capability catalogs before and after disk changes");
  const postMutationStart = concurrentRegistry.acquireRunStartLease();
  concurrentRegistry.register({ turnId: "post-mutation-run", scope: "project" });
  postMutationStart();
  assert.equal(
    concurrentRegistry.tryAcquireResourceMutationLease(),
    undefined,
    "a Package mutation must not enter after a Run has acquired and completed its start lease",
  );
  concurrentRegistry.unregister("post-mutation-run");

  const reorderedManager = new FakePackageManager();
  reorderedManager.configuredPackages = [...previewManager.configuredPackages].reverse();
  const reorderedPreview = await previewPiPackageAction(
    { action: "install", scope: "project", source: "npm:@demo/pkg", projectTrustOverride: true },
    { ...env, packageManager: reorderedManager },
  );
  assert.equal(reorderedPreview.planHash, preview.planHash);

  const installedPackageDir = join(env.agentDir, "npm", "node_modules", "@demo", "pkg");
  const packageLockPath = join(env.agentDir, "npm", "package-lock.json");
  await mkdir(installedPackageDir, { recursive: true });
  const writeInstalledPackageState = async (version: string, integrity: string) => {
    await writeFile(
      join(installedPackageDir, "package.json"),
      JSON.stringify({ name: "@demo/pkg", version }),
      "utf8",
    );
    await writeFile(
      packageLockPath,
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "node_modules/@demo/pkg": { name: "@demo/pkg", version, integrity },
        },
      }),
      "utf8",
    );
  };
  const installedStateManager = new FakePackageManager();
  installedStateManager.configuredPackages = [
    { source: "npm:@demo/pkg", scope: "user", filtered: false, installedPath: installedPackageDir },
  ];
  await writeInstalledPackageState("1.0.0", "sha512-first");
  const firstInstalledPreview = await previewPiPackageAction(
    { action: "update", scope: "global", source: "npm:@demo/pkg" },
    { ...env, packageManager: installedStateManager },
  );
  await writeInstalledPackageState("1.0.0", "sha512-second");
  const changedIntegrityPreview = await previewPiPackageAction(
    { action: "update", scope: "global", source: "npm:@demo/pkg" },
    { ...env, packageManager: installedStateManager },
  );
  assert.notEqual(changedIntegrityPreview.planHash, firstInstalledPreview.planHash);
  await writeInstalledPackageState("1.0.1", "sha512-second");
  const changedVersionPreview = await previewPiPackageAction(
    { action: "update", scope: "global", source: "npm:@demo/pkg" },
    { ...env, packageManager: installedStateManager },
  );
  assert.notEqual(changedVersionPreview.planHash, changedIntegrityPreview.planHash);

  const installedGitPackageDir = join(env.agentDir, "git", "github.com", "demo", "pkg");
  const installedGitRef = join(installedGitPackageDir, ".git", "refs", "heads", "main");
  await mkdir(dirname(installedGitRef), { recursive: true });
  await writeFile(
    join(installedGitPackageDir, "package.json"),
    JSON.stringify({ name: "@demo/git-pkg", version: "1.0.0" }),
    "utf8",
  );
  await writeFile(join(installedGitPackageDir, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");
  await writeFile(installedGitRef, `${"a".repeat(40)}\n`, "utf8");
  const installedGitManager = new FakePackageManager();
  installedGitManager.configuredPackages = [
    {
      source: "git:https://github.com/demo/pkg.git",
      scope: "user",
      filtered: false,
      installedPath: installedGitPackageDir,
    },
  ];
  const firstGitPreview = await previewPiPackageAction(
    { action: "update", scope: "global", source: "git:https://github.com/demo/pkg.git" },
    { ...env, packageManager: installedGitManager },
  );
  await writeFile(installedGitRef, `${"b".repeat(40)}\n`, "utf8");
  const changedGitPreview = await previewPiPackageAction(
    { action: "update", scope: "global", source: "git:https://github.com/demo/pkg.git" },
    { ...env, packageManager: installedGitManager },
  );
  assert.notEqual(changedGitPreview.planHash, firstGitPreview.planHash);

  await writeInstalledPackageState("1.0.0", "sha512-first");
  const concurrentUpdateManager = new MutatingUpdatePackageManager(installedPackageDir);
  const concurrentUpdatePlan = await previewPiPackageAction(
    { action: "update", scope: "global", source: "npm:@demo/pkg" },
    { ...env, packageManager: concurrentUpdateManager },
  );
  const concurrentResults = await Promise.allSettled([
    runPiPackageAction(
      { action: "update", scope: "global", source: "npm:@demo/pkg", planHash: concurrentUpdatePlan.planHash },
      { cwd: `${env.cwd}/.`, agentDir: `${env.agentDir}/.`, packageManager: concurrentUpdateManager },
    ),
    runPiPackageAction(
      { action: "update", scope: "global", source: "npm:@demo/pkg", planHash: concurrentUpdatePlan.planHash },
      { ...env, packageManager: concurrentUpdateManager },
    ),
  ]);
  assert.equal(concurrentResults.filter(({ status }) => status === "fulfilled").length, 1);
  const rejectedConcurrentUpdate = concurrentResults.find(({ status }) => status === "rejected");
  assert.equal(rejectedConcurrentUpdate?.status, "rejected");
  if (rejectedConcurrentUpdate?.status === "rejected") {
    assert.match(String(rejectedConcurrentUpdate.reason), /plan changed/);
  }
  assert.equal(concurrentUpdateManager.calls.length, 1);
  assert.equal(concurrentUpdateManager.maxConcurrentUpdates, 1);

  const missingHashManager = new FakePackageManager();
  await assert.rejects(
    () => runPiPackageAction(
      { action: "install", scope: "global", source: "npm:@demo/pkg" },
      { ...env, packageManager: missingHashManager },
    ),
    (error) => {
      assert.ok(error instanceof PiPackageActionError);
      assert.equal(error.status, 400);
      assert.equal(error.code, "plan_hash_required");
      return true;
    },
  );
  assert.deepEqual(missingHashManager.calls, []);

  const staleHashManager = new FakePackageManager();
  await assert.rejects(
    () => runPiPackageAction(
      { action: "install", scope: "global", source: "npm:@demo/pkg", planHash: "stale" },
      { ...env, packageManager: staleHashManager },
    ),
    (error) => {
      assert.ok(error instanceof PiPackageActionError);
      assert.equal(error.status, 409);
      assert.equal(error.code, "plan_changed");
      return true;
    },
  );
  assert.deepEqual(staleHashManager.calls, []);

  const installManager = new FakePackageManager();
  const installPlan = await previewPiPackageAction(
    { action: "install", scope: "global", source: "npm:@demo/pkg" },
    { ...env, packageManager: installManager },
  );
  const installed = await runPiPackageAction(
    { action: "install", scope: "global", source: "npm:@demo/pkg", planHash: installPlan.planHash },
    { ...env, packageManager: installManager },
  );
  assert.deepEqual(installManager.calls, [{ method: "installAndPersist", source: "npm:@demo/pkg", local: false }]);
  assert.equal(installed.events[0]?.action, "install");
  assert.equal(installed.risk.executesThirdPartyCode, true);
  assert.equal(installed.risk.updateDoesNotSelfUpdatePi, true);

  const untrustedManager = new FakePackageManager();
  const untrustedPlan = await previewPiPackageAction(
    { action: "install", scope: "project", source: "npm:@demo/pkg" },
    { ...env, packageManager: untrustedManager },
  );
  await assert.rejects(
    () => runPiPackageAction(
      { action: "install", scope: "project", source: "npm:@demo/pkg", planHash: untrustedPlan.planHash },
      { ...env, packageManager: untrustedManager },
    ),
    (error) => {
      assert.ok(error instanceof PiPackageActionError);
      assert.equal(error.status, 409);
      assert.equal(error.code, "project_untrusted");
      return true;
    },
  );
  assert.deepEqual(untrustedManager.calls, []);

  const removeManager = new FakePackageManager();
  const removePlan = await previewPiPackageAction(
    { action: "remove", scope: "project", source: "npm:@demo/pkg", projectTrustOverride: true },
    { ...env, packageManager: removeManager },
  );
  const removed = await runPiPackageAction(
    {
      action: "remove",
      scope: "project",
      source: "npm:@demo/pkg",
      projectTrustOverride: true,
      planHash: removePlan.planHash,
    },
    { ...env, packageManager: removeManager },
  );
  assert.deepEqual(removeManager.calls, [{ method: "removeAndPersist", source: "npm:@demo/pkg", local: true }]);
  assert.equal(removed.projectTrusted, true);

  const missingManager = new FakePackageManager();
  const missingPlan = await previewPiPackageAction(
    { action: "remove", scope: "global", source: "npm:missing" },
    { ...env, packageManager: missingManager },
  );
  await assert.rejects(
    () => runPiPackageAction(
      { action: "remove", scope: "global", source: "npm:missing", planHash: missingPlan.planHash },
      { ...env, packageManager: missingManager },
    ),
    /No matching Pi package/,
  );

  const updateManager = new FakePackageManager();
  const updatePlan = await previewPiPackageAction(
    { action: "update", scope: "global" },
    { ...env, packageManager: updateManager },
  );
  const updated = await runPiPackageAction(
    { action: "update", scope: "global", planHash: updatePlan.planHash },
    { ...env, packageManager: updateManager },
  );
  assert.deepEqual(updateManager.calls, [{ method: "update", source: undefined }]);
  assert.equal(updated.message, "Updated configured Pi packages.");

  for (const path of ["/api/pi/packages/action/preview", "/api/pi/packages/action"]) {
    let routedCalls = 0;
    let routedStatus = 0;
    let routedData: any;
    assert.equal(await handlePiSettingsRoute(
      { method: "POST" } as IncomingMessage,
      {} as ServerResponse,
      new URL(`http://127.0.0.1${path}`),
      {
        json: (_res, status, data) => { routedStatus = status; routedData = data; },
        readBody: async () => ({ action: "install", source: "npm:@demo/pkg" }),
        previewPiPackageAction: async () => { routedCalls += 1; return {}; },
        runPiPackageAction: async () => { routedCalls += 1; return {}; },
      } as unknown as PiSettingsRouteDeps,
    ), true);
    assert.equal(routedStatus, 410);
    assert.equal(routedData.error.code, "unsafe_installer_retired");
    assert.equal(routedCalls, 0, "retired endpoints must never reach Pi's code-executing package manager");
  }

  let routedResource: Record<string, unknown> | undefined;
  let routedResourceStatus = 0;
  const resourceHandled = await handlePiSettingsRoute(
    { method: "PUT" } as IncomingMessage,
    {} as ServerResponse,
    new URL("http://127.0.0.1/api/pi/packages/resource"),
    {
      json: (_res, status, _data) => { routedResourceStatus = status; },
      readBody: async () => ({
        type: "skills",
        path: "/tmp/pkg/skills/review/SKILL.md",
        enabled: false,
        source: "npm:@demo/pkg",
        scope: "global",
        origin: "package",
        baseDir: "/tmp/pkg",
      }),
      togglePiPackageResource: async (input) => {
        routedResource = input;
        return { ok: true };
      },
    } as unknown as PiSettingsRouteDeps,
  );
  assert.equal(resourceHandled, true);
  assert.equal(routedResourceStatus, 200);
  assert.deepEqual(routedResource, {
    type: "skills",
    path: "/tmp/pkg/skills/review/SKILL.md",
    enabled: false,
    source: "npm:@demo/pkg",
    scope: "global",
    origin: "package",
    baseDir: "/tmp/pkg",
  });
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("pi_package_executor tests passed");
