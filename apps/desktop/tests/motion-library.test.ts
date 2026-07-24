import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("the loading shimmer sweeps with the spec steps(48) cadence", async () => {
  const items = await readFile(new URL("src/renderer/conversation/conversation-items.css", root), "utf8");
  assert.match(items, /animation:\s*loading-shimmer 2s steps\(48, end\) infinite/, "shimmer keeps the 2s steps(48) cadence");
});

test("a token-owned pulse exists and the pending-permission badge consumes it", async () => {
  const [tokens, base, workspace] = await Promise.all([
    readFile(new URL("src/renderer/styles/tokens.css", root), "utf8"),
    readFile(new URL("src/renderer/styles/base.css", root), "utf8"),
    readFile(new URL("src/renderer/workspace/workspace.css", root), "utf8"),
  ]);
  assert.match(tokens, /--la-animate-pulse:\s*la-pulse 2s cubic-bezier\(\.4, 0, \.6, 1\) infinite/);
  assert.match(base, /@keyframes la-pulse\s*\{[\s\S]*?50%\s*\{\s*opacity:\s*0?\.5\s*;?\s*\}/);
  assert.match(workspace, /\.workspace-task-pending-badge\s*\{[\s\S]*?animation:\s*var\(--la-animate-pulse\)/, "pending approval badge pulses until decided");
});

test("the scroll edge-fade system is @property-driven and the queue tray consumes it", async () => {
  const [base, queue] = await Promise.all([
    readFile(new URL("src/renderer/styles/base.css", root), "utf8"),
    readFile(new URL("src/renderer/composer/QueuedMessageList.tsx", root), "utf8"),
  ]);
  assert.match(base, /@property --la-top-fade\s*\{[\s\S]*?syntax:\s*"<length>"/);
  assert.match(base, /@property --la-bottom-fade\s*\{[\s\S]*?syntax:\s*"<length>"/);
  assert.match(base, /@keyframes la-edge-fade\s*\{[\s\S]*?--la-top-fade:\s*0rem[\s\S]*?--la-bottom-fade:\s*1rem/);
  assert.match(base, /\.la-scroll-fade-y\s*\{[\s\S]*?animation:\s*la-edge-fade linear both[\s\S]*?animation-timeline:\s*scroll\(self block\)[\s\S]*?mask-image:\s*linear-gradient\(to bottom/);
  assert.match(queue, /className="queued-message-list__scroll la-scroll-fade-y"/, "the queue tray scrolls with the spec edge fade");
});
