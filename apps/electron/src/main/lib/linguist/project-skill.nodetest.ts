/**
 * PB-040 常驻项目 Skill 解析 nodetest（node --test；真实服务 + 真实会话索引，无 mock）；
 * PB-082 扩展评审角色与质量策略档注入矩阵：
 *
 * - 普通会话（无 linguistProjectId）→ 不注入（硬规则：普通 Chat 不出现）；
 * - 普通项目会话 → project-assistant + 当前档 strategy-<profile>
 *   （active/archived 均注入；发送已被 PB-034 闸门阻断，保持单一解析规则）；
 * - 评审会话（linguistSessionRole === 'reviewer'）→ 只注入 project-reviewer；
 * - missing（项目目录缺失/损坏 / 未知 id）→ 不注入（降级）；
 * - 策略档读取失败 / strategy 目录缺 SKILL.md → 只注入 project-assistant（fail closed）；
 * - 服务不可解析 / assistant（评审为 reviewer）目录缺 SKILL.md → 不注入（fail closed）；
 * - 重启 resume：同一 root 重建服务后重解析结果一致（解析不落会话状态）；
 * - 默认根目录解析：打包布局（process.resourcesPath/linguist-skills）与
 *   ESM 测试上下文（无 __dirname/resourcesPath → undefined）两分支。
 *
 * 引导纪律同 session-binding.nodetest.ts：先设 HOME 再动态 import。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeClock, makeEntropy, makeTempDir } from './test/service-testkit'
import { LinguistProjectService } from './project-service'
import { projectPaths } from './paths'

// —— 先建 tmp HOME，再动态 import 触达 config-paths 的模块 ——
const tempHome = makeTempDir()
process.env.HOME = tempHome

const binding = await import('./session-binding')
const skill = await import('./project-skill')
const sessionManager = await import('../agent-session-manager')

const LINGUIST_ROOT = join(tempHome, '.linguist-agent', 'linguist')
/** 仓根内置 Skills 根目录（本文件位于 apps/electron/src/main/lib/linguist/，上溯六级到仓根）。 */
const REPO_SKILLS_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', '..', '..', '..',
  'resources', 'linguist-skills',
)
const ASSISTANT_DIR = join(REPO_SKILLS_ROOT, 'project-assistant')
const REVIEWER_DIR = join(REPO_SKILLS_ROOT, 'project-reviewer')
const AUDITOR_DIR = join(REPO_SKILLS_ROOT, 'project-auditor')

let serviceSeq = 0

function makeServiceOnLinguistRoot(): LinguistProjectService {
  let workspaceSeq = 0
  const service = new LinguistProjectService({
    rootDir: LINGUIST_ROOT,
    entropy: makeEntropy(`pb-040-${++serviceSeq}`),
    now: makeClock(),
    workspaceAllocator: () => `ws-pb040-${serviceSeq}-${++workspaceSeq}`,
  })
  service.init()
  return service
}

const PROJECT_INPUT = { name: 'Skill 项目', sourceLocale: 'en', targetLocale: 'zh-CN' } as const

/** 造一个只含指定子目录的临时 skills root（SKILL.md 最小 frontmatter）。 */
function makeSkillsRootWith(subdirs: string[]): string {
  const root = makeTempDir()
  for (const sub of subdirs) {
    const dir = join(root, sub)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'SKILL.md'), `---\nname: stub-${sub}\ndescription: stub\nversion: "1.0.0"\n---\n`, 'utf8')
  }
  return root
}

test('repo-bundled skills sanity: project roles and strategies carry the expected names', () => {
  for (const sub of ['project-assistant', 'project-reviewer', 'project-auditor', 'strategy-fast', 'strategy-balanced', 'strategy-best']) {
    assert.ok(existsSync(join(REPO_SKILLS_ROOT, sub, 'SKILL.md')), `内置 Skill 不存在: ${join(REPO_SKILLS_ROOT, sub)}`)
  }
  assert.equal(skill.LINGUIST_PROJECT_SKILL_NAME, 'linguist-project-assistant')
  assert.equal(skill.LINGUIST_REVIEWER_SKILL_NAME, 'linguist-project-reviewer')
  assert.equal(skill.LINGUIST_AUDITOR_SKILL_NAME, 'linguist-project-auditor')
  assert.deepEqual(skill.LINGUIST_STRATEGY_SKILL_NAMES, {
    fast: 'linguist-strategy-fast',
    balanced: 'linguist-strategy-balanced',
    best: 'linguist-strategy-best',
  })
})

