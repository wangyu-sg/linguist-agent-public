# G3 Isolation Gate Report

Date: 2026-07-23

Baseline: `64bcb15bed78a5d71d91d791948b7652987267d5`

Candidate before this report: `6b16f174d07bfc60298e5c841cc93ef26c236a89`

Scope: Phase 2 capability, Worker, Extension and declarative Package isolation; synthetic/temp fixtures only; public mirror untouched.

## Current result

**PASS — Phase 3 may begin in the private campaign.**

All Phase 2 executable Tickets and the LA-017/LA-020 Epics are complete. Active product Agent execution now uses Supervisor-owned Workers, production tools require declared capabilities, filesystem and runtime capabilities use the canonical brokers, external executable Extensions cannot enter the Agent process, and Stable Package activation uses only signed declarative v2 resources. LA-083 also makes Gate-report parity across both execution ledgers machine-checked.

## Gate evidence

- `npm test`: passed; 193 root tests automatically discovered and executed.
- `npm --prefix apps/desktop test`: passed; 151 Desktop tests plus 3 activity-producer tests.
- `npm run mac:test`: passed, including the Desktop suite and Desktop typecheck.
- `npm run test:security`: passed; all 26 selected security tests.
- `npm run test:recovery`: passed; all 9 selected recovery tests.
- `npm run typecheck`: passed.
- `npm --prefix apps/desktop run typecheck`: passed.
- `npm run roadmap:test`: passed.
- `npm run roadmap:validate`: passed, including Gate report/ledger parity.
- `npm run release:check`: passed.
- `git diff --check`: passed.

Managed E5 acceptance remained explicitly skipped because its pack is absent. This Gate does not claim real-provider, installed-app, OS-sandbox, accessibility, signing, notarization, publisher-governance, power-loss or customer-data evidence.

## Authority and migration checks

- New General, CAT, Eval and Team product execution has one Worker authority; Host Agent-session fallback is absent. Existing active legacy Runs were not hot-migrated.
- Extension Host v1 executes only exact private staged bytes with empty grants and authenticated bounded RPC. Stable external executable Extensions remain disabled; unsupported Pi extension surfaces remain blocked.
- `packages-v2` is the only new Package writer and runtime resolver. `installed-v1` and original trees are disabled/read-only; old npm Preview/install routes return 410.
- Declarative Package Preview performs no subprocess or post-acquisition network work. Activation is revision-bound, journaled and recovered before routes under a narrow Package-root lease.
- No permanent dual write or dual Agent authority was found in the migrated Phase 2 paths.
- Deletion candidates remain governed by `DELETION_CANDIDATES.md`; retained legacy readers/implementations are not treated as deletion permission.

## P0 boundary

- R-001, R-002 and R-003 are mitigated by fail-closed permission parsing, Worker authority and prompt launch guards respectively.
- R-004 remains mitigated with publisher governance blocked; zero-root builds fail closed.
- R-005 remains controlled: Stable external executable Extensions are disabled and any future activation must use the isolated Host.
- R-030 remains a blocked legal/release Decision. It does not block private implementation, but it prohibits open-source claims, public reuse and release.

No uncontrolled implementation P0 remains for entering Phase 3. This does not convert the residual boundaries above into proof of release safety.

## Unverified boundaries

- No real `data/**`, customer file, installed legacy Package, production publisher key, provider request or active legacy Run was read or changed.
- No actual SIGKILL, power loss, hostile same-user native process or packaged-app OS-sandbox attack was executed.
- Signed archive verification remains unavailable because the required local signing identity is absent.
- Real-machine P3, VoiceOver, fixed-seed human blind review, notarization and public-repository sanitization remain open.
- The public mirror and remote were not read, modified or pushed.
