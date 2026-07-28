import * as React from 'react'
import type {
  LinguistProjectInfo,
  LinguistQaProfile,
  LinguistWorkflowStage,
} from '@proma/shared'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { describeLinguistIpcError } from './project-utils'

const STAGE_LABELS: Record<LinguistWorkflowStage, string> = {
  translation: 'T · 翻译',
  editing: 'E · 编辑 / 审校',
  proofreading: 'P · 校对',
}

type SdlOutputStatus = 'default' | 'Translated' | 'ApprovedTranslation' | 'ApprovedSignOff'

export function ProjectWorkflowSettings({
  project,
  onUpdated,
}: {
  project: LinguistProjectInfo
  onUpdated: () => void
}): React.ReactElement {
  const initialStage = project.workflowStage ?? 'translation'
  const [stage, setStage] = React.useState<LinguistWorkflowStage>(initialStage)
  const [outputStatus, setOutputStatus] = React.useState<SdlOutputStatus>(
    project.outputStatusPolicy?.sdlxliff_1_2?.[initialStage] as SdlOutputStatus | undefined
      ?? 'default',
  )
  const [qaProfile, setQaProfile] = React.useState<LinguistQaProfile>(
    project.qaProfile ?? 'general',
  )
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    const nextStage = project.workflowStage ?? 'translation'
    setStage(nextStage)
    setOutputStatus(
      project.outputStatusPolicy?.sdlxliff_1_2?.[nextStage] as SdlOutputStatus | undefined
        ?? 'default',
    )
    setQaProfile(project.qaProfile ?? 'general')
  }, [project])

  const save = async (): Promise<void> => {
    if (saving || project.archivedAt !== undefined) return
    setSaving(true)
    try {
      const result = await window.electronAPI.linguistProjectsSetWorkflowConfig({
        projectId: project.id,
        workflowStage: stage,
        outputStatusPolicy: outputStatus === 'default'
          ? null
          : { sdlxliff_1_2: { [stage]: outputStatus } },
        qaProfile,
      })
      if (!result.ok) {
        toast.error('任务阶段保存失败', {
          description: describeLinguistIpcError(result.error),
        })
        return
      }
      toast.success(`当前任务阶段已设为 ${STAGE_LABELS[result.data.workflowStage ?? stage]}`)
      onUpdated()
    } catch {
      toast.error('任务阶段保存失败', { description: '与主进程通信异常（INTERNAL）' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section aria-labelledby="project-workflow-heading" className="mt-3 rounded-xl bg-muted/50 p-4 shadow-sm">
      <h3 id="project-workflow-heading" className="text-sm font-medium text-foreground">
        任务阶段与交付状态
      </h3>
      <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
        该设置决定“确认并前进”的业务含义，以及 SDLXLIFF 确认状态的写回级别。
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="project-workflow-stage">当前任务阶段</Label>
          <Select
            value={stage}
            onValueChange={(value) => setStage(value as LinguistWorkflowStage)}
            disabled={saving || project.archivedAt !== undefined}
          >
            <SelectTrigger id="project-workflow-stage">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(STAGE_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="project-sdl-output-status">SDLXLIFF 确认输出</Label>
          <Select
            value={outputStatus}
            onValueChange={(value) => setOutputStatus(value as SdlOutputStatus)}
            disabled={saving || project.archivedAt !== undefined}
          >
            <SelectTrigger id="project-sdl-output-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">随 T / E / P 阶段</SelectItem>
              <SelectItem value="Translated">Translated</SelectItem>
              <SelectItem value="ApprovedTranslation">ApprovedTranslation</SelectItem>
              <SelectItem value="ApprovedSignOff">ApprovedSignOff</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="project-qa-profile">QA 场景</Label>
          <Select
            value={qaProfile}
            onValueChange={(value) => setQaProfile(value as LinguistQaProfile)}
            disabled={saving || project.archivedAt !== undefined}
          >
            <SelectTrigger id="project-qa-profile">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="general">通用本地化</SelectItem>
              <SelectItem value="subtitle">字幕 / 对白</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <Button
          type="button"
          size="sm"
          disabled={saving || project.archivedAt !== undefined}
          onClick={() => { void save() }}
        >
          {saving ? '保存中…' : '保存任务设置'}
        </Button>
      </div>
    </section>
  )
}
