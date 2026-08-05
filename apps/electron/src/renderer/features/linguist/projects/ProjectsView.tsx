/**
 * Linguist 未打开项目时的轻量起始页。
 *
 * 项目列表与全部管理动作只保留在左侧共享树；这里不再维护第二套项目卡片。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { FolderOpen, HardDriveDownload, Plus, RefreshCw } from 'lucide-react'
import { settingsOpenAtom, settingsTabAtom } from '@/atoms/settings-tab'
import { projectCreateDialogOpenAtom } from './projects-atoms'
import {
  linguistProjectListStateAtom,
  refreshLinguistProjectListAtom,
} from './project-list-atoms'

export function ProjectsView(): React.ReactElement {
  const listState = useAtomValue(linguistProjectListStateAtom)
  const refreshProjects = useSetAtom(refreshLinguistProjectListAtom)
  const setCreateDialogOpen = useSetAtom(projectCreateDialogOpenAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const setSettingsTab = useSetAtom(settingsTabAtom)

  const openMigrationSettings = React.useCallback((): void => {
    setSettingsTab('migration')
    setSettingsOpen(true)
  }, [setSettingsOpen, setSettingsTab])

  const activeCount = listState.status === 'ready'
    ? listState.projects.filter((project) => project.archivedAt === undefined).length
    : 0

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="titlebar-drag-region mx-auto flex w-full max-w-3xl items-center px-8 pb-6 pt-8">
        <h1 className="text-2xl font-semibold text-foreground">Linguist 项目</h1>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center px-8 pb-16">
        {listState.status === 'loading' && (
          <p className="text-sm text-muted-foreground">正在加载项目…</p>
        )}
        {listState.status === 'error' && (
          <div role="alert" className="flex flex-col items-center gap-3 text-center">
            <p className="text-sm font-medium text-foreground">项目列表加载失败</p>
            <p className="max-w-md text-xs text-muted-foreground">{listState.message}</p>
            <button
              type="button"
              onClick={() => refreshProjects()}
              className="titlebar-no-drag inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
            >
              <RefreshCw size={14} />
              重试
            </button>
          </div>
        )}
        {listState.status === 'ready' && (
          <div className="flex max-w-md flex-col items-center gap-3 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-foreground/[0.05] text-foreground/35">
              <FolderOpen size={26} />
            </div>
            <p className="text-[15px] font-medium text-foreground/75">
              {activeCount === 0 ? '还没有活跃项目' : '从左侧栏选择项目'}
            </p>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              {activeCount === 0
                ? '创建项目后，可在同一棵项目与会话树中进入 Workbench 或项目 Agent。'
                : '项目名称打开 Workbench，会话名称打开该项目的完整 Agent。'}
            </p>
            <div className="titlebar-no-drag mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCreateDialogOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Plus size={14} />
                新建项目
              </button>
              <button
                type="button"
                onClick={openMigrationSettings}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[13px] font-medium text-foreground/70 hover:bg-muted"
              >
                <HardDriveDownload size={14} />
                数据迁移
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
