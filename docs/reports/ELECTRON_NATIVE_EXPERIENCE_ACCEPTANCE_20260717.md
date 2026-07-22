# Electron Native Experience Acceptance — 2026-07-17

## Scope

This report records the Electron evidence originally collected on the Native Experience branch and carried into the integrated repository.
The Electron client under `apps/desktop` is the only maintained macOS frontend. The
retired SwiftUI client is not a release, RC, or contract dependency. The managed runtime,
production data, customer source directories, and `/Applications/LinguistAgent.app` were
not changed by this acceptance pass.

The stress fixture is isolated at `data/electron-acceptance-config.json`, served by a
separate loopback runtime on port `8799`. The fixture contains no customer data and covers
2 projects, 1,040 and 10,000 CAT rows, 1,146+ activity entries, typed artifacts,
decisions, waiting/failed/stopped states, and the notification/keybindings/settings paths.

## UI matrix

Command:

```bash
LA_ACCEPTANCE_CONFIG="$PWD/data/electron-acceptance-config.json" \
LA_ACCEPTANCE_RUNTIME_URL=http://127.0.0.1:8799 \
node apps/desktop/scripts/electron-acceptance-ui.mjs \
  --out=/private/tmp/linguist-agent-electron-acceptance/ui-final-20260717
```

Evidence: `/private/tmp/linguist-agent-electron-acceptance/ui-final-20260717-v2/ui-matrix-1784295910813.json`.

- 8 renderer captures; fixture gaps: 0; UI gaps: 0.
- 1024×700 and 1440×900 renderer viewports, light/dark and Reduce Motion emulations have no persistent overflow or clipped controls.
- Decision interaction: 4 questions, radio/checkbox/freeform modes, one stable card, prior answers disabled but visible.
- Esc leaves an `awaiting_input` Run awaiting input; it does not stop the Run.
- CAT: 1,040 data rows plus header, full history scope retained, keyboard segment navigation, editor cancel, contextual Agent companion, no duplicated full conversation.
- Activity: complete 1,146+ history is reachable; no row-count cap or fixed visible row height is used.
- Inspector: focus enters the Inspector, keyboard resizing works, and focus returns to the trigger after close.
- Pipeline: Review, QA, Delivery, and Eval open as contextual professional workspaces without permanent duplicate tabs/history rails.
- Settings: model, runtime resources, Packages, notifications, and keybindings are reachable through the same Settings workspace.

The renderer harness cannot prove native application-menu accelerators, real outer
BrowserWindow sizing, macOS system appearance/Reduce Motion, or native titlebar screenshots
through CDP. The first two were additionally exercised against the signed package on this
machine: System Events resized the real window to exactly 1024×700 and 1440×900, and native
menu accelerators ⌘1/⌘2/⌘K/⌘⇧I/⌘N/⌘⇧B/⌘, reached Conversation, CAT, command palette,
Inspector (with a selected Artifact), New Project, Import Batch, and Settings. The
remaining system-appearance, VoiceOver, and native-chrome screenshot checks are still
manual gates and are not represented as automated passes.

## Performance

All retained samples use the harness protocol (3 warm-ups, 5 retained samples, no
cherry-picking). The CAT/activity scenarios retain every row and use variable-height
rendering. Evidence files are outside Git under `/private/tmp`.

### Interaction and CAT baseline

Evidence: `/private/tmp/linguist-agent-electron-acceptance/performance-electron-final-1784256711767.json`.

| Scenario | Average FPS p95 | p95 frame p95 | Hitch ratio p95 | Result |
|---|---:|---:|---:|---|
| Project switch | 60.27 | 18.7 ms | 0% | pass |
| Batch switch | 60.05 | 18.6 ms | 0% | pass |
| Task switch | 60.14 | 18.7 ms | 0% | pass |
| CAT 1,040 rows | 60.01 | 18.7 ms | 0% | pass |
| CAT 10,000 rows | 60.01 | 18.6 ms | 0% | pass |
| Inspector open | 60.32 | 18.6 ms | 0% | pass |

The CAT fixture reached both top and bottom. The 10,000-row run has no long tasks and
does not hide rows through pagination, truncation, or a fixed row-height shortcut.

### Activity history and benchmark-probe root cause

Evidence: `/private/tmp/linguist-agent-electron-acceptance/performance-virtualized-final-1784295835712.json`.

| Scenario | Average FPS p95 | p95 frame p95 | Hitch ratio p95 | Long tasks |
|---|---:|---:|---:|---:|
| Activity 465+ | 120.00 | 10.2 ms | 0.80% | 87 ms max |
| Activity 1,146+ | 120.00 | 10.3 ms | 0.81% | 0 |

Both retained scenarios pass the strict P3 frame gates on the measured host: average
FPS p95 ≥57, p95 frame ≤20 ms, hitch ratio <1%, and no ≥100 ms freeze. The single 87 ms
long task in the 465+ run is below the 100 ms freeze gate.

The earlier failing Activity trace was caused by the acceptance probe reading every
row's `getBoundingClientRect()` inside the animation loop. That forced an O(n) layout on
each sample and measured the probe instead of the product. The current renderer uses a
variable-height virtual list with content-derived estimates and real measurements. The
fixture still reports `completeHistoryItems: 1,148`, top/bottom reachability, and measured
heights `[52, 72, 87, 94]`; only roughly 35–36 rows are mounted at a time.
Search and filters continue to operate over the complete canonical array.

