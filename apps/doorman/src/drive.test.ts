import { DoormanListSchema, DoormanMeSchema, ErrorBodySchema } from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'
import { utf8 } from './encoding.js'
import { harness, type Harness } from './fakes.js'

/**
 * A device's reads and writes when the account keeps its library in Google
 * Drive: the same requests files.test.ts makes of a bucket, answered the same
 * way, by a store that has no paths, no ETags and no Content-Encoding of its
 * own (drive.ts). Each test names the S3 behaviour a device leans on.
 */

const SHA = 'ab'.repeat(32)
const SONG = `audio/${SHA}.m4a`
const COVER = `covers/${SHA}.jpg`
const SNAPSHOT = 'snapshots/20260911T120000000Z-mac-3f9a1c2e.json'
const LOG = 'log/iphone-0b7d44a1/000000000001.json'

async function connected(): Promise<{ h: Harness; token: string; root: string }> {
  const h = harness()
  const token = await h.signIn()
  expect((await h.connectDrive(token)).status).toBe(200)
  const me = DoormanMeSchema.parse(await (await h.call('/v1/me', { token })).json())
  if (me.storage?.kind !== 'drive') throw new Error('Google Drive did not connect')
  h.drive.requests.length = 0
  return { h, token, root: me.storage.folder }
}

