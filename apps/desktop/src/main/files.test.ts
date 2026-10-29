import { createHash } from 'node:crypto'
import type * as fs from 'node:fs'
import type { WriteStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { download, move, unpackTo } from './files.js'

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

  it('keeps no second copy in the HTTP cache: the file is the one', async () => {
    harness.fetch.mockResolvedValue(respond(200, [bytes('hello')]).response)
    await download({ id: 'd1', kind: 'songs', name: '1.m4a', url: 'https://s.example/1' }, () => {})
    expect(harness.fetch.mock.calls[0]?.[1].cache).toBe('no-store')
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

  it('starts over when the .part already reaches the end of the file', async () => {
    const songs = join(harness.userData, 'songs')
    await mkdir(songs, { recursive: true })
    await writeFile(join(songs, '1.m4a.part'), 'hello')
    harness.fetch
      .mockResolvedValueOnce(new Response(null, { status: 416 }))
      .mockResolvedValueOnce(respond(200, [bytes('hello')]).response)

    const result = await download(
      { id: 'd6', kind: 'songs', name: '1.m4a', url: 'https://s.example/1' },
      () => {},
    )

    expect(harness.fetch.mock.calls[0]?.[1].headers['Range']).toBe('bytes=5-')
    expect(harness.fetch.mock.calls[1]?.[1].headers['Range']).toBeUndefined()
    expect(result).toEqual({ state: 'done', bytes: 5 })
    expect(await readFile(join(songs, '1.m4a'), 'utf8')).toBe('hello')
  })

  it('says what a refusal said, not only its status', async () => {
    const refused = {
      ok: false,
      status: 502,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () =>
        Promise.resolve(
          JSON.stringify({
            error: 'Backblaze says “Transaction cap exceeded”.',
            code: 'bucket_cap_exceeded',
          }),
        ),
    } as unknown as Response
    harness.fetch.mockResolvedValue(refused)
    await expect(
      download(
        { id: 'd4', kind: 'songs', name: '1.m4a', url: 'https://doorman.example/f' },
        () => {},
      ),
    ).rejects.toThrow('502 from doorman.example: Backblaze says “Transaction cap exceeded”.')

    const page = {
      ...refused,
      text: () => Promise.resolve('<html><body>error code: 1027</body></html>'),
    } as unknown as Response
    harness.fetch.mockResolvedValue(page)
    await expect(
      download(
        { id: 'd5', kind: 'songs', name: '2.m4a', url: 'https://doorman.example/f' },
        () => {},
      ),
    ).rejects.toThrow('502 from doorman.example: error code: 1027')
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

describe('move', () => {
  beforeEach(async () => {
    harness.userData = await mkdtemp(join(tmpdir(), 'selfmp3-move-'))
  })
  afterEach(async () => {
    await rm(harness.userData, { recursive: true, force: true })
  })

  it('hands a played copy to the downloads under its own name', async () => {
    await mkdir(join(harness.userData, 'recent'), { recursive: true })
    await writeFile(join(harness.userData, 'recent', 'a.m4a'), 'twelve bytes')

    expect(await move('recent', 'songs', 'a.m4a')).toEqual({ name: 'a.m4a', bytes: 12 })
    expect(await readFile(join(harness.userData, 'songs', 'a.m4a'), 'utf8')).toBe('twelve bytes')
    await expect(stat(join(harness.userData, 'recent', 'a.m4a'))).rejects.toThrow()
  })

  it('says there was nothing to move', async () => {
    expect(await move('recent', 'songs', 'gone.m4a')).toBeNull()
  })
})

describe('unpackTo', () => {
  beforeEach(async () => {
    harness.userData = await mkdtemp(join(tmpdir(), 'selfmp3-unpack-'))
    harness.fetch.mockReset()
  })
  afterEach(async () => {
    await rm(harness.userData, { recursive: true, force: true })
  })

  const named = (text: string, extension: string): string =>
    `${createHash('sha256').update(text).digest('hex')}.${extension}`

  it('keeps each picture of a pack under its name, and none whose bytes are not that name', async () => {
    const pack = 'first-coversecond-cover'
    harness.fetch.mockResolvedValue(new Response(pack))
    const first = named('first-cover', 'jpg')
    const second = named('second-cover', 'png')
    const wrong = named('something else', 'jpg')

    await unpackTo(
      'covers',
      'https://doorman.example/v1/files/covers/p.pack',
      { Authorization: 'Bearer t' },
      [
        { name: first, at: 0, size: 11 },
        { name: second, at: 11, size: 12 },
        // Where the page said, but not the bytes its name promises.
        { name: wrong, at: 0, size: 11 },
      ],
    )

    expect(harness.fetch).toHaveBeenCalledWith('https://doorman.example/v1/files/covers/p.pack', {
      headers: { Authorization: 'Bearer t' },
      cache: 'no-store',
    })
    expect(await readFile(join(harness.userData, 'covers', first), 'utf8')).toBe('first-cover')
    expect(await readFile(join(harness.userData, 'covers', second), 'utf8')).toBe('second-cover')
    await expect(stat(join(harness.userData, 'covers', wrong))).rejects.toThrow()
  })

  it('keeps nothing from a refusal', async () => {
    harness.fetch.mockResolvedValue(new Response('{"error":"no such file"}', { status: 404 }))
    await expect(
      unpackTo('covers', 'https://doorman.example/v1/files/covers/p.pack', {}, [
        { name: named('x', 'jpg'), at: 0, size: 1 },
      ]),
    ).rejects.toThrow()
  })
})
