import { strict as assert } from "node:assert";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleAssistantLibraryRoute } from "../packages/cat-server/src/routes/assistant_library_routes.js";

const root = await mkdtemp(join(tmpdir(), "la-library-routes-"));
let mutationAvailable = true;
let installs = 0;

async function request(method: string, path: string, body: unknown = {}): Promise<{ status: number; data: any }> {
  const url = new URL(path, "http://127.0.0.1");
  let output: { status: number; data: any } | undefined;
  const handled = await handleAssistantLibraryRoute(
    Object.assign(new EventEmitter(), { method }) as IncomingMessage,
    {} as ServerResponse,
    url,
    url.pathname.split("/").filter(Boolean),
    {
      repoRoot: root,
      json: (_res, status, data) => { output = { status, data }; },
      readBody: async () => body,
      inspectEmbeddingPack: async () => ({ state: installs ? "ready" : "missing", modelId: "test-e5", revision: "fixed", dimensions: 384, path: "/managed/e5" } as any),
      installEmbeddingPack: async () => {
        installs += 1;
        return { state: "ready", modelId: "test-e5", revision: "fixed", dimensions: 384, path: "/managed/e5" } as any;
      },
      acquireCapabilityMutation: () => mutationAvailable ? () => undefined : undefined,
    },
  );
  assert.equal(handled, true);
  assert.ok(output);
  return output;
}

try {
  const source = join(root, "personal.txt");
  await writeFile(source, "Keep UI copy concise.\n", "utf8");

  assert.deepEqual((await request("GET", "/api/library?scope=personal")).data.documents, []);
  const imported = await request("POST", "/api/library/import", { scope: "personal", sourcePaths: [source], semantic: false });
  assert.equal(imported.status, 201);
  assert.equal(imported.data.documents.length, 1);
  assert.equal(imported.data.semanticState, "lexical_only");

  const searched = await request("GET", "/api/library/search?scope=personal&q=concise&retrievalMode=hybrid");
  assert.equal(searched.status, 200);
  assert.equal(searched.data.hits[0].text, "Keep UI copy concise.");
  assert.equal(searched.data.semanticState.state, "lexical_only");

  assert.equal((await request("GET", "/api/capabilities/embeddings/multilingual-e5")).data.state, "missing");
  mutationAvailable = false;
  assert.equal((await request("POST", "/api/capabilities/embeddings/multilingual-e5/install")).status, 409);
  mutationAvailable = true;
  assert.equal((await request("POST", "/api/capabilities/embeddings/multilingual-e5/install")).data.state, "ready");
  assert.equal(installs, 1);

  const proposed = await request("POST", "/api/memories", {
    scope: "personal",
    kind: "preference",
    text: "Prefer concise UI copy.",
    source: { taskId: "chat-one" },
  });
  assert.equal(proposed.status, 201);
  assert.equal(proposed.data.memory.status, "proposed");
  const id = proposed.data.memory.id;

  const confirmed = await request("POST", `/api/memories/${id}/confirm`, { scope: "personal" });
  assert.equal(confirmed.data.memory.status, "active");
  const edited = await request("PATCH", `/api/memories/${id}`, {
    scope: "personal",
    expectedRevision: confirmed.data.memory.revision,
    text: "Prefer concise Chinese UI copy.",
  });
  assert.match(edited.data.memory.text, /Chinese/);
  assert.equal((await request("GET", "/api/memories?scope=project&projectId=project-b")).data.memories.length, 0, "memory scope cannot be forged across projects");
  assert.equal((await request("DELETE", `/api/memories/${id}?scope=personal`)).data.memory.status, "revoked");

  assert.equal((await request("GET", "/api/library?scope=project")).status, 400);
  assert.equal((await request("POST", "/api/library/import", { scope: "personal", sourcePaths: [] })).status, 400);

  console.log("assistant_library_routes tests passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
