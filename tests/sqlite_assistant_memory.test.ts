import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assistantMemoryPath,
  confirmAssistantMemory,
  editAssistantMemory,
  listAssistantMemories,
  proposeAssistantMemory,
  revokeAssistantMemory,
  type AssistantMemoryScope,
} from "@linguist-agent/cat-data";
import {
  prepareAssistantMemorySqliteCutover,
  type AssistantMemorySqliteAuthority,
} from "../packages/cat-server/src/assistant_memory_sqlite_cutover.js";

const root = await mkdtemp(join(tmpdir(), "la-sqlite-assistant-memory-"));
const personal: AssistantMemoryScope = { kind: "personal" };
const project: AssistantMemoryScope = { kind: "project", projectId: "project-a" };
const client: AssistantMemoryScope = { kind: "client", clientId: "client-a" };
const authority: AssistantMemorySqliteAuthority = { assertOwned: async () => undefined };

try {
  await mkdir(join(root, "data", "projects", "project-a", "memory"), { recursive: true });
  await mkdir(join(root, "data", "assistant", "memory"), { recursive: true });
  await writeFile(assistantMemoryPath(root, personal), JSON.stringify({
    schemaVersion: 1,
    scope: personal,
    entries: [{
      id: "memory-legacy-personal",
      scope: personal,
      kind: "preference",
      text: "Keep confirmed answers concise.",
      status: "active",
      source: { taskId: "legacy-task", activityId: "legacy-activity" },
      revision: 2,
      createdAt: "2026-07-23T00:00:00.000Z",
      updatedAt: "2026-07-23T00:00:02.000Z",
      confirmedAt: "2026-07-23T00:00:01.000Z",
      history: [
        { revision: 1, action: "proposed", actor: "agent", at: "2026-07-23T00:00:00.000Z", text: "Keep answers concise.", kind: "preference" },
        { revision: 2, action: "confirmed", actor: "user", at: "2026-07-23T00:00:01.000Z", text: "Keep confirmed answers concise.", kind: "preference" },
      ],
    }],
    updatedAt: "2026-07-23T00:00:02.000Z",
  }));
  await writeFile(assistantMemoryPath(root, project), JSON.stringify({
    schemaVersion: 1,
    scope: project,
    entries: [],
    updatedAt: "1970-01-01T00:00:00.000Z",
  }));

  const prepared = await prepareAssistantMemorySqliteCutover({ root, authority, activeRunCount: 0 });
  assert.equal(prepared.status, "cutover");
  assert.equal(prepared.marker.authority, "sqlite");
  assert.equal(prepared.marker.scopes.length, 2);

  const imported = await listAssistantMemories(root, personal, { store: prepared.store });
  assert.deepEqual(imported[0], JSON.parse((await readFile(assistantMemoryPath(root, personal))).toString()).entries[0]);

  const proposal = await proposeAssistantMemory(root, {
    scope: project,
    kind: "guidance",
    text: "Use the approved client glossary.",
    source: { taskId: "task-1", artifactId: "artifact-1" },
    now: "2026-07-23T00:01:00.000Z",
    store: prepared.store,
  });
  assert.equal(proposal.status, "proposed");
  assert.equal(proposal.revision, 1);
  assert.equal(proposal.history[0]?.action, "proposed");

  const confirmed = await confirmAssistantMemory(root, {
    scope: project,
    id: proposal.id,
    actor: "user",
    now: "2026-07-23T00:01:01.000Z",
    store: prepared.store,
  });
  assert.equal(confirmed.status, "active");
  assert.equal(confirmed.revision, 2);

  const edited = await editAssistantMemory(root, {
    scope: project,
    id: proposal.id,
    expectedRevision: 2,
    text: "Use only the approved client glossary.",
    actor: "user",
    now: "2026-07-23T00:01:02.000Z",
    store: prepared.store,
  });
  assert.equal(edited.revision, 3);
  assert.equal(edited.history.at(-1)?.previousText, confirmed.text);

  const revoked = await revokeAssistantMemory(root, {
    scope: project,
    id: proposal.id,
    actor: "user",
    now: "2026-07-23T00:01:03.000Z",
    store: prepared.store,
  });
  assert.equal(revoked.status, "revoked");
  assert.equal(revoked.revision, 4);
  assert.equal(revoked.history.map((entry) => entry.action).join(","), "proposed,confirmed,edited,revoked");

  const personalAgain = await listAssistantMemories(root, personal, { store: prepared.store });
  const projectAgain = await listAssistantMemories(root, project, { store: prepared.store });
  assert.equal(personalAgain.length, 1);
  assert.equal(projectAgain.length, 1);
  assert.equal(projectAgain[0]?.status, "revoked");

  const clientProposal = await proposeAssistantMemory(root, {
    scope: client,
    kind: "guidance",
    text: "Client scope remains in the same SQLite authority.",
    source: { taskId: "client-task" },
    store: prepared.store,
  });
  const clientConfirmed = await confirmAssistantMemory(root, { scope: client, id: clientProposal.id, actor: "user", store: prepared.store });
  assert.equal(clientConfirmed.status, "active");

  await assert.rejects(
    () => proposeAssistantMemory(root, {
      scope: personal,
      kind: "fact",
      text: "This must not use the legacy writer.",
      source: { taskId: "legacy-write" },
    }),
    /SQLite assistant memory storage is authoritative/,
  );

  const reopened = await prepareAssistantMemorySqliteCutover({ root, authority, activeRunCount: 0 });
  assert.equal(reopened.status, "already-sqlite");
  assert.deepEqual(await listAssistantMemories(root, project, { store: reopened.store }), projectAgain);
  assert.equal((await listAssistantMemories(root, client, { store: reopened.store }))[0]?.id, clientProposal.id);
  prepared.close();
  reopened.close();
  console.log("SQLite assistant memory tests passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
