/**
 * Renderer Host Seam 边界守护（LA-HOST-SEAM）。
 *
 * 与 tests/linguist-fusion-architecture.test.mjs 的白名单扫描互补：
 * 这里用静态源码断言固定两条宿主缝的形状——
 * 1. AgentView / AppShell 等 Proma 核心组件不再直接依赖 Linguist feature；
 * 2. Linguist 扩展统一经 host/ 下的两个登记缝进入核心组件；
 * 3. 三模式策略唯一真源是 host/app-mode-registry.ts。
 */

import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')

function source(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8')
}

const agentView = source('apps/electron/src/renderer/components/agent/AgentView.tsx')
const agentMessages = source('apps/electron/src/renderer/components/agent/AgentMessages.tsx')
const appShell = source('apps/electron/src/renderer/components/app-shell/AppShell.tsx')
const leftSidebar = source('apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx')
const modeSwitcher = source('apps/electron/src/renderer/components/app-shell/ModeSwitcher.tsx')
const useSwitchAppMode = source('apps/electron/src/renderer/hooks/useSwitchAppMode.ts')
const projectAgentRail = source(
  'apps/electron/src/renderer/features/linguist/projects/ProjectAgentRail.tsx',
)
const hostExtension = source('apps/electron/src/renderer/host/agent-host-extension.tsx')
const appModeRegistry = source('apps/electron/src/renderer/host/app-mode-registry.ts')

const LINGUIST_IMPORT_PATTERN = /from\s+['"][^'"]*features\/linguist\//

describe('Renderer Host Seam 边界', () => {
  test('Given AgentView, When inspecting its Linguist coupling, Then all extension points flow through useAgentHostExtension', () => {
    expect(agentView).not.toMatch(LINGUIST_IMPORT_PATTERN)
    expect(agentView).not.toContain('linguistProjectId')
    expect(agentView).not.toContain('ComposerContextChips')
    expect(agentView).not.toContain('contextSummary')
    expect(agentView).toContain("import { useAgentHostExtension } from '@/host/agent-host-extension'")
    expect(agentView).toContain('const hostExtension = useAgentHostExtension(sessionId, presentation)')
    expect(agentView).toContain('hostExtension.attachmentGate')
    expect(agentView).toContain('hostExtension.captureTurnContext')
    expect(agentView).toContain('{hostExtension.composerContextChips}')
  })

  test('Given core Agent renderers, When inspecting CAT dependencies, Then no store/tools import leaks into components/agent', () => {
    for (const file of [agentView, agentMessages]) {
      expect(file).not.toMatch(/@linguist\/cat-(?:store|tools)/)
      expect(file).not.toContain('node:sqlite')
    }
  })

  test('Given AppShell and ModeSwitcher, When inspecting mode policy, Then they consume the registry instead of literal branches', () => {
    expect(appShell).not.toMatch(LINGUIST_IMPORT_PATTERN)
    expect(appShell).toContain("from '@/host/app-mode-registry'")
    expect(appShell).toContain('resolveRightRailPolicy({')
    expect(modeSwitcher).not.toMatch(LINGUIST_IMPORT_PATTERN)
    expect(modeSwitcher).toContain('APP_MODE_DEFINITIONS')
    expect(modeSwitcher).toContain('resolveModeNavigation')
    expect(useSwitchAppMode).not.toContain("targetMode === 'linguist'")
    expect(useSwitchAppMode).toContain('restoresProjectTab')
  })

  test('Given the deleted scatter modules, When resolving mode/rail policy, Then only the registry remains', () => {
    for (const removed of [
      'apps/electron/src/renderer/components/app-shell/mode-switcher-utils.ts',
      'apps/electron/src/renderer/components/app-shell/mode-switcher-utils.test.ts',
      'apps/electron/src/renderer/components/app-shell/right-rail-policy.ts',
      'apps/electron/src/renderer/components/app-shell/right-rail-policy.test.ts',
      'apps/electron/src/renderer/atoms/active-view.test.ts',
    ]) {
      expect(existsSync(join(ROOT, removed))).toBe(false)
    }
    expect(appModeRegistry).toContain('// LA-HOST-SEAM: app-mode-registry')
    expect(appModeRegistry).toContain('export const APP_MODE_DEFINITIONS')
    expect(appModeRegistry).toContain('export function resolveActiveViewForMode')
    expect(appModeRegistry).toContain('export function resolveRightRailPolicy')
    expect(appModeRegistry).toContain('export function findSessionToRestore')
  })

  test('Given a forced narrow-viewport collapse, When rendering the sidebar, Then expansion stays disabled until space is available', () => {
    expect(appShell).toContain('const leftSidebarForceCollapsed = shouldForceCollapseLeftSidebar(')
    expect(leftSidebar).toContain('disabled={forceCollapsed}')
  })

  test('Given the host extension seam, When inspecting its anchor and shape, Then it is the single Linguist-aware renderer module', () => {
    expect(hostExtension).toContain('// LA-HOST-SEAM: renderer-agent-extension')
    expect(hostExtension).toContain('export function useAgentHostExtension')
    expect(hostExtension).toContain('export function useAgentSurfaceHostPresentation')
    expect(hostExtension).toContain('linguistProjectSummaryAtomFamily')
    expect(hostExtension).toContain('resolveAgentAttachmentSaveGate')
  })

  test('Given ProjectAgentRail, When bridging to AgentView, Then presentation is adjudicated by the host seam and props stay narrow', () => {
    expect(projectAgentRail).toContain('useAgentSurfaceHostPresentation')
    expect(projectAgentRail).not.toContain('getAgentSurfaceControls')
    expect(projectAgentRail).toContain('sessionId={sessionId}')
    expect(projectAgentRail).toContain('presentation={presentation}')
    expect(projectAgentRail).not.toContain('contextSummary={contextSummary}')
  })
})
