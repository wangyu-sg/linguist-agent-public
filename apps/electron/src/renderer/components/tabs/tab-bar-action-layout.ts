export interface TabBarActionLayout {
  scrollPaddingClassName: string
  actionPositionClassName: string
}

/**
 * 保持 Tab 栏右侧操作区与窗口控制按钮分离，同时为标签滚动区留出空间。
 */
export function getTabBarActionLayout(isWindows: boolean, hasPanelButton: boolean, hasBrowserButton = false): TabBarActionLayout {
  if (!isWindows) {
    return {
      scrollPaddingClassName: hasPanelButton
        ? (hasBrowserButton ? 'pr-28' : 'pr-20')
        : (hasBrowserButton ? 'pr-20' : 'pr-10'),
      actionPositionClassName: 'right-1',
    }
  }

  return {
    // 126px WindowControls + 60px 快捷操作区；文件面板按钮额外占用 28px 与 4px 间隔。
    scrollPaddingClassName: hasPanelButton
      ? (hasBrowserButton ? 'pr-[246px]' : 'pr-[218px]')
      : (hasBrowserButton ? 'pr-[218px]' : 'pr-[190px]'),
    actionPositionClassName: hasPanelButton ? 'right-[126px]' : 'right-[130px]',
  }
}
