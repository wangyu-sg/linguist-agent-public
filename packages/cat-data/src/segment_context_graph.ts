import { createHash } from "node:crypto";

/**
 * ContextGraph is a derived, read-only selection aid. It never creates CAT
 * Evidence, an approved proposal, or a write authority. Every displayed node
 * is therefore tied to an externally verified source digest and revision, and
 * must disappear from retrieval when that source no longer matches.
 */
export const CONTEXT_GRAPH_NODE_KINDS = ["character", "quest", "scene", "dialogue", "terminology"] as const;
export type ContextGraphNodeKind = (typeof CONTEXT_GRAPH_NODE_KINDS)[number];

export const CONTEXT_GRAPH_SOURCE_KINDS = ["segment", "evidence", "asset", "termbase", "glossary", "tm"] as const;
export type ContextGraphSourceKind = (typeof CONTEXT_GRAPH_SOURCE_KINDS)[number];

export const CONTEXT_GRAPH_SIGNAL_KINDS = ["content_type", "risk", "ambiguity"] as const;
export type ContextGraphSignalKind = (typeof CONTEXT_GRAPH_SIGNAL_KINDS)[number];

export interface ContextGraphProvenance {
  sourceId: string;
  sourceKind: ContextGraphSourceKind;
  /** SHA-256 of the exact source snapshot from which this context was derived. */
  sourceHash: string;
  /** Monotonic source revision supplied by that source's canonical owner. */
  revision: number;
}

export interface SegmentContextGraphSegment {
  projectId: string;
  batchId: string;
  segmentId: string;
  source: ContextGraphProvenance;
}

export interface SegmentContextGraphSignal {
  id: string;
  kind: ContextGraphSignalKind;
  value: string;
  relevance: number;
  provenance: ContextGraphProvenance[];
}

export interface SegmentContextGraphNode {
  id: string;
  kind: ContextGraphNodeKind;
  label: string;
  aliases: string[];
  relevance: number;
  provenance: ContextGraphProvenance[];
}

export interface SegmentContextGraphEdge {
  from: string;
  to: string;
  relation: string;
  provenance: ContextGraphProvenance[];
}

export interface SegmentContextGraphInput {
  schemaVersion: 1;
  segment: SegmentContextGraphSegment;
  signals: SegmentContextGraphSignal[];
  nodes: SegmentContextGraphNode[];
  edges: SegmentContextGraphEdge[];
}

export interface SegmentContextProfile {
  contentTypes: SegmentContextGraphSignal[];
  risks: SegmentContextGraphSignal[];
  ambiguities: SegmentContextGraphSignal[];
}

export interface SegmentContextGraph {
  schemaVersion: 1;
  /** This literal is intentionally not an Evidence authority level. */
  authority: "advisory_context";
  /** ContextGraph cannot create proposals, write rows, or commit decisions. */
  canCommit: false;
  segment: SegmentContextGraphSegment;
  signals: SegmentContextGraphSignal[];
  profile: SegmentContextProfile;
  nodes: SegmentContextGraphNode[];
  edges: SegmentContextGraphEdge[];
  graphHash: string;
}

export type ContextGraphStaleReason = "missing_source" | "source_hash_changed" | "source_revision_changed";

export interface SegmentContextGraphStaleNode {
  node: SegmentContextGraphNode;
  reason: ContextGraphStaleReason;
  provenance: ContextGraphProvenance;
}

export interface SegmentContextGraphStaleSignal {
  signal: SegmentContextGraphSignal;
  reason: ContextGraphStaleReason;
  provenance: ContextGraphProvenance;
}

export interface SegmentContextGraphFreshness {
  activeNodes: SegmentContextGraphNode[];
  staleNodes: SegmentContextGraphStaleNode[];
  activeSignals: SegmentContextGraphSignal[];
  staleSignals: SegmentContextGraphStaleSignal[];
}

export interface SegmentContextGraphRetrievalRequest {
  nodeKinds?: ContextGraphNodeKind[];
  query?: string;
  limit?: number;
}

export interface SegmentContextGraphRetrievalHit {
  node: SegmentContextGraphNode;
  relevance: number;
  reason: string;
  provenance: ContextGraphProvenance[];
  authority: "advisory_context";
}

