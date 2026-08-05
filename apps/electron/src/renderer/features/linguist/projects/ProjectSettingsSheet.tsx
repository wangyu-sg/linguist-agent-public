import * as React from 'react'
import type { LinguistProjectInfo, LinguistProjectSummary } from '@proma/shared'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ContextDocsPanel } from './ContextDocsPanel'
import { ProjectDiagnosticsSettings } from './ProjectDiagnosticsSettings'
import { ProjectMaintenanceSettings } from './ProjectMaintenanceSettings'
import { ProjectWorkflowSettings } from './ProjectWorkflowSettings'
import { ProjectAssetsSection } from './ProjectAssetsSection'
import { ReferenceManager } from './ReferenceManager'
import { StyleGuidePanel } from './StyleGuidePanel'
import { VoiceProfilePanel } from './VoiceProfilePanel'

interface ProjectSettingsSheetProps {
  open: boolean
  project: LinguistProjectInfo
  summary: LinguistProjectSummary | null
  onOpenChange: (open: boolean) => void
  onSummaryRefresh: () => void
  onProjectArchived?: (project: LinguistProjectInfo) => void
  onProjectDeleted?: (projectId: string) => void
}

/** LF-070/071：项目设置容器与项目资源管理入口。 */
export function ProjectSettingsSheet({
  open,
  project,
  summary,
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
  onSummaryRefresh,
  onClose = () => undefined,
  onProjectArchived,
  onProjectDeleted,
}: {
  project: LinguistProjectInfo
  summary: LinguistProjectSummary | null
  onSummaryRefresh: () => void
  onClose?: () => void
  onProjectArchived?: (project: LinguistProjectInfo) => void
  onProjectDeleted?: (projectId: string) => void
}): React.ReactElement {
  return (
    <Tabs defaultValue="project" className="mt-6">
      <TabsList aria-label="项目设置分类">
        <TabsTrigger value="project">项目</TabsTrigger>
        <TabsTrigger value="resources">资源</TabsTrigger>
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
            <div>
              <dt className="text-muted-foreground">质量策略</dt>
              <dd className="mt-1 text-foreground">{project.qualityProfile}</dd>
            </div>
          </dl>
        </section>
        <ProjectWorkflowSettings project={project} onUpdated={onSummaryRefresh} />
      </TabsContent>
      <TabsContent value="resources">
        <ProjectResourceSettings
          project={project}
          summary={summary}
          onSummaryRefresh={onSummaryRefresh}
        />
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

/** 复用既有资源组件；IPC、校验与只读规则继续由各组件持有。 */
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

  return (
    <section aria-label="项目资源" className="space-y-3 py-1">
      <ProjectAssetsSection
        projectId={project.id}
        archived={archived}
        summary={summary}
        onSummaryRefresh={async () => onSummaryRefresh()}
      />
      <ReferenceManager projectId={project.id} archived={archived} />
      <StyleGuidePanel projectId={project.id} archived={archived} />
      <VoiceProfilePanel projectId={project.id} archived={archived} />
      <ContextDocsPanel projectId={project.id} archived={archived} />
    </section>
  )
}
