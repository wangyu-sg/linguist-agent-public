import type {
  LinguistConsistencyWorker,
  LinguistConsistencyWorkerRequest,
  LinguistConsistencyWorkerResult,
  LinguistQaWorker,
  LinguistQaWorkerRequest,
  LinguistQaWorkerResult,
} from '@linguist/cat-tools'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'

type WorkerMessage<TResult> =
  | { type: 'progress'; phase: 'started' | 'completed'; threadId: number }
  | { type: 'result'; result: TResult }
  | { type: 'error'; name: string; message: string }

type WorkerRequest =
  | { kind: 'qa'; request: LinguistQaWorkerRequest }
  | { kind: 'consistency'; request: LinguistConsistencyWorkerRequest }

function workerEntry(): string {
  const moduleDir = typeof __dirname === 'string'
    ? __dirname
    : dirname(fileURLToPath(import.meta.url))
  const bundled = join(moduleDir, 'cat-job-worker.cjs')
  return existsSync(bundled) ? bundled : join(moduleDir, 'cat-job-worker.ts')
}

function abortError(label: string): Error {
  const error = new Error(`CAT ${label} worker cancelled`)
  error.name = 'AbortError'
  return error
}

function runWorker<TResult>(
  request: WorkerRequest,
  label: string,
  signal: AbortSignal | undefined,
  onProgress: ((phase: 'started' | 'completed') => void) | undefined,
): Promise<TResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(label))
      return
    }
    const worker = new Worker(workerEntry(), { workerData: request })
    let settled = false
    const settle = (callback: () => void): void => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      callback()
    }
    const onAbort = (): void => {
      void worker.terminate()
      settle(() => reject(abortError(label)))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    worker.on('message', (message: WorkerMessage<TResult>) => {
      if (message.type === 'progress') {
        try {
          onProgress?.(message.phase)
        } catch {
          // 计算继续；展示进度不属于 worker 结果。
        }
        return
      }
      if (message.type === 'error') {
        const error = new Error(message.message)
        error.name = message.name
        settle(() => reject(error))
        return
      }
      try {
        onProgress?.('completed')
      } catch {
        // 同上。
      }
      settle(() => resolve(message.result))
    })
    worker.on('error', (error) => settle(() => reject(error)))
    worker.on('exit', (code) => {
      if (code !== 0) {
        settle(() => reject(new Error(`CAT ${label} worker exited with code ${code}`)))
      }
    })
  })
}

export const runLinguistQaWorker: LinguistQaWorker = (
  request,
  signal,
  onProgress,
) => runWorker<LinguistQaWorkerResult>({ kind: 'qa', request }, 'QA', signal, onProgress)

export const runLinguistConsistencyWorker: LinguistConsistencyWorker = (
  request,
  signal,
  onProgress,
) => runWorker<LinguistConsistencyWorkerResult>(
  { kind: 'consistency', request },
  'consistency',
  signal,
  onProgress,
)
