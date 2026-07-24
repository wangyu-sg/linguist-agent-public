import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ExportAuditRecord } from "./delivery.js";
import type { SegmentProposalSet } from "./proposals.js";
import type {
  QualityDecisionLedgerAppendResult,
  QualityDecisionLedgerEvent,
  QualityDecisionLedgerInput,
} from "./quality_decision_ledger.js";
import type { QualityChecklistDocument } from "./quality_checklist.js";

/**
 * CAT governance is a single authority boundary even though its projections
 * have different product names.  Proposal, QA, waiver, delivery and ledger
 * callers depend on this interface rather than importing SQLite.
 */
export interface CatGovernancePersistence {
  readonly root: string;
  readLedger(projectId: string): Promise<QualityDecisionLedgerEvent[]>;
  appendLedger(
    projectId: string,
    inputs: readonly QualityDecisionLedgerInput[],
    requireLogicalEventId: boolean,
  ): Promise<QualityDecisionLedgerAppendResult>;
  readProposalSet(projectId: string, batchId: string, proposalSetId: string): Promise<SegmentProposalSet | null>;
  listProposalSets(projectId: string, batchId: string): Promise<SegmentProposalSet[]>;
  writeProposalSet(
    projectId: string,
    batchId: string,
    proposalSet: SegmentProposalSet,
    expected: SegmentProposalSet | null,
  ): Promise<void>;
  readQualityChecklist(projectId: string): Promise<QualityChecklistDocument | null>;
  writeQualityChecklist(
    projectId: string,
    document: QualityChecklistDocument,
    expected: QualityChecklistDocument | null,
  ): Promise<void>;
  readExportAudits(projectId: string, batchId?: string): Promise<ExportAuditRecord[]>;
  appendExportAudit(projectId: string, record: ExportAuditRecord): Promise<void>;
}

const persistenceByRoot = new Map<string, CatGovernancePersistence>();

export function catGovernanceAuthorityMarkerPath(root: string): string {
  return join(resolve(root), "data", "runtime", "cat-governance-sqlite-v1", "authority-v1.json");
}

function cachePart(value: string): string {
  return encodeURIComponent(value).replace(/%/gu, "_");
}

export function catGovernanceReadCachePath(
  root: string,
  kind: "ledger" | "checklist" | "proposal" | "export-audit",
  projectId: string,
  batchId?: string,
  proposalSetId?: string,
): string {
  const parts = [resolve(root), "data", "runtime", "cat-governance-sqlite-v1", "read-cache", cachePart(projectId)];
  if (kind === "proposal") parts.push("proposals", cachePart(batchId ?? "batch"), `${cachePart(proposalSetId ?? "proposal")}.json`);
  else parts.push(`${kind}.json`);
  return join(...parts);
}

export async function readCatGovernanceReadCache<T>(
  root: string,
  kind: "ledger" | "checklist" | "proposal" | "export-audit",
  projectId: string,
  batchId?: string,
  proposalSetId?: string,
): Promise<T | null> {
  try {
    await readFile(catGovernanceAuthorityMarkerPath(root), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    return JSON.parse(await readFile(catGovernanceReadCachePath(root, kind, projectId, batchId, proposalSetId), "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`SQLite CAT governance read projection is missing for ${kind}/${projectId}.`);
    }
    throw error;
  }
}

export function installCatGovernancePersistence(root: string, persistence: CatGovernancePersistence): void {
  const key = resolve(root);
  if (resolve(persistence.root) !== key) throw new Error("CAT governance persistence root does not match installation root.");
  const current = persistenceByRoot.get(key);
  if (current && current !== persistence) throw new Error(`CAT governance persistence is already installed for ${key}.`);
  persistenceByRoot.set(key, persistence);
}

export function catGovernancePersistenceFor(root: string): CatGovernancePersistence | undefined {
  return persistenceByRoot.get(resolve(root));
}

export async function assertCatGovernanceLegacyAllowed(root: string): Promise<void> {
  if (catGovernancePersistenceFor(root)) return;
  try {
    const { readFile } = await import("node:fs/promises");
    await readFile(catGovernanceAuthorityMarkerPath(root), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error("SQLite CAT governance storage is authoritative; legacy governance writers are disabled.");
}

export function resetCatGovernancePersistenceForTests(root: string): void {
  persistenceByRoot.delete(resolve(root));
}
