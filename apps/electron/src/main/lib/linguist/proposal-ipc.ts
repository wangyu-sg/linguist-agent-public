/**
 * PB-053 Proposal 人工审核 IPC。写操作只在这里暴露给 renderer，
 * 不进入 Pi customTools；每次变更都携带 revision CAS 与 idempotency key。
 */

import {
  type LinguistAcceptedProposalResult,
  type LinguistIpcResult,
  type LinguistProposalAcceptSelectedResult,
  type LinguistProposalEditAndAcceptResult,
  type LinguistProposalGetDiffResult,
  type LinguistProposalInfo,
  type LinguistProposalListResult,
  type LinguistProposalReissueResult,
  type LinguistProposalListPendingResult,
  type LinguistProposalRejectResult,
  type LinguistProposalRejectSelectedResult,
  LINGUIST_PROPOSAL_ID_PATTERN,
} from '@proma/shared'
import {
  StoreNotFoundError,
  type IdempotentProposalMutation,
  type ProposalMutationItem,
} from '@linguist/cat-store'
import type {
  AcceptProposalResult,
  ProposalStatus,
  TranslationProposal,
} from '@linguist/cat-core'
import { assertRecord, invalid, readProjectId, wrap } from './ipc-envelope'
import type { LinguistProjectService } from './project-service'
import {
  createLinguistProjectMutationEvent,
  type LinguistProjectMutationSink,
} from './session-cat-tools'

const IDEMPOTENCY_KEY_MAX_LENGTH = 128
const MAX_SELECTED = 50
const MAX_LIST = 200
const PROPOSAL_STATUSES: readonly ProposalStatus[] = [
  'pending',
  'accepted',
  'rejected',
  'superseded',
  'expired',
]

export interface LinguistProposalIpcDeps {
  getService: () => LinguistProjectService
  onProjectMutation?: LinguistProjectMutationSink
}

function readProposalId(record: Record<string, unknown>): string {
  const value = record.proposalId
  if (typeof value !== 'string' || !LINGUIST_PROPOSAL_ID_PATTERN.test(value)) {
    invalid('proposalId must be a valid Stable ID')
  }
  return value
}

function readExpectedRevision(record: Record<string, unknown>): number {
  const value = record.expectedRevision
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    invalid('expectedRevision must be a non-negative safe integer')
  }
  return value as number
}

function readIdempotencyKey(record: Record<string, unknown>): string {
  const value = record.idempotencyKey
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > IDEMPOTENCY_KEY_MAX_LENGTH
  ) {
    invalid(`idempotencyKey must be a non-blank string of at most ${IDEMPOTENCY_KEY_MAX_LENGTH} characters`)
  }
  return value
}

function readItem(input: unknown): ProposalMutationItem {
  const record = assertRecord(input)
  return {
    proposalId: readProposalId(record),
    expectedRevision: readExpectedRevision(record),
  }
}

function readItems(record: Record<string, unknown>): ProposalMutationItem[] {
  const value = record.items
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SELECTED) {
    invalid(`items must contain 1-${MAX_SELECTED} proposal mutations`)
  }
  const items = value.map(readItem)
  if (new Set(items.map((item) => item.proposalId)).size !== items.length) {
    invalid('items must not contain duplicate proposalId values')
  }
  return items
}

function readListFilter(record: Record<string, unknown>): {
  status?: ProposalStatus
  limit: number
  offset: number
} {
  const status = record.status
  if (status !== undefined && !PROPOSAL_STATUSES.includes(status as ProposalStatus)) {
    invalid(`status must be one of ${PROPOSAL_STATUSES.join('/')}`)
  }
  const limit = record.limit ?? 100
  const offset = record.offset ?? 0
  if (!Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > MAX_LIST) {
    invalid(`limit must be an integer from 1 to ${MAX_LIST}`)
  }
  if (!Number.isSafeInteger(offset) || (offset as number) < 0) {
    invalid('offset must be a non-negative safe integer')
  }
  return {
    ...(status !== undefined ? { status: status as ProposalStatus } : {}),
    limit: limit as number,
    offset: offset as number,
  }
}

