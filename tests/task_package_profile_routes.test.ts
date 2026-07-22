import { strict as assert } from "node:assert";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { handleTaskWorkspaceRoute } from "../packages/cat-server/src/routes/task_workspace_routes.js";
import type { IncomingMessage } from "node:http";

const root = await mkdtemp(join(tmpdir(), "la-task-package-profile-routes-"));
const projectId = "project-one";
await mkdir(join(root, "data/projects", projectId), { recursive: true });

let body: unknown = {};
let output: { status: number; data: unknown } | undefined;
const request = async (method: string, path: string, nextBody: unknown = {}) => {
  body = nextBody;
  output = undefined;
  const req = Object.assign(new EventEmitter(), { method }) as IncomingMessage;
  const url = new URL(path, "http://127.0.0.1");
  const handled = await handleTaskWorkspaceRoute(req, {} as never, url, url.pathname.split("/").filter(Boolean), projectId, {
    repoRoot: root,
    json: (_res, status, data) => { output = { status, data }; },
    readBody: async () => body,
    taskPackageProfile: {
      read: async () => ({ schemaVersion: 1, taskId: "task-one", revision: 0, selections: [], executableApprovals: [], updatedAt: new Date(0).toISOString() }),
      preview: async () => ({ schemaVersion: 1, taskId: "task-one", currentRevision: 0, desiredSelections: [], executableApprovals: [], resolvedResources: [], conflicts: [], planHash: "sha256-test" }),
      apply: async () => ({ schemaVersion: 1, taskId: "task-one", revision: 1, selections: [], executableApprovals: [], updatedAt: new Date().toISOString() }),
    },
  });
  assert.equal(handled, true);
  assert.ok(output);
  return output;
};

const created = await request("POST", `/api/projects/${projectId}/tasks`, { taskId: "task-one", title: "Task", intent: "Configure Package resources", kind: "general" });
assert.equal(created.status, 201);
const profile = await request("GET", `/api/projects/${projectId}/tasks/task-one/resource-profile`);
assert.equal(profile.status, 200);
assert.equal((profile.data as { revision: number }).revision, 0);
const invalidPreview = await request("POST", `/api/projects/${projectId}/tasks/task-one/resource-profile/preview`, { expectedRevision: 0 });
assert.equal(invalidPreview.status, 400);
assert.match((invalidPreview.data as { error: string }).error, /selections/);
const preview = await request("POST", `/api/projects/${projectId}/tasks/task-one/resource-profile/preview`, { expectedRevision: 0, selections: [] });
assert.equal(preview.status, 200);
assert.equal((preview.data as { planHash: string }).planHash, "sha256-test");
const applied = await request("PUT", `/api/projects/${projectId}/tasks/task-one/resource-profile`, { expectedRevision: 0, planHash: "sha256-test", selections: [] });
assert.equal(applied.status, 200);
assert.equal((applied.data as { revision: number }).revision, 1);

console.log("task package profile route tests passed");
