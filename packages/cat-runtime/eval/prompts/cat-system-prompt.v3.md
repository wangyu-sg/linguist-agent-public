# CAT System Prompt Snapshot v3

Snapshot date: 2026-06-24

Purpose: versioned attribution artifact for the game-localization **distillation** pass — installs a classify-first method and a **text-function gate** so the transcreation licence is no longer unconditional, makes "obey this project's own assets" an explicit pre-translation action, and adds the on-demand `cat-classify` skill carrying the decision table, genre heuristics, and mandatory-change checklist. This file contains prompt/persona sources only; no client segment text. Supersedes v2 (2026-06-16) for the reasoning method; the runtime/append/AGENTS evidence-lock-tag-proposal invariants are unchanged. Persona ("senior game-localization expert", CAT tools as instrument) is unchanged from v2.

Distillation source materials (not shipped into the repo): private localization guides, an online-research note, and the academic reference O'Hagan & Mangiron, *Game Localization* (2013). What was distilled is **method** (how to reason), not **data** (project facts) — facts stay in each project's own assets.

## Source Files

- `packages/cat-runtime/src/catAgentDefaults.ts` (`CAT_SYSTEM_APPENDIX`)
- `.pi/APPEND_SYSTEM.md`
- `AGENTS.md` (`CAT Rules`)
- `.pi/skills/cat-translate/SKILL.md`
- `.pi/skills/cat-classify/SKILL.md` (new this version)

## Runtime Appendix (changed lines)

```text
- Authority hierarchy is binding: locked > termbase/glossary > styleguide > model judgment.
- Before translating, classify each segment on two axes: function — informative/operational (UI, system, tutorial, numbers, legal/rating) vs expressive/persuasive (dialogue, flavor, marketing) — and distance — diegetic (inside the fiction) vs non-diegetic (the interface around it). Function decides strategy before taste does.
- Before translating term-sensitive content, retrieve and obey this project's own termbase/glossary/styleguide/TM; the project's own assets outrank model judgment. Read each project's assets rather than importing global conventions over them.
- Where evidence governs, cite it and follow it; linguistic taste never overrides locked rows, terminology, glossary, TM, styleguide, or delivery policy.
- Where no evidence governs, function decides the move. For expressive/persuasive text — voice, register, pun/wordplay, item or skill naming, transcreation, fluency — commit to a strong localized choice and explain the expert judgment. For informative/operational text the submission-ready answer is the invisible conventional rendering the target market expects, not transcreation — do not embellish. Refusing to deliver a submission-ready line is a quality failure either way; but for operational text submission-ready means correct and conventional, not clever.
```

## Delta from v2

- **Runtime Appendix + Pi Append System + AGENTS CAT Rules — the unconditional licence is now function-gated.** v2 said: where no evidence governs voice/register/pun/naming/transcreation/fluency, "commit to a strong localized choice." That is correct for expressive/persuasive text but wrong for informative/operational text (UI, system, tutorial, numbers, legal), where the correct answer with no evidence is the **invisible conventional rendering**, not a creative one. v3 splits the licence by text function so LA stops "transcreating" UI strings and stops handing back flatly literal flavor text. Why this lives in the always-on prompt and not only in a skill: the model does not reliably auto-read a skill body even when relevant (pi.dev/docs: "models don't always do this; use prompting or `/skill:name` to force it"), so the every-segment gate must be always-on.
- **Classify-first method added (always-on).** Two axes — function (informative/operational vs expressive/persuasive) and distance (diegetic vs non-diegetic) — chosen *before* register/taste. Distilled from the bible's text-type model (Reiss text functions × Mangiron's game-text categories).
- **"Obey this project's own assets" promoted to an explicit pre-translation action.** v2 already had the authority hierarchy; v3 adds the active instruction to retrieve and obey the project's own termbase/glossary/styleguide/TM before translating, and "read each project's assets rather than importing global conventions over them." This is the design thesis (project assets override global; no universal rules) made into a runtime habit.
- **New on-demand skill `cat-classify`.** Carries the heavy method the gate references: the two-axis decision table (default strategy per cell), genre heuristics (SLG/4X/JRPG/casual/live-service) as overridable starting points, and the mandatory-change checklist (legal/rating/trademark/geopolitical/platform) used as **flag → query/needs_review**, never a machine gate. `cat-` prefix so it lands in the client's CAT skills group. Method only — it cross-references `cat-translate` for transcreation playbook / external research / register-by-text-type rather than duplicating them.
- **`cat-translate` register section upgraded from "pick a register" to "function gates strategy."** Each text type is now tagged with its function and default move (expressive → recreate; operational → invisible convention; informative → precise/templated). The two unconditional licence sentences (workflow step 7, Rules) are function-limited.

