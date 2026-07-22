# Electron P3 manual acceptance — partial evidence — 2026-07-18

## Scope and safety boundary

This is a partial real-machine record for `main` at `05cf262e`. The signed Electron
package was built and verified locally as build `686` with `npm run mac:verify`. The
live UI pass used the synthetic `electron-acceptance-stress` fixture and an isolated
loopback runtime on port `8799` in the integration worktree. The fixture declared no
customer data. The managed runtime on `8787`, production data, customer source
directories, and `/Applications/LinguistAgent.app` were not changed.

Raw screenshots and protocol JSON remain outside Git under the local acceptance temp
directory. This report records only the evidence and the gates it cannot close.

## Direct evidence collected

- The packaged app opened as a real macOS BrowserWindow with native titlebar and menu
  chrome. A resize attempt produced a `1024×701` outer capture; the exact `1024×700`
  and `1440×900` outer-size pair was not attainable on the current display and is
  therefore still open.
- The live isolated fixture exposed both projects, the `10,000`-row and `1,040`-row
  batches, and Tasks in `awaiting_input`, `running`, `waiting`, `stopping`, `stopped`,
  and `failed` states. The failed view showed the typed failure message; the stopped
  view showed the terminal stopped Run; the stopping view retained the draft composer;
  waiting and awaiting-input views exposed their canonical Run/Decision surfaces.
- Real `⌘K` opened the command palette and Escape returned focus. Native menu inspection
  exposed project/command search, sidebar and Inspector toggles, appearance choices,
  and full-screen. This does not prove OS-level accelerator dispatch; the acceptance
  harness correctly keeps that as a manual item.
- App-level dark appearance was selected from the native menu and restored to light;
  the resulting dark window, CAT/conversation surface, sidebar, and waiting Run were
  visible. The macOS system remained Light (`AppleInterfaceStyle=Light`); system dark
  and actual Reduce Motion variation were not run.
- Keyboard traversal reached the task list, Settings, task menu, Conversation/CAT
  tabs, Assets, Run disclosure, composer controls, sidebar controls, and filters.
- `⌘2` opened the real CAT surface. With the `10,000`-row batch loaded, the table
  reported `10,000 / 10,000` saved rows. Selecting the first row and pressing End
  reached rows `9993`–`10000`, including row `10000`, with the Inspector visible.
  This proves keyboard bottom reachability for the variable-height CAT dataset; it
  does not prove real wheel/trackpad scrolling or editor commit/cancel coverage.
- The repository UI matrix completed with `fixtureGaps=[]` and `uiGaps=[]` across its
  eight renderer captures. It remains supporting evidence because its viewport and
  motion checks are Chromium/CDP emulation.

## Gates deliberately left open

- Exact real outer `1024×700` and `1440×900` captures, including native titlebar and
  control clipping checks.
- System-level light/dark variation and actual macOS Reduce Motion behavior.
- VoiceOver labels, order, state/value announcements, and duplicate-announcement
  checks. VoiceOver was not started during this pass.
- OS-level menu accelerator dispatch, real wheel/trackpad traversal through long
  Activity history, CAT editor open/cancel/commit, and complete failure-recovery
  interaction.
- Two clean signed builds with stable designated requirements, plus real Developer ID
  notarization/publish authority.

This report is evidence for the open checklist in `design-qa.md`; it does not mark any
P3 checkbox complete. The fixed-seed 60-row blind Eval and its human A/B/C judgments
also remain a separate open product gate.
