import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { handleTagRuleRoute } from "../packages/cat-server/src/routes/tag_rule_routes.js";
import { buildProjectTagRuleEvidence, discoverTagRulesFromEvidence } from "@linguist-agent/cat-data";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

function req(method: string) {
  return { method } as any;
}

function captureJson() {
  let payload: { status: number; data: any } | undefined;
  return {
    res: {} as any,
    json: (_res: any, status: number, data: unknown) => { payload = { status, data }; },
    get: () => {
      assert.ok(payload, "route should write json");
      return payload;
    },
  };
}

const model = deferred<string>();
const deps = {
  repoRoot: "/tmp/la-tag-route",
  readBody: async () => ({ batchId: "b1" }),
  requireString: (value: unknown) => {
    assert.equal(typeof value, "string");
    return value as string;
  },
  optionalNumber: () => undefined,
  readProjectTagRules: async () => ({ rules: [], rulesDigest: "sha256:empty" }),
  confirmProjectTagRule: async () => ({}),
  createManualProjectTagRuleCandidate: async (_root: string, _projectId: string, input: any) => ({
    rules: [{ id: input.id, pattern: input.pattern, origin: "manual", status: "candidate" }],
    rulesDigest: "sha256:manual",
  }),
  disableProjectTagRule: async () => ({}),
  declareNoProjectTagRules: async () => ({}),
  readBatch: async () => ({
    segments: [
      { id: "s1", source: "<color=red>暴击</color>", target: "<color=red>Crit</color>" },
      { id: "s2", source: "<color=blue>护盾</color>", target: "<color=blue>Shield</color>" },
    ],
  }),
  buildProjectTagRuleEvidence,
  discoverTagRulesFromEvidence,
  writeProjectTagRuleCandidates: async (_root: string, _projectId: string, candidates: any[]) => ({
    rules: candidates,
    rulesDigest: "sha256:written",
  }),
  askTagRuleModelForProject: async () => ({
    assistantModel: "test/model",
    askModel: async () => model.promise,
  }),
};

{
  const out = captureJson();
  const handled = await handleTagRuleRoute(req("POST"), out.res, ["api", "projects", "p1", "tag-rules", "discover-jobs"], "p1", { ...deps, json: out.json });
  assert.equal(handled, true);
  const started = out.get();
  assert.equal(started.status, 202);
  assert.equal(started.data.status, "running");
  assert.equal(typeof started.data.jobId, "string");
  const jobId = started.data.jobId;

  await sleep(0);
  const runningOut = captureJson();
  await handleTagRuleRoute(req("GET"), runningOut.res, ["api", "projects", "p1", "tag-rules", "discover-jobs", jobId], "p1", { ...deps, json: runningOut.json });
  const running = runningOut.get();
  assert.equal(running.status, 200);
  assert.equal(running.data.status, "running");
  assert.equal(running.data.stages.some((stage: any) => stage.id === "assistant" && stage.status === "running"), true);

  model.resolve(JSON.stringify({
    rules: [{
      id: "color-tags",
      class: "formatting",
      pattern: "<\\/?color(?:=[^>]+)?>",
      flags: "g",
      examples: [{ batchId: "b1", segmentId: "s1", text: "<color=red>" }],
    }],
  }));

  let completed = false;
  for (let i = 0; i < 20; i += 1) {
    await sleep(10);
    const doneOut = captureJson();
    await handleTagRuleRoute(req("GET"), doneOut.res, ["api", "projects", "p1", "tag-rules", "discover-jobs", jobId], "p1", { ...deps, json: doneOut.json });
    const done = doneOut.get().data;
    if (done.status !== "complete") continue;
    assert.equal(done.result.assistantModel, "test/model");
    assert.equal(done.result.tagRules.rules.length, 1);
    assert.equal(done.stages.some((stage: any) => stage.id === "write" && stage.status === "complete"), true);
    completed = true;
    break;
  }
  assert.equal(completed, true, "job did not complete");
}

{
  const out = captureJson();
  const handled = await handleTagRuleRoute(req("POST"), out.res, ["api", "projects", "p1", "tag-rules", "candidates"], "p1", {
    ...deps,
    json: out.json,
    readBody: async () => ({ id: "manual-color", class: "formatting", pattern: "<\\/?color>", flags: "g" }),
  });
  assert.equal(handled, true);
  const created = out.get();
  assert.equal(created.status, 200);
  assert.equal(created.data.rules[0].origin, "manual");
}

await assert.rejects(
  () => handleTagRuleRoute(req("POST"), {} as any, ["api", "projects", "p1", "tag-rules", "candidates"], "p1", {
    ...deps,
    json: () => undefined,
    readBody: async () => ({ id: "manual-bad", class: "unknown", pattern: "<x>" }),
  }),
  /tag rule class must be one of/,
);

console.log("tag_rules_route tests passed");
