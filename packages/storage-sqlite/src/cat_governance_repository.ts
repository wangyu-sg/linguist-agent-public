import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  catGovernanceReadCachePath,
  catGovernancePersistenceFor,
  type CatGovernancePersistence,
} from "@linguist-agent/cat-data";
import type { ExportAuditRecord } from "@linguist-agent/cat-data";
import type { SegmentProposalSet } from "@linguist-agent/cat-data";
import type {
  QualityDecisionLedgerAppendResult,
  QualityDecisionLedgerEvent,
  QualityDecisionLedgerInput,
} from "@linguist-agent/cat-data";
import type { QualityChecklistDocument } from "@linguist-agent/cat-data";
import {
  SqliteEventProjectionStore,
  SqliteRevisionConflictError,
  type SqliteJsonObject,
  type SqliteStorageAuthority,
} from "./index.js";

export const SQLITE_CAT_GOVERNANCE_REPOSITORY_READINESS = Object.freeze({
  schemaVersion: 1,
  authority: "sqlite",
  domains: ["proposal", "quality-checklist", "quality-decision-ledger", "export-audit"],
  evidence: "embedded-references-preserved",
} as const);

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${stableJson(row[key])}`).join(",")}}`;
}

function sameJson(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

function jsonObject(value: unknown): SqliteJsonObject {
  return JSON.parse(JSON.stringify(value)) as SqliteJsonObject;
}

function streamId(kind: string, ...parts: string[]): string {
  const digest = createHash("sha256").update(JSON.stringify([kind, ...parts])).digest("hex").slice(0, 48);
  return `cat-governance-${kind}-${digest}`;
}

function proposalStreamId(projectId: string, batchId: string, proposalSetId: string): string {
  return streamId("proposal", projectId, batchId, proposalSetId);
}

function checklistStreamId(projectId: string): string {
  return streamId("checklist", projectId);
}

function ledgerStreamId(projectId: string): string {
  return streamId("ledger", projectId);
}

function exportAuditStreamId(projectId: string): string {
  return streamId("export-audit", projectId);
}

function commandId(prefix: string, stream: string, revision: number, payload: unknown): string {
  return `${prefix}-${createHash("sha256").update(stableJson({ stream, revision, payload })).digest("hex").slice(0, 48)}`;
}

function eventId(prefix: string, stream: string, revision: number, payload: unknown): string {
  return `${prefix}-${createHash("sha256").update(stableJson({ stream, revision, payload })).digest("hex").slice(0, 48)}`;
}

function ledgerHash(event: Omit<QualityDecisionLedgerEvent, "hash">): string {
  return createHash("sha256").update(JSON.stringify(event)).digest("hex");
}

function comparableLedgerInput(input: QualityDecisionLedgerInput): string {
  return JSON.stringify({
    projectId: input.projectId,
    batchId: input.batchId,
    workflowId: input.workflowId,
    segmentId: input.segmentId,
    findingId: input.findingId,
    code: input.code,
    severity: input.severity,
    kind: input.kind,
    decision: input.decision,
    reason: input.reason,
    evidenceRefs: input.evidenceRefs ? [...new Set(input.evidenceRefs)].sort() : undefined,
    actor: input.actor,
    logicalEventId: input.logicalEventId,
  });
}

type ProposalProjection = { kind: "proposal"; projectId: string; batchId: string; proposalSet: SegmentProposalSet };
type ChecklistProjection = { kind: "checklist"; projectId: string; document: QualityChecklistDocument };
type LedgerProjection = { kind: "ledger"; projectId: string; events: QualityDecisionLedgerEvent[] };
type ExportAuditProjection = { kind: "export-audit"; projectId: string; records: ExportAuditRecord[] };

function readProjection<T>(store: SqliteEventProjectionStore, stream: string, kind: string): { value: T; revision: number } | null {
  const current = store.readProjection(stream);
  if (!current) return null;
  const value = current.value as unknown as Record<string, unknown>;
  if (value.kind !== kind) throw new Error(`SQLite CAT governance stream ${stream} has an unexpected projection kind.`);
  return { value: current.value as unknown as T, revision: current.revision };
}

async function writeReadCache(
  root: string,
  kind: "ledger" | "checklist" | "proposal" | "export-audit",
  projectId: string,
  value: unknown,
  batchId?: string,
  proposalSetId?: string,
): Promise<void> {
  const path = catGovernanceReadCachePath(root, kind, projectId, batchId, proposalSetId);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
}

export interface SqliteCatGovernanceRepositoryInput {
  root: string;
  store: SqliteEventProjectionStore;
  authority: SqliteStorageAuthority;
}

export class SqliteCatGovernanceRepository implements CatGovernancePersistence {
  readonly root: string;
  readonly #store: SqliteEventProjectionStore;
  readonly #authority: SqliteStorageAuthority;

  constructor(input: SqliteCatGovernanceRepositoryInput) {
    this.root = resolve(input.root);
    this.#store = input.store;
    this.#authority = input.authority;
  }

  async readLedger(projectId: string): Promise<QualityDecisionLedgerEvent[]> {
    const current = readProjection<LedgerProjection>(this.#store, ledgerStreamId(projectId), "ledger");
    return current?.value.events ?? [];
  }

  /**
   * Seed the cross-process read projections for zero-row domains as well as
   * populated streams.  A missing cache after the authority marker is
   * published is treated as corruption, so an empty legacy domain must have
   * an explicit empty projection.
   */
  async syncReadCaches(projectId: string): Promise<void> {
    const ledger = readProjection<LedgerProjection>(this.#store, ledgerStreamId(projectId), "ledger")?.value.events ?? [];
    await writeReadCache(this.root, "ledger", projectId, ledger);
    const checklist = readProjection<ChecklistProjection>(this.#store, checklistStreamId(projectId), "checklist")?.value.document
      ?? { schemaVersion: 1, projectId, updatedAt: "", mechanicalOptions: {}, entries: [] } satisfies QualityChecklistDocument;
    await writeReadCache(this.root, "checklist", projectId, checklist);
    const proposals = this.#store.listProjections()
      .map((projection) => projection.value as unknown as Record<string, unknown>)
      .filter((value): value is ProposalProjection => value.kind === "proposal" && value.projectId === projectId)
      .map((value) => value.proposalSet)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    await writeReadCache(this.root, "proposal", projectId, proposals, "__index__", "index");
    const audits = readProjection<ExportAuditProjection>(this.#store, exportAuditStreamId(projectId), "export-audit")?.value.records ?? [];
    await writeReadCache(this.root, "export-audit", projectId, audits);
  }

  async appendLedger(
    projectId: string,
    inputs: readonly QualityDecisionLedgerInput[],
    requireLogicalEventId: boolean,
  ): Promise<QualityDecisionLedgerAppendResult> {
    if (!inputs.length) return { events: [], appended: 0, skipped: 0 };
    if (inputs.some((input) => input.projectId !== projectId)) throw new Error("CAT governance ledger batch requires one projectId.");
    for (const input of inputs) {
      if (requireLogicalEventId && !input.logicalEventId) throw new Error("CAT governance idempotent append requires logicalEventId.");
      if (input.logicalEventId !== undefined && (!input.logicalEventId.trim() || input.logicalEventId.length > 1024 || /[\r\n]/u.test(input.logicalEventId))) {
        throw new Error("CAT governance logicalEventId is invalid.");
      }
      if (["quality_waiver", "delivery_waiver"].includes(input.kind) && !input.reason?.trim()) {
        throw new Error("CAT governance waiver requires a reason.");
      }
    }
    await this.#authority.assertOwned();
    const stream = ledgerStreamId(projectId);
    const current = readProjection<LedgerProjection>(this.#store, stream, "ledger");
    const existing = current?.value.events ?? [];
    const byLogicalEventId = new Map(existing.flatMap((event) => event.logicalEventId ? [[event.logicalEventId, event] as const] : []));
    const events: QualityDecisionLedgerEvent[] = [];
    const appended: QualityDecisionLedgerEvent[] = [];
    for (const input of inputs) {
      const prior = input.logicalEventId ? byLogicalEventId.get(input.logicalEventId) : undefined;
      if (prior) {
        if (comparableLedgerInput(prior) !== comparableLedgerInput(input)) throw new Error(`CAT governance logical event ${input.logicalEventId} conflicts with its recorded payload.`);
        events.push(prior);
        continue;
      }
      const previous = appended.at(-1) ?? existing.at(-1);
      const withoutHash: Omit<QualityDecisionLedgerEvent, "hash"> = {
        ...input,
        recordedAt: input.recordedAt ?? new Date().toISOString(),
        schemaVersion: 1,
        sequence: existing.length + appended.length + 1,
        ...(previous?.hash ? { previousHash: previous.hash } : {}),
      };
      const event = { ...withoutHash, hash: ledgerHash(withoutHash) };
      appended.push(event);
      events.push(event);
      if (input.logicalEventId) byLogicalEventId.set(input.logicalEventId, event);
    }
    if (!appended.length) return { events, appended: 0, skipped: events.length };
    const projection: LedgerProjection = { kind: "ledger", projectId, events: [...existing, ...appended] };
    if (!current) {
      this.#store.initializeProjection({
        commandId: commandId("cat-governance-ledger-init", stream, 0, projection),
        streamId: stream,
        projection: jsonObject(projection),
      });
    } else {
      this.#store.append({
        commandId: commandId("cat-governance-ledger-append", stream, current.revision, appended),
        streamId: stream,
        expectedRevision: current.revision,
        events: appended.map((event) => ({ id: event.hash.slice(0, 48), type: "quality_decision_ledger.appended", occurredAt: event.recordedAt ?? new Date().toISOString(), payload: jsonObject(event) })),
        projection: jsonObject(projection),
      });
    }
    await writeReadCache(this.root, "ledger", projectId, projection.events);
    return { events, appended: appended.length, skipped: events.length - appended.length };
  }

  async readProposalSet(projectId: string, batchId: string, proposalSetId: string): Promise<SegmentProposalSet | null> {
    return readProjection<ProposalProjection>(this.#store, proposalStreamId(projectId, batchId, proposalSetId), "proposal")?.value.proposalSet ?? null;
  }

  async listProposalSets(projectId: string, batchId: string): Promise<SegmentProposalSet[]> {
    return this.#store.listProjections()
      .map((projection) => projection.value as unknown as Record<string, unknown>)
      .filter((value): value is ProposalProjection => value.kind === "proposal" && value.projectId === projectId && value.batchId === batchId)
      .map((value) => value.proposalSet)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async writeProposalSet(projectId: string, batchId: string, proposalSet: SegmentProposalSet, expected: SegmentProposalSet | null): Promise<void> {
    await this.#authority.assertOwned();
    if (proposalSet.projectId !== projectId || proposalSet.batchId !== batchId) throw new Error("CAT governance proposal scope does not match the requested scope.");
    const stream = proposalStreamId(projectId, batchId, proposalSet.proposalSetId);
    const current = readProjection<ProposalProjection>(this.#store, stream, "proposal");
    if (current && !expected || !current && expected || current && expected && !sameJson(current.value.proposalSet, expected)) {
      throw new SqliteRevisionConflictError(stream, expected ? current?.revision ?? 0 : 0, current?.revision ?? 0);
    }
    const projection: ProposalProjection = { kind: "proposal", projectId, batchId, proposalSet };
    if (!current) {
      this.#store.initializeProjection({ commandId: commandId("cat-governance-proposal-init", stream, 0, projection), streamId: stream, projection: jsonObject(projection) });
      await writeReadCache(this.root, "proposal", projectId, proposalSet, batchId, proposalSet.proposalSetId);
      await this.writeProposalIndex(projectId);
      return;
    }
    this.#store.append({
      commandId: commandId("cat-governance-proposal-write", stream, current.revision, projection),
      streamId: stream,
      expectedRevision: current.revision,
      events: [{ id: eventId("cat-governance-proposal", stream, current.revision + 1, projection), type: "cat_governance.proposal.updated", occurredAt: proposalSet.updatedAt, payload: jsonObject({ proposalSetId: proposalSet.proposalSetId, status: proposalSet.status }) }],
      projection: jsonObject(projection),
    });
    await writeReadCache(this.root, "proposal", projectId, proposalSet, batchId, proposalSet.proposalSetId);
    await this.writeProposalIndex(projectId);
  }

  private async writeProposalIndex(projectId: string): Promise<void> {
    const all = this.#store.listProjections()
      .map((projection) => projection.value as unknown as Record<string, unknown>)
      .filter((value): value is ProposalProjection => value.kind === "proposal" && value.projectId === projectId)
      .map((value) => value.proposalSet)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    await writeReadCache(this.root, "proposal", projectId, all, "__index__", "index");
  }

  async readQualityChecklist(projectId: string): Promise<QualityChecklistDocument | null> {
    return readProjection<ChecklistProjection>(this.#store, checklistStreamId(projectId), "checklist")?.value.document ?? null;
  }

  async writeQualityChecklist(projectId: string, document: QualityChecklistDocument, expected: QualityChecklistDocument | null): Promise<void> {
    await this.#authority.assertOwned();
    if (document.projectId !== projectId) throw new Error("CAT governance checklist scope does not match the requested scope.");
    const stream = checklistStreamId(projectId);
    const current = readProjection<ChecklistProjection>(this.#store, stream, "checklist");
    if (current && !expected || !current && expected || current && expected && !sameJson(current.value.document, expected)) {
      throw new SqliteRevisionConflictError(stream, expected ? current?.revision ?? 0 : 0, current?.revision ?? 0);
    }
    const projection: ChecklistProjection = { kind: "checklist", projectId, document };
    if (!current) {
      this.#store.initializeProjection({ commandId: commandId("cat-governance-checklist-init", stream, 0, projection), streamId: stream, projection: jsonObject(projection) });
      await writeReadCache(this.root, "checklist", projectId, document);
      return;
    }
    this.#store.append({
      commandId: commandId("cat-governance-checklist-write", stream, current.revision, projection),
      streamId: stream,
      expectedRevision: current.revision,
      events: [{ id: eventId("cat-governance-checklist", stream, current.revision + 1, projection), type: "cat_governance.checklist.updated", occurredAt: document.updatedAt, payload: jsonObject({ projectId, entryCount: document.entries.length }) }],
      projection: jsonObject(projection),
    });
    await writeReadCache(this.root, "checklist", projectId, document);
  }

  async readExportAudits(projectId: string, batchId?: string): Promise<ExportAuditRecord[]> {
    const records = readProjection<ExportAuditProjection>(this.#store, exportAuditStreamId(projectId), "export-audit")?.value.records ?? [];
    return (batchId ? records.filter((record) => record.batchId === batchId) : records).sort((left, right) => right.exportedAt.localeCompare(left.exportedAt));
  }

  async appendExportAudit(projectId: string, record: ExportAuditRecord): Promise<void> {
    await this.#authority.assertOwned();
    if (record.projectId !== projectId) throw new Error("CAT governance export audit scope does not match the requested scope.");
    const stream = exportAuditStreamId(projectId);
    const current = readProjection<ExportAuditProjection>(this.#store, stream, "export-audit");
    const records = [...(current?.value.records ?? [])];
    if (records.some((candidate) => candidate.auditId === record.auditId && !sameJson(candidate, record))) throw new Error(`CAT governance export audit ${record.auditId} conflicts with an existing record.`);
    if (records.some((candidate) => candidate.auditId === record.auditId)) return;
    records.push(record);
    const projection: ExportAuditProjection = { kind: "export-audit", projectId, records };
    if (!current) {
      this.#store.initializeProjection({ commandId: commandId("cat-governance-audit-init", stream, 0, projection), streamId: stream, projection: jsonObject(projection) });
      await writeReadCache(this.root, "export-audit", projectId, records);
      return;
    }
    this.#store.append({
      commandId: commandId("cat-governance-audit-append", stream, current.revision, record),
      streamId: stream,
      expectedRevision: current.revision,
      events: [{ id: eventId("cat-governance-audit", stream, current.revision + 1, record), type: "cat_governance.export_audit.appended", occurredAt: record.exportedAt, payload: jsonObject({ auditId: record.auditId, batchId: record.batchId, format: record.format }) }],
      projection: jsonObject(projection),
    });
    await writeReadCache(this.root, "export-audit", projectId, records);
  }

  close(): void {
    this.#store.close();
  }
}

export function catGovernanceRepositoryFor(root: string): CatGovernancePersistence | undefined {
  return catGovernancePersistenceFor(root);
}
