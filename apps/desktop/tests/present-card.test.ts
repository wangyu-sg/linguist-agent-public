import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("agent_present artifacts render as timeline answer cards reusing the canonical block renderer", async () => {
  const [component, preview, items] = await Promise.all([
    readFile(new URL("src/renderer/conversation/ConversationItems.tsx", root), "utf8"),
    readFile(new URL("src/renderer/inspector/RichArtifactPreview.tsx", root), "utf8"),
    readFile(new URL("src/renderer/conversation/conversation-items.css", root), "utf8"),
  ]);
  assert.match(component, /item\.artifact\.type === "agent_present"/, "present artifacts bypass the generic artifact card");
  assert.match(component, /function PresentCard/);
  assert.match(component, /agentPresentDocument\(artifact\)/, "the card parses the canonical document through the pure model");
  assert.match(component, /if \(!document\) return null/, "invalid or missing documents render nothing instead of a fabricated card");
  assert.match(component, /<RichArtifactBlockView key=\{block\.id\} block=\{block\} \/>/, "blocks pass through untouched to the shared canonical renderer");
  assert.match(preview, /export function RichArtifactBlockView/, "the canonical block renderer is exported for the timeline");
  assert.match(component, /useState<"preview" \| "expanded">\("expanded"\)/, "answer cards default to expanded");
  assert.match(component, /aria-expanded=\{state === "expanded"\}/, "the header toggles the body");
  assert.match(component, /onInspect\?\.\(artifact\)/, "the inspect affordance opens the canonical artifact");
  assert.match(items, /\.conversation-present-card__body\s*\{[\s\S]*?max-height/, "preview caps the body height");
  assert.match(items, /\.conversation-present-card\[data-state="expanded"\] \.conversation-present-card__body\s*\{[\s\S]*?overflow-y:\s*auto/, "expanded scrolls instead of truncating");
  assert.match(items, /\.conversation-present-card\[data-state="expanded"\] \.conversation-present-card__chevron\s*\{[\s\S]*?rotate\(90deg\)/, "chevron rotates when expanded");
});
