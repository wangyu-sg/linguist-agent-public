---
name: cat-delivery
description: Check CAT project delivery readiness: untranslated rows, locked rows, inline tags, unapplied proposals, terminology consistency, export risk, and TM/TB update status.
---

# CAT Delivery

Use this skill before client delivery or export.

For gate order, blockers, waivers, customer returns, and no-loop behavior, read the `cat-workflow-control` skill.

## Checks

- editable untranslated rows
- locked row preservation
- inline tag and placeholder integrity
- duplicate segment propagation
- unapplied review proposals
- terminology and cross-batch consistency
- deterministic TM/TB quality audit findings
- TM/TB update status
- export format risks

## Output

List blockers first. Then warnings. Then exact delivery steps.

## Export

When the user asks for a client deliverable, call `project_health` first for project-wide readiness, then call `delivery_check` and `quality_audit` for the target batch. If delivery passes and quality has no open blockers:

- Use `export_phrase_docx` when Phrase only allows bilingual DOCX upload.
- Use `export_phrase_mxliff` when the client/PM expects MXLIFF.
- Use `export_mqxliff` when the client/PM expects memoQ plain MQXLIFF.
- Use `export_sdlxliff` when the client/PM expects Trados SDLXLIFF; choose role `T`, `E`, or `P` so Trados confirmation levels reflect the actual review stage.
- Use `export_xliff` when the client/PM expects generic XLIFF 1.2/2.0.
- Use `export_csv` or `export_xlsx` for simple table-paste workflows.

If export fails on the same delivery or quality blockers, stop and report the blocker codes instead of retrying the same export. When the user explicitly accepts a specific delivery blocker, call `delivery_accept_risk` with the exact batch, segment, and code, then rerun `delivery_check`. When the user accepts a quality finding, record the explicit quality acceptance before export; do not silently bypass TM/TB quality blockers.

Do not set `force=true` unless the user explicitly asks to export despite known blockers.
