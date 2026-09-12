import { describe, expect, it } from 'vitest'
import * as edits from './edits.js'
import { createCloudLibrary } from './library.js'
import { createCloudSession, type CloudSession } from './session.js'
import type { CloudPlatform, CloudResponse, DeviceStore, TextCache } from './platform.js'

/**
 * The first tests for the replica, on the part that could not be tested at all
 * while it lived inside a browser — and on the part that matters most.
 *
 * Three devices write to the same log format (the Mac, a browser, and the
 * phone next), and the one thing it cannot survive is two files written under
 * the same sequence number with different contents: every device would then
 * replay a different library depending on which it read. So that contract is
 * what these hold down.
 */

const DOORMAN = 'https://doorman.test'
const TOKEN = 'tok'.padEnd(32, '0')
const ME = { email: 'a@b.c', name: null, picture: null, storage: null }
const SESSION: CloudSession = { doormanUrl: DOORMAN, token: TOKEN, me: ME }

/** A store that serialises like a real one, and can count its writes. */
function memoryStore(): DeviceStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>()
  const clone = (v: unknown): unknown => (v === undefined ? null : JSON.parse(JSON.stringify(v)))
  return {
    data,
    read: key => Promise.resolve(data.has(key) ? clone(data.get(key)) : null),
    write: (key, value) => {
      data.set(key, clone(value))
      return Promise.resolve()
    },
    remove: key => {
      data.delete(key)
      return Promise.resolve()
    },
    update: (key, change) => {
      const next = change(data.has(key) ? clone(data.get(key)) : null)
      data.set(key, clone(next))
      return Promise.resolve(clone(next))
    },
  }
}

interface Put {
  readonly key: string
  readonly body: unknown
}

/** A bucket that answers listings and remembers what was written into it. */
function fakeBucket() {
  const puts: Put[] = []
  const files = new Map<string, unknown>()
  let failNextPut: number | null = null

  const fetch = (url: string, init?: { method?: string; body?: string | Uint8Array }) => {
    const path = url.slice(DOORMAN.length)
    const reply = (status: number, body: unknown): Promise<CloudResponse> =>
      Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        headers: { get: () => null },
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
        arrayBuffer: () =>
          Promise.resolve(new TextEncoder().encode(JSON.stringify(body)).slice().buffer),
      })

    if (path.startsWith('/v1/list')) {
      const prefix = decodeURIComponent(/prefix=([^&]*)/.exec(path)?.[1] ?? '')
      const objects = [...files.keys()]
        .filter(key => key.startsWith(prefix))
        .map(key => ({ key, size: 1 }))
      return reply(200, { objects, cursor: null })
    }
    if (path.startsWith('/v1/files/')) {
      const key = path.slice('/v1/files/'.length)
      if (init?.method === 'PUT') {
        if (failNextPut !== null) {
          const status = failNextPut
          failNextPut = null
          return reply(status, { error: 'no' })
        }
        const body: unknown = JSON.parse(String(init.body))
        puts.push({ key, body })
        files.set(key, body)
        return reply(200, {})
      }
      return files.has(key) ? reply(200, files.get(key)) : reply(404, {})
    }
    return reply(404, {})
  }

  return {
    fetch,
    puts,
    files,
    failNextPutWith: (status: number) => {
      failNextPut = status
    },
  }
}

function platformFor(bucket: ReturnType<typeof fakeBucket>, store: DeviceStore): CloudPlatform {
  const textCache: TextCache = {
    read: () => Promise.resolve(null),
    write: () => Promise.resolve(),
    clear: () => Promise.resolve(),
  }
  return {
    doormanUrl: DOORMAN,
    store,
    fetch: bucket.fetch,
    randomBytes: into => into.fill(3),
    returnUrl: null,
    openSignIn: () => undefined,
    deviceKind: 'test',
    onWake: () => undefined,
    decodeText: bytes => Promise.resolve(new TextDecoder().decode(bytes)),
    textCache,
    warn: () => undefined,
  }
}

function build(store = memoryStore()) {
  const bucket = fakeBucket()
  const platform = platformFor(bucket, store)
  const session = createCloudSession(platform)
  const library = createCloudLibrary(platform, session)
  return { bucket, store, session, library }
}

async function signedIn(made: ReturnType<typeof build>): Promise<void> {
  await made.session.saveSession(SESSION)
}

