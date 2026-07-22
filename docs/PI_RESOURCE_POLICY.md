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
- an isolated `DefaultResourceLoader` configured only with the exact approved snapshot paths after trust checks have completed
- Pi built-in read/search/edit/write tools, with `bash` replaced by LA's `@anthropic-ai/sandbox-runtime` wrapped tool
- a canonical standalone Task/Run/Activity/Artifact/Decision projection
- dynamic file-grant checks on every filesystem tool call
- native Pi queue, steer, follow-up, event, compaction, and session mechanics

Project-local Pi resources enter the snapshot only after the selected working directory resolves as trusted. Previously unknown user/global executable Extensions produce a canonical permission request containing canonical path, source, size, and SHA-256 before their module is evaluated. Approval is persisted against the exact path-plus-digest pair; changed bytes invalidate it. Denial, disappearance, or mutation after the snapshot fails the Run visibly. Read-only delegated children receive no executable Extensions.

Configured Packages that are missing locally fail General startup. Resource discovery is not permission to auto-install a Package as a side effect. Package installation and managed activation remain explicit Package Center or Pi Settings operations outside the active Run.

The immutable General Run resource manifest records Pi version, working directory, file-grant IDs, exact Packages, active tool names, resource hashes, request-shape facts, and conflicts. Conflicts record the actual winner and shadowed providers and are also projected as typed Activity. A change in settings, Package state, trust, or bytes affects a future Run; it cannot expand an active Run.

General Chat has no Project, Batch, locale-pair, segment, apply, or delivery authority. Its host boundary is the private Chat workspace plus explicit canonical file grants. The default General permission preset automatically permits reads inside those roots and asks before generic writes, network tools, bash, or bridge tools unless the user has explicitly saved another global preset.

### Product CAT, Eval, and Team Sessions

Normal product CAT sessions use `noExtensions: true`, do not inherit user-global or project-global Skills/Prompts/context, and load only LA CAT built-ins/custom tools plus resources selected by the server for the canonical Run profile. Eval remains tool-free/resource-isolated. Team children receive the server-compiled minimal child context, and their Agent tool surface never gains more authority than the parent Run.

Team delegation has two server-owned Pi-native transports. A Run with no selected Task Package resources uses the exact verified `pi-subagents` adapter. A Run with selected Skills/Prompts or one digest-approved Package Extension uses Pi `--mode rpc` with ambient Extensions/Skills/Prompts/Themes/context disabled. Before launch, LA recursively re-hashes every selected resource, rebuilds CLI paths from the attested resource list rather than a client-authored path list, loads Package hooks before the server-owned evidence guard, and uses that final guard to append the canonical Team constitution, reset the active Agent tool set to the signed read-only evidence profile before every provider request, and block every out-of-profile tool call.

The RPC host maps `select`, `confirm`, `input`, and `editor` to canonical thread-scoped Decisions; fire-and-forget notification/status/widget/title/editor-text requests become native-host diagnostics or presentation updates. With one executable Package Extension, every resulting Decision stores its exact source, name, version, resource ID, digest, and `pi-rpc-v1` transport. Multiple executable Extensions fail because Pi RPC v1 does not identify which Extension emitted a request. Known arbitrary/custom TUI APIs, unknown RPC UI methods, changed resources, malformed protocol records, command timeouts, and Extension runtime errors fail visibly rather than falling back to prompts. Direct Package-owned `subagent` and `wait` tools remain unavailable.

This does not turn third-party Extension code into a security sandbox. Pi Package Extensions have full process permissions, so exact digest approval and Package audit remain a code-trust boundary; the read-only Team tool profile constrains Agent tool calls, not hostile Node code inside an approved Extension. Skills and Prompts are non-executable resources but can still influence model behavior. Package discovery, installation, or a clean static scan is therefore never sufficient for Team activation on its own.

This smaller surface is deliberate defense in depth, not the source of CAT authority:

- built-in `edit`/`write` calls cannot write `data/**`; CAT state must change through CAT tools
- sandboxed `bash` keeps normal command/network capability but denies `data` writes, denies reads of `~/.agent-reach`, `~/.ssh`, and `~/.aws`, uses exact-host egress allowlists, and scrubs secret-like environment variables
- built-in/server-selected/web output is tagged advisory (`citable:false`) until a CAT evidence/proposal/write gate records the relevant excerpt
- Package identity, resource selection, and request-shape hashes are recorded on the Run; changing the profile affects a future Run, never an active or historical one

`web_search` and `fetch_content` are available to CAT only when the server-selected Run profile includes the corresponding verified Package resources. `pi-web-access` exposes `fetch_content`, not the older LA `web_fetch` tool name.

MCP has a v2.16 bridge foundation: configured servers can be discovered into the bridge catalog, and explicitly allowlisted read-only tools can be wrapped as namespaced LA bridge tools. Discovery alone does not register a tool.

Browser automation is a blocked bridge category until production Chrome/Phrase adapter safeguards exist. Weather remains a planned bridge category.

The canonical policy catalog lives in `packages/cat-runtime/src/piResourcePolicy.ts` and is surfaced through runtime health plus `/api/agent/bridges`.

Agent Autonomy permissions are a separate current-user policy over generic runtime tools. The contract is exposed through `/api/agent/permissions` and `/api/projects/:projectId/agent/permissions`; the server resolves four modes (`ask`, `auto`, `full`, `custom`) over read/search, generic file writes, web/fetch, bash, and bridge/MCP/browser domains. A standalone Chat with no saved global mode defaults to `ask`. Ask-mode decisions become canonical permission Decisions/Activities and are resolved through the permission-decision endpoint.

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

Package Center is a separate LA-managed path. It can browse/cache the upstream Pi gallery without executing code, download one exact npm version into quarantine, install dependencies with lifecycle scripts disabled, reject unsafe archives, record dependency closure/tree hash/lifecycle scripts/static risk evidence, and require the current plan hash plus every detected risk approval before atomic promotion. Managed install does not edit Pi settings and does not imply activation; only server-approved managed resources can enter a future General Run.

Global Package filters affect a future General Chat Run; they do not automatically enter Product CAT/Eval/Team Runs. Project Package intent enters CAT only after server-side selection, verification, and immutable Run-manifest capture. `/api/pi/packages` does not self-update the Pi runtime. The explicit Maintainer workflow can instead prepare a Pi upgrade in an isolated Git worktree, run the fixed validation set, and return a candidate requiring a second activation approval. No installed Package or maintenance candidate can bypass CAT locks, proposals, evidence, delivery, sandbox, or bridge-policy gates.
