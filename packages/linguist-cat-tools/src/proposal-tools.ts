import {
  analyzeBatchConsistency,
  createCriticReviewArtifact,
  createProposal,
  InvalidStateTransitionError,
  independentCriticCandidateHash,
  independentCriticProfileHash,
  normalizeQaProfile,
  QA_FINDING_SEVERITIES,
  QA_ISSUE_TYPES,
  selectedConsistencyProposalInputs,
  StaleProposalError,
  type LinguistProject,
  type SegmentId,
} from '@linguist/cat-core'
import {
  buildQaTermOptions,
  StoreJobStateError,
  StoreNotFoundError,
  type ProjectDatabase,
} from '@linguist/cat-store'
import type { AgentToolUpdateCallback } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { LinguistCatInvalidArgumentError } from './errors'
import {
  runConsistencyPlanWorkerJob,
  type WorkerJobProgress,
} from './job-runner'
import {
  type CatBatchConsistencyGroupItem,
  type CatConsistencyPlanResult,
  type CatCreateConsistencyProposalsResult,
  type CatProposeTranslationsResult,
  type CatSubmitCriticReviewResult,
  type LinguistConsistencyWorkerResult,
} from './types'
import {
  defineTool,
  toolResult,
  type CatToolRuntime,
} from './tool-runtime'
import {
  buildProposalReviewSnapshot,
  proposalIdFromSnapshotId,
} from './proposal-snapshot'

const CRITIC_PROFILE_FALLBACK = 'linguist-critic-profile:v1'
const EMPTY_CONSISTENCY_NOTE =
  'No open consistency findings: the tracked consistency rules (repeated sources, terminology, punctuation, critic consistency/voice/terminology) found nothing to repair.'

