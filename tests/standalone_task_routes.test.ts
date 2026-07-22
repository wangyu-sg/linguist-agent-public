import { strict as assert } from "node:assert";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdir, mkdtemp, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTaskWorkspace } from "@linguist-agent/cat-data";
import { handleHomeReplacementRoute } from "../packages/cat-server/src/routes/home_replacement_routes.js";
import {
  handleStandaloneTaskRoute,
  type AcceptedStandaloneMessage,
} from "../packages/cat-server/src/routes/standalone_task_routes.js";

const root = await mkdtemp(join(tmpdir(), "la-standalone-task-routes-"));
let acceptedMessage: {
  taskId: string;
  message: string;
  delivery?: "auto" | "steer" | "follow_up";
  modelProvider?: string;
  modelId?: string;
  thinkingLevel?: string;
} | undefined;

async function request(
  method: string,
  path: string,
  body: unknown = {},
  accepted?: AcceptedStandaloneMessage,
  activeTaskId?: string,
): Promise<{ status: number; data: any }> {
  const url = new URL(path, "http://127.0.0.1");
  const parts = url.pathname.split("/").filter(Boolean);
  const req = Object.assign(new EventEmitter(), { method }) as IncomingMessage;
  let output: { status: number; data: any } | undefined;
  const handled = await handleStandaloneTaskRoute(req, {} as ServerResponse, url, parts, {
    repoRoot: root,
    json: (_res, status, data) => { output = { status, data }; },
    readBody: async () => body,
    ...(accepted ? {
      acceptMessage: async (input) => {
        acceptedMessage = input;
        return accepted;
      },
    } : {}),
    hasActiveRun: (taskId) => taskId === activeTaskId,
  });
  assert.equal(handled, true);
  assert.ok(output);
  return output;
}

