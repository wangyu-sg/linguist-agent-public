---
name: cat-review
description: Review game-localization targets for material accuracy, terminology, function, voice, fluency, and delivery issues and emit evidence-backed CAT proposals.
---

# CAT Review

Use for E/edit or P/proof work. E emphasizes meaning, terminology, context, and strategy; P emphasizes residual grammar, fluency, consistency, typography, and delivery risk. Both should preserve good creative work instead of rewriting for taste.

Read `cat-workflow-control` only when gate order, blockers, waivers, customer returns, apply, or export behavior is relevant.

## Workflow

1. Compare source, current target, neighboring context, speaker/scene, UI/length metadata, typed constraints, and relevant project evidence.
2. Separate deterministic violations from linguistic judgment. Tags/placeholders/numbers/locks and server QA remain host-owned facts; the reviewer explains or proposes a fix without recreating the QA report.
3. Raise only material findings. Do not rewrite a correct line merely to make it different.
4. Create proposals with the current source, current target, proposed target, impact, issue type, concise reason, and returned evidence refs where evidence controls the decision.
5. Use `proposal_report` before approval. Apply only the rows the user explicitly approves.

## Impact and disposition

Use the project's supplied review rubric when one exists. Do not silently impose a remembered client rubric on another project. Otherwise use:

- `blocker`: unsafe to deliver—runtime/format breakage, locked-row change, fabricated critical content, opposite meaning, or an explicit compliance red line;
- `major`: material mistranslation, omission/addition, binding-term error, wrong speaker/action/number, or broken character intent;
- `minor`: real but localized grammar, fluency, consistency, typography, or low-risk context issue;
- `advisory`: optional improvement, missing-context query, or non-blocking risk.

Disposition is `defect`, `needs_review`, `query`, or `info`. Use `query` when missing/conflicting evidence can change meaning or authority; do not turn ordinary uncertainty into a blocker.

## Evidence and judgment

- A term/TM/asset claim cites the returned row or excerpt. Exact TM binds only when typed authority says so; fuzzy TM is advisory.
- Style, fluency, register, naming, humor, and voice may be improved from expert judgment when evidence does not decide the answer. Keep these proposals reviewable and explain the concrete improvement.
- External research is for official facts, names, platform terms, cultural claims, or real target-market usage not available in project evidence. Cite source/date; never claim a lookup that did not occur.
- Preserve locks and hard constraints. A model cannot waive QA, accept risk, authorize writes, or authorize delivery.

## Output policy

- Use the closest project-supported issue/change type; do not force an invented taxonomy into free text.
- Findings and proposals must stay segment-scoped and link only same-segment evidence/findings.
- If no material issue exists, report no issue rather than manufacturing a polish pass.
