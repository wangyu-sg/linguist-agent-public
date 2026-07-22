---
description: Onboard a localization project from a folder path
argument-hint: "<project-folder>"
---

Onboard this localization project folder:

`$ARGUMENTS`

Work as a CAT project onboarding agent:

1. Inspect the folder structure and identify source files, bilingual files, TM/TB/glossary assets, reference assets, images, and likely locked/tag-bearing companion files.
2. Call `project_onboard` first and let it persist a manifest.
3. For terminology tables, call `workbook_preview` and confirm source/target mapping before `termbase_import_table`.
4. For TBX files, call `termbase_import_tbx`; for SDLTB files, call `termbase_import_sdltb` and report mdbtools failures directly.
5. After readable reference/style assets are confirmed, call `asset_blocks_build`.
6. If the user asks to proceed and a Phrase `.mxliff` + master `.xliff` pair is clear, call `batch_import_phrase` to create a workspace batch.
7. Do not rewrite client files during onboarding. Workspace import is allowed; client export is a later explicit action.
8. Ask only the asset questions that block a safe import.
9. Output:
   - detected files by role
   - missing or ambiguous assets
   - tag/lock risks
   - imported batch ids, if any
   - proposed next commands/actions
