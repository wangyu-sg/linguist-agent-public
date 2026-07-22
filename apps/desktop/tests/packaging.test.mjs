import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  BUNDLE_ID,
  DEFAULT_SIGNING_IDENTITY,
  PACKAGED_SOURCE_FILES,
  createPackagerOptions,
  parseCodeSigningIdentities,
} from "../scripts/packaging-config.mjs";
import { createRuntimeBundle } from "../scripts/package-macos.mjs";
import { CODESIGN_VERIFY_ARGUMENTS, verifyRuntimeBundle } from "../scripts/verify-macos.mjs";

const run = promisify(execFile);

test("packaging uses canonical macOS identity, bundle id, ASAR, and arm64", () => {
  const options = createPackagerOptions({
    sourceDirectory: "/tmp/source",
    outputDirectory: "/tmp/output",
    version: "2.32.7",
    buildVersion: "900001",
    electronVersion: "43.1.1",
    signingIdentity: { hash: "A".repeat(40), name: DEFAULT_SIGNING_IDENTITY, keychain: "/tmp/login.keychain-db" },
    runtimeBundleDirectory: "/tmp/runtime",
  });
  assert.equal(options.appBundleId, BUNDLE_ID);
  assert.equal(options.platform, "darwin");
  assert.equal(options.arch, "arm64");
  assert.equal(options.asar, true);
  assert.equal(options.quiet, true);
  assert.equal(options.executableName, "Linguist Agent");
  assert.equal(options.osxSign.identity, "A".repeat(40));
  assert.equal(options.osxSign.identityValidation, false);
  assert.equal(options.osxSign.continueOnError, false);
  assert.equal(options.osxSign.optionsForFile("/tmp/app").hardenedRuntime, false);
  assert.equal(options.osxSign.optionsForFile("/tmp/app").timestamp, "none");
  assert.equal("osxNotarize" in options, false);
  assert.deepEqual(options.extraResource, ["/tmp/runtime"]);
});

test("signing identity parsing is exact and never invents an ad-hoc fallback", () => {
  const identities = parseCodeSigningIdentities(`\n  1) A13DCA823DBD219224716140FFF14D481356C440 "Linguist Agent Local Development"\n     1 valid identities found\n`);
  assert.deepEqual(identities, [{ hash: "A13DCA823DBD219224716140FFF14D481356C440", name: DEFAULT_SIGNING_IDENTITY }]);
  assert.deepEqual(parseCodeSigningIdentities("     0 valid identities found\n"), []);
});

test("package allowlist contains only built renderer and narrow main-process files", () => {
  assert.deepEqual(PACKAGED_SOURCE_FILES, [
    "src/main.mjs",
    "src/preload.cjs",
    "src/desktop-security.mjs",
    "src/native-dialogs.mjs",
    "src/runtime-client.mjs",
    "src/runtime-installer.mjs",
    "src/notification-policy.mjs",
    "src/rich-artifact-export.mjs",
  ]);
  assert.equal(PACKAGED_SOURCE_FILES.some((path) => path.includes("renderer")), false);
});

