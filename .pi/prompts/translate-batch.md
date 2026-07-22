---
description: Translate a batch with TM/TB/assets as evidence
argument-hint: "<batch-or-file> [instructions]"
---

Translate this CAT batch or file:

`$ARGUMENTS`

Workflow:

1. Inspect project context and source format. If the batch is already imported, call `batch_read` first.
2. For TM/TB-heavy batches, call `evidence_pack` and `constraint_pack` before writing. Obey rows the typed packet marks as binding; exact TM binds only under its effective authority/policy, while fuzzy TM is advisory. Do not turn every retrieved match into a universal mechanical rule.
3. Use live TM/terminology/asset tools for flagged or term-sensitive strings. Current evidence tools include `tm_lookup`, `tm_concordance`, `termbase_lookup`, `glossary_lookup`, `asset_block_search`, `asset_grep`, and `asset_read`. Read the `cat-translate` skill for the full constraint-framing pattern.
4. Preserve inline tags, placeholders, punctuation intent, and locked rows.
5. Save first-pass translations with `batch_set_targets`; rows are **unconfirmed submission-ready targets** — the quality bar equals the final bar, only the confirmation state is deferred. "Unconfirmed" never means "lower quality" or "a rough draft for someone else to fix."
6. Cite the returned evidence when a project term, TM row, asset, or external fact controls a choice. Do not add evidence boilerplate to ordinary linguistic decisions or pretend that absence of a lookup is evidence.
7. Reuse a confirmed voice profile and exemplars when they exist. Build and confirm a new profile when recurring speakers, brand voice, or a coherent expressive batch provide enough evidence for it to improve cross-segment consistency; do not block a small or one-off expressive task on profile ceremony.
8. After writing, run `quality_audit` and `expressive_audit`; fix deterministic blockers or surface their exact scope for an explicit user decision before apply/export. Expressive heuristics are review signals unless typed project policy makes a finding blocking.
9. Leave E/edit and P/proof changes to `proposal_create` and only call `proposal_apply` when the user explicitly approves proposal rows.
