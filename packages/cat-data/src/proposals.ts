import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  assertSegmentWriteAllowed,
  readBatch,
  updateSegmentTarget,
  type BatchSegment,
  type SegmentChangeType,
} from "./batch_workspace.js";
import { createWorkspace, readJsonFile, workspacePath, writeJsonFile } from "./workspace.js";
import { assertChangeEvidenceAllowed } from "./write_policy.js";
import { assertCatGovernanceLegacyAllowed, catGovernancePersistenceFor, readCatGovernanceReadCache } from "./cat_governance_storage.js";

export type ProposalStatus = "proposed" | "applied" | "rejected" | "skipped";
export type ProposalSetStatus = "active" | "superseded" | "closed";

export interface SegmentProposalInput {
  segmentId: string;
  proposedTarget: string;
  reason: string;
  changeType: SegmentChangeType;
  evidenceSources?: string[];
  severity?: "L1" | "L2" | "L3" | "info" | string;
}

export interface SegmentProposal {
  proposalId: string;
  index: number;
  segmentId: string;
  source: string;
  originalTarget: string;
  proposedTarget: string;
  reason: string;
  changeType: SegmentChangeType;
  evidenceSources: string[];
  severity?: string;
  status: ProposalStatus;
  createdAt: string;
  updatedAt: string;
  appliedAt?: string;
  skipReason?: string;
}

export interface SegmentProposalSet {
  schemaVersion: 1;
  projectId: string;
  batchId: string;
  proposalSetId: string;
  title: string;
  status: ProposalSetStatus;
  supersedesProposalSetId?: string;
  supersededByProposalSetId?: string;
  closedAt?: string;
  createdAt: string;
  updatedAt: string;
  proposals: SegmentProposal[];
}

export interface ProposalApplyResult {
  proposalSetId: string;
  applied: string[];
  skipped: Array<{ proposalId: string; reason: string }>;
  rejected: string[];
}

export interface ProposalReportResult {
  proposalSetId: string;
  markdown: string;
  generatedAt: string;
  path?: string;
}

function proposalRoot(workspaceRoot: string, projectId: string, batchId: string): string {
  return workspacePath(createWorkspace(workspaceRoot, projectId), "batches", batchId, "proposals");
}

export function proposalPath(workspaceRoot: string, projectId: string, batchId: string, proposalSetId: string): string {
  return join(proposalRoot(workspaceRoot, projectId, batchId), `${proposalSetId}.json`);
}

function safeProposalSetId(value: string): string {
  return value.replace(/[/:]+/g, "-").replace(/\s+/g, "-").replace(/[^A-Za-z0-9_.-]+/g, "").slice(0, 80) || "proposals";
}

function proposalId(index: number, segment: BatchSegment): string {
  return `p${String(index).padStart(4, "0")}-${segment.id.replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 48)}`;
}

export async function createProposalSet(
  workspaceRoot: string,
  projectId: string,
  batchId: string,
  options: {
    proposalSetId?: string;
    title?: string;
    proposals: SegmentProposalInput[];
    overwrite?: boolean;
    supersedesProposalSetId?: string;
  },
): Promise<{ proposalSet: SegmentProposalSet; path: string }> {
  const batch = await readBatch(workspaceRoot, projectId, batchId);
  if (!options.proposals.length) throw new Error("createProposalSet requires at least one proposal.");
  const persistence = catGovernancePersistenceFor(workspaceRoot);
  const now = new Date().toISOString();
  const proposalSetId = safeProposalSetId(options.proposalSetId ?? `${now.replace(/[:.]/g, "-")}`);
  const path = proposalPath(workspaceRoot, projectId, batchId, proposalSetId);
  const existing = persistence
    ? await persistence.readProposalSet(projectId, batchId, proposalSetId)
    : await readCatGovernanceReadCache<SegmentProposalSet>(workspaceRoot, "proposal", projectId, batchId, proposalSetId) ?? await readJsonFile<SegmentProposalSet | null>(path, null);
  if (!persistence) await assertCatGovernanceLegacyAllowed(workspaceRoot);
  if (existing && !options.overwrite) {
    throw new Error(`Proposal set ${proposalSetId} already exists. Pass overwrite=true to replace it.`);
  }

  const proposals: SegmentProposal[] = options.proposals.map((input, offset) => {
    const segment = batch.segments.find((candidate) => candidate.id === input.segmentId);
    if (!segment) throw new Error(`Segment ${input.segmentId} not found in batch ${batchId}.`);
    const evidenceSources = assertChangeEvidenceAllowed(input);
    return {
      proposalId: proposalId(offset + 1, segment),
      index: offset + 1,
      segmentId: segment.id,
      source: segment.source,
      originalTarget: segment.target,
      proposedTarget: input.proposedTarget,
      reason: input.reason,
      changeType: input.changeType,
      evidenceSources,
      severity: input.severity,
      status: "proposed",
      createdAt: now,
      updatedAt: now,
    };
  });

  const proposalSet: SegmentProposalSet = {
    schemaVersion: 1,
    projectId,
    batchId,
    proposalSetId,
    title: options.title ?? "Segment proposals",
    status: "active",
    supersedesProposalSetId: options.supersedesProposalSetId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    proposals,
  };
  await mkdir(dirname(path), { recursive: true });
  if (options.supersedesProposalSetId && options.supersedesProposalSetId !== proposalSetId) {
    const previousPath = proposalPath(workspaceRoot, projectId, batchId, options.supersedesProposalSetId);
    const previous = await readJsonFile<SegmentProposalSet | null>(previousPath, null);
    if (previous) {
      previous.status = "superseded";
      previous.supersededByProposalSetId = proposalSetId;
      previous.updatedAt = now;
      const normalizedPrevious = normalizeProposalSet(previous);
      if (persistence) await persistence.writeProposalSet(projectId, batchId, normalizedPrevious, previous);
      else await writeJsonFile(previousPath, normalizedPrevious);
    }
  }
  if (persistence) await persistence.writeProposalSet(projectId, batchId, proposalSet, existing);
  else await writeJsonFile(path, proposalSet);
  return { proposalSet, path };
}

