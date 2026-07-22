import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runRcRegression } from "@linguist-agent/cat-data";

const workspaceRoot = await mkdtemp(join(tmpdir(), "la-rc-regression-test-"));
const report = await runRcRegression(workspaceRoot, { projectId: "rc-regression-test" });

assert.equal(report.status, "pass");
assert.equal(report.evidence.tmMatches > 0, true);
assert.equal(report.evidence.glossaryMatches > 0, true);
assert.equal(report.evidence.assetHits > 0, true);
assert.equal(report.proposal.applied.applied.length, 1);
assert.deepEqual(report.batchIds, ["b1", "b2"]);
assert.equal(report.deliveryReadiness.every((row) => row.status === "pass"), true);
assert.equal(report.exports.length, 2);
assert.equal(report.exports.every((row) => row.auditId !== undefined), true);
assert.equal(report.rcReadiness.status, "pass");
for (const exported of report.exports) await stat(exported.outputPath);
const markdown = await readFile(report.reportPath, "utf8");
assert.match(markdown, /LA RC Regression Report/);
assert.match(markdown, /proposal_review_apply/);
assert.match(markdown, /delivery_gate/);

console.log("rc_regression tests passed");
