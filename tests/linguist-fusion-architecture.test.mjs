/**
 * LF-004：Linguist Fusion 架构护栏。
 *
 * 这里只检查跨模块不变量，不测试组件内部实现：
 * 1. Linguist feature 不声明第二套 Agent 基础组件；
 * 2. CAT Core 不依赖 React、Electron 或 Proma UI；
 * 3. Proma renderer 反向 import Linguist feature 只能发生在已登记触点。
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const LINGUIST_FEATURE_ROOT = join(
  REPO_ROOT,
  'apps/electron/src/renderer/features/linguist',
)
const CAT_CORE_ROOT = join(REPO_ROOT, 'packages/linguist-cat-core')
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])

const FORBIDDEN_LINGUIST_AGENT_COMPONENTS = [
  'LinguistAgentRail',
  'LinguistAgentView',
  'LinguistComposer',
  'LinguistConversation',
  'LinguistAgentMessages',
  'LinguistThinkingBlock',
  'LinguistToolCard',
  'LinguistApprovalCard',
  'LinguistModelPicker',
  'LinguistPermissionPicker',
  'LinguistQueue',
  'LinguistSteer',
]

const FORBIDDEN_CAT_CORE_IMPORTS = [
  'react',
  'react-dom',
  'electron',
  '@proma/ui',
]

/**
 * 这些是已登记的组合缝；允许删除，不允许未登记新增 importer。
 * App Shell / TabContent、全局搜索与设置页负责把 Linguist 产品面组合进 Proma 壳；
 * host/ 是 LA-HOST-SEAM 登记的宿主缝（agent-host-extension 收口 AgentView 的
 * Linguist 扩展，linguist-extension 注册 Linguist 模式贡献）；AgentHeader /
 * SidePanel 是待后续 fusion 工单收窄的历史触点；PreviewTabContent / PreviewPanel
 * 是原生 Preview Tab 的 Linguist 目标分支缝（LA-HOST-005，previewFile.linguist
 * 为 opaque 目标，Proma 侧不感知 CAT 细节）。
 */
const REGISTERED_PROMA_TO_LINGUIST_IMPORTERS = new Set([
  'apps/electron/src/renderer/components/agent/AgentHeader.tsx',
  'apps/electron/src/renderer/components/agent/tool-result-renderers/delegation-result.tsx',
  'apps/electron/src/renderer/components/agent/SidePanel.tsx',
  'apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx',
  'apps/electron/src/renderer/components/app-shell/SearchDialog.tsx',
  'apps/electron/src/renderer/components/diff/PreviewPanel.tsx',
  'apps/electron/src/renderer/components/diff/PreviewTabContent.tsx',
  'apps/electron/src/renderer/components/settings/MigrationSettings.tsx',
  'apps/electron/src/renderer/components/tabs/MainArea.tsx',
  'apps/electron/src/renderer/components/tabs/TabContent.tsx',
  'apps/electron/src/renderer/host/agent-host-extension.tsx',
  'apps/electron/src/renderer/host/linguist-extension.tsx',
  // agent-host-extension 的行为测试：直接播种 linguist atom 以固定宿主缝契约。
  'apps/electron/src/renderer/host/agent-host-extension.test.tsx',
])

function listSourceFiles(root) {
  const files = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(path))
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
      files.push(path)
    }
  }
  return files
}

function repoPath(path) {
  return relative(REPO_ROOT, path).split('\\').join('/')
}

function importedSpecifiers(source) {
  const specifiers = []
  const pattern =
    /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\sfrom\s*)?['"]([^'"]+)['"]|\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g

  for (const match of source.matchAll(pattern)) {
    specifiers.push(match[1] ?? match[2])
  }
  return specifiers
}

function importsPackage(specifier, packageName) {
  return specifier === packageName || specifier.startsWith(`${packageName}/`)
}

