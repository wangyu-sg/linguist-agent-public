import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSegmentEvidenceSnapshot,
  buildBatchEvidencePack,
  batchPath,
  createTmStore,
  createWorkspace,
  glossaryPath,
  importCsvBatch,
  readBatch,
  termbasePath,
  writeJsonFile,
  type GlossaryEntry,
  type TermbaseEntry,
} from "@linguist-agent/cat-data";
import { buildCatTools } from "@linguist-agent/cat-tools";

const root = await mkdtemp(join(tmpdir(), "la-segment-evidence-"));
const csvPath = join(root, "batch.csv");
await writeFile(csvPath, "SegmentID,Source,Target\n1,巅峰对决,\n2,助战NPC进队,\n", "utf8");
await importCsvBatch(root, {
  projectId: "proj",
  csvPath,
  batchId: "b1",
  sourceLanguage: "zh-CN",
  targetLanguage: "en-US",
});

await createTmStore(createWorkspace(root, "proj")).seed([
  {
    id: "tm-exact",
    source: "巅峰对决",
    target: "The Pinnacle",
    srcLang: "zh-CN",
    tgtLang: "en-US",
    origin: "client_tm",
    quality: 100,
  },
  {
    id: "tm-short",
    source: "NPC",
    target: "NPC",
    srcLang: "zh-CN",
    tgtLang: "en-US",
    origin: "client_tm",
    quality: 100,
  },
  {
    id: "tm-wrong-locale",
    source: "巅峰对决",
    target: "Falsche Sprache",
    srcLang: "zh-CN",
    tgtLang: "de-DE",
    origin: "client_tm",
    quality: 100,
  },
]);

await writeJsonFile<TermbaseEntry[]>(termbasePath(root, "proj"), [
  {
    id: "tb-1",
    source: "巅峰对决",
    target: "The Pinnacle",
    srcLang: "zh-CN",
    tgtLang: "en-US",
    sourceFile: "terms.csv",
    rowNo: 2,
    origin: "manual",
  },
  {
    id: "tb-2",
    source: "巅峰",
    target: "pinnacle",
    srcLang: "zh-CN",
    tgtLang: "en-US",
    sourceFile: "terms.csv",
    rowNo: 3,
    origin: "manual",
  },
  {
    id: "tb-wrong-locale",
    source: "巅峰对决",
    target: "Falsche Sprache",
    srcLang: "zh-CN",
    tgtLang: "de-DE",
    sourceFile: "terms.csv",
    rowNo: 4,
    origin: "manual",
  },
]);

await writeJsonFile<GlossaryEntry[]>(glossaryPath(root, "proj"), [
  {
    id: "gl-1",
    source: "巅峰对决",
    target: "The Pinnacle",
    sourceFile: "glossary.csv",
    rowNo: 4,
  },
]);

const snapshot = await buildSegmentEvidenceSnapshot(root, {
  projectId: "proj",
  batchId: "b1",
  segmentId: "1",
});

assert.equal(snapshot.projectId, "proj");
assert.equal(snapshot.batchId, "b1");
assert.equal(snapshot.segmentId, "1");
assert.equal(snapshot.summary.tm, 1);
assert.equal(snapshot.summary.tmExact, 1);
assert.equal(snapshot.summary.tmFuzzy, 0);
assert.equal(snapshot.summary.termbase, 2);
assert.equal(snapshot.summary.glossary, 1);
assert.equal(snapshot.tmMatches.length, 1);
assert.equal(snapshot.tmMatches[0].id, "tm-exact");
assert.equal(snapshot.tmMatches[0].target, "The Pinnacle");
assert.equal(snapshot.tmMatches[0].matchType, "exact");
assert.equal(snapshot.tmMatches[0].effectiveAuthority, "client_tm");
assert.equal(snapshot.tmMatches.some((match) => match.id === "tm-wrong-locale"), false);
assert.equal(snapshot.termbaseMatches.length, 2);
assert.equal(snapshot.termbaseMatches[0].id, "tb-1");
assert.equal(snapshot.termbaseMatches[0].target, "The Pinnacle");
assert.equal(snapshot.termbaseMatches.some((match) => match.id === "tb-wrong-locale"), false);
assert.equal(snapshot.glossaryMatches.length, 1);
assert.equal(snapshot.glossaryMatches[0].id, "gl-1");

