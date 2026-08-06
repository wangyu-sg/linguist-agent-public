/**
 * ProjectCard — 项目卡片（ticket PB-032）
 *
 * 展示：名称、语言对、创建/更新时间、段/资产计数（摘要由父级并发拉取，
 * 未就绪时显示占位而非阻塞列表）、归档态与健康状态徽章。
 *
 * 卡片主体与操作按钮均为同级原生 button，避免 nested-interactive。
 */

import * as React from 'react'
import { AlertTriangle, Archive, ArrowRight, Loader2, Settings } from 'lucide-react'
import type {
  LinguistProjectHealthReport,
  LinguistProjectInfo,
  LinguistProjectSummary,
} from '@proma/shared'
import { cn } from '@/lib/utils'
import { formatProjectTime, summarizeFailedHealthChecks } from './project-utils'

/** 单个项目摘要的拉取状态（由 ProjectsView 并发填充，不阻塞列表渲染） */
export type ProjectSummaryState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; summary: LinguistProjectSummary }

interface ProjectCardProps {
  project: LinguistProjectInfo
  /** 摘要拉取状态；undefined 视同 loading */
  summaryState: ProjectSummaryState | undefined
  health: LinguistProjectHealthReport | undefined
  onOpen: (projectId: string) => void
  onSettings: (projectId: string) => void
  onArchive: (project: LinguistProjectInfo) => void
}

export function ProjectCard({
  project,
  summaryState,
  health,
  onOpen,
  onSettings,
  onArchive,
}: ProjectCardProps): React.ReactElement {
  const archived = project.archivedAt !== undefined
  const unhealthy = health !== undefined && !health.healthy

  return (
    <div
      className={cn(
        'w-full text-left rounded-xl border px-4 py-3 transition-colors duration-100',
        archived
          ? 'border-dashed border-border/60 bg-foreground/[0.02] hover:bg-foreground/[0.04]'
          : 'border-border/50 bg-content-area hover:bg-foreground/[0.04]',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          aria-label={`打开项目 ${project.name}`}
          onClick={() => onOpen(project.id)}
          className="flex-1 min-w-0 flex flex-col gap-1 rounded-lg text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          {/* 名称 + 状态徽章 */}
          <span className="flex items-center gap-2 min-w-0">
            <span
              className={cn(
                'text-[14px] font-medium truncate',
                archived ? 'text-foreground/60' : 'text-foreground',
              )}
            >
              {project.name}
            </span>
            {archived && (
              <span className="flex-shrink-0 inline-flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-foreground/55">
                <Archive size={11} />
                已归档
              </span>
            )}
            {unhealthy && (
              <span className="flex-shrink-0 inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] text-warning">
                <AlertTriangle size={11} aria-hidden="true" />
                需要修复
              </span>
            )}
          </span>
          {/* 语言对 + 计数 */}
          <span className="flex items-center gap-2 text-[12px] text-foreground/65">
            <span className="font-mono">
              {project.sourceLocale} → {project.targetLocale}
            </span>
            <span aria-hidden="true">·</span>
            {summaryState === undefined || summaryState.status === 'loading' ? (
              <span className="inline-flex items-center gap-1 text-foreground/65">
                <Loader2 size={11} className="animate-spin" />
                计数加载中…
              </span>
            ) : summaryState.status === 'error' ? (
              <span className="text-foreground/65">计数不可用</span>
            ) : (
              <span>
                {summaryState.summary.totalSegments} 段 · {summaryState.summary.assetCount} 批次
              </span>
            )}
          </span>
          {unhealthy && (
            <span className="text-[12px] text-warning">
              失败检查：{summarizeFailedHealthChecks(health)}
            </span>
          )}
          {/* 时间行 */}
          <span className="text-[12px] text-foreground/65">
            更新于 {formatProjectTime(project.updatedAt)} · 创建于 {formatProjectTime(project.createdAt)}
            {archived && project.archivedAt !== undefined && ` · 归档于 ${formatProjectTime(project.archivedAt)}`}
          </span>
        </button>
        {/* 操作按钮：常显（非 hover-only），键盘可达 */}
        <div className="flex-shrink-0 flex items-center gap-1.5 pt-0.5">
          <button
            type="button"
            aria-label={`打开 ${project.name}`}
            onClick={() => onOpen(project.id)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] font-medium text-foreground/70 hover:bg-foreground/[0.07] hover:text-foreground transition-colors duration-100"
          >
            <span>打开</span>
            <ArrowRight size={12} />
          </button>
          <button
            type="button"
            aria-label={`设置 ${project.name}`}
            onClick={() => onSettings(project.id)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] font-medium text-foreground/60 hover:bg-foreground/[0.07] hover:text-foreground transition-colors duration-100"
          >
            <Settings size={12} />
            <span>设置</span>
          </button>
          {!archived && (
            <button
              type="button"
              aria-label={`归档 ${project.name}`}
              onClick={() => onArchive(project)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] font-medium text-foreground/65 hover:bg-foreground/[0.07] hover:text-foreground transition-colors duration-100"
            >
              <Archive size={12} />
              <span>归档</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