test('Linguist feature 不声明第二套 Agent 基础组件', () => {
  const violations = []

  for (const file of listSourceFiles(LINGUIST_FEATURE_ROOT)) {
    const source = readFileSync(file, 'utf8')
    const fileStem = basename(file, extname(file)).replace(/\.(?:test|spec)$/, '')

    for (const component of FORBIDDEN_LINGUIST_AGENT_COMPONENTS) {
      const declaration = new RegExp(
        `^\\s*(?:export\\s+)?(?:default\\s+)?(?:function|class|interface|type|const|let|var)\\s+${component}\\b`,
        'm',
      )
      if (fileStem === component || declaration.test(source)) {
        violations.push(`${repoPath(file)}: ${component}`)
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `发现重复 Agent 基础组件；Linguist 必须复用 Proma 原生实现：\n${violations.join('\n')}`,
  )
})

test('CAT Core 不反向依赖 React、Electron 或 Proma UI', () => {
  const violations = []
  const sourceRoot = join(CAT_CORE_ROOT, 'src')

  for (const file of listSourceFiles(sourceRoot)) {
    const source = readFileSync(file, 'utf8')
    for (const specifier of importedSpecifiers(source)) {
      if (FORBIDDEN_CAT_CORE_IMPORTS.some((name) => importsPackage(specifier, name))) {
        violations.push(`${repoPath(file)} -> ${specifier}`)
      }
    }
  }

  const manifest = JSON.parse(readFileSync(join(CAT_CORE_ROOT, 'package.json'), 'utf8'))
  for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const dependency of Object.keys(manifest[section] ?? {})) {
      if (FORBIDDEN_CAT_CORE_IMPORTS.some((name) => importsPackage(dependency, name))) {
        violations.push(`packages/linguist-cat-core/package.json#${section} -> ${dependency}`)
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `CAT Core 必须保持纯领域模块：\n${violations.join('\n')}`,
  )
})

test('Proma renderer 反向 import Linguist feature 只允许已登记触点', () => {
  const rendererRoot = join(REPO_ROOT, 'apps/electron/src/renderer')
  const promaRoots = ['atoms', 'components', 'hooks', 'lib', 'host']
  const violations = []

  for (const root of promaRoots) {
    for (const file of listSourceFiles(join(rendererRoot, root))) {
      const source = readFileSync(file, 'utf8')
      const importsLinguist = importedSpecifiers(source).some(
        (specifier) =>
          specifier.startsWith('@/features/linguist/')
          || specifier.includes('/features/linguist/'),
      )
      const path = repoPath(file)
      if (importsLinguist && !REGISTERED_PROMA_TO_LINGUIST_IMPORTERS.has(path)) {
        violations.push(path)
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `发现未登记的 Proma -> Linguist 反向依赖；优先改为组合根或窄 prop/slot：\n${violations.join('\n')}`,
  )
})

test('LF-077：旧 ProjectsSidebarEntry 不再提供日常项目工作入口', () => {
  const sidebar = readFileSync(
    join(REPO_ROOT, 'apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx'),
    'utf8',
  )
  const mainArea = readFileSync(
    join(REPO_ROOT, 'apps/electron/src/renderer/components/tabs/MainArea.tsx'),
    'utf8',
  )
  const appShell = readFileSync(
    join(REPO_ROOT, 'apps/electron/src/renderer/components/app-shell/AppShell.tsx'),
    'utf8',
  )

  assert.doesNotMatch(sidebar, /ProjectsSidebarEntry|handleOpenProjects|LINGUIST_PROJECTS_VISIBLE/)
  assert.doesNotMatch(mainArea, /LINGUIST_PROJECTS_VISIBLE|projectsViewFallback/)
  assert.match(mainArea, /resolveActiveViewForMode/)
  assert.match(appShell, /resolveActiveViewForMode/)
  assert.match(mainArea, /activeView === 'projects'[\s\S]*?<ProjectsView \/>/)
})

test('LF-074：删除 ProjectDetail 内部工作导航，项目卡直接进入一等 Project Tab', () => {
  const projectsRoot = join(LINGUIST_FEATURE_ROOT, 'projects')
  const openProject = readFileSync(join(projectsRoot, 'open-localization-project.ts'), 'utf8')

  assert.equal(existsSync(join(projectsRoot, 'ProjectDetailPanel.tsx')), false)
  assert.equal(existsSync(join(projectsRoot, 'ProjectChatsSection.tsx')), false)
  assert.match(openProject, /openLocalizationProjectTab/)
  assert.match(
    openProject,
    /enterLinguistNavigation\(store, opened\.activeTabId, 'conversations'\)/,
  )
})

test('LF-075：Bottom Dock 接管上下文能力后删除旧 CatContextRail', () => {
  const projectsRoot = join(LINGUIST_FEATURE_ROOT, 'projects')
  const bottomDock = readFileSync(join(projectsRoot, 'LinguistBottomDock.tsx'), 'utf8')

  assert.equal(existsSync(join(projectsRoot, 'CatContextRail.tsx')), false)
  assert.match(bottomDock, /TmMatchPanel/)
  assert.match(bottomDock, /TermMatchPanel/)
  assert.match(bottomDock, /QaFindingsPanel/)
  assert.match(bottomDock, /ContextEvidencePanel/)
})

test('LF-076：Workbench 只保留生产 Grid，资源管理统一进入 Project Settings', () => {
  const projectsRoot = join(LINGUIST_FEATURE_ROOT, 'projects')
  const workbench = readFileSync(join(projectsRoot, 'LocalizationProjectWorkbench.tsx'), 'utf8')
  const segmentEditor = readFileSync(join(projectsRoot, 'SegmentEditor.tsx'), 'utf8')
  const projectSettings = readFileSync(join(projectsRoot, 'ProjectSettingsSheet.tsx'), 'utf8')

  assert.equal(existsSync(join(projectsRoot, 'CatWorkspace.tsx')), false)
  assert.match(workbench, /<LinguistWorkbenchShell/)
  assert.match(workbench, /<SegmentEditor/)
  assert.match(segmentEditor, /<SegmentGrid/)
  assert.doesNotMatch(
    segmentEditor,
    /ReferenceManager|StyleGuidePanel|VoiceProfilePanel|ContextDocsPanel|CatContextRail/,
  )
  assert.match(projectSettings, /<ReferenceManager/)
  assert.match(projectSettings, /<StyleGuidePanel/)
  assert.match(projectSettings, /<VoiceProfilePanel/)
  assert.match(projectSettings, /<ContextDocsPanel/)
})

test('LF-078：Legacy UI 删除后只保留单一 Workbench 与主进程 CAT 真源', () => {
  const rendererRoot = join(REPO_ROOT, 'apps/electron/src/renderer')
  const productionRenderer = listSourceFiles(rendererRoot)
    .filter((file) => !/\.(?:test|spec)\.[^.]+$/.test(file))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n')
  const legacyNames = [
    'ProjectDetailPanel',
    'ProjectChatsSection',
    'CatContextRail',
    'CatWorkspace',
    'ProjectsSidebarEntry',
  ]

  for (const name of legacyNames) {
    assert.doesNotMatch(
      productionRenderer,
      new RegExp(`\\b${name}\\b`),
      `生产 renderer 仍消费旧 UI：${name}`,
    )
  }

  for (const path of [
    'apps/electron/src/renderer/features/linguist/projects/LocalizationProjectWorkbench.tsx',
    'apps/electron/src/renderer/features/linguist/projects/SegmentEditor.tsx',
    'apps/electron/src/renderer/features/linguist/projects/SegmentGrid.tsx',
    'apps/electron/src/renderer/features/linguist/projects/LinguistBottomDock.tsx',
    'apps/electron/src/renderer/features/linguist/projects/ProjectSettingsSheet.tsx',
    'apps/electron/src/main/lib/linguist/project-service.ts',
    'apps/electron/src/main/lib/linguist/project-ipc.ts',
    'apps/electron/src/main/lib/linguist/session-cat-tools.ts',
    'packages/linguist-cat-core/src/index.ts',
    'packages/linguist-cat-store/src/index.ts',
    'packages/linguist-cat-tools/src/index.ts',
  ]) {
    assert.equal(existsSync(join(REPO_ROOT, path)), true, `删除了仍需保留的 CAT 真源：${path}`)
  }

  const projectUi = listSourceFiles(join(LINGUIST_FEATURE_ROOT, 'projects'))
    .filter((file) => !/\.(?:test|spec)\.[^.]+$/.test(file))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n')
  assert.doesNotMatch(
    projectUi,
    /@linguist\/cat-(?:store|tools)|node:sqlite|\blocalStorage\b|\bindexedDB\b/,
    'Project UI 不得创建第二套 CAT Store 或持久化真源',
  )
})

test('三模式键盘导航：Ctrl+Tab 可返回已打开的 Linguist Project Tab', () => {
  const tabSwitcher = readFileSync(
    join(REPO_ROOT, 'apps/electron/src/renderer/components/tabs/TabSwitcher.tsx'),
    'utf8',
  )

  assert.match(tabSwitcher, /tab\.type === 'linguist-project'/)
  assert.match(tabSwitcher, /candidate\.type === 'linguist-project'/)
  assert.match(tabSwitcher, /enterLinguistNavigation\(store, projectTab\.id, 'conversations'\)/)
  assert.match(tabSwitcher, /<Languages className="size-2\.5" \/>/)
})

test('Linguist Runtime 同时装配 Proma Workspace 能力与 CAT overlay', () => {
  const orchestrator = readFileSync(
    join(REPO_ROOT, 'apps/electron/src/main/lib/agent-orchestrator.ts'),
    'utf8',
  )
  const executionScope = readFileSync(
    join(REPO_ROOT, 'apps/electron/src/main/lib/linguist/agent-execution-scope.ts'),
    'utf8',
  )
  const hostExtension = readFileSync(
    join(REPO_ROOT, 'apps/electron/src/main/lib/linguist/agent-host-extension.ts'),
    'utf8',
  )

  assert.match(orchestrator, /const workspaceId = sessionMeta\?\.workspaceId \?\? requestedWorkspaceId/)
  assert.doesNotMatch(orchestrator, /会话项目不匹配/)
  assert.doesNotMatch(orchestrator, /hasLinguistSessionBinding|executionScope\.kind !== 'linguist-project'/)
  assert.match(orchestrator, /buildPiBuiltinTools\(piSdk, \{[\s\S]*?workspaceId,[\s\S]*?workspaceSlug,/)
  assert.match(orchestrator, /buildMcpServers\(workspaceSlug\)/)
  assert.match(orchestrator, /getWorkspaceMemoryGuidance\(workspaceSlug\)/)
  assert.match(orchestrator, /readWorkspaceAgentsMd\(workspaceSlug\)/)
  assert.match(orchestrator, /additionalSkillPaths: \[getWorkspaceSkillsDir\(workspaceSlug\)\]/)
  assert.match(orchestrator, /resolveLinguistAgentHostExtension\(/)
  assert.match(orchestrator, /linguistExtension\.composeTools\(/)
  assert.match(hostExtension, /composeAgentTools\([\s\S]*?catTools/)
  assert.match(executionScope, /ensureWorkspaceSession\(workspace\.slug, session\.id\)/)
  assert.doesNotMatch(executionScope, /ensureLinguistSessionWorkspace/)
})