function normalizeProposalSet(proposalSet: SegmentProposalSet): SegmentProposalSet {
  const proposed = proposalSet.proposals.filter((proposal) => proposal.status === "proposed").length;
  return {
    ...proposalSet,
    status: proposalSet.status ?? (proposed ? "active" : "closed"),
  };
}

export async function readProposalSet(
  workspaceRoot: string,
  projectId: string,
  batchId: string,
  proposalSetId: string,
): Promise<SegmentProposalSet> {
  const persistence = catGovernancePersistenceFor(workspaceRoot);
  let proposalSet: SegmentProposalSet | null;
  let usedLegacyRead = false;
  if (persistence) proposalSet = await persistence.readProposalSet(projectId, batchId, proposalSetId);
  else {
    const index = await readCatGovernanceReadCache<SegmentProposalSet[]>(workspaceRoot, "proposal", projectId, "__index__", "index");
    if (index && !index.some((candidate) => candidate.batchId === batchId && candidate.proposalSetId === proposalSetId)) proposalSet = null;
    else {
      const cached = await readCatGovernanceReadCache<SegmentProposalSet>(workspaceRoot, "proposal", projectId, batchId, proposalSetId);
      if (cached) proposalSet = cached;
      else {
        usedLegacyRead = true;
        proposalSet = await readJsonFile<SegmentProposalSet | null>(proposalPath(workspaceRoot, projectId, batchId, proposalSetId), null);
      }
    }
  }
  if (!persistence && usedLegacyRead) await assertCatGovernanceLegacyAllowed(workspaceRoot);
  if (!proposalSet) throw new Error(`Proposal set ${proposalSetId} not found for batch ${batchId}.`);
  return normalizeProposalSet(proposalSet);
}

