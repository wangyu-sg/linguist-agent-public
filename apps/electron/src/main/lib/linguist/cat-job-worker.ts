import { analyzeBatchConsistency, runQa } from '@linguist/cat-core'
import type {
  LinguistConsistencyWorkerRequest,
  LinguistConsistencyWorkerResult,
  LinguistQaWorkerRequest,
  LinguistQaWorkerResult,
} from '@linguist/cat-tools'
import { parentPort, threadId, workerData } from 'node:worker_threads'

if (parentPort === null) throw new Error('CAT job worker requires a worker thread')

type WorkerRequest =
  | { kind: 'qa'; request: LinguistQaWorkerRequest }
  | { kind: 'consistency'; request: LinguistConsistencyWorkerRequest }

const workerRequest = workerData as WorkerRequest
parentPort.postMessage({ type: 'progress', phase: 'started', threadId })
try {
  const result: LinguistQaWorkerResult | LinguistConsistencyWorkerResult =
    workerRequest.kind === 'qa'
      ? {
          findings: runQa(workerRequest.request.segments, workerRequest.request.options),
          workerThreadId: threadId,
        }
      : {
          pass: analyzeBatchConsistency(workerRequest.request),
          workerThreadId: threadId,
        }
  parentPort.postMessage({ type: 'result', result })
} catch (error) {
  parentPort.postMessage({
    type: 'error',
    name: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : String(error),
  })
}
