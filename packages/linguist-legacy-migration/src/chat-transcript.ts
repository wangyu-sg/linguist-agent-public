/**
 * PB-093 chat transcript renderer: legacy chat.json rows -> ONE static,
 * read-only Markdown archive (projects/<newId>/legacy-archive/chat/
 * transcript.md). Legacy chats are NEVER migrated into continuable Proma
 * sessions — the old Runtime/Tool/Prompt/Session semantics are incompatible
 * with the new repo, so the history is preserved as a rendered artifact.
 *
 * Determinism is the contract: no Date.now / Math.random / locale-dependent
 * output anywhere; every timestamp comes from the injected provenance, and
 * the same input must produce byte-identical markdown so PB-094 Verify can
 * re-render and compare sha256.
 *
 * Provenance — row shape lifted from frozen legacy-repo SOURCE (read-only):
 * - linguist-agent/packages/cat-server/src/server.ts:437-446 — ChatEvent
 *   {ts, kind: user|assistant|tool|system|error, text, sessionId?,
 *   sessionFile?, toolCallId?, usage?{inputTokens?, cacheReadTokens?,
 *   cacheWriteTokens?, outputTokens?, totalTokens?, costUsd?, modelCalls?}}.
 * - linguist-agent/packages/cat-server/src/application/
 *   project_task_run_coordinator.ts:812,831,1239-1260 — tool rows are
 *   one-line summaries (`tool_start <name>` / `tool_end <name> ok|error`);
 *   tool args/results are NEVER written to chat.json, so they are absent
 *   here by construction (never fabricated).
 *
 * Rendering rules (fixed):
 * - Banner: read-only archive declaration + tool-summary disclaimer +
 *   provenance (legacyProjectId, sourceDigest, archivedAt, generator).
 * - Rows are grouped by sessionId; session sections sort by their first
 *   row's ts (code-unit order), ties by sessionId. Rows without a
 *   (non-empty string) sessionId go into the "未分配会话" section (they are
 *   the legacy malformed_chat_session rows, counted in the report).
 * - Row order INSIDE a session follows the original chat.json order.
 * - user     -> `### 用户 · <ts>` + text verbatim (NO Markdown escaping).
 * - assistant-> `### 助手 · <ts>` + text verbatim + a `> usage:` line
 *               (only when usage carries at least one numeric field).
 * - tool     -> single-line blockquote, verbatim, with toolCallId appended.
 * - system/error (and any out-of-domain kind value) -> one label line.
 * - Malformed rows (non-object, or missing ts/kind/text) keep their
 *   original JSON one per line in the appendix and are counted.
 */

// ---------------------------------------------------------------------------
// model

export interface ChatTranscriptProvenance {
  legacyProjectId: string
  /** PB-090 project digest of the legacy tree the rows came from. */
  sourceDigest: string
  /** Injected clock value (ISO string) — never read from the wall clock. */
  archivedAt: string
  /** Generator identity, e.g. `linguist-legacy-import 0.0.4`. */
  generator: string
}

export interface ChatTranscriptSummary {
  /** Distinct session sections rendered (unassigned rows not included). */
  sessions: number
  /** Archivable rows rendered (valid ChatEvent shape), incl. unassigned. */
  rows: number
  /** Rows without a (non-empty string) sessionId -> 未分配会话 section. */
  unassignedRows: number
  /** Rows that violated the ChatEvent shape -> appendix, original JSON kept. */
  malformedRows: number
}

export interface RenderedChatTranscript {
  markdown: string
  summary: ChatTranscriptSummary
}

interface ChatRow {
  ts: string
  kind: string
  text: string
  sessionId: string | null
  toolCallId: string | null
  usage: Record<string, unknown> | null
}

// ---------------------------------------------------------------------------
// row classification

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A row is archivable iff it is an object with string ts/kind/text (ts/kind non-empty). */
function classifyRow(value: unknown): ChatRow | null {
  if (!isRecord(value)) return null
  if (typeof value.ts !== 'string' || value.ts === '') return null
  if (typeof value.kind !== 'string' || value.kind === '') return null
  if (typeof value.text !== 'string') return null
  const sessionId = typeof value.sessionId === 'string' && value.sessionId.trim() !== '' ? value.sessionId : null
  const toolCallId = typeof value.toolCallId === 'string' ? value.toolCallId : null
  const usage = isRecord(value.usage) ? value.usage : null
  return { ts: value.ts, kind: value.kind, text: value.text, sessionId, toolCallId, usage }
}

// ---------------------------------------------------------------------------
// row rendering (message text is verbatim on purpose — declared in the report)

const USAGE_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'inputTokens', label: 'input' },
  { key: 'cacheReadTokens', label: 'cache-read' },
  { key: 'cacheWriteTokens', label: 'cache-write' },
  { key: 'outputTokens', label: 'output' },
  { key: 'totalTokens', label: 'total' },
  { key: 'costUsd', label: 'cost' },
  { key: 'modelCalls', label: 'model-calls' },
]

