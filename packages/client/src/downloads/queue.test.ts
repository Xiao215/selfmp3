import { describe, expect, it, vi } from 'vitest'
import type { Song, SyncManifest } from '@selfmp3/shared'

import type { DownloadTransfer, TransferProgress } from '../ports/offline.js'
import {
  addEntry,
  EMPTY_INDEX,
  entryFor,
  fileNameFor,
  type DownloadIndex,
} from './downloadIndex.js'
import { DownloadQueue } from './queue.js'

/**
 * The download queue, against a storage that does nothing but record.
 *
 * Written before the queue was, from the phone's `DownloadQueue` as it behaves
 * today, because that queue had no tests at all and is the only thing that lets
 * the phone play with no signal. Two tests assert behaviour the phone's copy got
 * wrong; they say so where they are.
 */

/** Let every pending promise chain run. No timers: the queue uses none. */
async function settle(): Promise<void> {
  for (let tick = 0; tick < 100; tick += 1) await Promise.resolve()
}

function song(id: number, title: string, sizeBytes: number): Song {
  return {
    id,
    title,
    artist: 'YOASOBI',
    album: '',
    albumArtist: '',
    path: `YOASOBI - ${title}/YOASOBI - ${title}.m4a`,
    mime: 'audio/mp4',
    sizeBytes,
    duration: 200,
    rev: 'r1',
    hasArt: false,
  } as unknown as Song
}

const FIRST = song(1, 'もう少しだけ', 1000)
const SECOND = song(2, '三原色', 2000)
const THIRD = song(3, 'ハルカ', 3000)

function entry(songId: number): Parameters<typeof addEntry>[1] {
  return {
    songId,
    fileName: `${songId}.m4a`,
    sizeBytes: 1,
    etag: '',
    downloadedAt: '2026-09-01T00:00:00.000Z',
  }
}

interface FakeTransfer extends DownloadTransfer {
  readonly songId: number
  runs: number
  paused: boolean
  cancelled: boolean
  progress: (progress: TransferProgress) => void
  finish(bytes: number): void
  fail(message: string): void
  /** What a platform does when a pause lands: resolve with null. */
  stopped(): void
}

function fakeStorage(
  options: { resumable?: boolean; available?: boolean; index?: DownloadIndex | null } = {},
) {
  const transfers: FakeTransfer[] = []
  const storage = {
    available: options.available ?? true,
    resumable: options.resumable ?? true,
    failWrite: false,
    written: [] as DownloadIndex[],
    discarded: [] as number[],
    deleted: [] as number[],
    cleared: 0,
    transfers,
    configure: vi.fn(),
    readIndex: vi.fn((): Promise<DownloadIndex | null> => Promise.resolve(options.index ?? null)),
    writeIndex(index: DownloadIndex): Promise<void> {
      if (storage.failWrite) return Promise.reject(new Error('disk full'))
      storage.written.push(index)
      return Promise.resolve()
    },
    localUri: (kept: { fileName: string }): string => `file:///songs/${kept.fileName}`,
    begin(
      target: Song,
      _expectedBytes: number,
      onProgress: (progress: TransferProgress) => void,
    ): DownloadTransfer {
      let resolve: (value: number | null) => void = () => undefined
      let reject: (error: Error) => void = () => undefined
      const transfer: FakeTransfer = {
        songId: target.id,
        runs: 0,
        paused: false,
        cancelled: false,
        progress: onProgress,
        run() {
          transfer.runs += 1
          return new Promise<number | null>((res, rej) => {
            resolve = res
            reject = rej
          })
        },
        pause() {
          transfer.paused = true
        },
        cancel() {
          transfer.cancelled = true
          reject(new Error('cancelled'))
        },
        finish(bytes) {
          resolve(bytes)
        },
        fail(message) {
          reject(new Error(message))
        },
        stopped() {
          resolve(null)
        },
      }
      transfers.push(transfer)
      return transfer
    },
    discard(target: Song): void {
      storage.discarded.push(target.id)
    },
    delete(kept: { songId: number }): void {
      storage.deleted.push(kept.songId)
    },
    clear(): Promise<void> {
      storage.cleared += 1
      return Promise.resolve()
    },
    last(songId: number): FakeTransfer {
      const found = [...transfers].reverse().find(transfer => transfer.songId === songId)
      if (!found) throw new Error(`no transfer began for song ${songId}`)
      return found
    },
  }
  return storage
}

