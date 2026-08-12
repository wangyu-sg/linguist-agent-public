/**
 * ProjectCreateDialog — 「新建项目」对话框（ticket PB-032）
 *
 * 字段：名称 / 源语言 / 目标语言（两个 locale 字段复用常用语言下拉，
 * 客户端校验仍镜像主进程 IPC；名称 trim 非空、≤120 字符——见 project-utils.ts）。
 *
 * 提交路径：客户端预校验 → linguistProjectsCreate → 成功：toast + 重置草稿 +
 * 关闭 + 通知父级刷新列表；失败：信封错误码映射为中文文案显示在对话框内
 * （不关闭，允许修正后重试）。主进程仍是唯一权威校验方（计划 §7.4）。
 *
 * a11y：Radix Dialog 负责焦点圈定与 Esc 关闭；每个输入配 label +
 * aria-invalid/aria-describedby 错误文本；表单级错误 role="alert"。
 */

import * as React from 'react'
import { useAtom } from 'jotai'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import type { LinguistProjectInfo } from '@proma/shared'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DEFAULT_PROJECT_CREATE_DRAFT,
  projectCreateDialogOpenAtom,
  projectCreateDraftAtom,
} from './projects-atoms'
import { ProjectLocaleSelect } from './ProjectLocaleSelect'
import { describeLinguistIpcError, validateLocaleInput, validateProjectNameInput } from './project-utils'

/** 表单校验错误：逐字段 + 表单级（IPC 信封错误落这里） */
interface FormErrors {
  name?: string
  sourceLocale?: string
  targetLocale?: string
  form?: string
}

interface ProjectCreateDialogProps {
  /** 创建成功后调用；调用方立即打开权威返回的项目。 */
  onCreated: (project: LinguistProjectInfo) => void
}

export function ProjectCreateDialog({ onCreated }: ProjectCreateDialogProps): React.ReactElement {
  const [open, setOpen] = useAtom(projectCreateDialogOpenAtom)
  const [draft, setDraft] = useAtom(projectCreateDraftAtom)
  const [errors, setErrors] = React.useState<FormErrors>({})
  const [submitting, setSubmitting] = React.useState(false)

  /** 更新单个字段；该字段已有错误时即时复验（给出正在修正的反馈） */
  const updateField = (field: 'name' | 'sourceLocale' | 'targetLocale', value: string): void => {
    setDraft((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => {
      if (prev[field] === undefined && prev.form === undefined) return prev
      const next = { ...prev, form: undefined }
      if (prev[field] !== undefined) {
        const message =
          field === 'name'
            ? validateProjectNameInput(value)
            : validateLocaleInput(value, field === 'sourceLocale' ? '源语言' : '目标语言')
        next[field] = message ?? undefined
      }
      return next
    })
  }

  const validateAll = (): boolean => {
    const next: FormErrors = {
      name: validateProjectNameInput(draft.name) ?? undefined,
      sourceLocale: validateLocaleInput(draft.sourceLocale, '源语言') ?? undefined,
      targetLocale: validateLocaleInput(draft.targetLocale, '目标语言') ?? undefined,
    }
    setErrors(next)
    return next.name === undefined && next.sourceLocale === undefined && next.targetLocale === undefined
  }

  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (submitting) return
    if (!validateAll()) return
    setSubmitting(true)
    try {
      const result = await window.electronAPI.linguistProjectsCreate({
        name: draft.name.trim(),
        sourceLocale: draft.sourceLocale.trim(),
        targetLocale: draft.targetLocale.trim(),
        workflowStage: draft.workflowStage,
        qaProfile: draft.qaProfile,
      })
      if (result.ok) {
        toast.success(`项目「${result.data.name}」已创建`, {
          description: `${result.data.sourceLocale} → ${result.data.targetLocale}`,
        })
        setDraft(DEFAULT_PROJECT_CREATE_DRAFT)
        setErrors({})
        setOpen(false)
        onCreated(result.data)
      } else {
        setErrors({ form: describeLinguistIpcError(result.error) })
      }
    } catch {
      // preload invoke 自身被拒绝（非信封）的兜底，按 INTERNAL 呈现
      setErrors({ form: '创建失败：与主进程通信异常（INTERNAL）' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!submitting) setOpen(next) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建项目</DialogTitle>
          <DialogDescription>
            项目用于组织翻译与本地化工作。创建后可导入 XLIFF / CSV / JSON 等批次文件。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { void handleSubmit(e) }} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project-create-name">项目名称</Label>
            <Input
              id="project-create-name"
              value={draft.name}
              onChange={(e) => updateField('name', e.target.value)}
              placeholder="例如：官网本地化 2026Q3"
              maxLength={140}
              disabled={submitting}
              aria-invalid={errors.name !== undefined}
              aria-describedby={errors.name !== undefined ? 'project-create-name-error' : undefined}
            />
            {errors.name !== undefined && (
              <p id="project-create-name-error" className="text-[12px] text-destructive">
                {errors.name}
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="project-create-source">源语言</Label>
              <ProjectLocaleSelect
                id="project-create-source"
                value={draft.sourceLocale}
                onValueChange={(value) => updateField('sourceLocale', value)}
                disabled={submitting}
                invalid={errors.sourceLocale !== undefined}
                describedBy={errors.sourceLocale !== undefined ? 'project-create-source-error' : undefined}
              />
              {errors.sourceLocale !== undefined && (
                <p id="project-create-source-error" className="text-[12px] text-destructive">
                  {errors.sourceLocale}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="project-create-target">目标语言</Label>
              <ProjectLocaleSelect
                id="project-create-target"
                value={draft.targetLocale}
                onValueChange={(value) => updateField('targetLocale', value)}
                disabled={submitting}
                invalid={errors.targetLocale !== undefined}
                describedBy={errors.targetLocale !== undefined ? 'project-create-target-error' : undefined}
              />
              {errors.targetLocale !== undefined && (
                <p id="project-create-target-error" className="text-[12px] text-destructive">
                  {errors.targetLocale}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project-create-workflow-stage">当前任务阶段</Label>
            <Select
              value={draft.workflowStage}
              onValueChange={(workflowStage: 'translation' | 'editing' | 'proofreading') =>
                setDraft((current) => ({ ...current, workflowStage }))}
              disabled={submitting}
            >
              <SelectTrigger id="project-create-workflow-stage">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="translation">T · 翻译</SelectItem>
                <SelectItem value="editing">E · 编辑 / 审校</SelectItem>
                <SelectItem value="proofreading">P · 校对</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              已有目标译文不会自动算作本轮完成；确认后会按此阶段写回双语文件状态。
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project-create-qa-profile">QA 场景</Label>
            <Select
              value={draft.qaProfile}
              onValueChange={(qaProfile: 'general' | 'subtitle') =>
                setDraft((current) => ({ ...current, qaProfile }))}
              disabled={submitting}
            >
              <SelectTrigger id="project-create-qa-profile">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="general">通用本地化</SelectItem>
                <SelectItem value="subtitle">字幕 / 对白</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              字幕模式只降低省略号、强调标点和长度比例噪声；数字、标签与占位符硬门不变。
            </p>
          </div>
          {errors.form !== undefined && (
            <p role="alert" className="text-[12px] leading-relaxed text-destructive">
              {errors.form}
            </p>
          )}
          <DialogFooter>
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={submitting}
              className="px-3 py-1.5 rounded-md text-[13px] font-medium text-foreground/70 hover:bg-foreground/[0.06] hover:text-foreground transition-colors duration-100 disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors duration-100 shadow-sm disabled:opacity-60"
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              <span>{submitting ? '创建中…' : '创建项目'}</span>
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
