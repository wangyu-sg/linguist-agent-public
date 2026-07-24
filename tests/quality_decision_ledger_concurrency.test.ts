import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendQualityDecisionLedger,
  readQualityDecisionLedger,
  summarizeQualityDecisionLedger,
} from "@linguist-agent/cat-data";

for (let attempt = 0; attempt < 32; attempt += 1) {
  const root = await mkdtemp(join(tmpdir(), "la-quality-ledger-concurrency-"));
  try {
    await Promise.all([
      appendQualityDecisionLedger(root, {
        projectId: "project-1",
        batchId: "batch-1",
        findingId: "finding-1",
        kind: "quality_finding",
        decision: "open",
        recordedAt: "2026-07-24T00:00:00.000Z",
      }),
      appendQualityDecisionLedger(root, {
        projectId: "project-1",
        batchId: "batch-1",
        findingId: "finding-1",
        kind: "quality_waiver",
        decision: "ignore_with_reason",
        reason: "Approved wording.",
        recordedAt: "2026-07-24T00:00:01.000Z",
      }),
      appendQualityDecisionLedger(root, {
        projectId: "project-1",
        batchId: "batch-1",
        kind: "export_authorization",
        decision: "authorized",
        reason: "All findings reviewed.",
        recordedAt: "2026-07-24T00:00:02.000Z",
      }),
    ]);
    const events = await readQualityDecisionLedger(root, "project-1");
    assert.deepEqual(events.map((event) => event.sequence), [1, 2, 3]);
    assert.equal(summarizeQualityDecisionLedger(events).openFindings, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

console.log("quality decision ledger concurrency tests passed");
