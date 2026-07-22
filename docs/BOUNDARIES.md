# Boundaries

## Pi Runtime Boundary

Use Pi directly for:

- session lifecycle
- JSONL history and tree/fork behavior
- compaction
- event streaming
- model/provider runtime
- tool execution loop
- skills, prompts, extensions, and packages

Do not implement replacement versions of those systems in LA.

## External Resource Boundary

LA can use external Pi resources.

CLI/development sessions may use Pi's normal global/project discovery. Standalone General Chats resolve the trusted Pi graph for their selected working directory, obtain digest-bound approval for unknown user/global executable Extensions before evaluation, and load one immutable per-Run snapshot. Configured missing Packages fail visibly; startup does not auto-install them.

Product CAT/Eval/Team sessions do not inherit ambient user/project resources. They use the server-selected immutable Run profile. Any external capability that affects CAT state still needs Settings-visible governance, evidence behavior, mutation-risk metadata, traceability, and tests. Raw General, Package, bridge, inherited, or built-in output is advisory (`citable:false`) until a CAT evidence/proposal tool records it.

There is no runnable Home session. Legacy Home records migrate into an archived standalone Chat.

## General Work Boundary

LA implements canonical standalone Task ownership, private Chat workspaces, explicit file grants, permission Decisions, Library/RAG, confirmed memory, managed Packages/documents, and Maintainer. General work cannot create Project/Batch/Segment authority or call CAT apply/QA/delivery gates implicitly.

## CAT Domain Boundary

LA implements:

- project and batch storage
- TM/TB/glossary lookup
- asset search and asset block evidence
- workbook/TBX/TMX import
- segment read/propose/apply
- evidence policy
- locked-segment policy
- QA and delivery gates
- import/export adapters
- workflow artifacts and Platform Backfill state

Segment writes must go through shared CAT write policy. Agent-driven first-pass translation may write draft targets through `batch_set_targets`; edit/proof changes should use durable proposal tables before apply.

Any non-CAT, non-exempt tool targeting `data/**` is blocked by the name-independent data-store guard; CAT state changes must go through CAT import/apply/export/write gates. CAT-session `bash` is sandboxed with exact-host egress, `denyWrite data`, credential-directory read denies, and env scrub.

## Runtime Prompt Boundary

`.pi/APPEND_SYSTEM.md` contains execution-time CAT behavior rules only. It should not contain release status, roadmap, changelog, or handoff prose.
