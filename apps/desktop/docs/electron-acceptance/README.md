# Electron performance and acceptance runbook

This harness measures the signed package in `apps/desktop/out`; it never opens
the installed `/Applications` client. It accepts only a loopback runtime on a
port other than `8787`, performs only authenticated reads, and writes raw
reports to `/private/tmp/linguist-agent-electron-acceptance` by default.

## Fixed protocol

- Release renderer and signed arm64 package.
- AC power, 1440×900, fixed 60 Hz, no other foreground work.
- Same app SHA, Git commit, isolated runtime instance, fixture, and display.
- Three complete warm-ups followed by five retained runs. p95 is nearest rank,
  therefore the slowest retained value for five samples. No rejected or
  cherry-picked samples.
- IDs are hashed in reports. No text, source path, credential, or customer data
  is recorded.
- Full Activity and CAT collections remain available. The harness does not
  truncate, paginate, hide history, or impose fixed row heights.

## Prepare the isolated runtime

Start a checkout-local runtime with its own data root and a non-production
port. Do not point this harness at the resident runtime or production data.
For a deterministic zero-customer-data fixture, run the generator through the
repository's pinned `tsx`. It accepts only `/tmp` or a linked worktree whose
`data/` is ignored, refuses port 8787 and the primary repository, and only
replaces workspaces carrying its own `containsCustomerData:false` marker.
It calls no model and does not read or copy production data.

```bash
cd /path/to/linguist-agent
node_modules/.bin/tsx apps/desktop/scripts/electron-acceptance-fixture.ts \
  --repo-root "$PWD" \
  --runtime-url http://127.0.0.1:8799 \
  --replace
export LA_ACCEPTANCE_CONFIG="$PWD/data/electron-acceptance-config.json"
```

Start that isolated runtime with the pinned helper so the verified
native-capability `agentDir` is prepared and passed to the server. The helper
uses a non-production port and checkout-local data; it does not add an
application route or write to the resident runtime.

```bash
npm --prefix apps/desktop run runtime:acceptance -- --port=8799
```

The generator creates two Projects, three Batches, nine Tasks, 1,040 and
10,000 naturally variable-length CAT rows, 1,146 canonical Activities, an
inspectable Artifact/Decision pair, and canonical active/waiting/stopping/
stopped/failed Runs. Task events are written only through
`createTaskWorkspace().create/appendGenerated`; snapshots and event cursors
are not hand-authored. The live 100-event sequence remains external by design.

Alternatively, copy `fixture.template.json` outside Git and replace IDs with a
separately approved sanitized fixture. Keep the token in Keychain or
`LA_LOCAL_API_TOKEN`, never in JSON.

```bash
cd /path/to/linguist-agent/apps/desktop
export LA_ACCEPTANCE_CONFIG=/private/tmp/la-electron-fixture.json
export LA_ACCEPTANCE_RUNTIME_URL=http://127.0.0.1:8799
export LA_ACCEPTANCE_DISPLAY_HZ=60
# Set only after System Settings / display hardware confirms 60 Hz:
export LA_ACCEPTANCE_DISPLAY_VERIFIED=1

node scripts/electron-acceptance-preflight.mjs
node scripts/electron-acceptance-perf.mjs --label=before
node scripts/electron-acceptance-ui.mjs
```

The regular performance command measures every scenario except the live
Activity append. Run that scenario with the single orchestrated command below
from the repository root. It creates a unique run token and `/private/tmp`
handshake, starts the renderer observer, waits for its exact ready record, then
asks the already-running isolated runtime to append the sequence. There is no
background-shell timing race.

```bash
node_modules/.bin/tsx apps/desktop/scripts/electron-acceptance-activity.ts \
  --repo-root "$PWD" \
  --label=before-activity-append
```

The command emits one JSON line with `state:"producer_ready"`, then one with
`state:"producer_complete"` and the raw performance report path. The run token
is hashed in stdout. A missing observer handshake, reused token, wrong fixture,
runtime mismatch, non-100 count, non-5 Hz cadence, HTTP failure, or incomplete
canonical sequence fails the command.

`--allow-gaps` is diagnostic only: it records unavailable scenarios and runs
the usable subset. A release gate must run without it. Use `--only=` to repeat
a focused scenario, for example:

```bash
node scripts/electron-acceptance-perf.mjs \
  --only=cold-launch,cat-10000 \
  --label=after
```

The 5 Hz Activity producer is deliberately external to the renderer. The
desktop acceptance script calls `createTaskWorkspace().appendGenerated()` once
for each of 100 canonical Activities in the owned synthetic fixture, with the
write-time timestamp and one unique ID per round. The renderer harness only
observes the Task SSE; it cannot append authoritative events or make a second
Activity truth. No snapshot or event JSON is edited directly.

## Metrics and gates

| Scenario | Evidence | Gate |
|---|---|---|
| Cold launch | visible renderer, shell, content, renderer heap, app-tree RSS | visible p95 ≤1.0s; shell p95 ≤1.5s; runtime check off critical path |
| Project/Batch/Task switch | click→first stable visual state, click→content, long task, frame cadence, memory | feedback ≤100ms; content p95 ≤300ms; no ≥100ms freeze |
| 465/1,146 Activity | complete DOM history, full top↔bottom sweep | average ≥57fps; p95 frame ≤20ms; hitches <1%; no ≥100ms freeze |
| 1,040/10k CAT | canonical count, `aria-rowcount`, top↔bottom sweep, measured row heights | same frame gates; end rows reachable; variable heights retained |
| Inspector | open and close to two stable frames | ≤100ms |
| 100 events at 5 Hz | canonical Activity timestamp→visible DOM item, seq | p95 ≤100ms; zero loss; strict order |

`PerformanceObserver(longtask)`, `requestAnimationFrame`, Chrome renderer heap,
DOM counters, and complete Electron process-tree RSS are collected together.
If `longtask` is unavailable or the display is not verified at 60 Hz, the
report is diagnostic and cannot pass the frame gate.

The CAT stress fixture must contain at least two naturally different wrapped
row heights. A single measured height cannot prove variable-height behavior and
does not pass, even if frame cadence is fast.

## Output and comparison

Raw JSON, renderer screenshots, and AX trees stay under `/private/tmp` and are
not committed. Retain the exact `before` and `after` files, compare the five
sample arrays rather than only medians, and summarize accepted measurements in
the tracked final report. A slower corrected repeat replaces an earlier fast
but invalid collection; never select the better-looking run.