test('LA-PROMPT-002/003/005: bundled Prompt Skills match golden hashes and fallback keeps the same version', () => {
  const service = makeServiceOnLinguistRoot()
  try {
    const project = service.createProject({ ...PROJECT_INPUT, name: 'Prompt Golden 项目' })
    const assistant = binding.createLinguistProjectChatSession(service, { projectId: project.id })
    const expectedStrategyHashes = {
      fast: '60db5be10f64462077306e7c8b27ada78bc63f600cef78fad6d7ccd2d631f3bd',
      balanced: '5e99c1792b1e3dbb43d1cd2b72ee7b60350cb27fe84290c6872c18caae3281c2',
      best: 'e2021c6726a65ea0e8bc2740ebaa98bccae9aafab2ef5f8cbce8ee5c5c514595',
    } as const

    for (const profile of ['fast', 'balanced', 'best'] as const) {
      service.setQualityProfile(project.id, profile)
      const resolved = skill.resolveLinguistPromptSkillLayers(
        assistant,
        () => service,
        REPO_SKILLS_ROOT,
      )
      assert.equal(resolved.roleLayer.version, '1.0.1')
      assert.equal(resolved.roleLayer.source, 'bundle')
      assert.equal(
        resolved.roleLayer.hash,
        'f840d82070d0f146ef9df643626b518e7af746886ee8809ed6f81249ffdcc977',
      )
      assert.equal(resolved.strategy, profile)
      assert.equal(resolved.strategyLayer?.version, '1.0.1')
      assert.equal(resolved.strategyLayer?.source, 'bundle')
      assert.equal(resolved.strategyLayer?.hash, expectedStrategyHashes[profile])
      assert.doesNotMatch(resolved.strategyLayer!.content, /逐段(?:查|调用)|每段都用/)
      for (const roleInvariant of [
        'Proposal 不等于已接受译文',
        'QA 结果由确定性工具产生',
        '不要直接修改源资产',
      ]) {
        assert.ok(!resolved.strategyLayer!.content.includes(roleInvariant))
      }
      assert.deepEqual(resolved.fallbackLayers, [])
    }

    const reviewerProject = service.createProject({ ...PROJECT_INPUT, name: 'Reviewer Golden 项目' })
    const reviewer = binding.createLinguistProjectChatSession(service, {
      projectId: reviewerProject.id,
      role: 'reviewer',
    })
    const reviewerLayer = skill.resolveLinguistPromptSkillLayers(
      reviewer,
      () => service,
      REPO_SKILLS_ROOT,
    )
    assert.equal(
      reviewerLayer.roleLayer.hash,
      '61920f7a03e00fa98287c184e670050fe921ec62236b6fef37a1712de91c8fa8',
    )
    assert.match(reviewerLayer.roleLayer.content, /verdict=pass/)
    assert.match(reviewerLayer.roleLayer.content, /verdict=issues/)
    assert.match(reviewerLayer.roleLayer.content, /verdict=abstain/)
    assert.equal(reviewerLayer.strategyLayer, undefined)

    const auditorProject = service.createProject({ ...PROJECT_INPUT, name: 'Auditor Golden 项目' })
    const auditor = binding.createLinguistProjectChatSession(service, {
      projectId: auditorProject.id,
      role: 'auditor',
    })
    const auditorLayer = skill.resolveLinguistPromptSkillLayers(
      auditor,
      () => service,
      REPO_SKILLS_ROOT,
    )
    assert.equal(
      auditorLayer.roleLayer.hash,
      '8abb4f23c7b2d42a8515ae936f8fd27ba1f66a1a9704b4e553624685c468cf2f',
    )
    assert.match(auditorLayer.roleLayer.content, /Proma 通用工具/)
    assert.doesNotMatch(auditorLayer.roleLayer.content, /绝对沙箱|无法访问任何信息/)
    assert.equal(auditorLayer.strategyLayer, undefined)

    const missingBundleRoot = makeTempDir()
    const fallback = skill.resolveLinguistPromptSkillLayers(
      assistant,
      () => service,
      missingBundleRoot,
    )
    assert.equal(fallback.roleLayer.version, '1.0.1')
    assert.equal(fallback.roleLayer.source, 'fallback')
    assert.equal(fallback.strategyLayer?.version, '1.0.1')
    assert.equal(fallback.strategyLayer?.source, 'fallback')
    assert.deepEqual(fallback.fallbackLayers, ['role', 'strategy'])
  } finally {
    service.closeAll()
  }
})

