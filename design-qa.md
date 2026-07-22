# Electron design QA

This file tracks only evidence still needed for release-level P3 acceptance. Automated renderer checks and source inspection do not close manual macOS, accessibility, or human-perception gates.

Current automated/supporting evidence is in `docs/reports/ELECTRON_NATIVE_EXPERIENCE_ACCEPTANCE_20260717.md`,
the partial real-machine record in `docs/reports/ELECTRON_P3_MANUAL_PARTIAL_20260718.md`,
and `apps/desktop/docs/electron-acceptance/`.

## Required real-machine matrix

Run the packaged, correctly signed Electron app against an isolated acceptance runtime. Do not replace `/Applications` or point it at production data merely to collect evidence.

### Window and appearance

- [ ] Capture real outer BrowserWindow at 480×600, 1024×700, the default 1280×820, and 1440×900.
- [ ] Verify light and dark system appearance, including native titlebar/menu contrast.
- [ ] Verify actual macOS Reduce Motion behavior, not DevTools emulation.
- [ ] Confirm no clipped primary controls, invisible focus, or unreachable Inspector at any size.

### Keyboard and VoiceOver

- [ ] Traverse sidebar, Conversation/CAT switch, composer, process, Inspector, artifacts/decisions, CAT grid/editor, pipelines, and Settings without a pointer.
- [ ] Confirm Escape semantics, modal focus traps, Inspector focus return, and menu accelerators.
- [ ] Run VoiceOver through the same path; verify labels, order, state/value announcements, and no duplicate transcript/activity announcements.

### Lifecycle states

- [ ] Capture and operate real `running`, `awaiting_input`, `waiting`, `stopping`, `stopped`, and `failed` Tasks.
- [ ] Verify Stop stays available while legal, late events cannot reactivate terminal state, and recovery text/actions are actionable.
- [ ] Verify permission and Decision interactions preserve prior answers and do not silently dismiss required input.

### Long-work performance

- [ ] Use real wheel and trackpad gestures through the full variable-height Activity history; prove top/bottom reachability and stable selection/focus.
- [ ] Exercise 10,000 variable-height CAT rows with keyboard selection, editor open/cancel/commit, and Inspector interaction.
- [ ] Repeat cold launch and Project/Batch/Task switching on an idle machine; retain the complete protocol output rather than cherry-picked samples.

### Packaging identity

- [ ] Produce two clean signed builds and compare their designated requirements.
- [ ] Validate the packaged app, zip, and dmg with the release verifier; test failure recovery without installing over the user's current app.

## Acceptance rule

Close an item only with direct real-machine evidence and the exact build/runtime scope recorded. Source grep, unit tests, Chromium viewport/media emulation, and synthetic keyboard events are useful regression checks but cannot close this matrix.
