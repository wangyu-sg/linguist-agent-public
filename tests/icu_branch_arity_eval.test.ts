import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compareFormattingSignatures,
  exportGenericXliff,
  importGenericXliffBatch,
  readExportAuditRecords,
  runDeliveryCheck,
  updateSegmentTarget,
  type ProjectTagRuleContext,
} from "@linguist-agent/cat-data";

const syntheticXliff = `<?xml version="1.0" encoding="utf-8"?>
<xliff xmlns="urn:oasis:names:tc:xliff:document:1.2" version="1.2">
  <file original="synthetic.txt" source-language="en-US" target-language="zh-CN">
    <body>
      <trans-unit id="branch"><source>Build {qty: Box| Boxes}</source><target>建造{qty: 盒子}</target></trans-unit>
    </body>
  </file>
</xliff>`;

const root = await mkdtemp(join(tmpdir(), "la-icu-branch-eval-"));
const testRuleContext: ProjectTagRuleContext = {
  mode: "legacy_builtin",
  rulesDigest: "sha256:test",
  activeProjectRules: [],
  disabledBuiltinIds: [],
  candidateRuleCount: 0,
  disabledRuleCount: 0,
  trace: [],
};

{
  const collapsed = compareFormattingSignatures("Build {qty: Box| Boxes}", "建造{qty: 盒子}", testRuleContext);
  const mismatch = collapsed.mismatches.find((item) => item.code === "ICU_BRANCH_ARITY_MISMATCH");
  assert.ok(mismatch);
  assert.equal(mismatch.kind, "icu_branch");
  assert.deepEqual(mismatch.source, ["qty:2"]);
  assert.deepEqual(mismatch.target, ["qty:1"]);

  const translatedBranches = compareFormattingSignatures("Build {qty: Box| Boxes}", "建造{qty: 个盒子|个盒子}", testRuleContext);
  assert.equal(translatedBranches.mismatches.some((item) => item.code === "ICU_BRANCH_ARITY_MISMATCH"), false);
}

const path = join(root, "branch.xliff");
await writeFile(path, syntheticXliff, "utf8");
await importGenericXliffBatch(root, { projectId: "icu", xliffPath: path, batchId: "branch" });

const deliveredTarget = "建造{qty: 盒子}";
await assert.rejects(
  updateSegmentTarget(root, "icu", "branch", {
    segmentId: "branch",
    target: deliveredTarget,
    changeType: "user_approved",
    reason: "synthetic branch arity blocker fixture",
    confirm: true,
  }),
  /ICU_BRANCH_ARITY_MISMATCH/,
);

const delivery = await runDeliveryCheck(root, "icu", "branch");
assert.equal(delivery.status, "warn");
assert.equal(delivery.blockers.some((issue) => issue.code === "ICU_BRANCH_ARITY_MISMATCH"), false);
assert.equal(delivery.warnings.some((issue) => issue.code === "ICU_BRANCH_ARITY_MISMATCH" && issue.segmentIds.includes("branch")), true);

const exported = await exportGenericXliff(root, { projectId: "icu", batchId: "branch", force: true });
assert.equal(exported.delivery.status, "warn");

const audits = await readExportAuditRecords(root, "icu", "branch");
assert.equal(audits.length, 1);
const delivered = audits[0].deliveredTargets.find((item) => item.segmentId === "branch");
assert.ok(delivered);
assert.equal(delivered.targetBytes, Buffer.byteLength(deliveredTarget, "utf8"));
assert.equal(delivered.targetSha256, createHash("sha256").update(deliveredTarget, "utf8").digest("hex"));
assert.equal("targetText" in delivered, false);

console.log("icu branch arity eval tests passed");
