import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { Worker, type WorkerOptions } from 'node:worker_threads'
import { once } from 'node:events'

// 只替换 Worker 入口，生命周期和事件来自真实 node:worker_threads。
let source = ''
let worker: Worker
mock.module('node:worker_threads', { namedExports: {
  Worker: class extends Worker {
    constructor(_entry: string, _options: WorkerOptions) {
      super(source, { eval: true })
      worker = this
    }
  },
} })
const { runLinguistQaWorker } = await import('./cat-job-worker-client')

test('Worker 无结果退出、abort、结果后异常都只结算一次', { timeout: 5_000 }, async () => {
  const request = { segments: [], options: {} }
  for (const code of [0, 7]) {
    source = `process.exit(${code})`
    await assert.rejects(runLinguistQaWorker(request, undefined, undefined), new RegExp(`exited.*${code}`))
  }
  source = "setInterval(() => {}, 1000)"
  const abort = new AbortController()
  const cancelled = runLinguistQaWorker(request, abort.signal, undefined)
  abort.abort()
  await assert.rejects(cancelled, { name: 'AbortError' })
  await once(worker!, 'exit')
  source = "const {parentPort}=require('node:worker_threads'); parentPort.postMessage({type:'result',result:{findings:[],workerThreadId:1}}); throw new Error('late')"
  const progress: string[] = []
  const result = runLinguistQaWorker(request, undefined, phase => progress.push(phase))
  const exit = new Promise<void>(resolve => worker!.once('exit', () => resolve()))
  assert.deepEqual(await result, { findings: [], workerThreadId: 1 })
  await exit
  assert.deepEqual(progress, ['completed'])
  // 退出后迟到的 message 同样不得触发业务/进度回调。
  worker!.emit('message', { type: 'progress', phase: 'started', threadId: 1 })
  worker!.emit('message', { type: 'result', result: { findings: ['late'] } })
  assert.deepEqual(progress, ['completed'])
})
