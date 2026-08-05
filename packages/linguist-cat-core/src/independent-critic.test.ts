import { describe, expect, test } from 'bun:test'
import {
  INDEPENDENT_CRITIC_CATEGORIES,
  createCriticReviewArtifact,
  createIndependentCriticArtifact,
  independentCriticCandidateHash,
  independentCriticProfileHash,
  parseCriticReviewArtifact,
  parseIndependentCriticArtifact,
  planIndependentCritic,
  targetedRepairScopeFromCriticArtifact,
  type IndependentCriticFindingDraft,
  type IndependentCriticRequest,
} from './index'

const CRITIC = {
  criticId: 'session:critic-1',
  executionId: 'critic-exec-1',
  profileHash: 'a'.repeat(64),
} as const

const SUBJECT = {
  segmentId: 'seg-demo-1',
  risk: 'high',
  candidateId: 'prp-demo-1',
  candidateHash: 'b'.repeat(64),
  candidateExecutionId: 'candidate-exec-1',
  candidateProducerId: 'session:producer-1',
} as const

const FINDING: IndependentCriticFindingDraft = {
  category: 'fidelity',
  severity: 'L2',
  issueType: 'omission',
  evidenceRefs: ['tm:prp-abc', 'term: 术语库 v3'],
  explanation: '译文漏译了第二句。',
}

function makeRequest(overrides: Partial<IndependentCriticRequest> = {}): IndependentCriticRequest {
  return {
    schemaVersion: 1,
    subject: { ...SUBJECT },
    critic: { ...CRITIC },
    findings: [{ ...FINDING, evidenceRefs: [...FINDING.evidenceRefs] }],
    ...overrides,
  }
}

/** 深可变克隆（create 返回的产物是冻结的，篡改测试先克隆再改）。 */
function mutableClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

describe('planIndependentCritic（仅高风险段触发）', () => {
  test('high → required（fidelity/naturalness/terminology/voice）；low/medium → not_required', () => {
    expect(planIndependentCritic({ risk: 'high' })).toEqual({
      kind: 'required',
      requiredRoles: ['fidelity', 'naturalness', 'terminology', 'voice'],
    })
    for (const risk of ['low', 'medium'] as const) {
      expect(planIndependentCritic({ risk })).toEqual({
        kind: 'not_required',
        reason: 'Independent Critic is reserved for high-risk segments.',
      })
    }
  })
})

describe('createIndependentCriticArtifact（正常路径 + 确定性 + 冻结）', () => {
  test('产物字段烧死 advisory/canCommit:false；id 内容派生且确定性', () => {
    const artifact = createIndependentCriticArtifact(makeRequest())
    expect(artifact.schemaVersion).toBe(1)
    expect(artifact.authority).toBe('advisory_finding')
    expect(artifact.canCommit).toBe(false)
    expect(artifact.artifactId).toMatch(/^critic_v2_[a-f0-9]{64}$/)
    expect(artifact.artifactHash).toMatch(/^[a-f0-9]{64}$/)
    expect(artifact.findings.length).toBe(1)
    expect(artifact.findings[0]!.findingId).toMatch(/^cf_v2_[a-f0-9]{64}$/)
    expect(artifact.findings[0]!.criticId).toBe(CRITIC.criticId)

    const again = createIndependentCriticArtifact(makeRequest())
    expect(again.artifactId).toBe(artifact.artifactId)
    expect(again.artifactHash).toBe(artifact.artifactHash)
    expect(again.findings[0]!.findingId).toBe(artifact.findings[0]!.findingId)
  })

  test('evidenceRefs 去重并排序；suggestedRepair 保留', () => {
    const artifact = createIndependentCriticArtifact(
      makeRequest({
        findings: [
          {
            category: 'terminology',
            severity: 'L1',
            issueType: 'terminology_soft',
            evidenceRefs: ['term:b', 'term:a', 'term:b'],
            explanation: '术语不一致。',
            suggestedRepair: '统一为「术语库 v3」译法。',
          },
        ],
      }),
    )
    expect(artifact.findings[0]!.evidenceRefs).toEqual(['term:a', 'term:b'])
    expect(artifact.findings[0]!.suggestedRepair).toBe('统一为「术语库 v3」译法。')
  })

  test('产物与嵌套结构深度冻结', () => {
    const artifact = createIndependentCriticArtifact(makeRequest())
    expect(Object.isFrozen(artifact)).toBe(true)
    expect(Object.isFrozen(artifact.subject)).toBe(true)
    expect(Object.isFrozen(artifact.critic)).toBe(true)
    expect(Object.isFrozen(artifact.findings)).toBe(true)
    expect(Object.isFrozen(artifact.findings[0])).toBe(true)
    expect(Object.isFrozen(artifact.findings[0]!.evidenceRefs)).toBe(true)
  })
})