function put(
  h: Harness,
  token: string,
  key: string,
  body: string | Uint8Array,
  type = 'audio/mp4',
) {
  const bytes = typeof body === 'string' ? utf8(body) : body
  return h.call(`/v1/files/${key}`, {
    method: 'PUT',
    token,
    headers: { 'content-type': type, 'content-length': String(bytes.length) },
    body: new Blob([bytes]).stream(),
  })
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** The calls made to Drive since the last look, as `METHOD path`, searches told apart from reads. */
function calls(h: Harness): string[] {
  return h.drive.requests.splice(0).map(seen => {
    const { pathname, searchParams } = seen.url
    const what = searchParams.has('q')
      ? 'search'
      : searchParams.get('alt') === 'media'
        ? 'media'
        : (searchParams.get('uploadType') ?? '')
    return `${seen.method} ${pathname.replace(/files\/[^/]+$/, 'files/<id>')} ${what}`.trim()
  })
}

describe('a file in Google Drive', () => {
  it('goes up as a stream, in a search and a two-step upload, and comes back whole', async () => {
    const { h, token, root } = await connected()
    expect((await put(h, token, SONG, 'the whole song')).status).toBe(204)
    expect(calls(h)).toEqual([
      'GET /drive/v3/files search',
      'POST /upload/drive/v3/files resumable',
      'PUT /upload/drive/v3/files resumable',
    ])
    // In the audio folder, under the rest of its key, with the type it was sent with.
    const stored = h.drive.find(root, SONG)
    expect(stored?.name).toBe(`${SHA}.m4a`)
    expect(stored?.mimeType).toBe('audio/mp4')
    // Nothing is said of an encoding the file does not have.
    expect(stored?.appProperties).toEqual({})

    const response = await h.call(`/v1/files/${SONG}`, { token })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('the whole song')
    expect(response.headers.get('content-type')).toBe('audio/mp4')
    expect(response.headers.get('content-length')).toBe('14')
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(response.headers.get('cache-control')).toBe('private, max-age=31536000, immutable')
    // The instance that wrote the file knows its id: reading it is one call.
    expect(calls(h)).toEqual(['GET /drive/v3/files/<id> media'])
  })

  it('is found by name once, and by its remembered id after that', async () => {
    const { h, token, root } = await connected()
    const audio =
      [...h.drive.files.values()].find(file => file.name === 'audio' && file.parents.includes(root))
        ?.id ?? ''
    h.drive.add(audio, `${SHA}.m4a`, 'already there', 'audio/mp4')

    expect(await (await h.call(`/v1/files/${SONG}`, { token })).text()).toBe('already there')
    expect(calls(h)).toEqual(['GET /drive/v3/files search', 'GET /drive/v3/files/<id> media'])
    expect(await (await h.call(`/v1/files/${SONG}`, { token })).text()).toBe('already there')
    expect(calls(h)).toEqual(['GET /drive/v3/files/<id> media'])
  })

  it('answers a range with exactly that slice, as the server’s streaming assumes', async () => {
    const { h, token } = await connected()
    await put(h, token, SONG, '0123456789')
    const part = await h.call(`/v1/files/${SONG}`, { token, headers: { range: 'bytes=2-5' } })
    expect(part.status).toBe(206)
    expect(await part.text()).toBe('2345')
    expect(part.headers.get('content-range')).toBe('bytes 2-5/10')
    expect(part.headers.get('content-length')).toBe('4')

    const rest = await h.call(`/v1/files/${SONG}`, { token, headers: { range: 'bytes=7-' } })
    expect(await rest.text()).toBe('789')

    const past = await h.call(`/v1/files/${SONG}`, { token, headers: { range: 'bytes=50-' } })
    expect(past.status).toBe(416)
    expect(past.headers.get('content-range')).toBe('bytes */10')
    expect(ErrorBodySchema.parse(await past.json()).code).toBe('range_not_satisfiable')
  })

  it('answers a HEAD from what Drive knows, without reading the file', async () => {
    const { h, token } = await connected()
    await put(h, token, SONG, '0123456789')
    calls(h)
    const head = await h.call(`/v1/files/${SONG}`, { method: 'HEAD', token })
    expect(head.status).toBe(200)
    expect(head.headers.get('content-length')).toBe('10')
    expect(head.headers.get('content-type')).toBe('audio/mp4')
    expect(await head.text()).toBe('')
    expect(calls(h)).toEqual([])
  })

  it('gives each file a tag and a date, and honours a device’s conditions with them', async () => {
    const { h, token } = await connected()
    await put(h, token, SNAPSHOT, 'one', 'application/json')
    const first = await h.call(`/v1/files/${SNAPSHOT}`, { token })
    const etag = first.headers.get('etag') ?? ''
    expect(etag).toMatch(/^"[0-9a-z]{32}"$/)
    expect(first.headers.get('last-modified')).toMatch(/GMT$/)
    calls(h)

    // A browser looking again at a snapshot it has: nothing is read from Drive.
    const same = await h.call(`/v1/files/${SNAPSHOT}`, {
      token,
      headers: { 'if-none-match': etag },
    })
    expect(same.status).toBe(304)
    expect(same.headers.get('etag')).toBe(etag)
    expect(calls(h)).toEqual([])

    const other = await h.call(`/v1/files/${SNAPSHOT}`, {
      token,
      headers: { 'if-none-match': '"something-else"' },
    })
    expect(other.status).toBe(200)

    const unless = await h.call(`/v1/files/${SNAPSHOT}`, {
      token,
      headers: { 'if-match': '"something-else"' },
    })
    expect(unless.status).toBe(412)
    expect(ErrorBodySchema.parse(await unless.json()).code).toBe('precondition_failed')
  })

  it('resumes a download only while the file is the one the device began with', async () => {
    const { h, token } = await connected()
    await put(h, token, SONG, '0123456789')
    const etag = (await h.call(`/v1/files/${SONG}`, { method: 'HEAD', token })).headers.get('etag')

    const resumed = await h.call(`/v1/files/${SONG}`, {
      token,
      headers: { range: 'bytes=5-', 'if-range': etag ?? '' },
    })
    expect(resumed.status).toBe(206)
    expect(await resumed.text()).toBe('56789')

    const changed = await h.call(`/v1/files/${SONG}`, {
      token,
      headers: { range: 'bytes=5-', 'if-range': '"another-file"' },
    })
    expect(changed.status).toBe(200)
    expect(await changed.text()).toBe('0123456789')
  })

  it('keeps a snapshot’s gzip as stored, and says so, which a phone depends on', async () => {
    const { h, token, root } = await connected()
    const zipped = await gzip('{"songs":[]}')
    const sent = await h.call(`/v1/files/${SNAPSHOT}`, {
      method: 'PUT',
      token,
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        'content-length': String(zipped.length),
      },
      body: new Blob([zipped]).stream(),
    })
    expect(sent.status).toBe(204)
    expect(sent.headers.get('selfmp3-changes')).toMatch(/^\S+ \S+$/)
    expect(h.drive.find(root, SNAPSHOT)?.appProperties).toEqual({ encoding: 'gzip' })

    const response = await h.call(`/v1/files/${SNAPSHOT}`, { token })
    expect(response.headers.get('content-encoding')).toBe('gzip')
    expect(response.headers.get('content-length')).toBe(String(zipped.length))
    expect(response.headers.get('cache-control')).toBe('private, no-cache')
  })

  it('replaces a file sent twice rather than leaving a twin', async () => {
    const { h, token, root } = await connected()
    await put(h, token, LOG, '{"n":1}', 'application/json')
    calls(h)
    expect((await put(h, token, LOG, '{"n":1}', 'application/json')).status).toBe(204)
    expect(calls(h)).toEqual([
      'GET /drive/v3/files search',
      'PATCH /upload/drive/v3/files/<id> resumable',
      'PUT /upload/drive/v3/files/<id> resumable',
    ])
    expect(h.drive.all(root, LOG)).toHaveLength(1)
    // A log file's name is the rest of its key, slash and all, in the one log folder.
    expect(h.drive.find(root, LOG)?.name).toBe('iphone-0b7d44a1/000000000001.json')
  })

  it('reads the oldest of two files that raced each other, and deletes both', async () => {
    const { h, token, root } = await connected()
    await put(h, token, COVER, 'first', 'image/jpeg')
    const covers = h.drive.find(root, COVER)?.parents[0] ?? ''
    h.drive.add(covers, `${SHA}.jpg`, 'second', 'image/jpeg')
    expect(h.drive.all(root, COVER)).toHaveLength(2)

    expect(await (await h.call(`/v1/files/${COVER}`, { token })).text()).toBe('first')
    const listing = DoormanListSchema.parse(
      await (await h.call('/v1/list?prefix=covers/', { token })).json(),
    )
    expect(listing.objects).toEqual([{ key: COVER, size: 5 }])

    expect((await h.call(`/v1/files/${COVER}`, { method: 'DELETE', token })).status).toBe(204)
    expect(h.drive.all(root, COVER)).toHaveLength(0)
    expect((await h.call(`/v1/files/${COVER}`, { token })).status).toBe(404)
  })

  it('deletes for good, and deleting what is gone is not an error', async () => {
    const { h, token, root } = await connected()
    await put(h, token, SONG, 'abc')
    expect((await h.call(`/v1/files/${SONG}`, { method: 'DELETE', token })).status).toBe(204)
    expect(h.drive.find(root, SONG)).toBeNull()
    expect((await h.call(`/v1/files/${SONG}`, { method: 'DELETE', token })).status).toBe(204)
    expect((await h.call(`/v1/files/${SONG}`, { method: 'HEAD', token })).status).toBe(404)
  })

  it('finds a file again by name when the id it remembered is gone', async () => {
    const { h, token, root } = await connected()
    await put(h, token, SONG, 'old upload')
    // Deleted and sent again somewhere this instance did not see: a new id.
    const old = h.drive.find(root, SONG)
    h.drive.files.delete(old?.id ?? '')
    h.drive.add(old?.parents[0] ?? '', `${SHA}.m4a`, 'new upload', 'audio/mp4')
    calls(h)

    expect(await (await h.call(`/v1/files/${SONG}`, { token })).text()).toBe('new upload')
    expect(calls(h)).toEqual([
      'GET /drive/v3/files/<id> media',
      'GET /drive/v3/files search',
      'GET /drive/v3/files/<id> media',
    ])
  })

  it('still refuses format.json to a device', async () => {
    const { h, token } = await connected()
    expect((await put(h, token, 'format.json', '{}', 'application/json')).status).toBe(403)
    expect((await h.call('/v1/files/format.json', { method: 'DELETE', token })).status).toBe(403)
    const format = await h.call('/v1/files/format.json', { token })
    expect(JSON.parse(await format.text())).toMatchObject({ app: 'self.mp3' })
  })
})

