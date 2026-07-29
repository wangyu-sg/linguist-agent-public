# Linguist Agent

Linguist Agent is a desktop workbench for day-to-day localization:

> Proma's complete Agent and Chat product foundation, combined with Linguist Agent's CAT domain core and professional workbench.

This repository is an AGPL-3.0 derivative of [Proma](https://github.com/proma-ai/Proma). Proma remains copyrighted by its original authors. See [NOTICE.md](./NOTICE.md), [ATTRIBUTION.md](./ATTRIBUTION.md), and the pinned [upstream baseline](./docs/architecture/UPSTREAM_BASELINE.md).

[中文 README](./README.md)

## Current status

The product is a **personal-use Alpha** for sustained real localization work. A public release is not currently planned. The architecture is no longer being rebuilt: Proma remains the full general-purpose Agent and Chat product, while Linguist adds a first-class localization mode.

The app has three peer modes:

- **Agent** — Proma's complete Agent workspace with Claude and Pi runtimes, tool activity, thinking, permissions, Queue / Steer, Skills, MCP, and workspace files.
- **Chat** — Proma's multi-provider conversations, attachments, tools, context controls, and parallel comparison.
- **Linguist** — projects, assets, a virtualized Segment Grid, human editing, Proposal review, TM / TB, Context, deterministic QA, workflow confirmation, run summaries and safe undo, delivery preflight, export, integrity scrubbing, backup, and restore.

Linguist is a first-class Agent Profile. It layers versioned Profile, Role, Fast / Balanced / Best Strategy, Project Digest, and per-turn Context on top of the Proma base. It embeds the same Proma `AgentView`; it does not create a second Composer, message stream, Thinking renderer, Tool Card, approval flow, or Session Store. Agent tools may create reviewable Proposals, but cannot bypass human acceptance, CAS revisions, locked segments, tags, QA, or Required/Forbidden term gates.

## Architecture

```text
Proma Desktop App
├── Agent / Chat / Skills / MCP / Automations / Providers
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
- `@linguist/cat-tools` derives project identity only from the Session binding. Its 15 tools are split by project reads, references, QA, and Proposal/Critic behavior.
- `LinguistProjectService` remains the compatibility facade while lifecycle, resources, quality, and delivery live in separate modules.
- Proposal content is stored separately from each issuance and its provenance. Long-running work uses Jobs/Checkpoints, idempotent mutations, a durable outbox, and run-scoped undo.
- Project open performs only bounded Quick Health checks. Full Integrity Scrub runs in a worker thread and checks all managed digests, SQLite/reference lineage, exports, and Session workspaces.
- Proma core changes are registered in [PROMA_CORE_TOUCHPOINTS.md](./docs/architecture/PROMA_CORE_TOUCHPOINTS.md) and enforced by architecture tests.

## Local data

Production data lives under `~/.linguist-agent/`; development uses `~/.linguist-agent-dev/`. General Proma conversations and settings remain JSON / JSONL files. CAT projects use an isolated SQLite database plus managed source, blob, export, and backup directories.

The old `~/.proma(-dev)/channels.json` is read only when the user explicitly chooses **Settings → Model configuration → Import from Proma**. That action imports Provider configuration only; it does not migrate sessions, settings, workspaces, or CAT data. See [USERDATA_LAYOUT.md](./docs/architecture/USERDATA_LAYOUT.md).

## Development

The repository is a Bun workspace pinned to Bun 1.3.14.

```bash
bun install --frozen-lockfile
bun run typecheck
bun test
bun run check:boundaries
node --test tests/linguist-fusion-architecture.test.mjs
bun run --filter='@proma/electron' test:linguist
```

Development and packaged validation:

```bash
bun run dev
bun run electron:build

cd apps/electron
bun run smoke:pack
bun run smoke:vertical
```

CI covers frozen installation, type checking, root tests, CAT package tests, Linguist main-process tests, architecture boundaries, license scanning, and the Electron build.

## Remaining human gates

Implemented code and automated verification are not the same as product qualification. The personal Alpha still needs:

- real macOS IME composition and Native Save overwrite checks;
- VoiceOver, complete keyboard-only paths, and drag/resize feel;
- a blind evaluation of Fast / Balanced / Best using real game text;
- real Provider/model runs and representative customer-format samples;
- a 14-day personal-use run with issue capture.

Signing, notarization, public update channels, and cross-platform release qualification are outside the current personal-use scope. See [HANDOFF.md](./docs/HANDOFF.md), [TODO.md](./TODO.md), and the [execution queue](./docs/roadmap/LINGUIST_FUSION_QUEUE.md).

## Documentation and license

Start at [DOCS_INDEX.md](./docs/DOCS_INDEX.md); maintenance rules are in [DOCUMENTATION_MAINTENANCE.md](./docs/DOCUMENTATION_MAINTENANCE.md).

Licensed under [AGPL-3.0](./LICENSE), with all required Proma and third-party attribution preserved.
