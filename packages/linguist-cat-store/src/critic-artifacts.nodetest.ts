import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createIndependentCriticArtifact,
  independentCriticCandidateHash,
  type IndependentCriticArtifact,
} from '@linguist/cat-core'
import { SCHEMA_VERSION } from './schema'
import { CatStore } from './store'
import { makeClock, makeEntropy, makeImportedAsset, makeTempDir } from './testkit'

function setup() {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy('pb-083'), now: makeClock() })
  const project = store.createProject({ name: 'P', sourceLocale: 'en', targetLocale: 'zh-CN', promaWorkspaceId: 'ws' })
  const db = store.openProject(project.id)
  const { segments } = db.assets.insertImported(makeImportedAsset({ segmentCount: 2 }))
  return { store, project, db, segments }
}

function makeArtifact(segmentId: string, explanation = '译文漏译。'): IndependentCriticArtifact {
  return createIndependentCriticArtifact({
    schemaVersion: 1,
    subject: {
      segmentId,
      risk: 'high',
      candidateId: 'prp-demo-1',
      candidateHash: independentCriticCandidateHash({
        proposalId: 'prp-demo-1',
        segmentId,
        target: '候选译文',
        revision: 0,
      }),
      candidateExecutionId: 'candidate-exec-1',
      candidateProducerId: 'session:producer-1',
    },
    critic: {
      criticId: 'session:critic-1',
      executionId: 'critic-exec-1',
      profileHash: 'a'.repeat(64),
    },
    findings: [
      { category: 'fidelity', severity: 'L2', issueType: 'omission', evidenceRefs: ['tm:demo'], explanation },
    ],
  })
}

test('schema v5: fresh open applies the v5 migration and creates critic_artifacts', () => {
  const { db } = setup()
  try {
    // 当前版本号随后续迁移滚动（PB-095 → v6）；本用例锚定 v5 迁移已应用。
    assert.equal(db.schemaVersion, SCHEMA_VERSION)
    assert.ok(db.catDb.appliedMigrations.some((migration) => migration.version === 5))
    const table = db.catDb.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'critic_artifacts'")
      .get() as { name: string } | undefined
    assert.equal(table?.name, 'critic_artifacts')
  } finally {
    db.close()
  }
})

test('round-trip: insert then getById/listBySegment returns the integrity-verified artifact', () => {
  const { db, segments } = setup()
  try {
    const artifact = makeArtifact(segments[0]!.id)
    db.criticArtifacts.insert(artifact)

    const byId = db.criticArtifacts.getById(artifact.artifactId)
    assert.ok(byId)
    assert.equal(byId.artifactId, artifact.artifactId)
    assert.equal(byId.artifactHash, artifact.artifactHash)
    assert.deepEqual(JSON.parse(JSON.stringify(byId)), JSON.parse(JSON.stringify(artifact)))

    const bySegment = db.criticArtifacts.listBySegment(segments[0]!.id)
    assert.equal(bySegment.length, 1)
    assert.equal(bySegment[0]!.artifactId, artifact.artifactId)
    assert.equal(db.criticArtifacts.getById('critic:missing'), undefined)
  } finally {
    db.close()
  }
})

test('insert is idempotent: re-inserting the same artifactId neither errors nor duplicates', () => {
  const { db, segments } = setup()
  try {
    const artifact = makeArtifact(segments[0]!.id)
    db.criticArtifacts.insert(artifact)
    assert.doesNotThrow(() => db.criticArtifacts.insert(artifact))
    assert.equal(db.criticArtifacts.listBySegment(segments[0]!.id).length, 1)
  } finally {
    db.close()
  }
})

test('listBySegment only returns artifacts of that segment, ordered by created_at', () => {
  const { db, segments } = setup()
  try {
    const first = makeArtifact(segments[0]!.id, '第一条评审。')
    const second = makeArtifact(segments[0]!.id, '第二条评审。')
    const otherSegment = makeArtifact(segments[1]!.id)
    db.criticArtifacts.insert(first)
    db.criticArtifacts.insert(second)
    db.criticArtifacts.insert(otherSegment)

    const ofFirst = db.criticArtifacts.listBySegment(segments[0]!.id)
    assert.deepEqual(
      ofFirst.map((artifact) => artifact.artifactId),
      [first.artifactId, second.artifactId],
    )
    assert.deepEqual(
      db.criticArtifacts.listBySegment(segments[1]!.id).map((artifact) => artifact.artifactId),
      [otherSegment.artifactId],
    )
  } finally {
    db.close()
  }
})
