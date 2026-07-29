/**
 * ModeSwitcher - Agent/Chat/Linguist 主模式切换（带滑动指示器）
 *
 * 切换模式时自动恢复上一次在该模式下查看的对话/会话：
 * 1. 优先恢复上次选中的对话 ID
 * 2. 其次查找已打开的同类型 Tab
 * 3. 兜底打开最近的对话/会话（列表首项）
 * 4. 都没有则创建该模式的草稿会话
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { appModeAtom, type AppMode } from '@/atoms/app-mode'
import { useSwitchAppMode } from '@/hooks/useSwitchAppMode'
import { Bot, Languages, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  MODE_SWITCHER_MODES,
  getModeSliderTranslateX,
  getNextMode,
} from './mode-switcher-utils'

const modeIcons: Record<AppMode, React.ReactNode> = {
  agent: <Bot size={15} />,
  chat: <MessageSquare size={15} />,
  linguist: <Languages size={15} />,
}

const modes: { value: AppMode; label: string; icon: React.ReactNode }[] = MODE_SWITCHER_MODES.map((mode) => ({
  ...mode,
  icon: modeIcons[mode.value],
}))

const navigationKeys = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End'])

export function ModeSwitcher({ ariaLabel = '主工作模式' }: { ariaLabel?: string } = {}): React.ReactElement {
  const mode = useAtomValue(appModeAtom)
  const switchMode = useSwitchAppMode()
  const modeButtonRefs = React.useRef(new Map<AppMode, HTMLButtonElement>())

  const handleModeSwitch = React.useCallback((targetMode: AppMode) => {
    switchMode(targetMode)
  }, [switchMode])

  const handleModeKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!navigationKeys.has(event.key)) return

    event.preventDefault()
    const targetMode = getNextMode(mode, event.key as 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End')
    handleModeSwitch(targetMode)
    requestAnimationFrame(() => modeButtonRefs.current.get(targetMode)?.focus())
  }, [handleModeSwitch, mode])

  return (
    <div className="pt-2 titlebar-drag-region select-none">
      <div
        role="tablist"
        aria-label={ariaLabel}
        className="relative flex rounded-xl p-1 titlebar-drag-region mode-switcher-track sidebar-control-surface"
      >
        {/* 滑动背景指示器 */}
        <div
          className={cn(
            'mode-slider pointer-events-none absolute top-1 bottom-1 w-[calc((100%-8px)/3)] rounded-lg bg-background shadow-sm transition-transform duration-300 ease-in-out',
          )}
          style={{ transform: `translateX(${getModeSliderTranslateX(mode)}%)` }}
        />
        {modes.map(({ value, label, icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => handleModeSwitch(value)}
            onKeyDown={handleModeKeyDown}
            role="tab"
            aria-selected={mode === value}
            tabIndex={mode === value ? 0 : -1}
            ref={(element) => {
              if (element) modeButtonRefs.current.set(value, element)
              else modeButtonRefs.current.delete(value)
            }}
            className={cn(
              'mode-btn titlebar-no-drag relative z-[1] h-8 flex-1 flex items-center justify-center gap-1.5 rounded-lg px-3 py-0 text-sm font-medium transition-colors duration-200 select-none',
              mode === value
                ? 'mode-btn-selected text-foreground'
                : 'text-foreground/60 hover:text-foreground'
            )}
          >
            <span className="mode-switcher-icon flex-shrink-0">{icon}</span>
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