export interface SegmentContextGraphRetrievalResult {
  authority: "advisory_context";
  hits: SegmentContextGraphRetrievalHit[];
  staleNodes: SegmentContextGraphStaleNode[];
}

const HASH_PATTERN = /^[a-f0-9]{64}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function knownFields(value: Record<string, unknown>, fields: readonly string[], label: string): void {
  for (const field of Object.keys(value)) {
    if (!fields.includes(field)) throw new Error(`${label} has unknown field ${field}.`);
  }
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

function relevance(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be a finite number from 0 to 1.`);
  }
  return value;
}

function revision(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`${label} must be a positive integer.`);
  return Number(value);
}

function sortProvenance(rows: ContextGraphProvenance[]): ContextGraphProvenance[] {
  return [...rows].sort((left, right) => left.sourceId.localeCompare(right.sourceId)
    || left.sourceHash.localeCompare(right.sourceHash)
    || left.revision - right.revision);
}

function parseProvenance(value: unknown, label: string): ContextGraphProvenance {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  knownFields(value, ["sourceId", "sourceKind", "sourceHash", "revision"], label);
  const sourceId = requiredString(value.sourceId, `${label}.sourceId`);
  const sourceKind = requiredString(value.sourceKind, `${label}.sourceKind`);
  if (!(CONTEXT_GRAPH_SOURCE_KINDS as readonly string[]).includes(sourceKind)) throw new Error(`${label}.sourceKind is invalid.`);
  const sourceHash = requiredString(value.sourceHash, `${label}.sourceHash`).toLowerCase();
  if (!HASH_PATTERN.test(sourceHash)) throw new Error(`${label}.sourceHash must be a SHA-256 digest.`);
  return { sourceId, sourceKind: sourceKind as ContextGraphSourceKind, sourceHash, revision: revision(value.revision, `${label}.revision`) };
}

function parseProvenanceList(value: unknown, label: string): ContextGraphProvenance[] {
  if (!Array.isArray(value) || !value.length) throw new Error(`${label} must contain at least one provenance source.`);
  const rows = value.map((row, index) => parseProvenance(row, `${label}[${index}]`));
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.sourceId}\u0000${row.sourceHash}\u0000${row.revision}`;
    if (seen.has(key)) throw new Error(`${label} contains duplicate provenance.`);
    seen.add(key);
  }
  return sortProvenance(rows);
}

function parseStringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  const rows = value.map((row, index) => requiredString(row, `${label}[${index}]`));
  return [...new Set(rows)].sort((left, right) => left.localeCompare(right));
}

function parseSegment(value: unknown): SegmentContextGraphSegment {
  if (!isRecord(value)) throw new Error("segment must be an object.");
  knownFields(value, ["projectId", "batchId", "segmentId", "source"], "segment");
  const source = parseProvenance(value.source, "segment.source");
  if (source.sourceKind !== "segment") throw new Error("segment.source.sourceKind must be segment.");
  return {
    projectId: requiredString(value.projectId, "segment.projectId"),
    batchId: requiredString(value.batchId, "segment.batchId"),
    segmentId: requiredString(value.segmentId, "segment.segmentId"),
    source,
  };
}

function parseSignal(value: unknown, label: string): SegmentContextGraphSignal {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  knownFields(value, ["id", "kind", "value", "relevance", "provenance"], label);
  const kind = requiredString(value.kind, `${label}.kind`);
  if (!(CONTEXT_GRAPH_SIGNAL_KINDS as readonly string[]).includes(kind)) throw new Error(`${label}.kind is invalid.`);
  return {
    id: requiredString(value.id, `${label}.id`),
    kind: kind as ContextGraphSignalKind,
    value: requiredString(value.value, `${label}.value`),
    relevance: relevance(value.relevance, `${label}.relevance`),
    provenance: parseProvenanceList(value.provenance, `${label}.provenance`),
  };
}

