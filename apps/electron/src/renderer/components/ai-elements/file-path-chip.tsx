/**
 * FilePathChip — 文件路径可点击芯片
 *
 * 在 Agent 消息中检测到文件路径时，渲染为可点击的芯片。
 * 支持绝对路径和相对路径（相对于 basePath 解析）。
 * 点击后按用户偏好（标签页 / 侧边分屏）打开文件预览。
 */

import * as React from 'react'
import { useStore } from 'jotai'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { FileTypeIcon } from '@/components/file-browser/FileTypeIcon'
import { useOpenPreview } from '@/components/diff/preview-opener'
import { currentAgentSessionIdAtom } from '@/atoms/agent-atoms'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu'

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'])
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov'])
const CODE_EXTS = new Set([
  'md', 'markdown', 'json', 'jsonc', 'json5', 'xml', 'html', 'htm', 'txt', 'log', 'csv',
  'yaml', 'yml', 'toml', 'ini', 'env', 'lock', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'hpp', 'cs', 'sh', 'bash',
  'zsh', 'fish', 'css', 'scss', 'less', 'sql', 'rb', 'php', 'diff', 'patch',
])
const ALL_PREVIEWABLE_EXTS = new Set([...IMAGE_EXTS, ...VIDEO_EXTS, ...CODE_EXTS, 'pdf', 'docx'])
const PATH_SEP_RE = /[\\/]/
const WIN_DRIVE_RE = /^[A-Za-z]:[\\/]/
const UNC_PATH_RE = /^\\\\/

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase()
}

function getFileName(filePath: string): string {
  const parts = filePath.split(PATH_SEP_RE)
  return parts[parts.length - 1] || filePath
}

function stripLineCol(filePath: string): { path: string; suffix: string } {
  const match = filePath.match(/^(.+?)(:\d+(?::\d+)?)$/)
  return match && !match[1]!.endsWith(':')
    ? { path: match[1]!, suffix: match[2]! }
    : { path: filePath, suffix: '' }
}

export function isImageFilePath(filePath: string): boolean {
  return IMAGE_EXTS.has(getExtension(filePath.trim()))
}

export function isAbsoluteFilePath(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length < 2) return false
  const { path } = stripLineCol(trimmed)
  if (!path.startsWith('/')) return UNC_PATH_RE.test(path) || WIN_DRIVE_RE.test(path)
  return /^\/[^\n]+\/[^\n]+$/.test(path) && (!path.endsWith('/') || path.includes('.'))
}

export function isRelativeFilePath(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length < 3) return false
  const { path } = stripLineCol(trimmed)
  const ext = getExtension(path)
  return Boolean(
    ext
    && ALL_PREVIEWABLE_EXTS.has(ext)
    && /^[\w./@\\-]+$/.test(path)
    && (!path.startsWith('.') || PATH_SEP_RE.test(path)),
  )
}

/** 文件存在性缓存（模块级共享，避免重复 IPC）。key = filePath + basePaths */
const fileExistsCache = new Map<string, string | null>()
function existsCacheKey(filePath: string, bases: string[]): string {
  return `${filePath}\0${bases.join('\0')}`
}

interface FilePathChipProps {
  /** 文件路径（绝对或相对，可能带行号后缀） */
  filePath: string
  /** 基础目录路径（向后兼容，单值） */
  basePath?: string
  /** 多个候选基础目录（如主 cwd + 附加目录），点击时由主进程依次解析 */
  basePaths?: string[]
  className?: string
}

