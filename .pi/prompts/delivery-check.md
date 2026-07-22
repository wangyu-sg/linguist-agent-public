---
description: Run final delivery readiness checks for a CAT project or batch
argument-hint: "<project-or-batch>"
---

Run a delivery readiness check for:

`$ARGUMENTS`

Check:

1. untranslated editable rows
2. locked row preservation
3. missing inline tags or placeholder corruption
4. unapplied review proposals
5. terminology and cross-batch consistency risks
6. export-format risks
7. TM/TB update status

Call `delivery_check` when an imported batch id is known. If delivery passes and the user asks to export, use `export_phrase_docx` for Phrase bilingual DOCX upload workflows, `export_phrase_mxliff` for Phrase MXLIFF workflows, `export_mqxliff` for memoQ plain MQXLIFF workflows, `export_sdlxliff` for Trados SDLXLIFF workflows, `export_xliff` for generic XLIFF 1.2/2.0 workflows, `export_csv` for CSV table-paste workflows, or `export_xlsx` for XLSX table-paste workflows.

Return blockers first, then warnings, then recommended delivery steps.
