# Electron product logic

This document is the user-visible behavior contract for the Linguist Agent
desktop client. It answers one question first: **after opening the app, how
does a user begin ordinary Agent work or enter the deeper localization
workflow without learning the runtime model?**

The domain vocabulary lives in [`docs/PROJECT_OVERVIEW.md`](../../../docs/PROJECT_OVERVIEW.md). Visual
rules live in [`DESIGN.md`](../../../DESIGN.md). The canonical data contract
lives in `packages/cat-data/src/task_workspace_contract.ts`. If a component,
Package, Pi Session, or backend route suggests a conflicting flow, this
product logic and the canonical contract win.

## Product promise

Linguist Agent is a local-macOS-first general work Agent with a professional
game-localization layer. A user can start a no-project Chat for local files,
research, writing, and document work, or enter a Project to bring in evidence
and bilingual production files, collaborate with Main and Specialists, edit
CAT rows, pass quality gates, and deliver a file without learning Pi, Run
graphs, Package names, or server routes.

The app never spends model tokens merely because a Project or Batch was
opened. The first model-backed work begins only after the user sends a goal.

## One hierarchy and one chronology

The ordinary work hierarchies are:

```text
Chats                    Projects
└── standalone Task      └── Project
                            ├── Assets / Batch
                            └── Project Task
```

- A **standalone Task** is a first-class no-project Chat with a private
  workspace, explicit file grants, General Core resources, and no CAT
  authority.
- A **Project** contains reusable Assets, locale authority, Batches, Tasks,
  and delivery history.
- A **Batch** contains the authoritative bilingual Segment scope.
- A **Task** contains one durable goal and its complete collaboration history.
- A **Run** is an attempt inside a Task. It is not a sidebar node.

Every Task has one chronological center. Human messages, Main replies,
Specialist handoffs, safe Activities, Decisions, and Artifact summaries are
different item types in that same history. CAT is a peer view of the same
Task, not another chat or another Agent session.

## Workspace grammar

The Electron client uses the current Codex app as a functional reference, not
as a source of product truth or branding. The mature behavior to preserve is:

- one stable task-centric window instead of a dashboard of destinations;
- a dense Sidebar ordered as Library, Chats, Projects, and Settings;
- a content-first center whose width changes with the work: readable document
  measure for Conversation, full professional density for CAT and review;
- one contextual Inspector that opens only for the selected Evidence,
  Artifact, Finding, Constraint, or Decision;
- an optional bottom workbench only for a real comparison, evidence, or log
  surface;
- a centered resting Composer that makes continuation obvious without taking
  over the document;
- immediate panel, focus, hover, pressed, menu, and keyboard feedback with
  motion reserved for spatial explanation.

Vercel's public design documents inform the semantic token and component-state
baseline. They do not determine the app's information architecture, force
website-style components, or override macOS, CJK, accessibility, CAT-density,
or localization-domain needs.

Conversation is the persistent mode for every Task; CAT is the peer production
mode only when the current Project Task has Batch scope. Library and Package
Center are professional capability surfaces. Review, QA, Delivery, Eval, Assets, evidence,
and Artifact detail open from the object or action that created the need.
Changing work areas never changes canonical owner, Task, Run, Agent thread,
Activity, Artifact, or Decision truth.

## Opening the app

The app resolves exactly one of these entry states:

| Condition | What appears | Primary action |
|---|---|---|
| Runtime is unavailable | A bounded recovery explanation; Project data is not presented as empty | Install or repair, or retry connection |
| Credentials are unavailable or rejected | Authentication recovery; runtime reinstall is not offered as a bypass | Restore local credentials |
| No saved scope exists | New Chat launcher plus Create Project affordance | Start a Chat or create a Project |
| Chats/Projects exist, no saved scope | Recent Chats and the full Project tree | Continue work or start a Chat |
| Saved Project/Batch/Task still exists | The last valid scope and its remembered Conversation/CAT mode | Continue work |
| Saved object no longer exists | The nearest valid parent scope | Choose another child or import one |

The app does not scan Desktop, the current working directory, or any implicit
source location while resolving these states.

## Starting a no-project Chat

New Chat creates one standalone canonical Task before the first model turn. It
does not create a hidden Project or Home Session. The Composer can then send a
normal message, choose an explicit working directory, or add file/directory
grants through native pickers.

The first turn uses the General Core. Pi resources are resolved for the chosen
working directory before executable Extensions run. Unknown Extension digests
appear as canonical trust Decisions; denial keeps the Chat and user message
safe but does not launch that Run. A configured Package that is missing fails
visibly instead of installing itself.

