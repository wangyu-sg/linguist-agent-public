/**
 * LA-INTAKE-007 撤销导入的 store 层基元（node --test）：
 * - assets.deleteWithSegments：asset + segments + segment_revisions +
 *   segment_stage_events 单事务级联删除；
 * - proposals.countByAsset / legacyCriticArtifacts.countByAsset /
 *   segments.countEditedByAsset / segments.countMismatchedLocalesByAsset：
 *   撤销引用判定与导入回读验证的廉价计数。
 * bun 无 node:sqlite，本文件不被 bun test 拾取（*.nodetest.ts）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CatStore } from './store'
import { makeClock, makeEntropy, makeImportedAsset, makeTempDir } from './testkit'

/** fillEvery: 1 → 全部段 translated（可确认阶段）；导入态 revision 全 0。 */
function setup(segmentCount = 3) {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy(), now: makeClock() })
  const project = store.createProject({ name: 'P', sourceLocale: 'en', targetLocale: 'zh-CN', promaWorkspaceId: 'ws' })
  const db = store.openProject(project.id)
  const { asset, segments } = db.assets.insertImported(
    makeImportedAsset({ segmentCount, fillEvery: 1 }),
  )
  return { store, project, db, asset, segments }
}

function insertLegacyCriticArtifact(db: ReturnType<CatStore['openProject']>, segmentId: string, suffix: string) {
  db.catDb.db.prepare(`
    INSERT INTO critic_artifacts (artifact_id, segment_id, created_at, artifact_json)
    VALUES (?, ?, ?, ?)
  `).run(`legacy-${suffix}`, segmentId, '2026-08-10T00:00:00.000Z', '{}')
}

test('deleteWithSegments: asset + segments + revisions + stage events cascade in one transaction', () => {
  const { db, asset, segments } = setup(3)
  try {
    // 制造关联行：一次人工编辑（segment_revisions）+ 一次阶段确认（segment_stage_events）
    db.segments.applyTargetEdit(segments[0]!.id, '人工译文', 0)
    db.segments.confirmCurrentStage(segments[1]!.id, 'translation', 0)
    assert.equal(db.segments.listRevisions(segments[0]!.id).length, 1)
    assert.equal(db.segments.listStageEvents(segments[1]!.id).length, 1)
    // 第二个资产及其段必须不受影响
    const other = db.assets.insertImported(
      makeImportedAsset({ segmentCount: 2, filename: 'other.tsv', sourceSha256: 'b'.repeat(64) }),
    )

    db.assets.deleteWithSegments(asset.id)

    assert.equal(db.assets.get(asset.id), undefined)
    assert.equal(db.segments.count({ assetId: asset.id }), 0)
    // 已删段的 revision/stage event 行也不得以孤儿身份残留
    const orphanRevisions = db.catDb.db
      .prepare('SELECT COUNT(*) AS n FROM segment_revisions WHERE segment_id = ?')
      .get(segments[0]!.id) as { n: number }
    const orphanEvents = db.catDb.db
      .prepare('SELECT COUNT(*) AS n FROM segment_stage_events WHERE segment_id = ?')
      .get(segments[1]!.id) as { n: number }
    assert.equal(Number(orphanRevisions.n), 0)
    assert.equal(Number(orphanEvents.n), 0)

    assert.deepEqual(db.assets.listByProject().map((a) => a.id), [other.asset.id])
    assert.equal(db.segments.count({ assetId: other.asset.id }), 2)
  } finally {
    db.close()
  }
})

test('deleteWithSegments: unknown asset id is a no-op (never throws, nothing deleted)', () => {
  const { db, asset } = setup(2)
  try {
    assert.doesNotThrow(() => db.assets.deleteWithSegments('ast-0000000000000000'))
    assert.equal(db.assets.get(asset.id)?.id, asset.id)
    assert.equal(db.segments.count({ assetId: asset.id }), 2)
  } finally {
    db.close()
  }
})