describe('createIndependentCriticArtifact（拒绝路径逐字保真）', () => {
  test('请求形状不支持', () => {
    expect(() => createIndependentCriticArtifact(null as never)).toThrow('Unsupported Independent Critic request.')
    expect(() => createIndependentCriticArtifact(makeRequest({ schemaVersion: 2 as never }))).toThrow(
      'Unsupported Independent Critic request.',
    )
    expect(() => createIndependentCriticArtifact({ ...makeRequest(), findings: 'x' as never })).toThrow(
      'Unsupported Independent Critic request.',
    )
  })

  test('subject：未知字段 / 非 high risk / 非 sha256 / 空字符串', () => {
    expect(() =>
      createIndependentCriticArtifact(makeRequest({ subject: { ...SUBJECT, extra: 1 } as never })),
    ).toThrow('subject has unknown field extra.')
    expect(() => createIndependentCriticArtifact(makeRequest({ subject: { ...SUBJECT, risk: 'low' } as never }))).toThrow(
      'Independent Critic artifact is only permitted for a high-risk segment.',
    )
    expect(() =>
      createIndependentCriticArtifact(makeRequest({ subject: { ...SUBJECT, candidateHash: 'not-a-hash' } })),
    ).toThrow('subject.candidateHash must be a SHA-256 digest.')
    expect(() => createIndependentCriticArtifact(makeRequest({ subject: { ...SUBJECT, segmentId: '  ' } }))).toThrow(
      'subject.segmentId must be a non-empty string.',
    )
    expect(() => createIndependentCriticArtifact(makeRequest({ subject: 'nope' as never }))).toThrow(
      'subject must be an object.',
    )
  })

  test('critic：未知字段 / profileHash 非 sha256', () => {
    expect(() => createIndependentCriticArtifact(makeRequest({ critic: { ...CRITIC, x: 1 } as never }))).toThrow(
      'critic has unknown field x.',
    )
    expect(() => createIndependentCriticArtifact(makeRequest({ critic: { ...CRITIC, profileHash: 'zz' } }))).toThrow(
      'critic.profileHash must be a SHA-256 digest.',
    )
  })

  test('独立性断言：execution 或 actor 相同即拒', () => {
    expect(() =>
      createIndependentCriticArtifact(
        makeRequest({ critic: { ...CRITIC, executionId: SUBJECT.candidateExecutionId } }),
      ),
    ).toThrow('Independent Critic must use a different execution from the candidate producer.')
    expect(() =>
      createIndependentCriticArtifact(makeRequest({ critic: { ...CRITIC, criticId: SUBJECT.candidateProducerId } })),
    ).toThrow('Independent Critic must use a different actor from the candidate producer.')
  })

  test('findings：空数组 / 未知字段 / 非法类别 / 非法严重度 / 空证据 / 审计专用证据', () => {
    expect(() => createIndependentCriticArtifact(makeRequest({ findings: [] }))).toThrow(
      'Independent Critic requires at least one structured finding.',
    )
    expect(() =>
      createIndependentCriticArtifact(makeRequest({ findings: [{ ...FINDING, bogus: 1 } as never] })),
    ).toThrow('findings[0] has unknown field bogus.')
    expect(() =>
      createIndependentCriticArtifact(makeRequest({ findings: [{ ...FINDING, category: 'style' as never }] })),
    ).toThrow('findings[0].category is invalid.')
    expect(() =>
      createIndependentCriticArtifact(makeRequest({ findings: [{ ...FINDING, severity: 'fatal' as never }] })),
    ).toThrow('findings[0].severity is invalid.')
    expect(() =>
      createIndependentCriticArtifact(makeRequest({ findings: [{ ...FINDING, issueType: 'typo' as never }] })),
    ).toThrow('findings[0].issueType is invalid.')
    expect(() => createIndependentCriticArtifact(makeRequest({ findings: [{ ...FINDING, evidenceRefs: [] }] }))).toThrow(
      'findings[0].evidenceRefs must contain citable evidenceRefs.',
    )
    expect(() =>
      createIndependentCriticArtifact(makeRequest({ findings: [{ ...FINDING, evidenceRefs: ['tool_trace: run 1'] }] })),
    ).toThrow('findings[0].evidenceRefs must contain citable evidenceRefs, not audit-only trace.')
    expect(() =>
      createIndependentCriticArtifact(makeRequest({ findings: [{ ...FINDING, explanation: ' ' }] })),
    ).toThrow('findings[0].explanation must be a non-empty string.')
  })

  test('类别词表与 QA 严重度五档词表（PB-096）', () => {
    expect(INDEPENDENT_CRITIC_CATEGORIES).toEqual(['fidelity', 'naturalness', 'terminology', 'voice', 'consistency'])
    for (const severity of ['L0', 'L1', 'L2', 'L3', 'L4'] as const) {
      const artifact = createIndependentCriticArtifact(makeRequest({ findings: [{ ...FINDING, severity }] }))
      expect(artifact.findings[0]!.severity).toBe(severity)
    }
  })
})

