import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCatCompactionInstructions, catAgentProjectSessionId, catAgentSessionDir, createCatAgentSession } from "@linguist-agent/cat-runtime";
import { createWorkspace } from "@linguist-agent/cat-data";

const workspaceRoot = await mkdtemp(join(tmpdir(), "la-runtime-session-test-"));
const workspace = createWorkspace(workspaceRoot, "proj");
const sessionDir = catAgentSessionDir(workspace);
await mkdir(sessionDir, { recursive: true });
const seededSessionFile = join(sessionDir, "2026-05-28T00-00-00-000Z_019e0000-0000-7000-8000-000000000001.jsonl");
await writeFile(
  seededSessionFile,
  [
    JSON.stringify({ type: "session", version: 3, id: "019e0000-0000-7000-8000-000000000001", timestamp: "2026-05-28T00:00:00.000Z", cwd: workspace.root }),
    JSON.stringify({ type: "message", id: "seed-user", parentId: null, timestamp: "2026-05-28T00:00:00.001Z", message: { role: "user", content: [{ type: "text", text: "seed persisted session for continueRecent regression" }], timestamp: Date.now() } }),
  ].join("\n") + "\n",
  "utf8",
);

const first = await createCatAgentSession({ workspace, sessionMode: "continue" });
const firstFile = first.session.sessionFile;
assert.equal(firstFile, seededSessionFile, "continue mode should resume the latest persisted project session file");
assert.ok(firstFile.includes(sessionDir), "project sessions must live under the LA project session directory");
first.session.dispose();

const second = await createCatAgentSession({ workspace, sessionMode: "continue" });
assert.equal(second.session.sessionFile, firstFile, "continue mode should resume the latest project session");
second.session.dispose();

const projectSessionId = catAgentProjectSessionId(workspace);
assert.match(projectSessionId, /^la-proj-[0-9a-f]{10}$/);

const project = await createCatAgentSession({ workspace, sessionMode: "project" });
const projectFile = project.session.sessionFile;
assert.equal(project.session.sessionId, projectSessionId, "project mode should use an exact deterministic Pi session id");
assert.ok(projectFile?.includes(projectSessionId), "project session file should include the exact session id");
assert.equal(project.session.autoCompactionEnabled, true, "LA project sessions should keep Pi native auto-compaction enabled");
assert.notEqual(projectFile, firstFile, "project mode must not alias the latest unrelated session");
project.session.sessionManager.appendMessage({
  role: "assistant",
  content: [{ type: "text", text: "persist exact project session for regression test" }],
  timestamp: Date.now(),
});
project.session.dispose();

const projectAgain = await createCatAgentSession({ workspace, sessionMode: "project" });
assert.equal(projectAgain.session.sessionFile, projectFile, "project mode should reopen the exact project session");
projectAgain.session.dispose();

const next = await createCatAgentSession({ workspace, sessionMode: "new" });
assert.notEqual(next.session.sessionFile, firstFile, "new mode should create a fresh project session");
next.session.dispose();

const projectAfterNew = await createCatAgentSession({ workspace, sessionMode: "project" });
assert.equal(projectAfterNew.session.sessionFile, projectFile, "project mode should ignore newer ad-hoc sessions and keep the exact project workspace thread");
projectAfterNew.session.dispose();

const memory = await createCatAgentSession({ workspace, sessionMode: "memory" });
assert.equal(memory.session.sessionFile, undefined, "memory mode must not persist a session file");
memory.session.dispose();

const evalSession = await createCatAgentSession({
  workspace,
  modelProvider: "deepseek",
  modelId: "deepseek-v4-flash",
  sessionMode: "memory",
  preset: "eval",
  runtimeExtension: false,
  runOptions: {
    noTools: "all",
    noSession: true,
    noContextFiles: true,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
  },
});
assert.equal(evalSession.session.sessionFile, undefined, "Private Eval preset must remain ephemeral");
evalSession.session.dispose();

const compactPrompt = buildCatCompactionInstructions({
  projectId: "proj",
  projectRoot: workspace.root,
  batches: [{ batchId: "b1", format: "phrase_mxliff", segments: 3, confirmed: 1, draft: 1, new: 1, locked: 0 }],
});
assert.match(compactPrompt, /CAT-aware Linguist Agent session summary/);
assert.match(compactPrompt, /b1: phrase_mxliff, 3 segments/);
assert.match(compactPrompt, /Terminology decisions/);

console.log("runtime_session tests passed");
