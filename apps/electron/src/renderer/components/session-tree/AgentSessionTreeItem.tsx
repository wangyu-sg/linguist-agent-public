import * as React from 'react'
import type { AgentSessionMeta } from '@proma/shared'
import { cn } from '@/lib/utils'

export interface AgentSessionTreeItemHandle {
  startRename: () => void
}

interface AgentSessionTreeItemProps {
  session: Pick<AgentSessionMeta, 'title'>
  ariaLabel: string
  ariaCurrent?: boolean
  beforeTitle?: React.ReactNode
  afterTitle?: React.ReactNode
  actions?: React.ReactNode
  buttonClassName?: string
  inputClassName?: string
  onSelect: () => void
  onRename: (title: string) => void | Promise<void>
}

export const AgentSessionTreeItem = React.forwardRef<
  AgentSessionTreeItemHandle,
  AgentSessionTreeItemProps
>(function AgentSessionTreeItem({
  session,
  ariaLabel,
  ariaCurrent,
  beforeTitle,
  afterTitle,
  actions,
  buttonClassName,
  inputClassName,
  onSelect,
  onRename,
}, ref): React.ReactElement {
  const [editing, setEditing] = React.useState(false)
  const [title, setTitle] = React.useState(session.title)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const buttonRef = React.useRef<HTMLButtonElement>(null)
  const justStartedEditing = React.useRef(false)

  const startRename = React.useCallback((): void => {
    setTitle(session.title)
    setEditing(true)
    justStartedEditing.current = true
    setTimeout(() => {
      justStartedEditing.current = false
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 300)
  }, [session.title])

  React.useImperativeHandle(ref, () => ({ startRename }), [startRename])

  const saveRename = async (): Promise<void> => {
    if (justStartedEditing.current) return
    const nextTitle = title.trim()
    setEditing(false)
    if (nextTitle && nextTitle !== session.title) await onRename(nextTitle)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        aria-label={`重命名会话：${session.title}`}
        value={title}
        maxLength={100}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={() => { void saveRename() }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            void saveRename()
          } else if (event.key === 'Escape') {
            setEditing(false)
            requestAnimationFrame(() => buttonRef.current?.focus())
          }
        }}
        className={cn(
          'min-w-0 flex-1 border-b border-primary/50 bg-transparent outline-none',
          inputClassName,
        )}
      />
    )
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={ariaLabel}
        aria-current={ariaCurrent || undefined}
        onClick={onSelect}
        className={buttonClassName}
      >
        {beforeTitle}
        <span
          className="min-w-0 flex-1 truncate"
          onDoubleClick={(event) => {
            event.stopPropagation()
            startRename()
          }}
        >
          {session.title}
        </span>
        {afterTitle}
      </button>
      {actions}
    </>
  )
})
