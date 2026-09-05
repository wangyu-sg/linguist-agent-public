#!/usr/bin/env bun
/**
 * Fake Model Server — PB-004 hermetic smoke 专用
 *
 * 本地确定性 OpenAI Chat Completions 兼容服务：
 * - `POST /v1/chat/completions`：SSE 流式（也支持非流式 JSON，供标题生成使用）
 * - `GET /v1/models`：模型列表
 *
 * 场景选择：按请求体 `model` 字段的 `fake-<scenario>` 后缀切换
 * （也支持自定义请求头 `x-fake-scenario`，便于直接 curl 调试）。
 *
 * 场景：
 * - `fake-text`     多 chunk 文本流（慢速滴灌，可观察中间态）
 * - `fake-thinking` reasoning_content 思考流 + 文本正文
 * - `fake-tool`     tool_calls（名称 + arguments 分片，finish_reason=tool_calls）；
 *                   后续请求若含 role:"tool" 消息则返回最终文本（tool-result-then-final）
 * - `fake-cat-segments` 同 fake-tool，但调用 `cat_get_segments`（PB-042 CAT 工具
 *                   探针专用：参数 '{"limit":5}' 分片；续接走同一 tool-result-then-final）
 * - `fake-cat-summary` 调用 `cat_project_summary`，续接以多 chunk 返回 G4 final
 * - `fake-cat-proposal` 从用户消息读取 segmentId，调用 `cat_propose_translations`
 * - `fake-cat-qa` 调用 `cat_run_qa`，确认 Agent 可运行但不能审核 QA Finding
 * - `fake-cat-pb074` 先读取 Welcome 段，再从 tool result 取 id/revision 创建 Proposal
 * - `fake-retry`    首个流式请求 429 + Retry-After，其后正常
 *                   （客户端 sse-reader.ts 首字节前对 408/425/429/5xx 最多重试 5 次）
 * - `fake-context`  400 context_length_exceeded 错误体
 * - `fake-cancel`   慢速滴灌长流，便于客户端中途 stop
 * - `fake-stop-retry` 首次慢速长流，第二次同模型请求返回最终文本；用于验证
 *                     Stop 后同会话重试不会依赖偷偷切换模型
 *
 * 非流式请求（`stream` 缺省/false，标题生成走这里）返回普通 JSON completion，
 * content 固定为 `标题-<model>`，使每个对话的自动标题确定且唯一。
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'

/** 各场景最终文本中的唯一标记（runner 依此做 DOM/持久化断言） */
export const MARKERS = {
  text: 'TEXT_FINAL_MARKER_G0',
  thinking: 'THINKING_FINAL_MARKER_G0',
  thinkingReasoning: 'REASONING_DELTA_MARKER_G0',
  tool: 'TOOL_ROUNDTRIP_FINAL_MARKER_G0',
  retry: 'RETRY_SUCCESS_MARKER_G0',
  context: 'maximum context length',
  cancelPrefix: 'CANCEL_DRIP_',
} as const

export const G4_SUMMARY_MARKER = 'PROJECT_SUMMARY_FINAL_MARKER_G4'

export const FAKE_TOOL_NAME = 'get_fake_weather'

/** PB-042 CAT 工具探针：fake-cat-segments 场景调用的真实 CAT 工具名 */
export const FAKE_CAT_TOOL_NAME = 'cat_get_segments'
export const FAKE_CAT_SUMMARY_TOOL_NAME = 'cat_project_summary'
export const FAKE_CAT_PROPOSAL_TOOL_NAME = 'cat_propose_translations'
export const FAKE_CAT_QA_TOOL_NAME = 'cat_run_qa'
export const G5_PROPOSAL_TARGET = '生命药水'
export const G5_PROPOSAL_MARKER = 'PROPOSAL_CREATED_MARKER_G5'
export const QA_RUN_MARKER = 'QA_RUN_MARKER_PB071'
export const PB074_SOURCE = 'Welcome back, {player}!'
export const PB074_PROPOSAL_TARGET = '欢迎回来，{player}！！'
export const PB074_FINAL_MARKER = 'VERTICAL_E2E_FINAL_MARKER_PB074'

