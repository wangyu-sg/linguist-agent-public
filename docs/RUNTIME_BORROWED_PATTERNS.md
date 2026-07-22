# Runtime borrowed patterns

The current product version is `2.32.7`. This document records stable patterns LA intentionally reuses from Pi and coding-agent systems; it is not a version diary.

## Reuse Pi instead of rebuilding it

Pi owns provider/model discovery, authentication adapters, session lifecycle, the tool loop, compaction, resource loading, Packages, themes, prompts, skills, extensions, and event transport. LA should wrap current official APIs and keep exact dependency pins rather than copy Pi internals or maintain compatibility globals.

Use:

- `builtinModels()` from `@earendil-works/pi-ai/providers/all` for model fallback;
- one process-owned `ModelRuntime` for provider/model discovery, request auth, OAuth, and custom-model refresh, backed by LA's persistent `CredentialStore` for atomic `auth.json` and Keychain references;
- `SessionManager`, `SettingsManager`, and `DefaultPackageManager` for their existing responsibilities;
- Pi request/resource manifests as inputs to LA's immutable Run resource record;
- Pi native compaction before inventing transcript summarizers;
- Pi Package/resource filters and trust semantics instead of a parallel plugin manager.

## One product lifecycle

Pi sessions are runtime adapters, not user-visible Tasks. Canonical Task/Run/Activity/Artifact/Decision state remains in `cat-data`; no prompt tool, frontend store, or background runner may become a second lifecycle.

The active-run registry owns live handles only. Durable Task/Workflow/Eval records own restart behavior. Stop must call the authoritative durable owner, then bound and dispose live work without allowing late children to revive terminal state.

## Compile resources once per Run

Resolve the Main/Team resource profile before model work starts, verify Package identity/integrity, and persist only safe immutable facts and hashes. A profile change affects a future Run; it never rewrites an active or historical Run.

Main-to-Team promotion retains the complete Main request-shape manifest and adds Team surfaces into a combined hash. Do not discard Main provenance or treat two independently loaded surfaces as the same request.

Standalone General Chats and Product CAT Runs have different resource inputs. A General Chat resolves the Pi graph for its granted working directory before module evaluation, obtains digest-bound approval for unknown executable Extensions, freezes exact paths/hashes, and then loads only that snapshot. A CAT/Eval/Team Run uses only its server-compiled resource profile. Both use Pi's native loader and Agent loop. Neither may mutate the other surface's authority model, and a resource change takes effect only in a future Run/session.

Do not auto-install a configured-but-missing Pi Package during Agent startup. Discovery, installation, approval, and activation are separate operations. A resource loader must not become a hidden Package manager or executable trust prompt.

## Hydrate authority server-side

Clients select scope and intent; the server hydrates batch locale, segment source, evidence, decisions, prior artifacts, role context, and tool scope. Team child tokens are signed, expiring, path-confined, and read-only. This keeps prompts replaceable while authority remains testable code.

## Use native recovery before custom recovery

Classify failures. Retry only known retryable states. Prompt-too-long may compact and retry once; do not compact twice when Pi already compacted the turn. Provider errors, tool failures, timeout/reconnect, output cutoff, permission denial, and Stop must remain distinguishable in the Task and diagnostics.

## Keep extension interaction canonical

Main Extension UI maps supported blocking questions to Task Decisions and structured activity. Team Runs without Task Package resources use verified `pi-subagents`; Runs with Skills/Prompts or one digest-approved standard-UI Extension use Pi RPC v1 and record Package caller provenance on the canonical Decision. Multiple executable Extensions and arbitrary/custom UI remain blocked because Pi RPC v1 cannot attribute or represent them; `contact_supervisor` or prompt text is not equivalent.

## Security is layered

- authenticated loopback transport;
- project/Task/batch/segment scope validation;
- CAT write/evidence/delivery gates;
- exact-host egress allowlist and credential/env scrub for bash;
- MCP discovery default-deny with explicit read-only eligibility;
- trust controls resource loading but is not described as a sandbox;
- no literal provider secrets in repo/Pi config/docs.

## Evidence and observability

Persist usage, request-shape hashes, package/resource identities, typed tool/evidence activity, artifacts, and decisions. Do not persist hidden reasoning. Tool trace proves that a tool ran; the returned source/target/term/excerpt proves a claim.

## Change rule

Borrow a new runtime pattern only when it removes LA-owned machinery or closes a measured gap. Do not add adapters “for parity” without a current product caller and a runnable check.
