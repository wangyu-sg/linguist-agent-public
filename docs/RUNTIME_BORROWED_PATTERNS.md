# Runtime borrowed patterns

The current product version is `2.32.7`. This document records stable patterns LA intentionally reuses from Pi and coding-agent systems; it is not a version diary.

## Reuse Pi instead of rebuilding it

Pi owns provider/model discovery, authentication adapters, session lifecycle, the tool loop, compaction, resource loading, Packages, themes, prompts (including native image content), skills, extensions, and event transport. LA should wrap current official APIs and keep exact dependency pins rather than copy Pi internals or maintain compatibility globals.

Use:

- `builtinModels()` from `@earendil-works/pi-ai/providers/all` for model fallback;
- one process-owned `ModelRuntime` for provider/model discovery, request auth, OAuth, and custom-model refresh, backed by LA's persistent `CredentialStore` for atomic `auth.json` and Keychain references;
- `SessionManager`, `SettingsManager`, and `DefaultPackageManager` for their existing responsibilities;
- Pi request/resource manifests as inputs to LA's immutable Run resource record;
- Pi `AgentSession.prompt(text, { images })` for explicit image attachments, after LA validates the current file/asset authority and the selected model's declared image input;
- Pi native compaction before inventing transcript summarizers;
- Pi Package/resource filters and trust semantics instead of a parallel plugin manager.

## One product lifecycle

Pi sessions are runtime adapters, not user-visible Tasks. Canonical Task/Run/Activity/Artifact/Decision state remains in `cat-data`; no prompt tool, frontend store, or background runner may become a second lifecycle.

The active-run registry owns live handles only. Durable Task/Workflow/Eval records own restart behavior. Stop must call the authoritative durable owner, then bound and dispose live work without allowing late children to revive terminal state.

## Compile resources once per Run

Resolve the Main/Team resource profile before model work starts, verify Package identity/integrity, and persist only safe immutable facts and hashes. A profile change affects a future Run; it never rewrites an active or historical Run.

Main-to-Team promotion retains the complete Main request-shape manifest and adds Team surfaces into a combined hash. Do not discard Main provenance or treat two independently loaded surfaces as the same request.

Standalone General Chats and Product CAT Runs have different resource inputs. Before a Pi Session exists, the Host serializes an immutable profile-specific Plan for its workspace, permission/model/prompt inputs, exact tool surfaces, and resource graph without executing an unapproved Extension. Stable removes every user/project/managed executable Extension path. Each new standalone General root Run, Project CAT root Run, Private Eval single generation, and Team specialist transport Session constructs the Pi Session only in a Supervisor-owned Worker, consuming and re-verifying that Plan plus LA-owned inline runtime factories. The same boundary now owns standalone compaction/fork, read-only delegated children, and non-Run CAT prompt/catalog/compaction support operations; no migrated operation silently falls back to a Host Pi Session. The Supervisor's single control channel carries versioned bidirectional RPC: the Worker attests exact prepared hashes and execution remains disabled until Host activation. Task-backed General/CAT/Team Runs durably record the attested `ExecutionSnapshot` first; Private Eval validates in memory and retains its existing post-generation Eval execution manifest because it has no Task locator. Delegated children record Worker/epoch identity as canonical Activity, while support operations with no Task Run retain their existing durable result rather than inventing a second execution authority. Permission/delegation requests, typed UI, Host server tools, cancellation, and dynamic capability facts return to the Host rather than becoming Worker authority. CAT uses only its server-compiled resource profile and preserves proposal/evidence/QA/delivery gates; Eval remains tool-free. Team revalidates signed Project/Workflow/Role scope and a strict read-only evidence-tool subset before launching either verified Pi-native child transport; Stable rejects executable Package Extensions. External executable Extensions cannot enter either General or isolated CAT Pi Loader. Extension Host protocol v1 privately restages exact approved bytes and can project only pure tool descriptors/results across authenticated RPC from a separately sandboxed process; every unsupported Pi Extension surface is blocked. This is an isolation foundation, not Stable activation. Profiles use Pi's native loader and Agent loop without mutating one another's authority model, and a resource change takes effect only in a future Run/session. The dormant Stable-disabled Maintainer migration Agent remains separately governed by LA-050.

Do not auto-install a configured-but-missing Pi Package during Agent startup. Discovery, installation, approval, and activation are separate operations. A resource loader must not become a hidden Package manager or executable trust prompt.

## Hydrate authority server-side

Clients select scope and intent; the server hydrates batch locale, segment source, evidence, decisions, prior artifacts, role context, and tool scope. Team child tokens are signed, expiring, path-confined, and read-only. This keeps prompts replaceable while authority remains testable code.

## Use native recovery before custom recovery

Classify failures. Retry only known retryable states. Prompt-too-long may compact and retry once; do not compact twice when Pi already compacted the turn. Provider errors, tool failures, timeout/reconnect, output cutoff, permission denial, and Stop must remain distinguishable in the Task and diagnostics.

## Keep extension interaction canonical

Team Runs without Task Package resources use verified `pi-subagents`; Runs with selected Skills/Prompts use Pi RPC v1. Stable preflight rejects every executable Package Extension before child launch. Historical digest approvals remain data, not Stable execution authority; `contact_supervisor` or prompt text is not equivalent to a future isolated Extension host.

## Security is layered

- Stable runtime startup accepts only the `enforce` CAT sandbox phase. `off` and `observe` require an explicit in-process test/development capability and cannot be enabled by an environment variable alone.
- signed rendezvous with authenticated random Unix-domain transport;
- project/Task/batch/segment scope validation;
- CAT write/evidence/delivery gates;
- exact-host egress allowlist and credential/env scrub for bash;
- MCP discovery default-deny with explicit read-only eligibility;
- trust controls resource loading but is not described as a sandbox;
- no literal provider secrets in repo/Pi config/docs.

## Evidence and observability

Persist usage, request-shape hashes, package/resource identities, typed tool/evidence activity, artifacts, and decisions. Do not persist hidden reasoning. Tool trace proves that a tool ran; the returned source/target/term/excerpt proves a claim.

All retained/runtime log events cross the shared structured logger before reaching a sink. Event names and typed numeric facts remain observable; unknown free-form strings, customer text, local paths, credentials, headers, nested Error messages, and stacks do not. Each schema-v1 line has a diagnostic ID. Server diagnostics sanitize both newly appended and legacy-read records and retain only a bounded active file plus one archive; migration does not rewrite old bytes in place.

## Change rule

Borrow a new runtime pattern only when it removes LA-owned machinery or closes a measured gap. Do not add adapters “for parity” without a current product caller and a runnable check.
