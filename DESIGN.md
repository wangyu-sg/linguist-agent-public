---
version: beta
name: Linguist Agent
description: "A calm Codex-class local Agent workspace with a professional localization layer."
product_logic: "apps/desktop/docs/PRODUCT_LOGIC.md"
ui_contract: "docs/CODEX_UI_CONTRACT.md"
---

# Linguist Agent design contract

## Product model

The ordinary hierarchies are **Chats → standalone Task** and **Projects → Project / Batch / Task**.

- A standalone Task is a first-class no-project Chat with the General Core, private workspace, explicit grants, and no CAT authority.
- Project owns reusable assets, locale authority, Batches, Tasks, and delivery history.
- Batch owns imported bilingual scope and authoritative CAT rows.
- Task owns one durable user goal and its complete collaboration history.
- Run is an attempt inside a Task, never a navigation leaf.
- Main is the default recipient. A Specialist follow-up is a temporary target that creates a new scoped Run in the same Task.
- Activity explains safe process, Artifact carries a result, and Decision records an answer or authorization.

Pi session internals, Package descriptors, resource hashes, process handles, and runtime maintenance details stay in semantic trust/permission items, Settings, or audit output rather than becoming the navigation model.

## Shell

Electron owns one macOS window with real traffic lights, application menus, native file dialogs, shortcuts, focus, selection, and accessibility semantics.

- Titlebar/drag region: 46px with macOS traffic-light clearance.
- Sidebar: Library, Chats (New chat, Pinned, Recent, Archived), Projects, Settings.
- Center: General Conversation, Project Conversation/CAT, Library, or Settings according to the selected surface.
- Inspector: closed by default; opens for one selected evidence item, Artifact, constraint, finding, or Decision.
- Composer: one persistent input for the current Task. Project scope may add Batch, Segment, and a one-turn Specialist target.
- Package Center is a professional capability page inside Settings, not a peer work hierarchy.

At narrow width the same state and components reflow: Sidebar becomes an overlay, Inspector becomes a drawer/sheet, and CAT becomes a single-column Segment editor. There is no alternate mobile lifecycle.

## Conversation and Decisions

- Human messages and Agent replies are durable, readable, selectable, and chronological.
- Human messages are right-aligned with bounded width; Agent replies use a document surface rather than mirrored chat bubbles.
- Evidence reads, tools, progress, compaction, permissions, resource trust, handoffs, errors, and lifecycle boundaries use typed Activity/Decision components.
- Specialist identity, status, handoff, Artifacts, cost, and failure remain visible in the same chronology.
- Consecutive tool/progress items may aggregate; a completed Run may collapse to `Worked for {time}` while retaining full expandable canonical detail.
- Hidden reasoning never appears. Virtualization may recycle DOM only; it never changes ordering, counts, or available history.
- A Decision shows the actual question, scope, impact, valid inputs, requester, digest/target where relevant, and resolved answer history.
- An Artifact summary shows type, version, author, scope, result, provenance, and the next valid action.

## Composer

- The multiline composer uses a restrained 20px squircle, 44px minimum editor height, 25dvh maximum, and a 28px stateful primary action.
- During an active Run, “adjust now” maps to Pi steer and “run after completion” maps to Pi follow-up. Stop remains independently reachable.
- Attachment, model, thinking, capability, and recipient controls live in the footer and retain accessible names.
- Import or opening a surface never starts a model call. The first cost begins only after explicit send/start.
- A renderer control cannot silently grant filesystem/Extension/Package/CAT authority.
- CJK input, selection, undo, dictation, VoiceOver, and Command-Return must remain reliable.

## CAT

- CAT is a peer mode only for a Project Task with Batch scope and remains useful without the Agent.
- The Source/Target editor is dense, keyboard-first, complete, virtualized, variable-height, and single-column at narrow width.
- TM, TB, glossary, constraints, QA, and evidence have one owner: the CAT context Inspector/drawer.
- A Segment companion may show only Segment-scoped chronology and links back to full history.
- Draft, confirm, lock, proposal apply, risk acceptance, QA, and Delivery authority remain server-owned and visibly distinct.
- Inline tags keep one semantic rendering across Source, Target, Inspector, and suggestions and may not alter surrounding text.

## Professional visual language

- Professional surfaces follow `docs/CODEX_UI_CONTRACT.md`: neutral light `#fff/#f9f9f9`, neutral dark `#181818/#212121`, and `#339cff` for focus/link/semantic accent.
- Font stack starts with Geist when available, then SF/PingFang/system. Base copy is 14px/21px; metadata is 11–12px; monospaced text is reserved for paths, IDs, tools, hashes, usage, and audit payloads.
- Prefer typography, spacing, and hairlines over containers. Cards are reserved for real Decisions, Artifacts, trust, and capability state; nested card stacks are prohibited.
- Blue means focus/selection/link/running; green verified completion; amber waiting/warning; red failure/destructive action. Color always pairs with a label or glyph.
- Known Agent persona hues may appear only inside the avatar tile, status dot, or very small authored attribution. They do not tint page chrome or replace a status label.
- Use Lucide icons by semantic name. Do not add emoji avatars, decorative gradients, glass walls, warm paper backgrounds, or game textures to professional surfaces.

## States, motion, accessibility, and performance

Every async surface distinguishes idle, loading, empty, ready, running, awaiting input, waiting, stopping, stopped, failed, stale, and complete where applicable. Zero never means “not loaded”, and errors preserve user work plus a recovery action.

- Keyboard focus is a visible 2px blue ring with 2px offset and forced-colors fallback. Focus is distinct from selection; sheets restore focus to their invoker.
- Meaningful transitions use transforms/opacity over 150–250ms. Motion explains spatial/causal change and honors Reduce Motion.
- Reading/focus order is Sidebar → Toolbar → center → Composer → Inspector.
- Default target is 1280×820; every professional surface remains operable at 480×600, with 1024×700 as the compact desktop review size and 1440×900 as the wide review size.
- Performance work targets decoding, projection, invalidation, measurement, resource boundaries, and reuse. It may not hide history, CAT rows, labels, or accessibility content.

Compilation and Chromium simulation do not prove visual acceptance. Release evidence uses the packaged Electron app at 480×600, 1024×700, 1280×820, and 1440×900, light/dark, keyboard, VoiceOver, Reduce Motion, long Activity history, 10k variable-height CAT rows, and every Run state.

## Owners

- Product logic: `apps/desktop/docs/PRODUCT_LOGIC.md`
- UI interaction contract: `docs/CODEX_UI_CONTRACT.md`
- Tokens: `apps/desktop/src/renderer/styles/tokens.css`
- Shell/navigation: `apps/desktop/src/renderer/workspace/` and `renderer/shell/`
- Conversation/Decisions: `apps/desktop/src/renderer/conversation/`
- CAT: `apps/desktop/src/renderer/cat/`
- Library: `apps/desktop/src/renderer/library/`
- Canonical contract: `packages/cat-data/src/task_workspace_contract.ts`
- Renderer projection: `apps/desktop/src/renderer/data/`
