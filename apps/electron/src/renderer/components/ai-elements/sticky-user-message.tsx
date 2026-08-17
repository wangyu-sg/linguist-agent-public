/**
 * StickyUserMessage — 用户消息悬浮置顶条
 *
 * 当任意用户消息完全滚出 Conversation 视口顶部时，
 * 在消息视口上方显示精简导航条，点击可回滚到原始消息位置。
 * 必须放在 StickToBottom（Conversation）内部使用。
 * 导航条通过 portal 进入外部 host，以正常布局占位，不能覆盖消息与工具控件。
 *
 * 核心逻辑：遍历所有 [data-message-role="user"] DOM 节点，
 * 找到最后一个 bottom < containerTop 的节点（即视口上方最近的用户消息），
 * 匹配其 data-message-id 到 userMessages 数据列表，显示对应内容。
 */

import * as React from 'react'
import { createPortal } from 'react-dom'
import { ChevronUp } from 'lucide-react'
import { useStickToBottomContext } from 'use-stick-to-bottom'
import { useAtomValue } from 'jotai'
import { stickyUserMessageEnabledAtom } from '@/atoms/ui-preferences'
import { cn } from '@/lib/utils'

/** 去除 fenced code block，替换为 [code] 占位符 */
function stripCodeBlocks(text: string): string {
  return text.replace(/```[\s\S]*?```/g, ' [code] ')
}

export interface StickyAttachment {
  filename: string
}

export interface UserMessageData {
  id: string | null
  text: string
  attachments: StickyAttachment[]
}

export function getStickyUserMessagePreview(message: UserMessageData): string {
  const text = stripCodeBlocks(message.text).replace(/\s+/g, ' ').trim()
  if (text) return text
  if (message.attachments.length > 0) {
    return `${message.attachments.length} 个附件 · ${message.attachments[0]!.filename}`
  }
  return '上一条提问'
}

/** 悬浮条容器的结构分隔：上/下统一 0.45 强度，与 Workbench 结构分隔同一标准（hsl(var(--border)/0.45)），避免大窗口下显得悬空 */
export const STICKY_USER_MESSAGE_SEPARATOR_CLASS = 'border-y border-border/45'

interface StickyUserMessageProps {
  userMessages: readonly UserMessageData[]
  compact?: boolean
  hostRef: React.RefObject<HTMLDivElement>
  /** 历史结构变化签名，用于 prepend 非用户消息时刷新用户位置缓存。 */
  layoutSignature?: string
}

interface UserMessagePosition {
  id: string
  bottom: number
}

