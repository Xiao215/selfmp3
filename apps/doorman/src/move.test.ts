import {
  DoormanListSchema,
  DoormanMeSchema,
  DoormanMoveSchema,
  DoormanSpaceSchema,
  ErrorBodySchema,
  MOVE_COPY_MOST,
} from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'
import { APP_ORIGIN, harness, type Harness } from './fakes.js'

/**
 * Moving a library between a bucket and Google Drive: the new place is only
 * where the move is going until it is finished, every file arrives as it was
 * stored, and nothing about the old place changes at any point.
 */

const SONG = `audio/${'ab'.repeat(32)}.m4a`
const COVER = `covers/${'cd'.repeat(32)}.jpg`
const SNAPSHOT = 'snapshots/20260911T142205123Z-mac-3f9a1c2e.json'
const LOG = 'log/mac-3f9a1c2e/000000000001.json'
const BACK = `${APP_ORIGIN}/selfmp3/move`

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function put(
  h: Harness,
  token: string,
  key: string,
  body: Uint8Array | string,
  headers: Record<string, string> = {},
): Promise<void> {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body
  const response = await h.call(`/v1/files/${key}`, {
    method: 'PUT',
    token,
    body: bytes,
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(bytes.length),
      ...headers,
    },
  })
  expect(response.status).toBe(204)
}

async function me(h: Harness, token: string) {
  return DoormanMeSchema.parse(await (await h.call('/v1/me', { token })).json())
}

async function moving(h: Harness, token: string) {
  const response = await h.call('/v1/storage/move', { token })
  return DoormanMoveSchema.parse(await response.json()).to
}

async function listed(h: Harness, token: string, path: string): Promise<string[]> {
  const keys: string[] = []
  let cursor: string | null = null
  do {
    const query: string = cursor === null ? '' : `${path.includes('?') ? '&' : '?'}cursor=${cursor}`
    const page = DoormanListSchema.parse(await (await h.call(path + query, { token })).json())
    keys.push(...page.objects.map(object => object.key))
    cursor = page.cursor
  } while (cursor !== null)
  return keys
}

const copy = (h: Harness, token: string, keys: string[], remove: string[] = []) =>
  h.call('/v1/storage/move/copy', { token, json: { keys, remove } })

/** A bucket with a small library in it, signed in. */
async function withLibrary(): Promise<{ h: Harness; token: string; snapshot: Uint8Array }> {
  const h = harness()
  const token = await h.signIn()
  expect((await h.connect(token)).status).toBe(200)
  const snapshot = await gzip('{"songs":[]}')
  await put(h, token, SONG, 'the song', { 'content-type': 'audio/mp4' })
  await put(h, token, COVER, 'the cover', { 'content-type': 'image/jpeg' })
  await put(h, token, LOG, '{"edits":[]}', { 'content-type': 'application/json' })
  await put(h, token, SNAPSHOT, snapshot, {
    'content-type': 'application/json',
    'content-encoding': 'gzip',
  })
  return { h, token, snapshot }
}