function unwrap<T>(result: IdempotentProposalMutation<T>): {
  value: T
  replayed: boolean
} {
  if (!result.ok) invalid('idempotencyKey was already used for another request')
  return { value: result.result, replayed: result.replayed }
}

function accepted(result: AcceptProposalResult): LinguistAcceptedProposalResult {
  return {
    proposal: result.proposal,
    segmentId: result.segment.id,
    target: result.segment.target,
    revision: result.segment.revision,
  }
}

function proposalInfo(proposal: TranslationProposal): LinguistProposalInfo {
  return proposal
}

function notifyReviewed(
  deps: LinguistProposalIpcDeps,
  projectId: string,
  proposals: readonly Pick<TranslationProposal, 'id' | 'segmentId'>[],
): void {
  if (deps.onProjectMutation === undefined) return
  const event = createLinguistProjectMutationEvent(projectId, {
    kind: 'proposal-reviewed',
    proposalIds: proposals.map((proposal) => proposal.id),
    segmentIds: proposals.map((proposal) => proposal.segmentId),
  })
  try {
    deps.onProjectMutation(event)
  } catch (error) {
    // 数据库 mutation 已提交；通知失败不能把成功响应伪装成写失败。
    console.error('[Linguist Proposal] 广播审核 mutation 失败:', error)
  }
}

function notifyCreated(
  deps: LinguistProposalIpcDeps,
  projectId: string,
  proposals: readonly Pick<TranslationProposal, 'id' | 'segmentId'>[],
): void {
  if (deps.onProjectMutation === undefined) return
  const event = createLinguistProjectMutationEvent(projectId, {
    kind: 'proposal-created',
    proposalIds: proposals.map((proposal) => proposal.id),
    segmentIds: proposals.map((proposal) => proposal.segmentId),
  })
  try {
    deps.onProjectMutation(event)
  } catch (error) {
    console.error('[Linguist Proposal] 广播重发 mutation 失败:', error)
  }
}

