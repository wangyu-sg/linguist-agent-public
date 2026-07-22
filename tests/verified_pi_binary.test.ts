import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { getPiSpawnCommand } from "../.pi/npm/node_modules/pi-subagents/src/runs/shared/pi-spawn.ts";
import {
  PI_SUBAGENT_PI_BINARY_ENV,
  bindVerifiedPiSubagentBinary,
} from "../packages/cat-server/src/verified_pi_binary.js";

const root = await mkdtemp(join(tmpdir(), "la-verified-pi-binding-"));

try {
  const verifiedPi = join(root, "verified", "pi");
  await mkdir(dirname(verifiedPi), { recursive: true });
  await writeFile(verifiedPi, "#!/bin/sh\nprintf '0.80.10\\n'\n");
  await chmod(verifiedPi, 0o755);

  const oldPathRoot = join(root, "old-path");
  const oldPathPi = join(oldPathRoot, "pi");
  await mkdir(oldPathRoot, { recursive: true });
  await writeFile(oldPathPi, "#!/bin/sh\nprintf '0.80.3\\n'\n");
  await chmod(oldPathPi, 0o755);

  const env: NodeJS.ProcessEnv = {
    PATH: `${oldPathRoot}:${dirname(process.execPath)}:/usr/bin:/bin`,
  };
  const stalePathResult = spawnSync("pi", ["--version"], { encoding: "utf8", env });
  assert.equal(stalePathResult.stdout.trim(), "0.80.3", "the fixture must expose the stale PATH Pi counterexample");

  const packageResolved = getPiSpawnCommand(["--version"], { env, platform: "darwin" });
  assert.equal(packageResolved.command, process.execPath, "pi-subagents 0.35.1 should prefer its resolved Pi CLI package over PATH");
  assert.match(packageResolved.args[0] ?? "", /@earendil-works\/pi-coding-agent\/dist\/cli\.js$/);
  const packageChild = spawnSync(packageResolved.command, packageResolved.args, { encoding: "utf8", env });
  assert.equal(packageChild.status, 0);
  assert.equal(packageChild.stdout.trim(), "0.80.10");

  const forcedPathFallback = getPiSpawnCommand(["--version"], {
    env,
    platform: "darwin",
    resolvePackageJson: () => { throw new Error("package resolution unavailable"); },
  });
  assert.equal(forcedPathFallback.command, "pi", "PATH is only the final fallback when package resolution is unavailable");
  const fallbackChild = spawnSync(forcedPathFallback.command, forcedPathFallback.args, { encoding: "utf8", env });
  assert.equal(fallbackChild.stdout.trim(), "0.80.3");

  env[PI_SUBAGENT_PI_BINARY_ENV] = oldPathPi;
  bindVerifiedPiSubagentBinary(verifiedPi, env);
  assert.equal(env[PI_SUBAGENT_PI_BINARY_ENV], verifiedPi, "verified Team state must overwrite inherited child Pi state");
  const spawnSpec = getPiSpawnCommand(["--version"], { env, platform: "darwin" });
  assert.equal(spawnSpec.command, verifiedPi);
  const child = spawnSync(spawnSpec.command, spawnSpec.args, { encoding: "utf8", env });
  assert.equal(child.status, 0);
  assert.equal(child.stdout.trim(), "0.80.10");

  assert.throws(
    () => bindVerifiedPiSubagentBinary("relative/pi", env),
    /must be absolute/,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("verified Pi binary binding tests passed");
