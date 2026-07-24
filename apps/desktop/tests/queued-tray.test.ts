import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("queued rows enter with the spec 0.18s-class opacity/spatial transition", async () => {
  const composer = await readFile(new URL("src/renderer/composer/composer.css", root), "utf8");
  assert.match(composer, /@keyframes queued-row-enter\s*\{[\s\S]*?opacity:\s*0/, "row entry starts transparent");
  assert.match(composer, /@keyframes queued-row-enter\s*\{[\s\S]*?translateY\(-2px\)/, "row entry keeps the spatial cue without measured-height wrappers");
  assert.match(
    composer,
    /\.queued-message-list__row\s*\{[\s\S]*?animation:\s*queued-row-enter var\(--la-duration-micro\)/,
    "rows animate in on the micro duration token",
  );
});

test("the row being edited dims its non-editor chrome per spec", async () => {
  const [queue, composer] = await Promise.all([
    readFile(new URL("src/renderer/composer/QueuedMessageList.tsx", root), "utf8"),
    readFile(new URL("src/renderer/composer/composer.css", root), "utf8"),
  ]);
  assert.match(queue, /data-editing=\{editingId === message\.id \? "true" : undefined\}/, "the editing row exposes its state");
  assert.match(
    composer,
    /\.queued-message-list__row\[data-editing="true"\] \.queued-message-list__handle,[\s\S]*?\.queued-message-list__actions[\s\S]*?\{\s*opacity:\s*0\.6;\s*pointer-events:\s*none;/,
    "handle and actions dim to 0.6 while the editor stays interactive",
  );
});

test("queued message actions carry the spec group label", async () => {
  const queue = await readFile(new URL("src/renderer/composer/QueuedMessageList.tsx", root), "utf8");
  assert.match(queue, /className="queued-message-list__actions"[\s\S]*?aria-label="Queued message actions"|aria-label="Queued message actions"[\s\S]*?className="queued-message-list__actions"/);
});
