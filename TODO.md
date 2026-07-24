# TODO

Current product version: `2.32.7`.

The repository remains on the release candidate track but is now in controlled refactor mode. The former state label was `release candidate, feature freeze`; that blanket freeze is explicitly superseded. This file remains the human entry point for unfinished work; the only detailed, machine-validated refactor control plane is the seven-document set under `docs/roadmap/` listed below. Implementation is authorized only for one queue entry whose metadata says `Kind=ticket` and `Executable=yes`; Epic, Gate, and Decision entries are not directly executable. Existing release gates remain open and are not closed by roadmap planning.

## Refactor control plane

- `CURRENT_REALITY_REPORT.md`
- `MODULE_AND_DATA_INVENTORY.md`
- `RISK_REGISTER.md`
- `DELETION_CANDIDATES.md`
- `MIGRATION_MATRIX.md`
- `UI_GAP_MATRIX.md`
- `IMPLEMENTATION_QUEUE.md`

Run `npm run roadmap:test` before accepting changes to this control plane. Completed implementation history belongs in Git, dated evidence reports, and `CHANGELOG.md`.

## Product acceptance

- [ ] Run a fresh fixed-seed 60-row blind Eval on a synthetic or explicitly authorized dataset. A human must judge every identity-hidden pair as A, B, or C. Only ties, both-fail rows, and rows with an issue flag receive the nine-dimension dispute scorecard. Record evidence-authority disagreements, complete the typed comparison artifact, and rerun the same fixed sample if a prompt/role change follows. Do not commit the source rows, provider payloads, or private Run identifiers.
- [ ] Complete real-machine Electron P3 acceptance from `design-qa.md`: 480×600, 1024×700, the default 1280×820, and 1440×900; light/dark; real macOS Reduce Motion; keyboard traversal and focus restoration; VoiceOver labels/order/no duplicate announcements; General and Project running/awaiting-input/waiting/stopping/stopped/failed states; real wheel/trackpad long Activity history; 10,000 variable-height CAT rows; failure recovery; and stable designated requirement across two clean signed builds. Source grep, unit tests, packaged automation, and Chromium emulation are supporting evidence, not substitutes.
- [ ] Publish only after real Developer ID/notary credentials and release authority are available. The maintained chain is Electron → signed/notarized app/zip/dmg → GitHub Release; Swift, Sparkle, appcast, and Pages feeds must not return.

## Document capability qualification

- [ ] Qualify the exact managed MinerU Labs pack on supported macOS hardware with sufficient disk space. Run the pinned bilingual/layout/table/formula fixture suite, source-digest checks, output reopen checks, zero-outbound guard, cold/warm performance and uninstall/recovery checks. Until it passes, keep state `unqualified`, route native-insufficient documents to PaddleOCR where appropriate, and never use an undeclared system command or cloud parser as fallback.

## Measured structural debt

- [ ] Split `packages/cat-server/src/server.ts` and `routes/workflow_routes.ts` only when changing those areas, preserving the existing route owners and tests. They are the largest backend concentration points; a speculative framework rewrite is not authorized.
- [ ] Split Electron files above roughly 1,000 lines (`workspace-client.ts`, `PipelineWorkspace.tsx`, `TaskConversation.tsx`, and remaining large CSS) along existing domain boundaries when they next change. Conversation rows and the queued-message tray already have dedicated owners, but Task orchestration still exceeds the target. Do not trade line count for wrapper components or duplicate state.
