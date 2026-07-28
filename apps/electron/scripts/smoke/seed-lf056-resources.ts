#!/usr/bin/env node
/**
 * LF-056 packaged probe 的确定性资源 fixture。
 *
 * 只经 @linguist/cat-store 的公共 repository 写入测试 HOME；不参与产品运行，
 * 不解析或复制生产 SQL，也不绕过 repository 的项目隔离与事务约束。
 */

import { CatStore } from '@linguist/cat-store'

function requiredFlag(name: string): string {
  const index = process.argv.indexOf(`--${name}`)
  const value = index >= 0 ? process.argv[index + 1] : undefined
  if (value === undefined || value.trim() === '') {
    throw new Error(`缺少 --${name}`)
  }
  return value
}

const rootDir = requiredFlag('root')
const projectId = requiredFlag('project')
const segmentId = requiredFlag('segment')
const store = new CatStore({ rootDir })
const db = store.openProject(projectId)

try {
  const segment = db.segments.getById(segmentId)
  if (segment === undefined) throw new Error(`找不到片段 ${segmentId}`)

  db.tmUnits.importMany([{
    source: segment.source,
    target: '欢迎回来，{player}！',
    sourceLocale: 'en-US',
    targetLocale: 'zh-CN',
    origin: 'client',
  }])
  const tm = db.tmUnits.list({ query: segment.source }).find(
    (entry) => entry.target === '欢迎回来，{player}！',
  )
  if (tm === undefined) throw new Error('TM fixture 写入后不可读')

  db.termEntries.importMany([{
    term: 'Welcome',
    translation: '欢迎',
    status: 'preferred',
    caseSensitive: false,
    note: 'LF-056 首选术语',
  }])
  const term = db.termEntries.list({ query: 'Welcome' }).find(
    (entry) => entry.translation === '欢迎',
  )
  if (term === undefined) throw new Error('术语 fixture 写入后不可读')

  const style = db.styleGuideRules.upsert({
    groupKey: '占位符',
    ruleText: '必须保留玩家占位符',
    goodExample: '欢迎回来，{player}！',
    badExample: '欢迎回来！',
    updatedBy: 'lf056-packaged-probe',
  })
  const voice = db.voiceProfiles.upsert({
    speaker: 'System',
    register: 'friendly',
    toneMarkers: ['welcoming'],
    notes: 'LF-056 packaged probe voice',
    updatedBy: 'lf056-packaged-probe',
  })
  const proposal = db.proposals.insertPending({
    segmentId: segment.id,
    baseRevision: segment.revision,
    proposedTarget: '欢迎回来，{player}！',
    evidenceRefs: [
      `tm:${tm.id}`,
      `style:${style.id}`,
      `voice:${voice.id}`,
      'context:segment-origin',
    ],
    termRefs: [`term:${term.id}`],
    modelId: 'lf056-packaged-probe',
    now: '2026-07-28T00:00:00.000Z',
  })

  console.log(JSON.stringify({
    tmId: tm.id,
    termId: term.id,
    styleId: style.id,
    voiceId: voice.id,
    proposalId: proposal.id,
  }))
} finally {
  db.close()
}
