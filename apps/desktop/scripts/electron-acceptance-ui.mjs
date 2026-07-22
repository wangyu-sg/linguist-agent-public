import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_APP_PATH } from "./packaging-config.mjs";
import {
  assertIsolatedRuntimeURL,
  evaluate,
  inspectFixture,
  launchAcceptanceApp,
  loadAcceptanceConfig,
  parseArguments,
  resolveCredential,
  runtimeJSON,
  waitForExpression,
} from "./electron-acceptance-lib.mjs";

const options = parseArguments(process.argv.slice(2));
const config = await loadAcceptanceConfig(options.configPath);
const runtimeURL = assertIsolatedRuntimeURL(process.env.LA_ACCEPTANCE_RUNTIME_URL ?? config.runtimeURL ?? "");
const credential = await resolveCredential();
const appPath = config.appPath ?? DEFAULT_APP_PATH;
const fixture = await inspectFixture(config, runtimeURL, credential);
if (!config.uiTask && !options.allowGaps) throw new Error("uiTask is required for the UI acceptance matrix.");

const outputDirectory = options.outputDirectory ?? "/private/tmp/linguist-agent-electron-acceptance/ui";
await mkdir(outputDirectory, { recursive: true });
const app = await launchAcceptanceApp({ appPath, runtimeURL, credential });
const treeKey = (kind, ...parts) => `${kind}:${parts.join(":")}`;

async function clickKey(key) {
  await evaluate(app.client, `Array.from(document.querySelectorAll('[data-tree-key]')).find((node) => node.dataset.treeKey === ${JSON.stringify(key)})?.click()`);
}

async function ensureExpanded(key) {
  await waitForExpression(app.client, `Array.from(document.querySelectorAll('[data-tree-key]')).some((node) => node.dataset.treeKey === ${JSON.stringify(key)})`);
  const expanded = await evaluate(app.client, `Array.from(document.querySelectorAll('[data-tree-key]')).find((node) => node.dataset.treeKey === ${JSON.stringify(key)})?.getAttribute('aria-expanded')`);
  if (expanded === "false") {
    await clickKey(key);
    await waitForExpression(app.client, `Array.from(document.querySelectorAll('[data-tree-key]')).find((node) => node.dataset.treeKey === ${JSON.stringify(key)})?.getAttribute('aria-expanded') === 'true'`);
  }
}

async function openTask(input) {
  const project = treeKey("project", input.projectId);
  const batch = treeKey("batch", input.projectId, input.batchId);
  const task = treeKey("task", input.taskId);
  await ensureExpanded(project);
  await waitForExpression(app.client, `Array.from(document.querySelectorAll('[data-tree-key]')).some((node) => node.dataset.treeKey === ${JSON.stringify(batch)})`);
  await clickKey(batch);
  await waitForExpression(app.client, `Array.from(document.querySelectorAll('[data-tree-key]')).find((node) => node.dataset.treeKey === ${JSON.stringify(batch)})?.getAttribute('aria-current') === 'page'`);
  await ensureExpanded(batch);
  await waitForExpression(app.client, `Array.from(document.querySelectorAll('[data-tree-key]')).some((node) => node.dataset.treeKey === ${JSON.stringify(task)})`);
  await clickKey(task);
  await waitForExpression(app.client, "document.querySelector('.task-conversation:not(.task-conversation--state)')");
}

async function keyDown(key, code, windowsVirtualKeyCode, modifiers = 0) {
  await app.client.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode, modifiers });
  await app.client.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode, modifiers });
}

async function tabOrder(limit = 120, reverse = false) {
  await evaluate(app.client, "document.activeElement instanceof HTMLElement && document.activeElement.blur()");
  const order = [];
  const seen = new Set();
  for (let index = 0; index < limit; index += 1) {
    await keyDown("Tab", "Tab", 9, reverse ? 8 : 0);
    const item = await evaluate(app.client, `(() => {
      const element = document.activeElement;
      if (!(element instanceof HTMLElement)) return null;
      const text = element.getAttribute('aria-label') || element.textContent?.trim() || element.getAttribute('placeholder') || '';
      return {
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute('role'),
        label: text.slice(0, 120),
        disabled: element.matches(':disabled,[aria-disabled=true]'),
        hidden: element.getClientRects().length === 0,
      };
    })()`);
    if (!item) continue;
    const signature = JSON.stringify(item);
    if (seen.has(signature) && index > 4) break;
    seen.add(signature);
    order.push(item);
  }
  return order;
}

async function renameCurrentTask(title) {
  await evaluate(app.client, `document.querySelector('.product-task-menu > summary')?.click()`);
  await waitForExpression(app.client, "Array.from(document.querySelectorAll('.product-task-menu__popover button')).some((button) => button.textContent?.includes('重命名 Task'))");
  await evaluate(app.client, `Array.from(document.querySelectorAll('.product-task-menu__popover button')).find((button) => button.textContent?.includes('重命名 Task'))?.click()`);
  await waitForExpression(app.client, "document.querySelector('#product-task-title')");
  await evaluate(app.client, `(() => {
    const input = document.querySelector('#product-task-title');
    if (!(input instanceof HTMLInputElement)) throw new Error('Task title input is unavailable.');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!setter) throw new Error('Native input value setter is unavailable.');
    setter.call(input, ${JSON.stringify(title)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.closest('form')?.requestSubmit();
  })()`);
  await waitForExpression(app.client, `document.querySelector('.product-toolbar__scope strong')?.textContent === ${JSON.stringify(title)}`);
}

