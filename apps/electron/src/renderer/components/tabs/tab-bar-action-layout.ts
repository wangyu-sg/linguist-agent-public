export interface TabBarActionLayout {
  scrollPaddingClassName: string
  scrollMaskImage: string
  shortcutPositionClassName: string
  panelPositionClassName: string
}

/** 保持 Tab 栏右侧操作区与标签滚动区分离。窗口控制按钮位于全局顶部标题栏。 */
export function getTabBarActionLayout(hasPanelButton: boolean, hasBrowserButton = false): TabBarActionLayout {
  const reservedWidth = hasPanelButton
    ? (hasBrowserButton ? 128 : 96)
    : (hasBrowserButton ? 96 : 64)
  return {
    scrollPaddingClassName: hasPanelButton
      ? (hasBrowserButton ? 'pr-32' : 'pr-24')
      : (hasBrowserButton ? 'pr-24' : 'pr-16'),
    scrollMaskImage: `linear-gradient(to right, black 0, black calc(100% - ${reservedWidth + 28}px), transparent calc(100% - ${reservedWidth}px), transparent 100%)`,
    shortcutPositionClassName: hasPanelButton
      ? 'inset-y-0 items-end pb-[3px] z-10 right-9'
      : 'inset-y-0 items-end pb-[3px] z-10 right-1',
    panelPositionClassName: 'inset-y-0 right-1 items-end pb-[3px] z-10',
  }
}
