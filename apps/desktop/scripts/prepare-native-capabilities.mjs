import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const SCRIPT_ROOT = dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = resolve(SCRIPT_ROOT, "..");
const REPO_ROOT = resolve(DESKTOP_ROOT, "../..");
const DEFAULT_SOURCE_ROOT = join(DESKTOP_ROOT, "runtime", "native-capabilities");
const DEFAULT_AGENT_DIR = join(DESKTOP_ROOT, ".runtime", "native-capabilities");
export const PATCHES = [
  {
    packageName: "@eko24ive/pi-ask",
    root: join(REPO_ROOT, "patches", "pi-ask-headless-v1"),
    files: ["src/index.ts", "src/ask-tool.ts"],
  },
  {
    packageName: "pi-web-access",
    root: join(REPO_ROOT, "patches", "pi-web-access-headless-v1"),
    files: ["la-headless.ts"],
  },
];
const PREPARED_MARKER = ".la-native-capabilities.json";

function directInvocation() {
  return process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

function parseArguments(argv) {
  const result = {};
  for (const argument of argv) {
    if (argument === "--force") result.force = true;
    else if (argument.startsWith("--agent-dir=")) result.agentDir = resolve(argument.slice("--agent-dir=".length));
    else throw new Error(`Unknown native capability preparation argument: ${argument}`);
  }
  return result;
}

async function inputDigest(sourceRoot, patches) {
  const hash = createHash("sha256");
  hash.update(`native-capabilities-v1\0${process.platform}\0${process.arch}\0`);
  for (const path of [
    join(sourceRoot, "package.json"),
    join(sourceRoot, "package-lock.json"),
    ...patches.flatMap((patch) => patch.files.map((relativePath) => join(patch.root, relativePath))),
  ]) {
    hash.update(path.slice(path.lastIndexOf("/") + 1));
    hash.update("\0");
    hash.update(await readFile(path));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function verifyPreparedAgentDir(agentDir, expectedDigest, dependencies, patches) {
  try {
    const marker = JSON.parse(await readFile(join(agentDir, PREPARED_MARKER), "utf8"));
    if (marker.schemaVersion !== 1 || marker.inputSha256 !== expectedDigest) return false;
    for (const [name, version] of Object.entries(dependencies)) {
      const packageRoot = join(agentDir, "npm", "node_modules", ...name.split("/"));
      const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
      if (manifest.name !== name || manifest.version !== version) return false;
    }
    for (const patch of patches) {
      for (const relativePath of patch.files) {
        const [expected, installed] = await Promise.all([
          readFile(join(patch.root, relativePath)),
          readFile(join(agentDir, "npm", "node_modules", ...patch.packageName.split("/"), relativePath)),
        ]);
        if (!expected.equals(installed)) return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Pi's DefaultPackageManager owns user packages under <agentDir>/npm. Keep the
 * local acceptance tree byte-for-byte equivalent to the tree assembled in the
 * packaged runtime instead of falling back to ~/.pi/agent.
 */
export async function prepareNativeCapabilityAgentDir(options = {}) {
  const sourceRoot = resolve(options.sourceRoot ?? DEFAULT_SOURCE_ROOT);
  const agentDir = resolve(options.agentDir ?? DEFAULT_AGENT_DIR);
  const execute = options.execute ?? run;
  const patches = options.patches ?? PATCHES;
  if (agentDir === "/Applications" || agentDir.startsWith("/Applications/")) {
    throw new Error("Native capability preparation never writes into /Applications.");
  }

  const packageDocument = JSON.parse(await readFile(join(sourceRoot, "package.json"), "utf8"));
  const dependencies = packageDocument.dependencies ?? {};
  if (!dependencies["@earendil-works/pi-tui"] || !dependencies["@eko24ive/pi-ask"] || !dependencies["pi-docparser"] || !dependencies["pi-subagents"]) {
    throw new Error("Native capability source is missing the required Main and Team Packages.");
  }
  const digest = await inputDigest(sourceRoot, patches);
  if (!options.force && await verifyPreparedAgentDir(agentDir, digest, dependencies, patches)) {
    return { agentDir, npmRoot: join(agentDir, "npm"), inputSha256: digest, reused: true };
  }

  const parent = dirname(agentDir);
  await mkdir(parent, { recursive: true });
  const stagingDir = await mkdtemp(join(parent, ".native-capabilities-stage-"));
  const npmRoot = join(stagingDir, "npm");
  try {
    await mkdir(npmRoot, { recursive: true });
    await Promise.all([
      cp(join(sourceRoot, "package.json"), join(npmRoot, "package.json")),
      cp(join(sourceRoot, "package-lock.json"), join(npmRoot, "package-lock.json")),
    ]);
    await execute("npm", [
      "ci",
      "--omit=dev",
      "--ignore-scripts",
      "--legacy-peer-deps",
      "--no-audit",
      "--no-fund",
    ], { cwd: npmRoot, maxBuffer: 32 * 1024 * 1024 });
    for (const patch of patches) {
      for (const relativePath of patch.files) {
        const destination = join(npmRoot, "node_modules", ...patch.packageName.split("/"), relativePath);
        await mkdir(dirname(destination), { recursive: true });
        await cp(join(patch.root, relativePath), destination);
      }
    }
    await writeFile(join(stagingDir, PREPARED_MARKER), `${JSON.stringify({
      schemaVersion: 1,
      inputSha256: digest,
      platform: process.platform,
      architecture: process.arch,
      packageCount: Object.keys(dependencies).length,
    }, null, 2)}\n`);
    if (!await verifyPreparedAgentDir(stagingDir, digest, dependencies, patches)) {
      throw new Error("Prepared native capability Package tree failed verification.");
    }
    await rm(agentDir, { recursive: true, force: true });
    await rename(stagingDir, agentDir);
    await access(join(agentDir, "npm", "package-lock.json"));
    return { agentDir, npmRoot: join(agentDir, "npm"), inputSha256: digest, reused: false };
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true });
    throw error;
  }
}

if (directInvocation()) {
  prepareNativeCapabilityAgentDir(parseArguments(process.argv.slice(2))).then((result) => {
    console.log(`${result.reused ? "Reused" : "Prepared"} isolated native capability Packages at ${result.agentDir}`);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
