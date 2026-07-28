/**
 * ProjectsView — 「项目」列表与创建页（ticket PB-032；导航壳 PB-013）
 *
 * 产品 IA（计划 §9.2）：侧边栏 = 新建对话 / Chats / Projects / Recent / Settings。
 * 本票把 PB-013 的壳替换为真实页面：
 * - 读取共享项目列表资源（含已归档），加载骨架 / 错误横幅
 *   （可重试）/ 空状态（创建 CTA）三态齐全；
 * - 活跃项目按「最近」（updatedAt 降序，见 project-utils.ts）排列为卡片；
 *   段/资产计数由 linguistProjectsGetSummary 并发补拉，不阻塞列表渲染；
 * - 已归档分组默认折叠（archivedSectionCollapsedAtom），归档卡片视觉区分；
 * - 「新建项目」对话框（ProjectCreateDialog）创建成功后刷新列表；
 * - 归档经确认对话框（ConfirmDialog）→ IPC → 刷新；
 * - 卡片点击/「打开」→ 打开项目服务 → 激活一等 Localization Project Tab；
 * - 「设置」→ 复用 ProjectSettingsSheet 管理资源、健康与维护操作。
 *
 * 数据纪律（计划 §9.5）：atom 只放 UI 状态与短生命周期 IPC 缓存；项目
 * 列表由共享资源统一拉取，摘要/健康报告仍以 React state 持有当次结果，
 * 任何变更后失效缓存，绝不做客户端真源镜像。
 *
 * 布局约定与 AutomationsListView 一致：全屏取代 TabBar + TabContent，
 * 自带 titlebar-drag-region 标题区。仅由 Linguist Sidebar 的次级「管理项目」入口打开。
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai'
import { toast } from 'sonner'
import { AlertTriangle, Archive, ChevronDown, ChevronRight, FolderOpen, HardDriveDownload, Plus, RefreshCw } from 'lucide-react'
import type { LinguistProjectHealthReport } from '@proma/shared'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  archivedSectionCollapsedAtom,
  projectCreateDialogOpenAtom,
  selectedProjectIdAtom,
} from './projects-atoms'
import { ProjectCard, type ProjectSummaryState } from './ProjectCard'
import { ProjectCreateDialog } from './ProjectCreateDialog'
import { ProjectSettingsSheet } from './ProjectSettingsSheet'
import { useProjectArchive } from './ProjectArchiveAction'
import { describeLinguistIpcError, partitionProjectsByArchived } from './project-utils'
import { MigrationWizard } from '../migration/MigrationWizard'
import { openLocalizationProject } from './open-localization-project'
import {
  linguistProjectListStateAtom,
  refreshLinguistProjectListAtom,
} from './project-list-atoms'

async function loadProjectSummary(projectId: string): Promise<ProjectSummaryState> {
  try {
    const result = await window.electronAPI.linguistProjectsGetSummary({ projectId })
    return result.ok
      ? { status: 'ready', summary: result.data }
      : { status: 'error' }
  } catch {
    return { status: 'error' }
  }
}

async function loadProjectHealth(projectId: string): Promise<LinguistProjectHealthReport | undefined> {
  try {
    const result = await window.electronAPI.linguistProjectsOpen({ projectId })
    return result.ok ? result.data.health : undefined
  } catch {
    return undefined
  }
}

export function ProjectsView(): React.ReactElement {
  const listState = useAtomValue(linguistProjectListStateAtom)
  const refreshProjectList = useSetAtom(refreshLinguistProjectListAtom)
  const [summaries, setSummaries] = React.useState<Record<string, ProjectSummaryState>>({})
  const [healthById, setHealthById] = React.useState<Record<string, LinguistProjectHealthReport>>({})
  const setCreateDialogOpen = useSetAtom(projectCreateDialogOpenAtom)
  const store = useStore()
  const [settingsProjectId, setSettingsProjectId] = useAtom(selectedProjectIdAtom)
  const [archivedCollapsed, setArchivedCollapsed] = useAtom(archivedSectionCollapsedAtom)
  /** PB-094：迁移向导仍是项目管理首页内的临时整页流程。 */
  const [migrationWizardOpen, setMigrationWizardOpen] = React.useState(false)

  const loadProjects = React.useCallback((): void => {
    refreshProjectList()
  }, [refreshProjectList])

  const { requestArchive, archiveDialog } = useProjectArchive({
    onArchived: (project) => {
      if (settingsProjectId === project.id) setSettingsProjectId(null)
      loadProjects()
    },
  })

  // 列表就绪后并发补拉各项目摘要（廉价 COUNT/GROUP BY；失败单独降级为
  // 「计数不可用」，不影响卡片其余信息）。列表变化时整批重来。
  React.useEffect(() => {
    if (listState.status !== 'ready') return
    const projects = listState.projects
    let cancelled = false
    setSummaries(
      Object.fromEntries(projects.map((p) => [p.id, { status: 'loading' as const }])),
    )
    setHealthById({})
    for (const project of projects) {
      void Promise.all([loadProjectSummary(project.id), loadProjectHealth(project.id)])
        .then(([summaryState, health]) => {
          if (cancelled) return
          setSummaries((prev) => ({
            ...prev,
            [project.id]: summaryState,
          }))
          if (health !== undefined) {
            setHealthById((previous) => ({ ...previous, [project.id]: health }))
          }
        })
    }
    return () => {
      cancelled = true
    }
  }, [listState])

  const refreshProjectCardState = React.useCallback((projectId: string): void => {
    setSummaries((previous) => ({
      ...previous,
      [projectId]: { status: 'loading' },
    }))
    void Promise.all([loadProjectSummary(projectId), loadProjectHealth(projectId)])
      .then(([summaryState, health]) => {
        setSummaries((previous) => ({
          ...previous,
          [projectId]: summaryState,
        }))
        if (health !== undefined) {
          setHealthById((previous) => ({ ...previous, [projectId]: health }))
        }
      })
  }, [])

  const handleOpenProject = React.useCallback((projectId: string): void => {
    void openLocalizationProject(store, projectId)
      .then((result) => {
        if (!result.ok) {
          toast.error('打开项目失败', {
            description: describeLinguistIpcError(result.error),
          })
        }
      })
      .catch(() => {
        toast.error('打开项目失败', {
          description: '与主进程通信异常（INTERNAL）',
        })
      })
  }, [store])

  // ===== 迁移向导（PB-094：整页切换，关闭时有导入则刷新列表） =====
  if (migrationWizardOpen) {
    return (
      <MigrationWizard
        onExit={(dirty) => {
          setMigrationWizardOpen(false)
          if (dirty) void loadProjects()
        }}
      />
    )
  }

  // ===== 管理首页 =====
  const readyProjects = listState.status === 'ready' ? listState.projects : []
  const { active, archived } = partitionProjectsByArchived(readyProjects)
  const settingsProject = readyProjects.find((project) => project.id === settingsProjectId)
  const settingsSummaryState = settingsProject === undefined
    ? undefined
    : summaries[settingsProject.id]

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 标题栏（与 AutomationsListView 同结构） */}
      <div className="titlebar-drag-region flex items-center justify-between max-w-5xl w-full mx-auto px-8 pt-8 pb-6 flex-shrink-0">
        <h1 className="text-2xl font-semibold text-foreground">项目</h1>
        {/* 空列表（连归档也没有）时隐藏右上角按钮，避免与空状态中心 CTA 重复；
            仅剩归档项目时保留入口。PB-094：「迁移向导」次级入口同行 */}
        {listState.status === 'ready' && readyProjects.length > 0 && (
          <div className="titlebar-no-drag flex items-center gap-2">
            <button
              type="button"
              aria-label="迁移向导"
              onClick={() => setMigrationWizardOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium text-foreground/70 border border-border/60 hover:bg-foreground/[0.06] hover:text-foreground transition-colors duration-100"
            >
              <HardDriveDownload size={14} />
              <span>迁移向导</span>
            </button>
            <button
              type="button"
              aria-label="新建项目"
              onClick={() => setCreateDialogOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors duration-100 shadow-sm"
            >
              <Plus size={14} />
              <span>新建项目</span>
            </button>
          </div>
        )}
      </div>

      {/* 内容区：骨架 / 错误横幅 / 空状态 / 列表 */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {listState.status === 'loading' && <ListSkeleton />}
        {listState.status === 'error' && (
          <ListErrorBanner message={listState.message} onRetry={() => void loadProjects()} />
        )}
        {listState.status === 'ready' && readyProjects.length === 0 && (
          <EmptyState onCreate={() => setCreateDialogOpen(true)} onMigrate={() => setMigrationWizardOpen(true)} />
        )}
        {listState.status === 'ready' && readyProjects.length > 0 && (
          <div className="flex flex-col gap-6 max-w-5xl w-full mx-auto px-8 pb-8">
            {active.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="text-[13px] font-medium text-foreground/65 px-1">最近项目</div>
                <div className="flex flex-col gap-2">
                  {active.map((project) => (
                    <ProjectCard
                      key={project.id}
                      project={project}
                      summaryState={summaries[project.id]}
                      health={healthById[project.id]}
                      onOpen={handleOpenProject}
                      onSettings={setSettingsProjectId}
                      onArchive={requestArchive}
                    />
                  ))}
                </div>
              </div>
            )}
            {archived.length > 0 && (
              <Collapsible open={!archivedCollapsed} onOpenChange={(open) => setArchivedCollapsed(!open)}>
                <CollapsibleTrigger
                  className="flex items-center gap-1.5 px-1 text-[13px] font-medium text-foreground/55 hover:text-foreground/80 transition-colors duration-100"
                  aria-label={archivedCollapsed ? '展开已归档项目' : '收起已归档项目'}
                >
                  {archivedCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  <Archive size={13} />
                  已归档（{archived.length}）
                </CollapsibleTrigger>
                <CollapsibleContent className="flex flex-col gap-2 mt-2">
                  {archived.map((project) => (
                    <ProjectCard
                      key={project.id}
                      project={project}
                      summaryState={summaries[project.id]}
                      health={healthById[project.id]}
                      onOpen={handleOpenProject}
                      onSettings={setSettingsProjectId}
                      onArchive={requestArchive}
                    />
                  ))}
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        )}
      </div>

      {/* 新建项目对话框（草稿/开合由 atom 持有） */}
      <ProjectCreateDialog onCreated={() => void loadProjects()} />

      {settingsProject !== undefined && (
        <ProjectSettingsSheet
          open
          project={settingsProject}
          summary={settingsSummaryState?.status === 'ready' ? settingsSummaryState.summary : null}
          onOpenChange={(open) => {
            if (!open) setSettingsProjectId(null)
          }}
          onSummaryRefresh={() => refreshProjectCardState(settingsProject.id)}
          onProjectArchived={() => {
            setSettingsProjectId(null)
            loadProjects()
          }}
          onProjectDeleted={() => {
            setSettingsProjectId(null)
            loadProjects()
          }}
        />
      )}

      {archiveDialog}
    </div>
  )
}

/** 列表加载骨架（与卡片同形，避免就绪后跳动） */
function ListSkeleton(): React.ReactElement {
  return (
    <div
      aria-label="项目列表加载中"
      className="flex flex-col gap-6 max-w-5xl w-full mx-auto px-8 pb-8"
    >
      <div className="flex flex-col gap-2">
        <div className="h-4 w-16 rounded bg-foreground/[0.06] animate-pulse" />
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="rounded-xl border border-border/50 bg-content-area px-4 py-3 flex flex-col gap-2"
          >
            <div className="h-4 w-40 rounded bg-foreground/[0.07] animate-pulse" />
            <div className="h-3 w-56 rounded bg-foreground/[0.05] animate-pulse" />
            <div className="h-3 w-64 rounded bg-foreground/[0.05] animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** 列表拉取失败横幅：role="alert" + 重试 */
function ListErrorBanner({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}): React.ReactElement {
  return (
    <div className="max-w-5xl w-full mx-auto px-8 pt-2">
      <div
        role="alert"
        className="rounded-xl border border-destructive/30 bg-destructive/[0.06] px-4 py-3 flex items-center gap-3"
      >
        <AlertTriangle size={16} className="flex-shrink-0 text-destructive" />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium text-foreground/85">项目列表加载失败</p>
          <p className="text-[12px] text-foreground/55">{message}</p>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium text-foreground/70 hover:bg-foreground/[0.07] hover:text-foreground transition-colors duration-100"
        >
          <RefreshCw size={12} />
          <span>重试</span>
        </button>
      </div>
    </div>
  )
}

/** 空状态：真实创建 CTA（不再是「即将推出」占位）+ PB-094 迁移向导第二入口 */
function EmptyState({
  onCreate,
  onMigrate,
}: {
  onCreate: () => void
  onMigrate: () => void
}): React.ReactElement {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 px-8 pb-16 text-center">
      <div className="size-14 flex items-center justify-center rounded-2xl bg-foreground/[0.05] text-foreground/35">
        <FolderOpen size={26} />
      </div>
      <p className="text-[15px] font-medium text-foreground/70">还没有项目</p>
      <p className="max-w-md text-[13px] leading-relaxed text-foreground/45">
        项目用于组织翻译与本地化工作：创建项目后可导入 XLIFF / CSV / JSON 翻译资产，
        并在项目内进行对话、CAT、质检与产物管理。
      </p>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={onCreate}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors duration-100 shadow-sm"
        >
          <Plus size={14} />
          <span>新建项目</span>
        </button>
        <button
          type="button"
          onClick={onMigrate}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium text-foreground/70 border border-border/60 hover:bg-foreground/[0.06] hover:text-foreground transition-colors duration-100"
        >
          <HardDriveDownload size={14} />
          <span>从旧版迁移</span>
        </button>
      </div>
    </div>
  )
}