describe('parseIndependentCriticArtifact（严格解析 + 完整性校验）', () => {
  test('历史 v1 artifact/finding id 仍可完整解析', () => {
    const legacy = {
      schemaVersion: 1,
      authority: 'advisory_finding',
      canCommit: false,
      artifactId: 'critic:131056e17d6ccfdfe57a84d8',
      subject: {
        segmentId: 'seg-legacy',
        risk: 'high',
        candidateId: 'prp-legacy',
        candidateHash: 'b'.repeat(64),
        candidateExecutionId: 'candidate-exec',
        candidateProducerId: 'producer',
      },
      critic: {
        criticId: 'critic',
        executionId: 'critic-exec',
        profileHash: 'a'.repeat(64),
      },
      findings: [{
        findingId: 'cf:e7fed8ca13b54b7fe03fe82d',
        criticId: 'critic',
        category: 'fidelity',
        severity: 'L2',
        issueType: 'omission',
        evidenceRefs: ['tm:legacy'],
        explanation: 'legacy',
      }],
      artifactHash: 'b1a96837561d8a9fb5797de31e4ac602a7ffc38541196984ee05724f009b2fbd',
    }

    expect(parseIndependentCriticArtifact(legacy).artifactId).toBe(legacy.artifactId)
  })

  test('round-trip：create → parse 幂等，hash/id 不变', () => {
    const artifact = createIndependentCriticArtifact(
      makeRequest({
        findings: [
          FINDING,
          { category: 'voice', severity: 'L4', issueType: 'register_tone', evidenceRefs: ['seg style guide'], explanation: '语气偏口语。' },
        ],
      }),
    )
    const parsed = parseIndependentCriticArtifact(mutableClone(artifact))
    expect(parsed.artifactId).toBe(artifact.artifactId)
    expect(parsed.artifactHash).toBe(artifact.artifactHash)
    expect(parsed.findings.map((finding) => finding.findingId)).toEqual(
      artifact.findings.map((finding) => finding.findingId),
    )
    expect(Object.isFrozen(parsed)).toBe(true)
  })

  test('拒绝：非对象 / 未知字段 / 契约字段被改', () => {
    expect(() => parseIndependentCriticArtifact('x')).toThrow('Independent Critic artifact must be an object.')
    const artifact = mutableClone(createIndependentCriticArtifact(makeRequest()))
    expect(() => parseIndependentCriticArtifact({ ...artifact, extra: 1 })).toThrow(
      'Independent Critic artifact has unknown field extra.',
    )
    expect(() => parseIndependentCriticArtifact({ ...artifact, authority: 'commit_capable' })).toThrow(
      'Independent Critic artifact contract is invalid.',
    )
    expect(() => parseIndependentCriticArtifact({ ...artifact, canCommit: true })).toThrow(
      'Independent Critic artifact contract is invalid.',
    )
  })

  test('拒绝：篡改 artifactHash / artifactId / finding 内容', () => {
    const artifact = mutableClone(createIndependentCriticArtifact(makeRequest()))
    expect(() => parseIndependentCriticArtifact({ ...artifact, artifactHash: 'c'.repeat(64) })).toThrow(
      'Independent Critic artifactHash changed.',
    )
    expect(() => parseIndependentCriticArtifact({ ...artifact, artifactId: 'critic:tampered' })).toThrow(
      'Independent Critic artifactId changed.',
    )
    const tamperedFinding = mutableClone(artifact)
    tamperedFinding.findings[0]!.explanation = '被篡改的解释。'
    // finding 内容参与 artifactId 派生，先触发 artifactId 校验
    expect(() => parseIndependentCriticArtifact(tamperedFinding)).toThrow('Independent Critic artifactId changed.')
  })

  test('拒绝：空 findings / 重复 findingId / finding criticId 与产物不一致', () => {
    const artifact = mutableClone(createIndependentCriticArtifact(makeRequest()))
    expect(() => parseIndependentCriticArtifact({ ...artifact, findings: [] })).toThrow(
      'Independent Critic findings must be non-empty and uniquely identified.',
    )

    const duplicated = mutableClone(artifact)
    duplicated.findings.push({ ...duplicated.findings[0]! })
    expect(() => parseIndependentCriticArtifact(duplicated)).toThrow(
      'Independent Critic findings must be non-empty and uniquely identified.',
    )

    const mismatched = mutableClone(artifact)
    mismatched.findings[0]!.criticId = 'session:someone-else'
    expect(() => parseIndependentCriticArtifact(mismatched)).toThrow(
      'findings[0] criticId differs from artifact critic.',
    )
  })

  test('拒绝：解析时同样强制独立性与证据可引用', () => {
    const artifact = mutableClone(createIndependentCriticArtifact(makeRequest()))
    artifact.critic.executionId = artifact.subject.candidateExecutionId
    expect(() => parseIndependentCriticArtifact(artifact)).toThrow(
      'Independent Critic must use a different execution from the candidate producer.',
    )

    const auditOnly = mutableClone(createIndependentCriticArtifact(makeRequest()))
    auditOnly.findings[0]!.evidenceRefs = ['agent_event: x']
    expect(() => parseIndependentCriticArtifact(auditOnly)).toThrow(
      'findings[0].evidenceRefs must contain citable evidenceRefs, not audit-only trace.',
    )
  })
})

