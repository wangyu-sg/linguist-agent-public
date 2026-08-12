import * as React from 'react'
import { RefreshCw } from 'lucide-react'
import type { LinguistProjectInfo, LinguistProjectSummary } from '@proma/shared'
import { toast } from 'sonner'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { ContextDocsPanel } from './ContextDocsPanel'
import { ProjectAgentCapabilitiesSection } from './ProjectAgentCapabilitiesSection'
import { ProjectDiagnosticsSettings } from './ProjectDiagnosticsSettings'
import { ProjectMaintenanceSettings } from './ProjectMaintenanceSettings'
import { ProjectWorkflowSettings } from './ProjectWorkflowSettings'
import { ProjectAssetsSection } from './ProjectAssetsSection'
import { ReferenceManager } from './ReferenceManager'
import { StyleGuidePanel } from './StyleGuidePanel'
import { TagProfilesPanel } from './TagProfilesPanel'
import { VoiceProfilePanel } from './VoiceProfilePanel'
import { ProjectLocaleSelect } from './ProjectLocaleSelect'
import type { LinguistProjectSettingsTab } from './cat-workspace-atoms'
import {
  describeLinguistIpcError,
  validateLocaleInput,
} from './project-utils'

interface ProjectSettingsSheetProps {
  open: boolean
  project: LinguistProjectInfo
  summary: LinguistProjectSummary | null
  /** 「查看」类入口直达的分类；未指定时打开默认「项目」分类。 */
  initialTab?: LinguistProjectSettingsTab
  onOpenChange: (open: boolean) => void
  onSummaryRefresh: () => void
  onProjectArchived?: (project: LinguistProjectInfo) => void
  onProjectDeleted?: (projectId: string) => void
}

/** LF-070/071：项目设置容器与项目批次/语言资产管理入口。 */
export function ProjectSettingsSheet({
  open,
  project,
  summary,
  initialTab,
  onOpenChange,
  onSummaryRefresh,
  onProjectArchived,
  onProjectDeleted,
}: ProjectSettingsSheetProps): React.ReactElement {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[560px] sm:max-w-[560px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>项目设置</SheetTitle>
          <SheetDescription>{project.name} · {project.sourceLocale} → {project.targetLocale}</SheetDescription>
        </SheetHeader>
        <ProjectSettingsSheetBody
          project={project}
          summary={summary}
          initialTab={initialTab}
          onSummaryRefresh={onSummaryRefresh}
          onClose={() => onOpenChange(false)}
          onProjectArchived={onProjectArchived}
          onProjectDeleted={onProjectDeleted}
        />
      </SheetContent>
    </Sheet>
  )
}

export function ProjectSettingsSheetBody({
  project,
  summary,
  initialTab,
  onSummaryRefresh,
  onClose = () => undefined,
  onProjectArchived,
  onProjectDeleted,
}: {
  project: LinguistProjectInfo
  summary: LinguistProjectSummary | null
  initialTab?: LinguistProjectSettingsTab
  onSummaryRefresh: () => void
  onClose?: () => void
  onProjectArchived?: (project: LinguistProjectInfo) => void
  onProjectDeleted?: (projectId: string) => void
}): React.ReactElement {
  const startTab = initialTab ?? 'project'
  return (
    // key 随直达分类变化重挂载 Tabs，让 defaultValue 生效；打开后用户手动切换不受影响。
    <Tabs key={startTab} defaultValue={startTab} className="mt-6">
      <TabsList aria-label="项目设置分类">
        <TabsTrigger value="project">项目</TabsTrigger>
        <TabsTrigger value="resources">语言资产</TabsTrigger>
        <TabsTrigger value="tags">Tag Profiles</TabsTrigger>
        <TabsTrigger value="maintenance">维护</TabsTrigger>
        <TabsTrigger value="diagnostics">诊断</TabsTrigger>
      </TabsList>
      <TabsContent value="project">
        <section aria-label="项目元信息" className="rounded-xl bg-muted/50 p-4 shadow-sm">
          <dl className="grid gap-3 text-sm">
            <div>
              <dt className="text-muted-foreground">项目名称</dt>
              <dd className="mt-1 font-medium text-foreground">{project.name}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">语言方向</dt>
              <dd className="mt-1 font-mono text-foreground">{project.sourceLocale} → {project.targetLocale}</dd>
            </div>
          </dl>
        </section>
        <ProjectLocaleSettings
          project={project}
          hasBatches={(summary?.assetCount ?? 0) > 0}
          onUpdated={onSummaryRefresh}
        />
        <ProjectWorkflowSettings project={project} onUpdated={onSummaryRefresh} />
        <ProjectAgentCapabilitiesSection project={project} onNavigate={onClose} />
      </TabsContent>
      <TabsContent value="resources">
        <ProjectResourceSettings
          project={project}
          summary={summary}
          onSummaryRefresh={onSummaryRefresh}
        />
      </TabsContent>
      <TabsContent value="tags">
        <TagProfilesPanel project={project} onUpdated={onSummaryRefresh} />
      </TabsContent>
      <TabsContent value="maintenance">
        <ProjectMaintenanceSettings
          project={project}
          onSummaryRefresh={onSummaryRefresh}
          onClose={onClose}
          onProjectArchived={onProjectArchived}
          onProjectDeleted={onProjectDeleted}
        />
      </TabsContent>
      <TabsContent value="diagnostics">
        <ProjectDiagnosticsSettings key={project.id} projectId={project.id} />
      </TabsContent>
    </Tabs>
  )
}

