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
})