The first focused run was collected under severe host pressure and is retained only as
diagnostic evidence:
`/private/tmp/linguist-agent-electron-acceptance/current-post-fix/performance-current-post-fix-1784291531716.json`.
It retained all 1,148 items and variable heights, with no long tasks; Activity 465+
hitch-ratio p95 was 7.45%, Activity 1,146+ 4.22%, and cold-launch first-visible p95
1,780.9 ms while an unrelated `rc-status` process consumed more than two CPU cores.

The repeat on an idle host is:
`/private/tmp/linguist-agent-electron-acceptance/stable-host-post-dedupe/performance-stable-host-post-dedupe-1784293362014.json`.
Cold launch passed comfortably in that idle-host run (first-visible p95 521.2 ms, shell
p95 553.7 ms, content p95 730.7 ms). The display reported by macOS is 120 Hz even
though the fixture protocol is nominally 60 Hz. The trace showed one-time global
style/layout/commit work over ~18,250 DOM elements (UpdateLayoutTree 70 ms, Commit 230
ms, RunTask 317 ms) when the full history was first revealed. The current virtual list
removes that first-reveal cost without changing canonical data or visual row content.
No fixed row height, truncation, pagination, or history hiding was introduced.

### Cold launch

Evidence: `/private/tmp/linguist-agent-electron-acceptance/performance-virtualized-cold-1784295945354.json`.

The first run above was collected while another checkout was running the full root `npm
test` and `rc:gate` concurrently; macOS reported 4.9 GiB compressed memory and a load
average above 7, so it is diagnostic only. After that workload ended and the isolated
runtime was restarted, the clean-host retained run was:
`/private/tmp/linguist-agent-electron-acceptance/performance-virtualized-cold-idle-1784296410599.json`.
Its p95 was first visible 990 ms, shell interactive 1,022 ms, and content ready 1,344 ms;
the first two cold-launch gates pass. No benchmark threshold was relaxed and no content
was hidden to improve the number.

## Notifications and keybindings

- Notification preferences are server-owned at `data/settings/notifications.json`, with
  schema version, four categories (`waiting`, `failed`, `completed`, `permission`), and
  optimistic `updatedAt` conflict handling.
- Task events are projected into fixed, scope-carrying notification candidates. Only the
  validated candidate crosses the preload boundary; arbitrary Electron notification
  options, paths, and text are rejected by `src/notification-policy.mjs`.
- Current foreground Task stays quiet. After the runtime is ready, the renderer opens
  canonical snapshots and subscribes to the existing Task SSE stream for every active,
  awaiting-input, waiting, or stopping Task that is not selected. This keeps background
  notifications working across Project/Task switches without adding polling or a second
  event model. Terminal Run events are reconciled against a fresh canonical snapshot before
  an idle Task stream is released; a selected Task always remains on the foreground stream
  only.
- Candidate IDs are deduplicated across SSE reconnects; failed presentation is retried and
  the in-memory seen set is bounded. This prevents cursor replay from producing duplicate
  macOS alerts without inventing a second event store.
  macOS notification authorization remains a first-display system prompt.
- Pi keybindings are read from and written to the official global
  `~/.pi/agent/keybindings.json` contract. The Settings editor preserves unknown action
  ids, validates Pi key syntax, shows effective/default/user keys and conflicts, supports
  restore-default, and documents `/reload` for already-running Pi sessions.

Tests: `apps/desktop/tests/notification-policy.test.mjs`,
`apps/desktop/tests/notification-candidate.test.ts`,
`apps/desktop/tests/task-events.test.ts` (background Task SSE isolation),
`apps/desktop/tests/settings.test.ts`, `tests/notification_preferences.test.ts`, and
`tests/pi_keybindings.test.ts`.

## Release and Swift retirement

- `npm run mac:build`, `npm run mac:test`, and `npm run mac:verify` are Electron aliases.
- `scripts/mac-release.ts` builds `apps/desktop`, stages the managed runtime, creates a
  signed/notarized `.app`, zip, and dmg, writes checksums, and publishes GitHub Release
  artifacts. The selected Developer ID identity is explicitly inherited by the Electron
  packaging child process. Sparkle, appcast, Pages feeds, and Swift bundle assembly are
  removed from the release chain.
- CI beta/stable workflows now call the signed GitHub Release path directly.
- Tracked `apps/mac` SwiftUI sources/tests/docs are retired; the icon and local signing
  helper moved to `apps/desktop`. No managed runtime or installed app was replaced.

## Validation run

Passed:

```text
npm run typecheck
npm run mac:build
npm run mac:test
npm run mac:verify
npm test
npm run release:check
npm run rc:status
LA_MAC_CODESIGN_IDENTITY='Developer ID Application: Test' LA_NOTARY_KEYCHAIN_PROFILE=la-notary npm run release:mac -- --dry-run --allow-dirty --channel beta --release-tag beta-env-check
node_modules/.bin/tsx tests/mac_release.test.ts
npm run test:notifications
git diff --check
```

The complete root `npm test` passed in this worktree after the final renderer change. The
real native macOS appearance, Reduce Motion, VoiceOver, and native-chrome screenshot checks
still belong to the final release gate. Activity 465+/1,146+ and clean-host cold launch
pass the measured performance gates.

### Post-change focused regression

After the virtualized timeline and notification dedupe changes, `npm run mac:test`,
`npm run mac:build`, `npm run mac:verify`, `npm run release:check`, `npm run rc:status`,
`npm --prefix apps/desktop run verify:signing-stability` (designated requirement stable
across builds 900001 and 900002), the notification suite, desktop 114-test suite, 3-test
Activity producer suite, UI matrix (8 captures), and targeted `asset_api` test passed.
No managed runtime, production data, or installed `/Applications` bundle was changed by
this pass.
