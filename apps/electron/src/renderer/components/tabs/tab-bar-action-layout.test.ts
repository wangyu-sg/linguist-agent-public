import { describe, expect, test } from 'bun:test'
import { getTabBarActionLayout } from './tab-bar-action-layout'

describe('getTabBarActionLayout', () => {
  test('given macOS 窄窗口 when 右侧按钮齐全 then 操作层固定在右侧并保留滚动余量', () => {
    expect(getTabBarActionLayout(false, true, true)).toEqual({
      scrollPaddingClassName: 'pr-28',
      actionPositionClassName: 'right-1',
    })
  })

  test('given Windows 窄窗口 when 文件面板按钮显示或隐藏 then 操作层避开窗口控制区', () => {
    expect(getTabBarActionLayout(true, true, true).actionPositionClassName).toBe('right-[126px]')
    expect(getTabBarActionLayout(true, false, true).actionPositionClassName).toBe('right-[130px]')
  })

  test('given 当前 Tab 延伸到操作区下方 when 渲染右侧渐变层 then 渐变覆盖完整操作区并延伸到第一个按钮', async () => {
    const source = await Bun.file(new URL('./TabBar.tsx', import.meta.url)).text()

    expect(source).toContain('data-tab-bar-action-fade="true"')
    expect(source).toContain('absolute inset-y-0 -left-12 right-0')
    expect(source).toContain('[mask-image:linear-gradient(to_right,transparent_0,black_76px)]')
  })
})
