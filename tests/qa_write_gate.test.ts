import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importPhraseBatch, readBatch, runPlatformWriteGate, runQaWriteGate, updateSegmentTarget } from "@linguist-agent/cat-data";

const mxliff = `<?xml version="1.0"?>
<xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file original="newline.xliff" source-language="zh-cn" target-language="en-us"><body>
  <group id="1" m:para-id="1"><context-group><context context-type="x-key">1001</context></context-group>
    <trans-unit id="job:1" m:para-id="1" m:locked="false"><source>第一行\\n第二行</source><target>First line
Second line</target></trans-unit>
  </group>
</body></file></xliff>`;

const root = await mkdtemp(join(tmpdir(), "la-qa-write-gate-"));
const mxliffPath = join(root, "newline.mxliff");
await writeFile(mxliffPath, mxliff, "utf8");

await importPhraseBatch(root, { projectId: "proj", batchId: "b1", mxliffPath });

await assert.rejects(
  () =>
    updateSegmentTarget(root, "proj", "b1", {
      segmentId: "job:1",
      target: "First line\\nSecond line",
      confirm: true,
      reason: "literal newline must be blocked at write time",
      changeType: "user_approved",
    }),
  /QA write-blocking gate/,
);

const unchanged = await readBatch(root, "proj", "b1");
assert.equal(unchanged.segments[0]?.target, "First line\nSecond line");

const platformGate = await runPlatformWriteGate(root, "proj", "b1", "job:1", "First line\\nSecond line");
assert.equal(platformGate.ok, false);
assert.equal(platformGate.blockers.some((item) => item.code === "LITERAL_NEWLINE_MISMATCH"), true);

const accepted = await runPlatformWriteGate(root, "proj", "b1", "job:1", "First line\\nSecond line", ["job:1:LITERAL_NEWLINE_MISMATCH"]);
assert.equal(accepted.ok, false, "hard newline mismatch must still block when only literal newline is accepted");

const emptyRuleContext = {
  mode: "legacy_builtin" as const,
  rulesDigest: "",
  activeProjectRules: [],
  disabledBuiltinIds: [],
  candidateRuleCount: 0,
  disabledRuleCount: 0,
  trace: [],
};
const icuGate = runQaWriteGate(
  { id: "icu-1", source: "{gender:He|She} joined the party." },
  "{gender:They} joined the party.",
  emptyRuleContext,
);
assert.equal(icuGate.ok, false, "ICU branch arity must be blocked before a candidate can enter CAT state");
assert.equal(icuGate.blockers.some((item) => item.code === "ICU_BRANCH_ARITY_MISMATCH"), true);

console.log("qa_write_gate tests passed");
