# Pi Community Packages

This document distinguishes discovery, source-checkout Pi configuration, bundled runtime support, managed installation, and per-Run activation. A package appearing in any one surface is not evidence that it is active in every Agent Run.

## Capability sources

### Bundled native capability set

`apps/desktop/runtime/native-capabilities/package.json` and its lockfile are the exact packaged source of truth:

| Package | Exact version | Product use | Activation boundary |
| --- | ---: | --- | --- |
| `pi-docparser` | `3.0.1` | Local attachment/document parsing support | General Run only when server-selected; never replaces CAT format truth |
| `@eko24ive/pi-ask` | `1.1.0` | Structured user interaction semantics | Presented as canonical Decisions; cannot grant CAT writes or permissions |
| `pi-web-access` | `0.13.0` | Public-web research/fetch | Permission-gated and advisory until cited; no CAT authority |
| `pi-subagents` | `0.35.1` | Verified child runtime dependency | LA uses it for zero-Package Team Runs; Task Package child resources use the server-owned Pi RPC v1 adapter; direct Package `subagent`/`wait` tools are blocked |
| `@earendil-works/pi-tui` | `0.80.10` | Required support dependency for bundled Pi resources | Not exposed as an independent user capability |

The package lock records the complete dependency closure. Upgrade the manifest and lockfile together.

### Source-checkout Pi settings

`.pi/settings.json` currently pins:

- `pi-subagents@0.35.1`
- `pi-docparser@3.0.1`
- `@gotgenes/pi-permission-system@20.0.0`
- `@juicesharp/rpiv-advisor@1.20.0`

These entries support trusted Pi CLI/development sessions in this repository. They do not automatically enter Product CAT/Eval/Team Runs, do not bypass General executable-resource trust, and are not proof that the installed Electron runtime contains the same package graph. Missing configured Packages now fail General startup instead of being auto-installed as a side effect.

### Package Center

Package Center indexes the upstream Pi gallery so the user can search the wider community instead of hard-coding a small recommendation list. A complete local fetch on 2026-07-20 observed 5,301 entries; that number is time-bound cached runtime data, not a permanent upstream or repository fact.

Catalog browsing is read-only and non-executing. Installing one exact npm version requires:

1. download into a private quarantine root;
2. archive/path/size/file-count validation and symlink rejection;
3. dependency install with lifecycle scripts disabled;
4. exact package metadata, dependency closure, integrity/license, tree hash, Pi peer compatibility, declared lifecycle scripts, and static file/network/process/secret/custom-UI risk evidence;
5. an unexpired preview with a stable `planHash`;
6. explicit acceptance of every detected risk;
7. atomic promotion into LA's managed package root;
8. separate server selection for a future General Run.

Managed install does not edit `.pi/settings.json`, evaluate Extension modules, or activate resources in an already-running Chat. Package bytes or descriptor changes invalidate the approved preview.

## Core package policy

The Package Center labels these exact versions as LA Core candidates:

| Package | Version | Reason |
| --- | ---: | --- |
| `pi-docparser` | `3.0.1` | Document parsing |
| `@eko24ive/pi-ask` | `1.1.0` | Structured user decisions |
| `pi-web-access` | `0.13.0` | Audited public-web research |
| `pi-subagents` | `0.35.1` | Canonical delegation bridge |

“Core” reduces product ambiguity; it is not a security exemption. Exact archive, dependency, risk, trust, Run-manifest, permission, sandbox, and CAT authority checks still apply.

## Integration rules

- Reuse Pi's official Package/resource APIs; do not build another ambient plugin loader.
- Separate discovery, install, approval, and Run activation. None implies the next.
- Resolve and hash resources before evaluating executable Extensions. Approval is canonical path plus SHA-256 and expires when bytes change.
- Record actual tool-name winners and shadowed resources. Do not claim every installed provider is active.
- Use LA's server-owned delegation bridge. Package-owned child tools cannot create a second Task/Run/Activity authority model.
- Treat Package output as tool/runtime output. It becomes CAT evidence only when the normal evidence/proposal flow records a citable source or excerpt.
- Keep cloud tracing, authenticated-browser mutation, and customer-data upload disabled unless a future explicit data-boundary design and user authority exist.
- A question Package may collect a choice through canonical Decisions; it cannot replace permission prompts, Package risk approval, CAT proposal/apply, Delivery authorization, or human Eval scoring.
- A compression or memory Package cannot decide that binding CAT evidence may be dropped. Confirmed LA memory remains recall-only.
- No Package can overwrite locked Segments, edit authoritative Project scope, bypass formatting/QA/Delivery gates, or write through a Team child that lacks the required RPC/provenance seam.

## Evaluating another package

Use Package Center search and the quarantine descriptor rather than copying popularity claims into this document. Before approving activation, answer:

- What exact user workflow requires it?
- Does Pi or LA already provide the capability?
- Which files, network hosts, processes, secrets, and UI calls can it reach?
- Does it register a colliding tool/resource name, and which provider will win?
- Can its output be kept advisory until normal evidence/write gates run?
- Can it operate inside General grants and permissions without entering CAT authority?
- Is its license and dependency closure acceptable for a packaged macOS product?
- What focused test proves Stop, denial, digest change, reinstall, and removal behavior?

If those answers are incomplete, keep the package quarantined or catalog-only.
