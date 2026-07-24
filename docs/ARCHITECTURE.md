# Architecture

Linguist Agent `2.32.7` is a local macOS product composed of an Electron client, an authenticated loopback server, Pi-native General/CAT/Maintainer runtime adapters, general-work capabilities, and a professional game-localization domain layer.

## System boundary

```text
Electron renderer
  ↕ typed preload IPC
Electron main process
  ↕ signed rendezvous + authenticated random Unix-domain HTTP/SSE
cat-server
  ├─ canonical standalone + Project Task/Run projection
  ├─ Pi session and active-run ownership
  ├─ resource trust, Package Center and managed capabilities
  ├─ Library, memory and Maintainer
  └─ domain packages
       ├─ durable Task/Project data and evidence
       ├─ file formats and document processing
       ├─ general tools plus CAT write gates
       └─ runtime policy/sandbox/resource snapshots
```

`apps/desktop` is the only frontend. The server remains authoritative; the renderer never becomes a second lifecycle or CAT data store.

## Package ownership

- `packages/cat-data`: standalone/Project Task ownership, standalone grants, personal/Project Library, confirmed memory, managed document capability and qualification contracts, Project manifests, Batches, Team workflow records, Artifacts, Decisions, Eval, TM/TB/glossary/assets, QA, delivery, storage governance, and migrations.
- `packages/cat-formats`: Phrase, memoQ, Trados, generic XLIFF, CSV/XLSX, and bilingual-document adapters.
- `packages/cat-tools`: General Library/memory/document tool definitions plus CAT reads, proposals, deterministic write gates, and delivery policy.
- `packages/cat-runtime`: General/CAT/Maintainer Pi session construction, immutable General resource snapshots, request-shape manifests, permissions, dynamic tool loading, sandboxing, compaction, self-healing, delegation, and Team child evidence runtime.
- `packages/cat-mcp`: MCP discovery/client policy and read-only allowlist wrapper.
- `packages/cat-server`: loopback API, authentication, runtime registry, standalone/Project Task projection, Pi executable-resource trust, Package Center, managed document qualification, Library/memory, Maintainer, resident runtime, Pi Settings, providers, sessions, keybindings, themes, and notifications.
- `apps/desktop`: main/preload/renderer trust boundary, Chats/Projects/Library/Package Center/Settings workspaces, macOS notifications/menu/keybindings, packaging, and acceptance harnesses.

## Canonical product model

`packages/cat-data/src/task_workspace_contract.ts` schema v2 defines:

- Task owner: standalone or Project. Standalone cannot contain Project/Batch/Segment authority; Project scope may add Batch, locale pair, and Segments.
- Task: user intent and durable status.
- Run: one Single, Team, Eval, or deterministic pipeline attempt.
- Agent thread: Main or identified specialist identity and status.
- Activity: ordered human/system/tool/evidence/process facts; hidden reasoning is excluded.
- Artifact: versioned production output with provenance.
- Decision: required/recorded authority, including Extension UI interactions and quality/delivery disposition.

`task_workspace.ts` stores the snapshot plus append-only generated events, enforces cursor ordering, repairs the narrow event-written/snapshot-not-replaced crash window, and rejects unauthorized manifest mutation. `task_message_queue.ts` stores a schema-checked `message_queue.json` beside either owner type's Task snapshot; stable queue ids bridge durable user intent to Pi's in-memory FIFO without matching on message text. Schemas and sanitized fixtures under `contracts/` guard wire compatibility.

Clients can create/open/list Tasks and read cursor events. They cannot append authoritative events. Every Task has explicit owner/scope, and focused Segment source is hydrated server-side. Standalone and Project storage roots are separate; runtime migration validates ownership against the storage path and imports legacy Home history as an archived standalone Chat.

## Run paths

### General message delivery

Standalone and Project Main expose the same active-Run delivery vocabulary. Steer enters Pi's steering queue immediately; follow-up enters Pi's native FIFO and the server-owned durable Task queue. `TaskMessageQueueCoordinator` serializes mutations, keeps stable ids aligned with Pi events, and supplies pause/resume, edit/delete/reorder/retry, Stop/interruption recovery, and idempotent human-Activity projection. Electron renders this server state through one shared queue tray and never treats its local ordering as authority.

### Standalone General

`/api/tasks/*` creates, lists, archives, restores, copies, grants files to, and runs no-project Chats. `general_agent_runs.ts` owns live General coordination. Before a model call it resolves directory trust and Pi resources without evaluating Extension modules, obtains path-plus-SHA approval for unknown user/global executable Extensions, fixes an immutable resource snapshot, and writes the Run resource manifest. A selected file grant becomes explicit next-Run attachment context; PNG/JPEG/WebP is converted to Pi `prompt(images)` input only after current-grant and declared-model-capability checks. The Pi session then exposes the shared General delivery path, fork/compaction, and only the filesystem roots granted to that Chat.

