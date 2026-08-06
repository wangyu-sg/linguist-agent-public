import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const probe = readFileSync(join(import.meta.dir, 'probe-pb074-e2e.ts'), 'utf8')
const fixtureSeederPath = join(import.meta.dir, 'seed-lf056-resources.ts')
const fixtureSeeder = existsSync(fixtureSeederPath)
  ? readFileSync(fixtureSeederPath, 'utf8')
  : ''

describe('LF-026 packaged 探针合同', () => {
  test('Given LF-026 only mode, When navigation checks finish, Then delivery work is skipped without bypassing cleanup', () => {
    expect(probe).toContain("const LF026_ONLY = process.argv.includes('--lf026-only')")
    expect(probe).toContain('if (!LF026_ONLY && !LF056_ONLY) {')
    expect(probe).toContain('} finally {')
    expect(probe).toContain('await closeLogStream(logStream)')
    expect(probe).toContain('rmSync(tmpHome, { recursive: true, force: true })')
    expect(probe.indexOf('} finally {')).toBeLessThan(
      probe.indexOf('summarizeAndExit(results.some((result) => !result.pass) ? 1 : 0)'),
    )
    expect(probe).not.toMatch(/LF026_ONLY.{0,120}process\.exit/s)
  })

  test('Given two projects, When discoverability is checked, Then only the visible Linguist Sidebar list is counted', () => {
    expect(probe).toContain("page.getByRole('list', { name: '本地化项目', exact: true })")
    expect(probe).toContain('resolveVisibleLinguistProjectList(page)')
    expect(probe).toContain('await waitFor(async () => {')
    expect(probe).toContain('return visibleCount === 1')
    expect(probe).toContain('candidate.isVisible()')
    expect(probe).toContain('resolvedProjectList.visibleCount === 1')
    expect(probe).not.toContain('ul[aria-label="本地化项目"]:visible')
    expect(probe).toContain('mainVisible')
    expect(probe).toContain('distractorVisible')
    expect(probe).toContain('labels=${JSON.stringify(projectLabels)}')
  })

  test('Given the canonical PB-074 flow, When translation runs, Then it uses the current Project Agent and inline review paths', () => {
    expect(probe).toContain('agentChannelId: channel.id')
    expect(probe).toContain('agentModelId: args.modelId')
    expect(probe).toContain("agentRuntime: 'pi'")
    expect(probe).toContain('header[aria-label="本地化工作台工具栏"]')
    expect(probe).toContain('aside[aria-label="项目 Agent"]')
    expect(probe).toContain('translateSelectedAndWaitComplete')
    expect(probe).toContain('sessionErrors')
    expect(probe).toContain('section[aria-label="当前行翻译建议"]')
    expect(probe).toContain("name: 'Accept'")
    expect(probe).not.toContain('section[aria-label="CAT 工作区"]')
    expect(probe).not.toContain("getByRole('complementary', { name: '当前行详情'")
    expect(probe).not.toContain('sendAndWaitComplete')
  })

  test('Given QA is in the Bottom Dock, When the canonical flow runs QA, Then it opens Resources and scopes actions to the QA panel', () => {
    expect(probe).toContain('openQaFindings(workspace')
    expect(probe).toContain("getByRole('button', { name: '语言资产', exact: true })")
    expect(probe).toContain('section[aria-label="语言资产面板"]')
    expect(probe).toContain("getByRole('tablist', { name: '语言资产', exact: true })")
    expect(probe).toContain("getByRole('tab', { name: 'QA', exact: true })")
    expect(probe).toContain("qaTab.getAttribute('aria-selected')")
    expect(probe).toContain("findings.getByRole('button', { name: '运行整个项目 QA', exact: true })")
    expect(probe).toContain('const emptyTargetArticle = qaFindings.locator(')
    expect(probe).toContain('const repeatedArticle = qaFindings.locator(')
    expect(probe).not.toContain("page.getByRole('button', { name: '运行 QA', exact: true })")
  })

  test('Given QA exposes single and rule waiver actions, When the canonical flow waives one Finding, Then it selects the single-item action by its exact accessible name', () => {
    expect(probe).toContain(
      "repeatedArticle.getByRole('button', { name: '豁免此条', exact: true })",
    )
    expect(probe).not.toContain(
      "repeatedArticle.getByRole('button', { name: '豁免', exact: true })",
    )
  })

  test('Given export moved to Project Settings, When readiness is checked, Then the probe opens Resources without invoking native Save', () => {
    expect(probe).toContain('openProjectAssetsSettings(')
    expect(probe).toContain("getByRole('button', { name: '项目设置', exact: true })")
    expect(probe).toContain("getByRole('dialog', { name: '项目设置', exact: true })")
    expect(probe).toContain("getByRole('tablist', { name: '项目设置分类', exact: true })")
    expect(probe).toContain("getByRole('tab', { name: '语言资产', exact: true })")
    expect(probe).toContain("resourcesTab.getAttribute('aria-selected')")
    expect(probe).toContain('section[aria-label="批次（文件）"]')
    expect(probe).toContain('projectSettings.assets.getByRole(')
    expect(probe).toContain("{ name: '导出 mini_game_ui.xliff', exact: true }")
    expect(probe).toContain("{ name: 'Close', exact: true }")
    expect(probe).toContain('await closeProjectSettings.click()')
    expect(probe).toContain("'lf092-project-settings-close-button'")
    expect(probe).not.toContain("launched.page.getByRole(\n        'button',\n        { name: '导出 mini_game_ui.xliff' },")
  })

  test('Given an unchanged target in review, When Cmd+Enter is pressed, Then the packaged probe verifies stage confirmation without a text revision', () => {
    expect(probe).toContain("workflowStage: 'editing'")
    expect(probe).toContain("name: '确认审校并前进'")
    expect(probe).toContain("await editor.press('Meta+Enter')")
    expect(probe).toContain("'lf092-clean-target-cmd-enter-confirms-review'")
    expect(probe).toContain('after?.revision === before?.revision')
  })
})

