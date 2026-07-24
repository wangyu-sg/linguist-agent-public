# Handoff

Product version: `2.32.7`.

## State to take over

This branch broadens LA from a Project-only localization Agent into a Pi-native general local work Agent with a localization Expert Layer. `apps/desktop` remains the only client; `apps/mac` and `packages/cat-web` remain absent.

The canonical contract is schema v2. Standalone and Project Tasks share Run/Agent thread/Activity/Artifact/Decision semantics but have different owners and authority. `/api/tasks/*` is the no-project Chat surface. `/api/projects/:projectId/tasks/:taskId/*` remains the localization surface. Legacy Home history migrates into an archived standalone Chat; Home POST/stream/stop do not start another loop.

General Core now uses Pi native sessions, events, queue/steer/follow-up, Stop, fork/copy, and compaction. Standalone and Project Main share one message-delivery contract: Pi executes steer and follow-up, while a durable server-owned Task queue provides stable message identity, pause/resume, edit/delete/reorder/retry, and interrupted-Run recovery. Standalone file access is private-workspace plus explicit canonical grants. Before a Pi Session exists, General or CAT/Eval/Team preflight compiles a JSON-serializable schema-v1 Plan that freezes workspace/grants, permission and model inputs, prompt inputs, resources, and exact tool surfaces behind hashes. Every newly started standalone General root Run, Project CAT root Run, Private Eval single generation, and Team specialist transport Session launches through a Supervisor-owned Worker: the Worker consumes and re-verifies the Plan, attests exact request-shape hashes, and keeps permissions, delegation, typed Extension UI, Host-owned CAT tools, and Task truth on the Host. Task-backed General/CAT/Team Runs persist the exact `ExecutionSnapshot` before activation; Private Eval validates the attestation in memory and retains its existing canonical Eval execution manifest because the generator has no Task locator. Team also revalidates the signed child scope's Project/Workflow/Role binding and exact read-only evidence tools before starting either verified Pi child transport. Host server-tool cancellation propagates across RPC. Stop, retry, queue, disconnect and final events retain their canonical projections, and the active registry carries worker/epoch identity. Standalone compaction/fork, delegated read-only children, and non-Run CAT prompt/catalog/compaction support operations also cross the Worker boundary, so active General/CAT/Eval/Team execution has no Host Agent-session fallback. Existing active Runs are not hot-migrated. The dormant Maintainer migration Agent remains Stable-disabled pending LA-050, and verified nested Pi children plus OS sandbox enforcement remain bounded follow-on risks rather than claims of this cutover.

The General workspace also includes:

- personal/Project Library import, reindex, search, lexical/vector/hybrid retrieval, and a managed multilingual-E5 pack;
- explicit propose/confirm/edit/revoke/supersede Memory across personal/client/franchise/project/locale scopes, with validity/conflict visibility and host-selected immutable lexical/local-semantic recall snapshots (explicit lexical-only when the managed pack is absent); Memory is never Evidence, while legacy TDAI capture/store/recall is retired and only explicit read-only migration candidates await user confirmation;
- Package Center catalog, quarantine, dependency closure/tree hash, lifecycle/risk scan, plan-hash approval, and managed future-Run activation;
- managed Python, PaddleOCR, Office/PDF, declarative Rich Artifact preview/export, and fail-closed MinerU capability surfaces;
- a server-owned delegation bridge and a direct-Package child-tool block;
- retained Maintainer candidate code and history readers, with every Stable mutation blocked pending migration to developer/CI tooling.
- retained Private Eval execution code and read-only history APIs, with every Stable mutation and navigation entry blocked pending migration to the CI eval harness.

LA-owned structured settings, standalone file grants, and Pi trust decisions now have a startup-only SQLite authority seam. The migration inventories the supported legacy JSON sources with strict schema validation, preserves invalid raw bytes in a cutover backup, records source and payload digests, and installs the SQLite backend only after the writer lease and parity checks succeed. Provider secrets remain Keychain/reference-only, and Pi-native settings remain Pi-owned; neither is imported into this LA database. LA-106 also makes the server-starting integration fixtures pass an explicit synthetic repository root and synthetic Pi agent directory, so Gate evidence does not require reading the checkout `data/**` or the real home trust file. This evidence is synthetic-only and does not establish production-data, real-home, power-loss, or real rollback qualification.

Electron follows `docs/CODEX_UI_CONTRACT.md`: responsive Chats/Projects/Library/Package Center/Settings surfaces, semantic Activity/Decision items, trust cards, title-bar Chat/Task actions, keyboard-driven steer/follow-up, real attachment and Agent-autonomy disclosures, and the same queued-message tray for standalone and Project Main. In a standalone Chat, `+` manages explicit file grants; the shield selects the separate server-owned approval mode. Project and standalone surfaces use the same shield/menu design, with the Project route writing its scoped policy. Idle Composer chrome is intentionally quiet: the current model remains visible, while shortcut labels, usage percentages, default routing, and Stop detail surface on hover/focus or an active state. PNG/JPEG/WebP uses Pi native image input only on new vision-capable Runs; other attachments remain authorized tool/OCR inputs. Large Conversation/Product shell components and CSS were split along existing ownership boundaries.

The current model is an atomic Mac-local provider/model preference rather than a temporary Composer override: Composer and Settings use the same runtime-resolved choice, it survives sends and Task changes, and it applies only when starting a new Run. Settings keeps OAuth/API-key Provider connection actions beside this selection. Pending Pi/tool permissions replace the current Composer with the shared Codex-style `PermissionRequestSurface`; no `<dialog>` or global backdrop is used. Tool requests support once/conversation/always/deny, resource trust supports only exact-summary trust or deny, and decisions remain bound to Task/Run/session scope while a Task switch merely hides the surface. Canonical pending state is recovered while a Run is alive. The Runtime page exposes explicit restart/repair and preview/hash-confirmed rebuildable-cache cleanup; no installed-app claim follows from this source behavior alone.

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

Automation proves source contracts, packaging, and isolated synthetic behavior. It does not close human blind quality, real-machine visual/accessibility, real signing/notarization, or MinerU qualification. `TODO.md` is the human backlog entry; the seven-document roadmap control plane indexed in `docs/DOCS_INDEX.md` owns detailed refactor execution, and `design-qa.md` owns real-machine UI checks.

## Current evidence

- Dated General/Pi rebuild evidence: `docs/reports/PI_GENERAL_AGENT_REBUILD_20260720.md`
- UI implementation contract: `docs/CODEX_UI_CONTRACT.md`
- Electron behavior/performance/release: `docs/reports/ELECTRON_NATIVE_EXPERIENCE_ACCEPTANCE_20260717.md`
- Synthetic RC method: `docs/RELEASE_CANDIDATE.md`
- Current architecture: `docs/ARCHITECTURE.md`

Git history and `CHANGELOG.md` retain implementation history. Do not rebuild current behavior from old branches or the retired Atelier report.