During a Run, the user may send **adjust now** through Pi steer or queue **run
after completion** through Pi follow-up. Stop remains independently reachable.
Fork, explicit Chat copy/handoff, compaction, archive/restore, pinning, and
history operate on canonical Task/session state. General Chat can use only its
private workspace and current explicit grants and has no Segment, proposal,
apply, QA, or delivery authority.

## Creating a Project

Creating a Project has two explicit steps:

1. Enter the Project name, source locale, and target locale.
2. Grant access to a folder using the macOS file chooser.

Cancel leaves no partial Project. Failure preserves the user's entered values
so the operation can be retried. Creation performs deterministic registration
only; it does not start an Agent.

After creation, the Project opens at **Assets**. The obvious next action is to
import reference Assets and/or a bilingual Batch. A Project is useful before a
Batch exists: the user may inspect or add style guides, glossaries, TM/TB,
spreadsheets, images, and reference documents.

## Importing Assets

Assets are Project-owned. Import always starts from a system file chooser and
reports each selected file independently:

- registration and deterministic parsing progress remain visible;
- one failed file does not hide successfully registered files;
- searchable text, workbook rows, term entries, and parse warnings remain
  traceable to the canonical Project-relative asset;
- Tasks reference Assets and evidence; they never copy the source file into a
  second Task-owned truth.

Opening or parsing an Asset does not start a model call. Cloud vision or other
external processing remains opt-in and must disclose provider and cost before
the request leaves the Mac.

## Importing a Batch

Batch import starts from a system file chooser. Multiple selected files may
produce multiple Batches, with one result row per file. Cancellation performs
no import. A partial failure keeps successful Batches and explains which files
remain unresolved.

The newly opened Batch shows **Batch ready**, not CAT and not an automatically
running Agent. It contains:

- format;
- source and target locales;
- complete Segment count;
- confirmed, draft, new, and locked counts;
- deterministic blockers or parse warnings when present;
- one Project/Batch-scoped Composer asking what outcome the user wants.

The Batch-ready surface loads a canonical summary. The complete Batch remains
available and is loaded when CAT needs it; it is never shortened, paged, or
represented with fixed-height rows to disguise cost.

## Turning a goal into a Task

The user writes the desired outcome in the Batch-ready Composer, for example:

> 审校整个批次，优先检查术语、角色语气和标签问题。

Sending performs one atomic product transition:

1. Create one Batch-scoped Task with that durable goal.
2. Persist the exact human message in the Task chronology.
3. Create or claim the first canonical Main Run.
4. Show the Task Conversation immediately.
5. Start the model-backed turn and stream the reply into that same chronology.

If runtime launch fails, the Task and human message remain. The UI explains
that work did not start and offers a retry; it never makes the message vanish
or creates a duplicate Task behind the scenes.

The first-line Task title is an immediate fallback. A background title model
may later refine it without blocking the first turn; its usage is included in
the Task's canonical cumulative usage.

## Conversation

Conversation is a durable professional work document, not a Run monitor.

- Human messages remain visible after sending.
- Main replies are readable document-style responses.
- Tool use, evidence reads, progress, compaction, errors, handoffs, and
  lifecycle boundaries are typed Activities, not fake chat bubbles.
- Artifact summaries appear once in chronology; selecting one opens its full
  evidence and provenance in the Inspector.
- Decisions appear once at the moment they block or authorize progress.
- Search and Agent/type/Run filters are non-destructive projections over the
  already complete history.

The Composer always names Project, Batch, Task, optional Segment, and recipient.
Main Agent is the default recipient. A temporary Specialist target is explicit
and cancellable; sending one follow-up returns the Composer to Main.

## Run lifecycle

A Task may contain many Runs, but at most one canonical active Run at a time.

| Run state | User meaning | Valid primary actions |
|---|---|---|
| `pending` | The exact Run exists but execution has not begun | Wait or Stop when the server exposes Stop |
| `active` | Work is executing | Continue browsing, inspect, or Stop |
| `awaiting_input` | A Decision is required | Answer, elaborate, cancel, or Stop |
| `waiting` | Work is safely waiting on a canonical dependency | Inspect or Stop |
| `stopping` | Stop was accepted and cleanup is in progress | Wait; do not start another Run |
| `stopped` | The attempt ended by explicit Stop | Retry or continue in a new Run |
| `failed` / `stale` | The attempt ended without a valid result | Inspect preserved state; retry in a new Run |
| `complete` | The attempt produced its terminal canonical result | Review Artifacts, apply, deliver, evaluate, or continue |