async function openProfessionalWorkspace(label, panelLabel = label) {
  await evaluate(app.client, `document.querySelector('.product-task-menu > summary')?.click()`);
  await waitForExpression(app.client, `Array.from(document.querySelectorAll('.product-task-menu__popover button')).some((button) => button.textContent?.trim() === ${JSON.stringify(label)})`);
  await evaluate(app.client, `Array.from(document.querySelectorAll('.product-task-menu__popover button')).find((button) => button.textContent?.trim() === ${JSON.stringify(label)})?.click()`);
  await waitForExpression(app.client, `document.querySelector('.pipeline-panel[aria-label=${JSON.stringify(panelLabel)}]')`);
}

async function captureRenderer(name, width = 1_440, height = 900, deviceScaleFactor = 0) {
  await app.client.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor,
    mobile: false,
  });
  await app.client.send("Emulation.setEmulatedMedia", {
    media: "screen",
    features: [
      { name: "prefers-color-scheme", value: "light" },
      { name: "prefers-reduced-motion", value: "no-preference" },
    ],
  });
  await app.client.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 255, g: 255, b: 255, a: 1 } });
  await evaluate(app.client, "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  const screenshot = await app.client.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  await writeFile(join(outputDirectory, `${name}.png`), Buffer.from(screenshot.data, "base64"));
}

function simplifyAX(nodes) {
  return nodes.filter((node) => !node.ignored).map((node) => ({
    nodeId: node.nodeId,
    parentId: node.parentId ?? null,
    role: node.role?.value ?? null,
    name: node.name?.value ?? null,
    description: node.description?.value ?? null,
    focusable: node.properties?.some((property) => property.name === "focusable" && property.value?.value === true) ?? false,
    disabled: node.properties?.some((property) => property.name === "disabled" && property.value?.value === true) ?? false,
  }));
}