/** 文件路径芯片 — 可点击，触发文件预览 */
export function FilePathChip({ filePath, basePath, basePaths, className }: FilePathChipProps): React.ReactElement {
  const trimmedPath = filePath.trim()
  const { path: cleanPath, suffix: lineColSuffix } = stripLineCol(trimmedPath)
  const filename = getFileName(cleanPath)

  const chipRef = React.useRef<HTMLButtonElement>(null)
  const requestGenerationRef = React.useRef(0)
  const [resolvedPath, setResolvedPath] = React.useState<string | null>()
  const store = useStore()
  const openPreview = useOpenPreview()

  const candidateBases = React.useMemo<string[]>(() => {
    if (basePaths && basePaths.length > 0) return basePaths.filter(Boolean)
    if (basePath) return [basePath]
    return []
  }, [basePath, basePaths])

  const displayPath = resolvedPath ? `${resolvedPath}${lineColSuffix}` : trimmedPath

  const resolveCurrentPath = React.useCallback((): Promise<void> => {
    const key = existsCacheKey(cleanPath, candidateBases)
    const generation = ++requestGenerationRef.current
    const bases = candidateBases.length > 0 ? candidateBases : undefined
    const sessionId = store.get(currentAgentSessionIdAtom)
    return window.electronAPI.resolveFilePath(cleanPath, {
      sessionId: sessionId ?? undefined,
      candidateBasePaths: bases,
    })
      .then((resolved) => {
        if (generation !== requestGenerationRef.current) return
        const path = resolved?.resolvedPath ?? null
        fileExistsCache.set(key, path)
        setResolvedPath(path)
      })
      .catch(() => { /* IPC 失败时保留当前状态 */ })
  }, [cleanPath, candidateBases, store])

  // IntersectionObserver 首次懒检查可使用缓存；Tooltip 打开时会绕过缓存重新解析。
  React.useEffect(() => {
    const el = chipRef.current
    if (!el) return

    requestGenerationRef.current += 1
    setResolvedPath(undefined)
    const key = existsCacheKey(cleanPath, candidateBases)
    if (fileExistsCache.has(key)) {
      setResolvedPath(fileExistsCache.get(key)!)
      return () => {
        requestGenerationRef.current += 1
      }
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return
        observer.disconnect()
        void resolveCurrentPath()
      },
      { threshold: 0 },
    )
    observer.observe(el)
    return () => {
      requestGenerationRef.current += 1
      observer.disconnect()
    }
  }, [cleanPath, candidateBases, resolveCurrentPath])

  const handleClick = React.useCallback(() => {
    const sessionId = store.get(currentAgentSessionIdAtom)
    if (!sessionId) return

    openPreview(sessionId, {
      filePath: cleanPath,
      previewOnly: true,
      basePaths: candidateBases.length > 0 ? candidateBases : undefined,
    })
  }, [store, openPreview, cleanPath, candidateBases])

  const handleShowInFolder = React.useCallback(() => {
    const bases = candidateBases.length > 0 ? candidateBases : undefined
    window.electronAPI.showItemInFolder(cleanPath, bases)
      .then((ok) => { if (!ok) toast.error(`未找到文件：${filename}`) })
      .catch(() => toast.error(`未找到文件：${filename}`))
  }, [cleanPath, candidateBases, filename])

  return (
    <ContextMenu>
      <Tooltip onOpenChange={(open) => { if (open) void resolveCurrentPath() }}>
        <ContextMenuTrigger asChild>
          <TooltipTrigger asChild>
            <button
              ref={chipRef}
              type="button"
              onClick={handleClick}
              className={cn(
                'inline-flex items-center gap-[0.25em] rounded px-[0.35em] py-[0.15em] text-[0.875em] font-medium leading-none',
                'cursor-pointer transition-colors duration-150',
                'align-baseline not-prose',
                resolvedPath === null
                  ? 'opacity-50 border border-dashed border-muted-foreground/30 text-muted-foreground hover:opacity-70 hover:bg-muted/20'
                  : 'bg-primary/10 text-primary hover:bg-primary/20',
                className,
              )}
            >
              <FileTypeIcon name={filename} isDirectory={false} size={12} />
              <span className="truncate max-w-[240px] leading-none">{filename}{lineColSuffix}</span>
            </button>
          </TooltipTrigger>
        </ContextMenuTrigger>
        <TooltipContent side="bottom" className="max-w-[400px] break-all font-mono text-[11px]">
          {resolvedPath === null ? `文件不存在: ${displayPath}` : displayPath}
        </TooltipContent>
      </Tooltip>
      <ContextMenuContent className="w-48 z-[9999]">
        <ContextMenuItem onClick={handleClick}>
          打开预览
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={handleShowInFolder}>
          在文件管理器中显示
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