Task status is a durable summary, not proof of a live process. Sidebar Running
and Stop controls use the server-derived active Run summary. An `active` Task
record with no active canonical Run must never appear to be executing.

Scope switching never stops background work. Stop always targets the original
Project, Task, and Run captured when the action became available.

## Structured questions and Decisions

Pi Packages may request native interaction semantics. The desktop client does
not invent a questionnaire object or store Package-local answers. One to four
related questions are projected into a group of canonical Decisions.

The interaction supports:

- single choice;
- multiple choice;
- free text;
- option descriptions and previews;
- partial answers;
- an additional explanation;
- elaborate, cancel, timeout, Stop, reconnect, and late/conflicting response.

Submitting writes one canonical interaction. A late response receives a
conflict, keeps the user's entered answer visible, and reloads current server
state. Stop cancels pending interaction Decisions before aborting the Session.
A server restart never pretends to resume a half-finished Package tool.

Approval, proposal review, apply, waiver, and delivery authorization use the
same Decision truth but name the actual outcome. Browsing, analysis, and draft
editing do not ask for authority intended for writes.

## Main and Specialist collaboration

Main Agent either works directly or proposes bounded Specialist work. Team is
a Run shape, not a product destination.

Before Team execution, the user sees:

- why Specialists are useful;
- their responsibilities;
- estimated model calls when canonical data is available;
- blockers or required input;
- the specific action that will begin work.

Starting uses the latest server `planHash`; a stale plan cannot execute.
Specialist identity, status, safe Activities, failure, usage, handoff, and
Artifacts appear inline in the Task chronology. Selecting one eligible
Specialist Activity or Artifact can create a one-turn scoped follow-up Run in
the same Task. It does not create a permanent Specialist room.

## Artifacts and Inspector

An Artifact summary in Conversation contains only enough information to decide
whether to inspect it: type, title, version, author, scope, concise result, and
the next valid action.

The Inspector is closed by default. It opens for one selected Evidence,
Artifact, Constraint, Finding, or Decision and owns that object's detail,
provenance, and impact. It does not repeat:

- Task metadata already in the toolbar;
- Main Agent identity;
- a complete reply already in Conversation;
- Source/Target editing already in CAT;
- Decision controls already in chronology.

Closing the Inspector never changes the selected canonical object or Task.

## CAT

CAT is a peer mode of the current Batch-scoped Task. Entering CAT loads the
complete canonical Batch and presents a variable-height, virtualized
Source/Target editor.

Keyboard behavior is deterministic:

- Arrow keys move selection.
- Return starts target editing.
- Command-Return saves, confirms when allowed, and advances.
- Escape abandons only the unsaved local buffer.
- Escape never stops a Run.

Editing uses one transient buffer. After 750 ms of inactivity, on blur, before
Segment/mode/scope changes, and before window close, the client attempts to
save a server-owned draft. Only a server acknowledgment marks it saved.
Confirmation is a separate explicit authoritative write.

Revision conflict keeps the local text visible and shows the current canonical
Segment. The user may adopt the server version or retry against it; the client
never silently chooses.

The CAT context Inspector owns TM, TB, QA, constraints, and evidence for the
focused Segment. The Segment companion shows only Segment-linked Task items
and one Segment-scoped Composer. Full history remains in Conversation.

## Review, QA, Delivery, and Eval

These are Task-scoped professional actions, not separate global dashboards.
Each invocation creates a new canonical pipeline Run and writes versioned
Artifacts into the same Task.

- **Review** records findings and proposal decisions; it does not directly
  overwrite locked or unapproved canonical targets.
- **QA** runs the canonical quality gate and exposes findings with evidence,
  severity, status, and valid dispositions.
- **Delivery** checks readiness first. Export requires the canonical
  authorization and produces a delivery Artifact. There is no force-export
  client flag.
- **Eval** compares eligible completed Runs inside the current Eval Task.
  Blinded identity remains hidden until all required judgments are complete.
  Scorecards and comparisons are canonical Artifacts, not renderer-owned forms.

The user can switch back to Conversation or CAT without losing pipeline state.
Completion does not redirect automatically; it highlights the result,
remaining issues, cumulative cost, and primary Artifacts in place.

## Settings and capabilities

Ordinary Settings contain decisions a user can reasonably make during daily
work: model/provider connection, notification behavior, basic Agent autonomy,
memory, appearance, and capability status.

