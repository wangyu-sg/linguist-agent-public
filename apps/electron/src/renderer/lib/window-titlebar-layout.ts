import { getMacTitlebarLayout } from '@proma/shared'

export const WINDOW_TITLEBAR_HEIGHT_PX = 32
export const WINDOW_TITLEBAR_CONTROL_COUNT = 3
export const WINDOW_TITLEBAR_CONTROL_WIDTH_PX = 46
export const WINDOW_TITLEBAR_CONTROLS_WIDTH_PX = WINDOW_TITLEBAR_CONTROL_COUNT * WINDOW_TITLEBAR_CONTROL_WIDTH_PX

export function getWindowTitlebarContentInsetClass(isWindows: boolean): string {
  return isWindows ? 'pt-8' : ''
}

export function getWindowTitlebarDragInsetStyle(isWindows: boolean): { right: number } {
  return { right: isWindows ? WINDOW_TITLEBAR_CONTROLS_WIDTH_PX : 0 }
}

interface SidebarTitlebarLayoutInput {
  isMac: boolean
  isWindows: boolean
  zoomFactor: number
  sidebarOccupiedWidth: number
}

/** 顶栏随页面缩放；为固定系统尺寸的原生红绿灯预留 CSS 宽度。 */
export function getSidebarTitlebarLayout({ isMac, isWindows, zoomFactor, sidebarOccupiedWidth }: SidebarTitlebarLayoutInput) {
  const macLayout = getMacTitlebarLayout(zoomFactor)
  const controlsLeft = isMac ? macLayout.controlsLeft : 12
  const controlsEnd = controlsLeft + 72
  const titlebarHeight = isMac ? macLayout.height : 48
  return {
    controlsLeft,
    controlsTop: isWindows ? 2 : (titlebarHeight - 28) / 2,
    controlsEnd,
    titlebarHeight,
    sidebarTopInset: isWindows ? 8 : titlebarHeight,
    mainLeadingInset: isWindows ? 0 : Math.max(0, controlsEnd - sidebarOccupiedWidth),
  }
}
