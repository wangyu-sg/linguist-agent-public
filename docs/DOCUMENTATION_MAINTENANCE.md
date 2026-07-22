# Documentation maintenance

Documentation follows current behavior. Code, contracts, tests, manifests/lockfile, and observed runtime output outrank prose.

## Owners

- `PRODUCT.md`: stable identity and principles.
- `README.md`: current entry, boundaries, repository map, commands.
- `AGENTS.md`: agent rules and truth hierarchy.
- `docs/AGENT_CONTEXT.md`: fast technical state.
- `docs/HANDOFF.md`: current takeover and verification scope.
- `TODO.md`: unfinished work only.
- `docs/ARCHITECTURE.md`: current component/data/runtime design.
- `docs/EXPRESSIVE_QUALITY_FLOOR_CONTRACT.md`: server-owned expressive QA and constraint-pack contract.
- `docs/OPERATOR_GUIDE.md`: human operating workflow.
- `docs/DOCS_INDEX.md`: inventory and routing.
- `.pi/APPEND_SYSTEM.md`: timeless CAT runtime behavior only.
- `CHANGELOG.md`: version history only.

## Update rules

1. Inspect the implementation and tests that own the claim.
2. Update the smallest canonical document set.
3. Delete superseded “current state”, completed plans, and handoff prose. Git already preserves history.
4. Put unfinished work in `TODO.md`; do not duplicate it across reports.
5. Keep dated reports as evidence only. State their scope and limitations, and never let them override current docs.
6. Never claim installed-app, managed-runtime, production-data, accessibility, visual, or linguistic quality state without direct matching evidence.
7. Never copy credentials, customer rows, private source paths, or acceptance runtime output into docs.

## What not to maintain

- parallel frontend histories after a frontend is deleted;
- version-by-version implementation narratives in current architecture docs;
- exhaustive lists of every source file or test;
- feature claims derived only from source grep;
- branch-specific handoffs after integration;
- “historical current state” paragraphs that future agents must mentally negate.

## Required synchronization

- Version change: package/workspace manifests, lockfile, release markers, current docs, and `CHANGELOG.md`.
- Product-model/API change: contracts, fixtures, tests, `README.md`, `AGENT_CONTEXT`, `HANDOFF`, and architecture as needed.
- Frontend/release change: `apps/desktop` docs, acceptance report, root commands, architecture, and release/RC scripts.
- Open/closed gate: `TODO.md`, then the scoped evidence report if one exists.
- Pi/runtime policy change: `PI_RESOURCE_POLICY.md`, `RUNTIME_BORROWED_PATTERNS.md`, runtime tests, and only then current summaries.

## Verification

Always run:

```bash
git diff --check
npm run release:check
```

Run `npm run rc:status` when current markers, risk language, frontend surface inventory, or RC instructions change. Use `rg` to confirm deleted frontend/branch/roadmap claims are not still presented as current.