async function snapshot(name, width, height, colorScheme, reducedMotion) {
  await app.client.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 0,
    mobile: false,
  });
  await app.client.send("Emulation.setEmulatedMedia", {
    media: "screen",
    features: [
      { name: "prefers-color-scheme", value: colorScheme },
      { name: "prefers-reduced-motion", value: reducedMotion ? "reduce" : "no-preference" },
    ],
  });
  await app.client.send("Emulation.setDefaultBackgroundColorOverride", {
    color: colorScheme === "dark"
      ? { r: 10, g: 10, b: 10, a: 1 }
      : { r: 255, g: 255, b: 255, a: 1 },
  });
  await evaluate(app.client, `(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const scroller = document.querySelector('.task-conversation__scroller');
    if (scroller instanceof HTMLElement) scroller.scrollTop = 0;
  })()`);
  await evaluate(app.client, "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  const audit = await evaluate(app.client, `(() => {
    const interactive = Array.from(document.querySelectorAll('button, a[href], input, textarea, select, [tabindex]'))
      .filter((node) => node instanceof HTMLElement && node.getClientRects().length > 0);
    const overflowValues = (style, axis) => axis === 'x'
      ? [style.overflow, style.overflowX]
      : [style.overflow, style.overflowY];
    const clippingContext = (node, rect) => {
      let ancestor = node.parentElement;
      while (ancestor && ancestor !== document.documentElement) {
        const style = getComputedStyle(ancestor);
        const ancestorRect = ancestor.getBoundingClientRect();
        const clippedX = rect.left < ancestorRect.left - 1 || rect.right > ancestorRect.right + 1;
        const clippedY = rect.top < ancestorRect.top - 1 || rect.bottom > ancestorRect.bottom + 1;
        const scrollsX = overflowValues(style, 'x').some((value) => value === 'auto' || value === 'scroll');
        const scrollsY = overflowValues(style, 'y').some((value) => value === 'auto' || value === 'scroll');
        if ((clippedX && scrollsX) || (clippedY && scrollsY)) {
          return {
            kind: 'scroll-contained',
            ancestor: ancestor.className || ancestor.tagName.toLowerCase(),
          };
        }
        ancestor = ancestor.parentElement;
      }
      return { kind: 'persistent', ancestor: null };
    };
    const clipped = interactive.flatMap((node) => {
      const rect = node.getBoundingClientRect();
      const outsideViewport = rect.left < -1 || rect.right > innerWidth + 1 || rect.top < -1 || rect.bottom > innerHeight + 1;
      if (!outsideViewport) return [];
      const context = clippingContext(node, rect);
      return context.kind === 'persistent'
        ? [{ tag: node.tagName.toLowerCase(), label: (node.getAttribute('aria-label') || node.textContent || '').trim().slice(0, 80), rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }]
        : [];
    });
    const scrollContained = interactive.flatMap((node) => {
      const rect = node.getBoundingClientRect();
      const outsideViewport = rect.left < -1 || rect.right > innerWidth + 1 || rect.top < -1 || rect.bottom > innerHeight + 1;
      if (!outsideViewport) return [];
      const context = clippingContext(node, rect);
      return context.kind === 'scroll-contained'
        ? [{ tag: node.tagName.toLowerCase(), label: (node.getAttribute('aria-label') || node.textContent || '').trim().slice(0, 80), ancestor: context.ancestor }]
        : [];
    });
    const overflowSources = Array.from(document.querySelectorAll('body *')).flatMap((node) => {
      if (!(node instanceof HTMLElement) || node.getClientRects().length === 0) return [];
      const rect = node.getBoundingClientRect();
      if (rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1 && rect.left >= -1 && rect.top >= -1) return [];
      const context = clippingContext(node, rect);
      if (context.kind === 'scroll-contained') return [];
      return [{
        tag: node.tagName.toLowerCase(),
        className: String(node.className).slice(0, 120),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      }];
    }).sort((left, right) => (right.rect.bottom ?? 0) - (left.rect.bottom ?? 0)).slice(0, 24);
    const landmarks = Array.from(document.querySelectorAll('aside, header, main, form')).map((node) => ({
      tag: node.tagName.toLowerCase(),
      label: node.getAttribute('aria-label') || node.getAttribute('aria-labelledby') || node.className,
    }));
    const milliseconds = (value) => value.trim().endsWith('ms') ? parseFloat(value) : parseFloat(value) * 1000;
    const animated = Array.from(document.querySelectorAll('*')).flatMap((node) => {
      const style = getComputedStyle(node);
      const materialAnimation = style.animationName !== 'none' && style.animationDuration.split(',').some((value) => milliseconds(value) > 16);
      const materialTransition = style.transitionDuration.split(',').some((value) => milliseconds(value) > 16);
      return materialAnimation || materialTransition
        ? [{ tag: node.tagName.toLowerCase(), className: String(node.className).slice(0, 120), animationName: style.animationName, animationDuration: style.animationDuration, transitionDuration: style.transitionDuration }]
        : [];
    }).slice(0, 200);
    const appRoot = document.querySelector('#root');
    const applicationOverflow = {
      width: Math.max(
        0,
        document.body.scrollWidth - document.body.clientWidth,
        appRoot ? appRoot.scrollWidth - appRoot.clientWidth : 0,
      ),
      height: Math.max(
        0,
        document.body.scrollHeight - document.body.clientHeight,
        appRoot ? appRoot.scrollHeight - appRoot.clientHeight : 0,
      ),
    };
    return {
      viewport: { innerWidth, innerHeight, devicePixelRatio },
      documentOverflow: applicationOverflow,
      rawDocumentOverflow: {
        width: Math.max(0, document.documentElement.scrollWidth - innerWidth),
        height: Math.max(0, document.documentElement.scrollHeight - innerHeight),
      },
      rootMetrics: {
        scrollingElement: document.scrollingElement?.tagName.toLowerCase() ?? null,
        visualViewportHeight: window.visualViewport?.height ?? null,
        outerHeight: window.outerHeight,
        documentClientWidth: document.documentElement.clientWidth,
        documentClientHeight: document.documentElement.clientHeight,
        documentScrollWidth: document.documentElement.scrollWidth,
        documentScrollHeight: document.documentElement.scrollHeight,
        bodyClientWidth: document.body.clientWidth,
        bodyClientHeight: document.body.clientHeight,
        bodyScrollWidth: document.body.scrollWidth,
        bodyScrollHeight: document.body.scrollHeight,
        documentRect: (() => { const rect = document.documentElement.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; })(),
        bodyRect: (() => { const rect = document.body.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; })(),
        rootRect: (() => { const rect = document.querySelector('#root')?.getBoundingClientRect(); return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null; })(),
        workspaceRect: (() => { const rect = document.querySelector('.workspace-shell')?.getBoundingClientRect(); return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null; })(),
      },
      interactiveCount: interactive.length,
      clipped,
      scrollContained,
      overflowSources,
      landmarks,
      animated,
    };
  })()`);
  const screenshot = await app.client.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  await writeFile(join(outputDirectory, `${name}.png`), Buffer.from(screenshot.data, "base64"));
  const keyboard = { forward: await tabOrder(), reverse: await tabOrder(120, true) };
  const ax = simplifyAX((await app.client.send("Accessibility.getFullAXTree")).nodes);
  await writeFile(join(outputDirectory, `${name}-ax.json`), `${JSON.stringify(ax, null, 2)}\n`);
  return { name, width, height, colorScheme, reducedMotion, audit, keyboard, axNodes: ax.length };
}

const matrix = [];
try {
  if (config.uiTask) await openTask(config.uiTask);
  for (const [width, height] of [[480, 600], [1_024, 700], [1_280, 820], [1_440, 900]]) {
    for (const colorScheme of ["light", "dark"]) {
      matrix.push(await snapshot(`${width}x${height}-${colorScheme}`, width, height, colorScheme, false));
      matrix.push(await snapshot(`${width}x${height}-${colorScheme}-reduce-motion`, width, height, colorScheme, true));
    }
  }

  let shortcuts = null;
  let escapePreservedRun = null;
  let taskRename = null;
  let decisionInteraction = null;
  let artifactInspector = null;
  let catCompanion = null;
  let composerDisclosure = null;
  let settingsWorkspace = null;
  let pipelineWorkspace = null;
  if (config.uiTask) {
    const before = await runtimeJSON(runtimeURL, credential, `/api/projects/${encodeURIComponent(config.uiTask.projectId)}/tasks/${encodeURIComponent(config.uiTask.taskId)}`);
    try {
      await keyDown("2", "Digit2", 50, 4);
      await waitForExpression(app.client, "document.querySelector('.product-toolbar__views button[aria-label=\"打开 CAT\"]')?.getAttribute('aria-pressed') === 'true'", 2_000);
      const cat = await evaluate(app.client, "document.querySelector('.product-toolbar__views button[aria-pressed=\"true\"]')?.getAttribute('aria-label')");
      await keyDown("1", "Digit1", 49, 4);
      await waitForExpression(app.client, "document.querySelector('.product-toolbar__views button[aria-label=\"打开对话\"]')?.getAttribute('aria-pressed') === 'true'", 2_000);
      const conversation = await evaluate(app.client, "document.querySelector('.product-toolbar__views button[aria-pressed=\"true\"]')?.getAttribute('aria-label')");
      shortcuts = { command1: conversation, command2: cat, automated: true };
    } catch {
      shortcuts = { automated: false, reason: "CDP key events do not exercise Electron's native application menu; manual accelerator pass required." };
    }
    await keyDown("Escape", "Escape", 27);
    const after = await runtimeJSON(runtimeURL, credential, `/api/projects/${encodeURIComponent(config.uiTask.projectId)}/tasks/${encodeURIComponent(config.uiTask.taskId)}`);
    const beforeRun = before.runs?.find((run) => run.id === before.activeRunId)?.status ?? null;
    const afterRun = after.runs?.find((run) => run.id === after.activeRunId)?.status ?? null;
    escapePreservedRun = { before: beforeRun, after: afterRun, preserved: beforeRun === afterRun };
    const originalTitle = String(before.task?.title ?? "");
    const temporaryTitle = `${originalTitle.slice(0, 96)} · rename check`;
    try {
      await renameCurrentTask(temporaryTitle);
      const renamed = await runtimeJSON(runtimeURL, credential, `/api/projects/${encodeURIComponent(config.uiTask.projectId)}/tasks/${encodeURIComponent(config.uiTask.taskId)}`);
      await renameCurrentTask(originalTitle);
      const restored = await runtimeJSON(runtimeURL, credential, `/api/projects/${encodeURIComponent(config.uiTask.projectId)}/tasks/${encodeURIComponent(config.uiTask.taskId)}`);
      taskRename = {
        automated: true,
        canonicalRename: renamed.task?.title === temporaryTitle,
        restored: restored.task?.title === originalTitle,
      };
    } catch (error) {
      taskRename = { automated: false, reason: error instanceof Error ? error.message : String(error) };
    }
    try {
      await evaluate(app.client, `document.querySelector('.product-toolbar__views button[aria-label="打开对话"]')?.click()`);
      await waitForExpression(app.client, "document.querySelector('.decision-interaction__navigation')");
      await evaluate(app.client, `document.querySelector('.decision-interaction')?.scrollIntoView({ block: 'center' })`);
      await captureRenderer("1440x900-light-decision-1-of-4");
      const disabledPreviousStyle = await evaluate(app.client, `(() => {
        const button = document.querySelector('.decision-interaction__navigation button[aria-label="上一个问题"]');
        if (!(button instanceof HTMLButtonElement)) return null;
        const style = getComputedStyle(button);
        return {
          background: style.background,
          backgroundColor: style.backgroundColor,
          border: style.border,
          opacity: style.opacity,
        };
      })()`);
      const modes = [];
      for (let index = 0; index < 4; index += 1) {
        if (index > 0) {
          await evaluate(app.client, `document.querySelector('.decision-interaction__navigation button[aria-label="下一个问题"]')?.click()`);
          await waitForExpression(app.client, `document.querySelector('.decision-interaction__progress')?.textContent?.trim() === ${JSON.stringify(`${index + 1} / 4`)}`);
        }
        modes.push(await evaluate(app.client, `(() => {
          const fieldset = document.querySelector('.decision-interaction .decision-question');
          const input = fieldset?.querySelector('input');
          if (input instanceof HTMLInputElement) return input.type;
          return fieldset?.querySelector('textarea') ? 'freeform' : 'unknown';
        })()`));
      }
      await captureRenderer("1440x900-light-decision-4-of-4");
      decisionInteraction = {
        automated: true,
        count: 4,
        modes,
        allQuestionsOccupyOneStableCard: true,
        disabledPreviousStyle,
      };
    } catch (error) {
      decisionInteraction = { automated: false, reason: error instanceof Error ? error.message : String(error) };
    }
    try {
      await evaluate(app.client, `document.querySelector('.product-toolbar__views button[aria-label="打开对话"]')?.click()`);
      await waitForExpression(app.client, "document.querySelector('.task-conversation:not(.task-conversation--state)')");
      await evaluate(app.client, `(() => {
        const trigger = document.querySelector('.conversation-artifact .la-button');
        if (!(trigger instanceof HTMLButtonElement)) throw new Error('Artifact detail trigger is unavailable.');
        trigger.scrollIntoView({ block: 'center' });
        trigger.focus({ preventScroll: true });
        trigger.click();
      })()`);
      await waitForExpression(app.client, "document.querySelector('.context-inspector')");
      const focusEnteredInspector = await evaluate(app.client, "document.activeElement?.getAttribute('aria-label') === '关闭上下文检查器'");
      await captureRenderer("1440x900-light-artifact-inspector");
      const heading = await evaluate(app.client, "document.querySelector('.context-inspector h2')?.textContent ?? null");
      const initialWidth = await evaluate(app.client, "document.querySelector('.product-inspector-pane')?.getBoundingClientRect().width ?? 0");
      await evaluate(app.client, `(() => {
        const separator = document.querySelector('[role="separator"][aria-label="调整上下文检查器宽度"]');
        if (!(separator instanceof HTMLElement)) throw new Error('Inspector width separator is unavailable.');
        separator.focus({ preventScroll: true });
      })()`);
      await keyDown("ArrowLeft", "ArrowLeft", 37);
      await waitForExpression(app.client, `document.querySelector('.product-inspector-pane')?.getBoundingClientRect().width > ${JSON.stringify(initialWidth + 8)}`);
      const resizedAriaValue = await evaluate(app.client, "Number(document.querySelector('[role=separator][aria-label=\"调整上下文检查器宽度\"]')?.getAttribute('aria-valuenow') ?? 0)");
      await waitForExpression(app.client, `Math.abs((document.querySelector('.product-inspector-pane')?.getBoundingClientRect().width ?? 0) - ${JSON.stringify(resizedAriaValue)}) < 0.1`);
      const resizedWidth = await evaluate(app.client, "document.querySelector('.product-inspector-pane')?.getBoundingClientRect().width ?? 0");
      await evaluate(app.client, `document.querySelector('.context-inspector button[aria-label="展开上下文检查器"]')?.click()`);
      await waitForExpression(app.client, "document.querySelector('.product-inspector-pane')?.getAttribute('data-expanded') === 'true'");
      await waitForExpression(app.client, `(() => {
        const pane = document.querySelector('.product-inspector-pane');
        const frame = document.querySelector('.product-task-frame');
        return pane && frame && Math.abs(pane.getBoundingClientRect().width - frame.getBoundingClientRect().width) < 2;
      })()`);
      const expandedWidth = await evaluate(app.client, "document.querySelector('.product-inspector-pane')?.getBoundingClientRect().width ?? 0");
      const frameWidth = await evaluate(app.client, "document.querySelector('.product-task-frame')?.getBoundingClientRect().width ?? 0");
      await captureRenderer("1440x900-light-artifact-inspector-expanded");
      await evaluate(app.client, `document.querySelector('.context-inspector button[aria-label="恢复上下文检查器宽度"]')?.click()`);
      await waitForExpression(app.client, "document.querySelector('.product-inspector-pane')?.getAttribute('data-expanded') === 'false'");
      await waitForExpression(app.client, `Math.abs((document.querySelector('.product-inspector-pane')?.getBoundingClientRect().width ?? 0) - ${JSON.stringify(resizedAriaValue)}) < 2`);
      const restoredPixelWidth = await evaluate(app.client, "document.querySelector('.product-inspector-pane')?.getBoundingClientRect().width ?? 0");
      await evaluate(app.client, `document.querySelector('.context-inspector button[aria-label="关闭上下文检查器"]')?.click()`);
      await waitForExpression(app.client, "!document.querySelector('.context-inspector')");
      await evaluate(app.client, "new Promise((resolve) => requestAnimationFrame(resolve))");
      const focusRestoredToTrigger = await evaluate(app.client, "document.activeElement?.textContent?.includes('查看详情') === true");
      artifactInspector = {
        automated: true,
        heading,
        focusEnteredInspector,
        focusRestoredToTrigger,
        initialWidth,
        resizedWidth,
        resizedAriaValue,
        expandedWidth,
        frameWidth,
        restoredPixelWidth,
        resizedByKeyboard: resizedWidth > initialWidth && Math.abs(resizedAriaValue - resizedWidth) < 0.1,
        expandedFullWidth: Math.abs(expandedWidth - frameWidth) < 2,
        restoredWidth: restoredPixelWidth < frameWidth - 100 && Math.abs(restoredPixelWidth - resizedWidth) < 2,
      };
    } catch (error) {
      artifactInspector = { automated: false, reason: error instanceof Error ? error.message : String(error) };
    }
    try {
      await evaluate(app.client, `document.querySelector('.product-toolbar__views button[aria-label="打开对话"]')?.click()`);
      await waitForExpression(app.client, "document.querySelector('.conversation-composer__add > summary')");
      await evaluate(app.client, `document.querySelector('.conversation-composer__add > summary')?.click()`);
      await waitForExpression(app.client, "document.querySelector('.conversation-composer__add[open] .conversation-composer__add-popover')");
      const addSurface = await evaluate(app.client, `(() => {
        const popover = document.querySelector('.conversation-composer__add[open] .conversation-composer__add-popover');
        const buttons = Array.from(popover?.querySelectorAll('button') ?? []);
        return {
          heading: popover?.querySelector('header')?.textContent?.trim() ?? '',
          addOptions: buttons.map((button) => ({
            label: button.querySelector('strong')?.textContent?.trim() ?? button.textContent?.trim() ?? '',
            disabled: button.matches(':disabled,[aria-disabled=true]'),
          })),
          attachmentControl: buttons.some((button) => button.textContent?.includes('从项目文件夹选择资料')),
          assetSection: Boolean(popover?.querySelector('#composer-assets-heading')),
          capabilitySection: Boolean(popover?.querySelector('#composer-capabilities-heading')),
          assetCheckboxes: popover?.querySelectorAll('input[type="checkbox"]')?.length ?? 0,
          emptyAssetState: Boolean(Array.from(popover?.querySelectorAll('p') ?? []).some((node) => node.textContent?.includes('当前 Project 还没有可附加的资料'))),
        };
      })()`);
      await captureRenderer("1440x900-light-composer-add");
      const runCapabilitySelector = '.conversation-composer__capability:not(.conversation-composer__context):not(.conversation-composer__next-run)';
      await evaluate(app.client, `document.querySelector(${JSON.stringify(`${runCapabilitySelector} > summary`)})?.click()`);
      await waitForExpression(app.client, `document.querySelector(${JSON.stringify(`${runCapabilitySelector}[open] .conversation-composer__capability-popover`)})`);
      const capability = await evaluate(app.client, `(() => {
        const popover = document.querySelector(${JSON.stringify(`${runCapabilitySelector}[open] .conversation-composer__capability-popover`)});
        return {
          text: popover?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
          hasSettingsEntry: Array.from(popover?.querySelectorAll('button') ?? []).some((button) => button.textContent?.includes('模型与能力设置')),
          summaryLabel: document.querySelector(${JSON.stringify(`${runCapabilitySelector} > summary`)})?.getAttribute('aria-label') ?? null,
        };
      })()`);
      await captureRenderer("1440x900-light-composer-capability");
      await keyDown("Escape", "Escape", 27);
      composerDisclosure = {
        automated: true,
        ...addSurface,
        capability,
      };
    } catch (error) {
      composerDisclosure = { automated: false, reason: error instanceof Error ? error.message : String(error) };
    }
    try {
      await evaluate(app.client, `document.querySelector('.product-toolbar__views button[aria-label="打开 CAT"]')?.click()`);
      await waitForExpression(app.client, "document.querySelector('.cat-workspace') && document.querySelector('.segment-companion')");
      await waitForExpression(app.client, "document.querySelector('.cat-segment-row[data-selected]') && document.querySelector('.segment-companion__source p')");
      const initial = await evaluate(app.client, `(() => {
        const row = document.querySelector('.cat-segment-row[data-selected]');
        const companion = document.querySelector('.segment-companion');
        const sourceCell = row?.querySelector('.cat-segment-source');
        const companionSource = companion?.querySelector('.segment-companion__source p');
        const composer = companion?.querySelector('.segment-companion__composer');
        return {
          gridRowCount: Number(document.querySelector('.cat-grid')?.getAttribute('aria-rowcount') ?? 0),
          dataRowCount: Math.max(0, Number(document.querySelector('.cat-grid')?.getAttribute('aria-rowcount') ?? 0) - 1),
          selectedSegmentId: row?.getAttribute('data-segment-id') ?? null,
          selectedIndex: Number(row?.getAttribute('data-index') ?? 0),
          sourceMatches: sourceCell?.textContent?.trim() === companionSource?.textContent?.trim(),
          companionItems: companion?.querySelectorAll('.segment-companion__history article').length ?? 0,
          hasScopedComposer: Boolean(composer?.textContent?.includes('句段')),
          completeHistoryDuplicated: Boolean(companion?.querySelector('.task-conversation')),
        };
      })()`);
      const advanceKey = initial.selectedIndex > 0 ? "ArrowUp" : "ArrowDown";
      const restoreKey = advanceKey === "ArrowUp" ? "ArrowDown" : "ArrowUp";
      await evaluate(app.client, `document.querySelector('.cat-segment-row[data-selected]')?.focus()`);
      await keyDown(advanceKey, advanceKey, advanceKey === "ArrowUp" ? 38 : 40);
      await waitForExpression(app.client, `document.querySelector('.cat-segment-row[data-selected]')?.getAttribute('data-segment-id') !== ${JSON.stringify(initial.selectedSegmentId)}`);
      const keyboardSelectedSegmentId = await evaluate(app.client, "document.querySelector('.cat-segment-row[data-selected]')?.getAttribute('data-segment-id') ?? null");
      const keyboardErrorBoundary = await evaluate(app.client, "document.body.textContent?.includes('工作区发生错误') ?? false");
      await keyDown(restoreKey, restoreKey, restoreKey === "ArrowUp" ? 38 : 40);
      await waitForExpression(app.client, `document.querySelector('.cat-segment-row[data-selected]')?.getAttribute('data-segment-id') === ${JSON.stringify(initial.selectedSegmentId)}`);
      await keyDown("Enter", "Enter", 13);
      await waitForExpression(app.client, "Boolean(document.querySelector('.cat-segment-row[data-selected] textarea'))");
      const editorOpened = await evaluate(app.client, "document.activeElement?.matches('.cat-target-editor') ?? false");
      await keyDown("Escape", "Escape", 27);
      await waitForExpression(app.client, "!document.querySelector('.cat-segment-row[data-selected] textarea')");
      const editorCancelled = await evaluate(app.client, "document.activeElement?.matches('.cat-segment-row[data-selected]') ?? false");
      await captureRenderer("1440x900-light-cat-companion");
      await evaluate(app.client, `Array.from(document.querySelectorAll('.segment-companion button')).find((button) => button.textContent?.includes('完整对话'))?.click()`);
      await waitForExpression(app.client, "document.querySelector('.task-conversation:not(.task-conversation--state)')");
      const historyScope = await evaluate(app.client, `(() => {
        const summary = document.querySelector('.conversation-composer__scope > summary');
        return {
          retained: Boolean(summary?.textContent?.includes('句段') || summary?.getAttribute('aria-label')?.includes('句段')),
          text: summary?.textContent?.trim() ?? null,
          label: summary?.getAttribute('aria-label') ?? null,
        };
      })()`);
      await evaluate(app.client, `document.querySelector('.product-toolbar__views button[aria-label="打开 CAT"]')?.click()`);
      await waitForExpression(app.client, "document.querySelector('.cat-workspace') && document.querySelector('.segment-companion')");
      const selectedAfterReturn = await evaluate(app.client, "document.querySelector('.cat-segment-row[data-selected]')?.getAttribute('data-segment-id') ?? null");
      await evaluate(app.client, `Array.from(document.querySelectorAll('.segment-companion button')).find((button) => button.textContent?.includes('上下文'))?.click()`);
      await waitForExpression(app.client, "document.querySelector('.context-inspector')");
      const inspectorHeading = await evaluate(app.client, "document.querySelector('.context-inspector h2')?.textContent ?? null");
      const inspectorFocused = await evaluate(app.client, "document.activeElement?.getAttribute('aria-label') === '关闭上下文检查器'");
      await captureRenderer("1440x900-light-cat-segment-inspector");
      catCompanion = {
        automated: true,
        ...initial,
        keyboardSelectedSegmentId,
        keyboardSelectionChanged: keyboardSelectedSegmentId !== initial.selectedSegmentId,
        keyboardSelectionRestored: initial.selectedSegmentId === selectedAfterReturn,
        keyboardErrorBoundary,
        editorOpened,
        editorCancelled,
        historyScopeRetained: historyScope.retained,
        historyScope,
        selectedAfterReturn,
        selectionPreserved: initial.selectedSegmentId === selectedAfterReturn,
        inspectorHeading,
        inspectorFocused,
      };
    } catch (error) {
      catCompanion = { automated: false, reason: error instanceof Error ? error.message : String(error) };
    }
    try {
      await evaluate(app.client, `document.querySelector('.workspace-sidebar-settings')?.click()`);
      await waitForExpression(app.client, "document.querySelector('.settings-workspace') && document.querySelector('.settings-page-header h1')?.textContent === '模型'");
      await waitForExpression(app.client, "document.querySelector('.settings-scroll')?.getAttribute('aria-busy') === 'false'");
      const initial = await evaluate(app.client, `(() => ({
        standalone: !document.querySelector('.workspace-sidebar') && !document.querySelector('.product-toolbar'),
        pageCount: document.querySelectorAll('.settings-navigation__group > button').length,
        selected: document.querySelector('.settings-navigation__group > button[aria-current="page"]')?.textContent?.trim() ?? null,
        hasBack: Boolean(document.querySelector('.settings-back:not(:disabled)')),
      }))()`);
      await captureRenderer("1440x900-light-settings-model");
      await captureRenderer("1862x994-light-settings-model-reference-viewport", 1_862, 994);
      await evaluate(app.client, `(() => {
        const input = document.querySelector('.settings-search input');
        if (!(input instanceof HTMLInputElement)) throw new Error('Settings search is unavailable.');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (!setter) throw new Error('Native input value setter is unavailable.');
        setter.call(input, '资源');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await waitForExpression(app.client, "Array.from(document.querySelectorAll('.settings-navigation__group > button')).some((button) => button.textContent?.includes('Run 资源'))");
      const filteredLabels = await evaluate(app.client, "Array.from(document.querySelectorAll('.settings-navigation__group > button')).map((button) => button.textContent?.trim() ?? '')");
      await evaluate(app.client, `Array.from(document.querySelectorAll('.settings-navigation__group > button')).find((button) => button.textContent?.includes('Run 资源'))?.click()`);
      await waitForExpression(app.client, "document.querySelector('.settings-page-header h1')?.textContent === 'Run 资源'");
      const manifestVisible = await evaluate(app.client, "Boolean(document.querySelector('.settings-manifest') || document.querySelector('.settings-unavailable'))");
      await captureRenderer("1440x900-light-settings-run-resources");
      await evaluate(app.client, `document.querySelector('.settings-back')?.click()`);
      await waitForExpression(app.client, "document.querySelector('.cat-workspace') && !document.querySelector('.settings-workspace')");
      settingsWorkspace = {
        automated: true,
        ...initial,
        filteredLabels,
        searchReducedNavigation: filteredLabels.length < initial.pageCount && !filteredLabels.includes('模型'),
        manifestVisible,
        restoredPriorSurface: true,
      };
    } catch (error) {
      settingsWorkspace = { automated: false, reason: error instanceof Error ? error.message : String(error) };
    }
    try {
      await openProfessionalWorkspace("QA", "质量审计");
      await waitForExpression(app.client, "document.querySelector('.pipeline-panel[aria-label=\"质量审计\"]') && document.querySelector('.pipeline-result-heading')");
      const initial = await evaluate(app.client, `(() => ({
        toolbarContext: document.querySelector('.product-toolbar__views button[aria-label^="当前专业工作区"]')?.getAttribute('aria-label') ?? null,
        persistentModeTabs: Boolean(document.querySelector('.pipeline-tabs')),
        permanentHistoryRail: Boolean(document.querySelector('.pipeline-history')),
        heading: document.querySelector('.pipeline-pane-header .la-pane-header__title')?.textContent?.trim() ?? null,
        checkedSegments: Number((Array.from(document.querySelectorAll('.pipeline-metrics > div')).find((row) => row.querySelector('dt')?.textContent?.trim() === '已检查')?.querySelector('dd')?.textContent ?? '').replaceAll(',', '')),
        findingCount: document.querySelectorAll('.pipeline-findings .pipeline-finding').length,
        runCount: Number(document.querySelector('.pipeline-run-history__count')?.textContent ?? 0),
      }))()`);
      await captureRenderer("1440x900-light-qa-workspace");
      await evaluate(app.client, `document.querySelector('.pipeline-run-history > summary')?.click()`);
      await waitForExpression(app.client, "document.querySelector('.pipeline-run-history[open] .pipeline-run-history__popover')");
      const disclosedRuns = await evaluate(app.client, "document.querySelectorAll('.pipeline-run-history__popover li').length");
      await captureRenderer("1440x900-light-qa-run-history");
      await keyDown("Escape", "Escape", 27);
      await waitForExpression(app.client, "!document.querySelector('.pipeline-run-history[open]')");
      const pages = [];
      for (const page of [
        { label: "审阅", panelLabel: "交付复核", heading: "交付复核", capture: "1440x900-light-review-workspace" },
        { label: "交付", panelLabel: "交付", heading: "交付", capture: "1440x900-light-delivery-workspace" },
        { label: "评估", panelLabel: "评估", heading: "评估", capture: "1440x900-light-eval-workspace" },
      ]) {
        await openProfessionalWorkspace(page.label, page.panelLabel);
        await waitForExpression(app.client, `document.querySelector('.pipeline-pane-header .la-pane-header__title')?.textContent?.trim() === ${JSON.stringify(page.heading)}`);
        pages.push(await evaluate(app.client, `(() => ({
          label: ${JSON.stringify(page.label)},
          toolbarContext: document.querySelector('.product-toolbar__views button[aria-label^="当前专业工作区"]')?.getAttribute('aria-label') ?? null,
          heading: document.querySelector('.pipeline-pane-header .la-pane-header__title')?.textContent?.trim() ?? null,
          persistentModeTabs: Boolean(document.querySelector('.pipeline-tabs')),
          permanentHistoryRail: Boolean(document.querySelector('.pipeline-history')),
          inspectorOpen: Boolean(document.querySelector('.context-inspector')),
        }))()`));
        await captureRenderer(page.capture);
      }
      pipelineWorkspace = { automated: true, ...initial, disclosedRuns, historyClosedWithEscape: true, pages };
    } catch (error) {
      pipelineWorkspace = { automated: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  const uiGaps = [];
  for (const entry of matrix) {
    if (entry.audit.documentOverflow.width > 0) uiGaps.push(`${entry.name}: document overflows horizontally by ${entry.audit.documentOverflow.width}px`);
    if (entry.audit.documentOverflow.height > 0) uiGaps.push(`${entry.name}: document overflows vertically by ${entry.audit.documentOverflow.height}px`);
    if (entry.audit.clipped.length) uiGaps.push(`${entry.name}: ${entry.audit.clipped.length} persistent interactive controls are clipped`);
    if (entry.reducedMotion && entry.audit.animated.length) uiGaps.push(`${entry.name}: Reduce Motion still exposes ${entry.audit.animated.length} material animations or transitions`);
  }
  if (!escapePreservedRun?.preserved) uiGaps.push("Escape changed the canonical Run state");
  if (!taskRename?.automated || !taskRename.canonicalRename || !taskRename.restored) uiGaps.push("Task rename did not round-trip through canonical storage");
  if (!decisionInteraction?.automated || decisionInteraction.count !== 4 || decisionInteraction.modes.join(",") !== "radio,checkbox,freeform,radio") uiGaps.push("The four-question Decision interaction did not preserve all input modes");
  if (!artifactInspector?.automated
    || !artifactInspector.focusEnteredInspector
    || !artifactInspector.focusRestoredToTrigger
    || !artifactInspector.resizedByKeyboard
    || !artifactInspector.expandedFullWidth
    || !artifactInspector.restoredWidth) {
    uiGaps.push("Artifact Inspector did not preserve focus, keyboard resizing, full-width expansion, and width restoration");
  }
  if (!composerDisclosure?.automated
    || composerDisclosure.heading !== "添加到下一次 Main Agent Run"
    || !composerDisclosure.attachmentControl
    || !composerDisclosure.assetSection
    || !composerDisclosure.capabilitySection
    || !composerDisclosure.emptyAssetState
    || !composerDisclosure.capability?.hasSettingsEntry) {
    uiGaps.push("Composer progressive disclosure did not preserve attachment, capability, and current-Run capability semantics");
  }
  if (!catCompanion?.automated || catCompanion.dataRowCount !== 1_040 || !catCompanion.sourceMatches || catCompanion.completeHistoryDuplicated || !catCompanion.historyScopeRetained || !catCompanion.selectionPreserved || !catCompanion.keyboardSelectionChanged || !catCompanion.keyboardSelectionRestored || catCompanion.keyboardErrorBoundary || !catCompanion.editorOpened || !catCompanion.editorCancelled || !catCompanion.inspectorFocused) uiGaps.push("CAT companion did not preserve the 1,040-row segment scope, keyboard selection/editing, and Inspector focus contract");
  if (!settingsWorkspace?.automated || !settingsWorkspace.standalone || settingsWorkspace.pageCount !== 9 || !settingsWorkspace.hasBack || !settingsWorkspace.searchReducedNavigation || !settingsWorkspace.manifestVisible || !settingsWorkspace.restoredPriorSurface) uiGaps.push("Settings did not preserve the standalone Codex-style shell, discoverable navigation, canonical Run resource view, and return path");
  if (!pipelineWorkspace?.automated
    || pipelineWorkspace.toolbarContext !== "当前专业工作区：QA"
    || pipelineWorkspace.persistentModeTabs
    || pipelineWorkspace.permanentHistoryRail
    || pipelineWorkspace.heading !== "质量审计"
    || pipelineWorkspace.checkedSegments !== 1_040
    || pipelineWorkspace.findingCount !== 2
    || pipelineWorkspace.runCount < 1
    || pipelineWorkspace.disclosedRuns !== pipelineWorkspace.runCount
    || !pipelineWorkspace.historyClosedWithEscape
    || pipelineWorkspace.pages?.length !== 3
    || pipelineWorkspace.pages.some((page) => page.toolbarContext !== `当前专业工作区：${page.label}` || page.persistentModeTabs || page.permanentHistoryRail || page.inspectorOpen)) {
    uiGaps.push("QA workspace did not preserve the contextual Codex-style surface, complete canonical report, and progressively disclosed Run history");
  }

  const manualOpenItems = [
    shortcuts?.automated ? null : shortcuts?.reason ?? "Native application menu accelerators require a manual pass.",
    "Resize the real BrowserWindow to 480×600, 1024×700, 1280×820, and 1440×900 outer dimensions.",
    "Repeat light, dark, and Reduce Motion checks with macOS system settings.",
    "Capture the signed installed app with native window chrome.",
  ].filter(Boolean);

  const report = {
    schemaVersion: 2,
    kind: "electron-acceptance-ui-matrix",
    collectedAt: new Date().toISOString(),
    fixture: { health: fixture.health, gaps: fixture.gaps },
    fixtureGaps: fixture.gaps,
    uiGaps,
    manualOpenItems,
    matrix,
    shortcuts,
    escapePreservedRun,
    taskRename,
    decisionInteraction,
    artifactInspector,
    composerDisclosure,
    catCompanion,
    settingsWorkspace,
    pipelineWorkspace,
    limitations: [
      "Window sizes are exact renderer viewport emulations; repeat the final pass by resizing the real BrowserWindow to the requested outer dimensions.",
      "Color and Reduce Motion are Chromium media emulations; repeat the final pass with real macOS system settings.",
      "The saved AX tree verifies semantics and source order; native keyboard/focus interaction remains a manual gate.",
      "CDP screenshots contain the renderer surface; final installed-app screenshots must include native window chrome.",
    ],
  };
  const outputPath = join(outputDirectory, `ui-matrix-${Date.now()}.json`);
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    outputPath,
    captures: matrix.length,
    fixtureGaps: fixture.gaps,
    uiGaps,
    manualOpenItems,
  }, null, 2));
} finally {
  await app.close();
}
