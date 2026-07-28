import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const probe = readFileSync(join(import.meta.dir, 'probe-pb105-matrix.ts'), 'utf8')

describe('PB-105 Axe 矩阵探针合同', () => {
  test('Given serious or critical Axe violations, When the matrix finishes, Then the probe fails closed after writing the report', () => {
    expect(probe).toContain("const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')")
    expect(probe).toContain('check(`axe-${view}`, serious.length === 0,')
    expect(probe).toContain("writeFileSync(join(artifactDir, 'axe-report.json'), JSON.stringify(axeReport, null, 2))")
    expect(probe).toContain('summarizeAndExit(results.some((r) => !r.pass) ? 1 : 0)')
    expect(probe).not.toContain("'warn'")
  })

  test('Given Chat interactive controls, When the packaged Axe matrix runs, Then it scans their opened keyboard states', () => {
    expect(probe).toContain("check('axe-chat-interactions'")
    expect(probe).toContain("getByRole('textbox', { name: '对话标题' })")
    expect(probe).toContain("getByRole('textbox', { name: '搜索模型' })")
    expect(probe).toContain("getByRole('button', { name: '工具', exact: true })")
    expect(probe).toContain("locator('button[title=\"选择提示词\"]")
  })
})
