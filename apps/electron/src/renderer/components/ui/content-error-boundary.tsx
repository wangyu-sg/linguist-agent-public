import * as React from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'

interface ContentErrorBoundaryProps {
  message?: string
  retryLabel?: string
  children: React.ReactNode
}

interface ContentErrorBoundaryState {
  hasError: boolean
}

export class ContentErrorBoundary extends React.Component<
  ContentErrorBoundaryProps,
  ContentErrorBoundaryState
> {
  override state: ContentErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ContentErrorBoundaryState {
    return { hasError: true }
  }

  override componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    console.error('[ContentErrorBoundary] 内容渲染异常:', error, info.componentStack)
  }

  override render(): React.ReactNode {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
        <AlertTriangle className="size-7 text-destructive/70" />
        <p className="text-[13px]">{this.props.message ?? '此文件无法安全渲染预览，请使用默认应用打开。'}</p>
        <button
          type="button"
          onClick={() => this.setState({ hasError: false })}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
        >
          <RotateCw className="size-3.5" />
          {this.props.retryLabel ?? '重试预览'}
        </button>
      </div>
    )
  }
}
