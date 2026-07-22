import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createManagedRuntimeInstaller } from "../src/runtime-installer.mjs";

const run = promisify(execFile);
const NATIVE_PACKAGES = [
  ["@eko24ive/pi-ask", "1.1.0", "sha512-ask"],
  ["@getpipher/vision", "0.5.1", "sha512-vision"],
  ["@injaneity/pi-computer-use", "0.4.3", "sha512-computer"],
  ["pi-agent-browser-native", "0.2.67", "sha512-browser"],
  ["pi-docparser", "3.0.1", "sha512-docparser"],
  ["pi-subagents", "0.35.1", "sha512-subagents"],
  ["pi-web-access", "0.13.0", "sha512-web"],
];
const NATIVE_PACKAGE_RUNTIME = {
  "@eko24ive/pi-ask": { id: "ask", activation: "main", runtimeReadiness: "ready" },
  "@getpipher/vision": { id: "vision", activation: "experimental", runtimeReadiness: "ready" },
  "@injaneity/pi-computer-use": {
    id: "computer",
    activation: "on-demand",
    runtimeReadiness: "setup_required",
    minimumNodeVersion: "20.6.0",
    setupRequirement: "signed_helper_accessibility_screen_recording",
  },
  "pi-agent-browser-native": {
    id: "browser",
    activation: "on-demand",
    runtimeReadiness: "setup_required",
    minimumNodeVersion: "22.19.0",
    setupRequirement: "agent_browser_executable",
  },
  "pi-docparser": { id: "docparser", activation: "core", runtimeReadiness: "ready" },
  "pi-subagents": { id: "subagents", activation: "team", runtimeReadiness: "ready" },
  "pi-web-access": { id: "research", activation: "on-demand", runtimeReadiness: "ready" },
};