test("runtime bundle contains compiled runtime code, pinned resources, and a matching manifest hash", async () => {
  const root = await mkdtemp(join(tmpdir(), "la-electron-runtime-bundle-"));
  const output = join(root, "output", "runtime");
  const nativeSource = join(root, "native-source");
  await mkdir(join(root, "packages", "cat-server", "src"), { recursive: true });
  await mkdir(join(root, ".pi"), { recursive: true });
  await mkdir(join(root, "patches", "pi-ask-headless-v1", "src"), { recursive: true });
  await mkdir(join(root, "apps", "desktop"), { recursive: true });
  await mkdir(join(root, "data"), { recursive: true });
  await mkdir(nativeSource, { recursive: true });
  await writeFile(join(root, "package.json"), `${JSON.stringify({ name: "linguist-agent", version: "2.32.7", workspaces: ["packages/*"] })}\n`);
  await writeFile(join(root, "package-lock.json"), `${JSON.stringify({ lockfileVersion: 3, packages: {} })}\n`);
  await writeFile(join(root, "packages", "cat-server", "package.json"), `${JSON.stringify({
    name: "@linguist-agent/cat-server",
    version: "2.32.7",
    type: "module",
    exports: { ".": "./src/server.ts" },
  })}\n`);
  await writeFile(join(root, "packages", "cat-server", "src", "server.ts"), "export {};\n");
  await mkdir(join(root, "packages", "cat-server", "eval", "fixtures"), { recursive: true });
  await writeFile(join(root, "packages", "cat-server", "eval", "fixtures", "customer.json"), "{}\n");
  await writeFile(join(root, ".pi", "APPEND_SYSTEM.md"), "runtime policy\n");
  await writeFile(join(root, "patches", "pi-ask-headless-v1", "src", "index.ts"), "// patched ask\n");
  await writeFile(join(root, "patches", "pi-ask-headless-v1", "src", "ask-tool.ts"), "// patched ask tool\n");
  await writeFile(join(root, "apps", "desktop", "must-not-ship"), "renderer source\n");
  await writeFile(join(root, "data", "must-not-ship"), "customer data\n");
  const nativePackages = [
    ["@earendil-works/pi-tui", "0.80.10", "sha512-pi-tui"],
    ["@eko24ive/pi-ask", "1.1.0", "sha512-ask"],
    ["@getpipher/vision", "0.5.1", "sha512-vision"],
    ["@injaneity/pi-computer-use", "0.4.3", "sha512-computer"],
    ["pi-agent-browser-native", "0.2.67", "sha512-browser"],
    ["pi-docparser", "3.0.1", "sha512-docparser"],
    ["pi-subagents", "0.35.1", "sha512-subagents"],
    ["pi-web-access", "0.13.0", "sha512-web"],
  ];
  const nativeLock = { lockfileVersion: 3, packages: { "": { dependencies: {} } } };
  for (const [name, version, integrity] of nativePackages) {
    nativeLock.packages[""].dependencies[name] = version;
    nativeLock.packages[`node_modules/${name}`] = { version, integrity };
  }
  await writeFile(join(nativeSource, "package.json"), `${JSON.stringify({
    name: "linguist-agent-native-capabilities",
    version: "2.32.7",
    private: true,
    dependencies: nativeLock.packages[""].dependencies,
  })}\n`);
  await writeFile(join(nativeSource, "package-lock.json"), `${JSON.stringify(nativeLock)}\n`);
  await run("git", ["init", "-q"], { cwd: root });
  await run("git", ["add", "."], { cwd: root });

  const execute = async (command, args, options = {}) => {
    if (command.endsWith("/node_modules/.bin/tsc")) {
      const compiledRoot = args[args.indexOf("--outDir") + 1];
      await mkdir(join(compiledRoot, "cat-server", "src"), { recursive: true });
      await writeFile(join(compiledRoot, "cat-server", "src", "server.js"), "// compiled server\n");
      await writeFile(join(compiledRoot, "cat-server", "src", "install_resident.js"), "// compiled installer\n");
      return { stdout: "", stderr: "" };
    }
    if (command === "npm") {
      if (options.cwd.endsWith("native-capabilities/npm")) {
        for (const [name, version] of nativePackages) {
          const packageRoot = join(options.cwd, "node_modules", ...name.split("/"));
          await mkdir(join(packageRoot, name === "@eko24ive/pi-ask" ? "src" : "."), { recursive: true });
          const packageMetadata = name === "pi-agent-browser-native"
            ? { engines: { node: ">=22.19.0" } }
            : name === "@injaneity/pi-computer-use"
              ? { scripts: { postinstall: "node scripts/setup-helper.mjs --postinstall" } }
              : {};
          await writeFile(join(packageRoot, "package.json"), `${JSON.stringify({ name, version, ...packageMetadata })}\n`);
          if (name === "@injaneity/pi-computer-use") {
            await mkdir(join(packageRoot, "scripts"), { recursive: true });
            await mkdir(join(packageRoot, "prebuilt", "macos", "arm64"), { recursive: true });
            await writeFile(join(packageRoot, "scripts", "setup-helper.mjs"), "// setup helper\n");
            await writeFile(join(packageRoot, "prebuilt", "macos", "arm64", "bridge"), "helper\n");
          }
        }
      } else {
        const piRoot = join(options.cwd, "node_modules", "@earendil-works", "pi-coding-agent");
        await mkdir(piRoot, { recursive: true });
        await writeFile(join(piRoot, "package.json"), "{}\n");
      }
      return { stdout: "", stderr: "" };
    }
    return run(command, args, options);
  };
  await createRuntimeBundle(root, output, { execute, nativeCapabilitySourceRoot: nativeSource });

  const archive = join(output, "runtime.tar.gz");
  const manifest = JSON.parse(await readFile(join(output, "runtime.manifest.json"), "utf8"));
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.archive, "runtime.tar.gz");
  assert.equal(manifest.productVersion, "2.32.7");
  assert.equal(manifest.launcher.executableMode, "current-app-executable");
  assert.equal(manifest.dependencies.mode, "bundled-production");
  assert.equal(manifest.dependencies.nativePackages.length, 7);
  assert.deepEqual(
    manifest.dependencies.nativePackages
      .filter(({ runtimeReadiness }) => runtimeReadiness === "setup_required")
      .map(({ id, setupRequirement }) => ({ id, setupRequirement })),
    [
      { id: "computer", setupRequirement: "signed_helper_accessibility_screen_recording" },
      { id: "browser", setupRequirement: "agent_browser_executable" },
    ],
  );
  assert.equal(manifest.sha256, createHash("sha256").update(await readFile(archive)).digest("hex"));
  const { stdout } = await run("/usr/bin/tar", ["-tzf", archive]);
  assert.match(stdout, /^package\.json$/m);
  assert.doesNotMatch(stdout, /^packages\/cat-server\/src\/server\.ts$/m);
  assert.doesNotMatch(stdout, /^packages\/cat-server\/eval\//m);
  assert.match(stdout, /^packages\/cat-server\/src\/server\.js$/m);
  assert.match(stdout, /^runtime-launcher\.mjs$/m);
  assert.match(stdout, /^node_modules\/@earendil-works\/pi-coding-agent\/package\.json$/m);
  assert.match(stdout, /^native-capabilities\/npm\/node_modules\/@eko24ive\/pi-ask\/src\/index\.ts$/m);
  assert.match(stdout, /^\.pi\/APPEND_SYSTEM\.md$/m);
  assert.doesNotMatch(stdout, /^apps\//m);
  assert.doesNotMatch(stdout, /^data\//m);
  assert.doesNotMatch(stdout, /^scripts\//m);
  assert.doesNotMatch(stdout, /node_modules\/\.bin\/tsx/);
  assert.deepEqual(await verifyRuntimeBundle(output), { productVersion: "2.32.7", sha256: manifest.sha256 });
  await writeFile(archive, "tampered");
  await assert.rejects(() => verifyRuntimeBundle(output), /hash/i);
});

test("verification is read-only and root scripts expose the desktop lifecycle", async () => {
  assert.equal(CODESIGN_VERIFY_ARGUMENTS.includes("--sign"), false);
  assert.equal(CODESIGN_VERIFY_ARGUMENTS.includes("--force"), false);
  const rootPackage = JSON.parse(await readFile(new URL("../../../package.json", import.meta.url), "utf8"));
  for (const name of ["desktop:build", "desktop:test", "desktop:verify", "desktop:package", "desktop:run"]) {
    assert.equal(typeof rootPackage.scripts[name], "string", `Missing root script ${name}`);
  }
  for (const name of ["mac:build", "mac:test", "mac:verify", "mac:run"]) {
    assert.match(rootPackage.scripts[name], /desktop/, `${name} must target the Electron client`);
    assert.doesNotMatch(rootPackage.scripts[name], /swift|apps\/mac/, `${name} must not revive the retired Swift client`);
  }
});
