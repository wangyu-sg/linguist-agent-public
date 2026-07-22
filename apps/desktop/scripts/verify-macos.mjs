import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { extractFile, getRawHeader, listPackage } from "@electron/asar";
import {
  APP_BASENAME,
  APP_EXECUTABLE,
  APP_ICON,
  BUNDLE_ID,
  DEFAULT_APP_PATH,
  DESKTOP_ROOT,
  PACKAGED_SOURCE_FILES,
  PRODUCT_NAME,
  TARGET_ARCH,
} from "./packaging-config.mjs";

const run = promisify(execFile);
export const CODESIGN_VERIFY_ARGUMENTS = Object.freeze(["--verify", "--deep", "--strict", "--verbose=2"]);
const SETUP_REQUIRED_NATIVE_CAPABILITIES = Object.freeze({
  browser: { minimumNodeVersion: "22.19.0", setupRequirement: "agent_browser_executable" },
  computer: { minimumNodeVersion: "20.6.0", setupRequirement: "signed_helper_accessibility_screen_recording" },
});

function compareVersions(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) - (b[index] ?? 0);
  }
  return 0;
}

function directInvocation() {
  return process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function command(commandPath, arguments_) {
  const result = await run(commandPath, arguments_, { maxBuffer: 16 * 1024 * 1024 });
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

async function plistValue(infoPlist, key) {
  return (await command("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, infoPlist])).trim();
}

async function assertPackagedFileMatches(archive, relativePath) {
  const expected = await readFile(join(DESKTOP_ROOT, relativePath));
  const actual = extractFile(archive, relativePath);
  assert(actual.equals(expected), `Packaged ${relativePath} does not match the built desktop source.`);
}

export async function verifyRuntimeBundle(bundleRoot) {
  const manifestPath = join(bundleRoot, "runtime.manifest.json");
  const archivePath = join(bundleRoot, "runtime.tar.gz");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert(manifest?.schemaVersion === 2, "Bundled runtime manifest schema is invalid.");
  assert(manifest.archive === "runtime.tar.gz", "Bundled runtime manifest archive name is invalid.");
  assert(typeof manifest.productVersion === "string" && manifest.productVersion.length > 0, "Bundled runtime product version is missing.");
  assert(/^[0-9a-f]{64}$/.test(manifest.sha256), "Bundled runtime manifest hash is invalid.");
  assert(manifest.launcher?.executableMode === "current-app-executable", "Bundled runtime launcher mode is invalid.");
  assert(manifest.launcher?.entry === "runtime-launcher.mjs", "Bundled runtime launcher entry is invalid.");
  assert(/^[0-9a-f]{64}$/.test(manifest.launcher?.sha256), "Bundled runtime launcher hash is invalid.");
  assert(manifest.dependencies?.mode === "bundled-production", "Bundled runtime dependency mode is invalid.");
  assert(manifest.dependencies?.root === "node_modules", "Bundled runtime dependency root is invalid.");
  assert(/^[0-9a-f]{64}$/.test(manifest.dependencies?.packageLockSha256), "Bundled runtime dependency lock hash is invalid.");
  assert(manifest.dependencies?.nativeCapabilityAgentDir === "native-capabilities", "Bundled native capability root is invalid.");
  assert(/^[0-9a-f]{64}$/.test(manifest.dependencies?.nativeCapabilityLockSha256), "Bundled native capability lock hash is invalid.");
  assert(Array.isArray(manifest.dependencies?.nativePackages) && manifest.dependencies.nativePackages.length === 7, "Bundled native capability Package list is incomplete.");
  for (const entry of manifest.dependencies.nativePackages) {
    const setup = SETUP_REQUIRED_NATIVE_CAPABILITIES[entry.id];
    if (setup) {
      assert(entry.runtimeReadiness === "setup_required", `Native capability ${entry.id} must remain unavailable before setup.`);
      assert(entry.activation === "on-demand", `Native capability ${entry.id} must remain on-demand.`);
      assert(entry.minimumNodeVersion === setup.minimumNodeVersion, `Native capability ${entry.id} has an invalid Node floor.`);
      assert(entry.setupRequirement === setup.setupRequirement, `Native capability ${entry.id} has an invalid setup requirement.`);
    } else {
      assert(entry.runtimeReadiness === "ready", `Native capability ${entry.id} readiness is invalid.`);
      assert(entry.setupRequirement === undefined, `Native capability ${entry.id} has an unexpected setup requirement.`);
    }
  }
  const actual = createHash("sha256").update(await readFile(archivePath)).digest("hex");
  assert(actual === manifest.sha256, "Bundled runtime archive hash does not match its manifest.");
  const entries = (await command("/usr/bin/tar", ["-tzf", archivePath])).split(/\r?\n/).filter(Boolean);
  assert(entries.includes("package.json"), "Bundled runtime archive is missing package.json.");
  assert(entries.includes("package-lock.json"), "Bundled runtime archive is missing package-lock.json.");
  assert(entries.includes("runtime-launcher.mjs"), "Bundled runtime archive is missing its launcher.");
  assert(entries.includes("packages/cat-server/src/server.js"), "Bundled runtime archive is missing the compiled server.");
  assert(entries.includes("packages/cat-server/src/install_resident.js"), "Bundled runtime archive is missing the compiled resident installer.");
  assert(entries.includes("node_modules/@earendil-works/pi-coding-agent/package.json"), "Bundled runtime archive is missing production Pi dependencies.");
  assert(entries.includes("native-capabilities/npm/package-lock.json"), "Bundled runtime archive is missing the native capability lock.");
  assert(entries.includes("native-capabilities/npm/node_modules/@earendil-works/pi-tui/package.json"), "Bundled native capabilities are missing the Pi TUI peer runtime.");
  assert(entries.includes("native-capabilities/npm/node_modules/@eko24ive/pi-ask/src/index.ts"), "Bundled runtime archive is missing the patched Pi ask Package.");
  assert(entries.includes("native-capabilities/npm/node_modules/@injaneity/pi-computer-use/scripts/setup-helper.mjs"), "Bundled Computer Use Package is missing its explicit setup helper.");
  assert(entries.includes("native-capabilities/npm/node_modules/@injaneity/pi-computer-use/prebuilt/macos/arm64/bridge"), "Bundled Computer Use Package is missing its arm64 helper payload.");
  assert(!entries.includes("native-capabilities/npm/node_modules/.bin/agent-browser"), "Browser capability must not claim an absent agent-browser executable.");
  assert(entries.includes(".pi/APPEND_SYSTEM.md"), "Bundled runtime archive is missing Pi resources.");
  assert(entries.includes("patches/pi-ask-headless-v1/src/index.ts"), "Bundled runtime archive is missing its tracked Package patch.");
  assert(entries.includes("patches/pi-web-access-headless-v1/la-headless.ts"), "Bundled runtime archive is missing the Research headless wrapper.");
  assert(entries.includes("native-capabilities/npm/node_modules/pi-web-access/la-headless.ts"), "Bundled Research Package is missing its headless extension.");
  assert(!entries.some((entry) => entry === "node_modules/.bin/tsx" || entry.startsWith("scripts/")), "Bundled runtime still depends on developer launch scripts.");
  const extractedHash = async (path) => createHash("sha256").update(await command("/usr/bin/tar", ["-xOf", archivePath, path])).digest("hex");
  const extractedJson = async (path) => JSON.parse(await command("/usr/bin/tar", ["-xOf", archivePath, path]));
  assert(await extractedHash("runtime-launcher.mjs") === manifest.launcher.sha256, "Bundled runtime launcher does not match its manifest.");
  assert(await extractedHash("package-lock.json") === manifest.dependencies.packageLockSha256, "Bundled runtime lock does not match its manifest.");
  assert(await extractedHash("native-capabilities/npm/package-lock.json") === manifest.dependencies.nativeCapabilityLockSha256, "Bundled native capability lock does not match its manifest.");
  const browserPackage = await extractedJson("native-capabilities/npm/node_modules/pi-agent-browser-native/package.json");
  const computerPackage = await extractedJson("native-capabilities/npm/node_modules/@injaneity/pi-computer-use/package.json");
  assert(browserPackage.engines?.node === ">=22.19.0", "Bundled browser Package Node requirement changed without review.");
  assert(computerPackage.scripts?.postinstall === "node scripts/setup-helper.mjs --postinstall", "Bundled Computer Use setup contract changed without review.");
  return { productVersion: manifest.productVersion, sha256: manifest.sha256 };
}

async function verifyBundledRuntimeProfiles(runtimeBundleRoot, executable) {
  const extractedRoot = await mkdtemp(join(tmpdir(), "la-electron-runtime-verify-"));
  try {
    await run("/usr/bin/tar", ["-xzf", join(runtimeBundleRoot, "runtime.tar.gz"), "-C", extractedRoot], { maxBuffer: 16 * 1024 * 1024 });
    const moduleUrl = pathToFileURL(join(extractedRoot, "packages", "cat-server", "src", "task_run_resources.js")).href;
    const probe = [
      `(async () => {`,
      `  const mod = await import(${JSON.stringify(moduleUrl)});`,
      `  const cwd = ${JSON.stringify(extractedRoot)};`,
      `  const main = await mod.resolveTaskRunResources("main", { cwd });`,
      `  const research = await mod.resolveTaskRunResources("main", { cwd }, ["research"]);`,
      `  const team = await mod.resolveTaskRunResources("team", { cwd });`,
      `  console.log(JSON.stringify({`,
      `    main: main.manifest.packages.map((entry) => entry.source),`,
      `    research: research.manifest.packages.map((entry) => entry.source),`,
      `    team: team.manifest.packages.map((entry) => entry.source),`,
      `    mainExtensions: main.isolatedResources.extensionPaths,`,
      `    researchExtensions: research.isolatedResources.extensionPaths,`,
      `    teamExtensions: team.isolatedResources.extensionPaths,`,
      `    pi: team.verifiedPiBinaryPath ?? null,`,
      `  }));`,
      `})().catch((error) => { console.error(error); process.exitCode = 1; });`,
    ].join("\n");
    const result = await run(executable, ["-e", probe], {
      cwd: extractedRoot,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        LA_NATIVE_CAPABILITY_AGENT_DIR: join(extractedRoot, "native-capabilities"),
      },
      maxBuffer: 16 * 1024 * 1024,
    });
    const output = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
    assert(output.main.some((source) => source === "npm:pi-docparser@3.0.1"), "Packaged Main profile did not resolve docparser.");
    assert(output.main.some((source) => source === "npm:@eko24ive/pi-ask@1.1.0"), "Packaged Main profile did not resolve the patched ask Package.");
    assert(output.research.some((source) => source === "npm:pi-web-access@0.13.0"), "Packaged Research profile did not resolve pi-web-access.");
    assert(output.researchExtensions.some((path) => path.endsWith("/pi-web-access/la-headless.ts")), "Packaged Research profile did not resolve the headless wrapper.");
    assert(output.team.some((source) => source === "npm:pi-subagents@0.35.1"), "Packaged Team profile did not resolve subagents.");
    assert(output.mainExtensions.every((path) => !/pi-agent-browser-native|pi-computer-use/.test(path)), "Setup-required capabilities leaked into Main.");
    assert(output.teamExtensions.every((path) => !/pi-agent-browser-native|pi-computer-use/.test(path)), "Setup-required capabilities leaked into Team.");
    assert(typeof output.pi === "string" && output.pi.endsWith("/dist/cli.js"), "Packaged Team profile did not resolve its Pi executable.");
  } finally {
    await rm(extractedRoot, { recursive: true, force: true });
  }
}

export async function verifyMacApp(appPath = DEFAULT_APP_PATH) {
  const resolvedApp = resolve(appPath);
  const contents = join(resolvedApp, "Contents");
  const infoPlist = join(contents, "Info.plist");
  const executable = join(contents, "MacOS", APP_EXECUTABLE);
  const archive = join(contents, "Resources", "app.asar");
  const runtimeBundleRoot = join(contents, "Resources", "runtime");
  await Promise.all([access(infoPlist), access(executable), access(archive), access(runtimeBundleRoot)]);

  assert(await plistValue(infoPlist, "CFBundleIdentifier") === BUNDLE_ID, "Unexpected app bundle identifier.");
  assert(await plistValue(infoPlist, "CFBundleExecutable") === APP_EXECUTABLE, "Unexpected app executable name.");
  assert(await plistValue(infoPlist, "CFBundleDisplayName") === PRODUCT_NAME, "Unexpected app display name.");
  assert(await plistValue(infoPlist, "CFBundlePackageType") === "APPL", "Unexpected macOS bundle type.");
  const runtimeBundle = await verifyRuntimeBundle(runtimeBundleRoot);
  assert(runtimeBundle.productVersion === await plistValue(infoPlist, "CFBundleShortVersionString"), "Bundled runtime version does not match the app version.");
  const packagedIcon = join(contents, "Resources", await plistValue(infoPlist, "CFBundleIconFile"));
  assert((await readFile(packagedIcon)).equals(await readFile(APP_ICON)), "Packaged product icon does not match the Linguist Agent icon.");
  assert(await plistValue(infoPlist, "ElectronAsarIntegrity:Resources/app.asar:algorithm") === "SHA256", "Missing ASAR integrity algorithm.");

  const expectedIntegrity = await plistValue(infoPlist, "ElectronAsarIntegrity:Resources/app.asar:hash");
  const actualIntegrity = createHash("sha256").update(getRawHeader(archive).headerString).digest("hex");
  assert(actualIntegrity === expectedIntegrity, "ASAR header integrity does not match Info.plist.");

  const archiveEntries = listPackage(archive, { isPack: false }).map((entry) => entry.replace(/^\//, ""));
  const archiveSet = new Set(archiveEntries);
  for (const relativePath of [...PACKAGED_SOURCE_FILES, "package.json", "dist/renderer/index.html"]) {
    assert(archiveSet.has(relativePath), `ASAR is missing ${relativePath}.`);
  }
  assert(!archiveEntries.some((entry) => entry.startsWith("node_modules/")), "Production ASAR unexpectedly contains node_modules.");
  assert(!archiveEntries.some((entry) => entry.startsWith("tests/")), "Production ASAR unexpectedly contains tests.");
  assert(!archiveEntries.some((entry) => entry.startsWith("src/renderer/")), "Production ASAR unexpectedly contains renderer source.");
  await Promise.all([
    ...PACKAGED_SOURCE_FILES.map((relativePath) => assertPackagedFileMatches(archive, relativePath)),
    assertPackagedFileMatches(archive, "dist/renderer/index.html"),
  ]);

  const frameworks = join(contents, "Frameworks");
  const helperApps = (await readdir(frameworks, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(".app"));
  assert(helperApps.length >= 4, "Electron helper apps are missing.");
  for (const helper of helperApps) {
    const helperIdentifier = await plistValue(join(frameworks, helper.name, "Contents", "Info.plist"), "CFBundleIdentifier");
    assert(helperIdentifier.startsWith(`${BUNDLE_ID}.helper`), `Unexpected helper bundle identifier: ${helperIdentifier}`);
  }

  const nodeResult = await run(executable, ["-p", "process.versions.node"], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    maxBuffer: 1024 * 1024,
  });
  const electronNodeVersion = nodeResult.stdout.trim();
  assert(/^\d+\.\d+\.\d+$/.test(electronNodeVersion), "Packaged Electron did not enter Node mode.");
  assert(compareVersions(electronNodeVersion, SETUP_REQUIRED_NATIVE_CAPABILITIES.browser.minimumNodeVersion) >= 0,
    `Packaged Electron Node ${electronNodeVersion} is below the browser Package floor.`);
  await verifyBundledRuntimeProfiles(runtimeBundleRoot, executable);

  await command("/usr/bin/codesign", [...CODESIGN_VERIFY_ARGUMENTS, resolvedApp]);
  const signature = await command("/usr/bin/codesign", ["--display", "--verbose=4", resolvedApp]);
  assert(!signature.includes("Signature=adhoc"), "Ad-hoc signature is forbidden.");
  assert(signature.includes("Authority="), "The app is not signed by a named identity.");
  assert(!/flags=.*\(runtime\)/.test(signature), "Local self-signed builds must not enable hardened runtime.");
  const requirementOutput = await command("/usr/bin/codesign", ["--display", "--requirements", "-", resolvedApp]);
  const requirement = requirementOutput.split("\n")
    .map((line) => line.replace(/^#\s*/, "").trim())
    .find((line) => line.startsWith("designated =>")) ?? "";
  assert(requirement.includes(`identifier \"${BUNDLE_ID}\"`), "Designated requirement does not bind the canonical bundle id.");
  assert(/certificate root = H\"[0-9a-f]{40}\"/i.test(requirement), "Designated requirement does not bind a stable certificate root.");

  const architectures = (await command("/usr/bin/lipo", ["-archs", executable])).trim().split(/\s+/);
  assert(architectures.includes(TARGET_ARCH), `Packaged executable is not ${TARGET_ARCH}.`);

  const buildVersion = await plistValue(infoPlist, "CFBundleVersion");
  const cdhash = signature.match(/^CDHash=([0-9a-f]+)$/mi)?.[1] ?? null;
  console.log(`Verified ${basename(resolvedApp)} ${buildVersion} (${TARGET_ARCH}), signed requirement stable and ASAR complete.`);
  return { appPath: resolvedApp, buildVersion, cdhash, requirement };
}

if (directInvocation()) {
  const appArgument = process.argv.find((argument) => argument.startsWith("--app="));
  const unknown = process.argv.slice(2).filter((argument) => !argument.startsWith("--app="));
  if (unknown.length) {
    console.error(`Unknown verify argument: ${unknown[0]}`);
    process.exitCode = 2;
  } else {
    verifyMacApp(appArgument ? appArgument.slice("--app=".length) : DEFAULT_APP_PATH).catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
  }
}
