import { afterEach, describe, expect, it, vi } from 'vitest'
import { isLookedAtCloudKey, type CloudSnapshot } from '@selfmp3/shared'
import * as edits from './edits.js'
import { createCloudLibrary } from './library.js'
import { createCloudSession, type CloudSession } from './session.js'
import type { CloudPlatform, CloudResponse, DeviceStore, TextCache } from './platform.js'

/**
 * The first tests for the replica, on the part that could not be tested at all
 * while it lived inside a browser — and on the part that matters most.
 *
 * Three devices write to the same log format (the server, a browser, and the
 * phone next), and the one thing it cannot survive is two files written under
 * the same sequence number with different contents: every device would then
 * replay a different library depending on which it read. So that contract is
 * what these hold down.
 */

/** The key the service worker reads each song's files under (apps/app/sw/sw.ts). */
const FILES_KEY = 'cloud-files'

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

/**
 * A bucket that answers listings and remembers what was written into it —
 * and, with `counting`, keeps a change counter the way the doorman does.
 */
function fakeBucket({ counting = false }: { counting?: boolean } = {}) {
  const puts: Put[] = []
  const files = new Map<string, unknown>()
  /** Every prefix listed, in order: the calls the bucket counts. */
  const lists: string[] = []
  let failNextPut: number | null = null
  /** Every file read asked of the doorman, in order. */
  const reads: string[] = []
  let refuseReads = false
  let offline = false
  /** Every request made of the doorman while offline, which never arrives. */
  let unreached = 0
  let count = 0
  let asked = 0
  const counter = (n: number): string => `00000000000000aa.${n}`

  const fetch = (url: string, init?: { method?: string; body?: string | Uint8Array }) => {
    if (offline) {
      unreached++
      return Promise.reject(new Error('The Internet connection appears to be offline.'))
    }
    const path = url.slice(DOORMAN.length)
    const reply = (
      status: number,
      body: unknown,
      headers: Record<string, string> = {},
    ): Promise<CloudResponse> =>
      Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
        arrayBuffer: () =>
          Promise.resolve(new TextEncoder().encode(JSON.stringify(body)).slice().buffer),
      })

    /** The doorman's header for a write or delete of a looked-at key. */
    const moved = (key: string): Record<string, string> => {
      if (!counting || !isLookedAtCloudKey(key)) return {}
      count++
      return { 'selfmp3-changes': `${counter(count - 1)} ${counter(count)}` }
    }

    if (path === '/v1/changes') {
      if (!counting) return reply(404, { error: 'not found', code: 'not_found' })
      asked++
      return reply(200, { changes: counter(count) })
    }
    if (path.startsWith('/v1/list')) {
      const prefix = decodeURIComponent(/prefix=([^&]*)/.exec(path)?.[1] ?? '')
      lists.push(prefix)
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
          return reply(status, { error: 'no', code: 'forbidden' })
        }
        const body: unknown = JSON.parse(String(init.body))
        puts.push({ key, body })
        files.set(key, body)
        return reply(200, {}, moved(key))
      }
      if (init?.method === 'DELETE') {
        files.delete(key)
        return reply(204, null, moved(key))
      }
      reads.push(key)
      if (refuseReads) {
        return reply(502, { error: 'Transaction cap exceeded', code: 'bucket_cap_exceeded' })
      }
      return files.has(key) ? reply(200, files.get(key)) : reply(404, {})
    }
    return reply(404, {})
  }

  return {
    fetch,
    puts,
    files,
    lists,
    reads,
    /** The day's reads used up; listings still answer, as on 2026-10-08. */
    refuseReads: (refuse: boolean) => {
      refuseReads = refuse
    },
    /** How many times the counter was read. */
    asked: () => asked,
    /** No network at all: every request fails before it reaches the doorman. */
    goOffline: (on: boolean) => {
      offline = on
    },
    /** How many requests were tried while offline. */
    unreached: () => unreached,
    /** A server with the bucket's own key wrote something: the counter never saw it. */
    writeUncounted: (key: string, body: unknown) => {
      files.set(key, body)
    },
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

function build(store = memoryStore(), bucket = fakeBucket()) {
  const platform = platformFor(bucket, store)
  const session = createCloudSession(platform)
  const library = createCloudLibrary(platform, session)
  return { bucket, store, session, library }
}

async function signedIn(made: ReturnType<typeof build>): Promise<void> {
  await made.session.saveSession(SESSION)
}

describe('lyrics', () => {
  /*
   * The installed desktop app's cache is refused on its app:// origin, and a throw
   * there reached the screen as "Lyrics need your library — reconnect" while
   * the words had already come down. A cache is a convenience: one that fails
   * is a miss, never a failure.
   */
  it('still answers with the words when the cache throws on read and write', async () => {
    const store = memoryStore()
    const bucket = fakeBucket()
    const refusing: TextCache = {
      read: () => Promise.reject(new TypeError("Request scheme 'app' is unsupported")),
      write: () => Promise.reject(new TypeError("Request scheme 'app' is unsupported")),
      clear: () => Promise.resolve(),
    }
    const platform: CloudPlatform = { ...platformFor(bucket, store), textCache: refusing }
    const library = createCloudLibrary(platform, createCloudSession(platform))

    await store.write(FILES_KEY, {
      7: {
        audio: 'audio/7.m4a',
        cover: null,
        lyrics: 'lyrics/7.lrc',
        lyricsKind: 'plain',
        romanized: null,
      },
    })
    bucket.files.set('lyrics/7.lrc', 'la la la')

    // The fake bucket answers in JSON, so the text is the JSON of what it holds.
    await expect(library.cloudLyrics(SESSION, 7)).resolves.toEqual({
      text: JSON.stringify('la la la'),
      kind: 'plain',
      romanized: null,
    })
  })

  /*
   * Romaji is made on the server, which has the dictionaries, and goes up beside
   * the words. A device signed in to the cloud reads it the way it reads the
   * words, so its lyrics answer is the same one the server itself gives.
   */
  it('brings the romanized lines back with the words', async () => {
    const made = build()
    await made.store.write(FILES_KEY, {
      9: {
        audio: 'audio/9.m4a',
        cover: null,
        lyrics: 'lyrics/9.lrc',
        lyricsKind: 'synced',
        romanized: 'lyrics/9.json',
      },
    })
    made.bucket.files.set('lyrics/9.lrc', '[00:01.00]夜に駆ける')
    // The fake bucket answers every file as JSON of what it holds: this one is the list itself.
    made.bucket.files.set('lyrics/9.json', ['yoru ni kakeru'])

    const found = await made.library.cloudLyrics(SESSION, 9)

    expect(found?.kind).toBe('synced')
    expect(found?.romanized).toEqual(['yoru ni kakeru'])
  })

  it('answers no romanized lines when the file is not a list of lines', async () => {
    const made = build()
    await made.store.write(FILES_KEY, {
      9: {
        audio: 'audio/9.m4a',
        cover: null,
        lyrics: 'lyrics/9.lrc',
        lyricsKind: 'synced',
        romanized: 'lyrics/9.json',
      },
    })
    made.bucket.files.set('lyrics/9.lrc', 'words')
    made.bucket.files.set('lyrics/9.json', { not: 'lines' })

    expect((await made.library.cloudLyrics(SESSION, 9))?.romanized).toBeNull()
  })
})

describe('motion curves', () => {
  const CURVE = { version: 1, rate: 20, duration: 0.15, loudness: 'AED/', onset: '/wAA' }

  const withFiles = async (motion: string | null | undefined) => {
    const made = build()
    await made.store.write(FILES_KEY, {
      4: {
        audio: 'audio/4.m4a',
        cover: null,
        lyrics: null,
        lyricsKind: null,
        romanized: null,
        // Left out entirely, as a library kept by an older build has it.
        ...(motion === undefined ? {} : { motion }),
      },
    })
    return made
  }

  it('reads a song’s curve from the bucket, the way the server answers it', async () => {
    const made = await withFiles('lyrics/4.json')
    made.bucket.files.set('lyrics/4.json', CURVE)

    await expect(made.library.cloudMotion(SESSION, 4)).resolves.toEqual(CURVE)
  })

  it('answers null for a song with no curve, one from an older build, and one that is not a curve', async () => {
    expect(await (await withFiles(null)).library.cloudMotion(SESSION, 4)).toBeNull()
    expect(await (await withFiles(undefined)).library.cloudMotion(SESSION, 4)).toBeNull()

    const odd = await withFiles('lyrics/4.json')
    odd.bucket.files.set('lyrics/4.json', ['not', 'a', 'curve'])
    expect(await odd.library.cloudMotion(SESSION, 4)).toBeNull()

    const gone = await withFiles('lyrics/4.json')
    expect(await gone.library.cloudMotion(SESSION, 4)).toBeNull()
  })
})

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

  it('reads a kept outbox change by change, keeping its name and its numbering', async () => {
    const store = memoryStore()
    const known = {
      type: 'songEdited',
      hlc: '0mfx3k2p1.0000.test-aaaaaaaa',
      uid: 'a'.repeat(32),
      fields: { loved: true },
    }
    store.data.set('cloud-outbox', {
      device: 'test-aaaaaaaa',
      last: null,
      nextSeq: 3,
      pending: [known, { type: 'from-a-crash' }],
      inflight: null,
    })
    const made = build(store)
    await signedIn(made)
    await made.library.loadCloudLibrary(SESSION)

    expect(made.library.pendingCloudChanges()).toBe(1)
    expect(store.data.get('cloud-outbox')).toMatchObject({
      device: 'test-aaaaaaaa',
      nextSeq: 3,
      pending: [known],
    })
  })

  it('fetches the library again when the kept copy does not read as one', async () => {
    const store = memoryStore()
    store.data.set('cloud-base', { key: 'snapshots/x.json', snapshot: { songs: 'half' } })
    const made = build(store)
    await signedIn(made)
    const view = await made.library.loadCloudLibrary(SESSION)
    expect(view.library.songs).toEqual([])
    expect(store.data.get('cloud-base')).toEqual({ key: null, snapshot: null })
  })

  it('brings a copy kept before the snapshot’s shape settled up to it, without the bucket', async () => {
    // A copy kept before every song named its motion curve and every snapshot
    // its artists and sound. Thrown away, it had to be read again — and on a
    // day the bucket refuses reads that left a phone with no library at all,
    // its downloads on the disk (2026-10-08). It is upgraded and kept instead.
    const store = memoryStore()
    const { artists: _artists, sound: _sound, upTo: _upTo, ...older } = SNAPSHOT
    const songs = older.songs.map(
      ({ motion: _motion, audioFeatures: _features, coverTone: _tone, ...song }) => song,
    )
    store.data.set('cloud-base', { key: SNAPSHOT_KEY, snapshot: { ...older, songs } })
    const made = build(store)
    await signedIn(made)
    made.bucket.refuseReads(true)

    const view = await made.library.loadCloudLibrary(SESSION)
    expect(view.library.songs.map(song => song.title)).toEqual(['Song a'])
    expect(made.bucket.reads).toEqual([])
    expect(store.data.get('cloud-base')).toEqual({
      key: SNAPSHOT_KEY,
      snapshot: { ...SNAPSHOT, upTo: {}, artists: [], sound: null },
    })
  })

  it('does not list the bucket again for a first copy while its reads are refused', async () => {
    const { releaseBucket } = await import('./hold.js')
    const made = build(memoryStore())
    await signedIn(made)
    made.bucket.files.set(SNAPSHOT_KEY, SNAPSHOT)
    made.bucket.refuseReads(true)
    try {
      await expect(made.library.loadCloudLibrary(SESSION)).rejects.toThrow()
      const listed = made.bucket.lists.length
      for (let tries = 0; tries < 3; tries++) {
        await expect(made.library.loadCloudLibrary(SESSION)).rejects.toThrow()
      }
      expect(made.bucket.lists.length).toBe(listed)
      expect(made.bucket.reads).toHaveLength(1)
    } finally {
      releaseBucket()
    }
  })

  it('does not keep what it opened for an account signed out of meanwhile', async () => {
    const store = memoryStore()
    const made = build(store)
    await signedIn(made)
    const opening = made.library.loadCloudLibrary(SESSION)
    await made.library.forgetCloudLibrary()
    await expect(opening).rejects.toMatchObject({ status: 401 })
    // The next open starts afresh, under a new name, rather than handing back the old one.
    await made.library.loadCloudLibrary(SESSION)
    expect(made.library.pendingCloudChanges()).toBe(0)
  })
})

