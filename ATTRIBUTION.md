# ATTRIBUTION

Linguist Agent is built on the work of the following projects.

## Proma (product foundation)

- Repository: https://github.com/proma-ai/Proma
- License: AGPL-3.0 (see `LICENSE`)
- Role: product foundation — Electron shell, Pi runtime integration,
  session/streaming/retry/compaction, provider/model management, UI,
  packaging. Linguist Agent is a derivative work of Proma; the whole
  product is distributed under AGPL-3.0.
- Baseline: `docs/architecture/UPSTREAM_BASELINE.md`

### Modifications to Proma

Linguist Agent is a modified version of Proma. The main categories of
modification are:

- rebranding and packaging as Linguist Agent (product name, app id, icons,
  build configuration);
- addition of the CAT (computer-aided translation) capability packages
  under `packages/linguist-*` and their Electron integration
  (`apps/electron/src/main/lib/linguist/`, renderer CAT workspace);
- channel/provider, OAuth, and session-management changes maintained as
  in-repo commits on top of the upstream baseline
  (`docs/architecture/UPSTREAM_BASELINE.md`, baseline SHA
  `20a5aa8f7c19b8e91949b5fd74b9eee40d767078`).

Per-file provenance, including every copy/adaptation from the legacy
linguist-agent repository, is registered in
`docs/attribution/SOURCE_PROVENANCE.md`.

## Linguist Agent (legacy, same author)

- Repository: https://github.com/wangyu-sg/linguist-agent (private)
- Legacy freeze tag: `la-v2-legacy-freeze-2026-07-25` (branch `legacy/platform`)
- Role: CAT domain source — bilingual format adapters, TM/TB, proposals,
  deterministic QA, delivery gates, domain tests, legacy data migrator
  reference. Code is selectively extracted into `packages/linguist-*`
  under AGPL-3.0 as part of this product.

## OpenWorker (reference, copy-on-demand)

- Repository: https://github.com/andrewyng/openworker
- License: MIT
- Role: minimal information architecture, artifact-first UX patterns.
  Code is copied only on demand; every copy retains its MIT copyright and
  license text and is registered in `docs/attribution/SOURCE_PROVENANCE.md`.

## openai/codex (reference, copy-on-demand)

- Repository: https://github.com/openai/codex
- License: Apache-2.0
- Role: open-source protocol, safety, and session/turn design ideas.
  Code is copied only on demand; every copy retains the Apache-2.0
  license, `NOTICE` content, and a statement of modifications, and is
  registered in `docs/attribution/SOURCE_PROVENANCE.md`.

## Not included

No third-party logos, fonts, brand names, closed-source copy text,
decompiled components, original SVG/video/particle assets, or
reverse-engineered file/chunk/class names are included in this
repository. See `docs/attribution/PRIVATE_RESEARCH_POLICY.md`.