General Run resources can include approved Pi Skills, Prompts, Themes, context/system files, Extensions, managed Packages, built-in tools, dynamic general tools, and the sandboxed shell. General Chat has no Project, Segment, proposal, apply, QA, or delivery authority. Server-owned delegation creates identified child threads; direct Package child orchestration tools are not activated.

### Project Main / Single

`POST /api/projects/:projectId/tasks/:taskId/chat/stream` derives the internal Pi session id, validates Task/batch/segment scope, resolves the immutable Run resource manifest, and projects human, tool/evidence, response, usage, failure, compaction, and Stop facts into the Task chronology. Registered Project asset attachments use the same Pi native image-content path as standalone grants when they are PNG/JPEG/WebP and the selected model accepts images; other asset types remain explicit tool/document inputs. During that Run, `/messages` and `/message-queue/*` expose the same steer/follow-up and durable queue operations as a standalone Chat.

### Team

Team preflight selects a server-owned role graph and projects waiting specialist threads without starting models. Start/resume requires the current plan hash. `team_context_builder.ts` hydrates project/Task/batch/segment evidence, prior artifacts/findings/decisions, and budgets; client-authored context is rejected. Children receive only signed, expiring, path-confined, read-only CAT evidence tools. Deterministic engineering and Delivery remain separate authority gates.

Specialist follow-up validates an existing message-capable child and creates a new one-role Run in the same Task. It never rewrites the source Run.

### Eval

Private Eval uses one server-owned, batch-scoped Eval Task per eval set/project/batch. Single generation and canonical Team execution receive source/evidence only; withheld reference/customer fields never enter generation. Outputs, scorecards, blind judgments, and comparisons are typed artifacts. Identity stays hidden until a blind queue is complete.

### Quality and Delivery

Explicit audits, readiness checks, exports, and other deterministic operations create pipeline Runs. They reuse the selected Task or create one first, then project System activity and typed artifacts instead of hiding work in an older Run.

### Maintainer

A standalone Chat with an exact recursive read-write repository grant can request a read-only Pi-upgrade preview. The preview captures repository HEAD, dirty paths, lockfile digests, target version, isolated candidate location, fixed validation commands, rollback description, and plan hash. Build requires the matching approval, creates a separate Git worktree, optionally uses an Extension-free Maintainer Agent for compatibility migration, runs the fixed validation set, and returns a candidate Artifact. It never mutates the current runtime; activation is a separate approval and installer health/rollback path.

### Stop

`ActiveAgentRunRegistry` is the only live-handle owner. The canonical Task Stop endpoint dispatches by selected Run mode: Single to the project live/pending path, Team to workflow Stop, and Eval to durable Eval Stop. Each owner projects the terminal state and prevents late children from reactivating it.

## Evidence and writes

Evidence policy is typed, not prompt-only:

- locked rows and code-enforced formatting constraints are immutable;
- typed termbase/glossary/reviewed or promoted exact TM can bind according to project policy;
- fuzzy and working TM are advisory until promoted;
- assets and returned URLs/excerpts remain citable with provenance;
- tool trace is audit data, not evidence by itself.

CAT writes flow through proposal/apply or explicit write tools and deterministic gates. QA disposition is recorded in `QualityDecisionLedger`; Delivery rechecks formatting signatures and unresolved findings before export. Agent autonomy controls generic runtime tools only and cannot bypass CAT gates.

## Library, retrieval, memory, and documents

Personal and Project Library roots own imported document copies, source digests, block indexes, and vector metadata. Search can be lexical, vector, or hybrid. Vector retrieval uses the exact managed `multilingual-e5-small` pack when its files and digest are ready; missing/unready semantic capability is visible and cannot be silently replaced by a remote embedding provider.

Memory is a separate revisioned store. The Agent may propose a preference, fact, or guidance record with source Task/Activity/Artifact provenance. Only user-confirmed records are recalled. Edit/revoke uses optimistic revision checks. Recalled memory is context, never CAT evidence.

Managed document capabilities use preview/plan-hash installation, exact manifests, isolated worker protocols, file grants, source-digest checks, and reviewable Artifacts. Native Office/PDF extraction is preferred; qualified PaddleOCR supplies geometry/confidence evidence when native text is insufficient. Document tools can project results into a strictly parsed schema-v1 Rich Artifact containing only markdown, table, chart, image, page-overlay, diff, and file-reference blocks. The renderer maps those blocks to inert React UI, while Electron export revalidates the model, requires an explicit native save destination, denies navigation/permissions/network/window creation, and produces inert HTML, PDF, or PNG. MinerU is a fail-closed Labs route for complex layout/table/formula recovery and remains unavailable until the exact pack passes qualification. No undeclared system/cloud fallback is allowed.