function parseNode(value: unknown, label: string): SegmentContextGraphNode {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  knownFields(value, ["id", "kind", "label", "aliases", "relevance", "provenance"], label);
  const kind = requiredString(value.kind, `${label}.kind`);
  if (!(CONTEXT_GRAPH_NODE_KINDS as readonly string[]).includes(kind)) throw new Error(`${label}.kind is invalid.`);
  return {
    id: requiredString(value.id, `${label}.id`),
    kind: kind as ContextGraphNodeKind,
    label: requiredString(value.label, `${label}.label`),
    aliases: value.aliases === undefined ? [] : parseStringList(value.aliases, `${label}.aliases`),
    relevance: relevance(value.relevance, `${label}.relevance`),
    provenance: parseProvenanceList(value.provenance, `${label}.provenance`),
  };
}

function parseEdge(value: unknown, label: string): SegmentContextGraphEdge {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  knownFields(value, ["from", "to", "relation", "provenance"], label);
  return {
    from: requiredString(value.from, `${label}.from`),
    to: requiredString(value.to, `${label}.to`),
    relation: requiredString(value.relation, `${label}.relation`),
    provenance: parseProvenanceList(value.provenance, `${label}.provenance`),
  };
}

function uniqueById<T extends { id: string }>(rows: T[], label: string): T[] {
  const ids = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.id)) throw new Error(`${label} contains duplicate id ${row.id}.`);
    ids.add(row.id);
  }
  return [...rows].sort((left, right) => left.id.localeCompare(right.id));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort((left, right) => left.localeCompare(right)).map((key) => [key, canonicalize(value[key])]));
}

function contextGraphHash(value: Omit<SegmentContextGraph, "graphHash">): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

/**
 * Creates only a deterministic, provenance-bound snapshot. The caller must
 * hydrate source hashes/revisions from their canonical owners; this function
 * deliberately has no filesystem, database, model, proposal, or write path.
 */
export function buildSegmentContextGraph(input: SegmentContextGraphInput): SegmentContextGraph {
  if (!isRecord(input)) throw new Error("ContextGraph input must be an object.");
  knownFields(input, ["schemaVersion", "segment", "signals", "nodes", "edges"], "ContextGraph input");
  if (input.schemaVersion !== 1) throw new Error("Unsupported ContextGraph schema.");
  if (!Array.isArray(input.signals) || !Array.isArray(input.nodes) || !Array.isArray(input.edges)) {
    throw new Error("ContextGraph signals, nodes, and edges must be arrays.");
  }
  const segment = parseSegment(input.segment);
  const signals = uniqueById(input.signals.map((row, index) => parseSignal(row, `signals[${index}]`)), "signals");
  const nodes = uniqueById(input.nodes.map((row, index) => parseNode(row, `nodes[${index}]`)), "nodes");
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = input.edges.map((row, index) => parseEdge(row, `edges[${index}]`));
  for (const edge of edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) throw new Error(`edge ${edge.from}->${edge.to} references an unknown node.`);
  }
  edges.sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to) || left.relation.localeCompare(right.relation));
  const profile: SegmentContextProfile = {
    contentTypes: signals.filter((signal) => signal.kind === "content_type"),
    risks: signals.filter((signal) => signal.kind === "risk"),
    ambiguities: signals.filter((signal) => signal.kind === "ambiguity"),
  };
  const withoutHash: Omit<SegmentContextGraph, "graphHash"> = {
    schemaVersion: 1,
    authority: "advisory_context",
    canCommit: false,
    segment,
    signals,
    profile,
    nodes,
    edges,
  };
  return deepFreeze({ ...withoutHash, graphHash: contextGraphHash(withoutHash) });
}

function staleReason(provenance: ContextGraphProvenance, current: Map<string, ContextGraphProvenance>): ContextGraphStaleReason | undefined {
  const source = current.get(provenance.sourceId);
  if (!source) return "missing_source";
  if (source.sourceHash !== provenance.sourceHash) return "source_hash_changed";
  if (source.revision !== provenance.revision) return "source_revision_changed";
  return undefined;
}

