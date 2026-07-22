# Electron acceptance baseline (superseded diagnostic)

Date: 2026-07-16. This is a historical fixture-readiness diagnostic, not the
current P3 baseline or a full performance pass. Current evidence is indexed in
`docs/reports/ELECTRON_NATIVE_EXPERIENCE_ACCEPTANCE_20260717.md` and
`docs/reports/ELECTRON_P3_MANUAL_PARTIAL_20260718.md`.

The checkout-local `native-entry-fixture` currently contains:

- 1 Project;
- 1 Batch with 5 complete segments;
- 1 Task with 1 base Activity, 1 Run, 0 Artifacts, and 0 Decisions in its
  persisted snapshot.

This data is sufficient to verify shell boot, one Project/Batch/Task path,
basic CAT rendering, window sizing, color media, keyboard semantics, and AX
tree capture. It is not sufficient for Project/Batch/Task switching,
Inspector content, 465/1,146 Activity, 1,040/10k CAT, 100 events at 5 Hz, or the
complete state matrix. Those gates remain **blocked by fixture evidence**.

That initial inventory did not synthesize rows or Activities to fill gaps.

## Isolated synthetic stress fixture

The canonical stress generator now creates a separate, explicitly marked
`containsCustomerData:false` fixture in the linked worktree's ignored `data/`:

- 2 synthetic Projects, 3 Batches, and 9 Tasks;
- 1,040 and 10,000 CAT rows with four natural text lengths;
- exactly 1,146 complete canonical Activities;
- 1 inspectable QA Artifact and 1 required single-select Decision;
- active, waiting, stopping, stopped, failed, and awaiting-input Runs;
- a separate active Task reserved for an external 100-event/5-Hz producer.

The generator is offline and makes no model call. It rejects the managed 8787
port, the primary repository, non-ignored ordinary checkouts, and any existing
workspace without its exact synthetic ownership marker. Project and Batch data
are synthetic; Task/Run/Activity/Artifact/Decision state is persisted through
the canonical TaskWorkspace writer.

Read-only preflight against isolated runtime port 8799 reported **zero fixture
gaps**. Machine-local evidence is at
`/private/tmp/linguist-agent-electron-acceptance/stress-fixture-final/preflight-1784199161525.json`.
This proves scenario availability, not frame-rate acceptance; retained stress
measurements still need to run against the release package.

The first Electron five-run measurement was intended to become the `before`
baseline. No comparison should be inferred from this diagnostic, and no
historical non-Electron trace should be relabeled as Electron evidence.

## Initial cold-launch diagnostic

The signed checkout-local app (`40713f6e…`) was launched against isolated port
8799 with three warm-ups followed by five retained runs. The operator supplied
60 Hz but did not independently verify the display setting, so this collection
is diagnostic rather than a fixed-60-Hz acceptance pass.

| Metric | Median | p95 |
|---|---:|---:|
| First visible renderer | 443.903 ms | 456.263 ms |
| Shell interactive | 448.183 ms | 460.849 ms |
| Isolated fixture content ready | 500.487 ms | 512.657 ms |

Peak retained renderer heap was 2,645,472 bytes; peak complete Electron process
tree RSS was 461,176,832 bytes. These numbers describe the current 5-row/1-
Activity fixture only. They do not validate heavy Task or CAT hydration.

Raw evidence remains machine-local at
`/private/tmp/linguist-agent-electron-acceptance/current/performance-initial-diagnostic-1784197734891.json`.

## Automated renderer/AX diagnostic

Eight captures covered 1024×700 and 1440×900 renderer viewports, light/dark,
and normal/Reduce Motion media. Every capture reported zero document overflow
and zero clipped visible controls. The Reduce Motion captures reported zero
material animations or transitions longer than 16 ms. The saved AX trees had
74 non-ignored nodes at the narrow viewport and 116 at the standard viewport;
both forward and reverse captured focus loops had 9 and 14 unique stops
respectively. Escape left the pending Run status unchanged.

This does not close the real-window, native menu accelerator, hover/pressed,
or keyboard/focus gates. CDP cannot exercise Electron's native application menu, so
⌘1/⌘2 remain manual. Raw screenshots, AX trees, and JSON remain at
`/private/tmp/linguist-agent-electron-acceptance/current/ui-final/`.