describe('moving to Google Drive', () => {
  it('keeps the storage as it is while Drive is only where the move is going', async () => {
    const { h, token } = await withLibrary()
    const before = (await me(h, token)).storage
    const back = await h.connectDrive(token, { returnTo: BACK, move: true })
    expect(back.headers.get('location')).toBe(`${BACK}#storage=connected`)

    expect((await me(h, token)).storage).toEqual(before)
    const [root] = h.drive.roots()
    expect(await moving(h, token)).toEqual({ kind: 'drive', folder: root?.id })
    // Devices still read the bucket.
    expect(await (await h.call(`/v1/files/${SONG}`, { token })).text()).toBe('the song')
  })

  it('copies every file as it was stored, then makes Drive the storage', async () => {
    const { h, token, snapshot } = await withLibrary()
    await h.connectDrive(token, { move: true })
    const bucket = (await me(h, token)).storage
    const objects = h.bucket.objects.size

    expect(await listed(h, token, '/v1/storage/move/list')).toEqual(['format.json'])
    expect((await copy(h, token, [SONG, COVER])).status).toBe(204)
    expect((await copy(h, token, [LOG, SNAPSHOT])).status).toBe(204)
    expect(await listed(h, token, '/v1/storage/move/list')).toEqual([
      SONG,
      COVER,
      'format.json',
      LOG,
      SNAPSHOT,
    ])

    const counter = await (await h.call('/v1/changes', { token })).text()
    const finished = await h.call('/v1/storage/move/finish', { token, json: {} })
    expect(finished.status).toBe(200)
    const [root] = h.drive.roots()
    expect(DoormanMeSchema.parse(await finished.json())).toMatchObject({
      storage: { kind: 'drive', folder: root?.id },
      movedFrom: bucket,
    })
    expect(await moving(h, token)).toBeNull()
    expect(await (await h.call('/v1/changes', { token })).text()).not.toBe(counter)

    // The same files, now from Drive: bytes, type and encoding as they were.
    const song = await h.call(`/v1/files/${SONG}`, { token })
    expect(song.headers.get('content-type')).toBe('audio/mp4')
    expect(await song.text()).toBe('the song')
    const moved = await h.call(`/v1/files/${SNAPSHOT}`, { token })
    expect(moved.headers.get('content-encoding')).toBe('gzip')
    expect(new Uint8Array(await moved.arrayBuffer())).toEqual(snapshot)
    // The bucket is left exactly as it was.
    expect(h.bucket.objects.size).toBe(objects)
  })

  it('refuses a Drive that already has a library in it', async () => {
    const { h, token } = await withLibrary()
    // The Drive was this account's storage once, and still has what it held.
    const other = await h.signIn()
    await h.connectDrive(other)
    await put(h, other, SNAPSHOT, await gzip('{}'), {
      'content-type': 'application/json',
      'content-encoding': 'gzip',
    })
    await h.connect(other)

    const back = await h.connectDrive(token, { returnTo: BACK, move: true })
    expect(back.headers.get('location')).toBe(`${BACK}#storage-refused=holds-library`)
    expect(await moving(h, token)).toBeNull()
  })

  it('does not finish before the newest snapshot is across', async () => {
    const { h, token } = await withLibrary()
    await h.connectDrive(token, { move: true })
    await copy(h, token, [SONG, COVER, LOG])
    const early = await h.call('/v1/storage/move/finish', { token, json: {} })
    expect(early.status).toBe(422)
    expect((await me(h, token)).storage?.kind).toBe('bucket')
  })

  it('removes from the new place a snapshot the old one has pruned, and nothing else', async () => {
    const { h, token } = await withLibrary()
    await h.connectDrive(token, { move: true })
    await copy(h, token, [SONG, SNAPSHOT])
    expect((await copy(h, token, [], [SNAPSHOT])).status).toBe(204)
    expect(await listed(h, token, '/v1/storage/move/list')).toEqual([SONG, 'format.json'])
    expect((await copy(h, token, [], [SONG])).status).toBe(400)
    expect((await copy(h, token, ['format.json'])).status).toBe(400)
  })

  it('passes over a file the old place no longer has', async () => {
    const { h, token } = await withLibrary()
    await h.connectDrive(token, { move: true })
    const gone = `audio/${'ef'.repeat(32)}.m4a`
    expect((await copy(h, token, [gone, SONG])).status).toBe(204)
    expect(await listed(h, token, '/v1/storage/move/list')).toEqual([SONG, 'format.json'])
  })

  it('takes only a few files at a time', async () => {
    const { h, token } = await withLibrary()
    await h.connectDrive(token, { move: true })
    const many = Array.from({ length: MOVE_COPY_MOST + 1 }, () => SONG)
    expect((await copy(h, token, many)).status).toBe(400)
  })

  it('stops without changing anything, and hands the Drive back to Google', async () => {
    const { h, token } = await withLibrary()
    await h.connectDrive(token, { move: true })
    await copy(h, token, [SONG])
    const revoked = h.outside.filter(seen => seen.url.pathname === '/revoke').length

    const stopped = await h.call('/v1/storage/move', { method: 'DELETE', token })
    expect(DoormanMoveSchema.parse(await stopped.json()).to).toBeNull()
    await h.settle()
    expect(h.outside.filter(seen => seen.url.pathname === '/revoke').length).toBe(revoked + 1)
    expect((await me(h, token)).storage?.kind).toBe('bucket')
    expect((await copy(h, token, [SONG])).status).toBe(409)
  })
})

