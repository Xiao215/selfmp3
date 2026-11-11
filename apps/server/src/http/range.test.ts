import { once } from 'node:events'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { addAbortSignal, Readable } from 'node:stream'
import express from 'express'
import { afterEach, describe, expect, it } from 'vitest'
import { createLogger } from '../logger.js'
import { errorHandler } from './errors.js'
import { sendRange, type RangeSource } from './range.js'

/**
 * The streaming half of a range request, over a real socket: what `pipeline`
 * does with the upstream when the client goes, and what a source that fails
 * before its first byte turns into. Both used to be lost in a hand-built relay
 * stream between the source and the response.
 */

const BYTES = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz')

interface Opened {
  readonly start: number
  readonly end: number
  readonly signal: AbortSignal
  readonly stream: Readable
}

function source(behaviour: { fail?: Error; slow?: boolean; late?: boolean } = {}): {
  source: RangeSource
  opened: Opened[]
} {
  const opened: Opened[] = []
  return {
    opened,
    source: {
      sizeBytes: BYTES.length,
      mime: 'audio/mpeg',
      etag: '"x"',
      lastModified: new Date(0),
      open: async (start, end, signal) => {
        if (behaviour.fail) throw behaviour.fail
        if (behaviour.late) {
          // Opened only once the client has already gone, and tied to the same
          // signal the way `fs.createReadStream` is: it errors itself next tick.
          if (!signal.aborted) await once(signal, 'abort')
          const stream = addAbortSignal(signal, new Readable({ read() {} }))
          opened.push({ start, end, signal, stream })
          return stream
        }
        let sent = false
        const stream = behaviour.slow
          ? // One byte, then nothing until destroyed: a bucket that has stalled.
            new Readable({
              read() {
                if (sent) return
                sent = true
                this.push(BYTES.subarray(start, start + 1))
              },
            })
          : Readable.from([BYTES.subarray(start, end + 1)])
        opened.push({ start, end, signal, stream })
        return stream
      },
    },
  }
}

let server: http.Server | null = null

async function serve(ranged: RangeSource): Promise<string> {
  const app = express()
  app.get('/song', (req, res, next) => sendRange(req, res, ranged).catch(next))
  app.use(errorHandler(createLogger('silent')))
  server = http.createServer(app)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo
  return `http://127.0.0.1:${port}/song`
}

afterEach(async () => {
  if (server) await new Promise(resolve => server?.close(resolve))
  server = null
})

describe('sendRange', () => {
  it('streams the bytes asked for, with a 206 and the range headers', async () => {
    const { source: ranged, opened } = source()
    const url = await serve(ranged)
    const response = await fetch(url, { headers: { Range: 'bytes=10-19' } })
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe(`bytes 10-19/${BYTES.length}`)
    expect(await response.text()).toBe('abcdefghij')
    expect(opened[0]).toMatchObject({ start: 10, end: 19 })
  })

  it('says the size on a 416, and no range on a whole file or a 304', async () => {
    const url = await serve(source().source)
    const past = await fetch(url, { headers: { Range: 'bytes=999-' } })
    expect(past.status).toBe(416)
    expect(past.headers.get('content-range')).toBe(`bytes */${BYTES.length}`)

    const whole = await fetch(url)
    expect(whole.status).toBe(200)
    expect(whole.headers.get('content-range')).toBeNull()
    expect(whole.headers.get('content-length')).toBe(String(BYTES.length))
    expect(await whole.text()).toBe(BYTES.toString())

    const kept = await fetch(url, { headers: { Range: 'bytes=0-9', 'If-None-Match': '"x"' } })
    expect(kept.status).toBe(304)
    expect(kept.headers.get('content-range')).toBeNull()
    expect(kept.headers.get('etag')).toBe('"x"')
  })

  it('answers a source that fails before its first byte as an error, not a crash', async () => {
    const { source: ranged } = source({ fail: new Error('the bucket has no such file') })
    const url = await serve(ranged)
    const response = await fetch(url, { headers: { Range: 'bytes=0-9' } })
    expect(response.status).toBe(500)
  })

  it('calls the source off and destroys its stream when the client goes', async () => {
    const { source: ranged, opened } = source({ slow: true })
    const url = await serve(ranged)
    const gone = new AbortController()
    const request = fetch(url, { headers: { Range: 'bytes=0-9' }, signal: gone.signal })
    // Wait for the first byte to have been opened for, then walk away mid-stream.
    const response = await request
    const reader = response.body?.getReader()
    await reader?.read()
    gone.abort()
    await expect(reader?.read()).rejects.toThrow()

    const first = opened[0]
    if (!first) throw new Error('the source was never opened')
    // `pipeline` tears the upstream down with the response; nothing is left
    // pulling from a bucket for a listener who has moved on.
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(first.stream.destroyed).toBe(true)
    expect(first.signal.aborted).toBe(true)
  })

  it('lets go of a stream that opens after the client has gone, without crashing', async () => {
    const { source: ranged, opened } = source({ late: true })
    const url = await serve(ranged)
    // `pipeline` refuses a response that has already closed and never touches
    // the upstream: its AbortError then had nobody listening and took the
    // whole server down (R6A-3).
    const crashes: unknown[] = []
    const crash = (error: unknown): void => void crashes.push(error)
    process.prependListener('uncaughtException', crash)
    try {
      const gone = new AbortController()
      const request = fetch(url, { headers: { Range: 'bytes=0-9' }, signal: gone.signal })
      await new Promise(resolve => setTimeout(resolve, 20))
      gone.abort()
      await expect(request).rejects.toThrow()
      await new Promise(resolve => setTimeout(resolve, 50))
    } finally {
      process.off('uncaughtException', crash)
    }
    expect(crashes).toEqual([])
    expect(opened[0]?.stream.destroyed).toBe(true)
  })
})