describe('listing a Google Drive', () => {
  it('lists a folder with exact sizes, and only the library’s own files', async () => {
    const { h, token, root } = await connected()
    await put(h, token, SONG, 'abc')
    await put(h, token, `audio/${'cd'.repeat(32)}.mp3`, 'defgh')
    const audio = h.drive.find(root, SONG)?.parents[0] ?? ''
    h.drive.add(audio, 'notes.txt', 'someone put this here')
    calls(h)

    const response = await h.call('/v1/list?prefix=audio/', { token })
    const listing = DoormanListSchema.parse(await response.json())
    expect(listing).toEqual({
      objects: [
        { key: SONG, size: 3 },
        { key: `audio/${'cd'.repeat(32)}.mp3`, size: 5 },
      ],
      cursor: null,
    })
    expect(calls(h)).toEqual(['GET /drive/v3/files search'])
  })

  it('lists one device’s log by the start of its files’ names', async () => {
    const { h, token } = await connected()
    await put(h, token, LOG, '{}', 'application/json')
    await put(h, token, 'log/mac-3f9a1c2e/000000000007.json', '{}', 'application/json')

    const all = DoormanListSchema.parse(
      await (await h.call('/v1/list?prefix=log/', { token })).json(),
    )
    expect(all.objects.map(object => object.key)).toEqual([
      LOG,
      'log/mac-3f9a1c2e/000000000007.json',
    ])
    const one = DoormanListSchema.parse(
      await (await h.call('/v1/list?prefix=log/mac-3f9a1c2e/', { token })).json(),
    )
    expect(one.objects.map(object => object.key)).toEqual(['log/mac-3f9a1c2e/000000000007.json'])
  })

  it('pages through a big folder, and through every folder for the whole library', async () => {
    const { h, token } = await connected()
    h.drive.pageSize = 2
    const names = ['11', '22', '33', '44', '55'].map(pair => `audio/${pair.repeat(32)}.m4a`)
    for (const name of names) await put(h, token, name, 'x')
    await put(h, token, SNAPSHOT, '{}', 'application/json')

    const walk = async (prefix: string): Promise<string[]> => {
      const keys: string[] = []
      let cursor: string | null = null
      let pages = 0
      do {
        const query = new URLSearchParams({ prefix })
        if (cursor) query.set('cursor', cursor)
        const page = DoormanListSchema.parse(
          await (await h.call(`/v1/list?${query.toString()}`, { token })).json(),
        )
        keys.push(...page.objects.map(object => object.key))
        cursor = page.cursor
        pages += 1
      } while (cursor && pages < 20)
      return keys
    }
    expect(await walk('audio/')).toEqual(names)
    // Every folder in the order of its keys: audio, covers, format.json, log, lyrics, snapshots.
    expect(await walk('')).toEqual([...names, 'format.json', SNAPSHOT])
  })
})

