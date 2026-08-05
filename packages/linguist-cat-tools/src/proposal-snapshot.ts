import { createHash } from 'node:crypto'
import { asProposalId, type TranslationProposal } from '@linguist/cat-core'
import type { ProjectDatabase } from '@linguist/cat-store'
import type {
  CatProposalReviewSnapshot,
  CatProposalReviewSnapshotStatus,
  CatSegmentBrief,
} from './types'

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value === null || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  return Object.fromEntries(
    Object.keys(record)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, canonicalize(record[key])]),
  )
}

function snapshotHash(value: object): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}

function snapshotStatus(
  proposal: TranslationProposal,
  currentRevision: number,
): CatProposalReviewSnapshotStatus {
  if (proposal.status === 'accepted') return 'accepted'
  if (proposal.status === 'rejected') return 'rejected'
  return proposal.status === 'pending' && proposal.baseRevision === currentRevision
    ? 'pending'
    : 'stale'
}

export function buildProposalReviewSnapshot(
  db: ProjectDatabase,
  proposal: TranslationProposal,
): CatProposalReviewSnapshot {
  const segment = db.segments.getById(proposal.segmentId)
  if (segment === undefined) throw new Error(`Proposal segment not found: ${proposal.segmentId}`)
  const neighbors = db.segments.neighbors(segment.id, 1)
  const issuances = db.proposals.listIssuances(proposal.id)
  const producer = issuances.at(-1)
  if (producer === undefined) throw new Error(`Proposal issuance not found: ${proposal.id}`)
  const brief = (item: typeof segment): CatSegmentBrief => ({
    segmentId: item.id as string,
    revision: item.revision,
    source: item.source,
    currentTarget: item.target,
  })
  const withoutHash = {
    snapshotId: `psn:${proposal.id as string}`,
    proposalId: proposal.id as string,
    status: snapshotStatus(proposal, segment.revision),
    segmentId: segment.id as string,
    assetId: segment.assetId as string,
    source: segment.source,
    currentTarget: segment.target,
    proposedTarget: proposal.proposedTarget,
    currentRevision: segment.revision,
    baseRevision: proposal.baseRevision,
    sourceLocale: segment.sourceLocale,
    targetLocale: segment.targetLocale,
    context: {
      ...(segment.context?.meta?.speaker !== undefined
        ? { speaker: segment.context.meta.speaker }
        : {}),
      ...(segment.context?.note !== undefined ? { notes: segment.context.note } : {}),
      previous: neighbors.previous.map(brief),
      next: neighbors.next.map(brief),
    },
    evidence: [
      {
        id: `segment:${segment.id as string}@${segment.revision}`,
        kind: 'segment-revision' as const,
      },
      ...proposal.evidenceRefs.map((id) => ({ id, kind: 'proposal-evidence' as const })),
      ...proposal.termRefs.map((id) => ({ id, kind: 'term' as const })),
    ],
    issuanceCount: issuances.length,
    issuances,
    producer,
  }
  return { ...withoutHash, snapshotHash: snapshotHash(withoutHash) }
}

export function proposalIdFromSnapshotId(snapshotId: string): string | undefined {
  if (!snapshotId.startsWith('psn:')) return undefined
  const proposalId = snapshotId.slice(4)
  try {
    return asProposalId(proposalId)
  } catch {
    return undefined
  }
}
