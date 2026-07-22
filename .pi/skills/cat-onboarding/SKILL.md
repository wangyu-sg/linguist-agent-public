---
name: cat-onboarding
description: Onboard a game localization project folder by identifying source files, bilingual files, TM/TB/glossary assets, references, tag risks, and blocked import questions.
---

# CAT Onboarding

Use this skill when the user asks to set up or onboard a new localization project.

## Workflow

1. Call `project_onboard` first when a user gives a project folder path. Let it save the project manifest unless the user explicitly asks for dry-run only.
2. Call `project_read` when the user refers to an existing onboarded project id.
3. Call `project_refresh` when the user says assets may have changed, uploaded new files, or asks to check freshness before a new batch.
4. Call `project_health` before starting a real translation/review/delivery run. Report blockers/warnings before proceeding.
5. Prefer the `Suggested Actions` table from `project_onboard` / `project_refresh` as the executable import checklist; do not invent a different tool path unless the user corrects the role.
6. Use `ls`, `find`, `grep`, or read-only tools only for follow-up inspection.
7. Classify files into source batch, bilingual interchange, TM, termbase/glossary, reference, image, and unknown.
8. Detect companion-file patterns, especially Phrase `.mxliff` plus master `.xliff` files needed to restore tags.
9. For TMX files, call `tm_import_tmx`. For SDLTM files, call `tm_import_sdltm`. For XLSX/CSV/TSV/TXT/MD translation-memory tables, call `workbook_preview` and confirm source/target columns before `tm_import_table`.
10. For SDLTM files, never parse them as text; use the deterministic SQLite-backed `tm_import_sdltm` importer.
11. For XLSX/CSV/TSV/TXT/MD terminology tables, call `workbook_preview` and confirm source/target columns before `termbase_import_table`.
12. For TBX files, call `termbase_import_tbx`; for SDLTB files, call `termbase_import_sdltb` and report any mdbtools error directly.
13. Run `asset_blocks_build` after readable reference/style assets are confirmed.
14. Once the plan is clear and the user asks to continue, import Phrase batches with `batch_import_phrase`, memoQ plain MQXLIFF batches with `batch_import_mqxliff`, Trados batches with `batch_import_sdlxliff`, generic XLIFF 1.2/2.0 batches with `batch_import_xliff`, CSV table-paste batches with `batch_import_csv`, and XLSX table-paste batches with `batch_import_xlsx`.
15. Do not modify original client files during onboarding.
16. Ask concise questions only for blocking ambiguities.

## Output

Produce:

- project role map
- likely import order
- tag/lock/duplicate segment risks
- imported batch ids, when imported
- asset questions
- next actions