const NOW = new Date('2026-09-12T00:00:00.000Z')

function setup(options: Parameters<typeof fakeStorage>[0] = {}) {
  const storage = fakeStorage(options)
  const queue = new DownloadQueue(storage, { now: () => NOW })
  queue.configure(null, [FIRST, SECOND, THIRD])
  return { storage, queue }
}

describe('keeping songs on this device', () => {
  it('fetches one song at a time, in order, skipping what is kept or already queued', async () => {
    const { storage, queue } = setup({ index: addEntry(EMPTY_INDEX, entry(2)) })
    await queue.load()

    queue.enqueue([1, 2, 3])
    queue.enqueue([3, 1])
    await settle()
    expect(queue.getState().queue).toEqual([1, 3])
    expect(storage.transfers.map(transfer => transfer.songId)).toEqual([1])

    storage.last(1).finish(1000)
    await settle()
    expect(storage.transfers.map(transfer => transfer.songId)).toEqual([1, 3])

    storage.last(3).finish(3000)
    await settle()
    expect(queue.getState().queue).toEqual([])
    expect(entryFor(queue.getState().index, 1)).toBeTruthy()
    expect(entryFor(queue.getState().index, 3)).toBeTruthy()
  })

  it('records what was actually written, with the manifest’s etag, and saves the index', async () => {
    const { storage, queue } = setup()
    queue.setManifest({
      entries: [{ id: 1, sizeBytes: 999, etag: 'abc' }],
    } as unknown as SyncManifest)

    queue.enqueue([1])
    await settle()
    storage.last(1).finish(1234)
    await settle()

    expect(entryFor(queue.getState().index, 1)).toMatchObject({
      songId: 1,
      sizeBytes: 1234,
      etag: 'abc',
      fileName: fileNameFor(FIRST),
      downloadedAt: NOW.toISOString(),
    })
    expect(storage.written.at(-1)).toEqual(queue.getState().index)
    expect(queue.getState()).toMatchObject({ activeSongId: null, bytesWritten: 0, totalBytes: 0 })
  })

  it('shows progress, falling back to the expected size when the platform does not know it', async () => {
    const { storage, queue } = setup()
    queue.enqueue([2])
    await settle()
    // No manifest: the song's own size is what is expected.
    expect(queue.getState()).toMatchObject({ activeSongId: 2, bytesWritten: 0, totalBytes: 2000 })

    storage.last(2).progress({ bytesWritten: 500, totalBytes: 0 })
    expect(queue.getState()).toMatchObject({ bytesWritten: 500, totalBytes: 2000 })

    storage.last(2).progress({ bytesWritten: 600, totalBytes: 2100 })
    expect(queue.getState()).toMatchObject({ bytesWritten: 600, totalBytes: 2100 })
  })

  it('prefers the manifest’s size to the library’s when it has one', async () => {
    const { queue } = setup()
    queue.setManifest({
      entries: [{ id: 1, sizeBytes: 1500, etag: '' }],
    } as unknown as SyncManifest)
    queue.enqueue([1])
    await settle()
    expect(queue.getState().totalBytes).toBe(1500)
  })

  it('continues a paused song where it stopped, where the platform can', async () => {
    const { storage, queue } = setup({ resumable: true })
    queue.enqueue([1, 2])
    await settle()
    storage.last(1).progress({ bytesWritten: 400, totalBytes: 1000 })

    queue.pause()
    expect(storage.last(1).paused).toBe(true)
    storage.last(1).stopped()
    await settle()
    expect(queue.getState()).toMatchObject({
      paused: true,
      queue: [1, 2],
      activeSongId: 1,
      bytesWritten: 400,
    })
    expect(entryFor(queue.getState().index, 1)).toBeFalsy()

    queue.resume()
    await settle()
    // The same transfer, run again — not a fresh one from zero.
    expect(storage.transfers.filter(transfer => transfer.songId === 1)).toHaveLength(1)
    expect(storage.last(1).runs).toBe(2)
    expect(queue.getState().bytesWritten).toBe(400)

    storage.last(1).finish(1000)
    await settle()
    expect(entryFor(queue.getState().index, 1)).toBeTruthy()
    expect(storage.transfers.map(transfer => transfer.songId)).toEqual([1, 2])
  })

  it('lets the song in flight finish and then stops, where the platform cannot resume', async () => {
    const { storage, queue } = setup({ resumable: false })
    queue.enqueue([1, 2])
    await settle()

    queue.pause()
    storage.last(1).finish(1000)
    await settle()
    expect(entryFor(queue.getState().index, 1)).toBeTruthy()
    expect(queue.getState()).toMatchObject({ paused: true, queue: [2] })
    expect(storage.transfers.map(transfer => transfer.songId)).toEqual([1])

    queue.resume()
    await settle()
    expect(storage.transfers.map(transfer => transfer.songId)).toEqual([1, 2])
  })

  it('carries on when Resume is tapped before the pause has landed', async () => {
    const { storage, queue } = setup({ resumable: true })
    queue.enqueue([1])
    await settle()

    queue.pause()
    queue.resume()
    storage.last(1).stopped()
    await settle()
    // Without this the queue would sit there: not paused, and nothing draining it.
    expect(queue.getState().paused).toBe(false)
    expect(storage.last(1).runs).toBe(2)

    storage.last(1).finish(1000)
    await settle()
    expect(entryFor(queue.getState().index, 1)).toBeTruthy()
  })

  it('reports a failed song, throws away what it left, and moves on', async () => {
    const one = setup()
    one.queue.enqueue([1])
    await settle()
    one.storage.last(1).fail('HTTP 500')
    await settle()
    expect(one.queue.getState().error).toBe('もう少しだけ: HTTP 500')
    expect(one.storage.discarded).toContain(1)
    expect(entryFor(one.queue.getState().index, 1)).toBeFalsy()

    const two = setup()
    two.queue.enqueue([1, 2])
    await settle()
    two.storage.last(1).fail('HTTP 500')
    await settle()
    expect(two.storage.transfers.map(transfer => transfer.songId)).toEqual([1, 2])
  })

  it('says so when asked for a song the library does not have', async () => {
    const { storage, queue } = setup()
    queue.enqueue([99])
    await settle()
    expect(queue.getState().error).toBe('Cannot download song 99: it is not in the library')
    expect(storage.transfers).toHaveLength(0)
    expect(queue.getState().queue).toEqual([])
  })

  it('reports a song with nowhere to fetch it from, instead of stalling (a phone bug)', async () => {
    // The phone looked for a Mac or a cloud session outside its try, so this
    // error escaped the loop: nothing on screen, and nothing downloading again.
    const storage = fakeStorage()
    let attempts = 0
    const nowhere = {
      ...storage,
      begin(): DownloadTransfer {
        attempts += 1
        throw new Error('no server, and not signed in to the cloud')
      },
    }
    const queue = new DownloadQueue(nowhere, { now: () => NOW })
    queue.configure(null, [FIRST])

    queue.enqueue([1])
    await settle()
    expect(queue.getState().error).toBe('もう少しだけ: no server, and not signed in to the cloud')
    expect(queue.getState()).toMatchObject({ queue: [], activeSongId: null })

    // And the queue is not left believing it is still running.
    queue.enqueue([1])
    await settle()
    expect(attempts).toBe(2)
  })

  it('cancels a song in flight without reporting the cancel as a failure', async () => {
    const { storage, queue } = setup()
    queue.enqueue([1, 2])
    await settle()

    queue.cancelAll()
    await settle()
    expect(storage.last(1).cancelled).toBe(true)
    expect(storage.discarded).toContain(1)
    expect(queue.getState()).toMatchObject({
      queue: [],
      activeSongId: null,
      paused: false,
      error: null,
    })
    expect(storage.transfers.map(transfer => transfer.songId)).toEqual([1])
  })

  it('does not swallow the next real failure after cancelling a paused song (a phone bug)', async () => {
    // The phone set its "this rejection is only a cancel" flag even for a paused
    // transfer, which never rejects — so the flag stayed set, and the next
    // genuine failure, whenever it came, was hidden.
    const { storage, queue } = setup({ resumable: true })
    queue.enqueue([1])
    await settle()
    queue.pause()
    storage.last(1).stopped()
    await settle()

    queue.cancelAll()
    await settle()

    queue.enqueue([2])
    await settle()
    storage.last(2).fail('HTTP 500')
    await settle()
    expect(queue.getState().error).toBe('三原色: HTTP 500')
  })

  it('removes kept songs, and everything at once', async () => {
    const { storage, queue } = setup({ index: addEntry(addEntry(EMPTY_INDEX, entry(1)), entry(2)) })
    await queue.load()

    await queue.remove([1, 3])
    expect(storage.deleted).toEqual([1])
    expect(entryFor(queue.getState().index, 1)).toBeFalsy()
    expect(entryFor(queue.getState().index, 2)).toBeTruthy()
    expect(storage.written.at(-1)).toEqual(queue.getState().index)

    await queue.removeAll()
    expect(storage.cleared).toBe(1)
    expect(queue.getState().index).toEqual(EMPTY_INDEX)
  })

  it('loads the index it has, and starts empty when there is none or it cannot be read', async () => {
    const kept = addEntry(EMPTY_INDEX, entry(1))

    const present = setup({ index: kept })
    await present.queue.load()
    expect(present.queue.getState().index).toEqual(kept)

    const none = setup({ index: null })
    await none.queue.load()
    expect(none.queue.getState().index).toEqual(EMPTY_INDEX)

    const unavailable = setup({ available: false, index: kept })
    await unavailable.queue.load()
    expect(unavailable.queue.getState().index).toEqual(EMPTY_INDEX)
    expect(unavailable.storage.readIndex).not.toHaveBeenCalled()

    const broken = fakeStorage()
    const unreadable = new DownloadQueue(
      { ...broken, readIndex: () => Promise.reject(new Error('bad json')) },
      { now: () => NOW },
    )
    await unreadable.load()
    expect(unreadable.getState().index).toEqual(EMPTY_INDEX)
  })

  it('keeps the song it fetched when the index cannot be saved, and says why', async () => {
    const { storage, queue } = setup()
    storage.failWrite = true
    queue.enqueue([1])
    await settle()
    storage.last(1).finish(1000)
    await settle()
    expect(queue.getState().error).toBe('disk full')
    expect(entryFor(queue.getState().index, 1)).toBeTruthy()
  })

  it('answers where a kept song is, and null for one it does not have', async () => {
    const { queue } = setup({ index: addEntry(EMPTY_INDEX, entry(1)) })
    await queue.load()
    expect(queue.localUri(1)).toBe('file:///songs/1.m4a')
    expect(queue.localUri(2)).toBeNull()
  })

  it('tells the storage where downloads come from, and the songs they belong to', () => {
    const { storage, queue } = setup()
    const connection = { baseUrl: 'http://mac:4600', token: null }
    queue.configure(connection as never, [FIRST])
    expect(storage.configure).toHaveBeenLastCalledWith(connection, [FIRST])
  })
})