describe('LF-056 Language Resource Dock packaged 探针合同', () => {
  test('Given LF-056 only mode, When Dock checks finish, Then Agent delivery is skipped without bypassing cleanup', () => {
    expect(probe).toContain("const LF056_ONLY = process.argv.includes('--lf056-only')")
    expect(probe).toContain('runLanguageResourceDockGate(')
    expect(probe).toContain('if (!LF026_ONLY && !LF056_ONLY) {')
    expect(probe).toContain("if (!LF056_ONLY) {\n      manual('native-open-dialog'")
    expect(probe).not.toContain("manual('lf056-")
    expect(probe).not.toContain("check('lf056-ime-composition'")
    expect(probe).not.toContain("check('lf056-voiceover'")
    expect(probe).not.toContain("check('lf056-pointer-drag-feel'")
    expect(probe).toContain('} finally {')
    expect(probe).toContain('await closeLogStream(logStream)')
    expect(probe).toContain('rmSync(tmpHome, { recursive: true, force: true })')
    expect(probe.indexOf('} finally {')).toBeLessThan(
      probe.indexOf('summarizeAndExit(results.some((result) => !result.pass) ? 1 : 0)'),
    )
    expect(probe).not.toMatch(/LF056_ONLY.{0,120}process\.exit/s)
  })

  test('Given a project-scoped Dock, When layout changes and the app restarts, Then open state, keyboard height, active Tab, narrow overlay and isolation are verified', () => {
    expect(probe).toContain('bottomDockOpen?: boolean')
    expect(probe).toContain('bottomDockTab?: string')
    expect(probe).toContain('bottomDockHeight?: number')
    expect(probe).toContain("'调整语言资产面板高度'")
    expect(probe).toContain('separatorBox.y + separatorBox.height / 2')
    expect(probe).toContain('const pointerHeightChanged = await waitFor(')
    expect(probe).toContain("await separator.press('End')")
    expect(probe).toContain("await openDockTab(dock, '预览')")
    expect(probe).toContain("await openSidebarProject(page, DISTRACTOR_PROJECT_NAME)")
    expect(probe).toContain("distractorState.location.bottomDockTab === 'terms'")
    expect(probe).toContain('distractorState.location.bottomDockHeight === 160')
    expect(probe).toContain("mainState.location.bottomDockTab === 'preview'")
    expect(probe).toContain('mainState.location.bottomDockHeight === 480')
    expect(probe).toContain('page.setViewportSize({ width: 900, height: 720 })')
    expect(probe).toContain("getComputedStyle(element).position === 'absolute'")
    expect(probe).toContain('lf056-dock-project-isolation')
    expect(probe).toContain('lf056-dock-restart-restores-layout')
    expect(probe).not.toContain(
      "check('lf056-dock-entry-ready', true, '语言资产面板与五个 canonical Tab 在 packaged App 可见')",
    )
  })

  test('Given deterministic CAT resources, When the packaged Dock is exercised, Then edits stay draft-only and QA, evidence and read-only preview use public seams', () => {
    expect(probe).toContain('runLf056FixtureSeeder(')
    expect(fixtureSeeder).toContain('new CatStore({ rootDir })')
    expect(fixtureSeeder).toContain('db.segments.getById(segmentId)')
    expect(fixtureSeeder).toContain('db.tmUnits.importMany(')
    expect(fixtureSeeder).toContain('db.termEntries.importMany(')
    expect(fixtureSeeder).toContain('db.styleGuideRules.upsert(')
    expect(fixtureSeeder).toContain('db.voiceProfiles.upsert(')
    expect(fixtureSeeder).toContain('db.proposals.insertPending(')
    expect(fixtureSeeder).not.toContain('.prepare(')
    expect(fixtureSeeder).not.toMatch(/\b(?:SELECT|INSERT|UPDATE|DELETE)\b/u)

    expect(probe).toContain("{ name: /编辑原始行 \\d+ 译文/u }")
    expect(probe).toContain('lf056-tm-replace-insert-undo-draft-only')
    expect(probe).toContain("const tmInsertDraft = '前缀｜后缀'")
    expect(probe).toContain('element.setSelectionRange(caret, caret)')
    expect(probe).toContain('`${tmInsertPrefix}${tmTarget}${tmInsertSuffix}`')
    expect(probe).toContain('lf056-term-insert-undo-draft-only')
    expect(probe).toContain('await termAction.waitFor({ timeout: 30_000 })')
    expect(probe).not.toContain('priority=')
    expect(fixtureSeeder).not.toContain('priority:')
    expect(probe).toContain('lf056-qa-current-segment')
    expect(probe).toContain('qaLabels.every((label) => label.endsWith(`for ${segmentId}`))')
    expect(probe).toContain('lf056-active-segment-resources-refresh')
    expect(probe).toContain("getByText('当前片段无 TM 匹配', { exact: true })")
    expect(probe).toContain("getByText('当前片段无术语匹配', { exact: true })")
    expect(probe).toContain("getByText('当前片段没有待审 Proposal', { exact: true })")
    expect(probe).toContain('lf056-context-evidence')
    expect(probe).toContain('lf056-preview-readonly-source-unchanged')
    expect(probe).toContain(
      "await previewPanel.getByText('xliff_1_2 · 只读', { exact: true }).waitFor({ timeout: 30_000 })",
    )
    expect(probe).toContain("await openDockTab(dock, 'TM 匹配')")
    expect(probe).toContain("await openDockTab(dock, '术语')")
    expect(probe).toContain("await openDockTab(dock, '上下文/证据')")
    expect(probe).toContain("await openDockTab(dock, '预览')")
    expect(probe).toContain("getByRole('button', { name: '撤销译文编辑', exact: true })")
    expect(probe).toContain('linguistCatQuery')
    expect(probe).toContain('sourceHashBefore === sourceHashAfter')
  })
})