test('auditor session gets only the blind-audit skill', () => {
  const service = makeServiceOnLinguistRoot()
  const project = service.createProject({ ...PROJECT_INPUT, name: '盲审项目' })
  const meta = binding.createLinguistProjectChatSession(service, {
    projectId: project.id,
    role: 'auditor',
  })
  assert.equal(meta.linguistSessionRole, 'auditor')
  assert.deepEqual(
    skill.resolveLinguistSessionSkillPaths(meta, () => service, REPO_SKILLS_ROOT),
    [AUDITOR_DIR],
  )
  service.closeAll()
})

test('normal chat never gets linguist skills; active project chat gets assistant + default (balanced) strategy', () => {
  const service = makeServiceOnLinguistRoot()
  const project = service.createProject({ ...PROJECT_INPUT })

  // 普通会话（侧栏新建路径 createAgentSession，绝不携带绑定）：不注入
  assert.equal(skill.resolveLinguistSessionSkillPaths(undefined, () => service, REPO_SKILLS_ROOT).length, 0)
  const normal = sessionManager.createAgentSession('普通对话', undefined, undefined, undefined, 'pi')
  assert.equal(normal.linguistProjectId, undefined)
  assert.deepEqual(skill.resolveLinguistSessionSkillPaths(normal, () => service, REPO_SKILLS_ROOT), [])

  // 项目对话（active，缺省 balanced 档）：注入常驻 + 策略目录，assistant 在前
  const meta = binding.createLinguistProjectChatSession(service, { projectId: project.id })
  const resolved = skill.resolveLinguistSessionSkillPaths(meta, () => service, REPO_SKILLS_ROOT)
  assert.deepEqual(resolved, [ASSISTANT_DIR, join(REPO_SKILLS_ROOT, 'strategy-balanced')])
  for (const dir of resolved) assert.ok(existsSync(join(dir, 'SKILL.md')))

  service.closeAll()
})

test('strategy skill follows the project quality profile (fast/best/balanced)', () => {
  const service = makeServiceOnLinguistRoot()
  const project = service.createProject({ ...PROJECT_INPUT, name: '策略档项目' })
  const meta = binding.createLinguistProjectChatSession(service, { projectId: project.id })

  service.setQualityProfile(project.id, 'fast')
  assert.deepEqual(skill.resolveLinguistSessionSkillPaths(meta, () => service, REPO_SKILLS_ROOT), [
    ASSISTANT_DIR,
    join(REPO_SKILLS_ROOT, 'strategy-fast'),
  ])

  service.setQualityProfile(project.id, 'best')
  assert.deepEqual(skill.resolveLinguistSessionSkillPaths(meta, () => service, REPO_SKILLS_ROOT), [
    ASSISTANT_DIR,
    join(REPO_SKILLS_ROOT, 'strategy-best'),
  ])

  service.setQualityProfile(project.id, 'balanced')
  assert.deepEqual(skill.resolveLinguistSessionSkillPaths(meta, () => service, REPO_SKILLS_ROOT), [
    ASSISTANT_DIR,
    join(REPO_SKILLS_ROOT, 'strategy-balanced'),
  ])

  service.closeAll()
})

test('reviewer session gets only the project-reviewer skill (active and archived alike)', () => {
  const service = makeServiceOnLinguistRoot()
  const project = service.createProject({ ...PROJECT_INPUT, name: '评审项目' })
  const meta = binding.createLinguistProjectChatSession(service, { projectId: project.id, role: 'reviewer' })
  assert.equal(meta.linguistSessionRole, 'reviewer')

  // active：只注入 project-reviewer（不注入 assistant / strategy——角色边界清晰）
  assert.deepEqual(skill.resolveLinguistSessionSkillPaths(meta, () => service, REPO_SKILLS_ROOT), [REVIEWER_DIR])

  // 归档：仍注入（发送已被 PB-034 闸门阻断，注入与否不影响只读语义）
  service.archiveProject(project.id)
  assert.equal(binding.getLinguistSessionBinding(meta, service)?.status, 'archived')
  assert.deepEqual(skill.resolveLinguistSessionSkillPaths(meta, () => service, REPO_SKILLS_ROOT), [REVIEWER_DIR])

  // 评审 Skill 目录缺失 → 不注入（fail closed）
  const assistantOnlyRoot = makeSkillsRootWith(['project-assistant'])
  assert.deepEqual(skill.resolveLinguistSessionSkillPaths(meta, () => service, assistantOnlyRoot), [])

  service.closeAll()
})

