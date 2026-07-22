import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { evaluateHarnessSecurityEvalFixture, type HarnessSecurityEvalFixture } from "@linguist-agent/cat-runtime";
import { createWorkspace } from "@linguist-agent/cat-data";

const fixturePath = join(process.cwd(), "packages", "cat-runtime", "eval", "fixtures", "harness", "security-smoke.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as HarnessSecurityEvalFixture;
const result = evaluateHarnessSecurityEvalFixture(fixture, createWorkspace(process.cwd(), fixture.projectId));

assert.equal(result.schemaVersion, 1);
assert.equal(result.fixtureId, "harness-security-smoke");
assert.equal(result.status, "pass");
assert.equal(result.cases.length, fixture.cases.length);
assert.equal(result.summary.failed, 0);
assert.equal(result.summary.passed, fixture.cases.length);
assert.ok(result.cases.every((entry) => entry.status === "pass"), JSON.stringify(result.cases, null, 2));

const byId = new Map(result.cases.map((entry) => [entry.caseId, entry]));
assert.equal(byId.get("data-write-blocked")?.observed, "blocked");
assert.equal(byId.get("scratch-write-allowed")?.observed, "allowed");
assert.equal(byId.get("novel-write-verb-blocked")?.observed, "blocked");
assert.equal(byId.get("patch-verb-blocked")?.observed, "blocked");
assert.equal(byId.get("data-read-allowed")?.observed, "allowed");
assert.equal(byId.get("advisory-web-result")?.details?.citable, false);
assert.equal(byId.get("sandbox-wildcard-denied")?.observed, "denied");
assert.equal(byId.get("sandbox-null-byte-denied")?.observed, "denied");
assert.equal(byId.get("sandbox-credential-deny-read")?.details?.denyReadAgentReach, true);
assert.equal(byId.get("sandbox-credential-deny-read")?.details?.denyWriteData, true);
assert.deepEqual(byId.get("secret-env-scrub")?.details?.removed, ["TAVILY_API_KEY", "SESSION_COOKIE"]);
assert.deepEqual(byId.get("secret-env-scrub")?.details?.retained, ["PATH", "HOME", "PLAIN_VALUE"]);
assert.equal(byId.get("mock-evidence-promotion")?.details?.beforeCitable, false);
assert.equal(byId.get("mock-evidence-promotion")?.details?.afterCitable, true);

console.log("harness_eval_smoke tests passed");
