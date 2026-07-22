import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  parseQualityScorecardJsonl,
  renderQualityScorecardReport,
  summarizeQualityScorecards,
} from "@linguist-agent/cat-runtime";

// ---------------------------------------------------------------------------
// Part 1 — machinery check on a synthetic in-memory v0+v3 pack.
//
// Proves the delta renderer emits "Delta vs v0" once two prompt versions are
// present, that a shared dimension renders a numeric delta, and that a NEW
// dimension only scored under v3 renders as n/a in the delta table (its
// absolute average is read directly from the Dimension Summary). These rows
// carry no client raw text and no fabricated human scores — they are explicit
// fixture rows (judge "fixture:delta-machinery"), built through the real
// parser so the parser's privacy/schema guards run on them too.
// ---------------------------------------------------------------------------

const fixtureJsonl = [
  // v0 baseline-style rows on the existing creativity dimensions.
  { promptVersion: "v0", dimension: "voice_character_strength", segId: "FIXT_A", score: 3 },
  { promptVersion: "v0", dimension: "voice_character_strength", segId: "FIXT_B", score: 3 },
  { promptVersion: "v0", dimension: "target_fluency_idiomaticity", segId: "FIXT_A", score: 4 },
  // v3 rows on the same creativity dimensions (yield a numeric delta) ...
  { promptVersion: "v3", dimension: "voice_character_strength", segId: "FIXT_A", score: 4 },
  { promptVersion: "v3", dimension: "voice_character_strength", segId: "FIXT_B", score: 4 },
  { promptVersion: "v3", dimension: "target_fluency_idiomaticity", segId: "FIXT_A", score: 4 },
  // ... plus the NEW function-fit dimension, only under v3 (no v0 baseline -> n/a).
  { promptVersion: "v3", dimension: "function_strategy_fit", segId: "FIXT_UI", score: 5 },
  { promptVersion: "v3", dimension: "function_strategy_fit", segId: "FIXT_OP", score: 4 },
]
  .map((row) =>
    JSON.stringify({
      schemaVersion: 1,
      promptVersion: row.promptVersion,
      modelVersion: "deepseek-v4-pro:xhigh",
      evalSet: "distillation-delta-machinery:fixture",
      segId: row.segId,
      dimension: row.dimension,
      score: row.score,
      judge: "fixture:delta-machinery",
      timestamp: "2026-06-25T00:00:00.000Z",
    }),
  )
  .join("\n");

const fixtureRows = parseQualityScorecardJsonl(fixtureJsonl, "delta-fixture.jsonl");
const fixtureSummary = summarizeQualityScorecards(fixtureRows);
assert.deepEqual(fixtureSummary.promptVersions, ["v0", "v3"]);

const fixtureReport = renderQualityScorecardReport(fixtureRows);
assert.match(fixtureReport, /Delta vs v0/);
// voice avg: v0 (3+3)/2 = 3.00, v3 (4+4)/2 = 4.00 -> delta row 1.00
assert.match(fixtureReport, /\| v3 \| voice_character_strength \| 1\.00 \|/);
// new dimension has no v0 baseline -> n/a in the delta table ...
assert.match(fixtureReport, /\| v3 \| function_strategy_fit \| n\/a \|/);
// ... but its absolute average is still visible in the Dimension Summary: (5+4)/2 = 4.50
assert.match(fixtureReport, /\| v3 \| function_strategy_fit \| 2 \| 4\.50 \|/);

// The raw-text privacy guard must also reject a v3-shaped row that smuggles source text.
assert.throws(
  () =>
    parseQualityScorecardJsonl(
      JSON.stringify({
        schemaVersion: 1,
        promptVersion: "v3",
        modelVersion: "deepseek-v4-pro:xhigh",
        evalSet: "fixture",
        segId: "s1",
        dimension: "function_strategy_fit",
        score: 4,
        judge: "human:eval-pack",
        timestamp: "2026-06-25T00:00:00.000Z",
        sourceText: "raw client text must never be tracked",
      }),
      "bad.jsonl",
    ),
  /must not contain raw text field/,
);

// ---------------------------------------------------------------------------
// Part 2 — conditional guard on the REAL v3 pack, once a human has scored it.
//
// Absent today: human scoring is the bottleneck and fabricating judge:"human:"
// rows is forbidden. When the file lands it must honor the three hard
// constraints (same model, human-judged, new dimension present) and produce a
// live v0->v3 delta. See eval/fixtures/distillation/RUNBOOK.md Part B.
// ---------------------------------------------------------------------------

const baselinePath = "packages/cat-runtime/eval/scorecards/synthetic-game-v0.baseline.jsonl";
const v3Path = "packages/cat-runtime/eval/scorecards/synthetic-game-v3.jsonl";

if (existsSync(v3Path)) {
  const v3Rows = parseQualityScorecardJsonl(await readFile(v3Path, "utf8"), v3Path);
  if (v3Rows.length === 0) {
    console.log("quality scorecard delta tests passed (v3 pack present but empty; machinery validated)");
  } else {
    assert.equal(
      v3Rows.every((row) => row.promptVersion === "v3"),
      true,
      "v3 pack rows must all be promptVersion v3 (the baseline file stays frozen at v0)",
    );
    assert.equal(
      v3Rows.every((row) => row.modelVersion === "deepseek-v4-pro:xhigh"),
      true,
      "v3 pack must reuse the baseline model deepseek-v4-pro:xhigh, else the delta conflates prompt vs model",
    );
    assert.equal(
      v3Rows.every((row) => row.judge.startsWith("human:")),
      true,
      "v3 pack scores must be human-judged (judge \"human:...\"); machine-filled scores are not a valid eval pack",
    );
    assert.equal(
      v3Rows.some((row) => row.dimension === "function_strategy_fit"),
      true,
      "v3 pack must add the function_strategy_fit dimension on informative/operational segs, else the delta is blind to the distillation's actual change",
    );

    const baselineRows = parseQualityScorecardJsonl(await readFile(baselinePath, "utf8"), baselinePath);
    const combined = [...baselineRows, ...v3Rows];
    const combinedSummary = summarizeQualityScorecards(combined);
    assert.equal(combinedSummary.promptVersions.includes("v0"), true);
    assert.equal(combinedSummary.promptVersions.includes("v3"), true);
    assert.match(renderQualityScorecardReport(combined), /Delta vs v0/);
    console.log(`quality scorecard delta tests passed (real v3 pack: ${v3Rows.length} rows, v0->v3 delta rendered)`);
  }
} else {
  console.log(
    "quality scorecard delta tests passed (machinery validated; real v3 pack not yet scored — see packages/cat-runtime/eval/fixtures/distillation/RUNBOOK.md Part B)",
  );
}