describe('targetedRepairScopeFromCriticArtifact（只圈范围，不能施工）', () => {
  test('默认圈全部 finding（排序）；子集与未知 id', () => {
    const artifact = createIndependentCriticArtifact(
      makeRequest({
        findings: [
          FINDING,
          { category: 'consistency', severity: 'L4', issueType: 'consistency', evidenceRefs: ['tm:x'], explanation: '前后译法不一。' },
        ],
      }),
    )
    const all = targetedRepairScopeFromCriticArtifact(artifact)
    expect(all.authority).toBe('advisory_finding')
    expect(all.canCommit).toBe(false)
    expect(all.segmentIds).toEqual([SUBJECT.segmentId])
    expect(all.findingIds).toEqual([...artifact.findings.map((finding) => finding.findingId)].sort())
    expect(Object.isFrozen(all)).toBe(true)

    const subset = targetedRepairScopeFromCriticArtifact(artifact, { findingIds: [artifact.findings[1]!.findingId] })
    expect(subset.findingIds).toEqual([artifact.findings[1]!.findingId])

    expect(() => targetedRepairScopeFromCriticArtifact(artifact, { findingIds: ['cf:missing'] })).toThrow(
      'Requested Critic finding was not found in this artifact.',
    )
    expect(() => targetedRepairScopeFromCriticArtifact(artifact, { findingIds: [] })).toThrow(
      'Requested Critic finding was not found in this artifact.',
    )
  })
})

