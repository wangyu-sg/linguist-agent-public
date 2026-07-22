# Distillation behavior-verification runbook

Verifies the domain-distillation gate shipped in `4e783d3` / v2.30.6: **classify-first +
text-function strategy + obey-project-assets**. Structure tests (`tests/expert_prompt_non_erosion.test.ts`)
already prove the *prompt wording* did not erode. This runbook proves the *behavior*: that a
live model actually picks the right strategy per text function. Behavior can only be verified by
running the model and judging the output — so this is a human-judged runbook, not an assertion test.

Two parts:

- **Part A — 4 behavior smoke cases** (fast; "did the gate fire at all?"). Run + eyeball-judge.
- **Part B — v3 human eval pack → scorecard delta** (quantified; the real bottleneck is human scoring).

## Hard constraints (both parts)

1. **Same model as the v0 baseline: `deepseek-v4-pro:xhigh`.** The gate is a *prompt* change. A
   different model would make the delta conflate prompt-vs-model. The v0 baseline rows record
   `modelVersion: "deepseek-v4-pro:xhigh"`; match it exactly.
2. **No client raw text in the repo.** Source strings here are synthetic/representative. Live model
   *output* is for the rater's eyes only and must **not** be committed. Scorecard JSONL stores only
   `segId` references — the parser's `RAW_TEXT_KEYS` guard throws on any `source`/`sourceText`/etc.
3. **Claude must not fabricate `judge:"human:…"` rows.** The 1–5 scores are a human act. The
   automatable parts (fixtures, re-runs, encoding, delta render, guard test) are done; the scoring is not.

---

## Part A — run the 4 smoke cases

Cases live in [`smoke-cases.json`](./smoke-cases.json). Each command is the existing `agent:smoke`
template (`package.json`) with the model pinned and the per-case tools/prompt swapped in. The model
must first **classify** (function + distance), then deliver the submission-ready target.

> Prereq: `pi` on PATH (`/opt/homebrew/bin/pi`) and a DeepSeek credential available to pi (keychain/env).
> If your pi build expresses reasoning effort as a separate flag, set it so the model identity is
> exactly `deepseek-v4-pro:xhigh`.

