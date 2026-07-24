import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProjectManifest, createWorkspace, FileCapabilityBroker } from "@linguist-agent/cat-data";
import { buildAgentPermissionContract, createGeneralRuntimeExtension, guardProjectFileCapabilities } from "@linguist-agent/cat-runtime";
import type { ExtensionAPI, ToolCallEventResult } from "@earendil-works/pi-coding-agent";

const root = await mkdtemp(join(tmpdir(), "la-file-broker-"));
try {
  const project = join(root, "project");
  const output = join(root, "output");
  const outside = join(root, "outside");
  await Promise.all([mkdir(project), mkdir(output), mkdir(outside)]);
  await writeFile(join(project, "source.txt"), "source");
  await writeFile(join(outside, "secret.txt"), "secret");
  await symlink(outside, join(project, "escape"), "dir");

  const broker = await FileCapabilityBroker.create({
    cwd: project,
    grants: [
      { id: "project", rootPath: project, kind: "directory", recursive: true, operations: ["read", "list", "search"] },
      { id: "output", rootPath: output, kind: "directory", recursive: true, operations: ["read", "write", "list", "search"] },
    ],
  });

  assert.equal((await broker.authorizePath("source.txt", "read")).grantId, "project");
  assert.equal((await broker.authorizePath(project, "list")).grantId, "project");
  assert.equal((await broker.authorizePath(project, "search")).grantId, "project");
  await assert.rejects(() => broker.authorizePath(join(outside, "secret.txt"), "read"), /FILE_CAPABILITY_DENIED/);
  await assert.rejects(() => broker.authorizePath(join(project, "escape", "secret.txt"), "read"), /FILE_CAPABILITY_DENIED/);
  await assert.rejects(() => broker.authorizePath(join(project, "escape", "new.txt"), "write"), /FILE_CAPABILITY_DENIED/);
  await assert.rejects(() => broker.authorizePath(join(project, "new.txt"), "write"), /FILE_CAPABILITY_DENIED/);
  assert.equal((await broker.authorizePath(join(output, "new.txt"), "write")).grantId, "output");

  const nested = await broker.authorizeToolInput({
    filesystem: { operations: ["read"], scope: "workspace-or-explicit-grant" },
  }, { params: { files: [{ filePath: join(outside, "secret.txt") }] } });
  assert.equal(nested.allowed, false);
  assert.match(nested.reason ?? "", /FILE_CAPABILITY_DENIED/);

  const afterRevocation = await FileCapabilityBroker.create({ cwd: project, grants: [] });
  await assert.rejects(() => afterRevocation.authorizePath(join(project, "source.txt"), "read"), /FILE_CAPABILITY_DENIED/);

  let toolCall: ((event: { toolName: string; input: unknown }) => Promise<ToolCallEventResult | undefined>) | undefined;
  let activeGrants = [{
    id: "outside-read",
    taskId: "task",
    kind: "directory" as const,
    realPath: outside,
    access: "read" as const,
    recursive: true,
    createdAt: new Date(0).toISOString(),
    fingerprint: "0".repeat(64),
  }];
  createGeneralRuntimeExtension({
    access: async () => ({ workspaceRoot: project, workingDirectory: project, grants: activeGrants }),
    contract: buildAgentPermissionContract({ mode: "auto" }),
    sessionId: () => "session",
  })({
    on: (event: string, handler: typeof toolCall) => {
      if (event === "tool_call") toolCall = handler;
    },
  } as unknown as ExtensionAPI);
  assert.ok(toolCall);
  assert.equal(await toolCall({ toolName: "read", input: { path: join(outside, "secret.txt") } }), undefined);
  assert.match((await toolCall({ toolName: "write", input: { path: join(outside, "new.txt") } }))?.reason ?? "", /FILE_CAPABILITY_DENIED/);
  activeGrants = [];
  assert.match((await toolCall({ toolName: "read", input: { path: join(outside, "secret.txt") } }))?.reason ?? "", /FILE_CAPABILITY_DENIED/);

  await createProjectManifest(root, project, {
    projectId: "broker-project",
    sourceLanguage: "en",
    targetLanguage: "zh-CN",
  });
  const catWorkspace = createWorkspace(root, "broker-project");
  assert.equal(await guardProjectFileCapabilities({ toolName: "read", input: { path: join(project, "source.txt") } }, catWorkspace), undefined);
  assert.match((await guardProjectFileCapabilities({ toolName: "read", input: { path: join(outside, "secret.txt") } }, catWorkspace))?.reason ?? "", /FILE_CAPABILITY_DENIED/);
  assert.match((await guardProjectFileCapabilities({ toolName: "write", input: { path: join(project, "new.txt") } }, catWorkspace))?.reason ?? "", /FILE_CAPABILITY_DENIED/);
} finally {
  await rm(root, { recursive: true, force: true });
}

const [generalSource, catSafetySource, documentSource] = await Promise.all([
  readFile(new URL("../packages/cat-runtime/src/generalRuntimeExtension.ts", import.meta.url), "utf8"),
  readFile(new URL("../packages/cat-runtime/src/catSafetyKernel.ts", import.meta.url), "utf8"),
  readFile(new URL("../packages/cat-tools/src/document-capability-tools.ts", import.meta.url), "utf8"),
]);
assert.doesNotMatch(generalSource, /function grantAllows|function canonicalCandidate/);
assert.doesNotMatch(catSafetySource, /allowedDocumentRoots|documentScopeViolation/);
assert.doesNotMatch(documentSource, /outside this Chat's explicit file grants|outside this Chat's read-write file grants/);

console.log("file capability broker tests passed");