describe('Critic Review v2（snapshot 绑定 + 判别式 verdict）', () => {
  const reviewer = {
    ...CRITIC,
    sessionId: CRITIC.executionId,
    modelId: 'review-model',
    promptVersion: 'c'.repeat(64),
    generation: {
      sessionId: CRITIC.executionId,
      runId: 'critic-run',
      toolCallId: 'critic-call',
      modelProvider: 'anthropic',
      modelId: 'review-model',
      runtime: 'claude',
      role: 'reviewer' as const,
      strategy: 'best' as const,
      linguistPromptVersion: '2.0.0',
      promptHash: '1'.repeat(64),
      projectDigestHash: '2'.repeat(64),
      projectDigestRevision: 'project-r1',
      turnContextVersion: 1,
      turnContextSnapshot: '{"activeSegmentId":"seg-1"}',
      turnContextHash: '3'.repeat(64),
      toolsetHash: '4'.repeat(64),
    },
  }
  const snapshot = {
    snapshotId: 'psn:prp-demo-1',
    snapshotHash: 'd'.repeat(64),
    proposalId: SUBJECT.candidateId,
  }

  test('pass/issues/abstain 都可持久化表达，且 hash 篡改失败', () => {
    const pass = createCriticReviewArtifact({
      schemaVersion: 2,
      snapshot,
      subject: SUBJECT,
      reviewer,
      verdict: 'pass',
      summary: '无实质问题。',
      findings: [],
    })
    expect(parseCriticReviewArtifact(mutableClone(pass))).toEqual(pass)
    expect(pass.artifactId).toMatch(/^critic_v2_[a-f0-9]{64}$/)
    expect(pass.findings).toEqual([])
    expect(pass.reviewer.generation?.toolsetHash).toBe('4'.repeat(64))

    const issues = createCriticReviewArtifact({
      schemaVersion: 2,
      snapshot,
      subject: SUBJECT,
      reviewer,
      verdict: 'issues',
      summary: '发现漏译。',
      findings: [FINDING],
    })
    expect(issues.findings).toHaveLength(1)

    const abstain = createCriticReviewArtifact({
      schemaVersion: 2,
      snapshot,
      subject: SUBJECT,
      reviewer,
      verdict: 'abstain',
      reason: '缺少角色语气证据。',
      findings: [],
    })
    expect(abstain.reason).toBe('缺少角色语气证据。')

    const tampered = mutableClone(pass)
    tampered.snapshot.snapshotHash = 'e'.repeat(64)
    expect(() => parseCriticReviewArtifact(tampered)).toThrow('Critic Review artifactId changed.')
  })

  test('历史 v1 Critic Review artifact id 仍可完整解析', () => {
    const legacy = {
      schemaVersion: 2,
      authority: 'advisory_finding',
      canCommit: false,
      snapshot: {
        snapshotId: 'psn:prp-legacy',
        snapshotHash: 'd'.repeat(64),
        proposalId: 'prp-legacy',
      },
      subject: {
        segmentId: 'seg-legacy',
        risk: 'high',
        candidateId: 'prp-legacy',
        candidateHash: 'b'.repeat(64),
        candidateExecutionId: 'candidate-exec',
        candidateProducerId: 'producer',
      },
      reviewer: {
        criticId: 'critic',
        executionId: 'critic-exec',
        profileHash: 'a'.repeat(64),
        sessionId: 'critic-exec',
        promptVersion: 'c'.repeat(64),
      },
      verdict: 'pass',
      findings: [],
      artifactId: 'critic:71a1f749df806c82e472c1bf',
      artifactHash: '963e9b8243f4bedb6db7e7123b355f94a3c2967c5c9a819e7a33aab618c6ef38',
    }

    expect(parseCriticReviewArtifact(legacy).artifactId).toBe(legacy.artifactId)
  })
})

describe('哈希助手（提取时新增：工具运行时派生身份用）', () => {
  test('candidateHash 确定性、64-hex、任一字段变化即变', () => {
    const input = { proposalId: 'prp-1', segmentId: 'seg-1', target: '译文', revision: 3 }
    const digest = independentCriticCandidateHash(input)
    expect(digest).toMatch(/^[a-f0-9]{64}$/)
    expect(independentCriticCandidateHash(input)).toBe(digest)
    expect(independentCriticCandidateHash({ ...input, revision: 4 })).not.toBe(digest)
    expect(independentCriticCandidateHash({ ...input, target: '另一译文' })).not.toBe(digest)
  })

  test('profileHash 为输入字节的裸 sha256', () => {
    const digest = independentCriticProfileHash('linguist-critic-profile:v1')
    expect(digest).toMatch(/^[a-f0-9]{64}$/)
    expect(independentCriticProfileHash(new TextEncoder().encode('linguist-critic-profile:v1'))).toBe(digest)
    expect(independentCriticProfileHash('other-profile')).not.toBe(digest)
  })
})
