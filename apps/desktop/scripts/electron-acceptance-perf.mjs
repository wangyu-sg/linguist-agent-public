import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_APP_PATH } from "./packaging-config.mjs";
import {
  RETAINED_RUNS,
  WARMUP_RUNS,
  assertIsolatedRuntimeURL,
  environmentReport,
  evaluate,
  frameSummary,
  inspectFixture,
  launchAcceptanceApp,
  loadAcceptanceConfig,
  parseArguments,
  processTreeMemory,
  rendererMemory,
  resolveCredential,
  runtimeJSON,
  summarize,
  waitForExpression,
  writeAcceptanceHandshake,
} from "./electron-acceptance-lib.mjs";

const options = parseArguments(process.argv.slice(2));
const config = await loadAcceptanceConfig(options.configPath);
const runtimeURL = assertIsolatedRuntimeURL(process.env.LA_ACCEPTANCE_RUNTIME_URL ?? config.runtimeURL ?? "");
const credential = await resolveCredential();
const appPath = config.appPath ?? DEFAULT_APP_PATH;
const displayHz = Number(process.env.LA_ACCEPTANCE_DISPLAY_HZ ?? config.displayHz ?? 0);
if (!Number.isFinite(displayHz) || displayHz <= 0) throw new Error("Set the measured display refresh rate with LA_ACCEPTANCE_DISPLAY_HZ.");
const fixture = await inspectFixture(config, runtimeURL, credential);
if (fixture.gaps.length && !options.allowGaps) {
  console.error(fixture.gaps.join("\n"));
  process.exit(2);
}

const selected = new Set(options.only ?? [
  "cold-launch",
  "project-switch",
  "batch-switch",
  "task-switch",
  "activity-465",
  "activity-1146",
  "cat-1040",
  "cat-10000",
  "inspector",
]);
if (selected.has("activity-append") && (!options.activityRunToken || !options.activityHandshake)) {
  throw new Error("activity-append requires the producer orchestrator handshake.");
}
const report = {
  schemaVersion: 1,
  kind: "electron-acceptance-performance",
  label: options.label ?? "baseline",
  protocol: { warmups: WARMUP_RUNS, retained: RETAINED_RUNS, noCherryPicking: true },
  environment: await environmentReport(appPath, displayHz),
  fixture: { health: fixture.health, inventory: fixture.inventory, gaps: fixture.gaps },
  scenarios: {},
};

const scenarioReady = (name) => !fixture.gaps.some((gap) => gap.startsWith(`${name}:`));
const sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
const treeKey = (kind, ...parts) => `${kind}:${parts.join(":")}`;

async function measureMemory(app) {
  return {
    renderer: await rendererMemory(app.client),
    app: await processTreeMemory(app.child.pid),
  };
}

function interactionExpression({ key, selector, ready, timeoutMs = 15_000, settleMs = 350 }) {
  const target = key
    ? `Array.from(document.querySelectorAll('[data-tree-key]')).find((node) => node.dataset.treeKey === ${JSON.stringify(key)})`
    : `document.querySelector(${JSON.stringify(selector)})`;
  return `(async () => {
    const target = ${target};
    if (!(target instanceof HTMLElement)) throw new Error('Acceptance target is not available');
    const frames = [];
    const longTasks = [];
    const supported = PerformanceObserver.supportedEntryTypes.includes('longtask');
    const observer = supported ? new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTasks.push({ startTime: entry.startTime, duration: entry.duration });
    }) : null;
    observer?.observe({ type: 'longtask', buffered: false });
    let tracking = true;
    requestAnimationFrame(function tick(time) {
      if (!tracking) return;
      frames.push(time);
      requestAnimationFrame(tick);
    });
    const start = performance.now();
    target.click();
    let feedbackAt = null;
    let stableFrames = 0;
    await new Promise((resolve, reject) => {
      const deadline = start + ${timeoutMs};
      function poll(time) {
        const ready = Boolean(${ready});
        if (ready) {
          feedbackAt ??= time;
          stableFrames += 1;
          if (stableFrames >= 2) return resolve();
        } else stableFrames = 0;
        if (time >= deadline) return reject(new Error('Acceptance action timed out'));
        requestAnimationFrame(poll);
      }
      requestAnimationFrame(poll);
    });
    const readyAt = performance.now();
    await new Promise((resolve) => setTimeout(resolve, ${settleMs}));
    tracking = false;
    observer?.disconnect();
    return {
      visualFeedbackMs: feedbackAt - start,
      contentReadyMs: readyAt - start,
      frames,
      longTaskSupported: supported,
      longTasks,
    };
  })()`;
}

