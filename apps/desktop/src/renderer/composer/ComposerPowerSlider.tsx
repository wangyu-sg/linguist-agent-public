import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
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
   - 轨道、当前值和复位按钮使用稳定的三列布局;不因端点文案或隐式默认值跳动
   ============================================================ */

/* Codex spec 06 §6:切档粒子爆发(12 粒子,30° 间隔,6ms 错峰,76px 场)。 */
const BURST_PARTICLES = [
  { x: "26px", y: "0px", delay: "0ms" },
  { x: "23px", y: "13px", delay: "6ms" },
  { x: "13px", y: "23px", delay: "12ms" },
  { x: "0px", y: "26px", delay: "18ms" },
  { x: "-13px", y: "23px", delay: "24ms" },
  { x: "-23px", y: "13px", delay: "30ms" },
  { x: "-26px", y: "0px", delay: "36ms" },
  { x: "-23px", y: "-13px", delay: "42ms" },
  { x: "-13px", y: "-23px", delay: "48ms" },
  { x: "0px", y: "-26px", delay: "54ms" },
  { x: "13px", y: "-23px", delay: "60ms" },
  { x: "23px", y: "-13px", delay: "66ms" },
] as const;

export function ComposerPowerSlider({
  disabled = false,
  defaultLevel,
  explicitLevel,
  onChange,
}: {
  disabled?: boolean;
  /** Pi 当前有效默认值；只用于如实定位未覆盖状态。 */
  defaultLevel?: AgentThinkingLevel;
  /** 显式选择的级别;undefined = 使用运行时默认级别。 */
  explicitLevel?: AgentThinkingLevel;
  onChange: (level: AgentThinkingLevel | undefined) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [thumbFocused, setThumbFocused] = useState(false);
  const [burst, setBurst] = useState<{ index: number; id: number } | null>(null);
  const burstIdRef = useRef(0);
  const committedIndex = powerIndexForLevel(explicitLevel ?? defaultLevel);
  const index = previewIndex ?? committedIndex;
  const total = COMPOSER_POWER_LEVELS.length;

  const commit = useCallback((next: number) => {
    onChange(powerLevelAt(next));
    setPreviewIndex(null);
    burstIdRef.current += 1;
    setBurst({ index: next, id: burstIdRef.current });
  }, [onChange]);

  useEffect(() => {
    if (!burst) return;
    const timer = window.setTimeout(() => setBurst(null), 700);
    return () => window.clearTimeout(timer);
  }, [burst]);

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
    const onMove = (move: PointerEvent) => setPreviewIndex(indexFromClientX(move.clientX));
    const onUp = (up: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      commit(indexFromClientX(up.clientX));
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
  /* Codex spec 05 §5.1:端点刻度(更快↔更强)只在按住拇指或键盘聚焦时出现。 */
  const holding = previewIndex !== null || thumbFocused;
  return (
    <div
      className="composer-power-slider"
      data-disabled={disabled || undefined}
      data-holding={holding || undefined}
      data-index={index}
      title={explicit
        ? `思考级别:${thinkingLevelLabels[level]} · 从下一条新 Run 生效`
        : `思考级别:使用默认值${defaultLevel ? `(当前 ${thinkingLevelLabels[defaultLevel]})` : ""} · 拖动滑杆可为当前 Task 固定级别`}
    >
      <div className="composer-power-slider__root">
        <div
          ref={trackRef}
          className="composer-power-slider__track"
          onPointerDown={onTrackPointerDown}
        >
          <span
            className="composer-power-slider__fill"
            style={{ width: `calc(14px + (100% - 28px) * ${index / (total - 1)})` }}
            aria-hidden="true"
          />
          <span className="composer-power-slider__endpoint composer-power-slider__endpoint--fast" aria-hidden="true">更快</span>
          {COMPOSER_POWER_LEVELS.map((_, tick) => (
            <span
              key={tick}
              className="composer-power-slider__tick"
              style={{ left: `calc(14px + (100% - 28px) * ${tick / (total - 1)})` }}
              aria-hidden="true"
            />
          ))}
          <span className="composer-power-slider__endpoint composer-power-slider__endpoint--smart" aria-hidden="true">更强</span>
          {index === total - 1 && !disabled ? (
            <>
              {[0, 1, 2].map((particle) => (
                <i
                  key={particle}
                  className="composer-power-slider__track-particle"
                  style={{ animationDelay: `${particle * 0.9}s` }}
                  aria-hidden="true"
                />
              ))}
            </>
          ) : null}
          {burst ? (
            <span
              key={burst.id}
              className="composer-power-slider__burst"
              style={{ left: `calc(14px + (100% - 28px) * ${burst.index / (total - 1)})` }}
              aria-hidden="true"
            >
              {BURST_PARTICLES.map((particle, particleIndex) => (
                <i
                  key={particleIndex}
                  style={{
                    "--particle-x": particle.x,
                    "--particle-y": particle.y,
                    animationDelay: particle.delay,
                  } as CSSProperties}
                />
              ))}
            </span>
          ) : null}
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
            onFocus={() => { setPreviewIndex(null); setThumbFocused(true); }}
            onBlur={() => setThumbFocused(false)}
          />
        </div>
      </div>
      <span className="composer-power-slider__value" data-implicit={explicit ? undefined : true}>
        {explicit ? thinkingLevelLabels[level] : "使用默认值"}
      </span>
      <button
        type="button"
        className="composer-power-slider__reset"
        disabled={disabled || !explicit}
        aria-label={explicit ? "复位思考级别" : "正在使用默认思考级别"}
        onClick={() => onChange(undefined)}
      >复位</button>
    </div>
  );
}