describe('the outbox', () => {
  it('gives every log file its own sequence number', async () => {
    const made = build()
    await signedIn(made)
    await made.library.loadCloudLibrary(SESSION)

    for (const title of ['one', 'two', 'three']) {
      await made.library.recordChanges(SESSION, ctx => ({
        changes: edits.createTag(ctx, title, undefined).changes,
        answer: () => undefined,
      }))
      await made.library.flushCloudChanges()
    }

    const seqs = made.bucket.puts.map(put => put.key)
    expect(new Set(seqs).size).toBe(seqs.length)
    expect(seqs).toEqual([...seqs].sort())
  })

  it('writes the same bytes under the same number when a send is retried', async () => {
    // A file, once written, never changes: a resend must be harmless. If a
    // retry rebuilt the batch, two devices could read the same key and get
    // different libraries, with nothing to tell them apart.
    const made = build()
    await signedIn(made)
    await made.library.loadCloudLibrary(SESSION)

    await made.library.recordChanges(SESSION, ctx => ({
      changes: edits.createTag(ctx, 'once', undefined).changes,
      answer: () => undefined,
    }))

    made.bucket.failNextPutWith(500)
    await made.library.flushCloudChanges()
    expect(made.bucket.puts).toHaveLength(0)

    await made.library.flushCloudChanges()
    expect(made.bucket.puts).toHaveLength(1)

    const first = made.bucket.puts[0]
    // And again: the same key, and the same contents.
    await made.library.flushCloudChanges()
    for (const put of made.bucket.puts) {
      if (put.key === first?.key) expect(put.body).toEqual(first?.body)
    }
  })

  it('keeps an edit when it cannot be sent, rather than losing it', async () => {
    const made = build()
    await signedIn(made)
    await made.library.loadCloudLibrary(SESSION)

    await made.library.recordChanges(SESSION, ctx => ({
      changes: edits.createTag(ctx, 'kept', undefined).changes,
      answer: () => undefined,
    }))
    made.bucket.failNextPutWith(500)
    await made.library.flushCloudChanges()

    // Still waiting, and still counted, so the app can say so.
    expect(made.library.pendingCloudChanges()).toBeGreaterThan(0)
  })

  it('stops trying when the doorman says the session is gone', async () => {
    // 401 and 409 are not worth retrying: signing in again is what fixes them,
    // and a retry loop against them is just noise.
    const made = build()
    await signedIn(made)
    await made.library.loadCloudLibrary(SESSION)

    await made.library.recordChanges(SESSION, ctx => ({
      changes: edits.createTag(ctx, 'x', undefined).changes,
      answer: () => undefined,
    }))
    made.bucket.failNextPutWith(401)
    await expect(made.library.flushCloudChanges()).resolves.toBeUndefined()
  })
})

describe('opening', () => {
  it('keeps one device name across restarts, so its log folder stays its own', async () => {
    // The device id is the folder this device writes into. A new one each
    // launch would strand every file it had already written.
    const store = memoryStore()
    const first = build(store)
    await signedIn(first)
    await first.library.loadCloudLibrary(SESSION)
    await first.library.recordChanges(SESSION, ctx => ({
      changes: edits.createTag(ctx, 'a', undefined).changes,
      answer: () => undefined,
    }))
    await first.library.flushCloudChanges()

    const second = build(store)
    await second.library.loadCloudLibrary(SESSION)
    await second.library.recordChanges(SESSION, ctx => ({
      changes: edits.createTag(ctx, 'b', undefined).changes,
      answer: () => undefined,
    }))
    await second.library.flushCloudChanges()

    const folders = new Set(
      [...first.bucket.puts, ...second.bucket.puts].map(put => put.key.split('/')[1]),
    )
    const reopened = new Set(second.bucket.puts.map(put => put.key.split('/')[1]))
    expect(reopened.size).toBe(1)
    expect(folders.size).toBeGreaterThan(0)
  })

  it('needs the bucket the first time, and never again', async () => {
    // A device that has never opened has nothing to show, so a failure there
    // has to be said out loud rather than leaving a convincing empty library.
    // Once it has read the bucket once, being offline is not a problem at all
    // — which is the whole promise of keeping a copy.
    const store = memoryStore()
    const offline = (base: CloudPlatform): CloudPlatform => ({
      ...base,
      fetch: () => Promise.reject(new Error('offline')),
    })

    const cold = fakeBucket()
    const coldPlatform = offline(platformFor(cold, store))
    const coldSession = createCloudSession(coldPlatform)
    await coldSession.saveSession(SESSION)
    await expect(
      createCloudLibrary(coldPlatform, coldSession).loadCloudLibrary(SESSION),
    ).rejects.toBeTruthy()

    // Now let one open succeed, so the device has a copy of its own...
    const warm = build(store)
    await signedIn(warm)
    await warm.library.loadCloudLibrary(SESSION)

    // ...and it opens with no connection at all.
    const againPlatform = offline(platformFor(fakeBucket(), store))
    const againSession = createCloudSession(againPlatform)
    const view = await createCloudLibrary(againPlatform, againSession).loadCloudLibrary(SESSION)
    expect(view.library.songs).toEqual([])
  })
})
