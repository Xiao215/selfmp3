import { DoormanListSchema, ErrorBodySchema } from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'
import { utf8 } from './encoding.js'
import { APPLICATION_KEY, B2_HOST, harness, type Harness } from './fakes.js'

/**
 * A device's reads and writes, through the doorman to the bucket and back:
 * what reaches the bucket (under the account's folder, signed so a real
 * bucket would take it), and what comes back to the device (the bytes as
 * stored, with the headers it needs and nothing of the bucket's own).
 */

const SHA = 'ab'.repeat(32)
const SONG = `audio/${SHA}.m4a`
const SNAPSHOT = 'snapshots/20260911T120000000Z-mac-3f9a1c2e.json'
const LOG = 'log/iphone-0b7d44a1/000001.jsonl'

async function connected(): Promise<{ h: Harness; token: string }> {
  const h = harness()
  const token = await h.signIn()
  expect((await h.connect(token)).status).toBe(200)
  h.bucket.requests.length = 0
  return { h, token }
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

function signedHeaders(h: Harness): string {
  const auth = h.bucket.requests.at(-1)?.headers.get('authorization') ?? ''
  return /SignedHeaders=([^,]+)/.exec(auth)?.[1] ?? ''
}

async function error(response: Response) {
  return ErrorBodySchema.parse(await response.json())
}

describe('listing', () => {
  it('lists the library’s own files, relative to the account’s folder', async () => {
    const { h, token } = await connected()
    h.bucket.put(`selfmp3/${SONG}`, 'abc')
    h.bucket.put(`selfmp3/covers/${SHA}.jpg`, 'cover')
    h.bucket.put('selfmp3/notes.txt', 'not the library’s')
    h.bucket.put(`another-app/${SONG}`, 'not in this folder')

    const response = await h.call('/v1/list', { token })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const listing = DoormanListSchema.parse(await response.json())
    expect(listing.cursor).toBeNull()
    expect(listing.objects.map(object => object.key)).toEqual([
      SONG,
      `covers/${SHA}.jpg`,
      'format.json',
    ])
    expect(listing.objects[0]).toEqual({ key: SONG, size: 3 })

    const audio = DoormanListSchema.parse(
      await (await h.call('/v1/list?prefix=audio/', { token })).json(),
    )
    expect(audio.objects).toEqual([{ key: SONG, size: 3 }])
    expect(h.bucket.requests.at(-1)?.url.searchParams.get('prefix')).toBe('selfmp3/audio/')
  })

  it('pages through a big folder with the bucket’s own cursor', async () => {
    const { h, token } = await connected()
    h.bucket.pageSize = 2
    const keys = [1, 2, 3, 4, 5].map(n => `snapshots/2026091${n}T120000000Z-mac-3f9a1c2e.json`)
    for (const key of keys) h.bucket.put(`selfmp3/${key}`, '{}')

    const seen: string[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      const query = new URLSearchParams({ prefix: 'snapshots/' })
      if (cursor) query.set('cursor', cursor)
      const response = await h.call(`/v1/list?${query}`, { token })
      const page = DoormanListSchema.parse(await response.json())
      seen.push(...page.objects.map(object => object.key))
      cursor = page.cursor
      pages++
    } while (cursor && pages < 10)

    expect(seen).toEqual(keys)
    expect(pages).toBe(3)
  })

  it('refuses a folder that is not the library’s', async () => {
    const { h, token } = await connected()
    for (const prefix of ['audio', 'secret/', '../', 'log/../', 'snapshots/2026']) {
      const response = await h.call(`/v1/list?prefix=${encodeURIComponent(prefix)}`, { token })
      expect(response.status).toBe(400)
      expect((await error(response)).code).toBe('bad_request')
    }
    expect(h.bucket.requests).toEqual([])
  })

  it('refuses a made-up cursor shape', async () => {
    const { h, token } = await connected()
    expect((await h.call('/v1/list?cursor=', { token })).status).toBe(400)
    expect((await h.call(`/v1/list?cursor=${'x'.repeat(1025)}`, { token })).status).toBe(400)
  })
})

describe('reading a file', () => {
  it('passes the file through with the headers a device needs, and caches it for good', async () => {
    const { h, token } = await connected()
    const song = new Uint8Array(4096).map((_, index) => index % 251)
    h.bucket.put(`selfmp3/${SONG}`, song, { contentType: 'audio/mp4' })

    const response = await h.call(`/v1/files/${SONG}`, { token })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('audio/mp4')
    expect(response.headers.get('content-length')).toBe('4096')
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(response.headers.get('etag')).toMatch(/^"etag-\d+"$/)
    expect(response.headers.get('last-modified')).toBe('Fri, 11 Sep 2026 12:00:00 GMT')
    expect(response.headers.get('cache-control')).toBe('private, max-age=31536000, immutable')
    expect(response.headers.get('x-bz-file-id')).toBeNull()
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(song)

    const upstream = h.bucket.requests.at(-1)
    expect(upstream?.method).toBe('GET')
    expect(upstream?.url.pathname).toBe(`/my-music/selfmp3/${SONG}`)
    expect(upstream?.headers.get('x-amz-content-sha256')).toBe('UNSIGNED-PAYLOAD')
  })

  it('passes a range through as a 206, signing nothing the network might change', async () => {
    const { h, token } = await connected()
    h.bucket.put(`selfmp3/${SONG}`, '0123456789', { contentType: 'audio/mp4' })

    const response = await h.call(`/v1/files/${SONG}`, { token, headers: { range: 'bytes=2-5' } })
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 2-5/10')
    expect(response.headers.get('content-length')).toBe('4')
    expect(await response.text()).toBe('2345')
    expect(h.bucket.requests.at(-1)?.headers.get('range')).toBe('bytes=2-5')
    expect(signedHeaders(h)).toBe('host;x-amz-content-sha256;x-amz-date')
  })

  it('says a range is not in the file, with the file’s size', async () => {
    const { h, token } = await connected()
    h.bucket.put(`selfmp3/${SONG}`, '0123456789')
    const response = await h.call(`/v1/files/${SONG}`, { token, headers: { range: 'bytes=50-' } })
    expect(response.status).toBe(416)
    expect(response.headers.get('content-range')).toBe('bytes */10')
    expect((await error(response)).code).toBe('range_not_satisfiable')
  })

  it('answers 304 for a copy the device already has', async () => {
    const { h, token } = await connected()
    h.bucket.put(`selfmp3/${SONG}`, 'abc')
    const etag = (await h.call(`/v1/files/${SONG}`, { token })).headers.get('etag') ?? ''
    const response = await h.call(`/v1/files/${SONG}`, {
      token,
      headers: { 'if-none-match': etag },
    })
    expect(response.status).toBe(304)
    expect(response.body).toBeNull()
    expect(response.headers.get('etag')).toBe(etag)
    expect(response.headers.get('cache-control')).toBe('private, max-age=31536000, immutable')
  })

  it('still works when conditional headers go missing on the way to the bucket', async () => {
    const { h, token } = await connected()
    h.bucket.put(`selfmp3/${SONG}`, 'abc')
    h.bucket.dropHeaders = ['if-none-match', 'if-modified-since', 'range', 'accept-encoding']
    const response = await h.call(`/v1/files/${SONG}`, {
      token,
      headers: { 'if-none-match': '"etag-1"', range: 'bytes=0-0' },
    })
    // Not the 304 or 206 it hoped for, but the signature still holds.
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('abc')
  })

  it('hands a gzipped snapshot over as the same bytes, still labelled gzip', async () => {
    const { h, token } = await connected()
    const json = JSON.stringify({ format: 1, songs: [] })
    const gz = await gzip(json)
    h.bucket.put(`selfmp3/${SNAPSHOT}`, gz, {
      contentType: 'application/json',
      contentEncoding: 'gzip',
    })

    const response = await h.call(`/v1/files/${SNAPSHOT}`, { token })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-encoding')).toBe('gzip')
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(response.headers.get('content-length')).toBe(String(gz.length))
    // Snapshots are rewritten, so every use checks with the bucket first.
    expect(response.headers.get('cache-control')).toBe('private, no-cache')
    const bytes = new Uint8Array(await response.arrayBuffer())
    expect(bytes).toEqual(gz)
    expect(await gunzip(bytes)).toBe(json)
  })

  it('asks the runtime for the stored bytes in fetch’s own options, past the cache', async () => {
    // workerd reads encodeResponseBody only from fetch's options: set on a
    // Request that is then fetched, it is dropped, and a gzipped snapshot
    // arrives decoded but still labelled gzip. (Checked in workerd; Node
    // ignores the option, so this is the test that can see it.)
    const { h, token } = await connected()
    h.bucket.put(`selfmp3/${SNAPSHOT}`, '{}', { contentEncoding: 'gzip' })
    await h.call(`/v1/files/${SNAPSHOT}`, { token })
    expect(h.outside.at(-1)?.init).toMatchObject({
      method: 'GET',
      encodeResponseBody: 'manual',
      cache: 'no-store',
      redirect: 'manual',
    })

    // What the doorman reads itself, it lets the runtime decode.
    await h.call('/v1/list', { token })
    expect(h.outside.at(-1)?.init.encodeResponseBody).toBeUndefined()
    expect(h.outside.at(-1)?.init.cache).toBe('no-store')
  })

  it('says a missing file is missing', async () => {
    const { h, token } = await connected()
    const response = await h.call(`/v1/files/${SONG}`, { token })
    expect(response.status).toBe(404)
    expect(await error(response)).toEqual({ error: 'no such file', code: 'not_found' })
  })

  it('answers HEAD with the file’s size and no body, asking the bucket with a GET', async () => {
    const { h, token } = await connected()
    h.bucket.put(`selfmp3/${SONG}`, new Uint8Array(1234), { contentType: 'audio/mp4' })
    const response = await h.call(`/v1/files/${SONG}`, { method: 'HEAD', token })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-length')).toBe('1234')
    expect(response.headers.get('content-type')).toBe('audio/mp4')
    expect(response.body).toBeNull()
    expect(h.bucket.requests.at(-1)?.method).toBe('GET')

    const missing = await h.call(`/v1/files/covers/${SHA}.jpg`, { method: 'HEAD', token })
    expect(missing.status).toBe(404)
    expect(missing.body).toBeNull()
  })

  it('says so, in the Mac’s words, when the bucket refuses the key it was connected with', async () => {
    const { h, token } = await connected()
    h.bucket.revoked = true
    const response = await h.call(`/v1/files/${SONG}`, { token })
    expect(response.status).toBe(502)
    const body = await error(response)
    expect(body.code).toBe('bucket_refused_key')
    expect(body.error).toMatch(/^The bucket refused the key \(InvalidAccessKeyId\)\./)
    expect(body.error).not.toContain(APPLICATION_KEY)
  })
})

describe('writing a file', () => {
  it('streams the body into the bucket, under the folder, with its type', async () => {
    const { h, token } = await connected()
    const body = utf8('{"op":"loved","song":"a"}\n')
    const response = await h.call(`/v1/files/${LOG}`, {
      method: 'PUT',
      token,
      body,
      headers: { 'content-type': 'application/x-ndjson', 'content-length': String(body.length) },
    })
    expect(response.status).toBe(204)

    const stored = h.bucket.objects.get(`selfmp3/${LOG}`)
    expect(stored?.body).toEqual(body)
    expect(stored?.contentType).toBe('application/x-ndjson')
    expect(stored?.contentEncoding).toBeNull()

    const upstream = h.bucket.requests.at(-1)
    expect(upstream?.method).toBe('PUT')
    expect(upstream?.headers.get('x-amz-content-sha256')).toBe('UNSIGNED-PAYLOAD')
    expect(upstream?.headers.get('content-length')).toBe(String(body.length))
    expect(signedHeaders(h)).toBe('host;x-amz-content-sha256;x-amz-date')
  })

  it('keeps a content encoding, and takes a body that arrives as a stream', async () => {
    const { h, token } = await connected()
    const gz = await gzip('{"format":1}')
    const response = await h.call(`/v1/files/${SNAPSHOT}`, {
      method: 'PUT',
      token,
      body: new Blob([gz]).stream(),
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        'content-length': String(gz.length),
      },
    })
    expect(response.status).toBe(204)
    const stored = h.bucket.objects.get(`selfmp3/${SNAPSHOT}`)
    expect(stored?.body).toEqual(gz)
    expect(stored?.contentEncoding).toBe('gzip')
    expect(stored?.contentType).toBe('application/json')
  })

  it('calls an untyped file a stream of bytes, and takes an empty one', async () => {
    const { h, token } = await connected()
    const response = await h.call(`/v1/files/${LOG}`, {
      method: 'PUT',
      token,
      body: new Uint8Array(0),
      headers: { 'content-length': '0' },
    })
    expect(response.status).toBe(204)
    expect(h.bucket.objects.get(`selfmp3/${LOG}`)?.contentType).toBe('application/octet-stream')
    expect(h.bucket.objects.get(`selfmp3/${LOG}`)?.body).toEqual(new Uint8Array(0))
  })

  it('needs to know the size first, and refuses anything over 100 MB', async () => {
    const { h, token } = await connected()
    const noLength = await h.call(`/v1/files/${LOG}`, {
      method: 'PUT',
      token,
      body: new Blob(['abc']).stream(),
    })
    expect(noLength.status).toBe(411)
    expect((await error(noLength)).code).toBe('length_required')

    const huge = await h.call(`/v1/files/${SONG}`, {
      method: 'PUT',
      token,
      body: 'abc',
      headers: { 'content-length': String(100 * 1024 * 1024 + 1) },
    })
    expect(huge.status).toBe(413)

    const nonsense = await h.call(`/v1/files/${SONG}`, {
      method: 'PUT',
      token,
      body: 'abc',
      headers: { 'content-length': 'three' },
    })
    expect(nonsense.status).toBe(400)
    expect(h.bucket.requests).toEqual([])
  })
})

