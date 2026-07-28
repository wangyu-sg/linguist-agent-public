import {
  buildBatchConsistencyPass,
  createIndependentCriticArtifact,
  createProposal,
  DETERMINISTIC_HARD_RULE_CODES,
  independentCriticCandidateHash,
  independentCriticProfileHash,
  normalizeQaProfile,
  openQaFinding,
  QA_FINDING_SEVERITIES,
  QA_ISSUE_TYPES,
  runDeterministicHardRules,
  runQa,
  targetedRepairProposalInputs,
  targetedRepairScopeFromCriticArtifact,
  type CreateProposalInput,
  type OpenQaFindingInput,
  type QaFinding,
  type Segment,
  type SegmentId,
} from '@linguist/cat-core'
import { StoreNotFoundError } from '@linguist/cat-store'
import { Type } from 'typebox'
import { LinguistCatInvalidArgumentError } from './errors'
import {
  type CatBatchConsistencyGroupItem,
  type CatProposeTranslationsResult,
  type CatRunBatchConsistencyResult,
  type CatSubmitCriticReviewResult,
} from './types'
import {
  defineTool,
  toolResult,
  type CatToolRuntime,
} from './tool-runtime'

const CRITIC_PROFILE_FALLBACK = 'linguist-critic-profile:v1'
const EMPTY_CONSISTENCY_NOTE =
  'No open consistency findings: the tracked consistency rules (repeated sources, terminology, punctuation, critic consistency/voice/terminology) found nothing to repair.'

