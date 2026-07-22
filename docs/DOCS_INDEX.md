# Documentation index

This index routes readers to current truth. Git and `CHANGELOG.md` retain history; completed plans and obsolete frontend handoffs do not remain active documentation.

## Canonical documents

| Document | Purpose |
| --- | --- |
| `README.md` | Current entry point, boundaries, commands, repository map |
| `PRODUCT.md` | Stable product identity and principles |
| `docs/VISION.md` | Stable finished-product direction for General Core and localization expertise |
| `AGENTS.md` | Repository rules for coding agents |
| `TODO.md` | Unfinished work only |
| `docs/AGENT_CONTEXT.md` | Fast current-state technical brief |
| `docs/HANDOFF.md` | Current takeover and verification boundary |
| `docs/ARCHITECTURE.md` | Current component/data/runtime architecture |
| `docs/BOUNDARIES.md` | General, Pi-resource, CAT-domain, and runtime-prompt ownership boundaries |
| `docs/CODEX_UI_CONTRACT.md` | Durable professional Electron interaction, responsive, and accessibility contract |
| `docs/EXPRESSIVE_QUALITY_FLOOR_CONTRACT.md` | Server-owned voice, expressive QA, and constraint-pack contract |
| `docs/OPERATOR_GUIDE.md` | Human operating workflow |
| `docs/PI_RESOURCE_POLICY.md` | Pi resource and bridge trust policy |
| `docs/RUNTIME_BORROWED_PATTERNS.md` | Stable runtime patterns LA intentionally reuses |
| `docs/KNOWN_RISKS.md` | RC-consumed risk register |
| `docs/RELEASE_CANDIDATE.md` | Synthetic two-batch RC method |
| `docs/DOCUMENTATION_MAINTENANCE.md` | Source-of-truth and sync rules |
| `.pi/APPEND_SYSTEM.md` | Always-on CAT runtime constitution; no roadmap/history |

## Maintained frontend

- `apps/desktop/README.md`: Electron entry and commands.
- `apps/desktop/docs/PRODUCT_LOGIC.md`: renderer behavior and product mapping.
- `apps/desktop/docs/electron-acceptance/`: acceptance harness protocol and baselines.
- `DESIGN.md`: current visual language.
- `design-qa.md`: open real-machine P3 checklist.

There is no maintained SwiftUI or browser frontend. Any prose that treats `apps/mac`, `packages/cat-web`, Swift, or Sparkle as current is wrong.

## Current evidence reports

- `docs/reports/PI_GENERAL_AGENT_REBUILD_20260720.md`: dated standalone General Core, resource trust, Library/RAG/memory, Package Center, document capabilities, Maintainer, and Codex UI evidence.
- `docs/reports/ELECTRON_NATIVE_EXPERIENCE_ACCEPTANCE_20260717.md`: Electron UI, performance, notification, keybinding, signing, and explicit manual gaps.
- `docs/reports/ELECTRON_P3_MANUAL_PARTIAL_20260718.md`: direct packaged-app evidence that narrows but does not close the real-machine P3 gates.
No report may contain customer rows, production-runtime identifiers, credentials, or personal paths. Reports are dated evidence, not current instructions, and never override code, tests, the canonical documents above, or `TODO.md`.

## History

- `CHANGELOG.md`: version history.
- `docs/archive/**`: explicitly archived reference only.
- Git history: deleted plans, retired frontend details, integration ancestry, and completed handoffs.
