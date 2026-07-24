import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("agent_plan artifacts render as the spec Plan card with progress summary and todo rows", async () => {
  const [component, items] = await Promise.all([
    readFile(new URL("src/renderer/conversation/ConversationItems.tsx", root), "utf8"),
    readFile(new URL("src/renderer/conversation/conversation-items.css", root), "utf8"),
  ]);
  assert.match(component, /item\.artifact\.type === "agent_plan"/, "plan artifacts bypass the generic artifact card");
  assert.match(component, /function PlanCard/);
  assert.match(component, /已创建包含 \$\{progress\.total\} 项的计划/, "zero-completed summary sentence");
  assert.match(component, /共 \$\{progress\.total\} 项，已完成 \$\{progress\.completed\} 项/, "progress summary sentence");
  assert.match(component, /aria-expanded=\{state === "expanded"\}/, "the header toggles the body");
  assert.match(component, /data-status=\{item\.status\}/, "todo rows expose their status");
  assert.match(
    items,
    /\.conversation-plan-card__todo\[data-status="completed"\] \.conversation-plan-card__todo-text\s*\{[\s\S]*?text-decoration:\s*line-through/,
    "completed todos render with strikethrough",
  );
  assert.match(items, /\.conversation-plan-card__body\s*\{[\s\S]*?max-height:\s*7rem/, "preview caps at the spec 7rem");
  assert.match(items, /\.conversation-plan-card\[data-state="expanded"\] \.conversation-plan-card__body\s*\{[\s\S]*?max-height:\s*20rem/, "expanded caps at the spec 20rem");
  assert.match(items, /\.conversation-plan-card\[data-state="expanded"\] \.conversation-plan-card__chevron\s*\{[\s\S]*?rotate\(90deg\)/, "chevron rotates when expanded");
});

test("the Step pill above the composer reads the latest plan with a progress ring", async () => {
  const [conversation, component, items] = await Promise.all([
    readFile(new URL("src/renderer/conversation/TaskConversation.tsx", root), "utf8"),
    readFile(new URL("src/renderer/conversation/ConversationItems.tsx", root), "utf8"),
    readFile(new URL("src/renderer/conversation/conversation-items.css", root), "utf8"),
  ]);
  assert.match(conversation, /latestAgentPlan\(snapshot\)/, "the pill derives from the canonical snapshot");
  assert.match(conversation, /<ConversationPlanPill/);
  assert.match(component, /Step \{progress\.currentStep\} \/ \{progress\.total\}/);
  assert.match(component, /strokeDashoffset=\{planRingDashoffset\(progress\)\}/, "the ring tracks completion");
  assert.match(component, /conversation-plan-pill__dot/, "all-complete falls back to the spec blue dot");
  assert.match(items, /\.conversation-plan-pill__popover\s*\{[\s\S]*?opacity:\s*0/, "the full plan lives in a reveal popover");
  assert.match(items, /\.conversation-plan-pill:hover \.conversation-plan-pill__popover,[\s\S]*?\.conversation-plan-pill:focus-within \.conversation-plan-pill__popover\s*\{[\s\S]*?opacity:\s*1/, "hover and focus reveal the plan");
});
