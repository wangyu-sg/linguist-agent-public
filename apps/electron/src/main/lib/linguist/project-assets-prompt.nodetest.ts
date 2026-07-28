/**
 * PB-095 项目资产系统上下文注入 nodetest（node --test；真实服务 + 真实
 * 会话索引，无 mock）。注入矩阵：
 *
 * - 普通会话（无 linguistProjectId）→ 空串；
 * - 未知 id / 项目目录被删（missing）→ 空串；
 * - active / archived 项目会话 → 注入四段（archived 仍注入，发送闸门在 PB-034）；
 * - 空项目（无任何资产行）→ 空串；
 * - 预算硬顶：条数与字符双顶，截断附「…(余 N 条，经 UI 或工具查询)」；
 * - fail closed：服务解析抛错 → 空串 + warn（绝不掀翻发送链路）。
 *
 * 引导纪律同 project-skill.nodetest.ts：先设 HOME 再动态 import。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeClock, makeEntropy, makeTempDir } from './test/service-testkit'
import { LinguistProjectService } from './project-service'
import { projectPaths } from './paths'

// —— 先建 tmp HOME，再动态 import 触达 config-paths 的模块 ——
const tempHome = makeTempDir()
process.env.HOME = tempHome

const binding = await import('./session-binding')
const assets = await import('./project-assets-prompt')

const LINGUIST_ROOT = join(tempHome, '.linguist-agent', 'linguist')

let serviceSeq = 0

function makeServiceOnLinguistRoot(): LinguistProjectService {
  let workspaceSeq = 0
  const service = new LinguistProjectService({
    rootDir: LINGUIST_ROOT,
    entropy: makeEntropy(`pb-095-${++serviceSeq}`),
    now: makeClock(),
    workspaceAllocator: () => `ws-pb095-${serviceSeq}-${++workspaceSeq}`,
  })
  service.init()
  return service
}

const PROJECT_INPUT = { name: '资产项目', sourceLocale: 'en', targetLocale: 'zh-CN' } as const

/** 建项目 + 绑定会话 + 向库内播种六类资产行。 */
function setupSeeded(options: { styleGuideRules?: number } = {}) {
  const service = makeServiceOnLinguistRoot()
  const project = service.createProject({ ...PROJECT_INPUT, name: `资产项目 ${serviceSeq}` })
  const meta = binding.createLinguistProjectChatSession(service, { projectId: project.id })
  const db = service.openProject(project.id)
  const ruleCount = options.styleGuideRules ?? 1
  for (let index = 0; index < ruleCount; index++) {
    db.styleGuideRules.upsert({
      groupKey: '标点',
      ruleText: `规则 ${index}：中文对话不使用半角逗号`,
      goodExample: `好例 ${index}`,
      badExample: `坏例 ${index}`,
    })
  }
  db.techConstraints.upsert({ kind: 'length', scope: 'skill_desc', valueJson: '{"maxChars":40}', note: '技能描述上限' })
  db.voiceProfiles.upsert({
    speaker: '莉安',
    textType: 'dialogue',
    register: 'casual',
    toneMarkers: ['句尾上扬'],
    taboos: ['敬语'],
  })
  db.contextDocs.insert({
    kind: 'doc',
    originalFilename: '背景设定.md',
    blobRelpath: 'blobs/ctx-lore.md',
    note: '世界观 v2',
    textExtract: '# 世界观',
  })
  return { service, project, meta }
}

test('普通会话与未知 id 不注入（空串）', () => {
  const service = makeServiceOnLinguistRoot()
  try {
    assert.equal(assets.buildLinguistProjectAssetsPrompt(undefined, () => service), '')
    assert.equal(assets.buildLinguistProjectAssetsPrompt({}, () => service), '')
    assert.equal(
      assets.buildLinguistProjectAssetsPrompt({ linguistProjectId: 'prj-0000000000000000' }, () => service),
      '',
    )
  } finally {
    service.closeAll()
  }
})

test('active 项目会话注入四段；空项目注入空串', () => {
  const seeded = setupSeeded()
  try {
    const prompt = assets.buildLinguistProjectAssetsPrompt(seeded.meta, () => seeded.service)
    assert.ok(prompt.startsWith('\n\n## 项目资产'))
    assert.ok(prompt.includes('### Style Guide'))
    assert.ok(prompt.includes('【标点】规则 0：中文对话不使用半角逗号 ✅好例 0 ❌坏例 0'))
    assert.ok(prompt.includes('### 技术约束'))
    assert.ok(prompt.includes('[length/skill_desc] {"maxChars":40}（技能描述上限）'))
    assert.ok(prompt.includes('### Voice Profiles'))
    assert.ok(prompt.includes('莉安（dialogue/casual）；语气=句尾上扬；禁忌=敬语'))
    assert.ok(prompt.includes('### Context 资料目录'))
    assert.ok(prompt.includes('背景设定.md（doc）'))
    assert.ok(prompt.includes('cat_read_context_doc'))
    assert.ok(prompt.includes('世界观 v2'))
    // 句式库不进上下文（经工具按需查询）。
    assert.ok(!prompt.includes('### 句式'))

    // 空项目：没有任何资产行 → 空串（不注空标题）。
    const service2 = makeServiceOnLinguistRoot()
    const empty = service2.createProject({ ...PROJECT_INPUT, name: '空资产项目' })
    const emptyMeta = binding.createLinguistProjectChatSession(service2, { projectId: empty.id })
    assert.equal(assets.buildLinguistProjectAssetsPrompt(emptyMeta, () => service2), '')
    service2.closeAll()
  } finally {
    seeded.service.closeAll()
  }
})

