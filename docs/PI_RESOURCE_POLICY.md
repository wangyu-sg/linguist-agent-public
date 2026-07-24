# Pi Resource Policy

This policy explains how LA uses Pi's external resource ecosystem without making CAT delivery behavior non-deterministic.

## Sources Checked

- Pi settings and project overrides: <https://pi.dev/docs/latest/settings>
- Pi extensions and custom tools: <https://pi.dev/docs/latest/extensions>
- Pi skills: <https://pi.dev/docs/latest/skills>
- Pi prompt templates: <https://pi.dev/docs/latest/prompt-templates>
- Pi packages and filtering: <https://pi.dev/docs/latest/packages>
- Pi security/project trust: <https://pi.dev/docs/latest/security>
- Pi SDK/resource loader/session API: <https://pi.dev/docs/latest/sdk>
- Model Context Protocol TypeScript SDK: <https://github.com/modelcontextprotocol/typescript-sdk>

## Current Decision

LA has two product resource surfaces, both using Pi's native SDK and Agent loop:

- standalone General Chats inherit the trusted Pi resource graph for their selected working directory;
- Project CAT, Eval, and Team sessions are intentionally isolated and load only server-selected resources for the immutable Run profile.

The distinction is capability scope, not Agent identity. General Chat is the product's no-project Agent workspace. CAT sessions add project evidence and deterministic write/delivery authority without allowing user-global executable resources to enter a client Run implicitly.

### Managed Runtime Source Boundary

The development checkout may contain untracked local skills under `.agents/skills` and untracked `.pi/skills` links for Codex, frontend design, or other local work. They are not LA release resources. Both local managed-runtime sync paths exclude `.agents` and the source `.pi/skills` tree, then repopulate `.pi/skills` from `git ls-files '.pi/skills/**'` only. This keeps the Application Support runtime reproducible while preserving the developer's local resources in the source checkout.

Versioned `.pi/skills/cat-*` resources remain available to CAT sessions. Global Pi resources and explicitly configured packages still follow the inheritance, trust, sandbox, advisory-evidence, and CAT-gate rules below; this source-copy boundary does not replace those runtime policies.

### Historical Home Data

The legacy Home-specific Agent loop is gone, but projectless Agent work is not. Runtime schema v2 imports legacy Home messages and Pi session history into one archived canonical standalone Chat under `data/assistant/tasks/<taskId>`. During the compatibility window, legacy Home GET returns that migrated `taskId`; legacy Home POST/stream/stop return the typed `home_replaced` response and never start a second loop.

### CLI And Development Sessions

CLI/development sessions may use:

- global Pi resources under `~/.pi/agent`
- project `.pi/skills`, `.pi/prompts`, and `.pi/extensions`
- installed Pi packages
- explicit `pi -e` extension paths

This is useful for browser helpers, document/spreadsheet/PDF helpers, MCP-building tools, and development support.

Pi project trust controls whether project-local settings, resources, packages, and extensions are loaded before a session starts. Electron Settings exposes current LA runtime repo/current parent trust decisions through `/api/pi/trust`, backed by Pi's `~/.pi/agent/trust.json`; this is resource-loading control, not a CAT write or sandbox boundary.

Electron Settings retains one-shot Pi startup controls for explicit development sessions. Normal Product CAT/Eval/Team Runs ignore inherited resource paths and use their server-compiled Run resource set. Standalone General Chats use the selected working directory and trusted global Pi settings as their resource-loading inputs; they do not replace the CAT runtime prompt or grant CAT authority.

### Standalone General Chats

Standalone General Chats use:

