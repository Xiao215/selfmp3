import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Clamp3Worker } from './clamp3Worker.js'

/**
 * A stand-in for clamp3.worker.ts, speaking its messages. Hearing holds its
 * thread for a second, as a pass on a Pi does; reading "crash" ends the
 * thread, and reading "throw" throws out of it.
 */
const FAKE = new URL(
  `data:text/javascript,${encodeURIComponent(`
    import { parentPort } from 'node:worker_threads'
    parentPort.on('message', request => {
      if (request.op === 'close') return parentPort.postMessage({ op: 'closed' })
      if (request.op === 'read' && request.text === 'crash') process.exit(3)
      if (request.op === 'read' && request.text === 'throw') throw new Error('boom')
      if (request.op === 'read' && request.text === 'fail') {
        return parentPort.postMessage({ id: request.id, error: 'no such word' })
      }
      if (request.op === 'hear') {
        const until = Date.now() + 1000
        while (Date.now() < until) {}
      }
      const size = request.op === 'hear' ? request.pcm.length : request.text.length
      parentPort.postMessage({ id: request.id, vector: new Float32Array([size]) })
    })
  `)}`,
)

describe('Clamp3Worker', () => {
  let model: Clamp3Worker | null = null
  afterEach(async () => {
    await model?.close()
    model = null
  })

  it('leaves the event loop free while the model works', async () => {
    model = new Clamp3Worker('unused', 2, { script: FAKE, execArgv: [] })
    let last = performance.now()
    let worst = 0
    const tick = setInterval(() => {
      const now = performance.now()
      worst = Math.max(worst, now - last)
      last = now
    }, 10)
    try {
      const pcm = new Float32Array(48_000)
      expect(Array.from(await model.hearClip(pcm))).toEqual([48_000])
      // Handed over, not copied.
      expect(pcm.length).toBe(0)
    } finally {
      clearInterval(tick)
    }
    expect(worst).toBeLessThan(100)
  })

  it('passes a failure back without losing the worker', async () => {
    model = new Clamp3Worker('unused', 2, { script: FAKE, execArgv: [] })
    await expect(model.readText('fail')).rejects.toThrow('no such word')
    expect(Array.from(await model.readText('calm'))).toEqual([4])
  })

  it.each([
    ['exits', 'crash', 'exit code 3'],
    ['throws', 'throw', 'boom'],
  ])('fails the pending job when the worker %s, and starts afresh after', async (_, text, says) => {
    model = new Clamp3Worker('unused', 2, { script: FAKE, execArgv: [] })
    const waiting = model.readText('calm')
    await expect(model.readText(text)).rejects.toThrow(says)
    expect(Array.from(await waiting)).toEqual([4])
    expect(Array.from(await model.readText('again'))).toEqual([5])
  })

  it('runs the real worker, which says what is missing', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-clamp3-'))
    try {
      // From source, the worker's TypeScript needs tsx, as `npm run dev` has.
      model = new Clamp3Worker(empty, 1, { execArgv: ['--import', 'tsx'] })
      await expect(model.hearClip(new Float32Array(24_000))).rejects.toThrow(/mert\.onnx/)
      await expect(model.readText('calm')).rejects.toThrow(/clamp3_text\.onnx|tokenizer/)
    } finally {
      await model?.close()
      model = null
      fs.rmSync(empty, { recursive: true, force: true })
    }
  }, 30_000)
})