export const FAKE_MODEL_IDS = [
  'fake-text',
  'fake-thinking',
  'fake-tool',
  'fake-retry',
  'fake-context',
  'fake-cancel',
  'fake-stop-retry',
  'fake-cat-segments',
  'fake-cat-summary',
  'fake-cat-proposal',
  'fake-cat-qa',
  'fake-cat-pb074',
  'fake-cat-context',
] as const

export interface FakeRequestLogEntry {
  seq: number
  method: string
  url: string
  model?: string
  stream?: boolean
  hasToolMessage?: boolean
  respondedStatus: number
  at: number
  /** 仅 captureSystemPrompt 开启时记录：请求体中 system/developer 消息全文（PB-040 项目 Skill 探针断言用） */
  systemPrompt?: string
  /** 仅 captureTools 开启时记录：请求体 OpenAI tools 数组的工具名（PB-042 CAT 工具探针断言用；无 tools 字段时为 []） */
  toolNames?: string[]
  /** 仅 captureTools 开启且请求含 role:"tool" 消息时记录：全部 tool 结果文本拼接（截断兜底），证明工具在 App 内真实执行 */
  toolResultText?: string
}

export interface FakeModelServer {
  port: number
  baseUrl: string
  logs: FakeRequestLogEntry[]
  close: () => Promise<void>
}

export interface FakeModelServerOptions {
  /** 记录每个 chat/completions 请求的系统提示词（默认关闭，既有探针零影响） */
  captureSystemPrompt?: boolean
  /** 记录每个 chat/completions 请求的 tools 工具名与 role:"tool" 结果文本（默认关闭，既有探针零影响） */
  captureTools?: boolean
}

interface ChatMessageLike {
  role?: string
  content?: unknown
}

interface ChatToolLike {
  type?: string
  function?: { name?: string }
}