> **Harness scope (read before judging case 3/4).** This CLI smoke wires the gate's *prompt*
> (classification + text-function strategy), but it does **not** register the executable CAT tools.
> `.pi/extensions/cat-tools.ts` only registers slash commands (`cat-status`, `cat-tools`); the real
> `tm_lookup` / `termbase_lookup` / `proposal_create` tools are built by `buildCatTools()` and
> registered **only** in the cat-server session (`createCatAgentSession` `customTools`). So a raw
> `pi -p` run reports "Available tools: none" for them. Consequence: cases 1–2 (and the strategy
> half of case 3) are fully testable here because they need only prompt-level reasoning — which is
> exactly what the distillation changed. The *tool-grounded* steps (case 3's `proposal_create`
> routing, case 4's termbase obedience) cannot fire via the CLI and must be verified through the
> cat-server harness on a project whose assets contain the term. (The existing `npm run agent:smoke`
> shares this limitation — its `--tools tm_lookup` names a tool the CLI session does not register.)

### Case 1 — `informative-ui-no-evidence` (expect: invisible conventional, NOT transcreation)

```sh
pi --provider deepseek --model deepseek-v4-pro:xhigh --no-extensions \
  -e ./.pi/extensions/cat-tools.ts -e ./.pi/extensions/memory.ts \
  -e ./.pi/extensions/dev-code-proposals.ts -e ./.pi/extensions/discord-bridge.ts \
  --tools cat_tools_list --no-session \
  -p "Translate this zh-CN game string to en-US. First classify it (function: informative/operational vs expressive/persuasive; distance: diegetic vs non-diegetic), then deliver the submission-ready en-US target with a one-line rationale. Source: 背包已满"
```

PASS = standard UI string ("Inventory full" / "Bag is full") + says it's informative so no transcreation.
FAIL = adds flavor/voice/wordplay to a plain label.

### Case 2 — `expressive-flavor-character` (expect: committed localized choice + rationale)

```sh
pi --provider deepseek --model deepseek-v4-pro:xhigh --no-extensions \
  -e ./.pi/extensions/cat-tools.ts -e ./.pi/extensions/memory.ts \
  -e ./.pi/extensions/dev-code-proposals.ts -e ./.pi/extensions/discord-bridge.ts \
  --tools cat_tools_list --no-session \
  -p "Translate this zh-CN game flavor line to en-US. First classify it (function + distance), then deliver the submission-ready en-US target with a one-line rationale. Source: 「这把剑啊,砍过的牛比你吹过的还多。」"
```

PASS = voiced, idiomatic line that keeps the swagger/humor + one-line expert rationale; not a flat gloss.
FAIL = flat literal gloss, or over-hedged needs_review where nothing is in conflict.

### Case 3 — `operational-no-evidence-insufficient` (expect: conventional + flag, not invention)

```sh
pi --provider deepseek --model deepseek-v4-pro:xhigh --no-extensions \
  -e ./.pi/extensions/cat-tools.ts -e ./.pi/extensions/memory.ts \
  -e ./.pi/extensions/dev-code-proposals.ts -e ./.pi/extensions/discord-bridge.ts \
  --tools cat_tools_list,proposal_create --no-session \
  -p "Translate this zh-CN game system string to en-US. First classify it (function + distance). If the source is ambiguous, route the uncertainty through proposal_create with a query / needs_review rather than inventing a confident final string. Source: 你并没有足够的采购数"
```

PASS = conventional string ("Insufficient purchase attempts" / "Not enough purchases") AND a
proposal_create query/needs_review for the ambiguity. FAIL = confident invented/flavored string, no flag.

### Case 4 — `termbase-hit-obey-asset` (expect: obey the project termbase, cite it)

Seed/confirm a project termbase entry for the term first (mirror the `npm run agent:smoke` pattern).

```sh
pi --provider deepseek --model deepseek-v4-pro:xhigh --no-extensions \
  -e ./.pi/extensions/cat-tools.ts -e ./.pi/extensions/memory.ts \
  -e ./.pi/extensions/dev-code-proposals.ts -e ./.pi/extensions/discord-bridge.ts \
  --tools cat_tools_list,tm_lookup --no-session \
  -p "Use cat_tools_list, then tm_lookup, to find the project-governed English target for source term \`勇者徽记\`. Obey the project's own termbase over your own taste; answer with the target plus one evidence sentence citing the termbase."
```

PASS = returns the termbase-governed target + cites the termbase as authority. FAIL = coins a "better"
term ignoring the termbase, or cites a tool trace as if it were evidence.

### Record verdicts here (copy into the run)

| Case | Date | Model identity | Verdict (PASS/FAIL) | Notes |
|---|---|---|---|---|
| informative-ui-no-evidence | 2026-06-25 | deepseek-v4-pro:xhigh | PASS | Classified informative/non-diegetic; returned "Inventory Full"; no transcreation. |
| expressive-flavor-character | 2026-06-25 | deepseek-v4-pro:xhigh | PASS | Caught 砍牛↔吹牛 pun; committed voiced line "carved up more cattle than the bull you've been spouting" + rationale. |
| operational-no-evidence-insufficient | 2026-06-25 | deepseek-v4-pro:xhigh | PASS (strategy) | Conventional "Insufficient purchase count."; flagged the 数 ambiguity in prose; explicit "not embellished". Did NOT fire proposal_create — no project/segment context in a --no-session one-shot, so the query tool had nothing to attach to. Strategy correct; workflow step untestable here. |
| termbase-hit-obey-asset | 2026-06-25 | deepseek-v4-pro:xhigh | NOT RUNNABLE VIA CLI | The `pi` CLI smoke does not register executable CAT tools (see Harness scope below); the model reported "Available tools: none" and correctly refused to fabricate a termbase citation. This case needs the cat-server session harness, AND a project whose termbase actually contains the term — `勇者徽记` currently appears only as source text (synthetic term fixture), with no termbase entry anywhere. Verify obey-asset through the server path, not this CLI runbook. |

If all four read PASS, the gate fires as intended and Part B (the quantified delta) is worth the human-scoring cost.

---

## Part B — v3 human eval pack → scorecard delta

The delta math already exists: `renderQualityScorecardReport(rows)` auto-emits a **"Delta vs v0"**
table once `rows[]` carries ≥2 prompt versions (baseline = lexicographically smallest, so `v0` < `v3`
⇒ delta = v3 − v0). Nothing to compute — the gap is a second version's *human-scored* rows.
`tests/quality_scorecard_delta.test.ts` validates this machinery now and auto-guards the real file
the moment it appears.

### Step 1 — re-run output (automatable)

For each selected seg, re-translate with the **same model `deepseek-v4-pro:xhigh` + the current v3
prompt**. Raw output is rater-only; it does **not** enter the repo.

### Step 2 — pick segs in two layers, add ONE new dimension (the key design point)

- **Expressive control segs** (an ITEM/DLG subset) → score the 3 existing creativity dimensions
  (`voice_character_strength`, `pun_wordplay_transcreation`, `target_fluency_idiomaticity`) → proves
  the distillation did **not erode** creative quality (behavioral echo of the structure test).
- **Informative/operational segs** (UI / NOTIFY / MAIN / MAIL / RACEPOOLPURCHASE …) → score the
  **new dimension `function_strategy_fit`**. This dimension is mandatory: the 3 creativity
  dimensions can't see "correct invisibility" — on an informative seg they'd misread *correct
  restraint* as *low voice*. Without `function_strategy_fit` the delta is blind to what the
  distillation actually changed.

`function_strategy_fit` 1–5 anchors:

| Score | Meaning |
|---|---|
| 5 | Strategy exactly fits the seg's function: informative → clean conventional rendering; expressive → committed localized choice. No over/under-shoot. |
| 4 | Right strategy, minor polish needed. |
| 3 | Right strategy but partially mis-executed (e.g. a faint embellishment on an informative line). |
| 2 | Partly wrong strategy (transcreated an operational label, or flattened an expressive line). |
| 1 | Wrong strategy outright (clever rewrite of a system string; literal gloss of flavor). |

### Step 3 — human scoring (the bottleneck; only a human can)

A rater (a human reviewer or a `human:eval-pack-YYYYMMDD` pack like v0) scores each (seg × dimension) 1–5.
Claude must not fill these in — it pollutes human-judged credibility, which is exactly what the
parser + tests guard.

### Step 4 — encode to `synthetic-game-v3.jsonl` (automatable once scores exist)

New file: `packages/cat-runtime/eval/scorecards/synthetic-game-v3.jsonl`. Per-field schema is
identical to the v0 baseline. One row per (seg × dimension), one JSON object per line, **no raw-text
fields** (`source`, `sourceText`, `target`, … all rejected by the parser). Template row:

```json
{"schemaVersion":1,"promptVersion":"v3","modelVersion":"deepseek-v4-pro:xhigh","evalSet":"synthetic-game-translation-test:Nseg","segNo":1,"segId":"<segId-reference-only>","dimension":"function_strategy_fit","score":5,"judge":"human:eval-pack-YYYYMMDD","timestamp":"2026-06-25T00:00:00.000Z","issueTier":"OK","issueCategories":["function-strategy"]}
```

Rules: `promptVersion:"v3"`; `modelVersion:"deepseek-v4-pro:xhigh"` (hard constraint); reuse the v0
`evalSet` string (append `:Nseg` if a subset); `judge:"human:eval-pack-YYYYMMDD"`; segId is a
reference only, never the source string.

### Step 5 — render the delta

```sh
npx tsx -e '
import { readFile } from "node:fs/promises";
import { parseQualityScorecardJsonl, renderQualityScorecardReport } from "@linguist-agent/cat-runtime";
const base = "packages/cat-runtime/eval/scorecards/synthetic-game-v0.baseline.jsonl";
const v3 = "packages/cat-runtime/eval/scorecards/synthetic-game-v3.jsonl";
const rows = [
  ...parseQualityScorecardJsonl(await readFile(base, "utf8"), base),
  ...parseQualityScorecardJsonl(await readFile(v3, "utf8"), v3),
];
console.log(renderQualityScorecardReport(rows));
'
```

The output's "Version Delta" table shows v3 − v0 for the shared creativity dimensions (proves
non-erosion) and an `n/a` row for `function_strategy_fit` (no v0 baseline — read its absolute
average from the "Dimension Summary" instead). Save a no-raw-text copy of this report into
`data/reports/` per `docs/reports/INDEX.md`.

### Step 6 — guard test (already wired)

`tests/quality_scorecard_delta.test.ts` runs in `npm test` after `quality_scorecard.test.ts`. Today
it validates the delta machinery on a synthetic in-memory pack. Once `synthetic-game-v3.jsonl`
exists with rows, the same test additionally asserts: every row is `promptVersion v3`, the model is
`deepseek-v4-pro:xhigh`, scores are human-judged, `function_strategy_fit` is present, and the
combined v0+v3 report renders a "Delta vs v0" table. No edit needed — it auto-engages the file.
