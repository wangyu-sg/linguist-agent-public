#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  ACCEPTANCE_ACTIVITY_COUNT,
  ACCEPTANCE_ACTIVITY_HZ,
  assertOwnedElectronAcceptanceFixture,
  producerStatusLine,
  runElectronAcceptanceActivitySequence,
} from "./electron-acceptance-activity-lib.ts";
import {
  assertIsolatedRuntimeURL,
  loadAcceptanceConfig,
} from "./electron-acceptance-lib.mjs";

function argument(name: string, required = false): string | undefined {
  const equals = process.argv.find((value) => value.startsWith(`${name}=`));
  const index = process.argv.indexOf(name);
  const value = equals?.slice(name.length + 1) ?? (index >= 0 ? process.argv[index + 1] : undefined);
  if (required && (!value || value.startsWith("--"))) throw new Error(`${name} is required.`);
  return value && !value.startsWith("--") ? value : undefined;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

async function waitForObserver(path: string, runToken: string, child: ChildProcessWithoutNullStreams): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Performance observer exited before readiness (code ${child.exitCode}).`);
    const raw = await readFile(path, "utf8").catch(() => null);
    if (raw !== null) {
      const handshake: unknown = JSON.parse(raw);
      if (!handshake || typeof handshake !== "object" || Array.isArray(handshake)) throw new Error("Observer handshake is invalid.");
      const row = handshake as Record<string, unknown>;
      if (row.state !== "observer_ready" || row.runToken !== runToken
        || row.expectedEvents !== ACCEPTANCE_ACTIVITY_COUNT || row.expectedHz !== ACCEPTANCE_ACTIVITY_HZ) {
        throw new Error("Observer handshake does not match this activity run.");
      }
      return;
    }
    await wait(25);
  }
  throw new Error("Timed out waiting for the renderer Activity observer.");
}

async function childResult(exit: Promise<number | null>, output: { stdout: string; stderr: string }): Promise<void> {
  const code = await exit;
  if (code !== 0) throw new Error(`Performance observer failed (${code}): ${output.stderr.slice(-2_000)}`);
}

async function main(): Promise<void> {
  const repoRoot = resolve(argument("--repo-root", true)!);
  const configPath = join(repoRoot, "data", "electron-acceptance-config.json");
  const config = await loadAcceptanceConfig(configPath);
  const scenario = config.scenarios?.activityAppend;
  if (!scenario || typeof scenario.projectId !== "string" || typeof scenario.taskId !== "string") {
    throw new Error("The owned fixture has no activityAppend scenario.");
  }
  const runtimeURL = assertIsolatedRuntimeURL(process.env.LA_ACCEPTANCE_RUNTIME_URL ?? config.runtimeURL ?? "");
  await assertOwnedElectronAcceptanceFixture({
    repoRoot,
    runtimeURL,
    projectId: scenario.projectId,
    taskId: scenario.taskId,
  });
  const label = argument("--label") ?? "activity-append";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(label)) throw new Error("--label must be filename-safe.");
  const runToken = `round-${randomUUID()}`;
  const handshakeRoot = await mkdtemp("/private/tmp/la-electron-activity-handshake-");
  const handshakePath = join(handshakeRoot, "observer-ready.json");
  const output = { stdout: "", stderr: "" };
  const perf = spawn(process.execPath, [
    join(repoRoot, "apps", "desktop", "scripts", "electron-acceptance-perf.mjs"),
    `--config=${configPath}`,
    "--only=activity-append",
    `--label=${label}`,
    `--activity-run-token=${runToken}`,
    `--activity-handshake=${handshakePath}`,
  ], {
    cwd: repoRoot,
    env: {
      ...process.env,
      LA_ACCEPTANCE_CONFIG: configPath,
      LA_ACCEPTANCE_RUNTIME_URL: runtimeURL,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const perfExit = new Promise<number | null>((resolveExit, reject) => {
    perf.once("error", reject);
    perf.once("exit", resolveExit);
  });
  perf.stdout.on("data", (chunk) => { output.stdout += chunk; });
  perf.stderr.on("data", (chunk) => { output.stderr += chunk; });

  process.stdout.write(producerStatusLine("producer_ready", runToken, {
    expectedEvents: ACCEPTANCE_ACTIVITY_COUNT,
    expectedHz: ACCEPTANCE_ACTIVITY_HZ,
  }));
  try {
    await waitForObserver(handshakePath, runToken, perf);
    const result = await runElectronAcceptanceActivitySequence({
      repoRoot,
      runtimeURL,
      projectId: scenario.projectId,
      taskId: scenario.taskId,
      runToken,
      expectedEvents: ACCEPTANCE_ACTIVITY_COUNT,
      expectedHz: ACCEPTANCE_ACTIVITY_HZ,
    });
    await childResult(perfExit, output);
    const perfResult = JSON.parse(output.stdout) as { outputPath?: unknown };
    if (typeof perfResult.outputPath !== "string") throw new Error("Performance observer did not report an output path.");
    process.stdout.write(producerStatusLine("producer_complete", runToken, {
      appended: result.appended,
      performanceReport: perfResult.outputPath,
    }));
  } catch (error) {
    if (perf.exitCode === null) perf.kill("SIGTERM");
    await perfExit.catch(() => undefined);
    throw error;
  } finally {
    await rm(handshakeRoot, { recursive: true, force: true });
  }
}

await main();