export function StickyUserMessage({
  userMessages,
  compact = false,
  hostRef,
  layoutSignature,
}: StickyUserMessageProps): React.ReactElement {
  const { scrollRef, stopScroll, state: stickyState } = useStickToBottomContext()
  const stickyEnabled = useAtomValue(stickyUserMessageEnabledAtom)

  // 当前悬浮展示的消息
  const [stickyMessage, setStickyMessage] = React.useState<UserMessageData | null>(null)
  const positionsRef = React.useRef<UserMessagePosition[]>([])

  const userMessageSignature = React.useMemo(
    () => userMessages.map((message) => message.id ?? '').join('\u0000'),
    [userMessages],
  )

  // 构建 id → data 查找表；流式 assistant 更新会重建上游数组，但用户消息未变时
  // 保持 map 引用稳定，避免重新绑定观察器和测量全部历史消息。
  const messageMap = React.useMemo(() => {
    const map = new Map<string, UserMessageData>()
    for (const msg of userMessages) {
      if (msg.id) map.set(msg.id, msg)
    }
    return map
  }, [userMessageSignature])

  React.useEffect(() => {
    const el = scrollRef.current
    if (!el || userMessages.length === 0 || !stickyEnabled) {
      positionsRef.current = []
      setStickyMessage(null)
      return
    }

    let scrollFrame: number | null = null
    let measureFrame: number | null = null
    let containerWidth = el.clientWidth

    const updateStickyMessage = (): void => {
      const scrollTop = el.scrollTop
      const positions = positionsRef.current
      let low = 0
      let high = positions.length - 1
      let match: UserMessagePosition | undefined
      while (low <= high) {
        const middle = Math.floor((low + high) / 2)
        const candidate = positions[middle]!
        if (candidate.bottom < scrollTop) {
          match = candidate
          low = middle + 1
        } else {
          high = middle - 1
        }
      }
      const found = match ? messageMap.get(match.id) ?? null : null
      setStickyMessage((previous) => previous?.id === found?.id ? previous : found)
    }

    const measurePositions = (): void => {
      const containerRect = el.getBoundingClientRect()
      const positions: UserMessagePosition[] = []
      for (const node of el.querySelectorAll<HTMLElement>('[data-message-role="user"]')) {
        const id = node.getAttribute('data-message-id')
        if (!id) continue
        const rect = node.getBoundingClientRect()
        positions.push({ id, bottom: rect.bottom - containerRect.top + el.scrollTop })
      }
      positionsRef.current = positions
      const messageElements = Array.from(el.querySelectorAll<HTMLElement>('[data-message-id]'))
      const lastUserMessageIndex = messageElements.findLastIndex(
        (message) => message.dataset.messageRole === 'user',
      )
      for (const message of messageElements.slice(0, lastUserMessageIndex + 1)) {
        resizeObserver.observe(message)
      }
      updateStickyMessage()
    }

    const scheduleMeasure = (): void => {
      if (measureFrame !== null) return
      measureFrame = requestAnimationFrame(() => {
        measureFrame = null
        measurePositions()
      })
    }
    const scheduleScrollUpdate = (): void => {
      if (scrollFrame !== null) return
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = null
        updateStickyMessage()
      })
    }

    el.addEventListener('scroll', scheduleScrollUpdate, { passive: true })
    const resizeObserver = new ResizeObserver((entries) => {
      const containerEntry = entries.find((entry) => entry.target === el)
      if (containerEntry && Math.abs(containerEntry.contentRect.width - containerWidth) >= 1) {
        containerWidth = containerEntry.contentRect.width
        scheduleMeasure()
        return
      }
      if (entries.some((entry) => entry.target !== el)) scheduleMeasure()
    })
    // 只观察滚动容器尺寸和用户消息节点：assistant 流式内容位于最后一个用户消息之后，
    // 它的高度变化不会改变已记录的用户消息位置。
    resizeObserver.observe(el)

    const messageElements = Array.from(el.querySelectorAll<HTMLElement>('[data-message-id]'))
    const lastUserMessageIndex = messageElements.findLastIndex(
      (message) => message.dataset.messageRole === 'user',
    )
    for (const message of messageElements.slice(0, lastUserMessageIndex + 1)) {
      resizeObserver.observe(message)
    }
    scheduleMeasure()

    return () => {
      if (scrollFrame !== null) cancelAnimationFrame(scrollFrame)
      if (measureFrame !== null) cancelAnimationFrame(measureFrame)
      el.removeEventListener('scroll', scheduleScrollUpdate)
      resizeObserver.disconnect()
    }
  }, [scrollRef, userMessageSignature, messageMap, layoutSignature, stickyEnabled])

  // 点击回滚到原始消息
  const scrollToOriginal = React.useCallback(() => {
    const el = scrollRef.current
    if (!el || !stickyMessage?.id) return

    const target = Array.from(el.querySelectorAll<HTMLElement>('[data-message-id]')).find(
      (node) => node.getAttribute('data-message-id') === stickyMessage.id
    )
    if (!target) return

    stopScroll()
    stickyState.animation = undefined
    stickyState.velocity = 0
    stickyState.accumulated = 0

    const containerRect = el.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    const targetScrollTop = el.scrollTop + (targetRect.top - containerRect.top)
    el.scrollTo({ top: Math.max(0, targetScrollTop - 24), behavior: 'smooth' })
  }, [scrollRef, stopScroll, stickyState, stickyMessage])

  const host = hostRef.current
  if (!stickyEnabled || stickyMessage === null || host === null) return <></>
  const preview = getStickyUserMessagePreview(stickyMessage)

  return createPortal(
    <div
      data-sticky-user-message="true"
      className={cn(
        'pointer-events-none shrink-0 bg-content-area',
        STICKY_USER_MESSAGE_SEPARATOR_CLASS,
        compact ? 'px-2 py-1' : 'px-8 py-2',
      )}
    >
      <button
        type="button"
        aria-label={`返回上一条提问：${preview}`}
        onClick={scrollToOriginal}
        className={cn(
          'pointer-events-auto w-full rounded-lg bg-card text-left text-foreground shadow-sm outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40',
          compact ? 'flex h-8 items-center gap-2 px-2.5' : 'px-3.5 py-2.5',
        )}
      >
        {compact ? (
          <>
            <ChevronUp aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="shrink-0 text-xs font-medium">返回上一条提问</span>
            <span aria-hidden="true" className="text-muted-foreground">·</span>
            <span
              className="line-clamp-1 min-w-0 text-xs text-muted-foreground"
            >
              {preview}
            </span>
          </>
        ) : (
          <>
            <span className="mb-1 flex items-center gap-2">
              <ChevronUp aria-hidden="true" className="size-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-foreground/70">返回上一条提问</span>
            </span>
            <span className="line-clamp-2 text-sm leading-relaxed text-foreground/85">
              {preview}
            </span>
          </>
        )}
      </button>
    </div>,
    host,
  )
}