- Pi's `DefaultPackageManager.resolve()` to discover the exact configured Package/resource graph without evaluating Extension modules
- a server-authored immutable Run snapshot of Pi Extensions, Skills, Prompt Templates, Themes, context/system files, source scope, canonical path, and SHA-256
- an isolated `DefaultResourceLoader` configured only with exact snapshot paths after trust checks have completed; any future executable path must first be replaced by its verified content-addressed staged path
- Pi built-in read/search/edit/write tools, with `bash` replaced by LA's `@anthropic-ai/sandbox-runtime` wrapped tool
- a canonical standalone Task/Run/Activity/Artifact/Decision projection
- dynamic file-grant checks on every filesystem tool call
- selected standalone file grants may supply PNG/JPEG/WebP to Pi's native image prompt channel on a new Run only; LA validates the current grant, byte limits, and the selected model's declared image input before allocating base64 data
- native Pi queue, steer, follow-up, event, compaction, and session mechanics

Project-local non-executable Pi resources enter the snapshot only after the selected working directory resolves as trusted. Stable General Runs exclude all user, project, and managed Package executable Extension paths before the loader is constructed and load only LA-owned inline runtime factories. Existing path-plus-digest approvals remain readable legacy trust records, but they do not authorize Stable execution. Read-only delegated children likewise receive no external executable Extensions.

Executable Extension trust records use the v2 content store under `data/runtime/trusted-extensions/sha256-<digest>/`. Approval re-reads the canonical source bytes, rejects a changed source or an unstaged relative/dynamic dependency, writes one read-only Extension plus a read-only manifest, and records the original and staged digests. A writable, missing, extra-file, manifest-mismatched, or digest-mismatched staged tree fails closed. Before execution, Extension Host v1 re-reads the approved digest into a private read-only copy and loads only that copy in an independent `srt` process with Node permissions, a sanitized environment, no filesystem writes, no network, no child process, and an empty capability grant. Its authenticated JSONL adapter exposes pure registered tools only; Extension events, commands, flags, shortcuts, UI/render hooks, argument hooks, and direct context capabilities fail closed. General and isolated CAT Session constructors reject external paths instead of passing them to Pi's in-process loader. Stable executable Extension activation remains disabled until a later explicit product Gate connects only this bounded Host surface; approval or Host availability alone does not activate a Package or Run.

Configured Packages that are missing locally fail General startup. Resource discovery is not permission to auto-install a Package as a side effect. Package installation and managed activation remain explicit Package Center or Pi Settings operations outside the active Run.

Before any migrated General or CAT/Eval Pi Session is created, the Host compiles a JSON-serializable schema-v1 preparation Plan. It binds the workspace and current grant snapshot, permission contract, model inputs, prompt inputs, resource snapshot, and exact initial/registered tool surfaces to explicit hashes. Every new standalone General root Run, Project CAT root Run, and Private Eval single generation consumes its Plan only inside a Supervisor-owned Worker process, re-verifies the Plan, and rejects mismatched identity, capability, model, prompt, resource, or tool inputs; it cannot rediscover a wider surface after startup. The strict versioned bidirectional RPC returns an attestation for the exact prepared prompt, tool surface, resources, access, and grant context. Task-backed General/CAT Runs persist the matching `ExecutionSnapshot` before activation. Private Eval validates the attestation in memory before activation and continues to persist its existing canonical Eval execution manifest after the generation because its low-level generator has no Task locator. Prompt, steer, follow-up, compaction, and Extension events are rejected before activation. Permission, delegation, dynamic capability activation, typed Extension UI, and Host-owned CAT tools cross RPC without becoming Worker-owned Task truth; server-tool abort propagates back to the Host. A revoked grant disappears at the next tool call, while a grant added later is outside the frozen Plan and cannot expand that Run. The immutable General Run resource manifest records Pi version, working directory, file-grant IDs, exact Packages, active tool names, resource hashes, request-shape facts, and conflicts. Conflicts record the actual winner and shadowed providers and are also projected as typed Activity. A change in settings, Package state, trust, or bytes affects a future Run; it cannot expand an active Run.

General Chat has no Project, Batch, locale-pair, segment, apply, or delivery authority. Its host boundary is the private Chat workspace plus explicit canonical file grants. The default General permission preset automatically permits reads inside those roots and asks before generic writes, network tools, bash, or bridge tools unless the user has explicitly saved another global preset.