Advanced Settings expose Pi/runtime versions, Package catalog/managed installs,
document qualification, exact resource manifests, tool names, hashes, trust
state, themes, and keybindings. Package composition is resolved server-side per
Run profile. General Chat may inherit approved Pi resources; Product CAT Runs
remain server-selected, and unknown executable Extensions are never evaluated
before their digest trust decision.

Research, browser operation, computer use, and cloud vision remain off unless
the canonical Run explicitly requests a corresponding capability. Computer use
also requires macOS permission guidance. External writes follow read-before,
single-write, and readback verification.

Pi Package UI semantics are bound through official RPC mode. The Package owns
the request semantics; Linguist Agent owns native presentation and canonical
Task/Run/Activity/Artifact/Decision lifecycle. Package widgets, todos,
workflows, sessions, or permission stores may not become a second product truth.

## Failure and recovery rules

Every failure message answers three questions:

1. What action failed?
2. What user work remains safe?
3. What can the user do next?

The client never converts an error into fake empty data, fake zero cost, a
fabricated completion, or an inferred approval. It reconnects Task events from
the last canonical cursor. Polling is compatibility fallback only. A gap or
terminal stream triggers a canonical Task refresh before the UI claims current
state.

Managed runtime install or repair is always explicit. It validates a bundled
manifest and integrity hash, stages the replacement, preserves Project data and
backups, verifies health, and restores the prior runtime on failure. Runtime
repair cannot bypass authentication failure.

## Navigation and input contract

- Command-N opens Project creation.
- Command-Shift-I imports a Batch for the current Project.
- Command-1 opens Conversation for the current Task.
- Command-2 opens CAT when the Task has Batch scope.
- Command-K opens the current product search/command entry.
- Command-Return sends the Composer or confirms the active CAT edit according
  to focus.
- Command-. requests Stop for the current canonical Run.
- Tab and Shift-Tab follow Sidebar → Toolbar → center → Composer → Inspector.
- Arrow keys navigate tree rows and CAT rows without triggering model work.
- Escape closes transient UI or abandons an unsaved CAT edit; it never stops a
  Run.

At 1024×700 the Inspector closes before the Sidebar. The center always retains
enough width for the current conversation or editor. Narrow layout never hides
canonical history or CAT rows.

## Explicit non-features

The ordinary product does not expose:

- Home Session or Home Agent (standalone Chat is the supported no-project
  product, not a renamed Home loop);
- Pi Session as navigation;
- Workflow or Run as a sidebar leaf;
- a permanent Agent rail or participant room;
- a user-selected Single/Team/Eval mode before the goal is known;
- a duplicated Task dashboard in the Inspector;
- Package-managed todos, workflows, permissions, or chat history;
- automatic model work after import;
- fixed-height or clipped conversation/CAT text;
- pagination or hidden old history as a performance strategy;
- client-estimated canonical cost or inferred live state.

## Product acceptance scenarios

The logic is not accepted until one isolated fixture demonstrates all of these
without changing production data:

1. Start a standalone Chat → grant one local directory → approve/deny an
   unknown executable resource digest → steer and queue a follow-up → compact,
   fork/copy, archive, and restore without gaining Project authority.
2. Create Project → import Assets → import Batch → inspect Batch summary → send
   goal → see durable human message and Main reply.
3. Answer a 1-question and 4-question interaction, including multiple choice,
   free text, preview, partial answer, elaborate, cancel, timeout, Stop,
   reconnect, server restart, late response, and two simultaneous Tasks.
4. Approve a Team preflight from its latest plan, observe each Specialist in
   chronology, inspect an Artifact, and send one scoped follow-up.
5. Open CAT at a focused Segment, edit and autosave a draft, resolve a revision
   conflict, confirm and advance, then ask Main about that Segment.
6. Run Review → QA → readiness → authorization → Delivery and create/read an
   Eval scorecard and blind comparison from the same Task.
7. Import/search/reindex personal and Project Library documents, verify lexical
   and local hybrid retrieval, confirm/edit/revoke memory, and inspect Package
   and document capabilities without catalog browsing executing code.
8. Search and filter all 1,146 Activities, scroll all 10k variable-height CAT
   rows, switch scope 100 times, and receive 100 ordered events at 5 Hz.
9. Repeat at 480×600, 1024×700, 1280×820, and 1440×900, light and dark, keyboard-only,
    VoiceOver, and Reduce Motion.