async function measuredInteraction(app, input) {
  const value = await evaluate(app.client, interactionExpression(input));
  return {
    visualFeedbackMs: value.visualFeedbackMs,
    contentReadyMs: value.contentReadyMs,
    frames: frameSummary(value.frames, displayHz),
    longTaskSupported: value.longTaskSupported,
    longTasks: value.longTasks,
    memory: await measureMemory(app),
  };
}

async function clickTree(app, key, ready) {
  await evaluate(app.client, interactionExpression({ key, ready, settleMs: 50 }));
}

async function ensureExpanded(app, key) {
  await waitForExpression(app.client, `Array.from(document.querySelectorAll('[data-tree-key]')).some((node) => node.dataset.treeKey === ${JSON.stringify(key)})`);
  const expanded = await evaluate(app.client, `Array.from(document.querySelectorAll('[data-tree-key]')).find((node) => node.dataset.treeKey === ${JSON.stringify(key)})?.getAttribute('aria-expanded')`);
  if (expanded === "false") {
    await evaluate(app.client, `Array.from(document.querySelectorAll('[data-tree-key]')).find((node) => node.dataset.treeKey === ${JSON.stringify(key)})?.click()`);
    await waitForExpression(app.client, `Array.from(document.querySelectorAll('[data-tree-key]')).find((node) => node.dataset.treeKey === ${JSON.stringify(key)})?.getAttribute('aria-expanded') === 'true'`);
  }
}

async function openTaskPath(app, input) {
  const project = treeKey("project", input.projectId);
  const batch = treeKey("batch", input.projectId, input.batchId);
  await ensureExpanded(app, project);
  await waitForExpression(app.client, `Array.from(document.querySelectorAll('[data-tree-key]')).some((node) => node.dataset.treeKey === ${JSON.stringify(batch)})`);
  const selectedBatch = await evaluate(app.client, `Array.from(document.querySelectorAll('[data-tree-key]')).find((node) => node.dataset.treeKey === ${JSON.stringify(batch)})?.getAttribute('aria-current')`);
  if (selectedBatch !== "page") await clickTree(app, batch, `target.getAttribute('aria-current') === 'page'`);
  await ensureExpanded(app, batch);
  const task = treeKey("task", input.taskId);
  await waitForExpression(app.client, `Array.from(document.querySelectorAll('[data-tree-key]')).some((node) => node.dataset.treeKey === ${JSON.stringify(task)})`);
  const selectedTask = await evaluate(app.client, `Array.from(document.querySelectorAll('[data-tree-key]')).find((node) => node.dataset.treeKey === ${JSON.stringify(task)})?.getAttribute('aria-current')`);
  if (selectedTask !== "page") await clickTree(app, task, `target.getAttribute('aria-current') === 'page' && document.querySelector('.task-conversation:not(.task-conversation--state)')`);
}

async function retainedRuns(action) {
  const retained = [];
  for (let index = 0; index < WARMUP_RUNS + RETAINED_RUNS; index += 1) {
    const sample = await action(index);
    if (index >= WARMUP_RUNS) retained.push(sample);
  }
  return retained;
}

function interactionSummary(samples) {
  return {
    visualFeedbackMs: summarize(samples.map((sample) => sample.visualFeedbackMs)),
    contentReadyMs: summarize(samples.map((sample) => sample.contentReadyMs)),
    averageFps: summarize(samples.map((sample) => sample.frames.averageFps).filter(Number.isFinite)),
    p95FrameMs: summarize(samples.map((sample) => sample.frames.p95FrameMs).filter(Number.isFinite)),
    maxFrameMs: summarize(samples.map((sample) => sample.frames.maxFrameMs).filter(Number.isFinite)),
    hitchRatio: summarize(samples.map((sample) => sample.frames.hitchRatio).filter(Number.isFinite)),
    longTaskMs: summarize(samples.flatMap((sample) => sample.longTasks.map((task) => task.duration))),
    peakRendererHeapBytes: Math.max(...samples.map((sample) => sample.memory.renderer.jsHeapUsedBytes ?? 0)),
    peakAppRSSBytes: Math.max(...samples.map((sample) => sample.memory.app.rssBytes ?? 0)),
  };
}

