/**
 * K5：格式内部验证与平台资格两层展示。
 *
 * 数据来自主进程随应用发布的全局只读合同（linguist.projects.listFormatQualifications，
 * 不接收项目路径）。只区分两层事实：
 * - LA 内部验证：发布树自动化 import/export/round-trip 覆盖结果（通过 / 失败）；
 * - 平台资格：真实文件 / 平台回传 / 原生目标证据（未取得证据前一律「未验证」）。
 * 未验证不等于不兼容；不把内部验证显示成平台兼容。
 */

import * as React from 'react'
import type {
  LinguistFormatPlatformQualification,
  LinguistFormatQualification,
} from '@proma/shared'
import { describeLinguistFormat } from './format-labels'
import { describeLinguistIpcError } from './project-utils'

export const PLATFORM_QUALIFICATION_LABELS: Record<LinguistFormatPlatformQualification, string> = {
  unverified: '未验证',
  real_file_passed: '真实文件通过',
  platform_roundtrip_passed: '平台回传通过',
  native_target_passed: '原生目标通过',
}

export function describePlatformQualification(value: LinguistFormatPlatformQualification): string {
  return PLATFORM_QUALIFICATION_LABELS[value]
}

type QualificationState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: LinguistFormatQualification[] }

export function FormatQualificationCard(): React.ReactElement {
  const [state, setState] = React.useState<QualificationState>({ status: 'loading' })

  React.useEffect(() => {
    let cancelled = false
    window.electronAPI.linguistProjectsListFormatQualifications()
      .then((result) => {
        if (cancelled) return
        setState(result.ok
          ? { status: 'ready', items: result.data }
          : { status: 'error', message: describeLinguistIpcError(result.error) })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', message: '与主进程通信异常（INTERNAL）' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <section aria-label="格式验证与平台资格" className="rounded-xl bg-muted/50 p-4 shadow-sm">
      <h3 className="text-sm font-medium text-foreground">格式验证与平台资格</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        「LA 内部验证」是发布树的自动化导入/导出覆盖结果；「平台资格」需要真实文件、
        平台回传或原生目标证据，未验证不代表不兼容。
      </p>
      {state.status === 'loading' && (
        <p className="mt-3 text-xs text-muted-foreground">加载中…</p>
      )}
      {state.status === 'error' && (
        <p role="alert" className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {state.message}
        </p>
      )}
      {state.status === 'ready' && (
        <div className="mt-3 divide-y divide-border/60 rounded-lg border border-border/60">
          {state.items.map((item) => (
            <div
              key={item.formatId}
              data-format-qualification={item.formatId}
              className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-3 py-2 text-xs"
            >
              <span className="min-w-0 truncate text-foreground">
                {describeLinguistFormat(item.formatId)}
                <span className="ml-1.5 text-muted-foreground/70">
                  {item.extensions.map((extension) => `.${extension}`).join(' ')}
                </span>
              </span>
              <span
                className={item.internalVerification === 'passed'
                  ? 'text-success'
                  : 'text-warning'}
              >
                内部验证：{item.internalVerification === 'passed' ? '通过' : '失败'}
              </span>
              <span className="text-muted-foreground">
                平台资格：{describePlatformQualification(item.platformQualification)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
