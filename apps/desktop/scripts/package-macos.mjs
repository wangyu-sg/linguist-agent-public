import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { packager } from "@electron/packager";
import {
  APP_BASENAME,
  APP_ICON,
  DEFAULT_OUTPUT_ROOT,
  DEFAULT_PACKAGE_DIRECTORY,
  DESKTOP_ROOT,
  PACKAGED_SOURCE_FILES,
  PRODUCT_NAME,
  createPackagerOptions,
  resolveCodeSigningIdentity,
} from "./packaging-config.mjs";
import { PATCHES as NATIVE_CAPABILITY_PATCHES } from "./prepare-native-capabilities.mjs";

const run = promisify(execFile);

const NATIVE_CAPABILITY_BUNDLE_PROFILES = Object.freeze({
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
});

// Runtime-only peers needed by approved Packages are bundled and locked, but
// they are not user-selectable capabilities and must not appear in the catalog.
const NATIVE_CAPABILITY_SUPPORT_PACKAGES = Object.freeze({
  "@earendil-works/pi-tui": "0.80.10",
});

function directInvocation() {
  return process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

function parseArguments(argv) {
  const options = { outputRoot: DEFAULT_OUTPUT_ROOT, buildVersion: process.env.LA_BUILD_NUMBER, skipBuild: false };
  for (const argument of argv) {
    if (argument === "--skip-build") options.skipBuild = true;
    else if (argument.startsWith("--output-root=")) options.outputRoot = resolve(argument.slice("--output-root=".length));
    else if (argument.startsWith("--build-version=")) options.buildVersion = argument.slice("--build-version=".length);
    else throw new Error(`Unknown package argument: ${argument}`);
  }
  return options;
}

async function defaultBuildVersion() {
  try {
    const { stdout } = await run("git", ["rev-list", "--count", "HEAD"], { cwd: resolve(DESKTOP_ROOT, "../..") });
    if (/^\d+$/.test(stdout.trim())) return stdout.trim();
  } catch {
    // Source archives without Git metadata still need a valid local build number.
  }
  return "1";
}

async function buildRenderer() {
  await run("npm", ["run", "build"], { cwd: DESKTOP_ROOT, maxBuffer: 16 * 1024 * 1024 });
}

function isRuntimeSource(path) {
  return ["package.json", "package-lock.json"].includes(path)
    || path.startsWith(".pi/")
    || path.startsWith("patches/")
    || /^packages\/[^/]+\/package\.json$/.test(path);
}

export async function createRuntimeBundle(repoRoot, outputDirectory, options = {}) {
  const execute = options.execute ?? run;
  const nativeCapabilitySourceRoot = options.nativeCapabilitySourceRoot
    ?? join(DESKTOP_ROOT, "runtime", "native-capabilities");
  const { stdout } = await execute("git", ["ls-files", "-z", "--cached"], { cwd: repoRoot, maxBuffer: 16 * 1024 * 1024 });
  const files = stdout.split("\0").filter(isRuntimeSource);
  if (!files.includes("package.json") || !files.includes("package-lock.json")) {
    throw new Error("Runtime bundle requires tracked package.json and package-lock.json files.");
  }
  const temporaryRoot = await mkdtemp(join(tmpdir(), "la-electron-runtime-"));
  const stagingRoot = join(temporaryRoot, "runtime");
  const compiledRoot = join(temporaryRoot, "compiled");
  try {
    for (const relativePath of files) {
      const destination = join(stagingRoot, relativePath);
      await mkdir(dirname(destination), { recursive: true });
      await cp(join(repoRoot, relativePath), destination);
    }

    await execute(join(repoRoot, "node_modules", ".bin", "tsc"), [
      "--outDir", compiledRoot,
      "--declaration", "false",
      "--sourceMap", "false",
    ], { cwd: repoRoot, maxBuffer: 32 * 1024 * 1024 });
    for (const packageName of await readdir(compiledRoot)) {
      const compiledPackage = join(compiledRoot, packageName);
      const destination = join(stagingRoot, "packages", packageName);
      await cp(compiledPackage, destination, { recursive: true });
      const manifestPath = join(destination, "package.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      if (manifest.exports) {
        manifest.exports = Object.fromEntries(Object.entries(manifest.exports).map(([key, value]) => [
          key,
          typeof value === "string" ? value.replace(/\.ts$/, ".js") : value,
        ]));
        await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      }
    }

    await execute("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
      cwd: stagingRoot,
      maxBuffer: 32 * 1024 * 1024,
    });

    const nativeAgentDir = join(stagingRoot, "native-capabilities");
    const nativeNpmRoot = join(nativeAgentDir, "npm");
    await mkdir(nativeNpmRoot, { recursive: true });
    await Promise.all([
      cp(join(nativeCapabilitySourceRoot, "package.json"), join(nativeNpmRoot, "package.json")),
      cp(join(nativeCapabilitySourceRoot, "package-lock.json"), join(nativeNpmRoot, "package-lock.json")),
    ]);
    await execute("npm", ["ci", "--omit=dev", "--ignore-scripts", "--legacy-peer-deps", "--no-audit", "--no-fund"], {
      cwd: nativeNpmRoot,
      maxBuffer: 32 * 1024 * 1024,
    });
    for (const patch of NATIVE_CAPABILITY_PATCHES) {
      for (const relativePath of patch.files) {
        const packageDestination = join(nativeNpmRoot, "node_modules", ...patch.packageName.split("/"), relativePath);
        const archiveDestination = join(stagingRoot, "patches", basename(patch.root), relativePath);
        await mkdir(dirname(packageDestination), { recursive: true });
        await mkdir(dirname(archiveDestination), { recursive: true });
        await cp(
          join(patch.root, relativePath),
          packageDestination,
        );
        await cp(
          join(patch.root, relativePath),
          archiveDestination,
        );
      }
    }

    const launcherPath = join(stagingRoot, "runtime-launcher.mjs");
    await cp(join(DESKTOP_ROOT, "runtime", "runtime-launcher.mjs"), launcherPath);
    const rootLockPath = join(stagingRoot, "package-lock.json");
    const nativeLockPath = join(nativeNpmRoot, "package-lock.json");
    const digest = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");
    const nativeLock = JSON.parse(await readFile(nativeLockPath, "utf8"));
    const nativeDependencies = nativeLock.packages[""]?.dependencies ?? {};
    const approvedDependencyNames = [
      ...Object.keys(NATIVE_CAPABILITY_BUNDLE_PROFILES),
      ...Object.keys(NATIVE_CAPABILITY_SUPPORT_PACKAGES),
    ].sort();
    if (JSON.stringify(Object.keys(nativeDependencies).sort()) !== JSON.stringify(approvedDependencyNames)) {
      throw new Error("Native capability Package lock does not match the approved capability and support closure.");
    }
    for (const [name, version] of Object.entries(NATIVE_CAPABILITY_SUPPORT_PACKAGES)) {
      if (nativeDependencies[name] !== version || !nativeLock.packages[`node_modules/${name}`]?.integrity) {
        throw new Error(`Native capability support package ${name}@${version} is missing exact lock metadata.`);
      }
    }
    const nativePackages = Object.entries(nativeDependencies)
      .filter(([name]) => name in NATIVE_CAPABILITY_BUNDLE_PROFILES)
      .map(([name, version]) => ({
      name,
      version,
      integrity: nativeLock.packages[`node_modules/${name}`]?.integrity,
      ...NATIVE_CAPABILITY_BUNDLE_PROFILES[name],
      }));
    if (nativePackages.some((entry) => !entry.integrity)) throw new Error("Native capability Package lock is missing integrity metadata.");
    if (nativePackages.length !== Object.keys(NATIVE_CAPABILITY_BUNDLE_PROFILES).length
      || nativePackages.some((entry) => !entry.id)) {
      throw new Error("Native capability Package lock does not match the approved runtime profiles.");
    }

    await rm(outputDirectory, { recursive: true, force: true });
    await mkdir(outputDirectory, { recursive: true });
    const archivePath = join(outputDirectory, "runtime.tar.gz");
    const archiveEntries = (await readdir(stagingRoot)).sort();
    await execute("/usr/bin/tar", ["-czf", archivePath, "-C", stagingRoot, ...archiveEntries], {
      env: { ...process.env, COPYFILE_DISABLE: "1" },
      maxBuffer: 32 * 1024 * 1024,
    });
    const rootPackage = JSON.parse(await readFile(join(stagingRoot, "package.json"), "utf8"));
    const sha256 = await digest(archivePath);
    await writeFile(join(outputDirectory, "runtime.manifest.json"), `${JSON.stringify({
      schemaVersion: 2,
      archive: "runtime.tar.gz",
      sha256,
      productVersion: rootPackage.version,
      launcher: {
        executableMode: "current-app-executable",
        entry: "runtime-launcher.mjs",
        sha256: await digest(launcherPath),
      },
      dependencies: {
        mode: "bundled-production",
        root: "node_modules",
        packageLockSha256: await digest(rootLockPath),
        nativeCapabilityAgentDir: "native-capabilities",
        nativeCapabilityLockSha256: await digest(nativeLockPath),
        nativePackages,
      },
      resources: { pi: ".pi", patches: "patches" },
    }, null, 2)}\n`);
    return { archivePath, sha256, fileCount: files.length };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function stageApplication(stageDirectory, desktopPackage) {
  await mkdir(join(stageDirectory, "src"), { recursive: true });
  for (const relativePath of PACKAGED_SOURCE_FILES) {
    const destination = join(stageDirectory, relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await cp(join(DESKTOP_ROOT, relativePath), destination);
  }
  await cp(join(DESKTOP_ROOT, "dist", "renderer"), join(stageDirectory, "dist", "renderer"), { recursive: true });
  await writeFile(join(stageDirectory, "package.json"), `${JSON.stringify({
    name: "linguist-agent-desktop",
    productName: PRODUCT_NAME,
    version: desktopPackage.version,
    private: true,
    type: "module",
    main: "src/main.mjs",
  }, null, 2)}\n`);
}

export async function packageMacApp(options = {}) {
  if (process.platform !== "darwin") throw new Error("The signed macOS package must be built on macOS.");
  const signingIdentity = await resolveCodeSigningIdentity(options.environment);
  await access(APP_ICON);
  if (!options.skipBuild) await buildRenderer();

  const desktopPackage = JSON.parse(await readFile(join(DESKTOP_ROOT, "package.json"), "utf8"));
  const electronPackage = JSON.parse(await readFile(join(DESKTOP_ROOT, "node_modules", "electron", "package.json"), "utf8"));
  const buildVersion = options.buildVersion || await defaultBuildVersion();
  const outputRoot = resolve(options.outputRoot || DEFAULT_OUTPUT_ROOT);
  const temporaryRoot = await mkdtemp(join(tmpdir(), "la-electron-package-"));
  const stageDirectory = join(temporaryRoot, "source");
  const packagerOutput = join(temporaryRoot, "packager-output");
  const runtimeBundleDirectory = join(temporaryRoot, "runtime");

  try {
    await createRuntimeBundle(resolve(DESKTOP_ROOT, "../.."), runtimeBundleDirectory);
    await stageApplication(stageDirectory, desktopPackage);
    const packageDirectories = await packager(createPackagerOptions({
      sourceDirectory: stageDirectory,
      outputDirectory: packagerOutput,
      version: desktopPackage.version,
      buildVersion,
      electronVersion: electronPackage.version,
      signingIdentity,
      runtimeBundleDirectory,
    }));
    if (packageDirectories.length !== 1) throw new Error(`Expected one package directory, received ${packageDirectories.length}.`);

    const sourcePackageDirectory = packageDirectories[0];
    const finalPackageDirectory = join(outputRoot, DEFAULT_PACKAGE_DIRECTORY);
    await mkdir(outputRoot, { recursive: true });
    await rm(finalPackageDirectory, { recursive: true, force: true });
    await rename(sourcePackageDirectory, finalPackageDirectory);
    const packagedApp = join(finalPackageDirectory, `${PRODUCT_NAME}.app`);
    const finalApp = join(finalPackageDirectory, `${APP_BASENAME}.app`);
    await rename(packagedApp, finalApp);
    console.log(`Packaged signed app: ${finalApp}`);
    return finalApp;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

if (directInvocation()) {
  packageMacApp(parseArguments(process.argv.slice(2))).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
