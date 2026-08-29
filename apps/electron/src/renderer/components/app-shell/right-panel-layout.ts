export const RIGHT_PANEL_MAX_VIEWPORT_RATIO = 3 / 5
export const MIN_MAIN_AREA_WIDTH = 320
export const MIN_EXPANDED_RIGHT_WORKSPACE_WIDTH = 512

export function getExpandedRightWorkspaceLayout(
  viewportWidth: number,
  leftSidebarOccupiedWidth: number,
): { mainAreaWidth: number; rightPanelWidth: number } {
  const availableWidth = Math.max(0, viewportWidth - leftSidebarOccupiedWidth)
  const mainAreaWidth = availableWidth - MIN_MAIN_AREA_WIDTH >= MIN_EXPANDED_RIGHT_WORKSPACE_WIDTH
    ? MIN_MAIN_AREA_WIDTH
    : 0
  return {
    mainAreaWidth,
    rightPanelWidth: availableWidth - mainAreaWidth,
  }
}

export function getRightPanelMaxWidth(
  viewportWidth: number,
  leftSidebarOccupiedWidth: number,
  allowFullAvailableWidth = false,
): number {
  const availableWidth = viewportWidth - leftSidebarOccupiedWidth - MIN_MAIN_AREA_WIDTH
  return Math.max(
    0,
    allowFullAvailableWidth
      ? availableWidth
      : Math.min(
        Math.floor(viewportWidth * RIGHT_PANEL_MAX_VIEWPORT_RATIO),
        availableWidth,
      ),
  )
}

export function clampRightPanelWidth(
  width: number,
  viewportWidth: number,
  minimumWidth: number,
  leftSidebarOccupiedWidth: number,
  allowFullAvailableWidth = false,
): number {
  const maximumWidth = getRightPanelMaxWidth(
    viewportWidth,
    leftSidebarOccupiedWidth,
    allowFullAvailableWidth,
  )
  const effectiveMinimumWidth = Math.min(minimumWidth, maximumWidth)
  return Math.max(effectiveMinimumWidth, Math.min(maximumWidth, width))
}
