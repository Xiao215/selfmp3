import type * as fs from 'node:fs'
import type { WriteStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { download, progressGate } from './files.js'

/*
 * The shell's two edges, faked at the boundary and nowhere nearer: `electron`
 * for where files go and where bytes come from, and `createWriteStream` only
 * so a test can hold the real sink and fail it the way a full disk would.
 */
const harness = vi.hoisted(() => ({
  userData: '',
  fetch: vi.fn<(url: string, init: { headers: Record<string, string> }) => Promise<Response>>(),
  sinks: [] as WriteStream[],
}))

vi.mock('electron', () => ({
  app: { getPath: () => harness.userData },
  net: { fetch: harness.fetch },
  shell: {},
}))

vi.mock('node:fs', async importOriginal => {
  const real = await importOriginal<typeof fs>()
  return {
    ...real,
    createWriteStream: (...args: Parameters<typeof real.createWriteStream>) => {
      const sink = real.createWriteStream(...args)
      harness.sinks.push(sink)
      return sink
    },
  }
})

/** A response whose body hands out `chunks` one read at a time, then whatever `after` says. */
function respond(
  status: number,
  chunks: Uint8Array[],
  after: () => Promise<ReadableStreamReadResult<Uint8Array>> = () =>
    Promise.resolve({ done: true, value: undefined }),
): { response: Response; cancelled: () => boolean } {
  let cancelled = false
  const queue = [...chunks]
  const reader = {
    read: () => {
      const value = queue.shift()
      return value === undefined ? after() : Promise.resolve({ done: false, value })
    },
    cancel: () => {
      cancelled = true
      return Promise.resolve()
    },
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const response = {
    ok: status < 400,
    status,
    headers: new Headers({ 'Content-Length': String(total) }),
    body: { getReader: () => reader },
  } as unknown as Response
  return { response, cancelled: () => cancelled }
}

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)

describe('download', () => {
  beforeEach(async () => {
    harness.userData = await mkdtemp(join(tmpdir(), 'selfmp3-files-'))
    harness.sinks.length = 0
    harness.fetch.mockReset()
  })
  afterEach(async () => {
    await rm(harness.userData, { recursive: true, force: true })
  })

  it('writes through a .part and only then gives the file its name', async () => {
    harness.fetch.mockResolvedValue(respond(200, [bytes('hel'), bytes('lo')]).response)
    const seen: [number, number][] = []

    const result = await download(
      { id: 'd1', kind: 'songs', name: '1.m4a', url: 'https://s.example/1' },
      (written, total) => seen.push([written, total]),
    )

    expect(result).toEqual({ state: 'done', bytes: 5 })
    const songs = join(harness.userData, 'songs')
    expect(await readFile(join(songs, '1.m4a'), 'utf8')).toBe('hello')
    await expect(stat(join(songs, '1.m4a.part'))).rejects.toThrow()
    expect(seen.at(-1)).toEqual([5, 5])
  })

  it('continues from what the .part holds, and nothing the page might have said', async () => {
    const songs = join(harness.userData, 'songs')
    await mkdir(songs, { recursive: true })
    await writeFile(join(songs, '1.m4a.part'), 'hel')
    harness.fetch.mockResolvedValue(respond(206, [bytes('lo')]).response)

    const result = await download(
      { id: 'd2', kind: 'songs', name: '1.m4a', url: 'https://s.example/1' },
      () => {},
    )

    expect(harness.fetch.mock.calls[0]?.[1].headers['Range']).toBe('bytes=3-')
    expect(result).toEqual({ state: 'done', bytes: 5 })
    expect(await readFile(join(songs, '1.m4a'), 'utf8')).toBe('hello')
  })

  /*
   * The case that used to take the whole main process down: the disk fails a
   * write that had already returned `true`, so the stream's `error` fires
   * while the loop is waiting on the network and nobody is waiting on `drain`.
   */
  it('fails the download, not the process, when the disk errors between writes', async () => {
    const stalled = respond(200, [bytes('hel')], () => {
      // The first chunk is written; now the network goes quiet and the disk gives out.
      const sink = harness.sinks[0]
      if (sink === undefined) throw new Error('no sink yet')
      sink.destroy(new Error('ENOSPC: no space left on device'))
      return new Promise(() => {})
    })
    harness.fetch.mockResolvedValue(stalled.response)

    await expect(
      download({ id: 'd3', kind: 'songs', name: '1.m4a', url: 'https://s.example/1' }, () => {}),
    ).rejects.toThrow('ENOSPC')

    // Nothing pretends to be a whole song, and the network was told to stop.
    const songs = join(harness.userData, 'songs')
    await expect(stat(join(songs, '1.m4a'))).rejects.toThrow()
    expect(stalled.cancelled()).toBe(true)
  })
})

describe('progressGate', () => {
  it('lets the first report through, then one per interval', () => {
    let now = 0
    const gate = progressGate(250, () => now)
    expect(gate.due()).toBe(true)
    expect(gate.owed()).toBe(false)

    now = 10
    expect(gate.due()).toBe(false)
    now = 249
    expect(gate.due()).toBe(false)
    now = 250
    expect(gate.due()).toBe(true)
  })

  it('knows when the bytes since the last report were never sent, so the final one is', () => {
    let now = 0
    const gate = progressGate(250, () => now)
    gate.due()
    now = 100
    gate.due()
    expect(gate.owed()).toBe(true)

    now = 400
    gate.due()
    // Just sent: a final report would repeat it.
    expect(gate.owed()).toBe(false)
  })
})