test('archived binding still loads skills (documented choice); missing binding does not', () => {
  const service = makeServiceOnLinguistRoot()
  const project = service.createProject({ ...PROJECT_INPUT, name: '归档与缺失项目' })
  const meta = binding.createLinguistProjectChatSession(service, { projectId: project.id })

  // 归档：仍注入——发送已被 PB-034 主进程闸门阻断（会话只读），
  // Skill 注入与否不影响只读语义；保持「绑定在场且项目数据完整即注入」单一规则。
  service.archiveProject(project.id)
  assert.equal(binding.getLinguistSessionBinding(meta, service)?.status, 'archived')
  assert.deepEqual(skill.resolveLinguistSessionSkillPaths(meta, () => service, REPO_SKILLS_ROOT), [
    ASSISTANT_DIR,
    join(REPO_SKILLS_ROOT, 'strategy-balanced'),
  ])

  // 项目目录被外部删除 → missing：不注入（会话降级为普通 Pi 会话）
  rmSync(projectPaths(LINGUIST_ROOT, project.id).projectDir, { recursive: true, force: true })
  assert.equal(binding.getLinguistSessionBinding(meta, service)?.status, 'missing')
  assert.deepEqual(skill.resolveLinguistSessionSkillPaths(meta, () => service, REPO_SKILLS_ROOT), [])

  service.closeAll()
})

test('unknown project id resolves missing → no skill', () => {
  const service = makeServiceOnLinguistRoot()
  const ghost = { linguistProjectId: 'prj-0000000000000000' }
  assert.deepEqual(skill.resolveLinguistSessionSkillPaths(ghost, () => service, REPO_SKILLS_ROOT), [])
  service.closeAll()
})

test('fail closed: unresolvable service, missing SKILL.md, unreadable profile → degraded, never throws', () => {
  const service = makeServiceOnLinguistRoot()
  const project = service.createProject({ ...PROJECT_INPUT, name: '故障项目' })
  const meta = binding.createLinguistProjectChatSession(service, { projectId: project.id })

  // 服务未 init / 解析抛错 → []（记警告，不掀翻发送链路）
  const throwingResolver = (): LinguistProjectService => {
    throw new Error('service not initialized')
  }
  assert.deepEqual(skill.resolveLinguistSessionSkillPaths(meta, throwingResolver, REPO_SKILLS_ROOT), [])

  // skills root 不存在 → []（内置资源缺失时降级）
  const emptyDir = makeTempDir()
  assert.deepEqual(skill.resolveLinguistSessionSkillPaths(meta, () => service, emptyDir), [])
  // skillsRoot 显式 undefined → []（默认解析也找不到时同一语义）
  assert.deepEqual(skill.resolveLinguistSessionSkillPaths(meta, () => service, undefined), [])

  // project-assistant 目录缺 SKILL.md → []（同 PB-040 语义）
  const reviewerOnlyRoot = makeSkillsRootWith(['project-reviewer'])
  assert.deepEqual(skill.resolveLinguistSessionSkillPaths(meta, () => service, reviewerOnlyRoot), [])

  // strategy 目录缺失 → 只注入 project-assistant（fail closed 降级）
  const assistantOnlyRoot = makeSkillsRootWith(['project-assistant'])
  assert.deepEqual(skill.resolveLinguistSessionSkillPaths(meta, () => service, assistantOnlyRoot), [
    join(assistantOnlyRoot, 'project-assistant'),
  ])

  // 绑定状态解析为 active 后、策略档读取再失败（竞态）→ 只注入 project-assistant
  let getProjectCalls = 0
  const flakyService = {
    getProject: (...args: Parameters<LinguistProjectService['getProject']>) => {
      getProjectCalls += 1
      if (getProjectCalls > 1) throw new Error('project metadata lost mid-flight')
      return service.getProject(...args)
    },
    getProjectPaths: (...args: Parameters<LinguistProjectService['getProjectPaths']>) =>
      service.getProjectPaths(...args),
  } as unknown as LinguistProjectService
  assert.deepEqual(skill.resolveLinguistSessionSkillPaths(meta, () => flakyService, REPO_SKILLS_ROOT), [ASSISTANT_DIR])

  service.closeAll()
})

