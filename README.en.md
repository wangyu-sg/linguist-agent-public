# Linguist Agent

Linguist Agent is a desktop Agent for day-to-day personal localization work:

> Proma's complete general-purpose Agent and Chat product capabilities, combined with Linguist Agent's professional CAT core and workbench.

This repository is an AGPL-3.0 derivative of [Proma](https://github.com/proma-ai/Proma). Proma remains copyrighted by its original authors. See [NOTICE.md](./NOTICE.md), [ATTRIBUTION.md](./ATTRIBUTION.md), and the pinned [upstream baseline](./docs/architecture/UPSTREAM_BASELINE.md).

[中文 README](./README.md)

## Current status

The product is a **personal-use Alpha** for its author's sustained use and improvement, with no public-release plan. Its structure is fixed: it does not remove Proma's Agent, Chat, Providers, Skills, MCP, Automations, or remote integrations; Linguist is a first-class localization mode on top of them.

The current manifest baseline is Electron App `0.16.17` (Electron `43.2.0`), `@proma/shared 0.1.84`, Pi Runtime `0.82.1`, CAT Core / Formats / Store / Tools `0.0.14 / 0.0.7 / 0.0.27 / 0.0.21`, CAT schema `15`, with Bun `1.3.14` pinned for the repository.

The application has three peer primary modes:

- **Agent**: the complete general-purpose Agent workspace, with Claude / Pi runtimes, tools, Thinking, permissions, Queue / Steer, Skills, MCP, and workspace files.
- **Chat**: multi-provider conversations, attachments, tools, context controls, and side-by-side comparison.
- **Linguist**: projects, batches (recurring task files within one project), language assets (TM / TB / Style Guide / Context), a virtualized Segment Grid, human editing, Proposal review, deterministic QA, verified import and safe undo, delivery preflight, export, integrity scrubbing, backup, and restore.

The Linguist sidebar is always “project → bound sessions.” Session rows and tree behavior are shared with Agent, including status, MiniMap, delegation, pinning, recents, and archives; Agent mode excludes every project-bound session. Selecting a project opens its Workbench, while selecting a session opens the same full `AgentView`. Cross-project actions create an independent copy, keep the source project open, and offer an action to open the copy.

Linguist is a first-class Agent Profile. It layers a versioned Profile, Role, professional quality contract, Execution Policy, Project Digest, and frozen Turn Context on top of each runtime's Proma Base, and explicitly reports degradation rather than silently falling back to an ordinary Agent. Execution Policy only controls risk-based independent review; it makes no Fast / Balanced / Best quality promise. It embeds the same `AgentView` rather than creating a second Composer, message stream, Thinking renderer, Tool Card, approval flow, or Session Store. Agent tools may create reviewable Proposals, but cannot bypass human acceptance, CAS revisions, locked segments, tags, QA, or Required/Forbidden term gates.

In the CAT editor, `Cmd/Ctrl+Enter` confirms the current workflow stage and advances even when the target is unchanged. Close buttons on project settings and other right-side sheets remain clickable inside Electron title-bar regions.

The upstream v0.16.8 foundation brings Planning (todos, calendar, reminders, and Agent references), Agent Island, unified project/session files, Vision Relay, xAI OAuth, and the updated Pi Runtime. These remain shared Agent / Chat substrate capabilities: they must not introduce a second Linguist state store or bypass CAT authority. Their automated, packaged, and real-machine qualifications still require separate verification.

## Architecture

```text
Linguist Agent Desktop App
├── Agent / Chat / Providers / Skills / MCP / Automations / remote bridges
├── Planning (todos, calendar, reminders, Agent references)
├── Agent Island (Agent interaction and Planning projection)
└── Linguist Mode
    ├── Workbench + native Agent rail
    ├── session-bound CAT tools
    ├── Electron Linguist services / IPC
    └── @linguist/cat-core
        └── pure domain model, Proposal, Evidence, QA, Critic, Consistency
```

Important boundaries:

- `@linguist/cat-core` has no React, Electron, Proma UI, or SQLite dependency.
- `@linguist/cat-store` owns each project's `cat.db`, managed source assets, backups, and export records.
- `@linguist/cat-tools` derives project identity only from the Session binding. Its 19 tools are split by project, reference, QA, Proposal/Critic, Intake, and Translation Scope responsibilities. A single file copied into the current Linguist session through the paperclip or an explicit `@file` reference becomes an Intake source; models still receive only opaque tokens, never path authority.
- Batch source files and language assets whose originals are retained share Proma's native Preview Tab. TM/TB imports remain candidates until explicit human confirmation makes them authoritative.
- XLSX task sheets require an explicit Sheet/column mapping confirmation; the mapping is stored with the batch and reused for export. Complex SDLXLIFF `mrk` and low-confidence CSV/JSON detection fail closed in their existing adapters.
- `LinguistProjectService` remains the single external facade while lifecycle, resources, quality, and delivery live in separate modules.
- Proposal content is stored separately from each issuance and its provenance. Long-running work uses Jobs/Checkpoints, idempotent mutations, a durable outbox, and run-scoped undo.
- Project open performs only bounded Quick Health checks. Full Integrity Scrub runs in a worker thread and checks all managed digests, SQLite/reference lineage, exports, and Session workspaces.
- Session copy is revalidated in the main process against the source binding, an active and healthy target project, and native Claude/Pi fork eligibility. The Renderer cannot provide bindings, native IDs, or paths. Copies omit workspace files, `.context`, attachments, delegation, automation, and run state; partial copies are rolled back.
- Planning and Agent Island share the general main-process, preload, and Jotai contracts; neither grants CAT write authority.
- Proma core changes are registered in [PROMA_CORE_TOUCHPOINTS.md](./docs/architecture/PROMA_CORE_TOUCHPOINTS.md) and enforced by architecture tests.

## Agent runtimes and model channels

Agent sessions provide two switchable runtimes:

- **Claude Agent Runtime**: powered by `@anthropic-ai/claude-agent-sdk 0.3.201` and using the Anthropic Messages API or compatible endpoints.
- **Pi Agent Runtime**: powered by `@earendil-works/pi-coding-agent`, `pi-agent-core`, and `pi-ai 0.82.1`. It registers enabled channels as Pi providers and carries the general workspace Skills, user MCP servers, and Automation / Collaboration capabilities.

The current channel layer includes integration paths for ChatGPT subscription/Codex OAuth and xAI (Grok/X subscription) OAuth. Models, tool calling, reasoning, context lengths, and subscription availability depend on user configuration, account, region, and the upstream provider; these integrations do not promise a model entitlement, price, or service availability.

When configured, Vision Relay sends only safely decodable images from the current session or user-attached authorized directories to a separately configured vision model, then returns constrained JSON text to the current Agent. It does not grant text-only models arbitrary-path access or image-exfiltration permission.

## Local data

Production data lives under `~/.linguist-agent/`; development uses `~/.linguist-agent-dev/`:

```text
~/.linguist-agent/
├── channels.json
├── conversations.json
├── conversations/*.jsonl
├── agent-sessions.json
├── agent-sessions/*.jsonl
├── agent-workspaces/
├── attachments/
├── settings.json
├── sdk-config/
├── planning.json
└── linguist/
    ├── projects.json
    ├── projects/<project-id>/
    │   ├── project.json
    │   ├── cat.db
    │   ├── source/
    │   ├── blobs/
    │   ├── exports/
    │   └── backups/
    └── trash/
```

General conversations, settings, and Planning use JSON / JSONL (Planning's authoritative source is the atomically replaced `planning.json`). SQLite remains limited to each CAT project's isolated `cat.db`; projects also use managed source / blobs / exports / backups directories. API keys are encrypted with Electron `safeStorage` before they are written to `channels.json`.

The old `~/.proma(-dev)/channels.json` is read only when the user explicitly chooses a Provider-only import from **Settings → Model configuration**. It does not migrate Proma sessions, settings, workspaces, or CAT data. Legacy Linguist project and session migration lives under **Settings → Data migration**. See [USERDATA_LAYOUT.md](./docs/architecture/USERDATA_LAYOUT.md).

## Development and verification

The repository is pinned to Bun `1.3.14`.

```bash
bun install --frozen-lockfile
bun run typecheck
bun test
bun run check:boundaries
node --test tests/linguist-fusion-architecture.test.mjs
bun run --filter='@proma/electron' test:linguist
```

Development and builds:

```bash
bun run dev
bun run electron:build

cd apps/electron
bun run build
bun run sync:runtime-deps
bun run smoke:pack
bun run smoke:vertical
```

`build:resources` is fail closed: no `|| true` may hide a critical resource-copy failure. Tests, smoke checks, and packaging validation must use an exact temporary `--user-data-dir` and must not read or write the real user-data root.

## Remaining human gates

Implemented code and automated verification are not product qualification. The following still require real use:

- native IME composition and Native Open checks; Native Save overwrite prevention has passed in an isolated packaged-app clone;
- VoiceOver, complete keyboard-only paths, and drag/resize feel;
- a same-model professional-quality blind evaluation across Web Chat, legacy LA, and the new LA, including coverage, cost, and latency evidence;
- real Provider/model runs and representative customer-format samples;
- a 14-day personal-use run with issue capture.

Signing, notarization, public update channels, and cross-platform release qualification are outside the current personal-use Alpha scope. See [HANDOFF.md](./docs/HANDOFF.md), [TODO.md](./TODO.md), and the [execution queue](./docs/roadmap/LINGUIST_FUSION_QUEUE.md).

## Documentation

Start at [DOCS_INDEX.md](./docs/DOCS_INDEX.md); maintenance rules are in [DOCUMENTATION_MAINTENANCE.md](./docs/DOCUMENTATION_MAINTENANCE.md).

## License

Licensed under [AGPL-3.0](./LICENSE), with all required Proma and third-party attribution preserved.
