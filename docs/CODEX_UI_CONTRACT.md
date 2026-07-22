# Codex UI contract

This is the single durable implementation contract for Linguist Agent's maintained Electron interface. It records product rules derived from the supplied Codex desktop investigation without retaining personal filesystem paths or copying its framework choices.

## Product boundary

- Professional surfaces are Chat, CAT, Library, Inspector, Settings, Package Center, Decisions, Activity and Artifacts.
- Game scenery, decorative texture, and character-world presentation are outside the professional product surfaces.
- The default product entry is a projectless Chat launcher; it is never displaced by a forced first screen for general work.
- A projectless Chat presents Chat language (`当前 Chat`, generic prompt and natural conversation); backend Task and Main-Agent routing names stay out of the default first-turn chrome.
- Electron remains React 19 plus plain CSS. Codex interaction semantics do not justify a Redux, Tailwind, Radix or Framer Motion migration.
- Backend contracts own Project, Task, Run, AgentThread, Activity, Artifact and Decision truth. Renderer components only present and invoke those contracts.

## Window and shell

- Use a 46px native titlebar/drag region with macOS traffic-light clearance.
- Default window is 1280×820; the entire application must remain usable at 480×600 without window-level horizontal overflow.
- Sidebar width is `clamp(240px, 275px, min(520px, calc(100vw - 320px)))` when docked. At narrow widths it becomes a dismissible overlay, not a second navigation implementation.
- Sidebar order is Library, Chats (New chat, Pinned, Recent, Archived), Projects and Settings. Package Center remains a professional capability surface reachable from Settings rather than a competing work hierarchy.
- New Chat is one compact header action, not duplicated in a quick-action stack. Batch-level Task creation stays in the Batch Composer, while attention/running states remain in the canonical Task tree.
- Toolbar and tab actions use 28px controls where the target is compact; every icon-only action has an accessible name and tooltip.

## Tokens and accessibility

- Professional pages use neutral Codex surfaces: light `#fff/#f9f9f9`, dark `#181818/#212121`, foreground `#1a1c1f/#fff`, and blue `#339cff` only for focus, links and semantic accent.
- The token layer is the single source of color truth: canonical surface/ink/accent/status names (`--la-canvas`, `--la-raised`, `--la-sidebar`, `--la-ink-primary/secondary/disabled`, `--la-accent`, `--la-success/warning/danger`) plus the shared control-state and border-strength vocabulary (`--la-surface-control/hover/pressed`, `--la-border-default/hover/active/strong`) and the modal scrim (`--la-scrim`). Pre-redesign alias names (`--la-text-primary`, `--la-surface-canvas`, `--la-action-primary` and friends) are retired; call sites use the canonical names and new code must not reintroduce aliases.
- Persona hues render only inside avatar tiles and status dots (including their pulse/sheen). Cards, chips, icon wells, badges, borders, backgrounds and text on professional surfaces always use the neutral semantic tokens above, never a persona hue.
- Font stack is the Codex system stack (`-apple-system`, BlinkMacSystemFont, Segoe UI and system fallbacks). Base copy is 14px/21px; metadata is 11–12px.
- Keyboard focus is always visible: 2px `#339cff`, 2px offset, with a system Highlight fallback in forced-colors mode. Text fields instead strengthen their border to `--la-border-strong` on focus, and search fields proxy that border change through their wrapper's `:focus-within`; no focused control may lose all visible indication.
- Hover, active, disabled, loading, empty and inline error states are required. Meaningful transitions are 150–250ms and use transforms/opacity when spatial.
- `prefers-reduced-motion: reduce` removes nonessential animation and decorative shimmer.

## Conversation and Activity

- The main document column is at most 48rem; narrow presentation may reduce it to 42rem.
- A user message is right-aligned and has max-width 77%. Agent prose remains document-like rather than a mirrored chat bubble.
- A locally sent user turn stays visible as a normal message until the server-owned Activity projection confirms it; an SSE `done` acknowledgement alone must not make the first turn disappear.
- Consecutive tool/progress events aggregate into typed Activity. A completed Run collapses to a `Worked for {time}` boundary while retaining expandable detail and canonical references.
- Plan, permission approval, request-user-input, tool, error and recovery items remain semantic components, not untyped markdown.
- Virtualization may recycle DOM only; it must never change canonical ordering or counts.

## Composer

- The multiline surface uses a 20px squircle, minimum editor height 44px and maximum height 25dvh.
- Send/Stop/Queue/Steer is one 28×28 stateful action. During a Run the transport explicitly distinguishes “adjust now” (steer) from “run after completion” (follow-up).
- Standalone Chat and Project Main use the same Composer, delivery states, and queued-message tray. Project scope may add real CAT/resource controls, but it does not receive a weaker or alternate message loop.
- Queued follow-ups appear above the Composer in a bounded tray sourced from the server-owned Task queue. It supports pause/resume, edit, delete, drag or keyboard reorder, retry, clear, and promoting one queued item to steer; failure and interrupted states remain visible rather than silently dropping messages.
- Submitting while an existing queue is paused requires an explicit choice to clear the old queue or send the new instruction while preserving it. Focus enters the confirmation, Escape cancels, and narrow layouts keep the primary choices reachable.
- Attachment, model, thinking and capability controls live in the footer and retain accessible labels.
- Resource attachment controls appear only where the current scope can really attach a resource; a projectless Chat must not expose a Project-folder action that cannot succeed.
- Model and effort are direct, keyboard-accessible next-Run choices rather than a nonfunctional settings form; the selected provider/model route is forwarded unchanged to the canonical Run transport.
- Footer disclosures choose the viewport side with more room at open time. A Batch Composer popover must never be clipped by or hidden under the fixed toolbar.
- Permission and capability choices describe their real scope. A renderer control may not silently grant a server permission or activate an unapproved Package.

## Responsive behavior

- At 480×600, Chat, Settings and CAT remain operable.
- Selecting a destination from the narrow sidebar dismisses its overlay before presenting that destination; the drawer may not cover the newly selected Chat or Composer.
- CAT becomes a single-column segment editor; evidence, Inspector, statistics and Task context move into drawers or bottom sheets.
- Conversation controls wrap or progressively disclose; the composer and primary action stay reachable.
- Wide layouts may restore two/three columns, but use the same store and lifecycle state.

## Review gates

- Automated checks cover the fixed dimensions, focus rules, core responsive selectors and canonical state rendering.
- Real Electron review covers 480×600, 1024×700 and the default 1280×820 in light/dark and Reduce Motion modes.
- Native menu/shortcut, screen-reader and packaged-app behavior remain real-machine gates; DOM emulation alone is not acceptance.