describe('deleting a file', () => {
  it('deletes snapshots and logs, and does not mind what is already gone', async () => {
    const { h, token } = await connected()
    h.bucket.put(`selfmp3/${SNAPSHOT}`, '{}')
    expect((await h.call(`/v1/files/${SNAPSHOT}`, { method: 'DELETE', token })).status).toBe(204)
    expect(h.bucket.objects.has(`selfmp3/${SNAPSHOT}`)).toBe(false)
    expect((await h.call(`/v1/files/${SNAPSHOT}`, { method: 'DELETE', token })).status).toBe(204)
    expect((await h.call(`/v1/files/${LOG}`, { method: 'DELETE', token })).status).toBe(204)
  })

  it('never deletes a file named by its hash, or format.json', async () => {
    const { h, token } = await connected()
    h.bucket.put(`selfmp3/${SONG}`, 'abc')
    for (const key of [SONG, `covers/${SHA}.jpg`, `lyrics/${SHA}.lrc`, 'format.json']) {
      const response = await h.call(`/v1/files/${key}`, { method: 'DELETE', token })
      expect(response.status).toBe(403)
      expect((await error(response)).code).toBe('forbidden')
    }
    expect(h.bucket.objects.has(`selfmp3/${SONG}`)).toBe(true)
    expect(h.bucket.requests).toEqual([])
  })
})

