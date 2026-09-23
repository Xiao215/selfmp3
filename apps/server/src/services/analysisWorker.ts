import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { analyzePcm, type PcmFeatures } from './dsp.js'

/**
 * `analyzePcm` on a worker thread.
 *
 * The DSP is a straight chain of loops over a Float32Array with no await in
 * it, about four hundred milliseconds for a two-minute clip — and it ran on
 * the thread that answers every request, so a seek or a page load that
 * arrived during it waited for it. A worker is the platform's answer: one
 * per song, made here and gone when it has posted its result, so a worker
 * that dies can wedge nothing. The PCM buffer is transferred, not copied.
 *
 * This file is both sides. Loaded by the main thread it exports the caller;
 * started as a worker it runs the analysis and posts the answer.
 */

interface WorkerInput {
  readonly pcm: Float32Array
  readonly sampleRate: number
}

export function analyzePcmInWorker(
  pcm: Float32Array,
  sampleRate: number,
  timeoutMs: number,
): Promise<PcmFeatures> {
  return new Promise((resolve, reject) => {
    const input: WorkerInput = { pcm, sampleRate }
    const worker = new Worker(new URL(import.meta.url), {
      workerData: input,
      // Handed over, not copied; a shared buffer cannot be, and is not.
      transferList: pcm.buffer instanceof ArrayBuffer ? [pcm.buffer] : [],
    })
    let settled = false
    const settle = (outcome: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      outcome()
      void worker.terminate()
    }
    const timer = setTimeout(
      () => settle(() => reject(new Error(`analysis took longer than ${timeoutMs} ms`))),
      timeoutMs,
    )
    worker.once('message', (features: PcmFeatures) => settle(() => resolve(features)))
    worker.once('error', error => settle(() => reject(error)))
    worker.once('exit', code =>
      settle(() => reject(new Error(`the analysis worker exited with code ${code}`))),
    )
  })
}

if (!isMainThread && parentPort) {
  const { pcm, sampleRate } = workerData as WorkerInput
  parentPort.postMessage(analyzePcm(pcm, sampleRate))
}