export async function listProposalSets(
  workspaceRoot: string,
  projectId: string,
  batchId: string,
): Promise<Array<{ proposalSetId: string; path: string; title: string; status: ProposalSetStatus; supersedesProposalSetId?: string; supersededByProposalSetId?: string; proposed: number; applied: number; skipped: number; rejected: number; updatedAt: string }>> {
  const persistence = catGovernancePersistenceFor(workspaceRoot);
  if (persistence) {
    return (await persistence.listProposalSets(projectId, batchId)).map((set) => ({
      proposalSetId: set.proposalSetId,
      path: proposalPath(workspaceRoot, projectId, batchId, set.proposalSetId),
      title: set.title,
      status: set.status,
      supersedesProposalSetId: set.supersedesProposalSetId,
      supersededByProposalSetId: set.supersededByProposalSetId,
      proposed: set.proposals.filter((proposal) => proposal.status === "proposed").length,
      applied: set.proposals.filter((proposal) => proposal.status === "applied").length,
      skipped: set.proposals.filter((proposal) => proposal.status === "skipped").length,
      rejected: set.proposals.filter((proposal) => proposal.status === "rejected").length,
      updatedAt: set.updatedAt,
    }));
  }
  const cached = await readCatGovernanceReadCache<SegmentProposalSet[]>(workspaceRoot, "proposal", projectId, "__index__", "index");
  if (cached) {
    return cached.filter((set) => set.batchId === batchId).map((set) => ({
      proposalSetId: set.proposalSetId,
      path: proposalPath(workspaceRoot, projectId, batchId, set.proposalSetId),
      title: set.title,
      status: set.status,
      supersedesProposalSetId: set.supersedesProposalSetId,
      supersededByProposalSetId: set.supersededByProposalSetId,
      proposed: set.proposals.filter((proposal) => proposal.status === "proposed").length,
      applied: set.proposals.filter((proposal) => proposal.status === "applied").length,
      skipped: set.proposals.filter((proposal) => proposal.status === "skipped").length,
      rejected: set.proposals.filter((proposal) => proposal.status === "rejected").length,
      updatedAt: set.updatedAt,
    }));
  }
  await assertCatGovernanceLegacyAllowed(workspaceRoot);
  const root = proposalRoot(workspaceRoot, projectId, batchId);
  let files: string[] = [];
  try {
    const { readdir } = await import("node:fs/promises");
    files = (await readdir(root)).filter((file) => file.endsWith(".json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const rows = await Promise.all(
    files.map(async (file) => {
      const proposalSetId = file.replace(/\.json$/, "");
      const path = proposalPath(workspaceRoot, projectId, batchId, proposalSetId);
      const set = normalizeProposalSet(await readJsonFile<SegmentProposalSet>(path, {
        schemaVersion: 1,
        projectId,
        batchId,
        proposalSetId,
        title: proposalSetId,
        status: "active",
        createdAt: "",
        updatedAt: "",
        proposals: [],
      }));
      return {
        proposalSetId,
        path,
        title: set.title,
        status: set.status,
        supersedesProposalSetId: set.supersedesProposalSetId,
        supersededByProposalSetId: set.supersededByProposalSetId,
        proposed: set.proposals.filter((proposal) => proposal.status === "proposed").length,
        applied: set.proposals.filter((proposal) => proposal.status === "applied").length,
        skipped: set.proposals.filter((proposal) => proposal.status === "skipped").length,
        rejected: set.proposals.filter((proposal) => proposal.status === "rejected").length,
        updatedAt: set.updatedAt,
      };
    }),
  );
  return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function applyProposalSet(
  workspaceRoot: string,
  projectId: string,
  batchId: string,
  proposalSetId: string,
  options: {
    proposalIds?: string[];
    rejectProposalIds?: string[];
    confirm?: boolean;
    propagateDuplicates?: boolean;
    rejectUnselected?: boolean;
  } = {},
): Promise<ProposalApplyResult> {
  const proposalSet = await readProposalSet(workspaceRoot, projectId, batchId, proposalSetId);
  const selected = options.proposalIds ? new Set(options.proposalIds) : undefined;
  const explicitRejects = options.rejectProposalIds ? new Set(options.rejectProposalIds) : undefined;
  const applyAllWhenUnspecified = !selected && !explicitRejects;
  const now = new Date().toISOString();
  const applied: string[] = [];
  const rejected: string[] = [];
  const skipped: ProposalApplyResult["skipped"] = [];

  for (const proposal of proposalSet.proposals) {
    if (proposal.status !== "proposed") continue;
    if (explicitRejects?.has(proposal.proposalId)) {
      proposal.status = "rejected";
      proposal.updatedAt = now;
      rejected.push(proposal.proposalId);
      continue;
    }
    if (selected && !selected.has(proposal.proposalId)) {
      if (options.rejectUnselected) {
        proposal.status = "rejected";
        proposal.updatedAt = now;
        rejected.push(proposal.proposalId);
      }
      continue;
    }
    if (!selected && !applyAllWhenUnspecified) continue;
    try {
      assertSegmentWriteAllowed(proposal);
      const result = await updateSegmentTarget(workspaceRoot, projectId, batchId, {
        segmentId: proposal.segmentId,
        target: proposal.proposedTarget,
        confirm: options.confirm,
        propagateDuplicates: options.propagateDuplicates ?? false,
        reason: proposal.reason,
        changeType: proposal.changeType,
        evidenceSources: proposal.evidenceSources,
      });
      if (!result.changedSegmentIds.includes(proposal.segmentId)) {
        proposal.status = "skipped";
        proposal.skipReason = result.skippedLockedIds.includes(proposal.segmentId) ? "locked segment" : "segment not changed";
        skipped.push({ proposalId: proposal.proposalId, reason: proposal.skipReason });
      } else {
        proposal.status = "applied";
        proposal.appliedAt = now;
        applied.push(proposal.proposalId);
      }
    } catch (error) {
      proposal.status = "skipped";
      proposal.skipReason = error instanceof Error ? error.message : String(error);
      skipped.push({ proposalId: proposal.proposalId, reason: proposal.skipReason });
    }
    proposal.updatedAt = now;
  }
  proposalSet.updatedAt = now;
  if (!proposalSet.proposals.some((proposal) => proposal.status === "proposed")) {
    proposalSet.status = "closed";
    proposalSet.closedAt = now;
  }
  const persistence = catGovernancePersistenceFor(workspaceRoot);
  if (persistence) await persistence.writeProposalSet(projectId, batchId, proposalSet, await persistence.readProposalSet(projectId, batchId, proposalSetId));
  else {
    await assertCatGovernanceLegacyAllowed(workspaceRoot);
    await writeJsonFile(proposalPath(workspaceRoot, projectId, batchId, proposalSetId), proposalSet);
  }
  return { proposalSetId, applied, skipped, rejected };
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>").trim() || "-";
}

function statusSummary(proposals: SegmentProposal[]): string {
  const counts = new Map<ProposalStatus, number>();
  for (const status of ["proposed", "applied", "rejected", "skipped"] as const) counts.set(status, 0);
  for (const proposal of proposals) counts.set(proposal.status, (counts.get(proposal.status) ?? 0) + 1);
  return [...counts.entries()].map(([status, count]) => `${status}:${count}`).join(" · ");
}

function proposalStatusDetail(proposal: SegmentProposal): string {
  if (proposal.status === "applied") return proposal.appliedAt ? `applied at ${proposal.appliedAt}` : "applied";
  if (proposal.status === "skipped") return proposal.skipReason ? `skipped: ${proposal.skipReason}` : "skipped";
  if (proposal.status === "rejected") return "rejected by reviewer/user";
  return "pending review";
}

export function renderProposalSetMarkdown(
  proposalSet: SegmentProposalSet,
  options: { generatedAt?: string } = {},
): string {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const lines: string[] = [];
  lines.push(`# ${proposalSet.title}`);
  lines.push("");
  lines.push(`Project: ${proposalSet.projectId}`);
  lines.push(`Batch: ${proposalSet.batchId}`);
  lines.push(`Proposal set: ${proposalSet.proposalSetId}`);
  lines.push(`Set status: ${proposalSet.status}`);
  if (proposalSet.supersedesProposalSetId) lines.push(`Supersedes: ${proposalSet.supersedesProposalSetId}`);
  if (proposalSet.supersededByProposalSetId) lines.push(`Superseded by: ${proposalSet.supersededByProposalSetId}`);
  lines.push(`Created: ${proposalSet.createdAt}`);
  lines.push(`Updated: ${proposalSet.updatedAt}`);
  lines.push(`Generated: ${generatedAt}`);
  lines.push(`Rows: ${proposalSet.proposals.length}`);
  lines.push(`Status summary: ${statusSummary(proposalSet.proposals)}`);
  lines.push("");
  lines.push("| proposal | seg | apply status | status detail | severity | type | source | original target | proposed target | reason / rule | evidence |");
  lines.push("|---|---:|---|---|---|---|---|---|---|---|---|");
  for (const proposal of proposalSet.proposals) {
    lines.push(
      `| ${[
        proposal.proposalId,
        String(proposal.index),
        proposal.status,
        proposalStatusDetail(proposal),
        proposal.severity ?? "-",
        proposal.changeType,
        proposal.source,
        proposal.originalTarget || "(empty)",
        proposal.proposedTarget || "(empty)",
        proposal.reason,
        proposal.evidenceSources.length ? proposal.evidenceSources.join("; ") : "(none)",
      ]
        .map(escapeMarkdownCell)
        .join(" | ")} |`,
    );
  }
  return lines.join("\n");
}

export async function writeProposalReport(
  workspaceRoot: string,
  projectId: string,
  batchId: string,
  proposalSetId: string,
  options: { writeFile?: boolean; generatedAt?: string } = {},
): Promise<ProposalReportResult> {
  const proposalSet = await readProposalSet(workspaceRoot, projectId, batchId, proposalSetId);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const markdown = renderProposalSetMarkdown(proposalSet, { generatedAt });
  if (options.writeFile === false) return { proposalSetId, markdown, generatedAt };
  const path = workspacePath(createWorkspace(workspaceRoot, projectId), "batches", batchId, "reports", `${proposalSetId}.md`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, markdown + "\n", "utf8");
  return { proposalSetId, markdown, generatedAt, path };
}
