import { readFileSync } from 'node:fs'

/** 只投影生成者需要的字段，评价预期、分组标签与判据不会进入被测请求。 */
export function buildLinguistLanguageInput(value: unknown, stage?: string) {
  if (typeof value !== 'object' || value === null || !('cases' in value) || !Array.isArray(value.cases)) throw new Error('语言案例格式无效')
  if (stage !== undefined && !['T', 'E', 'P'].includes(stage)) throw new Error('岗位只能为 T、E 或 P')
  const cases: unknown[] = value.cases
  return {
    cases: cases.map(item => {
      if (typeof item !== 'object' || item === null
        || !('id' in item) || typeof item.id !== 'string'
        || !('stage' in item) || typeof item.stage !== 'string' || !['T', 'E', 'P'].includes(item.stage)
        || !('sourceLocale' in item) || typeof item.sourceLocale !== 'string'
        || !('targetLocale' in item) || typeof item.targetLocale !== 'string'
        || !('source' in item) || typeof item.source !== 'string'
        || !('currentTarget' in item) || typeof item.currentTarget !== 'string'
        || !('brief' in item) || typeof item.brief !== 'string'
        || !('references' in item) || !Array.isArray(item.references)) throw new Error('语言案例字段无效')
      return {
        id: item.id,
        stage: item.stage,
        sourceLocale: item.sourceLocale,
        targetLocale: item.targetLocale,
        source: item.source,
        currentTarget: item.currentTarget,
        brief: item.brief,
        references: item.references as unknown[],
      }
    }).filter(item => stage === undefined || item.stage === stage),
  }
}

if (import.meta.main) {
  const file = process.argv[2]
  if (file === undefined) throw new Error('用法：bun scripts/linguist-language-input.ts <案例文件> [T|E|P]')
  const value: unknown = JSON.parse(readFileSync(file, 'utf8'))
  process.stdout.write(`${JSON.stringify(buildLinguistLanguageInput(value, process.argv[3]), null, 2)}\n`)
}
