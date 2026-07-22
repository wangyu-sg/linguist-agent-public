# Reports index

Reports are dated evidence, not current instructions. Current behavior comes from code, tests, runtime output, `README.md`, `docs/AGENT_CONTEXT.md`, and `TODO.md`.

Every committed report must be sanitized:

- no customer source/target rows;
- no credentials, account identifiers, or personal filesystem paths;
- no runtime/installed-app claim without direct evidence;
- no roadmap claim that conflicts with `TODO.md`;
- no source grep presented as UI, accessibility, or quality proof.

## Current evidence

- `PI_GENERAL_AGENT_REBUILD_20260720.md`: source/test evidence for standalone General Chat, Pi resource trust/snapshots, Library/RAG/memory, Package Center, managed documents, Maintainer, and the Codex UI contract, with qualification and open-gate boundaries.
- `ELECTRON_NATIVE_EXPERIENCE_ACCEPTANCE_20260717.md`: Electron UI/performance harness, notification/keybinding contracts, packaging/signing evidence, and explicit real-machine gaps.
- `ELECTRON_P3_MANUAL_PARTIAL_20260718.md`: direct packaged-app and isolated-fixture evidence that narrows, but does not close, the real-machine P3 gates.

Private Eval outputs, customer-derived QA calibration, production-runtime synchronization records, completed rebuild plans, and superseded frontend handoffs do not belong in the source tree. Keep them in their authorized runtime/evidence location; Git history retains previously committed versions.
