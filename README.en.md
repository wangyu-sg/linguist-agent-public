# Linguist Agent

Linguist Agent is a desktop Agent for personal, day-to-day localization work:

> The complete Proma Agent and Chat product, plus Linguist project context, CAT tools, and a localization workbench.

This AGPL-3.0 project derives from [Proma](https://github.com/proma-ai/Proma). See [NOTICE.md](./NOTICE.md), [ATTRIBUTION.md](./ATTRIBUTION.md), and the pinned [upstream baseline](./docs/architecture/UPSTREAM_BASELINE.md).

[中文 README](./README.md)

## Current status

This is a **personal-use Alpha** with no public-release plan. The baseline is Proma v0.16.10; Electron App `0.16.33`, Electron `43.2.0`, `@proma/shared 0.1.91`, Pi `0.82.1`, Claude Agent SDK `0.3.201`, CAT Core / Formats / Store / Tools `0.0.19 / 0.0.10 / 0.0.34 / 0.0.31`, CAT schema `15`, and Bun `1.3.14`.

The app has three peer modes:

- **Agent**: Proma's complete general Agent, including tools, files, MCP, Skills, permissions, Thinking, Queue / Steer, Planning, and Automations.
- **Chat**: multi-provider chat, attachments, tools, context controls, and side-by-side comparison.
- **Linguist**: projects, batches, TM/TB/Context, Segment editing, Proposals, QA, import/export, Tag Profiles, backup, and restore.

Linguist reuses the same `AgentView`, Session Store, providers, models, permissions, and Proma Toolset. It does not create a restricted Agent or a second Composer.

## Four professional roles

Project sessions choose a role at creation and can switch roles in place:

| Role | Default responsibility |
|---|---|
| General | Intake, analysis, terminology, scripts, QA, export, and open-ended project work |
| Translator | Production-quality translation and self-review for the declared scope |
| Reviewer | Full bilingual review of Source + current Target, fixing substantive issues and preserving correct text |
| Proofreader | Target-language proofreading and polish, consulting Source whenever meaning is at risk |

A role changes only the default prompt. It does not change tools, MCP, files, model, runtime, or the user's Proma permission mode. Explicit user instructions may override the default role without changing sessions.

A Proposal is a visible, reviewable, reversible mutation carrying the Agent's current best formal recommendation. It is not a low-quality draft or a prerequisite for Reviewer work. Proposal Critic, Auditor, Execution Policy, and Translation Scope are no longer active product flows.

## CAT workflow

```text
Proma Agent Runtime
├── Base Tools / MCP / Files / Permission / Model
└── Linguist Project Binding
    ├── one shared set of 30 CAT tools
    ├── Common Quality Contract + current Role prompt
    ├── Project Digest / Turn Context
    └── Linguist Domain Services
        ├── UI / IPC
        └── Agent Tools
```

Key boundaries:

- `@linguist/cat-core` is a pure domain layer with no React, Electron, Proma UI, SQLite, or filesystem dependency.
- `@linguist/cat-store` owns each project's `cat.db` and managed source / blobs / exports / backups.
- `@linguist/cat-tools` derives project identity only from the Session binding; the model cannot provide a `projectId`.
- UI and Agent tools call the same `LinguistProjectService`; parsing, transactions, CAS, locked Segments, Tag/Placeholder/ICU checks, QA, and round-trip rules are not duplicated.
- `cat_import_resources` accepts files or small directories. Absolute paths are used directly and relative paths resolve from the Session cwd; Proma Session permissions are the only permission experience.
- `cat_export_asset` supports `verified` and `as-is`. Verified export checks structure, format, and re-import; overwrite defaults off and is an atomic regular-file replacement only when explicitly requested.
- Tag discovery, candidates, editor hints, Proposals, QA, and verified export use one Scanner. Ordinary translatable text such as `[Damage]` is not hard-locked by default.
- memoQ MQXLIFF uses a dedicated adapter that preserves inline codes, confirmation status, and review comments; real customer samples still require per-sample validation.
- Phrase split/master MXLIFF pairing uses content identity, Source hash, unit/context, and placeholder evidence. Verified export refuses incomplete or stale mappings.

Agent conversation remains available when a project is archived, missing, or temporarily unavailable. CAT tools report the real project state and Store writes fail closed, while Proma files, Shell, OCR, Excel, MCP, and other tools remain available for diagnosis or recovery.

## Local data

Production uses `~/.linguist-agent/`; development uses `~/.linguist-agent-dev/`:

```text
~/.linguist-agent/
├── channels.json
├── conversations.json / conversations/*.jsonl
├── agent-sessions.json / agent-sessions/*.jsonl
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

General settings and conversations use JSON / JSONL; SQLite remains limited to each CAT project. API keys are encrypted with Electron `safeStorage` before being written to `channels.json`.

## Development and verification

```bash
bun install --frozen-lockfile
bun run typecheck
bun test
bun run check:boundaries
node --test tests/linguist-fusion-architecture.test.mjs
bun run --filter='@proma/electron' test:linguist
bun run --filter='@linguist/cat-tools' test
```

Packaged checks:

```bash
cd apps/electron
bun run build
bun run sync:runtime-deps
bun run smoke:pack
bun run smoke:vertical
```

Tests and smoke checks must use a task-specific temporary user-data directory and must not touch real user data.

## Evidence still required

Implementation and automated regression do not prove language quality or product qualification. Same-model Proma/Codex comparison, a real-provider four-role workflow, Native Open/IME/VoiceOver/keyboard checks, and 14 days of real daily use still require elapsed human evidence. See [SIMPLE_IMPLEMENTATION_STATUS.md](./docs/roadmap/SIMPLE_IMPLEMENTATION_STATUS.md), [HANDOFF.md](./docs/HANDOFF.md), and [TODO.md](./TODO.md).

## License

[AGPL-3.0](./LICENSE), preserving all required Proma and third-party attribution.