export function createLinguistProposalIpc(deps: LinguistProposalIpcDeps) {
  const open = (record: Record<string, unknown>) =>
    deps.getService().openProject(readProjectId(record))

  return {
    list(input: unknown): Promise<LinguistIpcResult<LinguistProposalListResult>> {
      return wrap(() => {
        const record = assertRecord(input)
        const db = open(record)
        const filter = readListFilter(record)
        const items = db.proposals.listWithDiffs(filter)
        const total = db.proposals.count(filter.status)
        return {
          items,
          total,
          limit: filter.limit,
          offset: filter.offset,
          hasMore: filter.offset + items.length < total,
        }
      })
    },

    listPending(input: unknown): Promise<LinguistIpcResult<LinguistProposalListPendingResult>> {
      return wrap(() => open(assertRecord(input)).proposals.listPending().map(proposalInfo))
    },

    getDiff(input: unknown): Promise<LinguistIpcResult<LinguistProposalGetDiffResult>> {
      return wrap(() => {
        const record = assertRecord(input)
        const db = open(record)
        const proposal = db.proposals.getById(readProposalId(record))
        if (!proposal) throw new StoreNotFoundError('proposal', String(record.proposalId))
        const segment = db.segments.getById(proposal.segmentId)
        if (!segment) throw new StoreNotFoundError('segment', proposal.segmentId)
        const issuances = db.proposals.listIssuances(proposal.id)
        return {
          proposal: proposalInfo(proposal),
          originalOrdinal: segment.ordinal + 1,
          source: segment.source,
          currentTarget: segment.target,
          proposedTarget: proposal.proposedTarget,
          currentRevision: segment.revision,
          baseRevision: proposal.baseRevision,
          locked: segment.locked,
          issuanceCount: issuances.length,
          ...(issuances.at(-1) === undefined ? {} : { latestIssuance: issuances.at(-1)! }),
        }
      })
    },

    accept(input: unknown): Promise<LinguistIpcResult<LinguistAcceptedProposalResult>> {
      return wrap(() => {
        const record = assertRecord(input)
        const projectId = readProjectId(record)
        const project = deps.getService().getProject(projectId)
        const result = open(record).proposals.acceptSelected(
          [readItem(record)],
          readIdempotencyKey(record),
          project.tagProfile === undefined ? {} : { tagProfile: project.tagProfile },
        )
        const mutation = unwrap(result)
        const value = mutation.value[0]!
        if (!mutation.replayed) notifyReviewed(deps, projectId, [value.proposal])
        return accepted(value)
      })
    },

    reject(input: unknown): Promise<LinguistIpcResult<LinguistProposalRejectResult>> {
      return wrap(() => {
        const record = assertRecord(input)
        const result = open(record).proposals.rejectSelected(
          [readItem(record)],
          readIdempotencyKey(record),
        )
        const mutation = unwrap(result)
        const value = mutation.value[0]!
        if (!mutation.replayed) notifyReviewed(deps, readProjectId(record), [value])
        return proposalInfo(value)
      })
    },

    editAndAccept(input: unknown): Promise<LinguistIpcResult<LinguistProposalEditAndAcceptResult>> {
      return wrap(() => {
        const record = assertRecord(input)
        const editedTarget = record.editedTarget
        if (typeof editedTarget !== 'string' || editedTarget.trim().length === 0) {
          invalid('editedTarget must be a non-blank string')
        }
        // PB-097：人工编辑后的目标过同一道 tag 族硬门，项目族从 project.json 解析。
        const projectId = readProjectId(record)
        const project = deps.getService().getProject(projectId)
        const mutation = unwrap(open(record).proposals.editAndAccept({
          ...readItem(record),
          editedTarget,
          idempotencyKey: readIdempotencyKey(record),
          ...(project.tagProfile !== undefined ? { tagProfile: project.tagProfile } : {}),
        }))
        const value = mutation.value
        if (!mutation.replayed) notifyReviewed(deps, projectId, [value.proposal])
        return accepted(value)
      })
    },

    acceptSelected(input: unknown): Promise<LinguistIpcResult<LinguistProposalAcceptSelectedResult>> {
      return wrap(() => {
        const record = assertRecord(input)
        const projectId = readProjectId(record)
        const project = deps.getService().getProject(projectId)
        const mutation = unwrap(
          open(record).proposals.acceptSelected(
            readItems(record),
            readIdempotencyKey(record),
            project.tagProfile === undefined ? {} : { tagProfile: project.tagProfile },
          ),
        )
        const values = mutation.value
        if (!mutation.replayed) {
          notifyReviewed(deps, projectId, values.map((value) => value.proposal))
        }
        return values.map(accepted)
      })
    },

    rejectSelected(input: unknown): Promise<LinguistIpcResult<LinguistProposalRejectSelectedResult>> {
      return wrap(() => {
        const record = assertRecord(input)
        const mutation = unwrap(
          open(record).proposals.rejectSelected(readItems(record), readIdempotencyKey(record)),
        )
        const values = mutation.value
        if (!mutation.replayed) notifyReviewed(deps, readProjectId(record), values)
        return values.map(proposalInfo)
      })
    },

    reissue(input: unknown): Promise<LinguistIpcResult<LinguistProposalReissueResult>> {
      return wrap(() => {
        const record = assertRecord(input)
        const projectId = readProjectId(record)
        const idempotencyKey = readIdempotencyKey(record)
        const project = deps.getService().getProject(projectId)
        const mutation = unwrap(open(record).proposals.reissueTerminal({
          ...readItem(record),
          idempotencyKey,
          runId: `human-reconcile:${idempotencyKey}`,
          ...(project.tagProfile !== undefined ? { tagProfile: project.tagProfile } : {}),
        }))
        if (!mutation.replayed) notifyCreated(deps, projectId, [mutation.value])
        return proposalInfo(mutation.value)
      })
    },
  }
}
