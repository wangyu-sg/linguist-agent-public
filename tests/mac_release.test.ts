import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { syncVersions } from "../scripts/version-sync.js";
import { createMacReleasePlan, runMacRelease } from "../scripts/mac-release.js";

const execFileAsync = promisify(execFile);

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function run(command: string, args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync(command, args, { cwd });
  return stdout;
}

async function commitAndPush(cwd: string, message: string): Promise<void> {
  await run("git", ["add", "."], cwd);
  await run("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-m", message], cwd);
  await run("git", ["push"], cwd);
}

const root = await mkdtemp(join(tmpdir(), "la-mac-release-"));
await mkdir(join(root, "packages", "cat-data"), { recursive: true });
await mkdir(join(root, "packages", "cat-server"), { recursive: true });
await mkdir(join(root, "apps", "desktop"), { recursive: true });
await writeJson(join(root, "package.json"), {
  name: "linguist-agent",
  version: "2.20.0",
  dependencies: { "@linguist-agent/cat-data": "2.20.0" },
});
await writeJson(join(root, "packages", "cat-data", "package.json"), {
  name: "@linguist-agent/cat-data",
  version: "2.20.0",
});
await writeJson(join(root, "packages", "cat-server", "package.json"), {
  name: "@linguist-agent/cat-server",
  version: "2.20.0",
  dependencies: { "@linguist-agent/cat-data": "2.20.0" },
});
await writeJson(join(root, "apps", "desktop", "package.json"), {
  name: "@linguist-agent/desktop",
  version: "2.20.0",
});
await writeJson(join(root, "package-lock.json"), {
  name: "linguist-agent",
  version: "2.20.0",
  lockfileVersion: 3,
  packages: {
    "": { version: "2.20.0", dependencies: { "@linguist-agent/cat-data": "2.20.0" } },
    "packages/cat-data": { version: "2.20.0" },
    "packages/cat-server": { version: "2.20.0", dependencies: { "@linguist-agent/cat-data": "2.20.0" } },
  },
});
await writeJson(join(root, "apps", "desktop", "package-lock.json"), {
  name: "@linguist-agent/desktop",
  version: "2.20.0",
  lockfileVersion: 3,
  packages: {
    "": { name: "@linguist-agent/desktop", version: "2.20.0" },
  },
});

await assert.rejects(() => syncVersions(root, "2.21.0", { check: true }), /Version mismatch/);
const sync = await syncVersions(root, "2.21.0");
assert.ok(sync.changed.length >= 4);
const rootPkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const serverPkg = JSON.parse(await readFile(join(root, "packages", "cat-server", "package.json"), "utf8"));
const lock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
const desktopPkg = JSON.parse(await readFile(join(root, "apps", "desktop", "package.json"), "utf8"));
const desktopLock = JSON.parse(await readFile(join(root, "apps", "desktop", "package-lock.json"), "utf8"));
assert.equal(rootPkg.version, "2.21.0");
assert.equal(serverPkg.dependencies["@linguist-agent/cat-data"], "2.21.0");
assert.equal(lock.packages["packages/cat-data"].version, "2.21.0");
assert.equal(desktopPkg.version, "2.21.0");
assert.equal(desktopLock.version, "2.21.0");
assert.equal(desktopLock.packages[""].version, "2.21.0");
await syncVersions(root, "2.21.0", { check: true });

const plan = await createMacReleasePlan({
  repoRoot: root,
  channel: "stable",
  env: {
    LA_BUILD_NUMBER: "123",
    LA_DEVELOPER_ID_APPLICATION: "Developer ID Application: Test",
    LA_NOTARY_KEYCHAIN_PROFILE: "la-notary",
  },
});
assert.equal(plan.version, "2.21.0");
assert.equal(plan.buildNumber, "123");
assert.equal(plan.channel, "stable");
assert.equal(plan.releaseTag, "v2.21.0");
assert.equal(plan.missingEnv.length, 0);
assert.ok(plan.zipPath.endsWith("LinguistAgent-v2.21.0.zip"));
assert.ok(plan.dmgPath.endsWith("LinguistAgent-v2.21.0.dmg"));

const betaPlan = await createMacReleasePlan({
  repoRoot: root,
  channel: "beta",
  env: {
    LA_BUILD_NUMBER: "124",
    GITHUB_SHA: "abcdef1234567890",
    LA_DEVELOPER_ID_APPLICATION: "Developer ID Application: Test",
    LA_NOTARY_KEYCHAIN_PROFILE: "la-notary",
  },
});
assert.equal(betaPlan.channel, "beta");
assert.equal(betaPlan.releaseTag, "beta-124-abcdef1");
assert.ok(betaPlan.zipPath.endsWith("LinguistAgent-beta-124-abcdef1.zip"));

await assert.rejects(
  () => runMacRelease({ repoRoot: root, dryRun: true, allowDirty: true, env: { LA_BUILD_NUMBER: "1" } }),
  /Missing release env/,
);

