# Product

Linguist Agent is a Pi-native, local-macOS-first general work Agent with a professional game-localization layer. A user can begin with a no-project Chat for ordinary local work, then enter a Project when the work needs durable localization evidence, bilingual segments, deterministic QA, and delivery authority. The product does not hard-code a language pair; current production fixtures and locale-specific QA are deepest for zh-CN → en-US, which is implementation coverage rather than an invariant.

The product subject is the Agent. Pi provides the model/provider, session, tool-loop, compaction, Package, Skill, Prompt, Theme, and Extension substrate. LA turns that substrate into a coherent local product with explicit file grants, resource trust, Library retrieval, confirmed memory, document workflows, professional CAT authority, and an Electron interface.

Current release state, backlog, and handoff details live in `README.md`, `AGENTS.md`, `docs/HANDOFF.md`, and `TODO.md`. This file should stay stable and should not carry roadmap churn.

## Users

The general workspace serves people who want one local Agent to discuss, research, read, write, edit, and deliver work across explicitly granted files without first creating a Project.

The deepest specialist workflow serves professional game-localization translators, editors, proofreaders, producers, reviewers, and tool owners working over bilingual segment data, terminology, evidence, QA, and delivery artifacts.

## Product principles

- Pi owns the Agent mechanics: provider/model discovery, authentication adapters, session lifecycle, native queue/steer/follow-up/fork/compaction, tool loop, Skills, Prompts, Themes, Extensions, and Packages.
- LA owns the product authority: canonical Task/Run/Agent thread/Activity/Artifact/Decision state, file grants, executable-resource trust, Library and memory policy, managed capabilities, CAT evidence, locked-segment rules, proposal/apply workflow, QA, delivery gates, and UI.
- General capability and vertical expertise are layers, not competing products. A standalone Chat receives the General Core; a localization Task adds the CAT Expert Layer and project authority.
- General Chat has no implicit access to the user's Mac. Its private workspace and explicit file grants define filesystem authority; executable Pi Extensions require digest-bound trust before evaluation.
- The Agent acts as a senior game-localization expert when a Task has localization scope. CAT tooling is its instrument, not its entire identity. It should deliver submission-ready lines while deferring to binding client evidence and taking accountable expert judgment where evidence is absent.
- The CAT editor remains a real manual professional workspace when the Agent is offline, like an IDE remains useful without its coding Agent.
- Agent mutations remain explicit, auditable, and gateable. Generic autonomy never bypasses CAT locks, proposals, evidence, QA, or delivery.
- Tool trace is not evidence. Evidence is a returned source/target pair, term row, asset excerpt, project-file excerpt, or URL/excerpt that supports a claim.
- Memory is explicit user-governed recall. The Agent may propose a preference, fact, or guidance entry; only confirmed entries are recalled, and recalled memory is not CAT evidence.
- Locked client segments are immutable. No silent fallback. Failures remain visible in Chat, Activity, diagnostics, or reports.
- LA must not import or call runtime code from sibling or historical worktrees.

## Surface model

The Electron macOS app is the only maintained frontend. Its top-level product surfaces are:

- **Chats** — standalone, no-project General Agent Tasks with pin/archive/history, native Pi continuation controls, file grants, and explicit handoff/copy;
- **Projects** — localization work with Assets, Batches, CAT, Team, Review/QA, Delivery, and Eval;
- **Library** — personal and Project document collections with lexical/vector/hybrid retrieval and explicit memory controls;
- **Package Center** — discover, inspect, quarantine, audit, approve, and activate Pi Package capabilities for future Runs;
- **Settings** — providers/models, permissions, trust, document capability status, themes, keybindings, runtime diagnostics, and maintenance entry points.

The canonical lifecycle is Task / Run / Agent thread / Activity / Artifact / Decision; Project and Batch are optional scope owners for localization work. There is no user-visible Home Agent and no browser fallback. The legacy Home data path migrates into an archived standalone Chat instead of preserving a second loop.

Conversation is the collaboration substrate, typed Activity explains process, and Artifacts/Decisions carry durable results and authority. Main is the default composer. Identified specialist work stays in the same Task chronology, and a scoped follow-up creates another Run rather than a permanent room.

## Visual tone

Professional surfaces should feel like a focused local work tool: quiet, neutral, readable, dense where the work needs density, evidence-forward, and calm under long use. Game scenery and decorative texture are not part of Chat, CAT, Library, Settings, or Package Center.