## Pi resources and Packages

Pi owns sessions, providers/models, tools, compaction, skills, prompts (including native image content), themes, and extensions. LA uses exact package pins and official APIs. Task Package profiles record future-Run intent with revision and plan hash; the Run manifest records the immutable resolved package/resource facts and request-shape hashes.

General Chat resolves Pi resources before execution and records each exact path/digest plus winner/shadowed conflicts. Directory trust controls project-local resources; digest-bound LA trust controls previously unknown user/global executable Extensions. Changed bytes invalidate approval. Configured-but-missing Packages fail startup rather than auto-installing.

Package Center catalog discovery is read-only. Managed install downloads one exact version into quarantine, disables lifecycle scripts during dependency install, rejects unsafe archives, records dependency closure/tree hash/risks, and promotes only after current plan-hash and risk approvals. Installation does not edit Pi settings or automatically activate code. Server-approved resources may enter a future General Run; Product CAT still requires its server-selected immutable profile.

Main Extension UI maps blocking interactions to canonical Decisions. Team Runs without Task Package resources use the verified `pi-subagents` adapter. Selected Skills/Prompts or one digest-approved standard-UI Extension switch the child to Pi RPC v1; the original specialist thread owns the Decision and the Package source/version/resource/integrity is persisted as caller provenance. Multiple executable Extensions and arbitrary/custom UI fail preflight because Pi RPC v1 cannot attribute or represent them.

## Desktop boundary

Electron main owns native menus, windows, notifications, runtime launch/connection, and restricted IPC. Preload exposes a narrow typed API. Renderer code owns presentation and local ephemeral UI state only; canonical Task snapshots/events remain server data.

The professional shell exposes Chats, Projects, Library, Package Center, and Settings. General and Project Conversation share semantic Activity/Artifact/Decision presentation but not authority. At narrow widths the same stores/components reflow into overlays/drawers; the renderer does not invent a mobile lifecycle.

Notifications derive from validated Task event candidates, stay quiet for the foreground Task, deduplicate reconnect replay, and never accept arbitrary Electron notification options. Settings edits Pi keybindings through the official global contract and keeps provider secrets behind Keychain/official environment references.

The current model is not a renderer-only default. `PUT /api/pi/model-preference` validates one available provider/model pair and writes the Pi global preference atomically; `readModelDefaults()` gives that complete user pair precedence over the bundled project fallback, while explicit environment overrides still win. Composer and Settings consume the same resolved provider catalog defaults, retain the choice across Tasks and sends, and apply it only to a new Run. Provider OAuth/API-key connection actions live beside this control, with credentials remaining in Keychain or official environment references.

Pending Pi/tool permission requests are canonical server state. Electron renders the earliest actionable request by replacing the current Composer with the shared Task-scoped approval surface and recovers pending requests during an active Run after stream reconnects; approval/denial is still sent only to the server. Settings exposes narrow trusted IPC actions for launchd restart and signed-runtime repair. Rebuildable-cache cleanup remains an authenticated server preview followed by an exact `planHash` execute request, never a renderer-side delete.

## Storage and recovery

