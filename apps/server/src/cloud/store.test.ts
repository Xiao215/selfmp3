import { createHash } from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { CloudConnection } from '../repositories/cloud.js'
import { CloudError, S3CloudStore } from './store.js'

/**
 * The real S3 client, against a small S3 look-alike over real HTTP.
 *
 * It answers the handful of requests the sync makes the way S3 and B2 do —
 * path-style keys, XML listings and XML errors — and records what it was sent,
 * so the tests can check what matters on the wire: every key sits under the
 * bucket's folder, uploads carry an MD5 the service can check and no checksum
 * header it might not know, and each way of failing becomes the right kind of
 * error.
 */

interface Stored {
  body: Buffer
  headers: http.IncomingHttpHeaders
}

const BUCKET = 'my-music'
const KEY_ID = '004abcdef0123456789'

describe('S3CloudStore', () => {
  let server: http.Server
  let endpoint = ''
  const objects = new Map<string, Stored>()
  const requests: Array<{ method: string; url: string; headers: http.IncomingHttpHeaders }> = []

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', chunk => chunks.push(chunk as Buffer))
      req.on('end', () => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        requests.push({
          method: req.method ?? '',
          url: url.pathname + url.search,
          headers: req.headers,
        })

        const error = (status: number, code: string): void => {
          res.writeHead(status, { 'content-type': 'application/xml' })
          res.end(
            req.method === 'HEAD'
              ? undefined
              : `<Error><Code>${code}</Code><Message>${code}</Message></Error>`,
          )
        }

        const auth = req.headers.authorization ?? ''
        if (!auth.startsWith(`AWS4-HMAC-SHA256 Credential=${KEY_ID}/`))
          return error(403, 'InvalidAccessKeyId')

        const [, bucket, ...rest] = url.pathname.split('/')
        if (bucket !== BUCKET) return error(404, 'NoSuchBucket')
        const key = decodeURIComponent(rest.join('/'))

        if (req.method === 'GET' && key === '' && url.searchParams.get('list-type') === '2') {
          const prefix = url.searchParams.get('prefix') ?? ''
          const items = [...objects.entries()]
            .filter(([name]) => name.startsWith(prefix))
            .map(
              ([name, stored]) =>
                `<Contents><Key>${name}</Key><Size>${stored.body.length}</Size></Contents>`,
            )
          res.writeHead(200, { 'content-type': 'application/xml' })
          res.end(
            `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>${BUCKET}</Name>` +
              `<Prefix>${prefix}</Prefix><KeyCount>${items.length}</KeyCount><IsTruncated>false</IsTruncated>` +
              `${items.join('')}</ListBucketResult>`,
          )
          return
        }

        const stored = objects.get(key)
        switch (req.method) {
          case 'PUT': {
            const body = Buffer.concat(chunks)
            const md5 = createHash('md5').update(body).digest('base64')
            if (req.headers['content-md5'] !== md5) return error(400, 'BadDigest')
            objects.set(key, { body, headers: req.headers })
            res.writeHead(200, { etag: `"${md5}"` })
            res.end()
            return
          }
          case 'HEAD':
          case 'GET': {
            if (!stored) return error(404, 'NoSuchKey')
            res.writeHead(200, {
              'content-length': String(stored.body.length),
              'content-type': String(stored.headers['content-type'] ?? 'application/octet-stream'),
            })
            res.end(req.method === 'GET' ? stored.body : undefined)
            return
          }
          case 'DELETE': {
            objects.delete(key)
            res.writeHead(204)
            res.end()
            return
          }
          default:
            error(405, 'MethodNotAllowed')
        }
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()))
  })

  beforeEach(() => {
    objects.clear()
    requests.length = 0
  })

  const store = (changes: Partial<CloudConnection> = {}): S3CloudStore =>
    new S3CloudStore({
      endpoint,
      region: 'us-west-004',
      bucket: BUCKET,
      prefix: 'selfmp3',
      keyId: KEY_ID,
      applicationKey: 'K004-secret',
      ...changes,
    })

  it('puts a file under the bucket’s folder, with an MD5 and no checksum header', async () => {
    const body = Buffer.from('audio bytes')
    await store().put('audio/abc.m4a', body, { contentType: 'audio/mp4' })

    const stored = objects.get('selfmp3/audio/abc.m4a')
    expect(stored?.body.toString()).toBe('audio bytes')
    expect(stored?.headers['content-type']).toBe('audio/mp4')
    expect(stored?.headers['content-md5']).toBe(createHash('md5').update(body).digest('base64'))
    expect(
      Object.keys(stored?.headers ?? {}).filter(name => name.startsWith('x-amz-checksum')),
    ).toEqual([])
  })

  it('keeps a content encoding it is given', async () => {
    await store().put('snapshots/x.json', Buffer.from('gz'), {
      contentType: 'application/json',
      contentEncoding: 'gzip',
    })
    expect(objects.get('selfmp3/snapshots/x.json')?.headers['content-encoding']).toBe('gzip')
  })

  it('reads a file back, and says null for one that is not there', async () => {
    const s = store()
    await s.put('format.json', Buffer.from('{"format":1}'), { contentType: 'application/json' })
    expect((await s.get('format.json'))?.toString()).toBe('{"format":1}')
    expect(await s.head('format.json')).toEqual({ key: 'format.json', size: 12 })
    expect(await s.get('nothing-here')).toBeNull()
    expect(await s.head('nothing-here')).toBeNull()
  })

  it('lists keys relative to the folder, and only what is in it', async () => {
    objects.set('selfmp3/snapshots/a.json', { body: Buffer.from('1'), headers: {} })
    objects.set('selfmp3/snapshots/b.json', { body: Buffer.from('22'), headers: {} })
    objects.set('selfmp3/audio/c.m4a', { body: Buffer.from('333'), headers: {} })
    objects.set('other-app/snapshots/d.json', { body: Buffer.from('4'), headers: {} })

    expect(await store().list('snapshots/')).toEqual([
      { key: 'snapshots/a.json', size: 1 },
      { key: 'snapshots/b.json', size: 2 },
    ])
  })

  it('works at the root of the bucket when there is no folder', async () => {
    await store({ prefix: '' }).put('format.json', Buffer.from('{}'), {
      contentType: 'application/json',
    })
    expect(objects.has('format.json')).toBe(true)
  })

  it('deletes, and does not mind deleting what is already gone', async () => {
    const s = store()
    await s.put('snapshots/old.json', Buffer.from('x'), { contentType: 'application/json' })
    await s.delete('snapshots/old.json')
    await s.delete('snapshots/old.json')
    expect(objects.size).toBe(0)
  })

  it('says the key is wrong when the bucket refuses it', async () => {
    const error = await store({ keyId: 'wrong-key' })
      .list('')
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(CloudError)
    expect(error).toMatchObject({ kind: 'auth' })
    expect((error as Error).message).toMatch(/refused the key/)
  })

  it('says there is no such bucket', async () => {
    const error = await store({ bucket: 'not-my-bucket' })
      .list('')
      .catch((e: unknown) => e)
    expect(error).toMatchObject({ kind: 'missing' })
    expect((error as Error).message).toMatch(/no bucket called “not-my-bucket”/)
  })

  it('says it could not reach an address nobody is listening on', async () => {
    const closed = http.createServer()
    await new Promise<void>(resolve => closed.listen(0, '127.0.0.1', resolve))
    const port = (closed.address() as AddressInfo).port
    await new Promise<void>(resolve => closed.close(() => resolve()))

    const error = await store({ endpoint: `http://127.0.0.1:${port}` })
      .list('')
      .catch((e: unknown) => e)
    expect(error).toMatchObject({ kind: 'network' })
    expect((error as Error).message).toMatch(/Could not reach 127\.0\.0\.1/)
  }, 20_000)
})