const updateRoot = await mkdtemp(join(tmpdir(), "la-local-update-"));
const updateRemote = await mkdtemp(join(tmpdir(), "la-local-update-remote-"));
await mkdir(join(updateRoot, ".pi"), { recursive: true });
await writeJson(join(updateRoot, "package.json"), { name: "linguist-agent", version: "2.31.37" });
await writeJson(join(updateRoot, ".pi", "settings.json"), { defaultProvider: "deepseek" });
await run("git", ["init", "-b", "main"], updateRoot);
await run("git", ["add", "package.json", ".pi/settings.json"], updateRoot);
await run("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-m", "init"], updateRoot);
await run("git", ["init", "--bare"], updateRemote);
await run("git", ["remote", "add", "origin", updateRemote], updateRoot);
await run("git", ["push", "-u", "origin", "main"], updateRoot);

const updateScript = join(process.cwd(), "scripts", "mac-local-update.sh");
const updateScriptSource = await readFile(updateScript, "utf8");
assert.match(updateScriptSource, /sync_managed_runtime/, "local updater must sync the Application Support managed runtime");
assert.match(updateScriptSource, /--exclude '\.agents'/, "managed runtime must not inherit ignored local Agent resources");
assert.match(updateScriptSource, /--exclude '\.pi\/skills'/, "managed runtime must rebuild its Pi skills from tracked files only");
assert.match(updateScriptSource, /git -C \"\$REPO_ROOT\" ls-files -z '\.pi\/skills\/\*\*'/, "managed runtime must copy only tracked Pi skills");
assert.match(
  updateScriptSource,
  /\.la-migration-backups-preserve/,
  "local updater must preserve verified migration backups while replacing the managed runtime",
);
assert.match(
  updateScriptSource,
  /--exclude '\.la-runtime-data-backups'/,
  "local updater must not copy source-workspace migration backups into the managed runtime",
);
assert.match(updateScriptSource, /npm --prefix "\$root" run server:install/, "local updater must install and start the managed runtime");
assert.doesNotMatch(updateScriptSource, /screen -dmS la-server/, "local updater must not restart the old repo screen server");
assert.match(updateScriptSource, /apps\/desktop.*run package/s, "local updater must build the signed Electron app");
assert.match(updateScriptSource, /apps\/desktop.*run verify/s, "local updater must verify the Electron app before installation");
assert.match(updateScriptSource, /CFBundleExecutable/, "local updater must read the packaged executable name from Info.plist");
assert.doesNotMatch(updateScriptSource, /apps\/mac\/script\/build_and_run\.sh/, "local updater must not build the retired Swift client");
await writeFile(join(updateRoot, "README.md"), "docs\n", "utf8");
await commitAndPush(updateRoot, "docs only");
await run("git", ["reset", "--hard", "HEAD~1"], updateRoot);
const docsOnlyCheck = await run("bash", [updateScript, "--check", "--repo", updateRoot], updateRoot);
assert.match(docsOnlyCheck, /^update_kind=docs$/m, "docs-only updates should not rebuild app or runtime");
await run("git", ["merge", "--ff-only", "origin/main"], updateRoot);
await writeJson(join(updateRoot, "package.json"), { name: "linguist-agent", version: "2.31.38" });
await commitAndPush(updateRoot, "runtime package");
await run("git", ["reset", "--hard", "HEAD~1"], updateRoot);
const runtimeOnlyCheck = await run("bash", [updateScript, "--check", "--repo", updateRoot], updateRoot);
assert.match(runtimeOnlyCheck, /^update_kind=runtime$/m, "runtime-only updates should skip mac app build");
await run("git", ["merge", "--ff-only", "origin/main"], updateRoot);
await mkdir(join(updateRoot, "apps", "desktop", "src"), { recursive: true });
await writeFile(join(updateRoot, "apps", "desktop", "src", "marker.txt"), "electron\n", "utf8");
await commitAndPush(updateRoot, "electron app");
await run("git", ["reset", "--hard", "HEAD~1"], updateRoot);
const appCheck = await run("bash", [updateScript, "--check", "--repo", updateRoot], updateRoot);
assert.match(appCheck, /^update_kind=app_runtime$/m, "Electron app updates should rebuild and sync runtime");
await writeJson(join(updateRoot, ".pi", "settings.json"), { defaultProvider: "openai-codex" });
const configOnlyCheck = await run("bash", [updateScript, "--check", "--repo", updateRoot], updateRoot);
assert.match(configOnlyCheck, /^dirty=0$/m, "local updater should ignore .pi/settings.json runtime config drift");
await writeFile(join(updateRoot, "README.md"), "dirty\n", "utf8");
const realDirtyCheck = await run("bash", [updateScript, "--check", "--repo", updateRoot], updateRoot);
assert.match(realDirtyCheck, /^dirty=1$/m, "local updater must still block real worktree changes");

console.log("mac release tests passed");