async function measureScroll(app, selector, itemSelector, durationMs) {
  const value = await evaluate(app.client, `(async () => {
    const scroller = document.querySelector(${JSON.stringify(selector)});
    if (!(scroller instanceof HTMLElement)) throw new Error('Acceptance scroller is unavailable');
    const frames = [];
    const longTasks = [];
    const heights = new Set();
    const supported = PerformanceObserver.supportedEntryTypes.includes('longtask');
    const observer = supported ? new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTasks.push({ startTime: entry.startTime, duration: entry.duration });
    }) : null;
    observer?.observe({ type: 'longtask', buffered: false });
    const sampleItemHeights = () => {
      for (const item of document.querySelectorAll(${JSON.stringify(itemSelector)})) {
        heights.add(Math.round(item.getBoundingClientRect().height));
      }
    };
    // Measure row-height diversity outside the animation-critical sweep. Reading
    // every row's rect inside rAF would force a full-list layout on every tenth
    // frame and make the benchmark measure its own probe instead of scrolling.
    sampleItemHeights();
    const sweep = async (from, to) => {
      const start = performance.now();
      await new Promise((resolve) => {
        function frame(time) {
          frames.push(time);
          const progress = Math.min(1, (time - start) / ${durationMs});
          scroller.scrollTop = from + (to - from) * progress;
          if (progress >= 1) resolve(); else requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
      });
    };
    const bottom = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    await sweep(0, bottom);
    const reachedBottom = Math.abs(scroller.scrollTop - bottom) <= 2;
    await sweep(bottom, 0);
    const reachedTop = scroller.scrollTop <= 2;
    sampleItemHeights();
    observer?.disconnect();
    return {
      frames,
      longTaskSupported: supported,
      longTasks,
      reachedBottom,
      reachedTop,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
      measuredItemHeights: Array.from(heights).sort((a, b) => a - b),
      ariaRowCount: document.querySelector('[role=grid]')?.getAttribute('aria-rowcount') ?? null,
      mountedTimelineItems: document.querySelectorAll('.task-conversation__item').length,
      completeHistoryItems: Number(document.querySelector('.task-conversation__timeline')?.dataset.completeHistoryCount ?? 0),
    };
  })()`);
  return {
    ...value,
    frames: frameSummary(value.frames, displayHz),
    memory: await measureMemory(app),
  };
}

async function withApp(runScenario) {
  const app = await launchAcceptanceApp({ appPath, runtimeURL, credential });
  try { return await runScenario(app); } finally { await app.close(); }
}

if (selected.has("cold-launch")) {
  const samples = await retainedRuns(async () => {
    const app = await launchAcceptanceApp({ appPath, runtimeURL, credential });
    try {
      return { ...app.milestones, memory: await measureMemory(app) };
    } finally {
      await app.close();
      await sleep(250);
    }
  });
  report.scenarios.coldLaunch = {
    samples,
    summary: {
      firstVisibleMs: summarize(samples.map((sample) => sample.firstVisibleMs)),
      shellInteractiveMs: summarize(samples.map((sample) => sample.shellInteractiveMs)),
      contentReadyMs: summarize(samples.map((sample) => sample.contentReadyMs)),
      peakRendererHeapBytes: Math.max(...samples.map((sample) => sample.memory.renderer.jsHeapUsedBytes ?? 0)),
      peakAppRSSBytes: Math.max(...samples.map((sample) => sample.memory.app.rssBytes ?? 0)),
    },
  };
}

if (selected.has("project-switch") && scenarioReady("projectSwitch")) {
  const input = config.scenarios.projectSwitch;
  report.scenarios.projectSwitch = await withApp(async (app) => {
    const samples = await retainedRuns((index) => {
      const id = index % 2 ? input.fromProjectId : input.toProjectId;
      return measuredInteraction(app, {
        key: treeKey("project", id),
        ready: "target.getAttribute('aria-current') === 'page' && !document.querySelector('[aria-busy=true]')",
      });
    });
    return { samples, summary: interactionSummary(samples) };
  });
}

