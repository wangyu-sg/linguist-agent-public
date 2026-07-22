# Pi General Agent rebuild evidence

Date: 2026-07-20
Product source version: `2.32.7`
Pi dependency family: `0.80.10`

## Scope and truth boundary

This report records bounded source, contract, test, and local-runtime evidence from the General Agent rebuild. It does not claim that an installed app, the resident Application Support runtime, a signed/notarized release, or customer data was changed or verified. Code, tests, exact manifests, and observed runtime output outrank this summary; unfinished work lives only in `TODO.md`.

## Implemented capability

| Capability | Verified source state | Remaining boundary |
| --- | --- | --- |
| Pi runtime | Exact-pinned `0.80.10`, shared `ModelRuntime`, native session/event/compaction APIs | Installed/runtime parity requires an authorized live check |
| Standalone Chat | Schema-v2 standalone Task owner, `/api/tasks/*`, private workspace, explicit grants, native queue/steer/follow-up/Stop/fork/copy/compaction | Real-machine full-flow acceptance |
| Project Expert Layer | Project/Batch/Segment evidence, Team, proposal, QA, and delivery authority preserved | Fixed-seed human blind review |
| Resource trust | Pre-evaluation resolution, directory trust, digest-bound executable Extension approval, immutable Run snapshot, conflict inventory | Multiple child Extensions and arbitrary/custom UI remain intentionally blocked |
| Library/RAG | Personal/Project import, lexical/vector/hybrid retrieval, exact local multilingual-E5 pack | Installed-pack parity and corpus-drift qualification |
| Memory | Explicit propose/confirm/edit/revoke records; confirmed recall only; legacy automatic TDAI hook disabled | Recall remains non-citable context |
| Package Center | Catalog, quarantine, archive limits, scripts-disabled install, closure/tree hash/risk scan, plan-hash approval, managed promotion | Every Package still requires human risk judgment; install is not activation |
| Documents | Exact managed Python/PaddleOCR/Office manifests, Rich Artifact preview/export, fail-closed MinerU tool | MinerU exact pack remains unqualified |
| Maintainer | Read-only preview, exact repository grant, isolated worktree candidate, fixed validation, separate activation approval | Production activation was not attempted |
| Electron UI | Shared standalone/Project Composer and queue, semantic Activity/Decision rendering, responsive professional surfaces | VoiceOver, native menu, and full real-machine P3 |

## Canonical lifecycle and trust

Schema v2 makes Task ownership explicit: standalone Tasks cannot carry Project, Batch, locale, or Segment authority; Project Tasks may add the existing localization scope. Both owners use Task, Run, Agent thread, Activity, Artifact, and Decision. Legacy Home records migrate once into an archived standalone Chat; legacy Home mutation routes do not start another Agent loop.

General Run startup resolves configured Pi resources without evaluating Extension modules, resolves directory trust, inventories executable paths and SHA-256 digests, obtains a canonical Decision for unknown user/global executable code, freezes the exact resource snapshot, and loads only that snapshot. Changed or missing bytes fail visibly. The Run manifest records Pi version, working directory, grants, Packages, tools, resources, conflicts, and request-shape facts.

Standalone and Project Main share Pi-native steer/follow-up execution and the same server-owned durable queue contract for pause/resume, edit/delete/reorder/retry, and interrupted-Run recovery. The renderer is not queue truth.

## Retrieval, memory, and documents

The Library owns imported document digests, block indexes, and optional vector records by personal or Project scope. A dated 60-query multilingual fixture run on the managed `multilingual-e5-small` pack recorded Recall@5 `0.9833` and MRR@10 `0.8888`; the encoded acceptance floors are `0.90` and `0.75`. These figures are a bounded machine observation, not a guarantee for arbitrary corpora.

Memory is revisioned and user-governed. Only confirmed preferences, facts, and guidance are recalled, and recall never becomes localization evidence automatically.

An isolated document-capability qualification recorded CPython `3.11.15`, PaddleOCR `3.7.0`, PaddlePaddle `3.3.1`, bilingual and rotated-image recognition, a zero-outbound guard, and 80 Office/PDF fixtures with digest and reopen checks. The temporary pack was not committed. MinerU remains `unqualified` and fails closed.

Rich Artifacts are declarative and inert. Electron reparses the schema before preview/export, does not use active HTML, and requires an explicit native save destination. HTML export is script-free; PDF/PNG export uses a Node-disabled renderer with denied permissions, window creation, and network access.

## Package and delegation boundary

The Pi gallery is discovery, not an allowlist. Managed installation separates exact download, quarantine, archive/path limits, scripts-disabled dependency installation, integrity/license/tree-hash/static-risk evidence, preview expiry, plan-hash approval, and atomic promotion. Browsing or installing does not execute Extension code or edit Pi settings.

Team Runs without selected Package resources use the verified `pi-subagents` adapter. Selected Skills/Prompts or one digest-approved standard-UI Extension use Pi RPC v1 with re-hashed resources and canonical thread-scoped Decisions. Multiple executable Extensions, arbitrary/custom UI, changed resources, protocol failures, and direct Package-owned `subagent`/`wait` tools remain blocked.

## Verification boundary

The rebuild passed the repository typecheck, backend suite, Electron suite, production build, package verification, release checks, and isolated synthetic RC checks recorded by the implementing commits. Later commits and CI are the authority for current counts. Automation does not close human blind localization review, real-machine visual/accessibility checks, real signing/notarization authority, or MinerU qualification; those gates remain in `TODO.md`.
