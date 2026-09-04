# Linguist Agent

Linguist Agent is a desktop Agent for personal, day-to-day localization work:

> The complete Proma Agent and Chat product, plus Linguist project context, CAT tools, and a localization workbench.

This AGPL-3.0 project derives from [Proma](https://github.com/proma-ai/Proma). See [NOTICE.md](./NOTICE.md), [ATTRIBUTION.md](./ATTRIBUTION.md), and the pinned [upstream baseline](./docs/architecture/UPSTREAM_BASELINE.md).

[中文 README](./README.md)

## Product

This is a **personal-use Alpha** derived from Proma. Published artifacts primarily serve the author’s own installation and automatic updates; no public support, compatibility period, signing, notarization, or cross-platform qualification is promised. Current versions and verification evidence live in [CURRENT_FACTS_SIMPLE.md](./CURRENT_FACTS_SIMPLE.md); core modifications are tracked in the [Touchpoint ledger](./docs/architecture/proma-touchpoints.json).

The app has three peer modes:

- **Agent**: Proma's complete general Agent, including tools, files, MCP, Skills, trusted project instructions, Workspace Memory, permissions, Thinking, Queue / Steer, Planning, Collaboration, and Automations.
- **Chat**: multi-provider chat, attachments, tools, context controls, and side-by-side comparison.
- **Linguist**: projects, batches, TM/TB/Context, Segment editing, Proposals, QA, import/export, Tag Profiles, backup, and restore.

Agent uses a single **Pi Runtime**. Claude models remain available through Anthropic-protocol providers, but the product no longer ships the Claude Agent SDK or Nowledge Mem Runtime. Linguist reuses the same `AgentView`, Session Store, Workspace, providers, models, permissions, and Proma Toolset; it does not create a restricted Agent or a second Composer.

## Four professional roles

A blank project session can switch roles. After a persisted user message, its role identity is fixed; create a new project session for another role. Delegated child sessions have fixed roles. The canonical role prompts live in [resources/linguist-roles](./resources/linguist-roles).

| Role | Default responsibility |
|---|---|
| General | Intake, analysis, terminology, scripts, QA, export, and open-ended project work |
| Translator | Production-quality translation and self-review for the declared scope |
| Reviewer | Full bilingual review of Source + current Target, fixing substantive issues and preserving correct text |
| Proofreader | Target-language proofreading and polish, consulting Source whenever meaning is at risk |

A role changes only the default prompt. It does not change tools, MCP, files, model, runtime, or the user's Proma permission mode. Explicit user tasks may extend the default responsibilities; they do not change the persisted role identity.

A Proposal is a visible, reviewable, reversible mutation carrying the Agent's current best formal recommendation. It is not a low-quality draft or a prerequisite for Reviewer work. Proposal Critic, Auditor, Execution Policy, and Translation Scope are no longer active product flows.

## CAT workflow

```text
Proma Pi Agent Runtime
├── Workspace / Skills / MCP / AGENTS.md / Memory / Files / Planning / Collaboration
└── Linguist Project Binding
    ├── one shared set of CAT tools
    ├── built-in Common Quality Contract + current Role Markdown
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
- Prompt Builder keeps one contract; Project Digest exposes `complete / partial / skipped` and `truncated`, with a model-visible placeholder on failure.
- General may selectively delegate to Translator, Reviewer, or Proofreader. Child sessions inherit the same Workspace and CAT project, freeze their Segment scope at creation, and hand off through the shared CAT Store rather than copied chat text.
- `cat_confirm_segments` records `unchanged / corrected / blocked` decisions. Reviewer completion requires a decision for every frozen Segment; Proofreader records an independent proofreading stage.
- Terminology context, QA, and write gates share one scope-aware evaluator. Only unambiguous, explicitly applicable required/forbidden rules block; numeric, newline, and ordinary-token differences remain QA signals.
- Managed Context images are returned through the existing `cat_read_context_doc` tool as visual content for Pi models, without an OCR service or image database.
- `cat_import_resources` accepts files or small directories; the native UI accepts multiple files or a directory. Renderer never accepts arbitrary pasted paths, leaving path authority in the main process.
- Agent tools and native UI support `verified` and explicitly confirmed `as-is` export. Both validate output generation and re-import, with overwrite off by default.
- Tag discovery, candidates, editor hints, Proposals, QA, and verified export share one Scanner.
- Phrase split/master MXLIFF pairing uses content evidence and blocks verified export when mapping is incomplete or stale.
- memoQ MQXLIFF uses a dedicated adapter that preserves inline codes, confirmation status, and review comments; real customer samples still require per-sample validation.

Full `AgentView` retains Proma's Files / Changes panel; the Workbench rail is conversation-only. A Linguist session directly inherits its Proma Workspace's Skills, MCP, trusted `AGENTS.md`, Memory, Files, Planning, Queue, and Collaboration. CAT project binding only adds domain context and tools; it does not duplicate host capabilities.

Batch navigation lists only real batches, refreshes in place, and selects the first valid batch when the current selection disappears. Footer progress, draft count, and source/target character counts are scoped to that batch; stage labels follow project workflow (`confirmed / reviewed / proofread`).

Agent conversation remains available when a project is archived, missing, or temporarily unavailable. CAT tools report the real project state and Store writes fail closed.

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
bun run test
bun run check:boundaries
node --test tests/linguist-fusion-architecture.test.mjs
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

## Verification evidence

Implementation, automated regression, packaged checks, real-provider checks, and product qualification are separate evidence levels. See [current facts](./CURRENT_FACTS_SIMPLE.md), [known limitations](./docs/release/KNOWN_LIMITATIONS.md), and [remaining work](./TODO.md).

## License

[AGPL-3.0](./LICENSE), preserving all required Proma and third-party attribution.
