import { expect, test } from 'bun:test'
import { PROJECT_LOCALE_OPTIONS } from './ProjectLocaleSelect'
import { DEFAULT_PROJECT_CREATE_DRAFT } from './projects-atoms'

test('given 新建项目 when 初始化草稿 then 默认语言方向为 zh-CN 到 en-US', () => {
  expect({
    sourceLocale: DEFAULT_PROJECT_CREATE_DRAFT.sourceLocale,
    targetLocale: DEFAULT_PROJECT_CREATE_DRAFT.targetLocale,
  }).toEqual({ sourceLocale: 'zh-CN', targetLocale: 'en-US' })

  const selectableLocales = PROJECT_LOCALE_OPTIONS.map((option) => option.value)
  expect(selectableLocales).toContain(DEFAULT_PROJECT_CREATE_DRAFT.sourceLocale)
  expect(selectableLocales).toContain(DEFAULT_PROJECT_CREATE_DRAFT.targetLocale)
})
