import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const repoRoot = new URL("..", import.meta.url).pathname;
const port = 8901;
const base = `http://127.0.0.1:${port}`;
const projectId = `codex-upload-api-${Date.now()}`;
const apiToken = "import-upload-test-token";

function apiFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${apiToken}`);
  return fetch(input, { ...init, headers });
}

const sdlxliffFixture = `<?xml version="1.0" encoding="utf-8"?>
<xliff xmlns="urn:oasis:names:tc:xliff:document:1.2" xmlns:sdl="http://sdl.com/FileTypes/SdlXliff/1.0" version="1.2">
  <sdl:doc-info><sdl:seg-defs><sdl:seg id="1" conf="Translated" /></sdl:seg-defs></sdl:doc-info>
  <file original="sample.docx" source-language="zh-CN" target-language="en-US">
    <body><trans-unit id="tu1"><source>unused</source><seg-source><mrk mtype="seg" mid="1">开始</mrk></seg-source><target><mrk mtype="seg" mid="1">Start</mrk></target></trans-unit></body>
  </file>
</xliff>`;

const mqxliffFixture = `<?xml version="1.0" encoding="utf-8"?>
<xliff xmlns="urn:oasis:names:tc:xliff:document:1.2" xmlns:mq="MQXliff" version="1.2">
  <file original="sample.xlsx" source-language="zh-CN" target-language="en-US">
    <body>
      <trans-unit id="1" mq:status="PartiallyEdited">
        <source xml:space="preserve">开始<ph id="1">&lt;mq:rxt val="{0}" /&gt;</ph></source>
        <target xml:space="preserve">Start <ph id="1">&lt;mq:rxt val="{0}" /&gt;</ph></target>
      </trans-unit>
    </body>
  </file>
</xliff>`;

const csvFixture = `SegmentID,Source,Target,Status,Note
1,开始,Start,translated,menu
2,退出,,new,button
`;

function startServer(): ChildProcess {
  return spawn("npm", ["run", "server"], {
    cwd: repoRoot,
    env: { ...process.env, LA_SERVER_PORT: String(port), LA_UPLOAD_MAX_BYTES: "2048", LA_LOCAL_API_TOKEN: apiToken },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
}

function stopServer(server: ChildProcess): void {
  server.stdout?.destroy();
  server.stderr?.destroy();
  try {
    if (server.pid) process.kill(-server.pid, "SIGTERM");
  } catch {
    if (!server.killed) server.kill("SIGTERM");
  }
}

async function ok(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(750) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await ok(`${base}/api/health`)) return;
    await sleep(250);
  }
  throw new Error("import upload test server did not become ready");
}

async function postUpload(body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await apiFetch(`${base}/api/projects/import-upload`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() as Record<string, unknown> };
}

const server = startServer();
try {
  await waitForServer();
  assert.equal((await fetch(`${base}/api/projects`)).status, 401);
  assert.equal((await apiFetch(`${base}/api/projects`, { headers: { origin: "https://malicious.example" } })).status, 403);
  const uploaded = await postUpload({
    projectId,
    sourceLanguage: "zh-CN",
    targetLanguage: "en-US",
    fileName: "upload-api-smoke.sdlxliff",
    fileDataBase64: Buffer.from(sdlxliffFixture, "utf8").toString("base64"),
    batchId: "upload-api-smoke",
  });
  assert.equal(uploaded.status, 200);
  assert.equal(uploaded.json.projectId, projectId);
  assert.equal((uploaded.json.manifest as { sourceLanguage: string }).sourceLanguage, "zh-CN");
  assert.equal((uploaded.json.manifest as { targetLanguage: string }).targetLanguage, "en-US");
  assert.equal((uploaded.json.batch as { batchId: string; segments: unknown[] }).batchId, "upload-api-smoke");
  assert.equal((uploaded.json.batch as { segments: unknown[] }).segments.length, 1);

  const uploadedMqxliff = await postUpload({
    projectId,
    fileName: "upload-api-smoke.mqxliff",
    fileDataBase64: Buffer.from(mqxliffFixture, "utf8").toString("base64"),
    batchId: "upload-api-smoke-mq",
  });
  assert.equal(uploadedMqxliff.status, 200);
  assert.equal((uploadedMqxliff.json.batch as { batchId: string; format: string; segments: unknown[] }).batchId, "upload-api-smoke-mq");
  assert.equal((uploadedMqxliff.json.batch as { format: string }).format, "mqxliff");
  assert.equal((uploadedMqxliff.json.batch as { segments: unknown[] }).segments.length, 1);

  const uploadedCsv = await postUpload({
    projectId,
    fileName: "upload-api-smoke.csv",
    fileDataBase64: Buffer.from(csvFixture, "utf8").toString("base64"),
    batchId: "upload-api-smoke-csv",
  });
  assert.equal(uploadedCsv.status, 200);
  assert.equal((uploadedCsv.json.batch as { batchId: string; format: string; segments: unknown[] }).batchId, "upload-api-smoke-csv");
  assert.equal((uploadedCsv.json.batch as { format: string }).format, "csv_paste");
  assert.equal((uploadedCsv.json.batch as { segments: unknown[] }).segments.length, 2);

  const invalid = await postUpload({
    projectId,
    fileName: "notes.txt",
    fileDataBase64: Buffer.from("not a batch", "utf8").toString("base64"),
  });
  assert.equal(invalid.status, 500);
  assert.match(String(invalid.json.error), /Unsupported upload extension/);

  const tooLarge = await postUpload({
    projectId,
    fileName: "too-large.sdlxliff",
    fileDataBase64: Buffer.alloc(4096, "x").toString("base64"),
  });
  assert.equal(tooLarge.status, 500);
  assert.match(String(tooLarge.json.error), /too large/);
} finally {
  stopServer(server);
  await rm(join(repoRoot, "data", "projects", projectId), { recursive: true, force: true });
}

console.log("import_upload tests passed");