Permission approval is necessary but is not the execution grant. Filesystem calls additionally pass the canonical realpath broker. Public-web calls additionally pass an exact scheme/host/port broker; credential-bearing URLs and private/loopback targets are denied by default, and approved-bridge tools remain blocked without an exact Run grant. Shell execution additionally requires the LA-owned `sandboxed-shell` process template at the hook and spawn boundaries. A provider Secret is represented to authorization code only by an opaque consumer-bound handle; the value stays inside the host resolver and plaintext Pi credential entries are not accepted by the legacy LA web bridge. Provider model transport itself remains a Pi/runtime-internal capability rather than an Agent tool grant.

Selecting a file in the Composer does not expand an active Run. The selection is frozen for the next Run, appears in canonical human-visible attachment context, and can be revoked from that Chat's attachment flow. The adjacent shield changes the separate, server-owned Agent permission preset (global for standalone Chat; scoped override for a Project) and never converts a file grant into ambient access. PNG/JPEG/WebP may be direct model image input only when the chosen model declares `image` input; unsupported images fail visibly and all other files remain available only through authorized tools/document capabilities. Project Tasks apply the same Pi image-content rule to registered Project assets, while CAT authority remains unchanged.

### Product CAT, Eval, and Team Sessions

New Project CAT root Runs execute their Pi Session only in the CAT Supervisor Worker while the Host retains capability decisions, server-owned memory/Team tools, typed Extension UI, canonical Task projection, and all proposal/evidence/QA/delivery authority. Normal product CAT sessions use `noExtensions: true`, do not inherit user-global or project-global Skills/Prompts/context, and load only LA CAT built-ins/custom tools plus resources selected by the server for the canonical Run profile. Private Eval single generation uses its separate `private_eval` Worker profile and remains tool-free/resource-isolated. Each new Team specialist transport Session uses the same Supervisor protocol under the `team` profile. Before launch, the Host revalidates the signed child scope's exact Project, Workflow, Role, expiry, policy hash, and read-only evidence-tool subset; the child can neither inherit a sibling scope nor expand the parent Run's authority. Non-Run CAT prompt/catalog/compaction support operations and standalone compaction/fork also consume strict Worker Plans. A delegated General child records its Worker and runtime epoch as canonical Activity before prompting. These support operations do not invent Task ExecutionSnapshots when no canonical Run owner exists; they retain their existing durable domain results. The dormant, Stable-disabled Maintainer migration Agent remains outside this active product execution claim until LA-050.

Team delegation has two server-owned Pi-native child transports beneath the Supervisor-owned Team transport Session. A Run with no selected Task Package resources uses the exact verified `pi-subagents` adapter. A Stable Run with selected Skills/Prompts uses Pi `--mode rpc` with ambient Extensions/Skills/Prompts/Themes/context disabled. Before launch, LA recursively re-hashes every selected resource, rebuilds CLI paths from the attested resource list rather than a client-authored path list, and uses the server-owned evidence guard to append the canonical Team constitution, reset the active Agent tool set to the signed read-only evidence profile before every provider request, and block every out-of-profile tool call. Any selected executable Package Extension blocks Stable preflight. These nested Pi child processes are implementation details of the one canonical Team Role execution; they do not become a second Task writer or permission authority.

The RPC host maps server-owned child interactions to canonical thread-scoped Decisions and diagnostics. Stable does not load Package Extension hooks, so no Package-owned UI request can enter this transport. Malformed protocol records, command timeouts, and child runtime errors fail visibly rather than falling back to prompts. Direct Package-owned `subagent` and `wait` tools remain unavailable.

Digest approval is not capability isolation: a Pi Package Extension would still have full process permissions if loaded. Stable therefore blocks it rather than treating approval or static scanning as a sandbox. Skills and Prompts remain non-executable but can still influence model behavior and stay subject to immutable Run resource selection.

This smaller surface is deliberate defense in depth, not the source of CAT authority:

- built-in `edit`/`write` calls cannot write `data/**`; CAT state must change through CAT tools
- sandboxed `bash` requires the exact LA-owned process template, keeps only its configured command/network capability, denies `data` writes, denies reads of `~/.agent-reach`, `~/.ssh`, and `~/.aws`, uses exact-host egress allowlists, and scrubs secret-like environment variables
- built-in/server-selected/web output is tagged advisory (`citable:false`) until a CAT evidence/proposal/write gate records the relevant excerpt
- Package identity, resource selection, and request-shape hashes are recorded on the Run; changing the profile affects a future Run, never an active or historical one

`web_search` and `fetch_content` are available to CAT only when the server-selected Run profile includes the corresponding verified Package resources. `pi-web-access` exposes `fetch_content`, not the older LA `web_fetch` tool name.

MCP has a v2.16 bridge foundation: configured servers can be discovered into the bridge catalog, and explicitly allowlisted read-only tools can be wrapped as namespaced LA bridge tools. Discovery alone does not register a tool.

Browser automation is a blocked bridge category until production Chrome/Phrase adapter safeguards exist. Weather remains a planned bridge category.

The canonical policy catalog lives in `packages/cat-runtime/src/piResourcePolicy.ts` and is surfaced through runtime health plus `/api/agent/bridges`.

Agent Autonomy permissions are a separate current-user policy over generic runtime tools. The contract is exposed through `/api/agent/permissions` and `/api/projects/:projectId/agent/permissions`; Stable resolves three modes (`ask`, `auto`, `custom`) over read/search, generic file writes, web/fetch, bash, and bridge/MCP/browser domains. A stored legacy `full` value is blocked with a repair instruction and is never normalized to a wider or different preset. A standalone Chat with no saved global mode defaults to `ask`. Ask-mode decisions are bound to `taskId`, `runId`, `sessionId`, and `projectId`: `allow_once` resolves only the current request, `allow_conversation` is an in-memory session grant keyed by domain/tool/target fingerprint, `always_allow` writes a merged global or project `custom` policy, and `deny` resolves only the current request. CAT hard rails remain immutable and cannot be widened by any grant.

These permissions do not govern CAT-domain operations. Segment writes, proposal apply, delivery export, locked rows, evidence gates, Platform Backfill writes, and delivery confirmation stay under CAT proposal/evidence/delivery gates in every permission mode.

Current bridge policy:

| Bridge | Status | Access class | Mutation risk | Evidence behavior |
|---|---|---|---|---|
| `web_search` | implemented via inherited Pi package | `public_web` | `read_only` | URL/query/excerpt/timestamp output; advisory until cited in a CAT proposal or decision |
| `web_fetch` / `fetch_content` | implemented via inherited `pi-web-access` | `public_web` | `read_only` | URL/excerpt/timestamp output; advisory until cited and cannot bypass locks, tags, terminology, or delivery gates |
| Browser automation | blocked | `authenticated_browser_session` | `external_mutation_possible` | Requires row label/source signature/editor-load confirmation and same-row readback before CAT state can trust writes |
| Weather | planned | `public_utility` | `read_only` | Utility output is not CAT authority unless a future workflow explicitly records why it matters |
| MCP | implemented foundation | `per_tool_declared` | `per_tool_declared` | Discovery is catalog-only; allowlisted v2.16 tools must be read-only, trace-visible, `catWriteEligible: false`, and advisory/reference until cited |

## MCP Bridge Rules

MCP still uses `@linguist-agent/cat-mcp` for the audited bridge foundation:

- `.pi/mcp-servers.json` is the explicit server catalog input.
- Supported v2.16 discovery transport is stdio; other transports are reported as diagnostics until implemented.
- Tool names are normalized to `mcp__<server>__<tool>` to avoid collisions with CAT or web bridge tools.
- MCP annotations such as `readOnlyHint` and `destructiveHint` are recorded as metadata, but LA policy and tests decide whether a tool is safe to register.
- v2.16 MCP tools cannot be CAT-write eligible and cannot write segment, proposal, delivery, or Phrase state directly.
- MCP output and inherited MCP-like package output are advisory/reference context until cited; a later CAT mutation still runs the normal data-layer write gate.

