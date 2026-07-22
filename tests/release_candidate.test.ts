import assert from "node:assert/strict";
import {
  buildReleaseCandidateStatus,
  renderReleaseCandidateStatusMarkdown,
  requiredFrontendSurfaceFiles,
  type ReleaseCandidateInput,
} from "@linguist-agent/cat-data";

const input: ReleaseCandidateInput = {
  checkedAt: "2026-05-29T00:00:00.000Z",
  version: "0.92.0",
  piDependencies: {
    "@earendil-works/pi-ai": "0.80.3",
    "@earendil-works/pi-coding-agent": "0.80.3",
  },
  piSettings: {
    defaultProvider: "deepseek",
    defaultModel: "deepseek-v4-pro",
    sessionDir: "sessions",
    compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
    retry: { enabled: true, maxRetries: 3, provider: { maxRetries: 0 } },
    skills: ["./skills"],
    prompts: ["./prompts"],
    extensions: ["./extensions"],
  },
  risks: [{ id: "KR-001", severity: "P2", status: "monitoring", area: "UI", summary: "Polish remains." }],
  harnessSecurityEval: {
    status: "pass",
    fixturePath: "packages/cat-runtime/eval/fixtures/harness/security-smoke.json",
    caseCount: 10,
    failed: 0,
  },
  frontendSurfaceFiles: [...requiredFrontendSurfaceFiles],
  docs: {
    changelogHasVersion: true,
    readmeHasVersion: true,
    projectOverviewHasVersion: true,
    runtimeBorrowedPatternsCurrent: true,
    todoHasRcFreeze: true,
  },
};

const status = buildReleaseCandidateStatus(input);

assert.equal(status.status, "pass");
assert.equal(status.failures.length, 0);
assert.equal(status.checks.find((check) => check.id === "harness_security_eval")?.status, "pass");
assert.match(renderReleaseCandidateStatusMarkdown(status), /LA Release Candidate Status/);

const upgradedPi = buildReleaseCandidateStatus({
  ...input,
  piDependencies: {
    "@earendil-works/pi-ai": "0.80.0",
    "@earendil-works/pi-coding-agent": "0.80.0",
  },
});
assert.equal(upgradedPi.checks.find((check) => check.id === "pi_exact_pins")?.status, "pass");
assert.equal(upgradedPi.status, "pass");

const failed = buildReleaseCandidateStatus({
  ...input,
  piDependencies: {
    "@earendil-works/pi-ai": "^0.80.3",
    "@earendil-works/pi-coding-agent": "0.80.3",
  },
  risks: [{ id: "KR-002", severity: "P1", status: "open", area: "Delivery", summary: "Export unsafe." }],
});

assert.equal(failed.status, "fail");
assert.match(failed.failures.join("\n"), /pi_exact_pins/);
assert.match(failed.failures.join("\n"), /known_risk_gate/);

const workspaceMismatch = buildReleaseCandidateStatus({
  ...input,
  piDependencies: {
    "@earendil-works/pi-ai": "0.80.3",
    "@earendil-works/pi-coding-agent": "0.80.3",
  },
  piDependencyManifests: [
    {
      manifestPath: "package.json",
      dependencies: {
        "@earendil-works/pi-ai": "0.80.3",
        "@earendil-works/pi-coding-agent": "0.80.3",
      },
    },
    {
      manifestPath: "packages/cat-runtime/package.json",
      dependencies: {
        "@earendil-works/pi-ai": "0.80.3",
        "@earendil-works/pi-coding-agent": "0.80.1",
      },
    },
  ],
});
assert.equal(workspaceMismatch.status, "fail");
assert.match(workspaceMismatch.failures.join("\n"), /pi_exact_pins/);

const missingHarness = buildReleaseCandidateStatus({
  ...input,
  harnessSecurityEval: undefined,
});
assert.equal(missingHarness.status, "fail");
assert.match(missingHarness.failures.join("\n"), /harness_security_eval/);

const failedHarness = buildReleaseCandidateStatus({
  ...input,
  harnessSecurityEval: {
    status: "fail",
    fixturePath: "packages/cat-runtime/eval/fixtures/harness/security-smoke.json",
    caseCount: 10,
    failed: 1,
  },
});
assert.equal(failedHarness.status, "fail");
assert.match(failedHarness.failures.join("\n"), /harness_security_eval/);

console.log("release_candidate tests passed");
