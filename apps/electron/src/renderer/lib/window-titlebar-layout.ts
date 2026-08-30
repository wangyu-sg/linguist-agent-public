export const WINDOW_TITLEBAR_HEIGHT_PX = 32
export const WINDOW_TITLEBAR_CONTROL_COUNT = 3
export const WINDOW_TITLEBAR_CONTROL_WIDTH_PX = 46
export const WINDOW_TITLEBAR_CONTROLS_WIDTH_PX = WINDOW_TITLEBAR_CONTROL_COUNT * WINDOW_TITLEBAR_CONTROL_WIDTH_PX
// `{ x: 18, y: 18 }` 下三颗原生按钮右缘实测约为 78.5pt，向外取整保留拖拽边界。
export const MAC_TITLEBAR_TRAFFIC_LIGHTS_SAFE_EDGE_PX = 80

export function getWindowTitlebarContentInsetClass(isWindows: boolean): string {
  return isWindows ? 'pt-8' : ''
}

export function getWindowTitlebarDragInsetStyle(isWindows: boolean): { right: number } {
  return { right: isWindows ? WINDOW_TITLEBAR_CONTROLS_WIDTH_PX : 0 }
}

export function getMacTitlebarLeadingInsetPx(isMac: boolean, leftSidebarOccupiedWidth: number): number {
  return isMac ? Math.max(0, MAC_TITLEBAR_TRAFFIC_LIGHTS_SAFE_EDGE_PX - leftSidebarOccupiedWidth) : 0
}
