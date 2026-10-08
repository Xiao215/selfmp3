import { parentPort, workerData } from 'node:worker_threads'
import { messageOf } from '../util/errors.js'
import { Clamp3 } from './clamp3.js'
import type { Clamp3Reply, Clamp3Request, Clamp3WorkerData } from './clamp3Worker.js'

/**
 * The listening model's thread: `Clamp3`, run here so its passes block this
 * thread and not the server's (clamp3Worker.ts says why).
 */

if (!parentPort) throw new Error('clamp3.worker runs as a worker thread')
const port = parentPort
const { dir, threads } = workerData as Clamp3WorkerData

// Made on the first request, not at load: its runtime import starts then, and
// a failure to load it fails that request rather than the thread.
let model: Clamp3 | null = null

port.on('message', (request: Clamp3Request) => {
  if (request.op === 'close') {
    void (model?.close() ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => port.postMessage({ op: 'closed' } satisfies Clamp3Reply))
    return
  }
  model ??= new Clamp3(dir, threads)
  const work = request.op === 'hear' ? model.hearClip(request.pcm) : model.readText(request.text)
  work.then(
    vector => port.postMessage({ id: request.id, vector } satisfies Clamp3Reply),
    (error: unknown) =>
      port.postMessage({ id: request.id, error: messageOf(error) } satisfies Clamp3Reply),
  )
})
