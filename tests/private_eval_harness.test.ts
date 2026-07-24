import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { readPrivateEvalRun, readPrivateEvalRunOutputs } from "@linguist-agent/cat-data";
import { handleEvalRoute } from "../packages/cat-server/src/routes/eval_routes.ts";
import { parsePrivateEvalHarnessArgs, runPrivateEvalHarness } from "../scripts/private-eval.ts";

async function syntheticFixture(): Promise<{ root: string; sourceRoot: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "la-eval-harness-root-"));
  const sourceRoot = await mkdtemp(join(tmpdir(), "la-eval-harness-source-"));
  await writeFile(join(sourceRoot, "segments.json"), JSON.stringify([
    { segmentId: "seg-1", source: "开始", referenceTarget: "Start", tags: ["ui"] },
    { segmentId: "seg-2", source: "继续", referenceTarget: "Continue", tags: ["ui"] },
  ]), "utf8");
  return {
    root,
    sourceRoot,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
      await rm(sourceRoot, { recursive: true, force: true });
    },
  };
}

function argsFor(mode: string, root: string, sourceRoot: string): string[] {
  return [
    "run",
    "--mode", mode,
    "--root", root,
    "--set-id", "harness-set",
    "--label", "Harness Set",
    "--source-root", sourceRoot,
    "--adapter", "synthetic",
    "--source-locale", "zh-CN",
    "--target-locale", "en-US",
  ];
}

test("harness args require explicit fixture, root, mode and adapter", () => {
  const parsed = parsePrivateEvalHarnessArgs(argsFor("single", "/tmp/a", "/tmp/b"));
  assert.equal(parsed.command, "run");
  assert.equal(parsed.mode, "single");
  assert.equal(parsed.adapter, "synthetic");
  assert.throws(() => parsePrivateEvalHarnessArgs(["run", "--mode", "single"]), /--root is required/);
  assert.throws(() => parsePrivateEvalHarnessArgs(argsFor("single", "/tmp/a", "/tmp/b").filter((value) => value !== "--adapter" && value !== "synthetic")), /--adapter is required/);
  assert.throws(() => parsePrivateEvalHarnessArgs([...argsFor("single", "/tmp/a", "/tmp/b"), "--unknown", "x"]), /Unsupported option: --unknown/);
  assert.throws(() => parsePrivateEvalHarnessArgs(argsFor("single", "/tmp/a", "/tmp/b").map((value) => value === "single" ? "hybrid" : value)), /--mode must be single or team/);
  assert.throws(() => parsePrivateEvalHarnessArgs(["inspect"]), /Usage: eval:private/);
});

test("the harness refuses the production data root and only writes to an explicit synthetic root", async () => {
  const { sourceRoot, cleanup } = await syntheticFixture();
  try {
    const repoData = fileURLToPath(new URL("../data", import.meta.url));
    await assert.rejects(
      runPrivateEvalHarness(argsFor("single", join(repoData, "evals"), sourceRoot)),
      /synthetic|production|data/i,
    );
    await assert.rejects(
      runPrivateEvalHarness(argsFor("single", repoData, sourceRoot)),
      /synthetic|production|data/i,
    );
  } finally {
    await cleanup();
  }
});

test("single mode preserves the canonical run/output/status contract on a synthetic root", async () => {
  const { root, sourceRoot, cleanup } = await syntheticFixture();
  try {
    const result = await runPrivateEvalHarness(argsFor("single", root, sourceRoot));
    assert.equal(result.mode, "single_agent");
    assert.equal(result.status, "completed");
    assert.equal(result.outputCount, 2);
    const run = await readPrivateEvalRun(root, "harness-set", result.runId);
    assert.equal(run.status, "completed");
    const outputs = await readPrivateEvalRunOutputs(root, "harness-set", result.runId);
    assert.equal(outputs.length, 2);
    assert.ok(outputs.every((output) => output.status === "completed"));
    assert.ok(outputs.every((output) => typeof output.target === "string" && output.target.includes("[synthetic]")));
    assert.equal(outputs[0]!.executionManifest?.adapter, "canonical_single_batch");
    assert.equal(outputs[0]!.executionManifest?.referenceIncluded, false);
    assert.equal(outputs[0]!.executionManifest?.writeMode, "none");
    assert.ok(outputs.every((output) => output.mechanicalQa), "mechanical QA parity per segment");
    await access(result.reportPath);
  } finally {
    await cleanup();
  }
});

test("team mode preserves the canonical run/output/status contract on a synthetic root", async () => {
  const { root, sourceRoot, cleanup } = await syntheticFixture();
  try {
    const result = await runPrivateEvalHarness(argsFor("team", root, sourceRoot));
    assert.equal(result.mode, "team_workflow");
    assert.equal(result.status, "completed");
    assert.equal(result.outputCount, 2);
    const outputs = await readPrivateEvalRunOutputs(root, "harness-set", result.runId);
    assert.ok(outputs.every((output) => output.status === "completed"));
    assert.equal(outputs[0]!.executionManifest?.adapter, "canonical_team_workflow");
    assert.equal(outputs[0]!.executionManifest?.referenceIncluded, false);
    assert.equal(outputs[0]!.executionManifest?.writeMode, "none");
    const projects = await readdir(join(root, "data", "projects")).catch(() => [] as string[]);
    assert.deepEqual(projects.filter((entry) => entry.startsWith("private-eval-")), [], "the isolated Eval project is cleaned up");
    await access(result.reportPath);
  } finally {
    await cleanup();
  }
});

test("a failed generation fails the run instead of fabricating success", async () => {
  const { root, sourceRoot, cleanup } = await syntheticFixture();
  try {
    await assert.rejects(
      runPrivateEvalHarness(argsFor("single", root, sourceRoot), {
        singleGenerate: async () => { throw new Error("synthetic provider outage"); },
      }),
      /synthetic provider outage/,
    );
    const runs = await readdir(join(root, "data", "evals", "private", "harness-set", "runs"));
    assert.equal(runs.length, 1);
    const run = await readPrivateEvalRun(root, "harness-set", runs[0]!);
    assert.equal(run.status, "failed");
    assert.match(run.error ?? "", /synthetic provider outage/);
  } finally {
    await cleanup();
  }
});

test("the Stable route still rejects Private Eval execution with 403 before reading the body", async () => {
  const root = await mkdtemp(join(tmpdir(), "la-eval-stable-"));
  try {
    const responses: Array<{ status: number; data: unknown }> = [];
    await handleEvalRoute({ method: "POST" } as IncomingMessage, {} as ServerResponse, ["api", "evals", "private", "set", "runs"], {
      repoRoot: root,
      allowExecution: false,
      json: (_res: ServerResponse, status: number, data: unknown) => responses.push({ status, data }),
      readBody: async () => {
        throw new Error("Stable mutation denial must happen before reading the request body.");
      },
      requireString: (value: unknown, label: string) => {
        if (typeof value !== "string") throw new Error(`${label} is required`);
        return value;
      },
      optionalString: (value: unknown) => typeof value === "string" ? value : undefined,
    });
    assert.equal(responses.at(-1)?.status, 403);
    assert.equal((responses.at(-1)?.data as { error: { code: string } }).error.code, "private_eval_disabled_in_stable");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