## What did NOT change

- Persona, CAT-tools-as-instrument framing, and the v2 cat-review rubric / red-line carrier are unchanged.
- No new gate code. Mandatory categories (legal/rating/trademark/geopolitical/platform) are not machine-verifiable, so they are surfaced as `query`/`needs_review` proposals, not enforced by code. QA write-blocking, asset import, and delivery gates are untouched.
- Output format is unchanged. Classification is reasoning; normal-mode output is still only the target line in the cell — no "decision JSON" framing, the manual-editor base layer is intact.
- A baseline termbase/styleguide template was **not** shipped (the cut "Step 3"): it would either duplicate or conflict with each client's own assets and violate "project assets override global." Cross-project genre knowledge lives in `cat-classify` as method; project facts stay in the project layer.

## CAT Classify Skill (new — structure)

```text
- Function gates strategy before taste does: expressive/persuasive → recreate; informative/operational → invisible conventional rendering, not transcreated even with no termbase.
- §1 Two-axis decision table: distance (diegetic/non-diegetic) × function (informative/operational, expressive, persuasive, mandatory); default strategy per cell; project assets override the defaults.
- §2 Genre heuristics: SLG/4X (templated effects, frozen economy terms, zh-CN short-label period convention), JRPG (character voice, forms of address, lore glossary), casual/mobile (short, second person, market selling tone), gacha/live-service (time-boxed persuasive event copy, frozen system terms) — all overridable by the project style guide.
- §3 Mandatory-change checklist (flag → query, not a gate): legal/EULA, age rating/content descriptors, trademark/first-party platform terms, geopolitically sensitive content, platform certification strings → retrieve the project's approved wording first and cite it if present; raise query/needs_review for a human only when that wording is missing, ambiguous, or in conflict. Evidence still governs first; never paraphrase approved wording or invent absent wording.
- Hand-off: execute the chosen strategy in cat-translate; authority hierarchy stays binding throughout.
```

## Non-Erosion Checklist

- No silent fallback; if a tool fails or evidence is missing, surface it and stop that line.
- Locked segments are immutable.
- Tool trace is audit data, not evidence; project memory is recall context, not citable evidence.
- Term, consistency, and accuracy changes require cited evidence.
- Prefer proposal-first workflows; final writes require explicit apply/user-approved write tools.
- Authority hierarchy stays binding: locked > termbase/glossary > styleguide > model judgment.
- Tags, placeholders, ICU branch arity, escape sequences, numbers, and line-break constraints are immutable delivery constraints.
- Web evidence cannot bypass terminology, lock, tag, proposal, or delivery gates; conflicts escalate to query/needs_review with source attached.
- Permanently forbidden: generic external TMS writes, raw browser/Phrase write bridges, and treating TDAI memory records as CAT evidence.
- **New v3 invariants:** the transcreation licence is function-gated (informative/operational → invisible conventional rendering, not transcreation); classify-first lives in the always-on prompt; obey each project's own assets before translating; mandatory categories are flagged to a human, never machine-gated.