function renderUsage(usage: Record<string, unknown>): string | null {
  const parts: string[] = []
  for (const { key, label } of USAGE_FIELDS) {
    const value = usage[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      parts.push(label === 'cost' ? `cost=$${String(value)}` : `${label}=${String(value)}`)
    }
  }
  return parts.length > 0 ? `> usage: ${parts.join(' ')}` : null
}

/** Emit one row as markdown lines (caller owns blank-line separation). */
function renderRow(row: ChatRow, lines: string[]): void {
  if (row.kind === 'user' || row.kind === 'assistant') {
    lines.push(`### ${row.kind === 'user' ? '用户' : '助手'} · ${row.ts}`, '', row.text)
    if (row.kind === 'assistant' && row.usage !== null) {
      const usageLine = renderUsage(row.usage)
      if (usageLine !== null) lines.push('', usageLine)
    }
    return
  }
  if (row.kind === 'tool') {
    // Legacy one-line tool summary (tool_start/tool_end); args/results were
    // never in chat.json. Verbatim, toolCallId appended when present.
    lines.push(`> ${row.text}${row.toolCallId !== null ? ` · toolCallId=${row.toolCallId}` : ''}`)
    return
  }
  // system / error / any out-of-domain kind value: one label line, verbatim.
  lines.push(`**[${row.kind}] · ${row.ts}** — ${row.text}`)
}

// ---------------------------------------------------------------------------
// main entry

/**
 * Render chat.json rows into the archived transcript. Returns null when the
 * input is not a non-empty JSON array (missing/empty chat.json -> no
 * transcript artifact, report.chat.transcript = null).
 */
export function renderChatTranscript(options: {
  rows: unknown
  provenance: ChatTranscriptProvenance
}): RenderedChatTranscript | null {
  const { rows, provenance } = options
  if (!Array.isArray(rows) || rows.length === 0) return null

  const valid: ChatRow[] = []
  const malformed: unknown[] = []
  for (const value of rows) {
    const row = classifyRow(value)
    if (row === null) malformed.push(value)
    else valid.push(row)
  }

  // Group by sessionId (insertion order = original chat.json order), then
  // sort sections by first row ts (code-unit order), ties by sessionId.
  const groups = new Map<string, ChatRow[]>()
  const unassigned: ChatRow[] = []
  for (const row of valid) {
    if (row.sessionId === null) {
      unassigned.push(row)
      continue
    }
    const group = groups.get(row.sessionId)
    if (group === undefined) groups.set(row.sessionId, [row])
    else group.push(row)
  }
  const sections = [...groups.entries()].sort((a, b) => {
    const tsA = a[1][0]!.ts
    const tsB = b[1][0]!.ts
    if (tsA !== tsB) return tsA < tsB ? -1 : 1
    if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1
    return 0
  })

  const lines: string[] = []
  lines.push(
    '# 旧聊天归档转录（read-only archived transcript）',
    '',
    '> **只读归档**：本文件是旧 Linguist Agent 聊天历史的一次性静态渲染，**不可继续执行**；旧 Runtime / Tool / Prompt / Session 语义与新仓不兼容（PB-093）。',
    '> **工具行为**仅为旧 Runtime 写下的单行调用摘要（`tool_start <name>` / `tool_end <name> ok|error`），**不可重放**；工具参数与结果从不写入 chat.json，故不在本归档中。',
    `> **provenance**：legacyProjectId=\`${provenance.legacyProjectId}\` · sourceDigest=\`${provenance.sourceDigest}\` · archivedAt=\`${provenance.archivedAt}\` · generator=\`${provenance.generator}\``,
  )

  for (const [sessionId, sessionRows] of sections) {
    lines.push('', `## 会话 \`${sessionId}\``)
    for (const row of sessionRows) {
      lines.push('')
      renderRow(row, lines)
    }
  }

  if (unassigned.length > 0) {
    lines.push('', '## 未分配会话', '', '_无 sessionId 的行（旧仓 malformed_chat_session 口径，计入迁移报告）。_')
    for (const row of unassigned) {
      lines.push('')
      renderRow(row, lines)
    }
  }

  if (malformed.length > 0) {
    lines.push(
      '',
      '## 附录：无法归档的行',
      '',
      `以下 ${String(malformed.length)} 行不符合 ChatEvent 形状（非对象或缺 ts/kind/text），原文 JSON 逐行保留：`,
      '',
      // Tilde fence: a JSON line never starts with `~~~`, so the original
      // rows cannot break out of the block; backticks inside JSON are safe.
      '~~~json',
      ...malformed.map((value) => JSON.stringify(value)),
      '~~~',
    )
  }

  const summary: ChatTranscriptSummary = {
    sessions: sections.length,
    rows: valid.length,
    unassignedRows: unassigned.length,
    malformedRows: malformed.length,
  }
  return { markdown: `${lines.join('\n')}\n`, summary }
}
