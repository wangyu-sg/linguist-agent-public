---
name: cat-translate
description: Produce submission-ready first-pass game localization from the current CAT scope, typed constraints, project evidence, voice, and text function.
---

# CAT Translate

Use for first-pass translation. The target must be strong enough to ship after review; “unconfirmed” is a CAT state, not permission to return a rough or literal draft.

Read `cat-workflow-control` only when gate order, blockers, waivers, customer returns, apply, or export behavior is relevant.

## Workflow

1. Read the scoped batch/segments and available metadata. Establish source/target locale, text function, speaker/scene, length/UI context, locks, and hard formatting constraints.
2. Retrieve the typed constraint/evidence packet for the current scope. For large or term-heavy batches, use `evidence_pack` and `constraint_pack`; use live TM/TB/glossary/asset tools only where the supplied packet is incomplete or a conflict needs resolution.
3. Reuse a confirmed voice profile and relevant exemplars when available. Establish a new profile when recurring speakers, brand voice, or enough batch evidence make it useful; do not block a small or one-off expressive task on profile ceremony or cold-start every character from a generic model voice.
4. Translate each segment to its function:
   - dialogue, narrative, lore, flavor, naming, and marketing: recreate voice, subtext, effect, and target-market appeal where binding evidence leaves room;
   - UI, system, tutorial, legal/platform, numbers, and templated effects: use the clear conventional target-market form; do not embellish;
   - mixed strings: keep the mechanical/informative part exact and localize the expressive part naturally.
5. Write only through the permitted first-pass CAT action. Never alter locked rows. Let duplicate propagation handle unlocked exact duplicates and report skipped rows.
6. Run the current quality/expressive checks after the batch write. Fix real defects; do not loop on an unchanged blocker or invent a waiver.

## Evidence and authority

- The typed context identifies what is binding. Preserve locks and required tag/placeholder/ICU/newline signatures. Preserve numeric values by default, but follow an explicit typed unit/notation conversion rule and keep the resulting QA difference visible. Obey any term/TM/asset rule explicitly marked authoritative.
- Exact TM is binding only when its effective authority/policy says so. Fuzzy TM is always advisory. A same-source match can still be contextually wrong; raise a query when typed authorities conflict.
- Cite the returned row/excerpt when claiming that terminology, TM, an asset, or the web decides a choice. Tool execution alone is not evidence.
- Project evidence does not own every linguistic decision. Where evidence is silent, make the strongest native expert choice for the text function.

## Quality bar

- Preserve meaning, intent, gameplay logic, variables, and player action.
- Avoid source-order calques, translationese, unnecessary pronouns, wrong collocations, flattened character voices, and generic machine phrasing.
- Recreate puns, slogans, jokes, idioms, and new names by effect when the text is expressive. Research only when the answer depends on an external fact, official name, platform term, or target-market usage that cannot be established from project evidence.
- Never invent lore, official wording, speaker context, cultural facts, or a lookup result.
- Ordinary successful candidates need no explanation. Add a short note only for a meaningful creative choice, evidence conflict, cultural adaptation, missing context, or other high-risk exception.

## Output and writes

- First-pass batch targets remain unconfirmed until the product/user confirms them.
- Edit/proof changes use proposals; do not bypass proposal review with direct segment writes.
- A model may recommend a query or risk treatment, but only deterministic gates and explicit user decisions may waive findings or authorize delivery.