test('proposals.countByAsset: counts every status, scoped to the asset', () => {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy(), now: makeClock() })
  const project = store.createProject({ name: 'P', sourceLocale: 'en', targetLocale: 'zh-CN', promaWorkspaceId: 'ws' })
  const db = store.openProject(project.id)
  try {
    // 源文避开数字（确定性 hard rule 会比对数字签名）
    const imported = makeImportedAsset({ segmentCount: 3, fillEvery: 1 })
    imported.segments = imported.segments.map((segment, index) => ({
      ...segment,
      source: ['Alpha source', 'Beta source', 'Gamma source'][index]!,
    }))
    const { asset, segments } = db.assets.insertImported(imported)
    const p1 = db.proposals.insertPending({ segmentId: segments[0]!.id, baseRevision: 0, proposedTarget: '提案译文' })
    const p2 = db.proposals.insertPending({ segmentId: segments[1]!.id, baseRevision: 0, proposedTarget: '建议译文' })
    db.proposals.insertPending({ segmentId: segments[2]!.id, baseRevision: 0, proposedTarget: '确认译文' })
    db.proposals.reject(p2.id)
    const otherImported = makeImportedAsset({ segmentCount: 1, filename: 'other.tsv', sourceSha256: 'c'.repeat(64) })
    otherImported.segments = otherImported.segments.map((segment) => ({ ...segment, source: 'Delta source' }))
    const other = db.assets.insertImported(otherImported)
    db.proposals.insertPending({ segmentId: other.segments[0]!.id, baseRevision: 0, proposedTarget: '其他资产提案译文' })

    assert.equal(db.proposals.countByAsset(asset.id), 3)
    assert.equal(db.proposals.countByAsset(other.asset.id), 1)
    assert.equal(db.proposals.countByAsset('ast-0000000000000000'), 0)
    // reject 后仍计入（全状态）；pending-only 计数不受本方法影响
    assert.equal(db.proposals.countPendingByAsset(asset.id), 2)
    assert.ok(p1.id !== p2.id)
  } finally {
    db.close()
  }
})

test('legacyCriticArtifacts.countByAsset: joins through segments, no cross-asset leakage', () => {
  const { db, asset, segments } = setup(2)
  try {
    insertLegacyCriticArtifact(db, segments[0]!.id, '1')
    insertLegacyCriticArtifact(db, segments[1]!.id, '2')
    const other = db.assets.insertImported(
      makeImportedAsset({ segmentCount: 1, filename: 'other.tsv', sourceSha256: 'd'.repeat(64) }),
    )

    assert.equal(db.legacyCriticArtifacts.countByAsset(asset.id), 2)
    assert.equal(db.legacyCriticArtifacts.countByAsset(other.asset.id), 0)
    assert.equal(db.legacyCriticArtifacts.countByAsset('ast-0000000000000000'), 0)
  } finally {
    db.close()
  }
})

test('segments.countEditedByAsset: revision > 0 or stage events mark human edits; lock does not', () => {
  const { db, asset, segments } = setup(3)
  try {
    // 导入态：revision 全 0、无 stage events
    assert.equal(db.segments.countEditedByAsset(asset.id), 0)
    // 锁是元数据操作，不算人工编辑痕迹
    db.segments.setLocked(segments[0]!.id, true)
    assert.equal(db.segments.countEditedByAsset(asset.id), 0)

    db.segments.applyTargetEdit(segments[1]!.id, '人工译文', 0)
    assert.equal(db.segments.countEditedByAsset(asset.id), 1)

    db.segments.confirmCurrentStage(segments[2]!.id, 'translation', 0)
    assert.equal(db.segments.countEditedByAsset(asset.id), 2)

    assert.equal(db.segments.countEditedByAsset('ast-0000000000000000'), 0)
  } finally {
    db.close()
  }
})

test('segments.countMismatchedLocalesByAsset: zero after import, counts drifted rows', () => {
  const { db, asset, segments } = setup(2)
  try {
    assert.equal(db.segments.countMismatchedLocalesByAsset(asset.id, 'en', 'zh-CN'), 0)
    db.catDb.db
      .prepare('UPDATE segments SET target_locale = ? WHERE id = ?')
      .run('fr', segments[0]!.id)
    assert.equal(db.segments.countMismatchedLocalesByAsset(asset.id, 'en', 'zh-CN'), 1)
    assert.equal(db.segments.countMismatchedLocalesByAsset(asset.id, 'en', 'fr'), 1)
  } finally {
    db.close()
  }
})