/** 提案、独立 Critic 与批次一致性修复建议。 */
export function createProposalTools(runtime: CatToolRuntime) {
  const {
    deps,
    notifyMutation,
    proposalRunId,
    resolveBoundProject,
  } = runtime

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
        const segment = db.segments.getById(input.segmentId)
        const violation = segment === undefined
          ? undefined
          : runDeterministicHardRules({
              segment,
              proposedTarget: input.proposedTarget,
              ...(project.tagProfile !== undefined ? { tagProfile: project.tagProfile } : {}),
            }).violations.find(
              (candidate) => candidate.code !== DETERMINISTIC_HARD_RULE_CODES.LOCKED_SEGMENT,
            )
        if (violation !== undefined) {
          throw new LinguistCatInvalidArgumentError(
            'proposedTarget',
            `${violation.code} for segment ${input.segmentId}`,
          )
        }
      }
      const runId = proposalRunId(toolCallId)
      const proposalInputs = params.segmentProposals.map((input) => ({
        segmentId: input.segmentId as SegmentId,
        baseRevision: input.baseRevision,
        proposedTarget: input.proposedTarget,
        ...(input.evidenceRefs !== undefined ? { evidenceRefs: input.evidenceRefs } : {}),
        ...(input.termRefs !== undefined ? { termRefs: input.termRefs } : {}),
        ...(input.warnings !== undefined ? { warnings: input.warnings } : {}),
        ...(deps.modelId !== undefined ? { modelId: deps.modelId } : {}),
        ...(deps.sessionId !== undefined ? { sessionId: deps.sessionId } : {}),
        runId,
        ...(deps.now !== undefined ? { now: deps.now() } : {}),
      }))
      const existingProposalIds = new Set(
        proposalInputs
          .map((input) => createProposal(input).id as string)
          .filter((id) => db.proposals.getById(id)?.status === 'pending'),
      )
      const proposals = db.proposals.insertPendingMany(proposalInputs)
      const createdProposals = proposals.filter(
        (proposal) => !existingProposalIds.has(proposal.id as string),
      )
      const dto: CatProposeTranslationsResult = {
        runId,
        proposalIds: proposals.map((proposal) => proposal.id as string),
      }
      if (createdProposals.length > 0) {
        notifyMutation({
          kind: 'proposal-created',
          segmentIds: [...new Set(createdProposals.map((proposal) => proposal.segmentId as string))],
          proposalIds: createdProposals.map((proposal) => proposal.id as string),
        })
      }
      return toolResult(
        dto,
        deps.resultProjectId,
        proposals.map((proposal) => proposal.segmentId as string),
      )
    },
  })


  const submitCriticReviewTool = defineTool({
    name: 'cat_submit_critic_review',
    label: 'CAT submit critic review',
    description:
      'Submit an independent critic review of one candidate proposal for a high-risk segment of the bound project ' +
      '(Best-tier review only; every segment reviewed here is treated as risk: high). The candidate proposal must ' +
      'exist in the bound project and belong to the given segmentId. This tool only records advisory review findings ' +
      'and the critic artifact; it never changes Segment targets or revisions, never resolves/waives findings, never ' +
      'exports. Repairs go through cat_propose_translations as ordinary proposals (human review). Reviewing a ' +
      'proposal produced by this same session is rejected by the independence gate: critic and candidate producer ' +
      'must be different executions and different actors.',
    promptSnippet: 'Record an advisory independent review of a candidate proposal',
    promptGuidelines: [
      'Every finding needs citable evidence (segment ids, TM/TB entries, project documents); tool traces and agent events are audit data, not evidence.',
      'Never claim a review fixes anything: repairs are ordinary proposals via cat_propose_translations and need human acceptance.',
    ],
    parameters: Type.Object({
      segmentId: Type.String({
        minLength: 1,
        description: 'Segment id from cat_get_segments; must match the segment of the candidate proposal.',
      }),
      candidateProposalId: Type.String({
        minLength: 1,
        description: 'Proposal id under review (returned by cat_propose_translations).',
      }),
      findings: Type.Array(
        Type.Object({
          category: Type.Union([
            Type.Literal('fidelity'),
            Type.Literal('naturalness'),
            Type.Literal('terminology'),
            Type.Literal('voice'),
            Type.Literal('consistency'),
          ]),
          // PB-096：severity 五档 L0–L4；issueType 为契约 29 枚举（critic 直接产出缺陷分类）
          severity: Type.Union(QA_FINDING_SEVERITIES.map((severity) => Type.Literal(severity))),
          issueType: Type.Union(QA_ISSUE_TYPES.map((issueType) => Type.Literal(issueType))),
          evidenceRefs: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
          explanation: Type.String({ minLength: 1 }),
          suggestedRepair: Type.Optional(Type.String({ minLength: 1 })),
        }),
        { minItems: 1, maxItems: 20 },
      ),
    }),
    async execute(toolCallId, params) {
      if (params.findings.length < 1 || params.findings.length > 20) {
        throw new LinguistCatInvalidArgumentError('findings', 'expected 1-20 items')
      }
      const { db } = resolveBoundProject('cat_submit_critic_review', toolCallId)
      if (deps.sessionId === undefined) {
        throw new LinguistCatInvalidArgumentError(
          'sessionId',
          'critic identity is derived from the session binding, which is missing',
        )
      }
      const proposal = db.proposals.getById(params.candidateProposalId)
      if (proposal === undefined) throw new StoreNotFoundError('proposal', params.candidateProposalId)
      if ((proposal.segmentId as string) !== params.segmentId) {
        throw new LinguistCatInvalidArgumentError(
          'candidateProposalId',
          `proposal ${params.candidateProposalId} belongs to segment ${proposal.segmentId as string}, not ${params.segmentId}`,
        )
      }
      // Identity and hashes are runtime-derived (see module header); the
      // model supplies only segmentId/candidateProposalId/findings. A
      // same-session proposal makes candidate execution/producer equal the
      // critic's, so the contract's independence assertion throws — that is
      // the deliberate gate, not a bug.
      const artifact = createIndependentCriticArtifact({
        schemaVersion: 1,
        subject: {
          segmentId: params.segmentId,
          risk: 'high',
          candidateId: proposal.id as string,
          candidateHash: independentCriticCandidateHash({
            proposalId: proposal.id as string,
            segmentId: proposal.segmentId as string,
            target: proposal.proposedTarget,
            revision: proposal.baseRevision,
          }),
          candidateExecutionId: proposal.sessionId ?? `proposal:${proposal.id as string}`,
          candidateProducerId:
            proposal.sessionId !== undefined ? `session:${proposal.sessionId}` : `proposal:${proposal.id as string}`,
        },
        critic: {
          criticId: `session:${deps.sessionId}`,
          executionId: deps.sessionId,
          profileHash: independentCriticProfileHash(deps.criticSkillBytes?.() ?? CRITIC_PROFILE_FALLBACK),
        },
        findings: params.findings,
      })
      const qaInputs: OpenQaFindingInput[] = artifact.findings.map((finding) => ({
        segmentId: params.segmentId as SegmentId,
        code: `CRITIC_${finding.category.toUpperCase()}`,
        severity: finding.severity,
        // critic 直接产出缺陷分类；评审意见一律 needs_review（非确定性判定）
        issueType: finding.issueType,
        disposition: 'needs_review',
        message: finding.explanation,
      }))
      const segment = db.segments.getById(params.segmentId)
      if (segment === undefined) throw new StoreNotFoundError('segment', params.segmentId)
      const existingQaFindings = qaInputs.map((input) =>
        db.qaFindings.getById(openQaFinding(input).id),
      )
      const alreadyPersisted =
        db.criticArtifacts.getById(artifact.artifactId) !== undefined &&
        existingQaFindings.every(
          (finding) =>
            finding !== undefined &&
            finding.status === 'open' &&
            finding.segmentRevision === segment.revision,
        )
      // One transaction: artifact row + one QA finding row per review finding.
      const qaFindings = alreadyPersisted
        ? existingQaFindings.map((finding) => finding!)
        : db.catDb.transaction(`submit critic review ${artifact.artifactId}`, () => {
            db.criticArtifacts.insert(artifact)
            return db.qaFindings.insertOpen(qaInputs)
          })
      const repairScope = targetedRepairScopeFromCriticArtifact(artifact)
      const dto: CatSubmitCriticReviewResult = {
        artifactId: artifact.artifactId,
        findingIds: artifact.findings.map((finding) => finding.findingId),
        qaFindingIds: qaFindings.map((finding) => finding.id as string),
        repairScope,
      }
      if (!alreadyPersisted) {
        notifyMutation({
          kind: 'project-updated',
          segmentIds: [params.segmentId],
          proposalIds: [params.candidateProposalId],
          qaFindingIds: dto.qaFindingIds,
        })
      }
      return toolResult(dto, deps.resultProjectId, dto.repairScope.segmentIds)
    },
  })

  const runBatchConsistencyTool = defineTool({
    name: 'cat_run_batch_consistency',
    label: 'CAT run batch consistency',
    description:
      'Check translation consistency across the bound CAT project — repeated sources with divergent targets, ' +
      'required/forbidden terminology, repeated punctuation, and critic consistency/voice/terminology findings — ' +
      'grouped by source text with a majority-target repair suggestion per group. ' +
      "mode 'check-only' (default) only reports: it reruns the deterministic QA checks in memory, merges " +
      'persisted open findings, and writes nothing. ' +
      "mode 'repair' additionally creates pending translation proposals through the same review path as " +
      'cat_propose_translations, aligning only the affected segments with the group suggestion. It never ' +
      'changes Segment rows: every repair stays pending until a human accepts it. Locked segments are never ' +
      'repaired (their targets still count as vote candidates), segments already matching the suggestion are ' +
      'skipped, and proposal ids are content-derived, so re-running repair is idempotent.',
    promptSnippet: 'Check or repair batch consistency via reviewable proposals',
    promptGuidelines: [
      'check-only writes nothing; repair creates pending proposals only — never claim segments were repaired.',
      'Repairs cover only segments with open consistency findings; for anything else use cat_propose_translations with your own target.',
    ],
    parameters: Type.Object({
      mode: Type.Optional(
        Type.Union([Type.Literal('check-only'), Type.Literal('repair')], {
          description: "check-only (default) reports only; repair also creates pending proposals.",
        }),
      ),
    }),
    async execute(toolCallId, params) {
      const mode = params.mode ?? 'check-only'
      const { project, db } = resolveBoundProject('cat_run_batch_consistency', toolCallId)
      const total = db.segments.count()
      const segments = total === 0 ? [] : db.segments.query({ limit: total })
      // check-only 绝不写库：确定性 QA 用与 cat_run_qa 相同的 runQa 引擎在内存
      // 重算，与库中 open findings（含 PB-083 的 CRITIC_ 码）按内容派生 id 合并
      // 去重。刻意不走 store 的 runProjectQa，因为 check-only 按定义不能有任何写。
      const merged = new Map<string, QaFinding>()
      for (const input of runQa(segments, {
        profile: normalizeQaProfile(project.qaProfile),
        ...(project.tagProfile !== undefined ? { tagProfile: project.tagProfile } : {}),
      })) {
        const finding = openQaFinding(input)
        merged.set(finding.id as string, finding)
      }
      for (const finding of db.qaFindings.list({ status: 'open' })) {
        if (!merged.has(finding.id as string)) merged.set(finding.id as string, finding)
      }
      const pass = buildBatchConsistencyPass({ findings: [...merged.values()], segments })
      const groups: CatBatchConsistencyGroupItem[] = pass.groups.map((group) => ({
        source: group.source,
        segmentIds: group.segmentIds.map((id) => id as string),
        findingIds: group.findingIds.map((id) => id as string),
        ...(group.suggestedTarget !== undefined ? { suggestedTarget: group.suggestedTarget } : {}),
        findings: group.findings.map((finding) => ({
          findingId: finding.findingId as string,
          segmentId: finding.segmentId as string,
          code: finding.code,
          severity: finding.severity,
          message: finding.message,
          locked: finding.locked,
        })),
      }))
      if (mode === 'check-only') {
        const dto: CatRunBatchConsistencyResult = {
          mode,
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
      }
      // repair：只把投影给出的定点修复输入落成 pending proposals。确定性硬门
      // 与 cat_propose_translations 同一道（锁定段除外——投影已排除锁定段）；
      // 单段违规不掀翻整批，记入 skipped。
      const segmentById = new Map<string, Segment>(segments.map((segment) => [segment.id as string, segment]))
      const violationBySegment = new Map<string, string>()
      const validInputs: CreateProposalInput[] = []
      for (const input of targetedRepairProposalInputs(pass)) {
        const segment = segmentById.get(input.segmentId as string)
        // 投影只覆盖上面读出的段，正常必然命中；防御性处理而非掀翻整批。
        if (segment === undefined) {
          violationBySegment.set(input.segmentId as string, 'segment missing from project')
          continue
        }
        const violation = runDeterministicHardRules({
          segment,
          proposedTarget: input.proposedTarget,
          ...(project.tagProfile !== undefined ? { tagProfile: project.tagProfile } : {}),
        })
          .violations.find((candidate) => candidate.code !== DETERMINISTIC_HARD_RULE_CODES.LOCKED_SEGMENT)
        if (violation !== undefined) {
          violationBySegment.set(input.segmentId as string, `hard rule ${violation.code}`)
          continue
        }
        validInputs.push(input)
      }
      const repairedIds = new Set(validInputs.map((input) => input.segmentId as string))
      const skipped: Array<{ segmentId: string; reason: string }> = []
      for (const group of pass.groups) {
        for (const segment of group.segments) {
          const segmentId = segment.segmentId as string
          if (repairedIds.has(segmentId)) continue
          const violation = violationBySegment.get(segmentId)
          skipped.push({
            segmentId,
            reason:
              violation ??
              (segment.locked
                ? 'locked segment is never repaired'
                : group.suggestedTarget === undefined
                  ? 'no suggested target: group has no non-empty target'
                  : 'already consistent with the group suggestion'),
          })
        }
      }
      const runId = proposalRunId(toolCallId)
      const proposalInputs = validInputs.map((input) => ({
        ...input,
        ...(deps.modelId !== undefined ? { modelId: deps.modelId } : {}),
        ...(deps.sessionId !== undefined ? { sessionId: deps.sessionId } : {}),
        runId,
        ...(deps.now !== undefined ? { now: deps.now() } : {}),
      }))
      const existingProposalIds = new Set(
        proposalInputs
          .map((input) => createProposal(input).id as string)
          .filter((id) => db.proposals.getById(id)?.status === 'pending'),
      )
      const proposals = db.proposals.insertPendingMany(proposalInputs)
      const createdProposals = proposals.filter(
        (proposal) => !existingProposalIds.has(proposal.id as string),
      )
      const dto: CatRunBatchConsistencyResult = {
        mode,
        findingCount: pass.findingCount,
        groupCount: groups.length,
        groups,
        proposalIds: proposals.map((proposal) => proposal.id as string),
        runId,
        skipped,
        ...(pass.findingCount === 0 ? { note: EMPTY_CONSISTENCY_NOTE } : {}),
      }
      if (createdProposals.length > 0) {
        notifyMutation({
          kind: 'proposal-created',
          segmentIds: [...new Set(createdProposals.map((proposal) => proposal.segmentId as string))],
          proposalIds: createdProposals.map((proposal) => proposal.id as string),
        })
      }
      return toolResult(
        dto,
        deps.resultProjectId,
        groups.flatMap((group) => group.segmentIds),
      )
    },
  })

return [
    proposeTranslationsTool,
    submitCriticReviewTool,
    runBatchConsistencyTool,
  ] as const
}
