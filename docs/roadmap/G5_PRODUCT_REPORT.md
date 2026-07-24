# G5 Product Gate Report

Date: 2026-07-24

Baseline: `64bcb15bed78a5d71d91d791948b7652987267d5`

Candidate before this report: `a3c426a0` (`test(LA-122): guard canonical Electron entry`)

Scope: Phase 5 API input validation, Electron IPC/path authority, Task projection, and ordered live-stream presentation; private repository only. The public mirror remains untouched.

## Current result

**PASSED for private-campaign continuation.**

LA-038 through LA-043 and the independent G5 test-safety repairs LA-117 through LA-122 are complete as separate commits. The direct, unfiltered root command now runs each discovered child from a disposable synthetic source view: its actual cwd contains no `data/**`, `.git`, home directory, or unlisted checkout entry. This is source-level isolation, not an OS sandbox.

The G5 recheck did not read or modify real `data/**`, real Pi trust, customer content, signing material, the public mirror, or release credentials. It found no new Phase-5 implementation P0 and no permanent dual writer. R-030 remains a separately unresolved legal/release P0 Decision: it blocks public/release-dependent work, but does not authorize guessing a license or prevent private work on independent tickets.

## Fresh Gate evidence

- `npm test` passed: 231 automatically discovered root tests completed under the authorized synthetic child root. `asset_rag_multilingual_eval` reported its declared skip because the managed E5 pack is absent; this is not E5 qualification evidence.
- `npm run test:security` passed: 29 selected tests.
- `npm run test:recovery` passed: 19 selected tests.
- `npm --prefix apps/desktop test` passed: 161 Node tests plus 3 Electron activity tests.
- `npm --prefix apps/desktop run build`, `npm run typecheck`, `npm --prefix apps/desktop run typecheck`, and `npm run mac:test` passed.
- `npm run roadmap:test`, `npm run roadmap:validate`, `npm run release:check`, execution-ledger JSON parsing, and `git diff --check` passed.

The Desktop build emitted a non-failing Vite chunk-size warning for the 542.83 kB renderer bundle; it is a known performance/packaging follow-up, not a failed gate control.

## Historical repair chain retained for audit

The first G5 root request was correctly refused before startup because root discovery did not establish a synthetic repository/Pi-agent root. LA-117 created the per-child temporary root, inherited-root replacement, cleanup, and direct literal server-launch inheritance guard.

The next request exposed checkout cwd access through `inspectLocalEmbeddingPack(process.cwd())`. The user explicitly authorized LA-118's no-`data/**` synthetic test-root view. Subsequent fresh direct attempts then revealed only individually reviewed static test dependencies: `.pi/APPEND_SYSTEM.md` and `memory.ts`/agents (LA-119), root `AGENTS.md` for the Dev context loader (LA-120), and the Team child extension (LA-121). The fourth attempt reached more than 200 root tests and exposed a stale lease guard reading deleted `apps/desktop/src/main.mjs`; LA-122 moved that guard to the canonical `main.ts` without restoring a dual entry or changing runtime behavior. The fresh direct G5 execution above is the first complete evidence after that repair chain.

## Gate boundary

There is still one canonical authority at each relevant Phase 5 boundary: strict server request validation; compiled Electron IPC/capability transport; opaque native handles in main; snapshot-plus-ordered-event Task projection; and ephemeral, bounded delta presentation that never delays canonical events. Earlier generic IPC and raw renderer-path entries remain deleted under their migration contracts.

The local annotated tag `la-g5-product` is created at this report commit after the report is committed. This permits Phase 6 execution only. It does not permit final verification, public-mirror sanitization, public push, release, or merge.

## Remaining boundaries

- The synthetic source view is deliberately narrow but is not an OS-enforced read-only sandbox; dynamically constructed or environment-stripping subprocesses need separate test-authoring review.
- The managed E5 embedding pack was absent, so multilingual E5 acceptance remains unproven.
- Real Electron/installed-app, accessibility/VoiceOver, long-thread/background scheduling, 10k CAT rows, signing/notarization, provider, power-loss, disk-full, production rollback, customer data, and public-mirror evidence remain unproven.
- R-030 still requires the separate user/legal licensing and contribution-policy decision before public release work.
