/**
 * Projects 页 UI 状态原子（ticket PB-032）
 *
 * 计划 §9.5：atom 只放 UI 状态——当前选中项目、对话框开合、表单草稿、
 * 折叠态。CAT 数据（项目列表 / 摘要 / 健康报告）永远来自主进程 IPC，
 * 不作为真源镜像进 atom；项目列表的短生命周期共享缓存见
 * project-list-atoms.ts，任何变更后统一失效重拉。
 */

import { atom } from 'jotai'
import type { LinguistQaProfile, LinguistWorkflowStage } from '@proma/shared'

/** 「新建项目」对话框开合 */
export const projectCreateDialogOpenAtom = atom<boolean>(false)

/** 创建表单草稿（对话框内可关再开不丢失；提交成功后重置为默认值） */
export interface ProjectCreateDraft {
  name: string
  sourceLocale: string
  targetLocale: string
  workflowStage: LinguistWorkflowStage
  qaProfile: LinguistQaProfile
}

/** 常用默认语言对：en → zh-CN（用户可改，仅为减少重复输入） */
export const DEFAULT_PROJECT_CREATE_DRAFT: ProjectCreateDraft = {
  name: '',
  sourceLocale: 'en',
  targetLocale: 'zh-CN',
  workflowStage: 'translation',
  qaProfile: 'general',
}

export const projectCreateDraftAtom = atom<ProjectCreateDraft>(DEFAULT_PROJECT_CREATE_DRAFT)

/** 项目管理首页当前打开设置面板的项目 id；null = 未打开 */
export const selectedProjectIdAtom = atom<string | null>(null)

/** 已归档分组折叠态（默认收起，避免干扰活跃列表） */
export const archivedSectionCollapsedAtom = atom<boolean>(true)
