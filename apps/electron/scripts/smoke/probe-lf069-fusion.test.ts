import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const probe = readFileSync(join(import.meta.dir, 'probe-lf069-fusion.ts'), 'utf8')

describe('LF-069 packaged Fusion 探针合同', () => {
  test('Given three selected segments, When the quick action runs, Then the probe exercises the real CAT proposal path', () => {
    const projectLocator = probe.slice(
      probe.indexOf('const projectButton'),
      probe.indexOf('await projectButton.click()'),
    )
    expect(projectLocator).toContain("page.getByRole('list', { name: '本地化项目' })")
    expect(projectLocator).toContain(".getByRole('button', { name: `打开项目 ${PROJECT_NAME}`, exact: true })")
    expect(probe).toContain("getByText('已选 3 段'")
    expect(probe).toContain("name: `选择原始行 ${index + 1}`")
    expect(probe).not.toContain("name: `选择片段 ${index + 1}`")
    expect(probe).toContain("getByRole('button', { name: '翻译已选'")
    expect(probe).toContain("const CAT_PROPOSAL_TOOL = 'cat_propose_translations'")
    expect(probe).toContain('new Set(proposalIds).size === 3')
    expect(probe).toContain('contextReachedModel')
  })

  test('Given the Agent rail defaults closed, When the project opens, Then the probe mounts it before reading Context or Session state', () => {
    const railClick = probe.indexOf('await agentPanelButton.click()')
    const selection = probe.indexOf('let selectedCheckboxCount = 0')
    const contextChip = probe.indexOf('const chip = workspace.getByRole')
    const sessionReady = probe.indexOf('const sessionReady = await waitFor')
    expect(probe).toContain("locator('header[aria-label=\"本地化工作台工具栏\"]')")
    expect(probe).toContain(".getByRole('button', { name: 'Agent', exact: true })")
    expect(probe).toContain("agentPanelButton.getAttribute('aria-pressed') === 'true'")
    expect(probe).toContain("workspace.locator('aside[aria-label=\"项目 Agent\"]')")
    expect(railClick).toBeGreaterThan(-1)
    expect(railClick).toBeLessThan(selection)
    expect(railClick).toBeLessThan(contextChip)
    expect(railClick).toBeLessThan(sessionReady)
  })

  test('Given the proposal card, When the user reviews it, Then navigation, 2/1 review and full-Agent return are asserted', () => {
    const expandHelper = probe.slice(
      probe.indexOf('async function expandProposalToolCard'),
      probe.indexOf('async function visibleGridTargetsMatch'),
    )
    const processGroupClick = expandHelper.indexOf('await processGroup.click()')
    const toolRowClick = expandHelper.indexOf('await toolRow.click()')
    const cardLookup = expandHelper.indexOf("const cards = scope.locator('section[aria-label=\"翻译建议结果摘要\"]')")
    expect(expandHelper).toContain("scope.getByRole('button', { name: /执行过程：.*次工具调用/u })")
    expect(processGroupClick).toBeGreaterThan(-1)
    expect(processGroupClick).toBeLessThan(toolRowClick)
    expect(expandHelper).toContain("scope.getByRole('button', { name: '创建 3 条翻译建议', exact: true })")
    expect(toolRowClick).toBeGreaterThan(-1)
    expect(toolRowClick).toBeLessThan(cardLookup)
    expect(expandHelper).toContain('card count=${cardCount}')
    expect(expandHelper).toContain('text=${scopeText}')
    const railExpand = probe.indexOf('const railToolCard = await expandProposalToolCard(agentRail)')
    const fullExpand = probe.indexOf('const fullToolCard = await expandProposalToolCard(fullAgent)')
    const returnedRailExpand = probe.indexOf('const returnedRailToolCard = await expandProposalToolCard(agentRail)')
    expect(railExpand).toBeGreaterThan(-1)
    expect(railExpand).toBeLessThan(fullExpand)
    expect(fullExpand).toBeLessThan(returnedRailExpand)
    expect(probe).toContain(".locator('[role=\"gridcell\"][aria-label^=\"译文：\"]')")
    expect(probe).toContain("targetCell.locator('button[data-target-edit]')")
    expect(probe).toContain('await targetControl.isVisible()')
    expect(probe).toContain("targetCell.getAttribute('aria-label')")
    expect(probe).toContain('for (const item of expected)')
    expect(probe).toContain("row.getByRole('button', { name: /查看原始行 \\d+ 上下文/u })")
    expect(probe).toContain('await activateButton.click()')
    expect(probe).toContain("row.getAttribute('aria-current') === 'true'")
    expect(probe).toContain('active=${active}')
    expect(probe).toContain('diagnostics.push(')
    expect(probe).toContain("reviewProposal(workspace, seededSegments[0]!.id, 'Accept')")
    expect(probe).toContain("reviewProposal(workspace, seededSegments[1]!.id, 'Accept')")
    expect(probe).toContain("reviewProposal(workspace, seededSegments[2]!.id, 'Reject')")
    expect(probe).toContain('storeSynced && visibleGridSynced && timelineSynced')
    expect(probe).toContain("page.locator('[data-agent-presentation=\"full\"]')")
    expect(probe).toContain('roundtripStore && roundtripGrid')
  })

  test('Given full Agent can hide the mode switcher, When returning, Then the real Project Tab restores the project identity', () => {
    const roundtrip = probe.slice(
      probe.indexOf("await workspace.getByRole('button', { name: '在完整 Agent Tab 中打开'"),
      probe.indexOf("check(\n      'full-agent-roundtrip-preserves-fusion-state'"),
    )
    expect(roundtrip).toContain("page.locator('[data-agent-presentation=\"full\"]')")
    expect(roundtrip).toContain('persistedActiveTabId(page) === sessionId')
    expect(roundtrip).toContain('name: `打开标签页：${PROJECT_NAME}`')
    expect(roundtrip).toContain('projectTabs.first().click()')
    expect(roundtrip).toContain('persistedActiveTabId(page) === `linguist-project:${projectId}`')
    expect(roundtrip).not.toContain("selectPrimaryMode(page, 'Linguist')")
  })

  test('Given automation cannot prove the whole Gate, When evidence is summarized, Then the probe stays fail-closed', () => {
    expect(probe).toContain('本脚本不判定')
    expect(probe).toContain('process.exitCode = failed.length === 0 ? 0 : 1')
    expect(probe).not.toContain('G-F4 PASS')
    expect(probe).not.toContain('manual(')
  })

  test('Given setup or launch fails, When the probe exits, Then HOME and logs still clean up while artifacts remain', () => {
    const main = probe.slice(probe.indexOf('async function main'))
    expect(main.indexOf('try {')).toBeLessThan(main.indexOf('const created = runCli'))
    expect(main.indexOf('try {')).toBeLessThan(main.indexOf('tmpHome = mkdtempSync'))
    expect(probe).toContain('const flushed = finished(logStream)')
    expect(probe).toContain('await flushed')
    expect(probe).toContain('rmSync(tmpHome, { recursive: true, force: true })')
    expect(probe).not.toContain('rmSync(artifactDir')
  })
})