async function digest(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function writeLauncher(root) {
  const path = join(root, "Linguist Agent");
  await writeFile(path, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  return path;
}

async function writeRuntimeBundle(resourcesPath, marker = "new-runtime") {
  const source = join(resourcesPath, "source");
  const bundle = join(resourcesPath, "runtime");
  const archive = join(bundle, "runtime.tar.gz");
  await mkdir(source, { recursive: true });
  await mkdir(bundle, { recursive: true });
  await mkdir(join(source, "node_modules", "@earendil-works", "pi-coding-agent"), { recursive: true });
  await mkdir(join(source, "packages", "cat-server", "src"), { recursive: true });
  await mkdir(join(source, ".pi"), { recursive: true });
  await mkdir(join(source, "patches", "pi-ask-headless-v1", "src"), { recursive: true });
  await mkdir(join(source, "native-capabilities", "npm", "node_modules"), { recursive: true });
  await writeFile(join(source, "package.json"), `${JSON.stringify({ name: "linguist-agent", version: "2.32.7" })}\n`);
  const rootLockPath = join(source, "package-lock.json");
  const launcherPath = join(source, "runtime-launcher.mjs");
  const nativeLockPath = join(source, "native-capabilities", "npm", "package-lock.json");
  await writeFile(rootLockPath, `${JSON.stringify({ lockfileVersion: 3 })}\n`);
  await writeFile(launcherPath, "await import('./packages/cat-server/src/server.js');\n");
  await writeFile(join(source, "node_modules", "@earendil-works", "pi-coding-agent", "package.json"), "{}\n");
  await writeFile(join(source, "packages", "cat-server", "src", "server.js"), "// server\n");
  await writeFile(join(source, "packages", "cat-server", "src", "install_resident.js"), "// installer\n");
  await writeFile(join(source, ".pi", "APPEND_SYSTEM.md"), "runtime policy\n");
  await writeFile(join(source, "patches", "pi-ask-headless-v1", "src", "index.ts"), "// patch\n");
  const nativeLock = { lockfileVersion: 3, packages: { "": { dependencies: {} } } };
  for (const [name, version, integrity] of NATIVE_PACKAGES) {
    nativeLock.packages[""].dependencies[name] = version;
    nativeLock.packages[`node_modules/${name}`] = { version, integrity };
    const packageRoot = join(source, "native-capabilities", "npm", "node_modules", ...name.split("/"));
    await mkdir(packageRoot, { recursive: true });
    await writeFile(join(packageRoot, "package.json"), `${JSON.stringify({ name, version })}\n`);
  }
  await writeFile(nativeLockPath, `${JSON.stringify(nativeLock)}\n`);
  await writeFile(join(source, "marker"), marker);
  await run("/usr/bin/tar", ["-czf", archive, "-C", source, "."]);
  const sha256 = await digest(archive);
  await writeFile(join(bundle, "runtime.manifest.json"), `${JSON.stringify({
    schemaVersion: 2,
    archive: "runtime.tar.gz",
    sha256,
    productVersion: "2.32.7",
    launcher: { executableMode: "current-app-executable", entry: "runtime-launcher.mjs", sha256: await digest(launcherPath) },
    dependencies: {
      mode: "bundled-production",
      root: "node_modules",
      packageLockSha256: await digest(rootLockPath),
      nativeCapabilityAgentDir: "native-capabilities",
      nativeCapabilityLockSha256: await digest(nativeLockPath),
      nativePackages: NATIVE_PACKAGES.map(([name, version, integrity]) => ({
        name,
        version,
        integrity,
        ...NATIVE_PACKAGE_RUNTIME[name],
      })),
    },
    resources: { pi: ".pi", patches: "patches" },
  })}\n`);
}

test("explicit managed runtime install preserves data and retains the previous runtime", async () => {
  const root = await mkdtemp(join(tmpdir(), "la-electron-runtime-install-"));
  const resourcesPath = join(root, "resources");
  const homeDirectory = join(root, "home");
  const runtimeRoot = join(homeDirectory, "Library", "Application Support", "Linguist Agent", "runtime");
  const launcherExecutablePath = await writeLauncher(root);
  await writeRuntimeBundle(resourcesPath);
  await mkdir(join(runtimeRoot, "data"), { recursive: true });
  await mkdir(join(runtimeRoot, ".la-runtime-data-backups"), { recursive: true });
  await writeFile(join(runtimeRoot, "package.json"), `${JSON.stringify({ name: "linguist-agent", version: "2.31.0" })}\n`);
  await writeFile(join(runtimeRoot, "marker"), "old-runtime");
  await writeFile(join(runtimeRoot, "data", "project.json"), "canonical-data");
  await writeFile(join(runtimeRoot, ".la-runtime-data-backups", "manifest.json"), "verified-backup");

  const calls = [];
  const installer = createManagedRuntimeInstaller({
    resourcesPath,
    homeDirectory,
    platform: "darwin",
    launcherExecutablePath,
    execute: async (command, args, options) => {
      calls.push({ command, args, cwd: options?.cwd, home: options?.env?.HOME });
      if (command === "/usr/bin/tar") return run(command, args, options);
      return { stdout: "ok", stderr: "" };
    },
    waitForHealth: async () => true,
    now: () => new Date("2026-07-16T12:00:00.000Z"),
  });

  const result = await installer.installOrRepair();

  assert.equal(result.ok, true);
  assert.equal(await readFile(join(runtimeRoot, "marker"), "utf8"), "new-runtime");
  assert.equal(await readFile(join(runtimeRoot, "data", "project.json"), "utf8"), "canonical-data");
  assert.equal(await readFile(join(runtimeRoot, ".la-runtime-data-backups", "manifest.json"), "utf8"), "verified-backup");
  const backupsRoot = join(homeDirectory, "Library", "Application Support", "Linguist Agent", "runtime-backups");
  assert.equal(await readFile(join(backupsRoot, "runtime-20260716T120000000Z", "marker"), "utf8"), "old-runtime");
  assert.equal(calls.some((call) => call.command.includes("npm") || call.args.includes("ci")), false);
  assert.equal(calls.some((call) => call.command === launcherExecutablePath && call.args[0].endsWith("install_resident.js")), true);
  assert.equal(calls.find((call) => call.command === launcherExecutablePath)?.home, homeDirectory);
  assert.equal(calls.find((call) => call.command === launcherExecutablePath)?.cwd, runtimeRoot);
});

test("invalid bundled runtime fails closed before touching the installed runtime", async () => {
  const root = await mkdtemp(join(tmpdir(), "la-electron-runtime-invalid-"));
  const resourcesPath = join(root, "resources");
  const homeDirectory = join(root, "home");
  const runtimeRoot = join(homeDirectory, "Library", "Application Support", "Linguist Agent", "runtime");
  await writeRuntimeBundle(resourcesPath);
  await writeFile(join(resourcesPath, "runtime", "runtime.tar.gz"), "tampered");
  await mkdir(runtimeRoot, { recursive: true });
  await writeFile(join(runtimeRoot, "marker"), "untouched");
  let executed = false;
  const installer = createManagedRuntimeInstaller({
    resourcesPath,
    homeDirectory,
    platform: "darwin",
    launcherExecutablePath: "/missing/app",
    execute: async () => { executed = true; return { stdout: "", stderr: "" }; },
  });

  const result = await installer.installOrRepair();

  assert.equal(result.ok, false);
  assert.equal(result.code, "runtime_archive_invalid");
  assert.equal(executed, false);
  assert.equal(await readFile(join(runtimeRoot, "marker"), "utf8"), "untouched");
});

test("failed health check restores the old runtime, data, backups, and LaunchAgent", async () => {
  const root = await mkdtemp(join(tmpdir(), "la-electron-runtime-rollback-"));
  const resourcesPath = join(root, "resources");
  const homeDirectory = join(root, "home");
  const runtimeRoot = join(homeDirectory, "Library", "Application Support", "Linguist Agent", "runtime");
  const launchAgentPath = join(homeDirectory, "Library", "LaunchAgents", "com.linguist-agent.server.plist");
  const launcherExecutablePath = await writeLauncher(root);
  await writeRuntimeBundle(resourcesPath);
  await mkdir(join(runtimeRoot, "data"), { recursive: true });
  await mkdir(join(runtimeRoot, ".la-runtime-data-backups"), { recursive: true });
  await mkdir(join(homeDirectory, "Library", "LaunchAgents"), { recursive: true });
  await writeFile(join(runtimeRoot, "package.json"), `${JSON.stringify({ name: "linguist-agent", version: "2.31.0" })}\n`);
  await writeFile(join(runtimeRoot, "marker"), "old-runtime");
  await writeFile(join(runtimeRoot, "data", "project.json"), "canonical-data");
  await writeFile(join(runtimeRoot, ".la-runtime-data-backups", "manifest.json"), "verified-backup");
  await writeFile(launchAgentPath, "old-plist");

  const installer = createManagedRuntimeInstaller({
    resourcesPath,
    homeDirectory,
    platform: "darwin",
    launcherExecutablePath,
    execute: async (command, args, options) => {
      if (command === "/usr/bin/tar") return run(command, args, options);
      if (command === launcherExecutablePath) await writeFile(launchAgentPath, "new-plist");
      return { stdout: "ok", stderr: "" };
    },
    waitForHealth: async () => false,
    now: () => new Date("2026-07-16T13:00:00.000Z"),
  });

  const result = await installer.installOrRepair();

  assert.equal(result.ok, false);
  assert.equal(result.rollback, "restored");
  assert.equal(await readFile(join(runtimeRoot, "marker"), "utf8"), "old-runtime");
  assert.equal(await readFile(join(runtimeRoot, "data", "project.json"), "utf8"), "canonical-data");
  assert.equal(await readFile(join(runtimeRoot, ".la-runtime-data-backups", "manifest.json"), "utf8"), "verified-backup");
  assert.equal(await readFile(launchAgentPath, "utf8"), "old-plist");
});

test("an explicitly approved Maintainer bundle installs only from the managed candidate root", async () => {
  const root = await mkdtemp(join(tmpdir(), "la-electron-runtime-candidate-"));
  const resourcesPath = join(root, "resources-without-runtime");
  const homeDirectory = join(root, "home");
  const applicationSupportRoot = join(homeDirectory, "Library", "Application Support", "Linguist Agent");
  const candidateResources = join(applicationSupportRoot, "maintenance-candidates", "chat-1", "candidate.app", "Contents", "Resources");
  const launcherExecutablePath = await writeLauncher(root);
  await writeRuntimeBundle(candidateResources, "maintainer-runtime");
  const installer = createManagedRuntimeInstaller({
    resourcesPath,
    homeDirectory,
    platform: "darwin",
    launcherExecutablePath,
    execute: async (command, args, options) => {
      if (command === "/usr/bin/tar") return run(command, args, options);
      return { stdout: "ok", stderr: "" };
    },
    waitForHealth: async () => true,
  });

  const denied = await installer.installCandidate({ bundleRoot: join(root, "outside", "runtime") });
  assert.equal(denied.ok, false);
  assert.equal(denied.code, "candidate_path_not_managed");

  const installed = await installer.installCandidate({ bundleRoot: join(candidateResources, "runtime") });
  assert.equal(installed.ok, true);
  assert.equal(await readFile(join(applicationSupportRoot, "runtime", "marker"), "utf8"), "maintainer-runtime");
});
