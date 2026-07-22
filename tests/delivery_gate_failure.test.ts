import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportPhraseMxliff, importPhraseBatch, runDeliveryCheck } from "@linguist-agent/cat-data";

// M8 regression: the delivery gate's export-blocking throw must actually fire on its
// FAILURE path (a batch with blockers), and force=true must override it. Previously every
// export test ran against a clean batch or passed force:true, so the blocking branch had
// no coverage and a regression could let a blocked batch export silently.

const master = `<?xml version="1.0"?>
<xliff version="1.2"><file source-language="zh-CN" target-language="en-US"><body>
  <trans-unit id="1001"><source>已翻译</source><target>Translated</target></trans-unit>
  <trans-unit id="1002"><source>未翻译</source><target></target></trans-unit>
</body></file></xliff>`;

const mxliff = `<?xml version="1.0"?>
<xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file original="master.xliff" source-language="zh-cn" target-language="en-us"><body>
  <group id="1" m:para-id="1"><context-group><context context-type="x-key">1001</context></context-group>
    <trans-unit id="job:1" m:para-id="1" m:locked="false"><source>已翻译</source><target>Translated</target></trans-unit>
  </group>
  <group id="2" m:para-id="2"><context-group><context context-type="x-key">1002</context></context-group>
    <trans-unit id="job:2" m:para-id="2" m:locked="false"><source>未翻译</source><target></target></trans-unit>
  </group>
</body></file></xliff>`;

const root = await mkdtemp(join(tmpdir(), "la-delivery-gate-fail-"));
const masterPath = join(root, "master.xliff");
const mxliffPath = join(root, "batch.mxliff");
await writeFile(masterPath, master, "utf8");
await writeFile(mxliffPath, mxliff, "utf8");

await importPhraseBatch(root, { projectId: "proj", batchId: "b1", mxliffPath, masterPath });

// One editable segment has an empty target → UNTRANSLATED_EDITABLE blocker.
const delivery = await runDeliveryCheck(root, "proj", "b1");
assert.ok(
  delivery.blockers.some((blocker) => blocker.code === "UNTRANSLATED_EDITABLE"),
  "an empty editable target must raise an UNTRANSLATED_EDITABLE blocker",
);

// The export gate must REJECT while blockers exist...
await assert.rejects(
  () => exportPhraseMxliff(root, { projectId: "proj", batchId: "b1" }),
  /Do not retry the same export/,
  "export must throw when the delivery gate has blockers",
);

// ...and force=true must override the gate (emergency export).
const forced = await exportPhraseMxliff(root, { projectId: "proj", batchId: "b1", force: true });
assert.ok(forced.outputPath, "force=true must allow emergency export past the gate");

console.log("delivery_gate_failure tests passed");
