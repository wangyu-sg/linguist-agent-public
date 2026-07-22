export const INSPECTOR_MIN_WIDTH = 320;
export const INSPECTOR_DEFAULT_WIDTH = 380;
export const INSPECTOR_MAX_WIDTH = 720;
export const INSPECTOR_MIN_MAIN_WIDTH = 420;
export const INSPECTOR_KEYBOARD_STEP = 16;

export function inspectorWidthBounds(frameWidth: number): { min: number; max: number } {
  const safeFrameWidth = Number.isFinite(frameWidth) && frameWidth > 0
    ? frameWidth
    : INSPECTOR_DEFAULT_WIDTH + INSPECTOR_MIN_MAIN_WIDTH;
  return {
    min: INSPECTOR_MIN_WIDTH,
    max: Math.max(
      INSPECTOR_MIN_WIDTH,
      Math.min(INSPECTOR_MAX_WIDTH, Math.floor(safeFrameWidth - INSPECTOR_MIN_MAIN_WIDTH)),
    ),
  };
}

export function clampInspectorWidth(width: number, frameWidth: number): number {
  const bounds = inspectorWidthBounds(frameWidth);
  const safeWidth = Number.isFinite(width) ? width : INSPECTOR_DEFAULT_WIDTH;
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(safeWidth)));
}

export function inspectorWidthForKey(
  key: string,
  width: number,
  frameWidth: number,
  step = INSPECTOR_KEYBOARD_STEP,
): number | null {
  const bounds = inspectorWidthBounds(frameWidth);
  if (key === "ArrowLeft") return clampInspectorWidth(width + step, frameWidth);
  if (key === "ArrowRight") return clampInspectorWidth(width - step, frameWidth);
  if (key === "Home") return clampInspectorWidth(INSPECTOR_DEFAULT_WIDTH, frameWidth);
  if (key === "End") return bounds.max;
  return null;
}
