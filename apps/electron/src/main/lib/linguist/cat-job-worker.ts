import { analyzeBatchConsistency, runQa } from '@linguist/cat-core'
import type { WorkerRequest } from './cat-job-worker-client'
import { importContextInWorker } from './context-import'
import { parentPort, threadId, workerData } from 'node:worker_threads'

if (parentPort === null) throw new Error('CAT job worker requires a worker thread')

const workerRequest = workerData as WorkerRequest
parentPort.postMessage({ type: 'progress', phase: 'started', threadId })
async function run(): Promise<void> {
  try {
    const result =
      workerRequest.kind === 'qa'
        ? {
            findings: runQa(workerRequest.request.segments, workerRequest.request.options),
            workerThreadId: threadId,
          }
        : workerRequest.kind === 'consistency' ? {
            pass: analyzeBatchConsistency(workerRequest.request),
            workerThreadId: threadId,
          }
        : await importContextInWorker(workerRequest.request)
    parentPort!.postMessage({ type: 'result', result })
  } catch (error) {
    parentPort!.postMessage({
      type: 'error',
      name: error instanceof Error ? error.name : 'Error',
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
void run()