describe('keys', () => {
  it('are only ever the library’s own', async () => {
    const { h, token } = await connected()
    for (const path of [
      `/v1/files/audio/${SHA}`,
      '/v1/files/notes.txt',
      '/v1/files/',
      '/v1/files/audio%2F..%2Fformat.json',
      '/v1/files/log%2Fiphone-0b7d44a1%2F..%2F..%2Fformat.json',
      `/v1/files/AUDIO/${SHA}.m4a`,
      '/v1/files/%E0%A4%A',
      `/v1/files/audio/${SHA}.m4a%00`,
    ]) {
      const response = await h.call(path, { token })
      expect(response.status, path).toBe(400)
    }
    expect(h.bucket.requests).toEqual([])
  })

  it('may be percent-encoded', async () => {
    const { h, token } = await connected()
    h.bucket.put(`selfmp3/${SONG}`, 'abc')
    const response = await h.call(`/v1/files/audio%2F${SHA}.m4a`, { token })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('abc')
  })
})

describe('without a session or a bucket', () => {
  it('needs a session', async () => {
    const { h } = await connected()
    for (const method of ['GET', 'HEAD', 'PUT', 'DELETE']) {
      const response = await h.call(`/v1/files/${SONG}`, {
        method,
        headers: { 'content-length': '0' },
      })
      expect(response.status).toBe(401)
    }
    expect((await h.call('/v1/list')).status).toBe(401)
    expect(h.bucket.requests).toEqual([])
  })

  it('needs a bucket', async () => {
    const h = harness()
    const token = await h.signIn()
    for (const [path, method] of [
      ['/v1/list', 'GET'],
      [`/v1/files/${SONG}`, 'GET'],
      [`/v1/files/${SONG}`, 'HEAD'],
      [`/v1/files/${SNAPSHOT}`, 'DELETE'],
    ] as const) {
      const response = await h.call(path, { method, token })
      expect(response.status).toBe(409)
    }
    const put = await h.call(`/v1/files/${LOG}`, {
      method: 'PUT',
      token,
      body: 'x',
      headers: { 'content-length': '1' },
    })
    expect(put.status).toBe(409)
    expect((await error(put)).code).toBe('no_storage')
    expect(h.outside.filter(request => request.url.host === B2_HOST)).toEqual([])
  })
})
