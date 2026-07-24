# G4 Storage Gate Report

Date: 2026-07-23

Baseline: `64bcb15bed78a5d71d91d791948b7652987267d5`

Candidate before this report: `86444f13` (`fix(LA-106): isolate server fixtures from checkout data`)

Scope: Phase 3 storage authority, SQLite cutovers, backup/rollback boundaries, and Gate evidence safety; private repository only; public mirror untouched.

## Current result

**PASS — G4 is certified for private-campaign continuation.**

LA-106 repaired the test-boundary blocker without changing the production default: the two server-starting integration fixtures now use explicit disposable repository and Pi-agent roots under a guarded test-only mode. The complete Gate command set was then rerun. No checkout `data/**`, real home Pi trust, customer content, public mirror, signing material, or installed runtime was used.

The original blocked attempt is retained below as historical evidence. It was a valid stop, not a failed SQLite implementation; the recheck proves only that the Gate can now be executed safely against synthetic roots.

Recheck result:

- `npm test`: 211 automatically discovered root tests passed; the declared Managed E5 qualification-pack test remained skipped because the pack is absent.
- `npm run test:security`: passed.
- `npm run test:recovery`: passed (18 recovery tests).
- `npm --prefix apps/desktop test`: passed (151 Node tests plus 3 Electron activity tests).
- `npm run mac:test`: passed.
- Root/Desktop typecheck, roadmap tests/validation, release check, execution-ledger JSON parse, and `git diff --check`: passed.

The Gate is therefore allowed to unblock the next storage-domain tickets in the private repository. This is not production-data, power-loss, installed-app, signing/notarization, or real-machine evidence.

## Initial blocked attempt (preserved)

The storage implementation evidence was substantially complete for synthetic roots, but the required full Gate could not be honestly certified while `tests/import_upload.test.ts` and `tests/asset_api.test.ts` started `npm run server` against the checkout root. After LA-093, server startup performed LA-owned structured-domain cutover discovery and could inspect checkout `data/**` and the default Pi agent trust path. Running those fixtures would have violated the campaign's explicit no-real-data boundary.

This was a test-boundary blocker, not evidence that SQLite parity or rollback failed. LA-106 was added as an independent Phase 3 ticket to make those fixtures use an explicit synthetic repository root and synthetic Pi agent directory under an explicit test-only mode; that recheck is now complete.

## Evidence that passed before and during the recheck

- LA-093 focused settings/grants/trust import, strict validation, digest, marker, reopen, active-Run refusal and compatibility regressions passed on synthetic temporary roots.
- SQLite foundation, TaskWorkspace repository, Task aggregate backend, audit export, blob/ref and rollback focused suites passed on synthetic temporary roots.
- Roadmap validator, roadmap tests, root typecheck, Desktop typecheck, `npm run release:check`, and `git diff --check` passed.
- Desktop tests and `npm run mac:test` completed successfully in the preceding LA-093 verification run and again during the LA-106 recheck.
- The safe root-test subset excluding exactly `tests/import_upload.test.ts` and `tests/asset_api.test.ts` was attempted during the blocked run. A worker heartbeat failure was transient; the five affected Worker tests passed when rerun in isolation.
- LA-106's resolver, synthetic-root helper, both server-starting integration fixtures, and runtime handshake instance-id assertions passed before the full recheck.

## Evidence intentionally not counted as production proof

- The first post-LA-093 complete `npm test` run was not attempted; the campaign safety review correctly rejected it because the two server fixtures used the real checkout root. That historical decision is preserved above.
- The LA-106 recheck is synthetic-fixture evidence only; it does not prove real historical data shapes, scale, production startup, or native process behavior.
- No real `data/**`, real `~/.pi/agent/trust.json`, customer file, installed runtime, signing identity, public mirror, process-kill, power-loss or production rollback was read or used as evidence.

## Gate decision

Create the local annotated `la-g4-storage` tag after this report commit. LA-094, LA-095, LA-096, LA-097, LA-098, LA-099, LA-100 and LA-101 may now be considered only when their own queue dependencies and Ticket-level gates are satisfied. This Gate does not authorize public-mirror work or waive LA-059, real-machine, signing/notarization, or production-data decisions.

## Remaining boundaries

- Real data-shape, scale, WAL growth, backup duration, disk-full, power-loss, cross-process stale-lock and production rollback evidence remain open.
- `node:sqlite` remains experimental on the supported Node version.
- Project quality ledger remains JSONL until its own cutover owner.
- LA-059 licensing/source-available decision remains blocked; public mirror work remains forbidden.
