import { expect, test } from 'bun:test'
import { getMacTitlebarLayout } from '@proma/shared'
import { getSidebarTitlebarLayout } from './window-titlebar-layout'

test('macOS 原生红绿灯随缩放移动，页面控件与其垂直对齐并保留水平间距', () => {
  const positions = new Set<string>()
  for (const zoomFactor of [0.25, 0.5, 0.8, 1, 1.25, 1.5, 2, 3]) {
    const native = getMacTitlebarLayout(zoomFactor)
    positions.add(JSON.stringify(native.buttonPosition))
    for (const sidebarOccupiedWidth of [0, 120, 241, 301, 421]) {
      const layout = getSidebarTitlebarLayout({ isMac: true, isWindows: false, zoomFactor, sidebarOccupiedWidth })
      expect(layout.controlsLeft * zoomFactor - native.buttonPosition.x - 60).toBeCloseTo(12 * zoomFactor)
      expect(Math.abs((layout.controlsTop + 14) * zoomFactor - native.buttonPosition.y - 7)).toBeLessThanOrEqual(0.5)
      expect(layout.sidebarTopInset * zoomFactor).toBeGreaterThanOrEqual(native.buttonPosition.y + 14)
      expect(sidebarOccupiedWidth + layout.mainLeadingInset).toBeGreaterThanOrEqual(layout.controlsEnd - 0.000001)
    }
  }
  expect(positions.size).toBe(8)
})

test('侧栏从完全隐藏到展开及反向切换，动画中的标题和拖拽区均位于控件右侧', () => {
  for (const zoomFactor of [0.5, 0.8, 1, 1.5, 2]) {
    for (const width of [241, 301, 421]) {
      for (const progress of [0, 0.1, 0.25, 0.5, 0.9, 1]) {
        const sidebarOccupiedWidth = width * progress
        const layout = getSidebarTitlebarLayout({ isMac: true, isWindows: false, zoomFactor, sidebarOccupiedWidth })
        const titleStart = sidebarOccupiedWidth + layout.mainLeadingInset
        expect(titleStart).toBeGreaterThanOrEqual(layout.controlsEnd - 0.000001)
      }
    }
  }
})

test('Windows 使用独立标题栏，Linux 为完全收起的侧栏保留顶部控件空间', () => {
  const windows = getSidebarTitlebarLayout({ isMac: false, isWindows: true, zoomFactor: 0.8, sidebarOccupiedWidth: 0 })
  expect(windows.controlsTop + 14).toBe(16)
  expect(windows.mainLeadingInset).toBe(0)
  expect(windows.sidebarTopInset).toBe(8)
  const linux = getSidebarTitlebarLayout({ isMac: false, isWindows: false, zoomFactor: 0.8, sidebarOccupiedWidth: 0 })
  expect(linux.mainLeadingInset).toBe(84)
  expect(linux.sidebarTopInset).toBe(48)
})
