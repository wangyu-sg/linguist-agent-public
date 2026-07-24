import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { promisify } from "node:util";
import { inspectRuntime } from "./runtime-client.mjs";

const execFileAsync = promisify(execFile);
const MANIFEST_NAME = "runtime.manifest.json";
const ARCHIVE_NAME = "runtime.tar.gz";
const PRESERVED_DIRECTORIES = Object.freeze(["data", ".la-runtime-data-backups"]);
const SETUP_REQUIRED_NATIVE_CAPABILITIES = Object.freeze({
  browser: { minimumNodeVersion: "22.19.0", setupRequirement: "agent_browser_executable" },
  computer: { minimumNodeVersion: "20.6.0", setupRequirement: "signed_helper_accessibility_screen_recording" },
});

function nativePackageReadinessIsValid(entry) {
  const setup = SETUP_REQUIRED_NATIVE_CAPABILITIES[entry?.id];
  if (setup) {
    return entry.runtimeReadiness === "setup_required"
      && entry.activation === "on-demand"
      && entry.minimumNodeVersion === setup.minimumNodeVersion
      && entry.setupRequirement === setup.setupRequirement;
  }
  return entry?.runtimeReadiness === "ready"
    && typeof entry.activation === "string"
    && entry.setupRequirement === undefined;
}

async function defaultExecute(command, args, options = {}) {
  return execFileAsync(command, args, {
    ...options,
    maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
  });
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function backupName(date) {
  return `runtime-${date.toISOString().replaceAll(/[-:.]/g, "")}`;
}

function installFailure(code, message, rollback = "not-needed") {
  return { ok: false, status: "failed", code, message, rollback };
}

async function readBundle(bundleRoot) {
  const manifestPath = join(bundleRoot, MANIFEST_NAME);
  const archivePath = join(bundleRoot, ARCHIVE_NAME);
  try {
    const metadata = await stat(manifestPath);
    if (!metadata.isFile() || metadata.size > 64 * 1024) throw new Error("manifest size is invalid");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (
      manifest?.schemaVersion !== 2
      || manifest.archive !== ARCHIVE_NAME
      || !/^[0-9a-f]{64}$/.test(manifest.sha256)
      || typeof manifest.productVersion !== "string"
      || !manifest.productVersion.trim()
      || manifest.launcher?.executableMode !== "current-app-executable"
      || manifest.launcher?.entry !== "runtime-launcher.mjs"
      || !/^[0-9a-f]{64}$/.test(manifest.launcher?.sha256)
      || manifest.dependencies?.mode !== "bundled-production"
      || manifest.dependencies?.root !== "node_modules"
      || !/^[0-9a-f]{64}$/.test(manifest.dependencies?.packageLockSha256)
      || manifest.dependencies?.nativeCapabilityAgentDir !== "native-capabilities"
      || !/^[0-9a-f]{64}$/.test(manifest.dependencies?.nativeCapabilityLockSha256)
      || !Array.isArray(manifest.dependencies?.nativePackages)
      || manifest.dependencies.nativePackages.length !== 7
      || manifest.dependencies.nativePackages.some((entry) => !nativePackageReadinessIsValid(entry))
      || manifest.resources?.pi !== ".pi"
      || manifest.resources?.patches !== "patches"
    ) throw new Error("manifest shape is invalid");
    const archive = await readFile(archivePath);
    const actual = createHash("sha256").update(archive).digest("hex");
    if (actual !== manifest.sha256) throw new Error("archive hash does not match manifest");
    return { archivePath, manifest };
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new Error(`bundled runtime is unavailable or invalid: ${cause}`);
  }
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function verifyStagedRuntime(stagingRoot, manifest) {
  const stagedPackage = JSON.parse(await readFile(join(stagingRoot, "package.json"), "utf8"));
  if (stagedPackage?.name !== "linguist-agent" || stagedPackage.version !== manifest.productVersion) {
    throw new Error("runtime package identity does not match its manifest");
  }
  const launcherPath = join(stagingRoot, manifest.launcher.entry);
  const rootLockPath = join(stagingRoot, "package-lock.json");
  const nativeRoot = join(stagingRoot, manifest.dependencies.nativeCapabilityAgentDir, "npm");
  const nativeLockPath = join(nativeRoot, "package-lock.json");
  if (await sha256(launcherPath) !== manifest.launcher.sha256) throw new Error("runtime launcher hash does not match manifest");
  if (await sha256(rootLockPath) !== manifest.dependencies.packageLockSha256) throw new Error("runtime dependency lock hash does not match manifest");
  if (await sha256(nativeLockPath) !== manifest.dependencies.nativeCapabilityLockSha256) throw new Error("native capability lock hash does not match manifest");
  const nativeLock = JSON.parse(await readFile(nativeLockPath, "utf8"));
  for (const expected of manifest.dependencies.nativePackages) {
    if (
      typeof expected?.name !== "string"
      || typeof expected?.version !== "string"
      || typeof expected?.integrity !== "string"
      || nativeLock.packages?.[`node_modules/${expected.name}`]?.version !== expected.version
      || nativeLock.packages?.[`node_modules/${expected.name}`]?.integrity !== expected.integrity
    ) throw new Error("native capability Package identity does not match manifest");
    const installed = JSON.parse(await readFile(join(nativeRoot, "node_modules", ...expected.name.split("/"), "package.json"), "utf8"));
    if (installed.name !== expected.name || installed.version !== expected.version) {
      throw new Error(`native capability Package is missing: ${expected.name}@${expected.version}`);
    }
  }
  await Promise.all([
    access(join(stagingRoot, "node_modules", "@earendil-works", "pi-coding-agent", "package.json")),
    access(join(stagingRoot, "packages", "cat-server", "src", "server.js")),
    access(join(stagingRoot, "packages", "cat-server", "src", "install_resident.js")),
    access(join(stagingRoot, ".pi", "APPEND_SYSTEM.md")),
    access(join(stagingRoot, "patches", "pi-ask-headless-v1", "src", "index.ts")),
  ]);
}

function archiveEntriesAreSafe(output) {
  return output.split(/\r?\n/).filter(Boolean).every((entry) => {
    if (entry.startsWith("/")) return false;
    return !entry.split("/").some((part) => part === "..");
  });
}

async function defaultWaitForHealth() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await inspectRuntime()).status === "ready") return true;
    } catch {
      // launchd may need a few seconds to start the newly installed runtime.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function restoreLaunchAgent(launchAgentPath, launchAgentBackup) {
  if (launchAgentBackup === null) {
    await rm(launchAgentPath, { force: true });
    return;
  }
  await mkdir(dirname(launchAgentPath), { recursive: true });
  await writeFile(launchAgentPath, launchAgentBackup);
}