describe('Google’s tokens', () => {
  it('makes one access token and uses it for an hour, then makes another', async () => {
    const { h, token } = await connected()
    const made = h.google.refreshes
    await put(h, token, SONG, 'abc')
    await h.call(`/v1/files/${SONG}`, { token })
    await h.call('/v1/list?prefix=audio/', { token })
    expect(h.google.refreshes).toBe(made)

    h.clock.now += 56 * 60_000
    expect((await h.call(`/v1/files/${SONG}`, { token })).status).toBe(200)
    expect(h.google.refreshes).toBe(made + 1)
  })

  it('makes a new token when Drive stops taking the one in hand', async () => {
    const { h, token } = await connected()
    await put(h, token, SONG, 'abc')
    const made = h.google.refreshes
    // Google's hour ran out sooner than it said.
    h.google.expireAccess()

    expect(await (await h.call(`/v1/files/${SONG}`, { token })).text()).toBe('abc')
    expect(h.google.refreshes).toBe(made + 1)
  })

  it('says to connect again once Google has taken the access away', async () => {
    const { h, token } = await connected()
    await put(h, token, SONG, 'abc')
    h.google.refreshTokens.clear()

    const response = await h.call(`/v1/files/${SONG}`, { token })
    expect(response.status).toBe(502)
    const body = ErrorBodySchema.parse(await response.json())
    expect(body.code).toBe('bucket_refused_key')
    expect(body.error).toContain('Connect Google Drive again')
  })
})

describe('what Drive refuses', () => {
  it('passes a rate limit on as busy, which a player waits out', async () => {
    const { h, token } = await connected()
    await put(h, token, SONG, 'abc')
    h.drive.busy = true
    const response = await h.call(`/v1/files/${SONG}`, { token })
    expect(response.status).toBe(502)
    expect(ErrorBodySchema.parse(await response.json()).code).toBe('bucket_busy')
  })

  it('says the Google storage is full, and still reads', async () => {
    const { h, token } = await connected()
    await put(h, token, SONG, 'abc')
    h.drive.full = true
    const refused = await put(h, token, COVER, 'cover', 'image/jpeg')
    expect(refused.status).toBe(502)
    const body = ErrorBodySchema.parse(await refused.json())
    expect(body.code).toBe('storage_full')
    expect(body.error).toContain('Your Google storage is full')
    expect((await h.call(`/v1/files/${SONG}`, { token })).status).toBe(200)
  })

  it('says the folder is gone when it was deleted in Drive', async () => {
    const { h, token, root } = await connected()
    for (const id of [...h.drive.files.keys()]) h.drive.files.delete(id)
    expect(h.drive.find(root, 'format.json')).toBeNull()
    const response = await h.call('/v1/list?prefix=snapshots/', { token })
    expect(response.status).toBe(502)
    const body = ErrorBodySchema.parse(await response.json())
    expect(body.code).toBe('no_such_bucket')
    expect(body.error).toContain('no longer in your Google Drive')
  })

  it('says Drive could not be reached', async () => {
    const { h, token } = await connected()
    h.elsewhere.clear()
    const internet = h.drive.handle.bind(h.drive)
    h.drive.handle = () => Promise.reject(new TypeError('fetch failed'))
    const response = await h.call('/v1/list?prefix=audio/', { token })
    h.drive.handle = internet
    expect(response.status).toBe(502)
    expect(ErrorBodySchema.parse(await response.json()).code).toBe('bucket_unreachable')
  })
})
