import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  buildPiSessionsCatalog,
  clonePiSessionBranch,
  buildPiSessionTree,
  deletePiSession,
  exportPiSession,
  readPiSessionEntries,
  readPiSessionTree,
  renamePiSession,
  sharePiSession,
  validatePiSessionBranchTarget,
  type PiSessionScope,
} from "../packages/cat-server/src/pi_sessions.js";
import { handlePiSettingsRoute, type PiSettingsRouteDeps } from "../packages/cat-server/src/routes/pi_settings_routes.js";

const sessionsDocs = readFileSync("node_modules/@earendil-works/pi-coding-agent/docs/sessions.md", "utf8");
for (const command of ["/resume", "/new", "/name", "/session", "/tree", "/fork", "/clone", "/compact", "/export", "/share"]) {
  assert.ok(sessionsDocs.includes(command), `sessions.md documents ${command}`);
}

function assistantUsage() {
  return {
    input: 10,
    output: 5,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 15,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

const root = await mkdtemp(join(tmpdir(), "la-pi-sessions-"));
try {
  const cwd = join(root, "repo");
  const sessionDir = join(root, "sessions");
  const manager = SessionManager.create(cwd, sessionDir, { id: "session-one" });
  const userId = manager.appendMessage({ role: "user", content: "Refactor auth module", timestamp: Date.now() } as never);
  const assistantId = manager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "I will inspect the auth flow." }],
    api: "openai-responses",
    provider: "openai",
    model: "gpt-test",
    usage: assistantUsage(),
    stopReason: "stop",
    timestamp: Date.now(),
  } as never);
  manager.appendLabelChange(userId, "start-here");
  manager.appendSessionInfo("Auth refactor");

  const scope: PiSessionScope = {
    surface: "project",
    projectId: "demo",
    cwd,
    sessionDir,
    activeSessionId: "session-one",
  };

  const catalog = await buildPiSessionsCatalog(scope);
  assert.equal(catalog.docs, "https://pi.dev/docs/latest/sessions");
  assert.equal(catalog.surface, "project");
  assert.equal(catalog.sessions[0].id, "session-one");
  assert.equal(catalog.sessions[0].displayName, "Auth refactor");
  assert.equal(typeof catalog.sessions[0].tree?.leafId, "string");
  assert.equal(catalog.commands.tree.includes("pending branch"), true);

  const tree = await readPiSessionTree(scope, "session-one");
  assert.equal(tree.entries.length, 4);
  assert.equal(tree.entries.find((entry) => entry.id === userId)?.label, "start-here");
  assert.equal(tree.entries.find((entry) => entry.id === assistantId)?.role, "assistant");

  const allEntries = await readPiSessionEntries(scope, "session-one");
  assert.equal(allEntries.entryCount, 4);
  assert.equal(allEntries.leafId, allEntries.entries.at(-1)?.id);
  const entriesSinceUser = await readPiSessionEntries(scope, "session-one", userId);
  assert.deepEqual(entriesSinceUser.entries.map((entry) => entry.id), [assistantId, allEntries.entries[2].id, allEntries.entries[3].id]);
  await assert.rejects(() => readPiSessionEntries(scope, "session-one", "missing-entry"), /entry not found/);

  const renamed = await renamePiSession(scope, "session-one", "Renamed from UI");
  assert.equal(renamed.catalog.sessions[0].displayName, "Renamed from UI");

  const pending = await validatePiSessionBranchTarget(scope, "session-one", userId);
  assert.equal(pending.pendingBranchEntryId, userId);
  assert.equal(pending.catalog.pendingBranchEntryId, userId);

  const forked = await clonePiSessionBranch(scope, {
    sessionId: "session-one",
    operation: "fork",
    entryId: userId,
    name: "Fork from UI",
  });
  assert.ok(forked.createdSessionId);
  assert.notEqual(forked.createdSessionId, "session-one");
  assert.equal(forked.tree?.entryCount, 3);
  assert.ok(forked.tree?.entries.some((entry) => entry.id === userId));
  assert.equal(forked.catalog.activeSessionId, forked.createdSessionId);

  const cloned = await clonePiSessionBranch(scope, {
    sessionId: "session-one",
    operation: "clone",
    name: "Clone active branch",
  });
  assert.ok(cloned.createdSessionId);
  assert.equal(cloned.tree?.leafId !== null, true);

  const htmlExport = await exportPiSession(scope, {
    sessionId: "session-one",
    outputPath: join(root, "exports", "session-one.html"),
  });
  assert.equal(htmlExport.command, "/export");
  assert.equal(htmlExport.format, "html");
  assert.equal(readFileSync(htmlExport.outputPath!, "utf8").startsWith("<!DOCTYPE html>"), true);

  const jsonlExport = await exportPiSession(scope, {
    sessionId: "session-one",
    format: "jsonl",
    outputPath: join(root, "exports", "session-one.jsonl"),
  });
  assert.equal(jsonlExport.format, "jsonl");
  assert.ok(readFileSync(jsonlExport.outputPath!, "utf8").includes("\"type\":\"session\""));

  const ghCalls: string[][] = [];
  const shared = await sharePiSession(scope, { sessionId: "session-one" }, {
    tmpDir: join(root, "tmp"),
    runGh: async (args) => {
      ghCalls.push(args);
      if (args[0] === "auth") return { stdout: "", stderr: "", code: 0 };
      assert.deepEqual(args.slice(0, 3), ["gist", "create", "--public=false"]);
      assert.equal(readFileSync(args[3], "utf8").startsWith("<!DOCTYPE html>"), true);
      return { stdout: "https://gist.github.com/demo/abc123\n", stderr: "", code: 0 };
    },
  });
  assert.deepEqual(ghCalls.map((args) => args.slice(0, 3)), [["auth", "status"], ["gist", "create", "--public=false"]]);
  assert.equal(shared.command, "/share");
  assert.equal(shared.gistUrl, "https://gist.github.com/demo/abc123");
  assert.equal(shared.shareUrl, "https://pi.dev/session/#abc123");

  const dotted = SessionManager.create(cwd, sessionDir, { id: "session..dots" });
  dotted.appendMessage({ role: "user", content: "Path with dot-dot text", timestamp: Date.now() } as never);
  dotted.appendMessage({
    role: "assistant",
    content: "Persist dotted session",
    api: "openai-responses",
    provider: "openai",
    model: "gpt-test",
    usage: assistantUsage(),
    stopReason: "stop",
    timestamp: Date.now(),
  } as never);
  const dottedCatalog = await buildPiSessionsCatalog(scope);
  assert.ok(dottedCatalog.sessions.some((session) => session.id === "session..dots"));
  assert.throws(
    () => buildPiSessionTree({ sessionPath: join(root, "outside.jsonl"), sessionDir, cwd }),
    /outside sessionDir/,
  );

  const deleted = await deletePiSession(scope, "session-one");
  assert.equal(deleted.deletedPath?.endsWith(".jsonl"), true);
  assert.equal(deleted.catalog.sessions.some((session) => session.id === "session-one" && session.hasFile), false);

  const routed: unknown[] = [];
  const routeDeps = {
    json: (_response: unknown, _status: number, value: unknown) => routed.push(value),
    readPiSessionsCatalog: async (surface: string) => ({ surface }),
  } as unknown as PiSettingsRouteDeps;
  assert.equal(await handlePiSettingsRoute(
    { method: "GET" } as never,
    {} as never,
    new URL("http://la/api/pi/sessions?surface=global"),
    routeDeps,
  ), true);
  assert.deepEqual(routed, [{ surface: "global" }]);
  await assert.rejects(
    () => handlePiSettingsRoute(
      { method: "GET" } as never,
      {} as never,
      new URL("http://la/api/pi/sessions?surface=home"),
      routeDeps,
    ),
    /surface must be global or project/,
  );

  let modelPreference: { provider: string; model: string; thinking?: string } | undefined;
  const modelResponses: unknown[] = [];
  assert.equal(await handlePiSettingsRoute(
    { method: "PUT" } as never,
    {} as never,
    new URL("http://la/api/pi/model-preference"),
    {
      json: (_response, _status, value) => modelResponses.push(value),
      readBody: async () => ({ provider: "openai-codex", model: "gpt-5.2", thinking: "high" }),
      requireString: (value, label) => {
        if (typeof value !== "string" || !value) throw new Error(`${label} is required`);
        return value;
      },
      writePiModelPreference: async (input) => {
        modelPreference = input;
        return { saved: true };
      },
    } as unknown as PiSettingsRouteDeps,
  ), true);
  assert.deepEqual(modelPreference, { provider: "openai-codex", model: "gpt-5.2", thinking: "high" });
  assert.deepEqual(modelResponses, [{ saved: true }]);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("pi_sessions tests passed");