/** 提案、独立 Critic 与批次一致性修复建议。 */
export function createProposalTools(runtime: CatToolRuntime) {
  const {
    deps,
    notifyMutation,
    proposalProvenance,
    resolveBoundProject,
  } = runtime

  const getProposalSnapshotTool = defineTool({
    name: 'cat_get_proposal_snapshot',
    label: 'CAT get proposal snapshot',
    description:
      'Read one proposal candidate from the bound project as a fixed review snapshot with source, current target, ' +
      'proposed target, revision, context, evidence, producer provenance, and a SHA-256 snapshotHash. Read-only. ' +
      'A changed segment revision is reported as status stale.',
    promptSnippet: 'Read a fixed proposal snapshot before independent review',
    promptGuidelines: [
      'Submit reviews only against the returned snapshotId and snapshotHash.',
      'Do not review a stale snapshot; fetch a current candidate instead.',
    ],
    parameters: Type.Object({
      proposalId: Type.String({ minLength: 1 }),
    }),
    async execute(toolCallId, params) {
      const { db } = resolveBoundProject('cat_get_proposal_snapshot', toolCallId)
      const proposal = db.proposals.getById(params.proposalId)
      if (proposal === undefined) throw new StoreNotFoundError('proposal', params.proposalId)
      const snapshot = buildProposalReviewSnapshot(db, proposal)
      return toolResult(snapshot, deps.resultProjectId, [snapshot.segmentId])
    },
  })

  const proposeTranslationsTool = defineTool({
    name: 'cat_propose_translations',
    label: 'CAT propose translations',
    description:
      'Create reviewable translation proposals for segments in the bound project. This writes Proposal rows only: ' +
      'it never changes Segment targets or revisions. Submit 1-50 proposals; segment ids must come from cat_get_segments, ' +
      'baseRevision must still be current, and locked or unknown segments are rejected atomically.',
    promptSnippet: 'Propose translations for review without changing segments',
    promptGuidelines: [
      'Never claim proposals are committed: only a human can accept them.',
      'Use the exact segment id and revision returned by cat_get_segments; submit at most 50 proposals.',
    ],
    parameters: Type.Object({
      segmentProposals: Type.Array(
        Type.Object({
          segmentId: Type.String({ minLength: 1 }),
          baseRevision: Type.Integer({ minimum: 0 }),
          proposedTarget: Type.String({ minLength: 1 }),
          evidenceRefs: Type.Optional(Type.Array(Type.String())),
          termRefs: Type.Optional(Type.Array(Type.String())),
          warnings: Type.Optional(Type.Array(Type.String())),
        }),
        { minItems: 1, maxItems: 50 },
      ),
    }),
    async execute(toolCallId, params) {
      if (params.segmentProposals.length < 1 || params.segmentProposals.length > 50) {
        throw new LinguistCatInvalidArgumentError('segmentProposals', 'expected 1-50 items')
      }
      const { project, db } = resolveBoundProject('cat_propose_translations', toolCallId)
      for (const input of params.segmentProposals) {
        if (input.proposedTarget.trim() === '') {
          throw new LinguistCatInvalidArgumentError('proposedTarget', 'expected a non-empty translation')
        }
      }
      const provenance = proposalProvenance(toolCallId)
      const runId = provenance.runId
      const createdAt = deps.now?.()
      const proposalInputs = params.segmentProposals.map((input) => ({
        segmentId: input.segmentId as SegmentId,
        baseRevision: input.baseRevision,
        proposedTarget: input.proposedTarget,
        ...(input.evidenceRefs !== undefined ? { evidenceRefs: input.evidenceRefs } : {}),
        ...(input.termRefs !== undefined ? { termRefs: input.termRefs } : {}),
        ...(input.warnings !== undefined ? { warnings: input.warnings } : {}),
        ...(provenance.modelId !== undefined ? { modelId: provenance.modelId } : {}),
        ...(provenance.sessionId !== undefined ? { sessionId: provenance.sessionId } : {}),
        runId,
        ...(createdAt !== undefined ? { now: createdAt } : {}),
      }))
      const mutation = db.runs.executeMutation({
        identity: {
          runId,
          toolCallId,
          idempotencyKey: `cat_propose_translations:${runId}:${toolCallId}`,
        },
        operation: 'cat_propose_translations',
        payload: params,
        mutate: () => {
          const existingProposalIds = new Set(
            proposalInputs
              .map((input) => createProposal(input).id as string)
              .filter((id) => db.proposals.getById(id)?.status === 'pending'),
          )
          let proposals
          try {
            proposals = db.proposals.insertPendingMany(proposalInputs, {
              ...(project.tagProfile !== undefined ? { tagProfile: project.tagProfile } : {}),
              issuance: {
                ...provenance,
                idempotencyKey: `cat_propose_translations:${runId}:${toolCallId}`,
                ...(createdAt === undefined ? {} : { createdAt }),
              },
            })
          } catch (error) {
            if (
              error instanceof InvalidStateTransitionError
              && error.entity === 'proposal-hard-rules'
            ) {
              throw new LinguistCatInvalidArgumentError('proposedTarget', error.from)
            }
            throw error
          }
          const createdProposals = proposals.filter(
            (proposal) => !existingProposalIds.has(proposal.id as string),
          )
          const dto: CatProposeTranslationsResult = {
            runId,
            proposalIds: proposals.map((proposal) => proposal.id as string),
          }
          return {
            result: dto,
            changes: createdProposals.map((proposal) => ({
              entityType: 'proposal' as const,
              entityId: proposal.id as string,
              changeKind: 'created' as const,
              segmentId: proposal.segmentId as string,
              expectedRevision: proposal.baseRevision,
              after: proposal,
            })),
            ...(createdProposals.length === 0
              ? {}
              : {
                  event: {
                    kind: 'proposal-created' as const,
                    segmentIds: [...new Set(
                      createdProposals.map((proposal) => proposal.segmentId as string),
                    )],
                    proposalIds: createdProposals.map((proposal) => proposal.id as string),
                  },
                }),
          }
        },
      })
      const dto = mutation.result
      if (!mutation.replayed && mutation.event !== undefined) {
        notifyMutation({
          kind: 'proposal-created',
          sequence: mutation.event.sequence,
          segmentIds: mutation.event.segmentIds,
          proposalIds: mutation.event.proposalIds,
        })
      }
      return toolResult(
        dto,
        deps.resultProjectId,
        params.segmentProposals.map((proposal) => proposal.segmentId),
      )
    },
  })


  const submitCriticReviewTool = defineTool({
    name: 'cat_submit_critic_review',
    label: 'CAT submit critic review',
    description:
      'Submit pass, issues, or abstain for an exact proposal snapshot in the bound project. The snapshot hash and segment revision are ' +
      'revalidated before writing. Pass and abstain persist a review without inventing QA findings; issues persist ' +
      'advisory findings only. This never changes segment text, proposal status, or exports.',
    promptSnippet: 'Record an advisory independent review of a candidate proposal',
    promptGuidelines: [
      'Every finding needs citable evidence (segment ids, TM/TB entries, project documents); tool traces and agent events are audit data, not evidence.',
      'Never claim a review fixes anything: repairs are ordinary proposals via cat_propose_translations and need human acceptance.',
    ],
    parameters: Type.Union([
      Type.Object({
        snapshotId: Type.String({ minLength: 1 }),
        snapshotHash: Type.String({ pattern: '^[a-f0-9]{64}$' }),
        verdict: Type.Literal('pass'),
        summary: Type.Optional(Type.String({ minLength: 1 })),
        findings: Type.Array(Type.Never(), { maxItems: 0 }),
      }),
      Type.Object({
        snapshotId: Type.String({ minLength: 1 }),
        snapshotHash: Type.String({ pattern: '^[a-f0-9]{64}$' }),
        verdict: Type.Literal('issues'),
        summary: Type.String({ minLength: 1 }),
        findings: Type.Array(
          Type.Object({
            category: Type.Union([
              Type.Literal('fidelity'),
              Type.Literal('naturalness'),
              Type.Literal('terminology'),
              Type.Literal('voice'),
              Type.Literal('consistency'),
            ]),
            severity: Type.Union(QA_FINDING_SEVERITIES.map((severity) => Type.Literal(severity))),
            issueType: Type.Union(QA_ISSUE_TYPES.map((issueType) => Type.Literal(issueType))),
            evidenceRefs: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
            explanation: Type.String({ minLength: 1 }),
            suggestedRepair: Type.Optional(Type.String({ minLength: 1 })),
          }),
          { minItems: 1, maxItems: 20 },
        ),
      }),
      Type.Object({
        snapshotId: Type.String({ minLength: 1 }),
        snapshotHash: Type.String({ pattern: '^[a-f0-9]{64}$' }),
        verdict: Type.Literal('abstain'),
        reason: Type.String({ minLength: 1 }),
        findings: Type.Array(Type.Never(), { maxItems: 0 }),
      }),
    ]),
    async execute(toolCallId, params) {
      if (params.verdict === 'issues' && (params.findings.length < 1 || params.findings.length > 20)) {
        throw new LinguistCatInvalidArgumentError('findings', 'issues requires 1-20 items')
      }
      if (params.verdict !== 'issues' && params.findings.length > 0) {
        throw new LinguistCatInvalidArgumentError('findings', `${params.verdict} requires an empty array`)
      }
      const { db } = resolveBoundProject('cat_submit_critic_review', toolCallId)
      if (deps.sessionId === undefined) {
        throw new LinguistCatInvalidArgumentError(
          'sessionId',
          'critic identity is derived from the session binding, which is missing',
        )
      }
      const proposalId = proposalIdFromSnapshotId(params.snapshotId)
      if (proposalId === undefined) {
        throw new LinguistCatInvalidArgumentError(
          'snapshotId',
          'expected a snapshot id returned by cat_get_proposal_snapshot',
        )
      }
      const baseGeneration = proposalProvenance(toolCallId)
      const runId = deps.generationProvenance === undefined
        ? `critic-review:${deps.sessionId}:${toolCallId}`
        : baseGeneration.runId
      const generation = { ...baseGeneration, runId }
      const mutation = db.runs.executeMutation({
        identity: {
          runId,
          toolCallId,
          idempotencyKey: `cat_submit_critic_review:${deps.sessionId}:${toolCallId}`,
        },
        operation: 'cat_submit_critic_review',
        payload: params,
        mutate: () => {
          const proposal = db.proposals.getById(proposalId)
          if (proposal === undefined) throw new StoreNotFoundError('proposal', proposalId)
          const snapshot = buildProposalReviewSnapshot(db, proposal)
          if (snapshot.status === 'stale') {
            throw new StaleProposalError(
              proposal.id,
              proposal.segmentId,
              proposal.baseRevision,
              snapshot.currentRevision,
            )
          }
          if (snapshot.status !== 'pending') {
            throw new LinguistCatInvalidArgumentError(
              'snapshotId',
              `proposal is already ${snapshot.status}`,
            )
          }
          if (
            snapshot.snapshotId !== params.snapshotId ||
            snapshot.snapshotHash !== params.snapshotHash
          ) {
            throw new LinguistCatInvalidArgumentError(
              'snapshotHash',
              'snapshot is stale or does not match the current proposal snapshot',
            )
          }
          const profileHash = independentCriticProfileHash(
            deps.criticSkillBytes?.() ?? CRITIC_PROFILE_FALLBACK,
          )
          const artifact = createCriticReviewArtifact({
            schemaVersion: 2,
            snapshot: {
              snapshotId: snapshot.snapshotId,
              snapshotHash: snapshot.snapshotHash,
              proposalId,
            },
            subject: {
              segmentId: snapshot.segmentId,
              risk: 'high',
              candidateId: proposal.id as string,
              candidateHash: independentCriticCandidateHash({
                proposalId: proposal.id as string,
                segmentId: proposal.segmentId as string,
                target: proposal.proposedTarget,
                revision: proposal.baseRevision,
              }),
              candidateExecutionId:
                snapshot.producer.sessionId ?? `proposal:${proposal.id as string}`,
              candidateProducerId:
                snapshot.producer.sessionId !== undefined
                  ? `session:${snapshot.producer.sessionId}`
                  : `proposal:${proposal.id as string}`,
            },
            reviewer: {
              criticId: `session:${deps.sessionId}`,
              executionId: deps.sessionId,
              profileHash,
              sessionId: deps.sessionId,
              ...(generation.modelId === undefined ? {} : { modelId: generation.modelId }),
              promptVersion: profileHash,
              generation,
            },
            verdict: params.verdict,
            ...('summary' in params && params.summary !== undefined
              ? { summary: params.summary }
              : {}),
            ...('reason' in params ? { reason: params.reason } : {}),
            findings: params.findings,
          } as Parameters<typeof createCriticReviewArtifact>[0])
          const qaInputs = artifact.findings.map((finding) => ({
            segmentId: snapshot.segmentId as SegmentId,
            code: `CRITIC_${finding.category.toUpperCase()}`,
            severity: finding.severity,
            // Critic 只产出待复核意见，不改变 Segment 或 Proposal 状态。
            issueType: finding.issueType,
            disposition: 'needs_review' as const,
            message: finding.explanation,
            ruleVersion: 'critic-review-v2',
            evidenceHash: finding.findingId,
          }))
          const alreadyPersisted = db.criticArtifacts.getById(artifact.artifactId) !== undefined
          const beforeQa = new Map(
            db.qaFindings.list().map((finding) => [finding.id as string, finding]),
          )
          const qaFindings = alreadyPersisted
            ? db.criticArtifacts
                .qaFindingIdsByArtifact(artifact.artifactId)
                .map((findingId) => db.qaFindings.getById(findingId))
                .filter((finding) => finding !== undefined)
            : db.catDb.transaction(`submit critic review ${artifact.artifactId}`, () => {
                db.criticArtifacts.insert(artifact)
                const inserted = db.qaFindings.insertOpen(qaInputs, {
                  runId,
                  ...(deps.now === undefined ? {} : { observedAt: deps.now() }),
                })
                artifact.findings.forEach((finding, index) => {
                  db.criticArtifacts.linkFindingToQa(
                    artifact.artifactId,
                    finding.findingId,
                    inserted[index]!.id as string,
                  )
                })
                return inserted
              })
          const dto: CatSubmitCriticReviewResult = {
            reviewId: artifact.artifactId,
            artifactId: artifact.artifactId,
            verdict: artifact.verdict,
            findingIds: artifact.findings.map((finding) => finding.findingId),
            qaFindingIds: qaFindings.map((finding) => finding.id as string).sort(),
            ...(artifact.findings.length === 0
              ? {}
              : {
                  repairScope: {
                    authority: 'advisory_finding' as const,
                    canCommit: false as const,
                    segmentIds: [snapshot.segmentId],
                    findingIds: artifact.findings.map((finding) => finding.findingId).sort(),
                  },
                }),
          }
          const qaChanges = qaFindings.flatMap((finding) => {
            const previous = beforeQa.get(finding.id as string)
            if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(finding)) {
              return []
            }
            return [{
              entityType: 'qa-finding' as const,
              entityId: finding.id as string,
              changeKind: previous === undefined ? 'created' as const : 'updated' as const,
              segmentId: finding.segmentId as string,
              expectedRevision: finding.segmentRevision,
              ...(previous === undefined ? {} : { before: previous }),
              after: finding,
            }]
          })
          return {
            result: dto,
            changes: alreadyPersisted
              ? []
              : [{
                  entityType: 'critic-artifact' as const,
                  entityId: artifact.artifactId,
                  changeKind: 'created' as const,
                  segmentId: snapshot.segmentId as string,
                  expectedRevision: snapshot.baseRevision,
                  after: artifact,
                }, ...qaChanges],
            ...(alreadyPersisted
              ? {}
              : {
                  event: {
                    kind: 'project-updated' as const,
                    segmentIds: [snapshot.segmentId as string],
                    proposalIds: [proposalId],
                    qaFindingIds: dto.qaFindingIds,
                  },
                }),
          }
        },
      })
      if (!mutation.replayed && mutation.event !== undefined) {
        notifyMutation({
          kind: 'project-updated',
          sequence: mutation.event.sequence,
          segmentIds: mutation.event.segmentIds,
          proposalIds: mutation.event.proposalIds,
          qaFindingIds: mutation.event.qaFindingIds,
        })
      }
      const segmentId = db.criticArtifacts.getById(mutation.result.artifactId)?.subject.segmentId
      return toolResult(
        mutation.result,
        deps.resultProjectId,
        segmentId === undefined ? undefined : [segmentId as string],
      )
    },
  })

  const readConsistencyPlan = async (
    project: LinguistProject,
    db: ProjectDatabase,
    operation: 'plan' | 'apply',
    toolCallId: string,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<unknown>,
  ) => {
    const total = db.segments.count()
    const segments = total === 0 ? [] : db.segments.query({ limit: total })
    const request = {
      segments,
      options: {
        ...buildQaTermOptions(db),
        glossaryPolicy: project.glossaryPolicy,
        profile: normalizeQaProfile(project.qaProfile),
        ...(project.tagProfile !== undefined ? { tagProfile: project.tagProfile } : {}),
      },
      persistedFindings: db.qaFindings.list({ status: 'open' }),
    }
    const worker = deps.consistencyWorker ?? (async () => ({
      pass: analyzeBatchConsistency(request),
      workerThreadId: 0,
    }))
    let latestProgress: WorkerJobProgress | undefined
    const publish = (text: string): void => {
      onUpdate?.({
        content: [{ type: 'text', text }],
        details: latestProgress === undefined ? undefined : { jobProgress: latestProgress },
      })
    }
    const compute = (workerSignal?: AbortSignal) => worker(
      request,
      workerSignal,
      (phase) => publish(`CAT consistency worker ${phase}`),
    )
    const jobSegmentIds = segments
      .filter((segment) => !segment.locked)
      .map((segment) => segment.id as string)
    let workerResult: LinguistConsistencyWorkerResult
    if (db.readOnly || jobSegmentIds.length === 0) {
      workerResult = await compute(signal)
    } else {
      const runId =
        `consistency-${operation}:${deps.sessionId ?? 'session-unavailable'}:${toolCallId}`
      workerResult = await runConsistencyPlanWorkerJob({
        db,
        runId,
        sessionId: deps.sessionId ?? 'session-unavailable',
        segmentIds: jobSegmentIds,
        ...(deps.modelId === undefined ? {} : { modelId: deps.modelId }),
        signal,
        onProgress: (next) => {
          latestProgress = next
          publish(`CAT consistency job ${next.status}: ${next.cursor}/${next.total}`)
        },
        compute: async (_job, workerSignal) => ({ result: await compute(workerSignal) }),
        commit: (result, job) => {
          if (job.failedSegmentIds.length > 0) {
            throw new StoreJobStateError(
              job.jobId,
              'consistency snapshot changed while the worker was running',
            )
          }
          return result
        },
      })
    }
    const pass = workerResult.pass
    const groups: CatBatchConsistencyGroupItem[] = pass.groups.map((group) => ({
      groupId: group.groupId,
      source: group.source,
      normalizedSource: group.normalizedSource,
      segmentIds: group.segmentIds.map((id) => id as string),
      findingIds: group.findingIds.map((id) => id as string),
      candidateTargets: group.candidateTargets,
      dimensions: group.dimensions,
      findings: group.findings.map((finding) => ({
        findingId: finding.findingId as string,
        segmentId: finding.segmentId as string,
        code: finding.code,
        severity: finding.severity,
        message: finding.message,
        locked: finding.locked,
      })),
    }))
    return { groups, pass }
  }

  const planConsistencyRepairsTool = defineTool({
    name: 'cat_plan_consistency_repairs',
    label: 'CAT plan consistency repairs',
    description:
      'Read consistency findings in the bound CAT project and return normalized-source groups, candidate target counts, context dimensions, ' +
      'and a snapshot-bound planId. This tool is strictly read-only: candidate counts are evidence, not truth, and ' +
      'it never creates proposals or changes segments.',
    promptSnippet: 'Plan consistency repairs without writing',
    promptGuidelines: [
      'Treat candidate counts as advisory evidence, never as an automatic majority decision.',
      'Planning writes nothing; use cat_create_consistency_proposals with an explicit target and segment selection.',
    ],
    parameters: Type.Object({}),
    async execute(toolCallId, _params, signal, onUpdate) {
      const { project, db } = resolveBoundProject('cat_plan_consistency_repairs', toolCallId)
      const { groups, pass } = await readConsistencyPlan(
        project,
        db,
        'plan',
        toolCallId,
        signal,
        onUpdate,
      )
      const dto: CatConsistencyPlanResult = {
        planId: pass.planId,
        findingCount: pass.findingCount,
        groupCount: groups.length,
        groups,
        ...(pass.findingCount === 0 ? { note: EMPTY_CONSISTENCY_NOTE } : {}),
      }
      return toolResult(
        dto,
        deps.resultProjectId,
        groups.flatMap((group) => group.segmentIds),
      )
    },
  })

  const createConsistencyProposalsTool = defineTool({
    name: 'cat_create_consistency_proposals',
    label: 'CAT create consistency proposals',
    description:
      'Create pending consistency proposals in the bound CAT project from a current planId and explicit group, target, and segment selections. ' +
      'The plan is recomputed and stale plans fail closed. Locked/out-of-group segments and deterministic hard-rule ' +
      'violations reject the whole call atomically. Segment targets and revisions are never changed.',
    promptSnippet: 'Create explicitly selected consistency proposals',
    promptGuidelines: [
      'Choose every proposed target explicitly; never infer that the most frequent candidate is correct.',
      'This creates pending proposals only and never commits segment changes.',
    ],
    parameters: Type.Object({
      planId: Type.String({ minLength: 1 }),
      selections: Type.Array(Type.Object({
        groupId: Type.String({ minLength: 1 }),
        proposedTarget: Type.String({ minLength: 1 }),
        segmentIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 50 }),
      }), { minItems: 1, maxItems: 50 }),
    }),
    async execute(toolCallId, params, signal, onUpdate) {
      const selectedCount = params.selections.reduce(
        (sum, selection) => sum + selection.segmentIds.length,
        0,
      )
      if (selectedCount > 50) {
        throw new LinguistCatInvalidArgumentError('selections', 'expected at most 50 selected segments')
      }
      const { project, db } = resolveBoundProject('cat_create_consistency_proposals', toolCallId)
      const { pass } = await readConsistencyPlan(
        project,
        db,
        'apply',
        toolCallId,
        signal,
        onUpdate,
      )
      if (params.planId !== pass.planId) {
        throw new LinguistCatInvalidArgumentError('planId', 'stale consistency plan; plan again')
      }
      let selectedInputs
      try {
        selectedInputs = selectedConsistencyProposalInputs(pass, params.selections.map((selection) => ({
          ...selection,
          segmentIds: selection.segmentIds as SegmentId[],
        })))
      } catch (error) {
        throw new LinguistCatInvalidArgumentError(
          'selections',
          error instanceof Error ? error.message : 'invalid consistency selection',
        )
      }
      const provenance = proposalProvenance(toolCallId)
      const runId = provenance.runId
      const createdAt = deps.now?.()
      const proposalInputs = selectedInputs.map((input) => ({
        ...input,
        ...(provenance.modelId !== undefined ? { modelId: provenance.modelId } : {}),
        ...(provenance.sessionId !== undefined ? { sessionId: provenance.sessionId } : {}),
        runId,
        ...(createdAt !== undefined ? { now: createdAt } : {}),
      }))
      const mutation = db.runs.executeMutation({
        identity: {
          runId,
          toolCallId,
          idempotencyKey:
            `cat_create_consistency_proposals:${deps.sessionId ?? 'session-unavailable'}:${toolCallId}`,
        },
        operation: 'cat_create_consistency_proposals',
        payload: params,
        mutate: () => {
          const existingProposalIds = new Set(
            proposalInputs
              .map((input) => createProposal(input).id as string)
              .filter((id) => db.proposals.getById(id)?.status === 'pending'),
          )
          let proposals
          try {
            proposals = db.proposals.insertPendingMany(proposalInputs, {
              ...(project.tagProfile !== undefined ? { tagProfile: project.tagProfile } : {}),
              issuance: {
                ...provenance,
                idempotencyKey: `cat_create_consistency_proposals:${runId}:${toolCallId}`,
                ...(createdAt === undefined ? {} : { createdAt }),
              },
            })
          } catch (error) {
            if (
              error instanceof InvalidStateTransitionError
              && error.entity === 'proposal-hard-rules'
            ) {
              throw new LinguistCatInvalidArgumentError('selections', error.from)
            }
            throw error
          }
          const createdProposals = proposals.filter(
            (proposal) => !existingProposalIds.has(proposal.id as string),
          )
          const dto: CatCreateConsistencyProposalsResult = {
            planId: pass.planId,
            runId,
            proposalIds: proposals.map((proposal) => proposal.id as string),
          }
          return {
            result: dto,
            changes: createdProposals.map((proposal) => ({
              entityType: 'proposal' as const,
              entityId: proposal.id as string,
              changeKind: 'created' as const,
              segmentId: proposal.segmentId as string,
              expectedRevision: proposal.baseRevision,
              after: proposal,
            })),
            ...(createdProposals.length === 0
              ? {}
              : {
                  event: {
                    kind: 'proposal-created' as const,
                    segmentIds: [...new Set(
                      createdProposals.map((proposal) => proposal.segmentId as string),
                    )],
                    proposalIds: createdProposals.map((proposal) => proposal.id as string),
                  },
                }),
          }
        },
      })
      if (!mutation.replayed && mutation.event !== undefined) {
        notifyMutation({
          kind: 'proposal-created',
          sequence: mutation.event.sequence,
          segmentIds: mutation.event.segmentIds,
          proposalIds: mutation.event.proposalIds,
        })
      }
      return toolResult(
        mutation.result,
        deps.resultProjectId,
        selectedInputs.map((input) => input.segmentId as string),
      )
    },
  })

return [
    getProposalSnapshotTool,
    proposeTranslationsTool,
    submitCriticReviewTool,
    planConsistencyRepairsTool,
    createConsistencyProposalsTool,
  ] as const
}
