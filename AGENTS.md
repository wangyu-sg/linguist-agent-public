# Linguist Agent agent instructions

Product version: `2.32.7`.

## Work here

Use this repository root. Do not continue implementation from sibling, archive, or historical worktrees unless the user explicitly asks.

Read, in order:

1. `README.md`
2. `PRODUCT.md`
3. `docs/AGENT_CONTEXT.md`
4. `docs/HANDOFF.md`
5. `TODO.md`
6. `.pi/APPEND_SYSTEM.md`
7. `docs/DOCS_INDEX.md`

Before runtime, bridge, compaction, Package, tool-surface, or session work, also read `docs/RUNTIME_BORROWED_PATTERNS.md` and `docs/PI_RESOURCE_POLICY.md`. Before documentation work, read `docs/DOCUMENTATION_MAINTENANCE.md`.

`CHANGELOG.md` is history only. `TODO.md` is the only unfinished backlog.

## Truth hierarchy

Prefer current code, contracts, tests, package manifests/lockfile, and observed runtime output over prose. Update prose after behavior changes. Do not make an installed-app or managed-runtime claim from repository state alone.

## Product boundary

- `apps/desktop` is the only maintained frontend. `apps/mac` and `packages/cat-web` are deleted; do not revive them to satisfy an old test, script, or document.
- Canonical lifecycle is standalone-or-Project-owned Task / Run / Agent thread / Activity / Artifact / Decision. Project/Batch/Segment are optional localization scope, not prerequisites for a no-project Chat. Conversation collaborates, typed Activity explains process, Artifacts carry work, and Decisions record authority.
- Main is the default composer, not a separate product state machine. Team specialists remain identified child threads in the same Task chronology; follow-up creates another scoped Run.
- Backend packages own truth. Electron is a thin client and must not invent fallback snapshots, hidden Runs, or duplicate lifecycle state.
- Pi owns Agent runtime mechanics. LA owns standalone grants/resource trust, Library/memory/capability governance, CAT domain scope/evidence/writes/QA/delivery, and product presentation. General Core plus CAT Expert Layer is one product, not two Agent lifecycles.

## Important owners

- `packages/cat-data/src/task_workspace_contract.ts` and `task_workspace.ts`: durable canonical Task contract and replay.
- `packages/cat-server/src/routes/standalone_task_routes.ts` and `task_workspace_routes.ts`: authenticated standalone and Project Task transport.
- `packages/cat-runtime/src/generalResourceSnapshot.ts`, `createGeneralAgentSession.ts`, and `packages/cat-server/src/pi_extension_trust.ts`: pre-execution General resource resolution, immutable snapshots, and digest-bound executable trust.
- `packages/cat-server/src/active_agent_runs.ts`: sole live run-handle registry.
- `packages/cat-server/src/general_agent_runs.ts`: standalone General Run coordination, native Pi continuation, manifests, permissions, and server-owned delegation.
- `packages/cat-server/src/routes/workflow_routes.ts`: Team preflight/start/resume/stop and specialist follow-up.
- `packages/cat-server/src/routes/eval_routes.ts`: Private Eval lifecycle and Stop.
- `packages/cat-server/src/task_run_resources.ts` and `task_package_profile.ts`: immutable Run resources and Task Package intent.
- `packages/cat-data/src/team_context_builder.ts` and Team evidence-scope/runtime files: server-authored child context and read-only evidence.
- `packages/cat-data/src/quality_decision_ledger.ts`: quality/delivery decision truth.
- `packages/cat-data/src/assistant_library.ts`, `assistant_memory.ts`, and `document_capabilities.ts`: Library/RAG, confirmed memory, and managed document state.
- `packages/cat-server/src/package_center.ts` and `maintainer.ts`: managed Package quarantine/approval and isolated Pi-upgrade candidates.
- `apps/desktop/src`: renderer, main/preload trust boundary, Chats, Projects/CAT, Library, Package Center, Settings, Inspector, notifications, and packaging.

## Hard rails

- Never overwrite locked client segments.
- Never weaken CAT proposal, evidence, QA, tag/placeholder, or delivery gates through Agent autonomy or frontend logic.
- Never accept client-authored Task scope, segment source, Team context, or authoritative events when the server can hydrate them.
- Never give a standalone Chat implicit filesystem authority beyond its private workspace and current canonical grants.
- Never evaluate an unknown executable Pi Extension before its canonical path/SHA trust decision, or let an active Run's frozen resource set expand after startup.
- Never turn Package catalog discovery or managed installation into automatic Run activation; direct Package child orchestration stays blocked behind LA's server-owned delegation bridge.
- Never treat recalled memory or Package output as CAT evidence or canonical progress.
- Never persist provider secrets in repo files, Pi model/config JSON, plists, docs, or shell startup files; use Keychain/official env references.
- Never commit `data/**`, `.pi-subagents/**`, acceptance runtime output, customer files, credentials, or `/Applications` bundles.
- Destructive runtime cleanup requires its existing preview and matching `planHash`.
- Team Package resources use the server-owned child transport. Zero-Package Runs stay on verified `pi-subagents`; Package Skills/Prompts and one digest-approved standard-UI Extension use Pi RPC v1. Multiple executable Extensions, top-level unapproved Extensions, and arbitrary/custom UI remain blocked; never fake UI with prompts or a second Agent loop.
- MinerU remains fail-closed while its exact managed pack is unqualified; do not use a system/cloud fallback.
- No silent fallback. Surface the failure.

## Pi and release

Pi dependency pins are exact and source-derived from manifests plus `package-lock.json`. Upgrade them together. Use current official Pi APIs, including `builtinModels()` from `@earendil-works/pi-ai/providers/all`.

Root `mac:*` scripts target Electron. Release flow is signed/notarized Electron app, zip, dmg, checksums, and GitHub Release. Do not add Swift, Sparkle, appcast, or Pages-feed dependencies.

## Verification

For normal backend changes, run focused tests, `npm run typecheck`, and `git diff --check`. For integration/release work, run the complete command set in `docs/HANDOFF.md`. Final RC evidence requires an isolated two-batch synthetic project; green source grep or UI emulation is not real-machine P3 evidence.

## Documentation

Keep stable principles in `PRODUCT.md`, current state in `README.md`/`docs/AGENT_CONTEXT.md`, takeover details in `docs/HANDOFF.md`, and unfinished work only in `TODO.md`. Delete superseded claims instead of preserving parallel “historical current state” narratives; Git already stores history.
