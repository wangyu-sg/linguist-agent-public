/** macOS 原生按钮保持 14pt，标题栏在最小页面缩放时仍留出 28pt 高度。 */
export function getMacTitlebarLayout(zoomFactor: number) {
  const height = Math.max(50 * zoomFactor, 28)
  const buttonPosition = { x: Math.round(18 * zoomFactor), y: Math.round((height - 14) / 2) }
  return {
    buttonPosition,
    height: height / zoomFactor,
    // 三颗原生按钮共占 60pt，后接随页面缩放的 12px 间距。
    controlsLeft: (buttonPosition.x + 60) / zoomFactor + 12,
  }
}
