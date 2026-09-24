import * as React from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { PanelLeft, Search } from 'lucide-react'
import { sidebarCollapsedAtom } from '@/atoms/tab-atoms'
import { searchDialogOpenAtom } from '@/atoms/search-atoms'
import { ShortcutKeycaps } from '@/components/shortcuts/ShortcutKeycaps'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SearchDialog } from './SearchDialog'

/** 常驻窗口层，侧栏收起时保留按钮、键盘焦点和搜索入口。 */
export function SidebarTitlebarControls({ sidebarRef }: { sidebarRef: React.RefObject<HTMLDivElement> }): React.ReactElement {
  const [collapsed, setCollapsed] = useAtom(sidebarCollapsedAtom)
  const setSearchOpen = useSetAtom(searchDialogOpenAtom)
  const toggleRef = React.useRef<HTMLButtonElement>(null)
  const label = collapsed ? '展开侧边栏' : '收起侧边栏'

  React.useLayoutEffect(() => {
    const sidebar = sidebarRef.current!
    if (collapsed && sidebar.contains(document.activeElement)) toggleRef.current!.focus()
    sidebar.inert = collapsed
  }, [collapsed, sidebarRef])

  return (
    <>
      <div className="sidebar-titlebar-controls titlebar-no-drag fixed z-[70] flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <button ref={toggleRef} type="button" aria-label={label} aria-expanded={!collapsed} aria-controls="app-left-sidebar" onClick={() => setCollapsed(previous => !previous)}>
              <PanelLeft aria-hidden="true" size={16} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom"><span className="flex items-center gap-2">{label}<ShortcutKeycaps shortcutId="toggle-sidebar" /></span></TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" aria-label="搜索" aria-haspopup="dialog" onClick={() => setSearchOpen(true)}>
              <Search aria-hidden="true" size={16} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom"><span className="flex items-center gap-2">搜索<ShortcutKeycaps shortcutId="global-search" /></span></TooltipContent>
        </Tooltip>
      </div>
      <SearchDialog />
    </>
  )
}
