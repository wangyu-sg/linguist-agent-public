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

interface StickyUserMessageProps {
  userMessages: readonly UserMessageData[]
  compact?: boolean
  hostRef: React.RefObject<HTMLDivElement>
}

export function StickyUserMessage({
  userMessages,
  compact = false,
  hostRef,
}: StickyUserMessageProps): React.ReactElement {
  const { scrollRef, stopScroll, state: stickyState } = useStickToBottomContext()
  const stickyEnabled = useAtomValue(stickyUserMessageEnabledAtom)

  // 当前悬浮展示的消息
  const [stickyMessage, setStickyMessage] = React.useState<UserMessageData | null>(null)

  // 构建 id → data 查找表
  const messageMap = React.useMemo(() => {
    const map = new Map<string, UserMessageData>()
    for (const msg of userMessages) {
      if (msg.id) map.set(msg.id, msg)
    }
    return map
  }, [userMessages])

  React.useEffect(() => {
    const el = scrollRef.current
    if (!el || userMessages.length === 0 || !stickyEnabled) {
      setStickyMessage(null)
      return
    }

    const check = () => {
      const containerRect = el.getBoundingClientRect()
      const nodes = el.querySelectorAll<HTMLElement>('[data-message-role="user"]')

      // 从后往前找第一个完全在视口上方的用户消息节点
      let found: UserMessageData | null = null
      for (let i = nodes.length - 1; i >= 0; i--) {
        const node = nodes[i]!
        const nodeRect = node.getBoundingClientRect()
        if (nodeRect.bottom < containerRect.top) {
          // 找到了视口上方最近的用户消息
          const msgId = node.getAttribute('data-message-id')
          if (msgId) {
            found = messageMap.get(msgId) ?? null
          }
          break
        }
      }
      setStickyMessage(found)
    }

    el.addEventListener('scroll', check, { passive: true })

    // 监听容器尺寸变化
    const resizeObserver = new ResizeObserver(check)
    resizeObserver.observe(el)

    // 监听内容区域 DOM 变化（流式输出、消息加载后及时检测）
    const contentEl = el.firstElementChild as HTMLElement | null
    if (contentEl) {
      resizeObserver.observe(contentEl)
    }

    // 延迟一帧执行初始检查，确保 DOM 已完成渲染
    const rafId = requestAnimationFrame(check)

    return () => {
      el.removeEventListener('scroll', check)
      resizeObserver.disconnect()
      cancelAnimationFrame(rafId)
    }
  }, [scrollRef, userMessages, messageMap, stickyEnabled])

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
        'pointer-events-none shrink-0 border-b border-border bg-content-area',
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