const tmCard = snapshot.cards.find((card) => card.toolName === "tm_lookup");
assert.equal(tmCard?.id, "auto-1-tm");
assert.equal(tmCard?.tab, "cat");
assert.match(tmCard?.text ?? "", /100% exact · client_tm/);
assert.match(tmCard?.text ?? "", /Target: The Pinnacle/);

const tbCard = snapshot.cards.find((card) => card.toolName === "termbase_lookup");
assert.equal(tbCard?.tab, "cat");
assert.match(tbCard?.text ?? "", /1\. exact · preferred/);
assert.match(tbCard?.text ?? "", /termbase:terms\.csv:2/);

const glossaryCard = snapshot.cards.find((card) => card.toolName === "glossary_lookup");
assert.equal(glossaryCard?.tab, "rules");
assert.match(glossaryCard?.text ?? "", /glossary:glossary\.csv:4/);

const pack = await buildBatchEvidencePack(root, {
  projectId: "proj",
  batchId: "b1",
});
assert.equal(pack.schemaVersion, 1);
assert.equal(pack.summary.totalSegments, 2);
assert.equal(pack.segments.length, 2);
assert.equal(pack.segments[0].segmentId, "1");
assert.equal(pack.summary.segmentsWithEvidence >= 1, true);
assert.equal(pack.summary.tm >= snapshot.summary.tm, true);
assert.equal(pack.summary.tmExact >= 1, true);
assert.equal(pack.summary.tmFuzzy >= 1, true);

const evidencePackTool = buildCatTools(createWorkspace(root, "proj")).find((tool) => tool.name === "evidence_pack");
assert.ok(evidencePackTool, "evidence_pack tool must be registered");
const evidenceToolResult = await evidencePackTool.execute("tool-call", { batchId: "b1" });
assert.match(evidenceToolResult.content[0].text, /tmExact=/, "Agent-readable evidence_pack output must split exact TM");
assert.match(evidenceToolResult.content[0].text, /tmFuzzy=/, "Agent-readable evidence_pack output must split fuzzy TM");
const evidencePage = await evidencePackTool.execute("tool-page", { batchId: "b1", start: 1, limit: 1 });
assert.equal(evidencePage.details.returned, 1);
assert.equal(evidencePage.details.totalEvidenceSegments, pack.summary.segmentsWithEvidence);
assert.match(evidencePage.content[0].text, /Showing 1\//);
if (pack.summary.segmentsWithEvidence > 1) assert.equal(evidencePage.details.nextStart, 2);

const canonicalBatch = await readBatch(root, "proj", "b1");
canonicalBatch.segments[0]!.source = "新的巅峰对决";
canonicalBatch.updatedAt = new Date(Date.parse(canonicalBatch.updatedAt) + 1_000).toISOString();
await writeJsonFile(batchPath(createWorkspace(root, "proj"), "b1"), canonicalBatch);
const refreshedSnapshot = await buildSegmentEvidenceSnapshot(root, {
  projectId: "proj",
  batchId: "b1",
  segmentId: "1",
});
assert.equal(refreshedSnapshot.source, "新的巅峰对决", "evidence cache must invalidate after the canonical Batch revision changes");

await assert.rejects(
  () =>
    buildSegmentEvidenceSnapshot(root, {
      projectId: "proj",
      batchId: "b1",
      segmentId: "missing",
    }),
  /Segment missing not found/,
);

console.log("segment evidence tests passed");
