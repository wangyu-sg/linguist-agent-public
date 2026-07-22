import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { AgentThinkingLevel } from "../data/workspace-client.ts";
import {
  COMPOSER_POWER_LEVELS,
  clampPowerIndex,
  nextPowerIndexForKey,
  powerIndexForLevel,
  powerLevelAt,
  powerValueText,
  thinkingLevelLabels,
} from "./composer-power.ts";

/* ============================================================
   思考级别 Power Slider(Codex spec 03 §2 / 05 §5 像素规格):
   - 轨道高 24px、圆角 12px,10% 前景色底 + 0.5px 内描边
   - 拇指 28×28px 正圆,0.5px border + 投影,hit 区外扩 3px
   - 刻度点 4×4px;容器高 32px;动效 .3s cubic-bezier(.23,1,.32,1)
   - 键盘 ←/→ 调档,aria-label "Power",值播报 "{value}, {n} of {total}."
   - 按住拇指时显示 Faster/Smarter 端点标签(中文 UI:更快/更深思)
   ============================================================ */

export function ComposerPowerSlider({
  disabled = false,
  defaultLevel,
  explicitLevel,
  onChange,
}: {
  disabled?: boolean;
  /** Pi 当前有效默认值；只用于如实定位未覆盖状态。 */
  defaultLevel?: AgentThinkingLevel;
  /** 显式选择的级别;undefined = 跟随 Pi 设置。 */
  explicitLevel?: AgentThinkingLevel;
  onChange: (level: AgentThinkingLevel | undefined) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [holding, setHolding] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const committedIndex = powerIndexForLevel(explicitLevel ?? defaultLevel);
  const index = previewIndex ?? committedIndex;
  const total = COMPOSER_POWER_LEVELS.length;

  const commit = useCallback((next: number) => {
    onChange(powerLevelAt(next));
    setPreviewIndex(null);
  }, [onChange]);

  const indexFromClientX = useCallback((clientX: number): number => {
    const track = trackRef.current;
    if (!track) return committedIndex;
    const rect = track.getBoundingClientRect();
    const pad = 14; // 拇指半径:档位中心从轨道内缩 14px 起排
    const usable = Math.max(1, rect.width - pad * 2);
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left - pad) / usable));
    return clampPowerIndex(Math.round(ratio * (total - 1)));
  }, [committedIndex, total]);

  const onTrackPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    event.preventDefault();
    const next = indexFromClientX(event.clientX);
    setPreviewIndex(next);
    setHolding(true);
    const onMove = (move: PointerEvent) => setPreviewIndex(indexFromClientX(move.clientX));
    const onUp = (up: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      commit(indexFromClientX(up.clientX));
      setHolding(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [commit, disabled, indexFromClientX]);

  const onThumbKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    commit(nextPowerIndexForKey(index, event.key));
  }, [commit, disabled, index]);

  const level = powerLevelAt(index);
  const explicit = explicitLevel !== undefined;
  return (
    <div
      className="composer-power-slider"
      data-active={holding || undefined}
      data-disabled={disabled || undefined}
      title={explicit
        ? `思考级别:${thinkingLevelLabels[level]} · 从下一条新 Run 生效`
        : `思考级别:跟随 Pi 设置${defaultLevel ? `(当前 ${thinkingLevelLabels[defaultLevel]})` : ""} · 拖动滑杆可为当前 Task 固定级别`}
    >
      <span className="composer-power-slider__endpoint" aria-hidden="true">更快</span>
      <div className="composer-power-slider__root">
        <div
          ref={trackRef}
          className="composer-power-slider__track"
          onPointerDown={onTrackPointerDown}
        >
          {COMPOSER_POWER_LEVELS.map((_, tick) => (
            <span
              key={tick}
              className="composer-power-slider__tick"
              style={{ left: `calc(14px + (100% - 28px) * ${tick / (total - 1)})` }}
              aria-hidden="true"
            />
          ))}
          <div
            className="composer-power-slider__thumb"
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-label="Power"
            aria-valuemin={1}
            aria-valuemax={total}
            aria-valuenow={index + 1}
            aria-valuetext={powerValueText(index)}
            aria-disabled={disabled || undefined}
            style={{ left: `calc(14px + (100% - 28px) * ${index / (total - 1)})` }}
            onKeyDown={onThumbKeyDown}
            onFocus={() => setPreviewIndex(null)}
          />
        </div>
      </div>
      <span className="composer-power-slider__endpoint" aria-hidden="true">更深思</span>
      <span className="composer-power-slider__value" data-implicit={explicit ? undefined : true}>
        {explicit ? thinkingLevelLabels[level] : "跟随 Pi 设置"}
      </span>
      {explicit ? (
        <button
          type="button"
          className="composer-power-slider__reset"
          disabled={disabled}
          onClick={() => onChange(undefined)}
        >复位</button>
      ) : null}
    </div>
  );
}