describe('moving to a bucket', () => {
  /** A library in Google Drive, signed in. */
  async function inDrive(): Promise<{ h: Harness; token: string }> {
    const h = harness()
    const token = await h.signIn()
    await h.connectDrive(token)
    await put(h, token, SONG, 'the song', { 'content-type': 'audio/mp4' })
    await put(h, token, SNAPSHOT, await gzip('{"songs":[]}'), {
      'content-type': 'application/json',
      'content-encoding': 'gzip',
    })
    return { h, token }
  }

  const start = (h: Harness, token: string, json: unknown) =>
    h.call('/v1/storage/move', { method: 'PUT', token, json })

  it('tries the key first, and keeps Drive as the storage until the end', async () => {
    const { h, token } = await inDrive()
    const wrong = await start(h, token, {
      backblaze: { keyId: '004abcdef0123456789', applicationKey: 'not the key' },
    })
    expect(wrong.status).toBe(422)
    expect(await moving(h, token)).toBeNull()

    const began = await h.call('/v1/storage/move', {
      method: 'PUT',
      token,
      json: {
        backblaze: { keyId: '004abcdef0123456789', applicationKey: 'K004-test-application-key' },
      },
    })
    expect(began.status).toBe(200)
    expect(DoormanMoveSchema.parse(await began.json()).to).toMatchObject({
      kind: 'bucket',
      bucket: 'my-music',
    })
    expect((await me(h, token)).storage?.kind).toBe('drive')
  })

  it('moves the library, lets go of Drive, and leaves its files there', async () => {
    const { h, token } = await inDrive()
    const drive = (await me(h, token)).storage
    const files = h.drive.files.size
    await h.call('/v1/storage/move', {
      method: 'PUT',
      token,
      json: {
        backblaze: { keyId: '004abcdef0123456789', applicationKey: 'K004-test-application-key' },
      },
    })
    expect((await copy(h, token, [SONG, SNAPSHOT])).status).toBe(204)
    const finished = await h.call('/v1/storage/move/finish', { token, json: {} })
    expect(DoormanMeSchema.parse(await finished.json())).toMatchObject({
      storage: { kind: 'bucket' },
      movedFrom: drive,
    })
    await h.settle()
    expect(h.outside.some(seen => seen.url.pathname === '/revoke')).toBe(true)
    expect(h.drive.files.size).toBe(files)
    expect(await (await h.call(`/v1/files/${SONG}`, { token })).text()).toBe('the song')
  })

  it('refuses a bucket that already has a library, and the place the library is in', async () => {
    const h = harness()
    const token = await h.signIn()
    await h.connect(token)
    await put(h, token, SNAPSHOT, await gzip('{}'), {
      'content-type': 'application/json',
      'content-encoding': 'gzip',
    })
    const bucket = {
      endpoint: 's3.us-west-004.backblazeb2.com',
      bucket: 'my-music',
      keyId: '004abcdef0123456789',
      applicationKey: 'K004-test-application-key',
    }
    const same = await start(h, token, { bucket })
    expect(same.status).toBe(422)
    expect(ErrorBodySchema.parse(await same.json()).error).toBe('Your library is already there.')

    // Another folder of the same bucket is another place, and an empty one.
    const elsewhere = await start(h, token, { bucket: { ...bucket, prefix: 'second' } })
    expect(elsewhere.status).toBe(200)
    await copy(h, token, [SNAPSHOT])
    await h.call('/v1/storage/move/finish', { token, json: {} })
    // Now the first folder is the one with a library in it.
    const back = await start(h, token, { bucket })
    expect(ErrorBodySchema.parse(await back.json()).error).toMatch(/already has a library/)
  })
})

describe('what a move asks of the session', () => {
  it('needs a device’s own session, and something to move', async () => {
    const h = harness()
    expect((await h.call('/v1/storage/move')).status).toBe(401)
    const token = await h.signIn()
    expect((await h.connectDrive(token, { move: true })).status).toBe(409)
    expect((await copy(h, token, [SONG])).status).toBe(409)
    expect((await h.call('/v1/storage/move/finish', { token, json: {} })).status).toBe(409)
  })

  it('does not move Google Drive to Google Drive', async () => {
    const h = harness()
    const token = await h.signIn()
    await h.connectDrive(token)
    expect((await h.connectDrive(token, { move: true })).status).toBe(422)
  })

  it('forgets a move when the storage is changed some other way', async () => {
    const { h, token } = await withLibrary()
    await h.connectDrive(token, { move: true })
    await h.call('/v1/storage', { method: 'DELETE', token })
    expect(await moving(h, token)).toBeNull()
  })
})

describe('GET /v1/storage/space', () => {
  it('says how much of a Google account’s storage is used, and nothing for a bucket', async () => {
    const h = harness()
    const token = await h.signIn()
    await h.connect(token)
    const none = await h.call('/v1/storage/space', { token })
    expect(DoormanSpaceSchema.parse(await none.json()).space).toBeNull()

    h.drive.usedElsewhere = 5 * 1024 ** 3
    await h.connectDrive(token, { move: true })
    const there = await h.call('/v1/storage/space?of=move', { token })
    const { space } = DoormanSpaceSchema.parse(await there.json())
    expect(space?.limit).toBe(15 * 1024 ** 3)
    expect(space?.used).toBeGreaterThanOrEqual(5 * 1024 ** 3)

    h.drive.limit = null
    const unlimited = await h.call('/v1/storage/space?of=move', { token })
    expect(DoormanSpaceSchema.parse(await unlimited.json()).space?.limit).toBeNull()
  })

  it('needs storage, or a move, to ask about', async () => {
    const h = harness()
    const token = await h.signIn()
    expect((await h.call('/v1/storage/space', { token })).status).toBe(409)
    await h.connect(token)
    expect((await h.call('/v1/storage/space?of=move', { token })).status).toBe(409)
  })
})
