import { expect, test } from 'bun:test'

test('given 新建项目 when 渲染语言方向 then 两个入口字段都使用共享下拉', async () => {
  const source = await Bun.file(new URL('./ProjectCreateDialog.tsx', import.meta.url)).text()
  const fields = source.match(/<ProjectLocaleSelect[\s\S]*?\/>/g) ?? []
  const sourceField = fields.find((field) => field.includes('id="project-create-source"'))
  const targetField = fields.find((field) => field.includes('id="project-create-target"'))

  expect(sourceField).toContain('value={draft.sourceLocale}')
  expect(sourceField).toContain("updateField('sourceLocale', value)")
  expect(targetField).toContain('value={draft.targetLocale}')
  expect(targetField).toContain("updateField('targetLocale', value)")
  expect(source).not.toMatch(/<Input[^>]*id="project-create-(?:source|target)"/)
})