/** Every key written to a store from now on, in order. */
function recordWrites(store: DeviceStore): string[] {
  const keys: string[] = []
  const write = store.write.bind(store)
  const update = store.update.bind(store)
  store.write = (key, value) => {
    keys.push(key)
    return write(key, value)
  }
  store.update = (key, change) => {
    keys.push(key)
    return update(key, change)
  }
  return keys
}

/** A platform whose bucket does not answer until `open` is called. */
function gatedPlatform(bucket: ReturnType<typeof fakeBucket>, store: DeviceStore) {
  let open: () => void = () => undefined
  const gate = new Promise<void>(resolve => {
    open = resolve
  })
  const platform: CloudPlatform = {
    ...platformFor(bucket, store),
    fetch: async (url, init) => {
      await gate
      return bucket.fetch(url, init)
    },
  }
  return { platform, open: () => open() }
}

/** Another device, writing a tag into the same bucket. */
async function tagFromElsewhere(
  bucket: ReturnType<typeof fakeBucket>,
  name: string,
): Promise<void> {
  const platform: CloudPlatform = { ...platformFor(bucket, memoryStore()), deviceKind: 'other' }
  const session = createCloudSession(platform)
  await session.saveSession(SESSION)
  const library = createCloudLibrary(platform, session)
  await library.loadCloudLibrary(SESSION)
  await library.recordChanges(SESSION, ctx => ({
    changes: edits.createTag(ctx, name, undefined).changes,
    answer: () => undefined,
  }))
  await library.flushCloudChanges()
}

