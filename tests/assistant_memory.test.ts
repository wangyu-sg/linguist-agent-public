import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  confirmAssistantMemory,
  editAssistantMemory,
  formatAssistantMemoryRecall,
  listAssistantMemories,
  proposeAssistantMemory,
  revokeAssistantMemory,
  type AssistantMemoryScope,
} from "@linguist-agent/cat-data";
import { createAssistantMemoryTools } from "@linguist-agent/cat-tools";

const root = await mkdtemp(join(tmpdir(), "la-assistant-memory-"));
const personal: AssistantMemoryScope = { kind: "personal" };
const projectA: AssistantMemoryScope = { kind: "project", projectId: "project-a" };
const projectB: AssistantMemoryScope = { kind: "project", projectId: "project-b" };

try {
  const proposal = await proposeAssistantMemory(root, {
    scope: personal,
    kind: "preference",
    text: "Use concise answers unless I ask for detail.",
    source: { taskId: "chat-one", activityId: "activity-one" },
  });
  assert.equal(proposal.status, "proposed");
  assert.equal(formatAssistantMemoryRecall(await listAssistantMemories(root, personal)), "", "a proposal is not recalled before explicit confirmation");

  const confirmed = await confirmAssistantMemory(root, { scope: personal, id: proposal.id, actor: "user" });
  assert.equal(confirmed.status, "active");
  assert.deepEqual(confirmed.history.map((entry) => entry.action), ["proposed", "confirmed"]);
  assert.match(formatAssistantMemoryRecall(await listAssistantMemories(root, personal)), /concise answers/);

  const edited = await editAssistantMemory(root, {
    scope: personal,
    id: proposal.id,
    expectedRevision: confirmed.revision,
    text: "Use concise Chinese answers unless I ask for detail.",
    actor: "user",
  });
  assert.equal(edited.revision, confirmed.revision + 1);
  assert.equal(edited.history.at(-1)?.action, "edited");
  assert.equal(edited.history.at(-1)?.previousText, confirmed.text);

  await proposeAssistantMemory(root, {
    scope: projectA,
    kind: "guidance",
    text: "Use Thunder Damage for 闪电伤害.",
    source: { taskId: "project-task" },
  }).then((entry) => confirmAssistantMemory(root, { scope: projectA, id: entry.id, actor: "user" }));
  await proposeAssistantMemory(root, {
    scope: projectB,
    kind: "fact",
    text: "SECRET_B_ONLY",
    source: { taskId: "project-b-task" },
  }).then((entry) => confirmAssistantMemory(root, { scope: projectB, id: entry.id, actor: "user" }));

  const projectARecall = formatAssistantMemoryRecall(await listAssistantMemories(root, projectA));
  assert.match(projectARecall, /Thunder Damage/);
  assert.doesNotMatch(projectARecall, /SECRET_B_ONLY/);

  const revoked = await revokeAssistantMemory(root, { scope: personal, id: proposal.id, actor: "user" });
  assert.equal(revoked.status, "revoked");
  assert.equal(revoked.history.at(-1)?.action, "revoked");
  assert.equal(formatAssistantMemoryRecall(await listAssistantMemories(root, personal)), "");

  const tools = createAssistantMemoryTools({ runtimeRoot: root, scope: personal, sourceTaskId: "chat-tool", personalOnly: true });
  const recallEntry = await proposeAssistantMemory(root, {
    scope: personal,
    kind: "guidance",
    text: "Use compact headings for remembered UI guidance.",
    source: { taskId: "chat-recall" },
  }).then((entry) => confirmAssistantMemory(root, { scope: personal, id: entry.id, actor: "user" }));
  const searchTool = tools.find((tool) => tool.name === "assistant_memory_search");
  assert.ok(searchTool);
  const searchResult = await searchTool.execute("call-search", { query: "compact headings" } as never);
  assert.match(searchResult.content[0]?.type === "text" ? searchResult.content[0].text : "", new RegExp(recallEntry.id));
  assert.equal(searchResult.details.semantic.state, "lexical_only", "a missing local pack must be surfaced as lexical-only to the Agent");
  const proposeTool = tools.find((tool) => tool.name === "assistant_memory_propose");
  assert.ok(proposeTool);
  const toolResult = await proposeTool.execute("call-one", { kind: "fact", text: "My timezone is Asia/Singapore." } as never);
  assert.match(toolResult.content[0]?.type === "text" ? toolResult.content[0].text : "", /awaiting explicit user confirmation/);
  const toolProposal = (await listAssistantMemories(root, personal)).find((entry) => entry.source.taskId === "chat-tool");
  assert.equal(toolProposal?.status, "proposed");
  assert.doesNotMatch(formatAssistantMemoryRecall(await listAssistantMemories(root, personal)), /Asia\/Singapore/);

  console.log("assistant_memory tests passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
