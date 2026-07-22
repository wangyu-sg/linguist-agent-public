# Agent Context

Product version: `2.32.7`.

## Current product

Linguist Agent is one local macOS product: Electron in `apps/desktop`, an authenticated loopback `cat-server`, Pi-native Agent runtime adapters, a General Core, and a game-localization Expert Layer. SwiftUI and browser clients are deleted and must not reappear as compatibility layers.

A canonical Task owner is either standalone or Project. Both use Task / Run / Agent thread / Activity / Artifact / Decision. Standalone is the ordinary no-project Chat. Project Tasks may add Batch, locale, Segment, evidence, CAT, Team, Eval, QA, and Delivery scope. There is no runnable Home Agent; legacy Home records migrate into one archived standalone Chat.

## Source owners

- `packages/cat-data`: durable standalone/Project truth, file grants, Library, confirmed memory, document capability/qualification state, evidence, workflow, Eval, QA, and delivery.
- `packages/cat-runtime`: General/CAT/Maintainer Pi session construction, pre-execution resource snapshots, permissions, sandbox, compaction, delegation, and request shapes.
- `packages/cat-tools`: general document/Library/memory tools and CAT-facing tools/gates.
- `packages/cat-server`: authenticated APIs, active-run ownership, Task projections, resource trust, Package Center, Maintainer, Settings, and runtime lifecycle.
- `apps/desktop`: the maintained client and macOS release surface.
- `contracts/schemas` and sanitized fixtures: client/server wire compatibility.

Do not infer state from prose when code, tests, runtime output, or a manifest can answer it. Do not infer that `/Applications/LinguistAgent.app` or the Application Support runtime matches this checkout.

## Runtime facts that matter

- Standalone transport is `/api/tasks/*`; Project Task transport remains `/api/projects/:projectId/tasks/:taskId/*`. Server-derived Pi identity and the canonical active-run registry own execution.
- Runtime schema v2 makes Task ownership explicit. Standalone scope cannot contain Project/Batch/Segment fields, and Project/standalone storage roots cannot collide.
- General Run startup resolves Pi resources without evaluating Extensions, checks directory trust, obtains digest-bound approval for unknown user/global executable Extensions, fixes an immutable snapshot, and then loads only those exact paths. A changed or missing resource fails the Run instead of silently changing it.
- Each General Run records Pi version, working directory, file-grant IDs, Packages, active tools, resource hashes, request shape, and resource conflicts. Winner/shadowed conflicts become typed Activity.
- Standalone filesystem authority is the private Chat workspace plus active canonical file grants. Generic writes, network, shell, bridge, and executable-code decisions retain their permission gates.
- Standalone and Project Main transport use the same Pi-native steer/follow-up/Stop/compaction path. A server-owned durable queue beside the Task snapshot gives Pi follow-ups stable identities for pause/resume, edit/delete/reorder, retry, and recovery after interruption; renderer state is not queue truth. Server-owned delegation uses verified `pi-subagents` for zero-Package Runs and Pi RPC v1 for selected Team Package resources; direct Package `subagent`/`wait` activation is blocked.
- Personal and Project Library use lexical retrieval and an exact managed multilingual-E5 pack for optional vector/hybrid retrieval. Confirmed memory is recall-only and never CAT evidence.
- Managed document packs are exact, offline-capable, provenance-recorded capabilities. PaddleOCR and Office passed the recorded local qualification. Their outputs can carry a schema-v1 declarative Rich Artifact with markdown, table, chart, image, page-overlay, diff, and file-reference blocks; Electron previews the model without active content and exports inert HTML/PDF/PNG only through an explicit native save decision. MinerU remains `unqualified` and cannot fall back to a system command or cloud service.
- Package Center separates catalog discovery, quarantine/audit preview, risk approval, managed installation, and future-Run activation. Opening the catalog never runs Package code.
- Maintainer previews a Pi upgrade from an exact recursive repository grant and builds only in an isolated Git worktree. Candidate activation requires a second approval.
- The eight Agent personas remain Conversation identities, and Auden remains one Lead Linguist persona serving the setup and final phase contracts.
- Task Main Stop dispatches the selected canonical Run: Single/General through the active registry, Team through workflow Stop, and Eval through durable Eval Stop.
- Pi `0.80.10` is exact-pinned. The server shares one injected `ModelRuntime`; persistent credentials remain atomic and resolve only official environment references or LA-owned Keychain commands.

## Open gates

`TODO.md` is the only unfinished backlog. The important remaining gates are fixed-seed human quality review, real-machine Electron P3, real release authority, and MinerU qualification.

## Safe verification

Use an isolated checkout-local synthetic RC Project. Do not replace `/Applications`, synchronize or restart the managed runtime, mutate production data, or copy customer source/evidence into Git unless the user explicitly authorizes that scope.