if (selected.has("batch-switch") && scenarioReady("batchSwitch")) {
  const input = config.scenarios.batchSwitch;
  report.scenarios.batchSwitch = await withApp(async (app) => {
    await ensureExpanded(app, treeKey("project", input.projectId));
    const samples = await retainedRuns((index) => {
      const id = index % 2 ? input.fromBatchId : input.toBatchId;
      return measuredInteraction(app, {
        key: treeKey("batch", input.projectId, id),
        ready: "target.getAttribute('aria-current') === 'page' && !document.querySelector('[aria-busy=true]')",
      });
    });
    return { samples, summary: interactionSummary(samples) };
  });
}

if (selected.has("task-switch") && scenarioReady("taskSwitch")) {
  const input = config.scenarios.taskSwitch;
  report.scenarios.taskSwitch = await withApp(async (app) => {
    await openTaskPath(app, { projectId: input.projectId, batchId: input.fromBatchId, taskId: input.fromTaskId });
    await openTaskPath(app, { projectId: input.projectId, batchId: input.toBatchId, taskId: input.toTaskId });
    const samples = await retainedRuns((index) => {
      const id = index % 2 ? input.fromTaskId : input.toTaskId;
      return measuredInteraction(app, {
        key: treeKey("task", id),
        ready: "target.getAttribute('aria-current') === 'page' && document.querySelector('.task-conversation:not(.task-conversation--state)')",
      });
    });
    return { samples, summary: interactionSummary(samples) };
  });
}

for (const [flag, scenarioName, selector, itemSelector] of [
  ["activity-465", "activity465", ".task-conversation__scroller", ".task-conversation__item"],
  ["activity-1146", "activity1146", ".task-conversation__scroller", ".task-conversation__item"],
  ["cat-1040", "cat1040", ".cat-grid-scroll", ".cat-segment-row"],
  ["cat-10000", "cat10000", ".cat-grid-scroll", ".cat-segment-row"],
]) {
  if (!selected.has(flag) || !scenarioReady(scenarioName)) continue;
  const input = config.scenarios[scenarioName];
  report.scenarios[scenarioName] = await withApp(async (app) => {
    await openTaskPath(app, input);
    if (scenarioName.startsWith("cat")) {
      await evaluate(app.client, `document.querySelector('.product-toolbar__views button[aria-label="打开 CAT"]')?.click()`);
      await waitForExpression(app.client, "document.querySelector('.cat-grid-scroll')");
    }
    const samples = await retainedRuns(() => measureScroll(app, selector, itemSelector, input.sweepDurationMs ?? 6_000));
    return {
      samples,
      summary: {
        averageFps: summarize(samples.map((sample) => sample.frames.averageFps).filter(Number.isFinite)),
        p95FrameMs: summarize(samples.map((sample) => sample.frames.p95FrameMs).filter(Number.isFinite)),
        maxFrameMs: summarize(samples.map((sample) => sample.frames.maxFrameMs).filter(Number.isFinite)),
        hitchRatio: summarize(samples.map((sample) => sample.frames.hitchRatio).filter(Number.isFinite)),
        longTaskMs: summarize(samples.flatMap((sample) => sample.longTasks.map((task) => task.duration))),
        peakRendererHeapBytes: Math.max(...samples.map((sample) => sample.memory.renderer.jsHeapUsedBytes ?? 0)),
        peakAppRSSBytes: Math.max(...samples.map((sample) => sample.memory.app.rssBytes ?? 0)),
      },
    };
  });
}

if (selected.has("inspector") && scenarioReady("inspector")) {
  const input = config.scenarios.inspector;
  report.scenarios.inspector = await withApp(async (app) => {
    await openTaskPath(app, input);
    const samples = await retainedRuns(async () => {
      const open = await measuredInteraction(app, {
        selector: ".conversation-artifact button, .conversation-activity__inspect",
        ready: "document.querySelector('.context-inspector')",
      });
      const close = await measuredInteraction(app, {
        selector: ".context-inspector [aria-label='关闭上下文检查器']",
        ready: "document.querySelector('.product-inspector-pane')?.getAttribute('data-open') === 'false'",
      });
      return { open, close };
    });
    return {
      samples,
      summary: {
        open: interactionSummary(samples.map((sample) => sample.open)),
        close: interactionSummary(samples.map((sample) => sample.close)),
      },
    };
  });
}