try {
  const workspace = createTaskWorkspace(root, { now: () => "2026-07-20T04:00:00.000Z" });
  await workspace.create({
    projectId: "project-one",
    taskId: "same-id",
    title: "Project Task",
    intent: "Must remain isolated",
    kind: "general",
  });

  const created = await request("POST", "/api/tasks", { taskId: "same-id" });
  assert.equal(created.status, 201);
  assert.equal(created.data.task.title, "New chat");
  assert.deepEqual(created.data.task.owner, { kind: "standalone" });
  assert.deepEqual(created.data.task.scope, {
    kind: "standalone",
    workingDirectoryGrantId: undefined,
    fileGrantIds: [],
  });
  assert.equal((await workspace.open({ kind: "project", projectId: "project-one", taskId: "same-id" })).task.title, "Project Task");

  const forbiddenScope = await request("POST", "/api/tasks", {
    title: "Forged scope",
    projectId: "project-one",
    segmentIds: ["row-one"],
  });
  assert.equal(forbiddenScope.status, 400);
  assert.match(forbiddenScope.data.error, /cannot accept Project or authoritative scope fields/);
  assert.equal((await request("POST", "/api/tasks", { title: "Wrong kind", kind: "translation" })).status, 400);
  assert.equal((await request("POST", "/api/tasks", { title: "   " })).status, 400);
  assert.equal((await request("POST", "/api/tasks", { initialMessage: "Do this now" })).status, 400);

  const listed = await request("GET", "/api/tasks");
  assert.equal(listed.status, 200);
  assert.equal(listed.data.schemaVersion, 2);
  assert.deepEqual(listed.data.tasks.map((task: { id: string }) => task.id), ["same-id"]);

  const renamed = await request("PATCH", "/api/tasks/same-id", { title: "General research" });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.data.task.title, "General research");
  assert.equal((await request("PATCH", "/api/tasks/same-id", { title: "   " })).status, 400);
  assert.equal((await request("GET", "/api/tasks/same-id")).data.task.owner.kind, "standalone");
  assert.equal((await request("GET", "/api/tasks/same-id/probe")).data.kind, "standalone");
  assert.equal((await stat(join(root, "data", "assistant", "tasks", "same-id", "workspace", "attachments"))).isDirectory(), true);

  const grantedFile = join(root, "user-file.txt");
  const grantedDirectory = join(root, "user-directory");
  const linkedFile = join(root, "linked-file.txt");
  await writeFile(grantedFile, "evidence", "utf8");
  await mkdir(grantedDirectory);
  await symlink(grantedFile, linkedFile);
  const fileGrant = await request("POST", "/api/tasks/same-id/file-grants", {
    path: linkedFile,
    kind: "file",
    access: "read",
  });
  assert.equal(fileGrant.status, 201);
  assert.equal(fileGrant.data.grant.realPath, await realpath(grantedFile), "a grant stores the canonical realpath rather than a symlink alias");
  assert.match(fileGrant.data.grant.fingerprint, /^[a-f0-9]{64}$/);
  const duplicateGrant = await request("POST", "/api/tasks/same-id/file-grants", {
    path: grantedFile,
    kind: "file",
    access: "read",
  });
  assert.equal(duplicateGrant.data.grant.id, fileGrant.data.grant.id, "equivalent active grants are idempotent");
  const directoryGrant = await request("POST", "/api/tasks/same-id/file-grants", {
    path: grantedDirectory,
    kind: "directory",
    access: "read_write",
    recursive: true,
  });
  assert.equal(directoryGrant.status, 201);
  assert.equal((await request("GET", "/api/tasks/same-id/file-grants")).data.grants.length, 2);
  assert.equal((await request("POST", "/api/tasks/same-id/working-directory", { grantId: fileGrant.data.grant.id })).status, 400);
  assert.equal(
    (await request("POST", "/api/tasks/same-id/working-directory", { grantId: directoryGrant.data.grant.id }, undefined, "same-id")).status,
    409,
    "a running Chat must keep its cwd-bound Pi session stable",
  );
  const changedWorkingDirectory = await request("POST", "/api/tasks/same-id/working-directory", { grantId: directoryGrant.data.grant.id });
  assert.equal(changedWorkingDirectory.status, 200);
  assert.equal(changedWorkingDirectory.data.task.scope.workingDirectoryGrantId, directoryGrant.data.grant.id);
  const revokedDirectory = await request("DELETE", `/api/tasks/same-id/file-grants/${directoryGrant.data.grant.id}`);
  assert.equal(revokedDirectory.status, 200);
  assert.equal((await request("GET", "/api/tasks/same-id")).data.task.scope.workingDirectoryGrantId, undefined);
  assert.equal((await request("GET", "/api/tasks/same-id/file-grants")).data.grants.length, 1);

  const events = await request("GET", "/api/tasks/same-id/events");
  assert.equal(events.status, 200);
  assert.deepEqual(events.data.events, []);
  assert.equal(events.data.nextCursor, "same-id:0");

  const unavailableMessage = await request("POST", "/api/tasks/same-id/messages", { message: "Hello" });
  assert.equal(unavailableMessage.status, 503);
  assert.equal(unavailableMessage.data.error.code, "general_runtime_unavailable");
  assert.equal((await workspace.open({ kind: "standalone", taskId: "same-id" })).runs.length, 0, "an unavailable runtime must not create a hidden Run");

  const accepted: AcceptedStandaloneMessage = {
    messageId: "message-one",
    runId: "run-one",
    delivery: "start",
  };
  const acceptedResponse = await request("POST", "/api/tasks/same-id/messages", {
    message: "  Research this  ",
    delivery: "auto",
  }, accepted);
  assert.equal(acceptedResponse.status, 202);
  assert.deepEqual(acceptedResponse.data, accepted);
  assert.deepEqual(acceptedMessage, { taskId: "same-id", message: "Research this", delivery: "auto" });
  const selectedModelResponse = await request("POST", "/api/tasks/same-id/messages", {
    message: "Use the selected model",
    modelProvider: "fixture",
    modelId: "model-two",
    thinkingLevel: "high",
  }, accepted);
  assert.equal(selectedModelResponse.status, 202);
  assert.deepEqual(acceptedMessage, {
    taskId: "same-id",
    message: "Use the selected model",
    delivery: "auto",
    modelProvider: "fixture",
    modelId: "model-two",
    thinkingLevel: "high",
  });
  const incompleteModelSelection = await request("POST", "/api/tasks/same-id/messages", {
    message: "This must fail",
    modelProvider: "fixture",
  }, accepted);
  assert.equal(incompleteModelSelection.status, 400);
  assert.match(incompleteModelSelection.data.error, /modelProvider and modelId/);

  const streamURL = new URL("/api/tasks/same-id/messages/stream", "http://127.0.0.1");
  const streamReq = Object.assign(new EventEmitter(), { method: "POST" }) as IncomingMessage;
  const streamChunks: string[] = [];
  let streamStatus = 0;
  let streamEnded = false;
  const streamRes = Object.assign(new EventEmitter(), {
    writableEnded: false,
    writeHead: (status: number) => { streamStatus = status; },
    flushHeaders: () => undefined,
    write: (chunk: unknown) => { streamChunks.push(String(chunk)); return true; },
    end: () => { streamEnded = true; streamRes.writableEnded = true; },
  }) as unknown as ServerResponse & { writableEnded: boolean };
  let emitLive: ((event: { type: string; taskId: string; runId: string; ts: string; text?: string }) => void) | undefined;
  let streamedInput: typeof acceptedMessage;
  const streamed = await handleStandaloneTaskRoute(streamReq, streamRes, streamURL, streamURL.pathname.split("/").filter(Boolean), {
    repoRoot: root,
    json: () => assert.fail("the live response must stay an SSE stream"),
    readBody: async () => ({ message: "Stream this response", modelProvider: "fixture", modelId: "stream-model", thinkingLevel: "medium" }),
    acceptMessage: async (input) => {
      streamedInput = input;
      return accepted;
    },
    subscribeMessageStream: (_taskId, listener) => {
      emitLive = listener;
      return () => undefined;
    },
  });
  assert.equal(streamed, true);
  assert.equal(streamStatus, 200);
  assert.ok(emitLive);
  emitLive({ type: "assistant_thinking_started", taskId: "same-id", runId: "run-one", ts: "2026-07-20T04:00:00.500Z" });
  emitLive({ type: "assistant_delta", taskId: "same-id", runId: "run-one", ts: "2026-07-20T04:00:01.000Z", text: "Actual token" });
  emitLive({ type: "done", taskId: "same-id", runId: "run-one", ts: "2026-07-20T04:00:02.000Z" });
  assert.equal(streamEnded, true);
  assert.match(streamChunks.join(""), /"type":"accepted"/);
  assert.match(streamChunks.join(""), /"type":"assistant_thinking_started"/);
  assert.doesNotMatch(streamChunks.join(""), /Thinking token/);
  assert.match(streamChunks.join(""), /"type":"assistant_delta"/);
  assert.deepEqual(streamedInput, {
    taskId: "same-id",
    message: "Stream this response",
    delivery: "auto",
    modelProvider: "fixture",
    modelId: "stream-model",
    thinkingLevel: "medium",
  });

  const unavailableFork = await request("POST", "/api/tasks/same-id/forks", {});
  assert.equal(unavailableFork.status, 503);
  assert.equal(unavailableFork.data.error.code, "general_runtime_unavailable");

  const handedOff = await request("POST", "/api/tasks/same-id/handoff", { title: "Research continuation" });
  assert.equal(handedOff.status, 201);
  assert.equal(handedOff.data.task.title, "Research continuation");
  assert.equal(handedOff.data.task.owner.kind, "standalone");
  assert.equal(handedOff.data.artifacts[0].type, "context_handoff");
  assert.equal(handedOff.data.artifacts[0].status, "accepted");
  assert.equal(handedOff.data.artifacts[0].content.sourceTaskId, "same-id");

  assert.equal((await request("POST", "/api/tasks/same-id/archive")).data.task.status, "archived");
  assert.equal((await request("POST", "/api/tasks/same-id/restore")).data.task.status, "draft");
  assert.equal((await request("GET", "/api/tasks/missing")).status, 404);

  for (const [method, path, expectedStatus] of [
    ["GET", "/api/home/chat", 200],
    ["POST", "/api/home/chat", 410],
    ["POST", "/api/home/chat/stream", 410],
    ["POST", "/api/home/stop", 410],
  ] as const) {
    const url = new URL(path, "http://127.0.0.1");
    let output: { status: number; data: any } | undefined;
    const handled = await handleHomeReplacementRoute(
      Object.assign(new EventEmitter(), { method }) as IncomingMessage,
      {} as ServerResponse,
      url.pathname.split("/").filter(Boolean),
      {
        json: (_res, status, data) => { output = { status, data }; },
        migratedTaskId: () => "legacy-home-one",
      },
    );
    assert.equal(handled, true);
    assert.equal(output?.status, expectedStatus);
    if (method === "GET") assert.deepEqual(output?.data, { taskId: "legacy-home-one" });
    else assert.equal(output?.data.error.code, "home_replaced");
  }

  console.log("standalone Task route tests passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