const SNAPSHOT_KEY = 'snapshots/20260911T100000000Z-mac-3f9a1c2e.json'
const SNAPSHOT: CloudSnapshot = {
  format: 1,
  writtenAt: '2026-09-11T10:00:00.000Z',
  writtenBy: 'mac-3f9a1c2e',
  upTo: {},
  songs: [
    {
      uid: 'a'.repeat(32),
      title: 'Song a',
      artist: 'Aurora Lane',
      album: '',
      albumArtist: '',
      trackNo: null,
      year: null,
      duration: 200,
      audio: { key: `audio/${'a'.repeat(64)}.m4a`, size: 4_000_000, mime: 'audio/mp4' },
      cover: null,
      coverTone: null,
      lyrics: null,
      motion: null,
      instrumental: false,
      loved: false,
      playCount: 0,
      lastPlayedAt: null,
      addedAt: '2026-09-01 10:00:00',
      sourceUrl: null,
      tagUids: [],
      audioFeatures: null,
    },
  ],
  tags: [],
  playlists: [],
  artists: [],
  sound: null,
}

describe('looking at the bucket', () => {
  /*
   * Most looks find nothing new, and must not write the snapshot and every log
   * back to the device and replay the whole library to arrive exactly where it
   * already was.
   */
  it('neither rewrites nor replays the library when nothing has changed', async () => {
    const made = build()
    await signedIn(made)
    made.bucket.files.set(SNAPSHOT_KEY, SNAPSHOT)
    const first = await made.library.loadCloudLibrary(SESSION)
    expect(first.library.songs).toHaveLength(1)

    const writes = recordWrites(made.store)
    made.library.markCloudLibraryStale()
    const again = await made.library.loadCloudLibrary(SESSION)

    // Only when it looked, so a new tab or a relaunch need not look again at once.
    expect(writes).toEqual(['cloud-look'])
    // The very same view: nothing was built again.
    expect(again).toBe(first)
  })

  it('still replays when another device has written something', async () => {
    const made = build()
    await signedIn(made)
    await made.library.loadCloudLibrary(SESSION)

    await tagFromElsewhere(made.bucket, 'from elsewhere')
    made.library.markCloudLibraryStale()
    const view = await made.library.loadCloudLibrary(SESSION)

    expect(view.library.tags.map(tag => tag.name)).toEqual(['from elsewhere'])
  })

  /*
   * A device that has read the bucket before has a library to show. Opening
   * the app waited on the network before showing it anyway.
   */
  it('answers from the copy on this device first, and says when the look behind it finds more', async () => {
    const store = memoryStore()
    const bucket = fakeBucket()
    const warmPlatform = platformFor(bucket, store)
    const warmSession = createCloudSession(warmPlatform)
    await warmSession.saveSession(SESSION)
    await createCloudLibrary(warmPlatform, warmSession).loadCloudLibrary(SESSION)

    await tagFromElsewhere(bucket, 'new here')
    // Opened again later: a look made moments ago would still be fresh.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 6 * 60_000)

    const gated = gatedPlatform(bucket, store)
    const library = createCloudLibrary(gated.platform, createCloudSession(gated.platform))
    const heard = new Promise<void>(resolve => {
      library.onCloudLibraryChanged(resolve)
    })

    // Answered while the bucket has not said a word.
    const view = await library.loadCloudLibrary(SESSION)
    expect(view.library.tags).toEqual([])

    gated.open()
    await heard
    const after = await library.loadCloudLibrary(SESSION)
    expect(after.library.tags.map(tag => tag.name)).toEqual(['new here'])
  })

  it('waits for a look asked for by name', async () => {
    const store = memoryStore()
    const bucket = fakeBucket()
    const gated = gatedPlatform(bucket, store)
    const session = createCloudSession(gated.platform)
    await session.saveSession(SESSION)
    const library = createCloudLibrary(gated.platform, session)

    gated.open()
    await library.loadCloudLibrary(SESSION)
    await tagFromElsewhere(bucket, 'checked for')

    library.markCloudLibraryStale()
    const view = await library.loadCloudLibrary(SESSION)
    expect(view.library.tags.map(tag => tag.name)).toEqual(['checked for'])
  })
})

