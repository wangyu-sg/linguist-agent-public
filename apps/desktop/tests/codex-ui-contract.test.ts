import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { browserWindowOptions, resolveWindowSize } from "../src/desktop-security.mjs";

const root = new URL("../", import.meta.url);

test("the maintained professional UI has one repository-owned Codex contract", async () => {
  const contract = await readFile(new URL("../../docs/CODEX_UI_CONTRACT.md", root), "utf8");
  assert.match(contract, /46px native titlebar/);
  assert.match(contract, /1280×820/);
  assert.match(contract, /480×600/);
  assert.match(contract, /48rem/);
  assert.match(contract, /77%/);
  assert.match(contract, /Codex system stack/);
  assert.doesNotMatch(contract, /\/Users\//, "the durable contract must not retain a personal absolute path");
});

test("the desktop shell remains usable at the Codex minimum window", () => {
  const options = browserWindowOptions("/tmp/preload.cjs");
  assert.deepEqual({ minWidth: options.minWidth, minHeight: options.minHeight }, { minWidth: 480, minHeight: 600 });
  assert.deepEqual(resolveWindowSize(["Linguist Agent", "--window-size=320,200"]), { width: 480, height: 600 });
});

test("professional surfaces use neutral Codex tokens and visible keyboard focus", async () => {
  const [tokens, base, conversationShell, conversationItems, composer, composerControls, composerControlsCss, commandPalette] = await Promise.all([
    readFile(new URL("src/renderer/styles/tokens.css", root), "utf8"),
    readFile(new URL("src/renderer/styles/base.css", root), "utf8"),
    readFile(new URL("src/renderer/conversation/conversation-shell.css", root), "utf8"),
    readFile(new URL("src/renderer/conversation/conversation-items.css", root), "utf8"),
    readFile(new URL("src/renderer/composer/composer.css", root), "utf8"),
    readFile(new URL("src/renderer/composer/composer-controls.tsx", root), "utf8"),
    readFile(new URL("src/renderer/conversation/conversation-composer.css", root), "utf8"),
    readFile(new URL("src/renderer/command/command-palette.css", root), "utf8"),
  ]);
  assert.match(tokens, /--la-focus-ring:\s*#339cff/);
  assert.match(tokens, /--la-shimmer-base:/, "shimmer sweep keeps a token-owned base color");
  assert.match(tokens, /--la-shimmer-contrast:/, "shimmer sweep keeps a token-owned contrast color");
  assert.match(tokens, /--la-scrim:/, "modal scrims keep a token-owned color");
  assert.doesNotMatch(tokens, /Atelier palette|Ink-and-copper/);
  assert.doesNotMatch(tokens, /Legacy aliases/, "the pre-redesign alias layer is retired");
  assert.doesNotMatch(
    tokens,
    /--la-(surface-canvas|surface-subtle|surface-sidebar|surface-selected|text-primary|text-secondary|text-disabled|action-primary|information):/,
    "retired alias definitions stay deleted",
  );
  assert.doesNotMatch(base, /body::after\s*\{/i, "paper grain must not leak into professional pages");
  assert.match(base, /:focus-visible[\s\S]*outline:\s*2px solid var\(--la-focus-ring\)/);
  assert.match(conversationShell, /\.persona-avatar__tile\s*\{[\s\S]*?var\(--persona-hue\)/, "persona hue stays on the avatar tile");
  assert.match(conversationShell, /\.persona-avatar__status\[data-status="running"\][\s\S]*?var\(--persona-hue\)/, "persona hue stays on the status dot");
  assert.doesNotMatch(conversationItems, /--persona-hue/, "conversation item surfaces never consume persona hues");
  assert.doesNotMatch(composerControlsCss, /--persona-hue/, "composer surfaces never consume persona hues");
  assert.match(commandPalette, /background:\s*var\(--la-scrim\)/, "command palette backdrop uses the scrim token");
  assert.match(conversationShell, /--thread-content-max-width:\s*48rem/, "thread column width is a shell variable defaulting to 48rem");
  assert.match(conversationShell, /max-width:\s*var\(--thread-content-max-width\)/);
  assert.match(conversationShell, /@container thread-column \(max-width:\s*52rem\)[\s\S]*--thread-content-max-width:\s*42rem/, "narrow contexts override the thread column to 42rem");
  assert.match(conversationShell, /@keyframes conversation-hero-enter/, "empty-state hero fades in per spec");
  assert.match(conversationShell, /@keyframes conversation-hero-suggestion-enter/, "suggestion cards stagger in per spec");
  assert.match(conversationItems, /max-width:\s*77%/);
  assert.match(conversationItems, /-webkit-line-clamp:\s*3/, "approval preview collapses to 3 lines");
  assert.match(conversationItems, /max-height:\s*3lh/, "approval preview collapsed height is 3lh");
  assert.match(conversationItems, /@keyframes loading-shimmer[\s\S]*?250% 0/, "loading shimmer sweeps -100% to 250%");
  assert.match(conversationItems, /\.la-loading-shimmer[\s\S]*?background-clip:\s*text/, "shimmer renders through background-clip:text");
  assert.match(conversationItems, /\.conversation-run-boundary--worked[\s\S]*?flex-direction:\s*column/, "worked divider stacks label over the rule");
  assert.match(conversationItems, /\.conversation-run-boundary__rule[\s\S]*?border-top:\s*1px solid var\(--la-border-default\)/, "worked divider keeps the full-width hairline");
  assert.match(composer, /border-radius:\s*20px/);
  assert.match(composer, /grid-template-columns:\s*minmax\(0, auto\) auto minmax\(0, 1fr\)/, "composer footer keeps the Codex three-column grid");
  assert.match(composer, /column-gap:\s*5px/, "composer footer keeps the Codex 5px inline gap");
  assert.match(composer, /border-radius:\s*22px/, "single-line composer radius is the 22px token, not a capsule");
  assert.match(composer, /\.composer-power-slider__track\s*\{[\s\S]*?height:\s*24px[\s\S]*?border-radius:\s*12px/, "power slider track keeps spec geometry");
  assert.match(composer, /\.composer-power-slider__thumb\s*\{[\s\S]*?width:\s*28px[\s\S]*?height:\s*28px/, "power slider thumb keeps the 28px circle");
  assert.match(composer, /\.composer-power-slider__tick\s*\{[\s\S]*?width:\s*4px[\s\S]*?height:\s*4px/, "power slider ticks keep the 4px dots");
  assert.match(composer, /0\.3s var\(--la-ease-spring\)/, "power slider moves with the .3s spring easing");
  assert.match(composer, /\.agent-composer__slash-item\s*\{[\s\S]*?min-height:\s*24px/, "slash menu items keep the cmdk 24px row");
  assert.match(composer, /\.agent-composer__slash-menu-list\s*\{[\s\S]*?max-height:\s*min\(300px/, "slash menu list caps at the cmdk 300px");
  assert.match(composer, /\.agent-composer__send-kbd/, "stop state embeds the Esc kbd hint");
  assert.match(composerControls, /role="radiogroup" aria-label="选择下一次 Run 的模型"/);
  assert.match(composerControls, /onClick=\{\(\) => chooseModel\(option\)\}/);
  assert.match(composerControls, /function useComposerPopoverSide/);
  assert.match(composerControls, /--composer-popover-max-height/);
  assert.match(composerControlsCss, /\.conversation-model-picker__list/);
  assert.match(composerControlsCss, /data-popover-side="down"/);
  assert.match(composerControlsCss, /max-height:\s*var\(--composer-popover-max-height/);
  assert.doesNotMatch(composerControlsCss, /\.conversation-composer__next-run \.conversation-composer__capability-popover select/);
});

test("large conversation and shell modules stay split along rendering boundaries", async () => {
  const [conversation, items, product, toolbar, cssEntry] = await Promise.all([
    readFile(new URL("src/renderer/conversation/TaskConversation.tsx", root), "utf8"),
    readFile(new URL("src/renderer/conversation/ConversationItems.tsx", root), "utf8"),
    readFile(new URL("src/renderer/shell/ProductWorkspace.tsx", root), "utf8"),
    readFile(new URL("src/renderer/shell/ProductToolbar.tsx", root), "utf8"),
    readFile(new URL("src/renderer/conversation/conversation.css", root), "utf8"),
  ]);
  assert.doesNotMatch(conversation, /function ActivityItem/);
  assert.match(conversation, /现在调整/);
  assert.match(conversation, /完成后执行/);
  assert.match(conversation, /delivery: requestedLiveDelivery/);
  assert.match(conversation, /data-send-state=\{composerPresentation\.sendButton\.state\}/, "single submit button carries the four-state machine");
  assert.match(conversation, /agent-composer__send-kbd/, "stop state renders the embedded Esc kbd");
  assert.match(conversation, /<ComposerSlashMenu/, "slash menu is mounted through the composer overlay");
  assert.match(conversation, /slashQueryFromDraft\(draft\)/, "slash menu triggers from the draft");
  assert.match(conversation, /payload\.type === "done"/);
  assert.match(conversation, /message\.id === pendingId && message\.status === "sending" \? \{ \.\.\.message, status: "sent" \} : message/, "late done cannot resurrect a failed pending message");
  assert.match(conversation, /anchorTo: "end"/);
  assert.match(conversation, /followOnAppend: "auto"/);
  assert.match(product, /key=\{`\$\{state\.projectId \?\? "standalone"\}:\$\{state\.task!\.task\.id\}`\}/, "Task scope changes remount and cancel the previous stream");
  assert.match(conversation, /<EmptyConversationHero/, "the first-turn empty state renders the Codex hero");
  assert.match(conversation, /随时可以开始。/, "hero rotates Chinese headline lines");
  assert.match(conversation, /今天处理哪件事？/);
  assert.match(conversation, /在想什么？/);
  assert.match(conversation, /从哪儿开始？/);
  assert.match(conversation, /\$\{index \* 25\}ms/, "suggestion cards stagger at index × 25ms");
  assert.match(conversation, /setDraft\(prompt\)/, "clicking a suggestion fills the composer draft");
  assert.match(conversation, /isStandalone && \(canonicalItems\.length > 0 \|\| branchThreads\.length > 1\)/, "an empty Chat must not show a redundant second overflow menu");
  assert.match(conversation, /scopeLabel=\{isStandalone \? "当前 Chat" : undefined\}/, "projectless Chat should not expose the Task implementation name");
  assert.match(items, /status: "sending" \| "sent" \| "failed"/);
  assert.match(items, /function ActivityItem/);
  assert.match(items, /信任此摘要/);
  assert.match(items, /approvalKeyAction\(event, event\.target/, "approval cards bind Enter=approve / Esc=decline through the guarded handler");
  assert.match(items, /data-decidable=\{canDecide \? "true" : undefined\}/, "only decidable cards are keyboard-addressable");
  assert.match(items, /\.conversation-permission\[data-decidable='true'\]/, "only the topmost decidable card answers the keyboard");
  assert.match(items, /conversation-permission__preview-toggle/, "approval preview has a ghost expand/collapse toggle");
  assert.match(items, /la-loading-shimmer/, "thinking/replying placeholders carry the shimmer sweep");
  assert.match(items, /\{isStreaming \|\| isFailed \? \(/, "a completed assistant turn should not retain a synthetic completion badge");
  assert.doesNotMatch(product, /function ProductToolbar/);
  assert.match(toolbar, /function ProductToolbar/);
  assert.match(product, /useState<ProductSurface>\("conversation"\)/, "a projectless Chat is the default product entry");
  assert.match(product, /setSurface\(state\.projectId && !state\.batchId \? "assets" : "conversation"\)/, "opening a Batch routes to the project assets surface");
  assert.match(toolbar, /const batchReady = Boolean\(project && state\.batchId && !state\.taskId\)/);
  assert.match(toolbar, /state\.taskId && !standalone && surface !== "settings"/, "projectless Chat keeps a single context overflow surface");
  assert.match(cssEntry, /conversation-shell\.css/);
  assert.match(cssEntry, /conversation-items\.css/);
  assert.match(cssEntry, /conversation-composer\.css/);
});

test("Project Tasks and projectless Chats share the Codex queued-message surface", async () => {
  const [conversation, queue, composer, store] = await Promise.all([
    readFile(new URL("src/renderer/conversation/TaskConversation.tsx", root), "utf8"),
    readFile(new URL("src/renderer/composer/QueuedMessageList.tsx", root), "utf8"),
    readFile(new URL("src/renderer/composer/composer.css", root), "utf8"),
    readFile(new URL("src/renderer/data/workspace-store.ts", root), "utf8"),
  ]);
  assert.match(conversation, /const supportsLiveDelivery = activeRun\?\.mode === "single" && activeRun\.status === "active"/, "live Pi delivery must not be gated by Task owner kind");
  assert.match(conversation, /<QueuedMessageList/, "one queue component is shared by both Task owners");
  assert.match(conversation, /const requestedLiveDelivery = deliveryOverride \?\? liveDelivery/, "paused submit can steer while retaining older follow-ups");
  assert.match(conversation, /const showPendingMessage = !liveDeliveryRequest \|\| requestedLiveDelivery !== "follow_up"/, "queued follow-ups stay in the queue tray until Pi actually delivers them");
  assert.match(conversation, /window\.setInterval\(refreshQueue, 1_250\)/, "a reopened active Task re-syncs its server-owned queue even without the original Run stream");
  assert.match(queue, /draggable=\{!busy && editingId !== message\.id\}/, "queued messages remain drag-reorderable");
  assert.match(queue, /Retry queued message/);
  assert.match(queue, /Steer with queued message/);
  assert.match(queue, /Edit queued message/);
  assert.match(queue, /Delete queued message/);
  assert.match(queue, /Pause queue/);
  assert.match(queue, /Send message\?/);
  assert.match(queue, /Clear queue/);
  assert.match(composer, /max-height:\s*min\(30dvh, 320px\)/, "queue tray keeps the source-derived 30dvh cap");
  assert.match(composer, /gap:\s*1px/, "queue rows retain the Codex 1px rhythm");
  assert.match(store, /workspaceClient\.sendTaskMessage\(projectId, taskId/, "Project live delivery uses the shared server queue adapter");
  assert.match(store, /workspaceClient\.sendChatMessage\(taskId/, "standalone live delivery uses the same message semantics");
});

test("Batch task creation reuses the shared Composer surface instead of a separate form treatment", async () => {
  const [workspace, workspaceCss] = await Promise.all([
    readFile(new URL("src/renderer/workspace/Workspace.tsx", root), "utf8"),
    readFile(new URL("src/renderer/workspace/workspace.css", root), "utf8"),
  ]);
  assert.match(workspace, /<ComposerScopeDisclosure/);
  assert.doesNotMatch(workspaceCss, /\.workspace-goal textarea/);
  assert.doesNotMatch(workspaceCss, /workspace-batch-composer-scope/);
});

test("the 480px shell keeps navigation, settings, CAT, and inspectors usable", async () => {
  const [workspace, sidebar, settings, cat, product] = await Promise.all([
    readFile(new URL("src/renderer/workspace/workspace.css", root), "utf8"),
    readFile(new URL("src/renderer/workspace/WorkspaceSidebar.tsx", root), "utf8"),
    readFile(new URL("src/renderer/settings/settings.css", root), "utf8"),
    readFile(new URL("src/renderer/cat/cat.css", root), "utf8"),
    readFile(new URL("src/renderer/shell/product-workspace.css", root), "utf8"),
  ]);
  assert.match(workspace, /@media \(max-width:\s*760px\)[\s\S]*\.workspace-shell,[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(workspace, /\.workspace-sidebar\s*\{[\s\S]*position:\s*fixed/);
  assert.match(sidebar, /dismissMobileOverlayAfterNavigation/);
  assert.match(sidebar, /window\.matchMedia\("\(max-width: 760px\)"\)/);
  assert.match(sidebar, /data-sidebar-navigation="true"/);
  assert.match(settings, /@media \(max-width:\s*600px\)[\s\S]*\.settings-workspace\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(cat, /@media \(max-width:\s*600px\)[\s\S]*\.cat-grid-header\s*\{\s*display:\s*none/);
  assert.match(cat, /grid-template-areas:\s*"number source"\s*"number target"\s*"number status"/);
  assert.match(product, /@container workspace-main \(max-width:\s*520px\)/);
  assert.match(product, /\.context-inspector[\s\S]*width:\s*calc\(100% - 32px\)/);
  assert.match(product, /container: thread-column \/ inline-size/, "the conversation column exposes its own width container for the 42rem narrow mode");
});