test('archived 仍注入；项目目录被删（missing）降级空串', () => {
  const seeded = setupSeeded()
  try {
    seeded.service.archiveProject(seeded.project.id)
    assert.equal(binding.getLinguistSessionBinding(seeded.meta, seeded.service)?.status, 'archived')
    const prompt = assets.buildLinguistProjectAssetsPrompt(seeded.meta, () => seeded.service)
    assert.ok(prompt.includes('### Style Guide'))

    rmSync(projectPaths(LINGUIST_ROOT, seeded.project.id).projectDir, { recursive: true, force: true })
    assert.equal(binding.getLinguistSessionBinding(seeded.meta, seeded.service)?.status, 'missing')
    assert.equal(assets.buildLinguistProjectAssetsPrompt(seeded.meta, () => seeded.service), '')
  } finally {
    seeded.service.closeAll()
  }
})

test('预算硬顶：Style Guide 条数顶截断并附余量 note', () => {
  const seeded = setupSeeded({ styleGuideRules: PROJECT_ASSETS_RULE_SEED })
  try {
    const prompt = assets.buildLinguistProjectAssetsPrompt(seeded.meta, () => seeded.service)
    assert.ok(prompt.includes('### Style Guide'))
    // 只注入前 100 条 + 余量 note。
    assert.ok(prompt.includes('规则 99'))
    assert.ok(!prompt.includes('规则 100：'))
    assert.ok(prompt.includes(`…(余 ${PROJECT_ASSETS_RULE_SEED - 100} 条，经 UI 或工具查询)`))
  } finally {
    seeded.service.closeAll()
  }
})

const PROJECT_ASSETS_RULE_SEED = 120

test('fail closed：服务解析抛错 → 空串 + warn，绝不抛出', () => {
  const seeded = setupSeeded()
  try {
    const warnings: unknown[] = []
    const originalWarn = console.warn
    console.warn = (...args: unknown[]) => {
      warnings.push(args)
    }
    try {
      const throwingResolver = (): LinguistProjectService => {
        throw new Error('service not initialized')
      }
      assert.equal(assets.buildLinguistProjectAssetsPrompt(seeded.meta, throwingResolver), '')
    } finally {
      console.warn = originalWarn
    }
    assert.equal(warnings.length, 1)
  } finally {
    seeded.service.closeAll()
  }
})

const BODY_SENTINEL = 'SENTINEL_SECRET_7f3a9'

function serializeWarnArgs(args: unknown[]): string {
  return args.map((arg) => String(arg)).join(' ')
}

test('PB-110 日志纪律：段读取失败的 warn 只记 name/code，绝不透传 message 里的客户正文', () => {
  // stub 服务：绑定判定走通（active），styleGuideRules.list 抛出 message
  // 同时含文件名与客户正文 sentinel 的上游错误
  const metaPath = join(makeTempDir(), 'project.json')
  writeFileSync(metaPath, '{}', 'utf8')
  const failing = new Error(`读取失败：客户正文 ${BODY_SENTINEL}（来源 client-lore.txt）`)
  const emptyRepo = { list: () => [], count: () => 0 }
  const stubService = {
    getProject: () => ({ archivedAt: undefined }),
    getProjectPaths: () => ({ projectJsonPath: metaPath }),
    openProject: () => ({
      styleGuideRules: {
        list: () => {
          throw failing
        },
        count: () => 0,
      },
      techConstraints: emptyRepo,
      voiceProfiles: emptyRepo,
      contextDocs: emptyRepo,
    }),
  } as unknown as LinguistProjectService

  const warnings: string[] = []
  const originalWarn = console.warn
  console.warn = (...args: unknown[]) => {
    warnings.push(serializeWarnArgs(args))
  }
  try {
    const prompt = assets.buildLinguistProjectAssetsPrompt(
      { linguistProjectId: 'prj-0000000000000001' },
      () => stubService,
    )
    assert.equal(prompt, '', '段读取失败仍 fail closed 为不注入')
  } finally {
    console.warn = originalWarn
  }
  assert.equal(warnings.length, 1)
  assert.ok(!warnings[0]!.includes(BODY_SENTINEL), `warn 泄漏客户正文: ${warnings[0]}`)
  assert.match(warnings[0]!, /name=Error/)

  // 外层 catch（服务解析本身抛错）同一纪律
  const outerWarnings: string[] = []
  console.warn = (...args: unknown[]) => {
    outerWarnings.push(serializeWarnArgs(args))
  }
  try {
    const throwingResolver = (): LinguistProjectService => {
      throw new Error(`初始化失败：${BODY_SENTINEL}`)
    }
    assert.equal(
      assets.buildLinguistProjectAssetsPrompt({ linguistProjectId: 'prj-0000000000000001' }, throwingResolver),
      '',
    )
  } finally {
    console.warn = originalWarn
  }
  assert.equal(outerWarnings.length, 1)
  assert.ok(!outerWarnings[0]!.includes(BODY_SENTINEL), `warn 泄漏客户正文: ${outerWarnings[0]}`)
})
