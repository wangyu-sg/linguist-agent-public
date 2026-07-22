---
name: cat-workflow-control
description: Use when starting CAT batch work, applying proposals or unconfirmed first-pass targets, handling quality, delivery, tag, untranslated, waiver, customer-return, or export blockers.
---

# CAT Workflow Control

Use this skill as the CAT control-plane runbook. It does not replace the translate, review, or delivery skills; it tells you where the hard gates sit and what to do when a gate blocks work.

## Gate Order

1. Project/batch start: call `project_context` with `includeHealth=true` or call `project_health`. If assets may have changed, call `project_refresh` first.
2. Evidence baseline: for TM/TB-heavy work, call `evidence_pack` and `constraint_pack` before writing. Treat only rows that the typed packet marks binding as constraints; exact TM binds only under its effective policy, and fuzzy TM is advisory context rather than an automatic overwrite or blocker. Use live `tm_lookup`, `tm_concordance`, `termbase_lookup`, `glossary_lookup`, and asset tools for flagged or term-sensitive rows.
3. Voice baseline: reuse a confirmed voice profile and exemplars when they exist. Build and confirm a new profile only when recurring speakers, brand voice, or a coherent expressive batch provide enough evidence for it to improve consistency; do not impose profile ceremony on small or one-off work.
4. Draft/proposal:
   - Translation/T work may write unconfirmed submission-ready targets with `batch_set_targets` after evidence review (quality bar = final; only confirmation state is deferred).
   - Edit/proof work stays `proposal_create` first.
5. Quality gate: after proposal creation or unconfirmed target writes, run `quality_audit` and `expressive_audit`. Deterministic typed blockers must be fixed or explicitly decided before export. Expressive heuristics remain reviewable signals unless project policy gives the specific finding blocking authority.
6. Apply gate: apply only explicitly approved proposals. If a finding is rejected, do not treat the remaining rows as blanket-approved unless the user said so.
7. Delivery gate: before export, run `delivery_check`, `quality_audit`, and `expressive_audit`.
8. Export: export only when delivery has no active blockers and quality has no open blockers, unless the user explicitly accepts scoped risk.

## Authority

Use the effective authority and binding/advisory status supplied by the typed CAT packet. Locks and code-enforced structural constraints are immutable. Exact TM binds only when its effective authority/policy says so; fuzzy TM is advisory. A style guide, customer return, terminology row, or platform readback must not be promoted into a universal hierarchy outside its recorded scope.

If typed authorities conflict or their scope is unclear, preserve the currently binding value, create a query or needs-review proposal, and report the conflict. Do not silently invent precedence from taste.

## Blocker Types

| Type | Source | Meaning | Action |
|---|---|---|---|
| Quality blocker | `quality_audit` | Deterministic term/TM/consistency issue such as `TERM_PREFERRED_MISSING` or `TM_EXACT_TARGET_MISMATCH`. | Fix and rerun `quality_audit`, or use `quality_waiver` for the exact `findingId`/`code` only after explicit user acceptance. |
| Delivery blocker | `delivery_check` | Export safety issue: tags, placeholders, locked rows, unresolved structure, or `UNTRANSLATED_EDITABLE`. | Fix and rerun `delivery_check`, or use `delivery_accept_risk` for the exact batch/segment/code only after explicit user acceptance. |
| Tag signature mismatch | `delivery_check` | `PROJECT_TAG_SIGNATURE_MISMATCH` or related source-target signature mismatch after a target exists. | Fix the target signature or request explicit delivery risk acceptance via `delivery_accept_risk`. |
| Unapplied proposal | proposal/readiness | Suggested change exists but is not applied. | Ask whether to apply, reject, or leave pending; do not auto-apply from silence. |
| Customer return | returned client file | Client edits must become project evidence. | Run `customer_return_learn` before new translation/review decisions. |
| Voice/register issue | `expressive_audit` | Expression-layer issue such as register mismatch, voice inconsistency, or translationese. | Fix the line, adjust/confirm the voice profile or exemplar evidence, then rerun `expressive_audit`; waive only with explicit user acceptance. |

> **Preflight decision (not a stop-work blocker):** source-only tag-rule discovery (`tag_rule_discovery`) decides whether a project tag rule should exist at all. It is an onboarding/preflight confirm-or-disable decision, separate from source-target signature checking, and does not block export on its own. Only `delivery_check` tag-signature findings block export.

## Waiver Rules

Waivers are explicit risk records, not cleanup. A valid waiver must include:

- user confirmation,
- exact scope: project, batch, segment or finding, and code,
- reason,
- rerun of the relevant gate after recording.

Use `delivery_accept_risk` for delivery blockers and `quality_waiver` for quality findings. Both require user confirmation, a reason, and leave an auditable record; a waived item stays visible in reports and does not become a silent pass.

## No-Loop Protocol

If the same blocker repeats unchanged, STOP. Report:

```text
Blocked by: <quality|delivery|tag|untranslated|proposal>
Codes: <codes>
Scope: <project/batch/segment count and examples>
Options:
1. Fix <exact change>
2. Record scoped waiver <only if user accepts risk>
3. Stop and ask client/project owner <when authority conflicts>
```

Do not retry the same export, apply, or write unchanged. Do not use `force=true` unless the user explicitly asks for emergency export despite known blockers.
