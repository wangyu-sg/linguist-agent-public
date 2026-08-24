import { expect, test } from 'bun:test'
import {
  PROJECT_OPEN_FOCUS_MAX_ATTEMPTS,
  focusAfterProjectCreate,
  projectOpenButtonSelector,
} from './ProjectCreateDialog'

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

test('U-11：受控 Dialog 经 onCloseAutoFocus 归还焦点，并记录打开前的触发元素', async () => {
  const source = await Bun.file(new URL('./ProjectCreateDialog.tsx', import.meta.url)).text()

  // 取消 / Esc：焦点回到「新建项目」触发按钮（打开时记录的 activeElement）。
  expect(source).toContain('triggerElementRef.current = document.activeElement')
  expect(source).toContain('triggerElementRef.current?.focus()')
  // 创建成功：焦点落到侧栏「打开项目」按钮。
  expect(source).toContain('createdProjectIdRef.current = result.data.id')
  expect(source).toContain('onCloseAutoFocus={handleCloseAutoFocus}')
})

test('U-11：「打开项目」按钮 selector 与侧栏项目头的 aria-controls 约定一致', () => {
  expect(projectOpenButtonSelector('prj-0000000000000001')).toBe(
    'button[aria-controls="project-sessions-prj-0000000000000001"]',
  )
})

test('U-11：创建成功后焦点落到「打开项目」按钮；列表未刷新时有限帧重试', () => {
  const focused: string[] = []
  const button = { focus: () => focused.push('button') }
  const fallback = { focus: () => focused.push('fallback') }
  const scheduled: Array<() => void> = []
  let found = false
  const probe = {
    querySelector: () => (found ? button : null),
    schedule: (callback: () => void) => scheduled.push(callback),
  }

  // 首轮未找到（列表刷新未完成）→ 安排重试；第二帧找到 → 聚焦「打开项目」。
  focusAfterProjectCreate('prj-1', fallback, 5, probe)
  expect(focused).toEqual([])
  expect(scheduled).toHaveLength(1)
  found = true
  scheduled.shift()!()
  expect(focused).toEqual(['button'])

  // 直接命中时不安排重试。
  const scheduled2: Array<() => void> = []
  focusAfterProjectCreate('prj-1', fallback, 5, {
    querySelector: () => button,
    schedule: (callback: () => void) => scheduled2.push(callback),
  })
  expect(scheduled2).toHaveLength(0)
  expect(focused).toEqual(['button', 'button'])
})

test('U-11：重试耗尽仍找不到「打开项目」按钮时回退到触发按钮', () => {
  const focused: string[] = []
  const fallback = { focus: () => focused.push('fallback') }
  focusAfterProjectCreate('prj-missing', fallback, 0, {
    querySelector: () => null,
    schedule: () => {
      throw new Error('不应再安排重试')
    },
  })
  expect(focused).toEqual(['fallback'])
  expect(PROJECT_OPEN_FOCUS_MAX_ATTEMPTS).toBe(60)
})