if (selected.has("activity-append") && scenarioReady("activityAppend")) {
  const input = config.scenarios.activityAppend;
  report.scenarios.activityAppend = await withApp(async (app) => {
    await openTaskPath(app, input);
    const prefix = `activity-electron-acceptance-live-${options.activityRunToken}-`;
    const observerKey = "__laElectronActivityAppendObserver";
    const registered = await evaluate(app.client, `(() => {
      const timeline = document.querySelector('.task-conversation__timeline');
      if (!(timeline instanceof HTMLElement)) throw new Error('Activity timeline is unavailable');
      globalThis[${JSON.stringify(observerKey)}]?.observer?.disconnect();
      const seen = new Map();
      const prefix = ${JSON.stringify(prefix)};
      const capture = () => {
        for (const node of document.querySelectorAll('[id^=activity-]')) {
          if (node.id.startsWith(prefix) && !seen.has(node.id)) seen.set(node.id, Date.now());
        }
      };
      const observer = new MutationObserver(capture);
      observer.observe(timeline, { childList: true, subtree: true });
      globalThis[${JSON.stringify(observerKey)}] = { observer, seen, startedAt: Date.now() };
      return true;
    })()`);
    if (!registered) throw new Error("Activity observer was not registered.");
    await writeAcceptanceHandshake(options.activityHandshake, {
      schemaVersion: 1,
      state: "observer_ready",
      runToken: options.activityRunToken,
      expectedEvents: input.expectedEvents,
      expectedHz: input.expectedHz,
      createdAt: new Date().toISOString(),
    });
    const deadline = Date.now() + (input.timeoutMs ?? 30_000);
    let visibleEvents = 0;
    while (visibleEvents < input.expectedEvents && Date.now() < deadline) {
      await sleep(20);
      visibleEvents = await evaluate(app.client, `globalThis[${JSON.stringify(observerKey)}]?.seen?.size ?? 0`);
    }
    const value = await evaluate(app.client, `(() => {
      const state = globalThis[${JSON.stringify(observerKey)}];
      if (!state) throw new Error('Activity observer state is unavailable');
      state.observer.disconnect();
      delete globalThis[${JSON.stringify(observerKey)}];
      return {
        startedAt: state.startedAt,
        visibleEvents: state.seen.size,
        visible: Array.from(state.seen, ([id, visibleAt]) => ({ id, visibleAt })),
        timedOut: state.seen.size < ${input.expectedEvents},
      };
    })()`);
    const snapshot = await runtimeJSON(runtimeURL, credential, `/api/projects/${encodeURIComponent(input.projectId)}/tasks/${encodeURIComponent(input.taskId)}`);
    const canonical = (snapshot.activities ?? []).filter((activity) => `activity-${activity.id}`.startsWith(prefix));
    const activities = new Map(canonical.map((activity) => [`activity-${activity.id}`, activity]));
    const visibility = value.visible.map((entry) => {
      const activity = activities.get(entry.id);
      return {
        id: activity ? "recorded" : "missing-canonical-event",
        latencyMs: activity ? entry.visibleAt - Date.parse(activity.createdAt) : null,
        seq: activity?.seq ?? null,
      };
    });
    const seqs = visibility.map((entry) => entry.seq).filter(Number.isFinite);
    return {
      startedAt: value.startedAt,
      visibleEvents: value.visibleEvents,
      canonicalEvents: canonical.length,
      timedOut: value.timedOut,
      visibility,
      latencyMs: summarize(visibility.map((entry) => entry.latencyMs).filter(Number.isFinite)),
      zeroLoss: visibility.length === input.expectedEvents
        && canonical.length === input.expectedEvents
        && visibility.every((entry) => entry.id === "recorded"),
      ordered: seqs.length === input.expectedEvents && seqs.every((seq, index) => index === 0 || seq > seqs[index - 1]),
      memory: await measureMemory(app),
    };
  });
}

const outputDirectory = options.outputDirectory ?? "/private/tmp/linguist-agent-electron-acceptance";
await mkdir(outputDirectory, { recursive: true });
const outputPath = join(outputDirectory, `performance-${report.label}-${Date.now()}.json`);
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, scenarios: Object.keys(report.scenarios), gaps: report.fixture.gaps }, null, 2));