function sourceMap(sources: ContextGraphProvenance[]): Map<string, ContextGraphProvenance> {
  const current = new Map<string, ContextGraphProvenance>();
  for (const value of sources) {
    const source = parseProvenance(value, "currentSources entry");
    if (current.has(source.sourceId)) throw new Error(`currentSources contains duplicate sourceId ${source.sourceId}.`);
    current.set(source.sourceId, source);
  }
  return current;
}

/**
 * A single changed, missing, or revision-mismatched provenance invalidates the
 * entire derived item. Keeping partial nodes would silently blend revisions.
 */
export function assessSegmentContextGraphFreshness(
  graph: SegmentContextGraph,
  currentSources: ContextGraphProvenance[],
): SegmentContextGraphFreshness {
  const current = sourceMap(currentSources);
  const staleNode = (node: SegmentContextGraphNode): SegmentContextGraphStaleNode | undefined => {
    for (const provenance of node.provenance) {
      const reason = staleReason(provenance, current);
      if (reason) return { node, reason, provenance };
    }
    return undefined;
  };
  const staleSignal = (signal: SegmentContextGraphSignal): SegmentContextGraphStaleSignal | undefined => {
    for (const provenance of signal.provenance) {
      const reason = staleReason(provenance, current);
      if (reason) return { signal, reason, provenance };
    }
    return undefined;
  };
  const nodeResults = graph.nodes.map(staleNode);
  const signalResults = graph.signals.map(staleSignal);
  return {
    activeNodes: graph.nodes.filter((_, index) => !nodeResults[index]),
    staleNodes: nodeResults.filter((value): value is SegmentContextGraphStaleNode => Boolean(value)),
    activeSignals: graph.signals.filter((_, index) => !signalResults[index]),
    staleSignals: signalResults.filter((value): value is SegmentContextGraphStaleSignal => Boolean(value)),
  };
}

function normalized(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}

function rankNode(node: SegmentContextGraphNode, query: string | undefined): { relevance: number; reason: string } | undefined {
  if (!query) return { relevance: node.relevance, reason: `kind:${node.kind}; base_relevance` };
  const wanted = normalized(query);
  if (!wanted) return { relevance: node.relevance, reason: `kind:${node.kind}; base_relevance` };
  const label = normalized(node.label);
  if (label === wanted) return { relevance: 1, reason: `kind:${node.kind}; query:label_exact` };
  if (node.aliases.some((alias) => normalized(alias) === wanted)) return { relevance: 0.98, reason: `kind:${node.kind}; query:alias_exact` };
  if (label.includes(wanted)) return { relevance: 0.9, reason: `kind:${node.kind}; query:label` };
  if (node.aliases.some((alias) => normalized(alias).includes(wanted))) return { relevance: 0.88, reason: `kind:${node.kind}; query:alias` };
  return undefined;
}

/**
 * Targeted retrieval returns advisory nodes only. It filters staleness before
 * relevance ranking so an attractive but old context item cannot be surfaced.
 */
export function retrieveSegmentContextGraph(
  graph: SegmentContextGraph,
  currentSources: ContextGraphProvenance[],
  request: SegmentContextGraphRetrievalRequest = {},
): SegmentContextGraphRetrievalResult {
  const limit = request.limit ?? 10;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("ContextGraph retrieval limit must be an integer from 1 to 100.");
  const nodeKinds = request.nodeKinds === undefined
    ? undefined
    : new Set(request.nodeKinds.map((kind) => {
      if (!(CONTEXT_GRAPH_NODE_KINDS as readonly string[]).includes(kind)) throw new Error(`Unknown ContextGraph node kind ${kind}.`);
      return kind;
    }));
  const freshness = assessSegmentContextGraphFreshness(graph, currentSources);
  const hits = freshness.activeNodes
    .filter((node) => !nodeKinds || nodeKinds.has(node.kind))
    .map((node) => {
      const rank = rankNode(node, request.query);
      return rank ? { node, ...rank, provenance: node.provenance, authority: "advisory_context" as const } : undefined;
    })
    .filter((value): value is SegmentContextGraphRetrievalHit => Boolean(value))
    .sort((left, right) => right.relevance - left.relevance || left.node.id.localeCompare(right.node.id))
    .slice(0, limit);
  return { authority: "advisory_context", hits, staleNodes: freshness.staleNodes };
}
