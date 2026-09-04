import { expect, test } from 'bun:test'
import { buildPiMcpTools, disposePiMcpConnections } from '../apps/electron/src/main/lib/adapters/pi-mcp-tools'

test('真实 HTTP MCP：失败缓存淘汰、冷却后台恢复、工具执行与退出清理', async () => {
  let failing = true
  const events: string[] = []
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      if (request.method !== 'POST') return new Response(null, { status: 405 })
      const rpc = await request.json() as { id?: number; method: string }
      const name = new URL(request.url).pathname.slice(1)
      events.push(`${name}:${rpc.method}`)
      if (failing) return new Response('fixture unavailable', { status: 503 })
      if (rpc.id === undefined) return new Response(null, { status: 202 })
      let result: unknown
      switch (rpc.method) {
        case 'initialize':
          // 超过 optional 的 500ms 窗口，观察真实异步状态而非 mock 内部 Map。
          await Bun.sleep(800)
          result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } }
          break
        case 'tools/list':
          result = { tools: [{ name: 'echo', inputSchema: { type: 'object', properties: {} } }] }
          break
        case 'tools/call':
          result = { content: [{ type: 'text', text: 'recovered' }] }
          break
        default:
          throw new Error(`Unexpected MCP method: ${rpc.method}`)
      }
      return Response.json({ jsonrpc: '2.0', id: rpc.id, result })
    },
  })
  const config = (name: string) => ({ [name]: { type: 'http', url: `http://127.0.0.1:${server.port}/${name}`, required: true } })
  try {
    await disposePiMcpConnections()
    // 顺序失败保证 s0 为最旧记录；第 65 项应将它淘汰。
    for (let index = 0; index < 65; index++) {
      expect(await buildPiMcpTools(config(`s${index}`))).toEqual([])
    }
    failing = false
    const oldest = await buildPiMcpTools(config('s0'))
    expect(oldest.map(tool => tool.name)).toEqual(['mcp__s0__echo'])
    expect(events).toContain('s0:tools/list')

    // 最近失败项仍在冷却：本轮返回空，真实握手在后台继续。
    expect(await buildPiMcpTools(config('s64'))).toEqual([])
    expect(events).not.toContain('s64:tools/list')
    const recovered = await buildPiMcpTools(config('s64'))
    expect(recovered.map(tool => tool.name)).toEqual(['mcp__s64__echo'])
    const result = await recovered[0]!.execute('check', {}, new AbortController().signal)
    expect(result.content).toEqual([{ type: 'text', text: 'recovered' }])
    expect(events).toContain('s64:tools/call')

    await disposePiMcpConnections()
    // s63 未恢复过；dispose 必须清除其冷却，下一轮重新等待完整握手。
    expect((await buildPiMcpTools(config('s63'))).map(tool => tool.name)).toEqual(['mcp__s63__echo'])
  } finally {
    await disposePiMcpConnections()
    await server.stop(true)
  }
}, 15_000)
