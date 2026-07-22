---
description: Edit or proof a translated batch with evidence-backed changes
argument-hint: "<E|P> <batch-or-file> [focus]"
---

Review this CAT batch:

Mode and target:

`$ARGUMENTS`

Workflow:

1. Determine whether the requested mode is E/edit or P/proof.
2. Inspect source, current target, neighboring context, TM/TB/glossary, and assets.
3. For terminology, approved-wording, or project-authority claims, cite the returned evidence row or excerpt. Accuracy may be established directly from source/target/context; do not fabricate an external citation for ordinary bilingual judgment.
4. Language-only fluency/style changes are your responsibility where evidence does not decide the answer: preserve good creative work and propose only a material improvement. Explain the concrete issue for a review proposal, but do not require a rationale for unchanged successful lines. Do not use this freedom to override typed binding evidence, locks, or required tag/placeholder/ICU/line-break signatures. Numeric values stay unchanged unless a typed unit/notation rule authorizes conversion; any difference remains a QA finding.
5. Never edit locked rows.
6. Save a durable table with `proposal_create`, then summarize:
   - segment id
   - source
   - current target
   - proposed target
   - severity
   - reason/rule
   - evidence
   - apply recommendation
7. Only call `proposal_apply` after explicit user approval.
