import { X } from 'lucide-react'

export interface ComposerContextChip {
  id: string
  label: string
  scope: string
  onRemove?: () => void
}

export interface ComposerContextChipsProps {
  chips: readonly ComposerContextChip[]
}

export function ComposerContextChips({
  chips,
}: ComposerContextChipsProps): React.ReactElement | null {
  if (chips.length === 0) return null

  const summary = chips.length === 1
    ? chips[0]!.label
    : `${chips[0]!.label} · 另 ${chips.length - 1} 项`

  return (
    <div
      role="group"
      aria-label="当前 Linguist 上下文"
      className="composer-context-chips px-3 pb-1.5 pt-2.5"
      data-composer-context-chips
    >
      <div role="list" className="composer-context-chip-list flex min-w-0 flex-wrap gap-1.5">
        {chips.map((chip) => (
          <span
            key={chip.id}
            role="listitem"
            title={chip.scope}
            className="inline-flex h-6 max-w-full items-center gap-1 rounded-full bg-primary/10 px-2 text-xs font-medium text-primary shadow-sm"
          >
            <span className="truncate">{chip.label}</span>
            {chip.onRemove && (
              <button
                type="button"
                aria-label={`清除${chip.label}上下文`}
                onClick={chip.onRemove}
                className="-mr-1 inline-flex size-5 shrink-0 items-center justify-center rounded-full text-primary/65 transition-colors hover:bg-primary/15 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                <X aria-hidden="true" className="size-3" />
              </button>
            )}
          </span>
        ))}
      </div>
      <span
        title={chips.map((chip) => `${chip.label}：${chip.scope}`).join('\n')}
        aria-label={summary}
        data-context-chip-summary="true"
        className="composer-context-chip-summary h-6 max-w-full items-center truncate rounded-full bg-primary/10 px-2 text-xs font-medium text-primary shadow-sm"
      >
        {summary}
      </span>
    </div>
  )
}
