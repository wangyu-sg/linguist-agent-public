import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  confirmAssistantMemory,
  formatAssistantMemoryRecall,
  formatAssistantMemoryRecallReport,
  listAssistantMemories,
  proposeAssistantMemory,
  revokeAssistantMemory,
  searchAssistantMemories,
  type AssistantMemoryScope,
  type LocalTextEmbedder,
} from "@linguist-agent/cat-data";

const root = await mkdtemp(join(tmpdir(), "la-assistant-memory-evolution-"));
const personal: AssistantMemoryScope = { kind: "personal" };
const client: AssistantMemoryScope = { kind: "client", clientId: "client-a" };
const franchise: AssistantMemoryScope = { kind: "franchise", franchiseId: "franchise-a" };
const project: AssistantMemoryScope = { kind: "project", projectId: "project-a" };
const locale: AssistantMemoryScope = { kind: "locale", locale: "zh-CN" };
const at = "2026-07-23T12:00:00.000Z";

const embedder: LocalTextEmbedder = {
  model: "test-local-e5",
  dim: 2,
  provider: "transformers.js",
  async embed(texts) {
    return texts.map((text) => text.includes("terminology") || text.includes("术语") ? [1, 0] : [0, 1]);
  },
  split(text) { return [text]; },
};

async function active(scope: AssistantMemoryScope, text: string, input: { conflictKey?: string; validFrom?: string; validUntil?: string } = {}) {
  const proposal = await proposeAssistantMemory(root, {
    scope,
    kind: "guidance",
    text,
    source: { taskId: `task-${scope.kind}` },
    conflictKey: input.conflictKey,
    validFrom: input.validFrom,
    validUntil: input.validUntil,
    now: at,
  });
  return confirmAssistantMemory(root, { scope, id: proposal.id, actor: "user", now: at });
}

try {
  const personalMemory = await active(personal, "Personal terminology preference.");
  const clientMemory = await active(client, "Client terminology preference.");
  const franchiseMemory = await active(franchise, "Franchise terminology preference.");
  const localeMemory = await active(locale, "Locale terminology preference.");
  const projectMemory = await active(project, "Project terminology preference.");
  const expired = await active(project, "Expired terminology preference.", { validFrom: "2026-07-21T12:00:00.000Z", validUntil: "2026-07-22T12:00:00.000Z" });

  const ordered = await searchAssistantMemories(root, {
    query: "terminology",
    context: { projectId: "project-a", clientId: "client-a", franchiseId: "franchise-a", locale: "zh-CN" },
    embedder,
    now: at,
  });
  assert.deepEqual(ordered.hits.map((hit) => hit.memory.id), [projectMemory.id, clientMemory.id, franchiseMemory.id, localeMemory.id, personalMemory.id]);
  assert.equal(ordered.hits.some((hit) => hit.memory.id === expired.id), false, "expired active memory must never recall");
  assert.equal(ordered.semantic.state, "ready");
  assert.equal(ordered.hits.every((hit) => hit.reason.includes("scope:")), true);
  assert.match(formatAssistantMemoryRecall(ordered.hits.map((hit) => hit.memory)), /never citable project evidence/);
  const promptSnapshot = formatAssistantMemoryRecallReport(ordered);
  assert.match(promptSnapshot, /semantic: local test-local-e5/);
  assert.match(promptSnapshot, /selection: scope:project; retrieval:hybrid; embedding:test-local-e5/);
  assert.match(promptSnapshot, /validity: from 2026-07-23T12:00:00.000Z; no expiry/);

  const fallback = await searchAssistantMemories(root, {
    query: "terminology",
    context: { projectId: "project-a" },
    now: at,
  });
  assert.equal(fallback.semantic.state, "lexical_only", "a missing managed pack must not be presented as semantic-ready");
  assert.match(fallback.semantic.message ?? "", /not installed/i);

  const firstConflict = await active(project, "Use Gem for 宝石.", { conflictKey: "item-term" });
  const secondProposal = await proposeAssistantMemory(root, {
    scope: project,
    kind: "guidance",
    text: "Use Jewel for 宝石.",
    source: { taskId: "task-conflict" },
    conflictKey: "item-term",
    now: at,
  });
  const conflictPending = (await listAssistantMemories(root, project)).find((memory) => memory.id === secondProposal.id);
  assert.deepEqual(conflictPending?.conflictsWith, [firstConflict.id]);
  const secondConflict = await confirmAssistantMemory(root, { scope: project, id: secondProposal.id, actor: "user", now: at });
  const unresolved = await searchAssistantMemories(root, { query: "宝石", context: { projectId: "project-a" }, embedder, now: at });
  assert.equal(unresolved.hits.some((hit) => hit.memory.id === firstConflict.id || hit.memory.id === secondConflict.id), false, "unresolved conflicts must not silently alter recall");
  assert.deepEqual(unresolved.conflicts[0]?.memoryIds.sort(), [firstConflict.id, secondConflict.id].sort());

  const resolvedProposal = await proposeAssistantMemory(root, {
    scope: project,
    kind: "guidance",
    text: "Use Gemstone for 宝石.",
    source: { taskId: "task-resolve" },
    conflictKey: "item-term",
    now: at,
  });
  const resolved = await confirmAssistantMemory(root, {
    scope: project,
    id: resolvedProposal.id,
    actor: "user",
    supersedes: [firstConflict.id, secondConflict.id],
    now: at,
  });
  const afterResolution = await searchAssistantMemories(root, { query: "宝石", context: { projectId: "project-a" }, embedder, now: at });
  assert.equal(afterResolution.hits.some((hit) => hit.memory.id === resolved.id), true);
  assert.equal((await listAssistantMemories(root, project)).find((memory) => memory.id === firstConflict.id)?.status, "superseded");
  assert.equal((await listAssistantMemories(root, project)).find((memory) => memory.id === secondConflict.id)?.status, "superseded");

  const revoked = await revokeAssistantMemory(root, { scope: project, id: resolved.id, actor: "user", now: at });
  assert.equal(revoked.status, "revoked");
  assert.equal((await searchAssistantMemories(root, { query: "宝石", context: { projectId: "project-a" }, embedder, now: at })).hits.some((hit) => hit.memory.id === resolved.id), false);

  console.log("assistant memory evolution tests passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