export function ProjectLocaleSettings({
  project,
  hasBatches,
  onUpdated,
}: {
  project: LinguistProjectInfo
  hasBatches: boolean
  onUpdated: () => void
}): React.ReactElement {
  const [sourceLocale, setSourceLocale] = React.useState(project.sourceLocale)
  const [targetLocale, setTargetLocale] = React.useState(project.targetLocale)
  const [saving, setSaving] = React.useState(false)
  const sourceError = validateLocaleInput(sourceLocale, '源语言')
  const targetError = validateLocaleInput(targetLocale, '目标语言')
  const frozen = project.archivedAt !== undefined || hasBatches
  const unchanged = sourceLocale.trim() === project.sourceLocale && targetLocale.trim() === project.targetLocale

  React.useEffect(() => {
    setSourceLocale(project.sourceLocale)
    setTargetLocale(project.targetLocale)
  }, [project])

  const save = async (): Promise<void> => {
    if (saving || frozen || sourceError !== null || targetError !== null || unchanged) return
    setSaving(true)
    try {
      const result = await window.electronAPI.linguistProjectsSetLocales({
        projectId: project.id,
        sourceLocale: sourceLocale.trim(),
        targetLocale: targetLocale.trim(),
      })
      if (!result.ok) {
        toast.error('语言方向保存失败', { description: describeLinguistIpcError(result.error) })
        return
      }
      toast.success(`语言方向已设为 ${result.data.sourceLocale} → ${result.data.targetLocale}`)
      onUpdated()
    } catch {
      toast.error('语言方向保存失败', { description: '与主进程通信异常（INTERNAL）' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section aria-labelledby="project-locale-heading" className="mt-3 rounded-xl bg-muted/50 p-4 shadow-sm">
      <h3 id="project-locale-heading" className="text-sm font-medium text-foreground">语言方向</h3>
      <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
        {hasBatches
          ? '已有批次，语言方向已冻结；如需其他语言对，请新建项目。'
          : '导入首个批次或 TM/TB 后，语言方向将冻结以避免数据不一致。'}
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="project-source-locale">源语言</Label>
          <ProjectLocaleSelect
            id="project-source-locale"
            value={sourceLocale}
            disabled={saving || frozen}
            onValueChange={setSourceLocale}
            invalid={sourceError !== null}
          />
          {sourceError !== null && <p className="text-xs text-destructive">{sourceError}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="project-target-locale">目标语言</Label>
          <ProjectLocaleSelect
            id="project-target-locale"
            value={targetLocale}
            disabled={saving || frozen}
            onValueChange={setTargetLocale}
            invalid={targetError !== null}
          />
          {targetError !== null && <p className="text-xs text-destructive">{targetError}</p>}
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <Button
          type="button"
          size="sm"
          disabled={saving || frozen || sourceError !== null || targetError !== null || unchanged}
          onClick={() => { void save() }}
        >
          {saving ? '保存中…' : '保存语言方向'}
        </Button>
      </div>
    </section>
  )
}

/** 复用既有批次与语言资产管理组件；IPC、校验与只读规则继续由各组件持有。 */
export function ProjectResourceSettings({
  project,
  summary,
  onSummaryRefresh,
}: {
  project: LinguistProjectInfo
  summary: LinguistProjectSummary | null
  onSummaryRefresh: () => void
}): React.ReactElement {
  const archived = project.archivedAt !== undefined
  const [resourceRefreshToken, setResourceRefreshToken] = React.useState(0)

  return (
    <section aria-label="项目语言资产" className="space-y-3 py-1">
      <ProjectAssetsSection
        projectId={project.id}
        archived={archived}
        summary={summary}
        onSummaryRefresh={async () => onSummaryRefresh()}
        onResourcesChanged={() => setResourceRefreshToken((current) => current + 1)}
      />
      <div className="flex items-center justify-between px-1">
        <span className="text-[13px] font-medium text-foreground/55">语言资产</span>
        <button
          type="button"
          aria-label="刷新语言资产"
          title="刷新语言资产"
          onClick={() => setResourceRefreshToken((current) => current + 1)}
          className="inline-flex size-8 items-center justify-center rounded-md text-foreground/55 hover:bg-foreground/[0.07]"
        >
          <RefreshCw size={13} />
        </button>
      </div>
      <React.Fragment key={resourceRefreshToken}>
        <ReferenceManager projectId={project.id} archived={archived} />
        <StyleGuidePanel projectId={project.id} archived={archived} />
        <VoiceProfilePanel projectId={project.id} archived={archived} />
        <ContextDocsPanel projectId={project.id} archived={archived} />
      </React.Fragment>
    </section>
  )
}