test('resume after restart: same binding re-resolves to the same skill paths on a fresh service', () => {
  const service1 = makeServiceOnLinguistRoot()
  const project = service1.createProject({ ...PROJECT_INPUT, name: '重启 Skill 项目' })
  const meta = binding.createLinguistProjectChatSession(service1, { projectId: project.id })
  const expected = [ASSISTANT_DIR, join(REPO_SKILLS_ROOT, 'strategy-balanced')]
  assert.deepEqual(skill.resolveLinguistSessionSkillPaths(meta, () => service1, REPO_SKILLS_ROOT), expected)
  service1.closeAll()

  // 第二「进程」：同一 linguist root + 同一 HOME；解析不依赖任何持久化的 Skill 列表
  const service2 = makeServiceOnLinguistRoot()
  const afterRestart = binding.listLinguistProjectChatSessions(project.id)[0]
  assert.equal(afterRestart?.id, meta.id)
  assert.deepEqual(skill.resolveLinguistSessionSkillPaths(afterRestart, () => service2, REPO_SKILLS_ROOT), expected)

  // 重启后归档 → 规则不变仍注入；删除目录 → missing 不注入
  service2.archiveProject(project.id)
  assert.deepEqual(skill.resolveLinguistSessionSkillPaths(afterRestart, () => service2, REPO_SKILLS_ROOT), expected)
  service2.closeAll()
  rmSync(projectPaths(LINGUIST_ROOT, project.id).projectDir, { recursive: true, force: true })
  const service3 = makeServiceOnLinguistRoot()
  assert.deepEqual(skill.resolveLinguistSessionSkillPaths(afterRestart, () => service3, REPO_SKILLS_ROOT), [])
  service3.closeAll()
})

test('PB-110 日志纪律：Skill 解析失败的 warn 只记 name/code，绝不透传 message 里的客户正文', () => {
  const BODY_SENTINEL = 'SENTINEL_SECRET_7f3a9'
  const service = makeServiceOnLinguistRoot()
  try {
    const project = service.createProject({ ...PROJECT_INPUT, name: 'warn 纪律项目' })
    const meta = binding.createLinguistProjectChatSession(service, { projectId: project.id })

    // 策略档读取失败的 warn 分支（绑定判定成功后 getProject 第二次调用抛错，
    // message 同时含文件名与客户正文 sentinel）
    let getProjectCalls = 0
    const flakyService = {
      getProject: (...args: Parameters<LinguistProjectService['getProject']>) => {
        getProjectCalls += 1
        if (getProjectCalls > 1) {
          throw new Error(`读取失败：客户正文 ${BODY_SENTINEL}（来源 client-lore.txt）`)
        }
        return service.getProject(...args)
      },
      getProjectPaths: (...args: Parameters<LinguistProjectService['getProjectPaths']>) =>
        service.getProjectPaths(...args),
    } as unknown as LinguistProjectService

    const warnings: string[] = []
    const originalWarn = console.warn
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((arg) => String(arg)).join(' '))
    }
    try {
      const paths = skill.resolveLinguistSessionSkillPaths(meta, () => flakyService, REPO_SKILLS_ROOT)
      assert.deepEqual(paths, [ASSISTANT_DIR], '策略档读取失败仍 fail closed 只注入常驻 Skill')

      // 外层 catch（服务解析本身抛错）同一纪律
      const throwingResolver = (): LinguistProjectService => {
        throw new Error(`初始化失败：${BODY_SENTINEL}`)
      }
      assert.deepEqual(skill.resolveLinguistSessionSkillPaths(meta, throwingResolver, REPO_SKILLS_ROOT), [])
    } finally {
      console.warn = originalWarn
    }
    assert.equal(warnings.length, 2)
    for (const line of warnings) {
      assert.ok(!line.includes(BODY_SENTINEL), `warn 泄漏客户正文: ${line}`)
      assert.match(line, /name=Error/)
    }
  } finally {
    service.closeAll()
  }
})

test('default root resolution: packaged layout via process.resourcesPath; bare ESM context → undefined', () => {
  // 打包布局：extraResources 将仓根 resources/linguist-skills 拷到 <resourcesPath>/linguist-skills。
  // 这里把 resourcesPath 指到仓根 resources/ —— 目录结构与打包产物完全一致。
  const fakeResourcesPath = dirname(REPO_SKILLS_ROOT) // .../resources
  const saved = (process as { resourcesPath?: string }).resourcesPath
  try {
    ;(process as { resourcesPath?: string }).resourcesPath = fakeResourcesPath
    assert.equal(skill.getDefaultLinguistSkillsRoot(), REPO_SKILLS_ROOT)
  } finally {
    if (saved === undefined) delete (process as { resourcesPath?: string }).resourcesPath
    else (process as { resourcesPath?: string }).resourcesPath = saved
  }

  // node --test ESM 上下文：无 __dirname（CJS 分支跳过）、无 resourcesPath → undefined。
  //（开发 CJS 束 dist/main.cjs 的上溯分支与打包分支分别由 bun guard 测试的仓根
  // 布局断言与 electron-builder 的 extraResources 配置覆盖。）
  assert.equal(skill.getDefaultLinguistSkillsRoot(), undefined)
})
