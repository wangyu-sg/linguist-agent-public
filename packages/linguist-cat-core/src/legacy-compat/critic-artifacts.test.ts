import { expect, test } from 'bun:test'
import { parseIndependentCriticArtifact } from './critic-artifacts'

const LEGACY_ARTIFACT = {
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

test('历史 Critic v1 产物可只读解析，篡改后 fail closed', () => {
  expect(parseIndependentCriticArtifact(LEGACY_ARTIFACT).artifactId).toBe(LEGACY_ARTIFACT.artifactId)
  expect(() => parseIndependentCriticArtifact({ ...LEGACY_ARTIFACT, artifactHash: '0'.repeat(64) })).toThrow(
    'Independent Critic artifactHash changed.',
  )
})