- `packages/storage-sqlite` is the LA-023/LA-084/LA-085/LA-086/LA-087/LA-088/LA-105 foundation built on the Node `node:sqlite` API (minimum 22.16 for the online backup API). Its schema-v2 WAL store provides atomic event/projection commits, optimistic revision checks, command idempotency, migration-version refusal, reopen recovery, and rollback on a mid-transaction constraint failure. Version 2 includes a hash-bound, data-only mapping contract for legacy Task workspace/event, quality-decision, message-queue, and Task Package-profile fields plus ordering, revision/cursor, and blob-reference boundaries. The importers require explicit storage authority, publish byte-hashed backups before classification, reject unknown fields and corrupt middle JSONL, retain the established torn-final-record rule, replay ordered canonical Task events, recheck source digest and authority before commits, and verify stored projections. LA-087/105 provide the shared Project/standalone TaskWorkspace, queue and profile backend; LA-089 is the sole production caller and explicitly excludes the Project quality ledger. Authority-gated database backup separately uses SQLite's online backup API and verifies schema, quick-check, size and SHA-256 before restoring only to absent targets. LA-090 adds a read-only audit boundary: a SQLite snapshot deterministically produces hash-chained schema-v1 JSONL containing only opaque stream/event references, sequence/type/time metadata, and canonical payload/projection digests. It never exports raw payloads, projections, identifiers or paths and has no import/write API.
- Task persistence is one aggregate for migration purposes: `TaskRunEvent` includes `decision_upsert`, and `TaskWorkspaceSnapshot` embeds Decisions while queue/resource profile are Task-side state. LA-102 therefore makes LA-087 repository-readiness-only and assigns the Task-domain production authority switch to LA-089 after both core Task replay and Task-side state pass parity. The Project quality decision ledger is a separate cross-Task CAT-governance stream: LA-103 explicitly excludes it from LA-089, keeps JSONL canonical, and assigns its later single cutover to LA-098. Splitting Task writers, or letting LA-089 and LA-098 both own the Project ledger, is forbidden.
- LA-104 routes TaskWorkspace, Task message queue and Task Package profile access through explicit install-once persistence seams. LA-089 now performs the only production install during exclusive startup: after the existing runtime-schema migration, under the data-root writer lease and before recovery/listen, it inventories legacy Task roots, publishes per-Task workspace and side-state backups, runs strict import/parity, verifies the exact baseline projection set, writes one durable SQLite authority marker, blocks explicit legacy state-file writers, and installs the complete backend. On later starts the marker, canonical database path, SQLite quick-check, cutover baseline and backup digests must all verify before requests are served. Post-cutover Task creation may add canonical streams without changing the frozen baseline. The old Task state files are retained as rollback evidence and are never dual-written. Project quality ledger remains JSONL-owned until LA-098.
- `npm run storage:audit -- export --database <absolute-db> --output <absolute-jsonl>` and the corresponding `verify --input` command open SQLite read-only. Export stages and fsyncs a new file, publishes without overwriting an existing destination, removes partial staging on failure, and returns the whole-file SHA-256 plus record counts. Verification regenerates the canonical bytes and compares them exactly; it is not a re-import path and cannot restore JSONL as an authority.
- Durable project state: `data/projects/<projectId>`.
- Durable standalone Chats and private workspaces: `data/assistant/tasks/<taskId>`.
- Durable queued follow-ups: `message_queue.json` beside the owning Task snapshot for either owner type.
- Personal/Project Library, confirmed memory, managed capabilities, and Package Center registry/quarantine: module-owned roots under `data/assistant` or `data/projects`.
- Runtime/settings/eval/history roots: resolved by their owning modules under `data/` or Pi/macOS user directories.
- Rebuildable parse/vector cache: resolved cache root, not durable project truth.
- Logs/reports/acceptance output: ignored runtime roots or `/private/tmp`.
- Original imported source directories are never owned or deleted by LA.

Production backend and renderer log events use the shared `cat-data/safe_logging.ts` entry. It emits schema-v1 JSON lines with a diagnostic ID and recursively redacts credentials, authorization/cookie headers, local paths, customer-content fields, unknown free-form strings, nested Error messages, and oversized/circular values before the sink sees them. Server diagnostics apply the same redaction on create, append, and legacy read; their active JSONL file is bounded to 5 MiB plus one rotated archive. Existing log bytes are not rewritten by migration.

Cleanup and historical backfill are preview/hash-gated. Resident runtime is launchd-owned and loopback-only. Repository validation must not be confused with synchronizing or restarting the managed Application Support runtime.

## Security invariants

- Signed rendezvous, authenticated random Unix-domain transport, and Keychain-backed bootstrap credential; fixed loopback is an explicit authenticated transition/test mode only.
- No production business module may write raw payloads through `console.*`; user-facing CLI output is not a retained product log.
- Task/project/batch/segment scope validated before model launch.
- Standalone file access confined to the private workspace plus explicit canonical grants.
- Project resource trust resolved before inclusion; unknown executable Extension approval bound to canonical path and SHA-256 before evaluation.
- Package catalog browsing is non-executing; managed installation is quarantine/plan-hash/risk-gated and lifecycle scripts remain disabled.
- CAT bash exact-host egress allowlist, credential read denial, data write denial, and environment scrub.
- MCP default-deny except explicitly allowlisted read-only tools.
- No secrets in Git, Pi JSON config, plist, docs, or shell startup files.
- No customer/production/runtime data in fixtures or commits.
- No silent fallback or client-authored authoritative lifecycle.

## Build and release

Root `mac:*` commands delegate to `apps/desktop`. Packaging stages the Electron app and bundled runtime without installing it. Release creates signed/notarized app, zip, dmg, checksums, and GitHub Release artifacts. Swift, Sparkle, appcast, and Pages feeds are not part of the chain.

`release:mac -- --dry-run` validates flow without signing, notarizing, uploading, replacing `/Applications`, or mutating the managed runtime. Final RC uses a synthetic isolated two-batch project; real-machine visual/accessibility and human blind-quality work remain separate evidence gates.
