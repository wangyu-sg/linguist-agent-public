import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTmStore, createWorkspace } from "@linguist-agent/cat-data";

// L3 regression: a confirmed/reviewed TM row (origin="reviewed") must survive a client TM
// bulk re-import (replacing mode) — client imports may only replace client_tm/imported/unknown
// rows, never human-reviewed truth. Previously only the happy path was tested.
const workspace = createWorkspace(await mkdtemp(join(tmpdir(), "la-tm-reviewed-")), "proj");
const tm = createTmStore(workspace);

await tm.upsertReviewed({
  source: "勇者徽记",
  target: "Hero Emblem",
  srcLang: "zh-CN",
  tgtLang: "en-US",
  project: "proj",
});

// A client TM import (non-append => replacing) that includes the SAME source with a different target.
await tm.importClientEntries(
  [{ source: "勇者徽记", target: "Hero Emblem (client)", srcLang: "zh-CN", tgtLang: "en-US", project: "proj" }],
  { srcLang: "zh-CN", tgtLang: "en-US", project: "proj" },
);

const all = await tm.list();
const reviewed = all.filter((entry) => entry.origin === "reviewed" && entry.source === "勇者徽记");
assert.equal(reviewed.length, 1, "the reviewed TM row must be preserved through a client TM replace");
assert.equal(reviewed[0].target, "Hero Emblem", "client import must not overwrite the reviewed target");

const bulkRows = Array.from({ length: 30000 }, (_, index) => ({
  source: `批量源 ${index}`,
  target: `Bulk Target ${index}`,
  srcLang: "zh-CN",
  tgtLang: "en-US",
  project: "proj",
}));
const bulkStarted = Date.now();
const bulkResult = await tm.importClientEntries(bulkRows, { srcLang: "zh-CN", tgtLang: "en-US", project: "proj" });
assert.equal(bulkResult.imported, 30000, "bulk import should insert all unique client TM rows");
assert.ok(Date.now() - bulkStarted < 10000, "bulk import should use indexed lookup rather than per-row full scans");

console.log("tm_reviewed_writeback tests passed");
