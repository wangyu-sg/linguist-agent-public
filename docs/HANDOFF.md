# Handoff

Product version: `2.32.7`.

## State to take over

This branch broadens LA from a Project-only localization Agent into a Pi-native general local work Agent with a localization Expert Layer. `apps/desktop` remains the only client; `apps/mac` and `packages/cat-web` remain absent.

The canonical contract is schema v2. Standalone and Project Tasks share Run/Agent thread/Activity/Artifact/Decision semantics but have different owners and authority. `/api/tasks/*` is the no-project Chat surface. `/api/projects/:projectId/tasks/:taskId/*` remains the localization surface. Legacy Home history migrates into an archived standalone Chat; Home POST/stream/stop do not start another loop.

General Core now uses Pi native sessions, events, queue/steer/follow-up, Stop, fork/copy, and compaction. Standalone and Project Main share one message-delivery contract: Pi executes steer and follow-up, while a durable server-owned Task queue provides stable message identity, pause/resume, edit/delete/reorder/retry, and interrupted-Run recovery. Standalone file access is private-workspace plus explicit canonical grants. Resource loading is preflighted: directory trust is resolved before project resources enter the set; unknown user/global executable Extensions require canonical digest approval before evaluation; an immutable per-Run snapshot records hashes and resource conflicts. Missing configured Packages and changed snapshot files fail visibly.

The General workspace also includes:

- personal/Project Library import, reindex, search, lexical/vector/hybrid retrieval, and a managed multilingual-E5 pack;
- explicit propose/confirm/edit/revoke memory, with legacy automatic TDAI recall disabled;
- Package Center catalog, quarantine, dependency closure/tree hash, lifecycle/risk scan, plan-hash approval, and managed future-Run activation;
- managed Python, PaddleOCR, Office/PDF, declarative Rich Artifact preview/export, and fail-closed MinerU capability surfaces;
- a server-owned delegation bridge and a direct-Package child-tool block;
- an isolated Maintainer candidate workflow for Pi runtime upgrades.

Electron follows `docs/CODEX_UI_CONTRACT.md`: responsive Chats/Projects/Library/Package Center/Settings surfaces, semantic Activity/Decision items, trust cards, explicit adjust-now/run-after controls, and the same queued-message tray for standalone and Project Main. Large Conversation/Product shell components and CSS were split along existing ownership boundaries.

The eight Agent personas remain in Conversation, with one Auden identity for Lead Linguist setup and final responsibilities.

Pi is exact-pinned at `0.80.10`. Production Agent sessions, model catalogs, OAuth, title generation, and custom-model reloads share one process-owned `ModelRuntime`. LA's persistent credential store preserves atomic auth/Keychain behavior without arbitrary credential commands.

## Qualification boundary

Recorded worktree qualification on 2026-07-20 established:

- multilingual-E5 60-query evaluation: Recall@5 `0.9833`, MRR@10 `0.8888`;
- managed PaddleOCR 3.7 / PaddlePaddle 3.3.1 bilingual and rotated-image evidence with zero outbound requests in the qualification harness;
- 80 deterministic Office/PDF fixtures across DOCX, XLSX, PPTX, and PDF with source-digest and reopen checks;

Those are bounded local source/runtime checks, not proof of the installed app. MinerU was not installed or qualified because the official local pipeline requires materially more free disk than was available; its state remains `unqualified` and its tool fails closed.

## Safety boundary

Do not install or replace `/Applications/LinguistAgent.app`, synchronize/restart the managed Application Support runtime, alter production data, or touch customer source directories without explicit authorization. Acceptance fixtures and outputs stay under ignored checkout data or `/private/tmp`; never commit them.

Package/catalog counts are time-bound observations. The locally cached Pi gallery snapshot contained 5,301 entries when fetched on 2026-07-20; do not present that count as a permanent upstream fact.

## Verification before release claims

Run from a clean checkout:

```bash
npm ci
npm --prefix apps/desktop ci
npm run typecheck
npm test
npm run mac:build
npm run mac:test
npm run mac:verify
npm run release:check
npm run release:mac -- --dry-run
npm run runtime:health
npm run rc:status
npm run rc:regression -- --project rc-isolated-final
npm run rc:gate -- --project rc-isolated-final --batch b1 --batch b2
git diff --check
```

Automation proves source contracts, packaging, and isolated synthetic behavior. It does not close human blind quality, real-machine visual/accessibility, real signing/notarization, or MinerU qualification. Exact remaining work is in `TODO.md` and `design-qa.md`.

## Current evidence

- Dated General/Pi rebuild evidence: `docs/reports/PI_GENERAL_AGENT_REBUILD_20260720.md`
- UI implementation contract: `docs/CODEX_UI_CONTRACT.md`
- Electron behavior/performance/release: `docs/reports/ELECTRON_NATIVE_EXPERIENCE_ACCEPTANCE_20260717.md`
- Synthetic RC method: `docs/RELEASE_CANDIDATE.md`
- Current architecture: `docs/ARCHITECTURE.md`

Git history and `CHANGELOG.md` retain implementation history. Do not rebuild current behavior from old branches or the retired Atelier report.
