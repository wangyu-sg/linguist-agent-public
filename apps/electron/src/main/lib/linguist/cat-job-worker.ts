import { analyzeBatchConsistency, runQa } from '@linguist/cat-core'
import type { WorkerRequest } from './cat-job-worker-client'
import { importContextInWorker, prepareContextImport } from './context-import'
import { parentPort, threadId, workerData } from 'node:worker_threads'

if (parentPort === null) throw new Error('CAT job worker requires a worker thread')

const workerRequest = workerData as WorkerRequest
parentPort.postMessage({ type: 'progress', phase: 'started', threadId })
async function run(): Promise<void> {
  try {
    let result: unknown
    if (workerRequest.kind === 'qa') {
      result = {
        findings: runQa(workerRequest.request.segments, workerRequest.request.options),
        workerThreadId: threadId,
      }
    } else if (workerRequest.kind === 'consistency') {
      result = {
        pass: analyzeBatchConsistency(workerRequest.request),
        workerThreadId: threadId,
      }
    } else if (workerRequest.kind === 'context-prepare') {
      await prepareContextImport(workerRequest.request)
      result = { ready: true }
    } else {
      result = await importContextInWorker(workerRequest.request)
    }
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
