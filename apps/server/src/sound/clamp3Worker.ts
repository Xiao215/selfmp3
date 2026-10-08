import { Worker } from 'node:worker_threads'
import type { SoundModel } from './clamp3.js'

/**
 * CLaMP 3 on a thread of its own, behind the same surface as `Clamp3`.
 *
 * onnxruntime-node's "async" run is a synchronous native call put off by one
 * `setImmediate`, so on the event loop each pass froze the server for as long
 * as it took: seconds a pass on a Pi 4, six passes a song. Requests, timers and
 * Docker's health check all waited behind it. Here the passes run in a worker
 * (clamp3.worker.ts), which costs the same CPU and leaves the loop free.
 *
 * The worker starts on the first call and is asked one thing at a time, as
 * `Clamp3` itself would be. If it dies, whatever it was doing fails, and the
 * next call starts a fresh one.
 */

/** What the worker is started with. */
export interface Clamp3WorkerData {
  dir: string
  threads: number
}

export type Clamp3Request =
  | { id: number; op: 'hear'; pcm: Float32Array }
  | { id: number; op: 'read'; text: string }
  | { op: 'close' }

export type Clamp3Reply =
  { id: number; vector: Float32Array } | { id: number; error: string } | { op: 'closed' }

/** The worker's file beside this one: `.ts` when run from source, `.js` from `dist`. */
const SCRIPT = new URL(
  `./clamp3.worker${import.meta.url.endsWith('.ts') ? '.ts' : '.js'}`,
  import.meta.url,
)

interface Job {
  resolve: (vector: Float32Array) => void
  reject: (error: Error) => void
}

interface Running {
  worker: Worker
  jobs: Map<number, Job>
}

export class Clamp3Worker implements SoundModel {
  readonly #data: Clamp3WorkerData
  readonly #script: URL
  readonly #execArgv: string[] | undefined
  #running: Running | null = null
  #nextId = 1
  /** One job at a time: the threads given are the threads used. */
  #queue: Promise<unknown> = Promise.resolve()

  constructor(
    dir: string,
    threads: number,
    /** The worker's script and Node flags; a test's own. */
    options: { script?: URL; execArgv?: string[] } = {},
  ) {
    this.#data = { dir, threads }
    this.#script = options.script ?? SCRIPT
    this.#execArgv = options.execArgv
  }

  /** The clip's buffer is handed to the worker, not copied: `pcm` is empty afterwards. */
  hearClip(pcm: Float32Array): Promise<Float32Array> {
    // A shared buffer is not copied either; only a plain one can be handed over.
    const transfer = pcm.buffer instanceof ArrayBuffer ? [pcm.buffer] : []
    return this.#serial(() => this.#ask(id => ({ id, op: 'hear', pcm }), transfer))
  }

  readText(text: string): Promise<Float32Array> {
    return this.#serial(() => this.#ask(id => ({ id, op: 'read', text })))
  }

  /** Let the worker release its sessions, then end it. */
  async close(): Promise<void> {
    const running = this.#running
    this.#running = null
    if (!running) return
    const { worker } = running
    await new Promise<void>(resolve => {
      const done = (): void => {
        worker.off('message', onMessage)
        worker.off('exit', done)
        resolve()
      }
      const onMessage = (reply: Clamp3Reply): void => {
        if ('op' in reply) done()
      }
      worker.on('message', onMessage)
      worker.on('exit', done)
      worker.ref()
      worker.postMessage({ op: 'close' } satisfies Clamp3Request)
    })
    await worker.terminate()
  }

  #serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(work, work)
    this.#queue = run.catch(() => undefined)
    return run
  }

  #ask(
    request: (id: number) => Clamp3Request,
    transfer: ArrayBuffer[] = [],
  ): Promise<Float32Array> {
    const running = (this.#running ??= this.#start())
    const id = this.#nextId++
    return new Promise((resolve, reject) => {
      running.jobs.set(id, { resolve, reject })
      // Held open while it works, so a script awaiting a vector is not left to
      // exit; let go when idle, so the worker never keeps the server up.
      running.worker.ref()
      running.worker.postMessage(request(id), transfer)
    })
  }

  #start(): Running {
    const worker = new Worker(this.#script, {
      workerData: this.#data satisfies Clamp3WorkerData,
      execArgv: this.#execArgv,
    })
    const running: Running = { worker, jobs: new Map() }
    let failure: Error | null = null

    worker.on('message', (reply: Clamp3Reply) => {
      if (!('id' in reply)) return
      const job = running.jobs.get(reply.id)
      if (!job) return
      running.jobs.delete(reply.id)
      if (running.jobs.size === 0) worker.unref()
      if ('error' in reply) job.reject(new Error(reply.error))
      else job.resolve(reply.vector)
    })
    worker.on('error', error => {
      failure = error
    })
    worker.on('exit', code => {
      if (this.#running === running) this.#running = null
      const reason = new Error(
        failure
          ? `the listening model stopped: ${failure.message}`
          : `the listening model stopped (exit code ${code})`,
      )
      for (const job of running.jobs.values()) job.reject(reason)
      running.jobs.clear()
    })
    worker.unref()
    return running
  }
}