interface ChatRequestBody {
  model?: string
  stream?: boolean
  messages?: ChatMessageLike[]
  tools?: ChatToolLike[]
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function latestToolResult(messages: ChatMessageLike[] | undefined): Record<string, unknown> | undefined {
  const content = [...(messages ?? [])].reverse().find((message) => message.role === 'tool')?.content
  if (typeof content !== 'string') return undefined
  try {
    return record(JSON.parse(content))
  } catch {
    return undefined
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function sseChunk(model: string, delta: Record<string, unknown>, finishReason: string | null = null): string {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-fake',
    object: 'chat.completion.chunk',
    created: 1_700_000_000,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`
}

const SSE_DONE = 'data: [DONE]\n\n'

function writeSseHeaders(res: ServerResponse): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
}

function writeError(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(JSON.stringify(body))
}

/** 依次滴灌写入 SSE 行；客户端断开（req close）时停止 */
async function drip(res: ServerResponse, req: IncomingMessage, lines: string[], intervalMs: number): Promise<void> {
  let aborted = false
  req.on('close', () => {
    aborted = true
  })
  for (const line of lines) {
    if (aborted || res.writableEnded) return
    res.write(line)
    await sleep(intervalMs)
  }
  if (!aborted && !res.writableEnded) {
    res.write(SSE_DONE)
    res.end()
  }
}

export async function startFakeModelServer(port = 0, options: FakeModelServerOptions = {}): Promise<FakeModelServer> {
  const logs: FakeRequestLogEntry[] = []
  let seq = 0
  /** fake-retry 场景：每个 model 的流式请求计数（首个流式请求失败） */
  const streamAttemptsByModel = new Map<string, number>()

  const server: Server = createServer((req, res) => {
    void handleRequest(req, res).catch((error) => {
      console.error('[fake-model-server] 请求处理异常:', error)
      if (!res.writableEnded) writeError(res, 500, { error: { message: 'fake server internal error' } })
    })
  })

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? ''

    if (req.method === 'GET' && url.startsWith('/v1/models')) {
      logs.push({ seq: ++seq, method: 'GET', url, respondedStatus: 200, at: Date.now() })
      writeError(res, 200, {
        object: 'list',
        data: FAKE_MODEL_IDS.map((id) => ({ id, object: 'model', created: 1_700_000_000, owned_by: 'fake' })),
      })
      return
    }

    if (req.method === 'POST' && url.startsWith('/v1/chat/completions')) {
      const raw = await readBody(req)
      let body: ChatRequestBody = {}
      try {
        body = JSON.parse(raw) as ChatRequestBody
      } catch {
        writeError(res, 400, { error: { message: 'invalid JSON body' } })
        return
      }

      const headerScenario = req.headers['x-fake-scenario']
      const model = body.model ?? 'fake-text'
      const scenario = (typeof headerScenario === 'string' && headerScenario) || model.replace(/^fake-/, '')
      const isStream = body.stream === true
      const hasToolMessage = body.messages?.at(-1)?.role === 'tool'

      const entry: FakeRequestLogEntry = {
        seq: ++seq,
        method: 'POST',
        url,
        model,
        stream: isStream,
        hasToolMessage,
        respondedStatus: 200,
        at: Date.now(),
      }
      if (options.captureSystemPrompt) {
        // 捕获 system/developer 消息全文（截断兜底），供探针断言真实到达模型的 system prompt
        const systemText = (body.messages ?? [])
          .filter((m) => m.role === 'system' || m.role === 'developer')
          .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
          .join('\n')
        entry.systemPrompt = systemText.slice(0, 200_000)
      }
      if (options.captureTools) {
        // 捕获 OpenAI tools 数组的工具名 + role:"tool" 结果文本（截断兜底），
        // 供探针断言工具列表真实发往模型、工具结果真实回到模型（PB-042）
        entry.toolNames = (body.tools ?? [])
          .map((t) => t?.function?.name)
          .filter((name): name is string => typeof name === 'string')
        const toolText = (body.messages ?? [])
          .filter((m) => m.role === 'tool')
          .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
          .join('\n')
        if (toolText.length > 0) entry.toolResultText = toolText.slice(0, 200_000)
      }
      logs.push(entry)

      // 非流式请求：标题生成路径，返回确定标题（每个 model 唯一）
      if (!isStream) {
        writeError(res, 200, {
          id: 'chatcmpl-fake-title',
          object: 'chat.completion',
          created: 1_700_000_000,
          model,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: `标题-${model}` },
              finish_reason: 'stop',
            },
          ],
        })
        return
      }

      // tool-result-then-final：任何场景下，只要带 role:"tool" 消息就回最终文本
      if (hasToolMessage) {
        writeSseHeaders(res)
        if (scenario === 'cat-pb074') {
          const result = latestToolResult(body.messages)
          const items = Array.isArray(result?.items) ? result.items : undefined
          const segment = record(items?.[0])
          if (
            typeof segment?.id === 'string'
            && typeof segment.revision === 'number'
            && segment.source === PB074_SOURCE
          ) {
            const args = JSON.stringify({
              segmentProposals: [{
                segmentId: segment.id,
                baseRevision: segment.revision,
                proposedTarget: PB074_PROPOSAL_TARGET,
              }],
            })
            await drip(
              res,
              req,
              [
                sseChunk(model, { role: 'assistant' }),
                sseChunk(model, {
                  tool_calls: [{
                    index: 0,
                    id: 'call_pb074_proposal_1',
                    type: 'function',
                    function: { name: FAKE_CAT_PROPOSAL_TOOL_NAME, arguments: args },
                  }],
                }),
                sseChunk(model, {}, 'tool_calls'),
              ],
              80,
            )
            return
          }
          await drip(
            res,
            req,
            [sseChunk(model, { content: `纵向建议已创建。${PB074_FINAL_MARKER}` }, 'stop')],
            40,
          )
          return
        }
        if (scenario === 'cat-summary') {
          await drip(
            res,
            req,
            [
              sseChunk(model, { role: 'assistant' }),
              sseChunk(model, { content: '项目摘要已读取，' }),
              sseChunk(model, { content: '可以开始后续本地化工作。' }),
              sseChunk(model, { content: G4_SUMMARY_MARKER }, 'stop'),
            ],
            120,
          )
          return
        }
        if (scenario === 'cat-proposal') {
          await drip(
            res,
            req,
            [sseChunk(model, { content: `翻译建议已创建。${G5_PROPOSAL_MARKER}` }, 'stop')],
            40,
          )
          return
        }
        if (scenario === 'cat-qa') {
          await drip(
            res,
            req,
            [sseChunk(model, { content: `QA 已运行，${QA_RUN_MARKER}` }, 'stop')],
            40,
          )
          return
        }
        await drip(
          res,
          req,
          [sseChunk(model, { content: `工具结果已收到，最终回答 ${MARKERS.tool}` }, 'stop')],
          20,
        )
        return
      }

      switch (scenario) {
        case 'text': {
          writeSseHeaders(res)
          await drip(
            res,
            req,
            [
              sseChunk(model, { role: 'assistant' }),
              sseChunk(model, { content: '你好！' }),
              sseChunk(model, { content: '我是 Fake 模型，' }),
              sseChunk(model, { content: '可以回答问题、写代码、翻译。' }),
              sseChunk(model, { content: `唯一标记：${MARKERS.text}` }, 'stop'),
            ],
            // 400ms 滴灌：保证 runner 能在 STREAM_COMPLETE 前观察到 DOM 中间态
            400,
          )
          return
        }

        case 'thinking': {
          writeSseHeaders(res)
          await drip(
            res,
            req,
            [
              sseChunk(model, { role: 'assistant' }),
              sseChunk(model, { reasoning_content: '先思考第一步，' }),
              sseChunk(model, { reasoning_content: `${MARKERS.thinkingReasoning}，` }),
              sseChunk(model, { reasoning_content: '然后给出结论。' }),
              sseChunk(model, { content: '思考完成。' }),
              sseChunk(model, { content: `唯一标记：${MARKERS.thinking}` }, 'stop'),
            ],
            120,
          )
          return
        }

        case 'tool': {
          writeSseHeaders(res)
          await drip(
            res,
            req,
            [
              sseChunk(model, { role: 'assistant' }),
              sseChunk(model, {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_fake_weather_1',
                    type: 'function',
                    function: { name: FAKE_TOOL_NAME, arguments: '' },
                  },
                ],
              }),
              sseChunk(model, {
                tool_calls: [{ index: 0, function: { arguments: '{"city"' } }],
              }),
              sseChunk(model, {
                tool_calls: [{ index: 0, function: { arguments: ':"Shanghai"}' } }],
              }),
              sseChunk(model, {}, 'tool_calls'),
            ],
            100,
          )
          return
        }

        case 'cat-segments': {
          // PB-042：调用真实 CAT 工具 cat_get_segments（{"limit":5} 分片）；
          // 工具在 App 内执行后，续接请求（role:"tool"）走上方通用分支回最终文本
          writeSseHeaders(res)
          await drip(
            res,
            req,
            [
              sseChunk(model, { role: 'assistant' }),
              sseChunk(model, {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_cat_get_segments_1',
                    type: 'function',
                    function: { name: FAKE_CAT_TOOL_NAME, arguments: '' },
                  },
                ],
              }),
              sseChunk(model, {
                tool_calls: [{ index: 0, function: { arguments: '{"limit"' } }],
              }),
              sseChunk(model, {
                tool_calls: [{ index: 0, function: { arguments: ':5}' } }],
              }),
              sseChunk(model, {}, 'tool_calls'),
            ],
            80,
          )
          return
        }

        case 'cat-summary': {
          writeSseHeaders(res)
          await drip(
            res,
            req,
            [
              sseChunk(model, { role: 'assistant' }),
              sseChunk(model, {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_cat_project_summary_1',
                    type: 'function',
                    function: { name: FAKE_CAT_SUMMARY_TOOL_NAME, arguments: '' },
                  },
                ],
              }),
              sseChunk(model, {
                tool_calls: [{ index: 0, function: { arguments: '{}' } }],
              }),
              sseChunk(model, {}, 'tool_calls'),
            ],
            80,
          )
          return
        }

        case 'cat-context':
        case 'cat-proposal': {
          const latestUser = (body.messages ?? []).filter((message) => message.role === 'user').at(-1)
          const userText = typeof latestUser?.content === 'string'
            ? latestUser.content
            : JSON.stringify(latestUser?.content) ?? ''
          const segmentId = userText.match(
            /\bsegmentId=(seg(?:-[0-9a-f]{16}|_v2_[0-9a-f]{64}))\b/,
          )?.[1]
          if (segmentId === undefined) {
            entry.respondedStatus = 400
            writeError(res, 400, { error: { message: 'fake-cat-proposal requires segmentId' } })
            return
          }
          const args = JSON.stringify(scenario === 'cat-context' ? { segmentIds: [segmentId] } : {
            segmentProposals: [
              { segmentId, baseRevision: 0, proposedTarget: G5_PROPOSAL_TARGET },
            ],
          })
          writeSseHeaders(res)
          await drip(
            res,
            req,
            [
              sseChunk(model, { role: 'assistant' }),
              sseChunk(model, {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_cat_propose_translations_1',
                    type: 'function',
                    function: { name: scenario === 'cat-context' ? 'cat_get_translation_context' : FAKE_CAT_PROPOSAL_TOOL_NAME, arguments: args },
                  },
                ],
              }),
              sseChunk(model, {}, 'tool_calls'),
            ],
            80,
          )
          return
        }

        case 'cat-qa': {
          writeSseHeaders(res)
          await drip(
            res,
            req,
            [
              sseChunk(model, { role: 'assistant' }),
              sseChunk(model, {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_cat_run_qa_1',
                    type: 'function',
                    function: { name: FAKE_CAT_QA_TOOL_NAME, arguments: '{}' },
                  },
                ],
              }),
              sseChunk(model, {}, 'tool_calls'),
            ],
            80,
          )
          return
        }

        case 'cat-pb074': {
          writeSseHeaders(res)
          await drip(
            res,
            req,
            [
              sseChunk(model, { role: 'assistant' }),
              sseChunk(model, {
                tool_calls: [{
                  index: 0,
                  id: 'call_pb074_segments_1',
                  type: 'function',
                  function: {
                    name: FAKE_CAT_TOOL_NAME,
                    arguments: JSON.stringify({ search: 'Welcome back', limit: 1 }),
                  },
                }],
              }),
              sseChunk(model, {}, 'tool_calls'),
            ],
            80,
          )
          return
        }

        case 'retry': {
          const attempts = (streamAttemptsByModel.get(model) ?? 0) + 1
          streamAttemptsByModel.set(model, attempts)
          if (attempts === 1) {
            entry.respondedStatus = 429
            writeError(
              res,
              429,
              { error: { message: 'fake rate limit exceeded', type: 'rate_limit_error', code: 'rate_limit_exceeded' } },
              { 'retry-after': '1' },
            )
            return
          }
          writeSseHeaders(res)
          await drip(
            res,
            req,
            [
              sseChunk(model, { role: 'assistant' }),
              sseChunk(model, { content: `第 ${attempts} 次尝试成功。` }),
              sseChunk(model, { content: `唯一标记：${MARKERS.retry}` }, 'stop'),
            ],
            80,
          )
          return
        }

        case 'context': {
          entry.respondedStatus = 400
          writeError(res, 400, {
            error: {
              message: `This model's ${MARKERS.context} is 4096 tokens. However, your messages resulted in 999999 tokens.`,
              type: 'invalid_request_error',
              code: 'context_length_exceeded',
            },
          })
          return
        }

        case 'cancel':
        case 'stop-retry': {
          if (scenario === 'stop-retry') {
            const attempts = (streamAttemptsByModel.get(model) ?? 0) + 1
            streamAttemptsByModel.set(model, attempts)
            if (attempts > 1) {
              writeSseHeaders(res)
              await drip(
                res,
                req,
                [sseChunk(model, { content: `同模型重试成功。${MARKERS.text}` }, 'stop')],
                80,
              )
              return
            }
          }
          writeSseHeaders(res)
          const lines: string[] = [sseChunk(model, { role: 'assistant' })]
          for (let i = 1; i <= 120; i++) {
            lines.push(sseChunk(model, { content: `${MARKERS.cancelPrefix}${i} ` }))
          }
          // 400ms × 120 = 48s 长流，客户端 stop 必然发生在中途
          await drip(res, req, lines, 400)
          return
        }

        default: {
          writeError(res, 400, { error: { message: `unknown fake scenario: ${scenario}` } })
          return
        }
      }
    }

    writeError(res, 404, { error: { message: `not found: ${req.method} ${url}` } })
  }

  function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
      req.on('error', reject)
    })
  }

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  const address = server.address()
  const boundPort = typeof address === 'object' && address ? address.port : port

  return {
    port: boundPort,
    baseUrl: `http://127.0.0.1:${boundPort}/v1`,
    logs,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

// 直接运行时作为独立进程启动（调试用）：bun run fake-model-server.ts [port]
if (import.meta.main) {
  const port = Number(process.argv[2] ?? 47810)
  const server = await startFakeModelServer(port)
  console.log(`[fake-model-server] listening on ${server.baseUrl}`)
}
