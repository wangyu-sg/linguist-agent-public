import assert from "node:assert/strict";
import {
  assessSegmentContextGraphFreshness,
  buildSegmentContextGraph,
  retrieveSegmentContextGraph,
  type ContextGraphProvenance,
} from "../packages/cat-data/src/index.js";

const hash = (character: string): string => character.repeat(64);

const segmentSource: ContextGraphProvenance = {
  sourceId: "segment:b1:42",
  sourceKind: "segment",
  sourceHash: hash("a"),
  revision: 7,
};
const terminologySource: ContextGraphProvenance = {
  sourceId: "termbase:arcadia:12",
  sourceKind: "termbase",
  sourceHash: hash("b"),
  revision: 3,
};
const characterSource: ContextGraphProvenance = {
  sourceId: "asset:characters:lyra",
  sourceKind: "asset",
  sourceHash: hash("c"),
  revision: 2,
};

const input = {
  schemaVersion: 1 as const,
  segment: {
    projectId: "proj",
    batchId: "b1",
    segmentId: "42",
    source: segmentSource,
  },
  signals: [
    { id: "content-dialogue", kind: "content_type" as const, value: "dialogue", relevance: 0.9, provenance: [segmentSource] },
    { id: "risk-placeholder", kind: "risk" as const, value: "placeholder_integrity", relevance: 0.8, provenance: [segmentSource] },
    { id: "ambiguity-speaker", kind: "ambiguity" as const, value: "speaker_identity", relevance: 0.7, provenance: [characterSource] },
  ],
  nodes: [
    { id: "term-arcadia", kind: "terminology" as const, label: "Arcadia", aliases: ["Arcadian"], relevance: 0.95, provenance: [terminologySource] },
    { id: "character-lyra", kind: "character" as const, label: "Lyra", relevance: 0.8, provenance: [characterSource] },
    { id: "quest-seal", kind: "quest" as const, label: "Find the Seal", relevance: 0.6, provenance: [segmentSource] },
  ],
  edges: [
    { from: "character-lyra", to: "quest-seal", relation: "pursues", provenance: [segmentSource, characterSource] },
  ],
};

const inputBefore = JSON.parse(JSON.stringify(input));
const graph = buildSegmentContextGraph(input);

assert.equal(graph.authority, "advisory_context", "a ContextGraph must never become CAT authority");
assert.equal(graph.canCommit, false, "a ContextGraph cannot write a target or decision");
assert.equal(graph.schemaVersion, 1);
assert.match(graph.graphHash, /^[a-f0-9]{64}$/u);
assert.equal(Object.isFrozen(graph), true, "derived graph snapshots are immutable");
assert.deepEqual(input, inputBefore, "building a ContextGraph must not mutate its evidence inputs");
assert.deepEqual(graph.profile, {
  contentTypes: [graph.signals.find((signal) => signal.id === "content-dialogue")!],
  risks: [graph.signals.find((signal) => signal.id === "risk-placeholder")!],
  ambiguities: [graph.signals.find((signal) => signal.id === "ambiguity-speaker")!],
});
assert.deepEqual(graph.nodes.find((node) => node.id === "term-arcadia")?.provenance, [terminologySource], "every graph node keeps its hash/revision provenance");

const currentSources = [segmentSource, terminologySource, characterSource];
const fresh = assessSegmentContextGraphFreshness(graph, currentSources);
assert.equal(fresh.activeNodes.length, 3);
assert.equal(fresh.staleNodes.length, 0);
assert.equal(fresh.activeSignals.length, 3);
assert.equal(fresh.staleSignals.length, 0);

const focused = retrieveSegmentContextGraph(graph, currentSources, {
  nodeKinds: ["terminology", "character"],
  query: "arcadian",
  limit: 5,
});
assert.deepEqual(focused.hits.map((hit) => hit.node.id), ["term-arcadia"]);
assert.equal(focused.hits[0]?.authority, "advisory_context");
assert.equal(focused.hits[0]?.provenance[0]?.sourceHash, terminologySource.sourceHash);
assert.match(focused.hits[0]?.reason ?? "", /query:alias/);

const staleSources = [
  segmentSource,
  { ...terminologySource, sourceHash: hash("d") },
  { ...characterSource, revision: characterSource.revision + 1 },
];
const stale = assessSegmentContextGraphFreshness(graph, staleSources);
assert.deepEqual(stale.activeNodes.map((node) => node.id), ["quest-seal"]);
assert.deepEqual(stale.staleNodes.map((entry) => [entry.node.id, entry.reason]), [
  ["character-lyra", "source_revision_changed"],
  ["term-arcadia", "source_hash_changed"],
]);
assert.deepEqual(stale.staleSignals.map((entry) => [entry.signal.id, entry.reason]), [
  ["ambiguity-speaker", "source_revision_changed"],
]);
assert.equal(
  retrieveSegmentContextGraph(graph, staleSources, { nodeKinds: ["terminology"], query: "Arcadia" }).hits.length,
  0,
  "stale nodes must be excluded rather than reused as current context",
);

assert.throws(
  () => buildSegmentContextGraph({ ...input, nodes: [{ ...input.nodes[0]!, provenance: [] }] }),
  /at least one provenance/,
);
assert.throws(
  () => buildSegmentContextGraph({ ...input, segment: { ...input.segment, source: { ...segmentSource, sourceHash: "not-a-digest" } } }),
  /sourceHash/,
);
assert.throws(
  () => retrieveSegmentContextGraph(graph, currentSources, { nodeKinds: ["terminology"], limit: 0 }),
  /limit/,
);

console.log("segment ContextGraph tests passed");
