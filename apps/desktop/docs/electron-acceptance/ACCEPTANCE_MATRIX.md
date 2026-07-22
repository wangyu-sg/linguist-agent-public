# Electron P3 acceptance matrix

No row is complete until the real packaged app and an eligible sanitized
fixture pass. Automated CDP evidence is a prerequisite, not a substitute for
the macOS/manual interaction pass.

## Window, appearance, and motion

| Check | Automated artifact | Real-app check | Status |
|---|---|---|---|
| 480×600 light | screenshot, overflow, clipped controls, AX tree, Tab order | minimum supported viewport; primary action and drawers reachable | Open |
| 480×600 dark | same | contrast, selection, focus, disabled/pressed states | Open |
| 1024×700 light | screenshot, overflow, clipped controls, AX tree, Tab order | full window including titlebar; no hidden primary action | Open |
| 1024×700 dark | same | contrast, selection, focus, disabled/pressed states | Open |
| 1280×820 light | same | default BrowserWindow geometry and content measure | Open |
| 1280×820 dark | same | default geometry, contrast, focus, disabled/pressed states | Open |
| 1440×900 light | same | compare to approved effect image | Open |
| 1440×900 dark | same | compare to approved effect image | Open |
| Reduce Motion, both sizes/themes | transition/animation inventory and screenshots | enable macOS Reduce Motion; verify only essential state motion remains | Open |
| Minimum-width Inspector/companion | clipping report | automatic collapse preserves the current task and focus | Open |

## Keyboard and focus

| Check | Expected result | Status |
|---|---|---|
| Tab / Shift-Tab | visible focus; no trap; Sidebar → Toolbar → central content → Composer → Inspector | Open |
| Sidebar arrows / Home / End | complete tree navigation; selection and expansion are distinct | Open |
| Return / Escape | activate/cancel local edit; Escape never stops a Run | Open |
| ⌘N / ⌘⇧I | New Project / Import Batch; native picker obtains explicit authority | Open |
| ⌘1 / ⌘2 | Conversation / CAT for the same Task | Open |
| ⌘Return in CAT | canonical confirm and advance; locked row never advances | Open |
| Sidebar / Inspector shortcuts | state and focus remain coherent | Open |
| Sheet focus return | Sheet receives focus and restores the invoking control | Open |

## Interaction semantics

| Check | Expected result | Status |
|---|---|---|
| AX roles/names/values | every interactive control has an accurate non-duplicated label | Open |
| Full history | 465+/1,146 items remain reachable; virtualization does not erase semantics | Open |
| CAT grid | row/column semantics, canonical row count, selected/editing/locked state | Open |
| Decision | question number, selection mode, options, preview, partial answer and errors announced | Open |
| Dynamic status | running/waiting/stopping/failure and save state use appropriate live regions without chatter | Open |

## Canonical product states

Capture at 480×600, 1024×700, 1280×820, and 1440×900 in light/dark where materially different:

- running, waiting, stopping, stopped, failed;
- empty and loading;
- pending Decision, 1/4 questions, single/multiple/freeform/preview, partial
  answer, elaborate, cancel, timeout and late 409;
- permission denied and rejected local credential;
- CAT unsaved draft, saving, saved, locked, and revision conflict;
- Specialist waiting/running/failed/completed and Artifact provenance;
- Review, QA, Delivery, Eval empty/running/failure/completed;
- Browser/Computer/Vision unavailable, permission onboarding, cancelled, and
  readback failure.

Inspector must show only the selected evidence, Artifact, constraint, Activity,
Decision, or Segment context. It must not duplicate Task metadata, Main Agent
identity, or the full reply already present in conversation.

## Pointer and control states

For every visible click target, verify hover, pointer, keyboard focus, pressed,
disabled, and activation feedback. Native HTML semantics are preferred. A
visual-only element must not become a parallel custom control.

## Safety and install

- Two distinct signed builds have an identical designated requirement.
- Default launch performs no Desktop access and requests no repeated Desktop
  permission.
- Explicit Project/Batch/Asset pickers remain the only source authority.
- Private update check remains opt-in and never installs without confirmation.
- `/Applications` and production data are untouched until all gates pass.
- Full build/typecheck/test/verify/RC/rollback checks are green.