export function createManagedRuntimeInstaller(options = {}) {
  const resourcesPath = options.resourcesPath;
  if (typeof resourcesPath !== "string" || !resourcesPath) throw new TypeError("resourcesPath is required.");
  const homeDirectory = options.homeDirectory ?? homedir();
  const applicationSupportRoot = join(homeDirectory, "Library", "Application Support", "Linguist Agent");
  const runtimeRoot = join(applicationSupportRoot, "runtime");
  const backupsRoot = join(applicationSupportRoot, "runtime-backups");
  const launchAgentPath = join(homeDirectory, "Library", "LaunchAgents", "com.linguist-agent.server.plist");
  const bundleRoot = join(resourcesPath, "runtime");
  const managedCandidateRoot = join(applicationSupportRoot, "maintenance-candidates");
  const execute = options.execute ?? defaultExecute;
  const waitForHealth = options.waitForHealth ?? defaultWaitForHealth;
  const now = options.now ?? (() => new Date());
  const platform = options.platform ?? process.platform;
  const launcherExecutablePath = options.launcherExecutablePath ?? process.execPath;
  const uid = options.uid ?? (typeof process.getuid === "function" ? process.getuid() : 501);
  let activeInstall = null;

  async function stopLaunchAgent() {
    if (!await exists(launchAgentPath)) return;
    try {
      await execute("/bin/launchctl", ["bootout", `gui/${uid}`, launchAgentPath], { timeout: 30_000 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/No such process|Could not find service|Input\/output error/i.test(message)) throw error;
    }
  }

  async function startRestoredLaunchAgent() {
    if (!await exists(launchAgentPath)) return;
    await execute("/bin/launchctl", ["bootstrap", `gui/${uid}`, launchAgentPath], { timeout: 30_000 });
    await execute("/bin/launchctl", ["kickstart", "-k", `gui/${uid}/com.linguist-agent.server`], { timeout: 30_000 });
  }

  async function install(selectedBundleRoot) {
    if (platform !== "darwin") return installFailure("unsupported_platform", "本机 runtime 安装仅支持 macOS。");

    let bundle;
    try {
      bundle = await readBundle(selectedBundleRoot);
    } catch {
      return installFailure("runtime_archive_invalid", "应用内的 runtime 安装包缺失或校验失败。请重新安装 Linguist Agent。");
    }

    try {
      await access(launcherExecutablePath, fsConstants.X_OK);
    } catch {
      return installFailure("launcher_unavailable", "当前 Linguist Agent 可执行文件不可用。请重新安装应用后重试。");
    }

    const suffix = backupName(now()).slice("runtime-".length);
    const stagingRoot = join(applicationSupportRoot, `.runtime-staging-${suffix}`);
    const rollbackRoot = join(backupsRoot, `runtime-${suffix}`);
    let priorRuntime = false;
    let swapped = false;
    let oldStopped = false;
    let launchAgentBackup = null;
    try {
      launchAgentBackup = await readFile(launchAgentPath).catch((error) => {
        if (error?.code === "ENOENT") return null;
        throw error;
      });
      await mkdir(applicationSupportRoot, { recursive: true });
      await mkdir(backupsRoot, { recursive: true });
      await rm(stagingRoot, { recursive: true, force: true });
      await mkdir(stagingRoot, { recursive: true });

      const listing = await execute("/usr/bin/tar", ["-tzf", bundle.archivePath], { timeout: 30_000 });
      if (!archiveEntriesAreSafe(String(listing.stdout ?? ""))) throw new Error("runtime archive contains an unsafe path");
      await execute("/usr/bin/tar", ["-xzf", bundle.archivePath, "-C", stagingRoot], { timeout: 60_000 });
      await verifyStagedRuntime(stagingRoot, bundle.manifest);
      await mkdir(join(stagingRoot, "bin"), { recursive: true });
      await symlink(launcherExecutablePath, join(stagingRoot, "bin", "node"));

      priorRuntime = await exists(runtimeRoot);
      if (priorRuntime) {
        try {
          await stopLaunchAgent();
        } finally {
          oldStopped = true;
        }
        await rename(runtimeRoot, rollbackRoot);
        if (launchAgentBackup) await writeFile(join(rollbackRoot, ".la-launch-agent.plist"), launchAgentBackup);
      }

      await rename(stagingRoot, runtimeRoot);
      swapped = true;
      if (priorRuntime) {
        for (const name of PRESERVED_DIRECTORIES) {
          const source = join(rollbackRoot, name);
          if (await exists(source)) await rename(source, join(runtimeRoot, name));
        }
      }

      const environment = {
        ...process.env,
        HOME: homeDirectory,
        PATH: `${join(runtimeRoot, "bin")}:${join(runtimeRoot, "node_modules", ".bin")}:/usr/bin:/bin:/usr/sbin:/sbin`,
        ELECTRON_RUN_AS_NODE: "1",
        LA_RESIDENT_EXECUTABLE: launcherExecutablePath,
        LA_RESIDENT_ENTRY: join(runtimeRoot, bundle.manifest.launcher.entry),
        LA_NATIVE_CAPABILITY_AGENT_DIR: join(runtimeRoot, bundle.manifest.dependencies.nativeCapabilityAgentDir),
      };
      await execute(launcherExecutablePath, [join(runtimeRoot, "packages", "cat-server", "src", "install_resident.js")], {
        cwd: runtimeRoot,
        env: environment,
        timeout: 60_000,
      });
      if (!await waitForHealth()) throw new Error("runtime health check did not become ready");
      return {
        ok: true,
        status: "ready",
        code: priorRuntime ? "runtime_repaired" : "runtime_installed",
        message: priorRuntime ? "本机 runtime 已修复，项目数据和备份均已保留。" : "本机 runtime 已安装并启动。",
        rollback: priorRuntime ? "available" : "not-needed",
      };
    } catch {
      let rollback = priorRuntime || launchAgentBackup ? "restored" : "not-needed";
      try {
        if (swapped && await exists(runtimeRoot)) {
          await stopLaunchAgent().catch(() => undefined);
          if (priorRuntime && await exists(rollbackRoot)) {
            for (const name of PRESERVED_DIRECTORIES) {
              const source = join(runtimeRoot, name);
              if (await exists(source)) await rename(source, join(rollbackRoot, name));
            }
          }
          await rm(runtimeRoot, { recursive: true, force: true });
        }
        if (priorRuntime && await exists(rollbackRoot)) {
          await rename(rollbackRoot, runtimeRoot);
          await rm(join(runtimeRoot, ".la-launch-agent.plist"), { force: true });
        }
        await restoreLaunchAgent(launchAgentPath, launchAgentBackup);
        if ((priorRuntime || oldStopped) && launchAgentBackup) await startRestoredLaunchAgent();
      } catch {
        rollback = "failed";
      } finally {
        await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
      }
      return installFailure(
        rollback === "failed" ? "runtime_install_and_rollback_failed" : "runtime_install_failed",
        rollback === "failed"
          ? "runtime 安装失败，旧版本未能自动恢复。项目数据仍保留，请联系支持。"
          : priorRuntime
            ? "runtime 安装未完成；原来的 runtime 和项目数据已经恢复。"
            : "runtime 安装未完成；应用没有留下不完整的 runtime。",
        rollback,
      );
    }
  }

  async function restartRuntime() {
    if (platform !== "darwin") return installFailure("unsupported_platform", "本机 runtime 重启仅支持 macOS。");
    if (!await exists(launchAgentPath)) {
      return installFailure("runtime_not_installed", "没有发现已安装的本机 runtime。请先执行“修复本机 runtime”。");
    }
    try {
      await execute("/bin/launchctl", ["kickstart", "-k", `gui/${uid}/com.linguist-agent.server`], { timeout: 30_000 });
      if (!await waitForHealth()) throw new Error("runtime health check did not become ready");
      return {
        ok: true,
        status: "ready",
        code: "runtime_restarted",
        message: "本机 runtime 已重启，项目数据未被修改。",
        rollback: "not-needed",
      };
    } catch {
      return installFailure("runtime_restart_failed", "本机 runtime 没有在重启后恢复健康。请使用“修复本机 runtime”重新部署已签名的运行时。");
    }
  }

  return Object.freeze({
    installOrRepair() {
      if (!activeInstall) activeInstall = install(bundleRoot).finally(() => { activeInstall = null; });
      return activeInstall;
    },
    async restart() {
      // Never race a filesystem swap with launchctl. A requested restart after
      // a repair is resolved only once the repair outcome is known.
      if (activeInstall) await activeInstall;
      return restartRuntime();
    },
    async installCandidate(input) {
      if (!input || typeof input.bundleRoot !== "string" || !input.bundleRoot.trim()) {
        return installFailure("candidate_path_not_managed", "Maintainer candidate path is missing.");
      }
      let candidate;
      let allowed;
      try {
        [candidate, allowed] = await Promise.all([realpath(input.bundleRoot), realpath(managedCandidateRoot)]);
      } catch {
        return installFailure("candidate_path_not_managed", "Maintainer candidate is not inside the managed candidate directory.");
      }
      const rel = relative(allowed, candidate);
      if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
        return installFailure("candidate_path_not_managed", "Maintainer candidate is not inside the managed candidate directory.");
      }
      if (!activeInstall) activeInstall = install(candidate).finally(() => { activeInstall = null; });
      return activeInstall;
    },
  });
}
