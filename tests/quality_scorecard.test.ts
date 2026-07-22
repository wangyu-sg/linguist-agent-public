import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import {
  parseQualityScorecardJsonl,
  renderQualityScorecardReport,
  summarizeQualityScorecards,
} from "@linguist-agent/cat-runtime";

const scorecardPath = "packages/cat-runtime/eval/scorecards/synthetic-game-v0.baseline.jsonl";
const rows = parseQualityScorecardJsonl(await readFile(scorecardPath, "utf8"), scorecardPath);

assert.equal(rows.length, 55);
assert.equal(new Set(rows.map((row) => row.promptVersion)).size, 1);
assert.equal(rows.every((row) => row.promptVersion === "v0"), true);
assert.equal(rows.every((row) => row.score >= 1 && row.score <= 5), true);
assert.equal(rows.some((row) => row.dimension === "voice_character_strength"), true);
assert.equal(rows.some((row) => row.dimension === "pun_wordplay_transcreation"), true);
assert.equal(rows.some((row) => row.dimension === "target_fluency_idiomaticity"), true);

const summary = summarizeQualityScorecards(rows);
assert.deepEqual(summary.promptVersions, ["v0"]);
assert.equal(summary.buckets.some((bucket) => bucket.promptVersion === "v0" && bucket.count > 0), true);

const report = renderQualityScorecardReport(rows);
assert.match(report, /non-blocking Phase B/);
assert.match(report, /never wired into `rc:status`/);
assert.match(report, /Capture v1 rows/);

assert.throws(
  () =>
    parseQualityScorecardJsonl(
      JSON.stringify({
        schemaVersion: 1,
        promptVersion: "v0",
        modelVersion: "model",
        evalSet: "fixture",
        segId: "s1",
        dimension: "voice_character_strength",
        score: 3,
        judge: "human",
        timestamp: "2026-06-15T00:00:00.000Z",
        source: "raw client text must not be tracked",
      }),
      "bad.jsonl",
    ),
  /must not contain raw text field/,
);

console.log("quality scorecard tests passed");
