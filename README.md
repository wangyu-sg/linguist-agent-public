# Linguist Agent

Linguist Agent is a Pi-native, local-macOS-first general work Agent with a professional game-localization layer. Start a no-project Chat for ordinary local work, or enter a Project when the task needs bilingual evidence, CAT editing, deterministic QA, and delivery authority.

## Current source state

- Product version: `v2.32.7`.
- `apps/desktop` is the only maintained frontend. It is an Electron macOS client over the authenticated loopback `cat-server` API. SwiftUI `apps/mac` and browser `packages/cat-web` are deleted.
- Canonical truth is `Task → Run → Agent thread → Activity / Artifact / Decision`; a Task owner is either standalone or Project. Project Tasks may additionally carry Batch, locale, and Segment scope.
- Standalone and Project Tasks use the same Pi General Core and native message delivery: steer now, durable follow-up queue, pause/resume, edit/delete/reorder/retry, Stop, and compaction. The server owns durable queue identity and Pi owns execution.
- Standalone Chats add a private workspace, explicit file grants, and digest-bound resource trust, but no CAT or delivery authority. Project Tasks add the CAT Expert Layer: Assets, TM/TB/glossary, bilingual Segments, proposals, locks, QA, Team roles, and delivery gates.
- Personal/Project Library supports lexical, local multilingual-E5 vector, and hybrid retrieval. Memory is proposed and user-confirmed; legacy automatic TDAI recall is disabled.
- Package Center discovers the Pi community catalog, then uses a preview/hash/risk-approval quarantine flow before a managed Package can enter a future Run. Catalog browsing never executes Package code.
- Managed document capabilities cover local Office/PDF operations and PaddleOCR evidence. Their declarative Rich Artifacts can combine markdown, tables, charts, images, page overlays, diffs, and file references, then export through an explicit native save flow as inert HTML, PDF, or PNG. MinerU is implemented as a fail-closed Labs capability but remains unqualified on this machine.
- Maintainer can inspect and build a Pi-runtime upgrade candidate in an isolated Git worktree. Activation is a separate approval and health/rollback operation.
- Pi is exact-pinned at `0.80.10` across manifests and lockfiles. Upgrade the Pi dependency family together.

These are repository/source and test facts. They do not prove that an installed app or managed Application Support runtime matches this checkout; verify those surfaces separately.

## Start here

```bash
npm ci
npm --prefix apps/desktop ci
npm run typecheck
npm test
npm run mac:build
npm run mac:test
npm run mac:verify
```

Run the development server with `npm run la`. Run the worktree-local Electron package with `npm run mac:run`; it does not install into `/Applications`.

## Product boundaries

- No-project Chat is a first-class Task, not a disguised Home Agent and not a temporary pre-Project screen.
- General Chat inherits only the Pi resources resolved for its selected directory and trust decision. Unknown user/global executable Extensions require path-plus-SHA approval before evaluation; each Run keeps an immutable resource snapshot and conflict inventory.
- Missing configured Pi Packages fail visibly at General Run startup. Startup does not auto-install them as a side effect.
- Task-scoped Main, Team, Eval, Quality, and Delivery work share one canonical chronology. Specialist follow-up creates a scoped Run; it does not create a second permanent chat model.
- CAT writes, proposal application, locked rows, formatting signatures, QA disposition, and delivery export remain server-gated regardless of Agent autonomy settings.
- TM, TB, glossary, assets, Project files, and returned URLs/excerpts can be evidence. Tool trace and recalled memory alone are not evidence.
- Historical Pi JSONL and migrated Home history are inspectable records, not alternate runnable product state.
- Runtime/package/document/maintenance mutations retain preview, digest, plan-hash, authority, and active-Run checks. Never copy customer data, managed runtime data, or acceptance output into Git.
- No silent fallback: a missing capability, permission denial, resource change, or failed Run must surface explicitly.

## Repository map

- `packages/cat-data`: durable Task ownership, Project/CAT truth, Library, memory, document capability contracts, standalone grants, evidence, QA, and delivery.
- `packages/cat-runtime`: General/CAT/Maintainer Pi session construction, immutable resource snapshots, permissions, sandboxing, native compaction, dynamic tools, and delegation adapters.
- `packages/cat-tools`: General Library/memory/document tools plus CAT tools and deterministic write/evidence gates.
- `packages/cat-server`: authenticated loopback APIs, active-run ownership, standalone/Project Task projection, Package Center, capability qualification, Maintainer, Settings, and runtime lifecycle.
- `packages/cat-formats`: bilingual file adapters.
- `apps/desktop`: Electron main/preload trust boundary, professional workspaces, packaging, notifications, and acceptance harnesses.
- `contracts/schemas`: versioned client/server Task wire contracts.
- `.pi/APPEND_SYSTEM.md`: always-on CAT runtime constitution; do not put roadmap or release history there.

## Documentation

- Stable identity: `PRODUCT.md`
- Current brief: `AGENTS.md`, `docs/AGENT_CONTEXT.md`
- Current handoff and open work: `docs/HANDOFF.md`, `TODO.md`
- Architecture and runtime policy: `docs/ARCHITECTURE.md`, `docs/PI_RESOURCE_POLICY.md`
- UI implementation contract: `docs/CODEX_UI_CONTRACT.md`
- Operator workflow: `docs/OPERATOR_GUIDE.md`
- Document inventory: `docs/DOCS_INDEX.md`
- Dated General/Pi rebuild evidence: `docs/reports/PI_GENERAL_AGENT_REBUILD_20260720.md`

`CHANGELOG.md` is history, not the roadmap.

## License and contributions

This source tree does not currently include an open-source license. Public visibility permits inspection and issue reporting but does not grant redistribution, modification, or commercial-use rights. Choose and add an explicit license and contribution policy before accepting external code contributions.

## Release and RC checks

```bash
npm run release:check
npm run release:mac -- --dry-run
npm run runtime:health
npm run rc:status
npm run rc:regression -- --project rc-isolated-final
npm run rc:gate -- --project rc-isolated-final --batch b1 --batch b2
git diff --check
```

Use only an isolated synthetic Project for final RC evidence unless the user explicitly authorizes another scope. Open human quality, real-machine P3, MinerU, and release-authority gates are listed in `TODO.md`; green automation does not substitute for them.