afterEach(() => {
  vi.useRealTimers()
})

/** Let the clock run on: a look this long ago is as fresh as it is. */
function later(ms: number): void {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Date.now() + ms)
}

/** Wait for a look behind an answer to have asked the counter `times` times in all. */
async function counterAsked(bucket: ReturnType<typeof fakeBucket>, times: number): Promise<void> {
  await vi.waitFor(() => expect(bucket.asked()).toBe(times))
  // And for whatever it found to be taken in.
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('what looking costs the bucket', () => {
  it('asks only the counter while nothing has been written', async () => {
    const made = build(memoryStore(), fakeBucket({ counting: true }))
    await signedIn(made)
    made.bucket.files.set(SNAPSHOT_KEY, SNAPSHOT)
    await made.library.loadCloudLibrary(SESSION)
    const listed = made.bucket.lists.length
    const asked = made.bucket.asked()

    later(61_000)
    await made.library.loadCloudLibrary(SESSION)
    await counterAsked(made.bucket, asked + 1)
    expect(made.bucket.lists.length).toBe(listed)
  })

  it('lists once another device has written something, and finds it', async () => {
    const made = build(memoryStore(), fakeBucket({ counting: true }))
    await signedIn(made)
    await made.library.loadCloudLibrary(SESSION)

    await tagFromElsewhere(made.bucket, 'from elsewhere')
    const listed = made.bucket.lists.length
    const heard = new Promise<void>(resolve => {
      made.library.onCloudLibraryChanged(resolve)
    })
    later(61_000)
    await made.library.loadCloudLibrary(SESSION)
    await heard
    expect(made.bucket.lists.length).toBe(listed + 2)
    const view = await made.library.loadCloudLibrary(SESSION)
    expect(view.library.tags.map(tag => tag.name)).toEqual(['from elsewhere'])
  })

  it('does not list for its own uploads', async () => {
    const made = build(memoryStore(), fakeBucket({ counting: true }))
    await signedIn(made)
    await made.library.loadCloudLibrary(SESSION)
    const listed = made.bucket.lists.length
    for (const name of ['a', 'b']) {
      await made.library.recordChanges(SESSION, ctx => ({
        changes: edits.createTag(ctx, name, undefined).changes,
        answer: () => undefined,
      }))
      await made.library.flushCloudChanges()
    }
    expect(made.bucket.puts).toHaveLength(2)

    const asked = made.bucket.asked()
    later(61_000)
    await made.library.loadCloudLibrary(SESSION)
    await counterAsked(made.bucket, asked + 1)
    expect(made.bucket.lists.length).toBe(listed)
  })

  it('lists anyway after half an hour, for what the counter never saw', async () => {
    const made = build(memoryStore(), fakeBucket({ counting: true }))
    await signedIn(made)
    await made.library.loadCloudLibrary(SESSION)
    made.bucket.writeUncounted(SNAPSHOT_KEY, SNAPSHOT)

    later(61_000)
    await made.library.loadCloudLibrary(SESSION)
    await counterAsked(made.bucket, 2)
    expect((await made.library.loadCloudLibrary(SESSION)).library.songs).toEqual([])

    const heard = new Promise<void>(resolve => {
      made.library.onCloudLibraryChanged(resolve)
    })
    later(31 * 60_000)
    await made.library.loadCloudLibrary(SESSION)
    await heard
    expect((await made.library.loadCloudLibrary(SESSION)).library.songs).toHaveLength(1)
  })

  it('lists whatever the counter says when a look is asked for by name', async () => {
    const made = build(memoryStore(), fakeBucket({ counting: true }))
    await signedIn(made)
    await made.library.loadCloudLibrary(SESSION)
    made.bucket.writeUncounted(SNAPSHOT_KEY, SNAPSHOT)

    made.library.markCloudLibraryStale()
    const view = await made.library.loadCloudLibrary(SESSION)
    expect(view.library.songs).toHaveLength(1)
  })

  it('looks a good deal less often with a doorman that keeps no counter', async () => {
    const made = build()
    await signedIn(made)
    await made.library.loadCloudLibrary(SESSION)
    const listed = made.bucket.lists.length

    later(2 * 60_000)
    await made.library.loadCloudLibrary(SESSION)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(made.bucket.lists.length).toBe(listed)

    later(4 * 60_000)
    await made.library.loadCloudLibrary(SESSION)
    await vi.waitFor(() => expect(made.bucket.lists.length).toBe(listed + 2))
  })

  it('does not look again from a new tab, or a relaunch, while the last look is fresh', async () => {
    const store = memoryStore()
    const bucket = fakeBucket({ counting: true })
    const first = build(store, bucket)
    await signedIn(first)
    await first.library.loadCloudLibrary(SESSION)
    const listed = bucket.lists.length
    const asked = bucket.asked()

    const second = build(store, bucket)
    await second.library.loadCloudLibrary(SESSION)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(bucket.lists.length).toBe(listed)
    expect(bucket.asked()).toBe(asked)
  })

  it('lists once, and reads nothing it is held from, while the bucket refuses reads', async () => {
    const { releaseBucket } = await import('./hold.js')
    const made = build(memoryStore(), fakeBucket({ counting: true }))
    await signedIn(made)
    await made.library.loadCloudLibrary(SESSION)

    // A new snapshot goes up — and the day's reads are spent.
    await tagFromElsewhere(made.bucket, 'never mind')
    made.bucket.files.set(SNAPSHOT_KEY, SNAPSHOT)
    made.bucket.refuseReads(true)
    const listed = made.bucket.lists.length
    const read = made.bucket.reads.length
    try {
      for (let look = 0; look < 3; look++) {
        const asked = made.bucket.asked()
        later(61_000)
        await made.library.loadCloudLibrary(SESSION)
        await counterAsked(made.bucket, asked + 1)
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      // One look listed and was refused its first read; the others listed
      // nothing, and asked nothing the hold refuses.
      expect(made.bucket.lists.length).toBe(listed + 2)
      expect(made.bucket.reads.length).toBe(read + 1)

      // The reads come back: the same listing is read, not made again.
      made.bucket.refuseReads(false)
      releaseBucket()
      const heard = new Promise<void>(resolve => {
        made.library.onCloudLibraryChanged(resolve)
      })
      later(61_000)
      await made.library.loadCloudLibrary(SESSION)
      await heard
      expect(made.bucket.lists.length).toBe(listed + 2)
      expect((await made.library.loadCloudLibrary(SESSION)).library.songs).toHaveLength(1)
    } finally {
      releaseBucket()
    }
  })

  it('answers from the copy, and does not wait again, after a look asked for could not reach the bucket', async () => {
    const made = build(memoryStore(), fakeBucket({ counting: true }))
    await signedIn(made)
    made.bucket.files.set(SNAPSHOT_KEY, SNAPSHOT)
    expect((await made.library.loadCloudLibrary(SESSION)).library.songs).toHaveLength(1)
    // "Check for new songs", offline.
    made.library.markCloudLibraryStale()
    made.bucket.goOffline(true)
    expect((await made.library.loadCloudLibrary(SESSION)).library.songs).toHaveLength(1)
    const tried = made.bucket.unreached()
    expect(tried).toBeGreaterThan(0)
    // The next read is the copy's, at once: the look is not waited on again.
    expect((await made.library.loadCloudLibrary(SESSION)).library.songs).toHaveLength(1)
    expect(made.bucket.unreached()).toBe(tried)
  })

  it('answers where the server is from the copy, however long since the last look', async () => {
    const made = build(memoryStore(), fakeBucket({ counting: true }))
    await signedIn(made)
    await made.library.loadCloudLibrary(SESSION)
    const asked = made.bucket.asked()
    later(60 * 60_000)
    await made.library.peekCloudLibrary(SESSION)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(made.bucket.asked()).toBe(asked)
  })
})

describe('keeping the library on the device', () => {
  /*
   * A love, a tag or a rename changes none of the song files, playlists or
   * ids, and each of those is the size of the library.
   */
  it('writes files, playlists and ids only when an edit changes them', async () => {
    const made = build()
    await signedIn(made)
    made.bucket.files.set(SNAPSHOT_KEY, SNAPSHOT)
    const view = await made.library.loadCloudLibrary(SESSION)
    const songId = view.library.songs[0]?.id ?? 0

    const writes = recordWrites(made.store)
    await made.library.recordChanges(SESSION, ctx => ({
      changes: edits.editSong(ctx, songId, { loved: true }),
      answer: () => undefined,
    }))

    expect(writes.filter(key => key !== 'cloud-outbox')).toEqual(['cloud-state'])

    writes.length = 0
    await made.library.recordChanges(SESSION, ctx => ({
      changes: edits.createTag(ctx, 'new', undefined).changes,
      answer: () => undefined,
    }))
    // A new tag is a new id, and nothing else.
    expect(writes.filter(key => key !== 'cloud-outbox')).toEqual(['cloud-ids', 'cloud-state'])
  })

  /*
   * A phone's waiting plays are sent one after another, and must not each
   * replay and rewrite the whole library.
   */
  it('records plays without rebuilding the library, and shows them all at the next read', async () => {
    const made = build()
    await signedIn(made)
    made.bucket.files.set(SNAPSHOT_KEY, SNAPSHOT)
    const view = await made.library.loadCloudLibrary(SESSION)
    const songId = view.library.songs[0]?.id ?? 0

    const writes = recordWrites(made.store)
    for (let play = 0; play < 3; play++) {
      await made.library.recordChanges(
        SESSION,
        ctx => ({
          changes: edits.playSong(ctx, songId, { msPlayed: 180_000, completed: true }),
          answer: () => undefined,
        }),
        { deferView: true },
      )
    }
    expect(writes.filter(key => key !== 'cloud-outbox')).toEqual([])

    const after = await made.library.loadCloudLibrary(SESSION)
    expect(after.library.songs[0]?.playCount).toBe(3)
    // Built once for all three.
    expect(after.library.version).toBe(view.library.version + 1)
  })
})
