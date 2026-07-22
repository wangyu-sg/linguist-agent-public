import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProjectManifest, createTmStore, importCsvBatch, createWorkspace } from "@linguist-agent/cat-data";
import { handleVoiceRoute } from "../packages/cat-server/src/routes/voice_routes.js";

function req(method: string, url = "/") {
  return { method, url } as any;
}

function captureJson() {
  let payload: { status: number; data: any } | undefined;
  const bodies: Record<string, unknown>[] = [];
  const res = {
    statusCode: 200,
    ended: false,
    end() {
      this.ended = true;
    },
  } as any;
  return {
    res,
    json: (_res: any, status: number, data: unknown) => {
      payload = { status, data };
    },
    readBody: async (reqLike: any) => {
      void reqLike;
      return bodies.shift() ?? {};
    },
    queueBody: (body: Record<string, unknown>) => {
      bodies.push(body);
    },
    get: () => {
      assert.ok(payload, "route should write json");
      return payload;
    },
  };
}

function deps(repoRoot: string) {
  return {
    repoRoot,
    json: (_res: any, status: number, data: unknown) => {},
    requireString: (value: unknown, label: string) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} required`);
      return value;
    },
    optionalString: (value: unknown) => (typeof value === "string" && value ? value : undefined),
  };
}

const root = await mkdtemp(join(tmpdir(), "la-voice-route-"));
const customerRoot = join(root, "customer");
await mkdir(customerRoot, { recursive: true });
const csvPath = join(customerRoot, "batch.csv");
await writeFile(csvPath, ["SegmentID,Source,Target,Status", "s1,巅峰对决,Peak Duel,draft", "s2,天关,Celestial Gate,draft"].join("\n"), "utf8");
await createProjectManifest(root, customerRoot, { projectId: "vp", sourceLanguage: "zh-CN", targetLanguage: "en-US" });
await importCsvBatch(root, { projectId: "vp", csvPath, batchId: "b1" });

// --- voice profile: GET on a fresh batch returns not_started with backfilled languages ---
{
  const out = captureJson();
  const handled = await handleVoiceRoute(req("GET"), out.res, ["api", "projects", "vp", "batches", "b1", "voice-profile"], "vp", {
    ...deps(root),
    json: out.json,
    readBody: out.readBody,
  });
  assert.equal(handled, true, "GET voice-profile should be handled");
  const { status, data } = out.get();
  assert.equal(status, 200);
  assert.equal(data.status, "not_started");
  assert.equal(data.projectId, "vp");
  assert.equal(data.batchId, "b1");
  assert.equal(data.sourceLanguage, "zh-CN", "language pair should be backfilled from the batch");
  assert.equal(data.targetLanguage, "en-US");
  assert.equal(Array.isArray(data.entries), true);
  assert.equal(data.entries.length, 0);
  assert.equal(Array.isArray(data.roster), true);
  assert.equal(data.roster.length, 1, "profile GET should include the batch roster promised by the contract");
  assert.equal(data.roster[0].count, 2);
}

// --- voice profile: PUT upserts an entry, then GET returns it ---
{
  const put = captureJson();
  put.queueBody({
    status: "draft",
    updatedBy: "model",
    entries: [
      { id: "vp-001", textType: "dialogue", speaker: "虎威将军", register: "elevated", person: "first-person", toneMarkers: ["archaic"] },
    ],
  });
  const handled = await handleVoiceRoute(req("PUT"), put.res, ["api", "projects", "vp", "batches", "b1", "voice-profile"], "vp", {
    ...deps(root),
    json: put.json,
    readBody: put.readBody,
  });
  assert.equal(handled, true);
  const { status, data } = put.get();
  assert.equal(status, 200);
  assert.equal(data.status, "draft");
  assert.equal(data.entries.length, 1);
  assert.equal(data.entries[0].id, "vp-001");
  assert.equal(data.entries[0].speaker, "虎威将军");
  assert.ok(data.updatedAt, "updatedAt should be set");
}

{
  const out = captureJson();
  await handleVoiceRoute(req("GET"), out.res, ["api", "projects", "vp", "batches", "b1", "voice-profile"], "vp", {
    ...deps(root),
    json: out.json,
    readBody: out.readBody,
  });
  const { data } = out.get();
  assert.equal(data.status, "draft", "persisted PUT should be readable on next GET");
  assert.equal(data.entries.length, 1);
}

// --- voice profile: invalid entry fields are rejected at the API boundary ---
{
  const bad = captureJson();
  bad.queueBody({
    entries: [{ id: "bad", textType: "narrative", speaker: null, register: "neutral" }],
  });
  await assert.rejects(
    () => handleVoiceRoute(req("PUT"), bad.res, ["api", "projects", "vp", "batches", "b1", "voice-profile"], "vp", {
      ...deps(root),
      json: bad.json,
      readBody: bad.readBody,
    }),
    /Invalid voice textType/,
    "invalid profile entry textType should be rejected",
  );
}

// --- voice profile: confirm flips status to confirmed ---
{
  const confirm = captureJson();
  confirm.queueBody({ confirmedBy: "user:alice" });
  await handleVoiceRoute(req("POST"), confirm.res, ["api", "projects", "vp", "batches", "b1", "voice-profile", "confirm"], "vp", {
    ...deps(root),
    json: confirm.json,
    readBody: confirm.readBody,
  });
  const { status, data } = confirm.get();
  assert.equal(status, 200);
  assert.equal(data.status, "confirmed");
  assert.equal(data.updatedBy, "user:alice");
}

// --- voice profile: roster returns a deterministic speaker index ---
{
  const out = captureJson();
  await handleVoiceRoute(req("GET"), out.res, ["api", "projects", "vp", "batches", "b1", "voice-profile", "roster"], "vp", {
    ...deps(root),
    json: out.json,
    readBody: out.readBody,
  });
  const { status, data } = out.get();
  assert.equal(status, 200);
  assert.equal(data.batchId, "b1");
  assert.ok(Array.isArray(data.roster), "roster should be an array");
  assert.equal(data.roster.length, 1, "both segments share the null speaker bucket");
  assert.equal(data.roster[0].count, 2);
}

// --- exemplars: empty list on a fresh project ---
{
  const out = captureJson();
  await handleVoiceRoute(req("GET", "/api/projects/vp/voice-exemplars"), out.res, ["api", "projects", "vp", "voice-exemplars"], "vp", {
    ...deps(root),
    json: out.json,
    readBody: out.readBody,
  });
  const { status, data } = out.get();
  assert.equal(status, 200);
  assert.equal(data.count, 0);
  assert.equal(data.exemplars.length, 0);
}

// --- exemplars: POST adds a golden exemplar, GET returns it ---
let exemplarId = "";
{
  const add = captureJson();
  add.queueBody({
    textType: "dialogue",
    speaker: "虎威将军",
    register: "elevated",
    source: "尔等速退。",
    target: "Fall back at once.",
    origin: "golden",
    evidenceSource: "manual:alice",
  });
  await handleVoiceRoute(req("POST"), add.res, ["api", "projects", "vp", "voice-exemplars"], "vp", {
    ...deps(root),
    json: add.json,
    readBody: add.readBody,
  });
  const { status, data } = add.get();
  assert.equal(status, 201);
  assert.equal(data.origin, "golden");
  assert.ok(data.id.startsWith("vex-"), "exemplar id should be generated");
  exemplarId = data.id;
  assert.ok(data.createdAt, "createdAt should be set");
}

{
  const out = captureJson();
  await handleVoiceRoute(req("GET", "/api/projects/vp/voice-exemplars"), out.res, ["api", "projects", "vp", "voice-exemplars"], "vp", {
    ...deps(root),
    json: out.json,
    readBody: out.readBody,
  });
  const { data } = out.get();
  assert.equal(data.count, 1, "added exemplar should be listed");
  assert.equal(data.exemplars[0].target, "Fall back at once.");
}

// --- exemplars: DELETE returns a bodyless 204 and removes the exemplar ---
{
  const del = captureJson();
  await handleVoiceRoute(req("DELETE"), del.res, ["api", "projects", "vp", "voice-exemplars", exemplarId], "vp", {
    ...deps(root),
    json: del.json,
    readBody: del.readBody,
  });
  assert.equal(del.res.statusCode, 204);
  assert.equal(del.res.ended, true);

  const out = captureJson();
  await handleVoiceRoute(req("GET", "/api/projects/vp/voice-exemplars"), out.res, ["api", "projects", "vp", "voice-exemplars"], "vp", {
    ...deps(root),
    json: out.json,
    readBody: out.readBody,
  });
  const { data } = out.get();
  assert.equal(data.count, 0, "deleted exemplar should no longer be listed");
}

// --- exemplars: reject invalid textType/origin ---
{
  const bad = captureJson();
  bad.queueBody({
    textType: "narrative",
    speaker: null,
    register: "neutral",
    source: "x",
    target: "y",
    origin: "golden",
    evidenceSource: "manual",
  });
  await assert.rejects(
    () => handleVoiceRoute(req("POST"), bad.res, ["api", "projects", "vp", "voice-exemplars"], "vp", {
      ...deps(root),
      json: bad.json,
      readBody: bad.readBody,
    }),
    /Invalid voice textType/,
    "invalid textType should be rejected",
  );
}

// --- exemplars: promote-reviewed promotes clean reviewed TM and rejects weak/non-reviewed rows ---
{
  await createTmStore(createWorkspace(root, "vp")).seed([
    { id: "tm-reviewed", source: "巅峰对决", target: "The Pinnacle", srcLang: "zh-CN", tgtLang: "en-US", origin: "reviewed", quality: 100 },
    { id: "tm-weak", source: "天关", target: "Celestial Gate", srcLang: "zh-CN", tgtLang: "en-US", origin: "reviewed", quality: 80 },
    { id: "tm-client", source: "帮派", target: "Guild", srcLang: "zh-CN", tgtLang: "en-US", origin: "client_tm", quality: 100 },
  ]);
  const promo = captureJson();
  promo.queueBody({ batchId: "b1", maxDefectSeverity: "L1" });
  await handleVoiceRoute(req("POST"), promo.res, ["api", "projects", "vp", "voice-exemplars", "promote-reviewed"], "vp", {
    ...deps(root),
    json: promo.json,
    readBody: promo.readBody,
  });
  const { status, data } = promo.get();
  assert.equal(status, 200);
  assert.equal(data.promoted, 1, "clean reviewed TM should be promoted into exemplars");
  assert.equal(data.rejected, 2, "weak reviewed rows and non-reviewed TM should be rejected");
  assert.equal(Array.isArray(data.rejectedSamples), true);

  const out = captureJson();
  await handleVoiceRoute(req("GET", "/api/projects/vp/voice-exemplars"), out.res, ["api", "projects", "vp", "voice-exemplars"], "vp", {
    ...deps(root),
    json: out.json,
    readBody: out.readBody,
  });
  const listed = out.get().data;
  assert.equal(listed.count, 1);
  assert.equal(listed.exemplars[0].origin, "reviewed_tm_clean");
  assert.equal(listed.exemplars[0].evidenceSource, "tm:tm-reviewed");
}

// --- non-voice routes are not handled ---
{
  const out = captureJson();
  const handled = await handleVoiceRoute(req("GET"), out.res, ["api", "projects", "vp", "batches", "b1", "segments"], "vp", {
    ...deps(root),
    json: out.json,
    readBody: out.readBody,
  });
  assert.equal(handled, false, "non-voice routes should not be claimed by handleVoiceRoute");
}

console.log("voice route tests passed");
