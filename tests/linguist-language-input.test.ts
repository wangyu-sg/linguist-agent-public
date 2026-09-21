import { expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { buildLinguistLanguageInput } from '../scripts/linguist-language-input'

const fixtures = join(import.meta.dir, 'linguist-fixtures/language')

test('真实案例只发送白名单字段，保留语言资料和完整当前译文', () => {
  const value: unknown = JSON.parse(readFileSync(join(fixtures, 'linguistic-cases.json'), 'utf8'))
  const input = buildLinguistLanguageInput(value)
  expect(input.cases).toHaveLength(36)
  expect(JSON.stringify(input)).not.toContain('expectedDecision')
  expect(JSON.stringify(input)).not.toContain('mustPreserve')
  expect(JSON.stringify(input)).not.toContain('cohort')
  expect(input.cases.find(item => item.id === 'E06')?.references).toHaveLength(1)
  expect(input.cases.find(item => item.id === 'P04')?.source).toContain('\n')
  expect(input.cases.find(item => item.id === 'P04')?.currentTarget).toContain('\\n')
  expect(buildLinguistLanguageInput(value, 'E').cases).toHaveLength(12)
  expect(() => buildLinguistLanguageInput(value, 'review')).toThrow()
})

test('未见小样覆盖各岗位，完整源句不出现在交付的 Skills 方法示例中', () => {
  const value: unknown = JSON.parse(readFileSync(join(fixtures, 'held-out-cases.json'), 'utf8'))
  const input = buildLinguistLanguageInput(value)
  expect(input.cases).toHaveLength(6)
  const referenceRoot = join(import.meta.dir, '../apps/electron/default-skills/game-localization/references')
  const references = readdirSync(referenceRoot).map(file => readFileSync(join(referenceRoot, file), 'utf8')).join('\n')
  for (const item of input.cases) expect(references).not.toContain(item.source)
  for (const stage of ['T', 'E', 'P']) expect(buildLinguistLanguageInput(value, stage).cases).toHaveLength(2)
})