## Bridge Acceptance Rule

Before trusting an external capability for CAT writes, add:

- stable tool name
- tool metadata in the CAT catalog when LA owns the tool
- Settings-visible bridge status and allowlist/configuration state
- access class and mutation-risk classification
- evidence behavior and provenance rules
- trace/progress visibility
- tests proving it cannot bypass CAT lock, evidence, proposal, and delivery gates

Implemented or inherited read tools may be visible by default, but their output stays advisory. Write-capable external tools remain blocked from CAT state unless a future version adds a specific write gate and test suite for that bridge class.

## Known Conflict Pattern

Multiple Pi packages can register the same tool name, for example `web_search`. General Chats inherit Pi's resource order, so LA must inventory the winner and shadowed sources rather than silently pretending every installed tool is active.

Product CAT sessions avoid this ambient conflict by loading a server-selected Run profile. General Chat now records the actual winner/shadowed set in the immutable Run manifest and typed Activity. A conflict is observable; it does not cause LA to claim every provider is active or discard the complete resource set.

## Package Filtering Rule

When committing package resources into `.pi/settings.json`, use the Pi package object form to filter resources:

```json
{
  "packages": [
    {
      "source": "npm:some-package@1.2.3",
      "extensions": ["extensions/*.ts"],
      "skills": [],
      "prompts": []
    }
  ]
}
```

Every committed package entry should be pinned or explicitly justified, and every tool-name overlap needs test coverage.

Electron Settings can confirm-save/remove these `packages[]` entries for global or project Pi settings through `/api/pi/packages`, display configured install paths plus resolved extension/skill/prompt/theme source/status/counts, and invoke confirmed install/remove/update actions through Pi's official `DefaultPackageManager`.

Package Center is a separate LA-managed path. The upstream Pi/npm catalog is read-only discovery and has no Stable install action. The former npm install and preview endpoints permanently return `410`; Stable accepts only a user-selected `.lapkg` through strict Preview and v2 activation routes. The format verifier accepts only self-contained UTF-8 declarative resources, rejects executable/archive/path surfaces, and computes exact archive/manifest/tree hashes. Signature verification authenticates the canonical manifest plus complete resource tree only against explicitly supplied active Ed25519 publisher roots. Preview performs no download, subprocess, extraction, registry write or activation and produces an expiring `planHash` over the complete approved source, signer, resource tree and risk plan. Activation revalidates that plan and exact archive, extracts only to private same-root staging, verifies every resource again, and atomically publishes a read-only tree plus strict `registry-v2` under one writer lock; it never dual-writes legacy state or returns an Extension path. Before Package routes start, the server holds a v2 Package-root process lease; live or ambiguous owners block, while only a provably dead PID may be replaced. This narrow lease does not replace LA-021's future full dataRoot writer lease. Recovery then either proves exact rollback/finalization or persists a blocking marker. General Runs resolve managed resources exclusively from this v2 registry and freeze them at Run preparation. Legacy `installed-v1` remains disabled and is exposed only through a path-redacted inventory. Unknown/revoked/expired/substituted keys and stale or mutated plans fail closed. No production publisher root is embedded while governance remains undecided, so the UI disables activation when none is configured. Package activation never edits Pi settings and discovery/approval never changes an active Run.

Global Package filters affect a future General Chat Run; they do not automatically enter Product CAT/Eval/Team Runs. Project Package intent enters CAT only after server-side selection, verification, and immutable Run-manifest capture. `/api/pi/packages` does not self-update the Pi runtime. The explicit Maintainer workflow can instead prepare a Pi upgrade in an isolated Git worktree, run the fixed validation set, and return a candidate requiring a second activation approval. No installed Package or maintenance candidate can bypass CAT locks, proposals, evidence, delivery, sandbox, or bridge-policy gates.
