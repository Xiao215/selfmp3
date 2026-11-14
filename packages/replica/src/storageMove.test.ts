import { DOORMAN_ERROR, DoormanError, MOVE_COPY_MOST, type DoormanList } from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'
import {
  MoveError,
  bytesInWords,
  movePlan,
  runMove,
  type MoveApi,
  type MoveProgress,
} from './storageMove.js'

/**
 * The device's half of a move, against two places kept in memory: what a
 * round copies and in which order, that it ends only when a round finds
 * nothing left, and that stopping or failing leaves the storage as it was.
 */

const song = (n: number): string => `audio/${String(n).padStart(64, '0')}.m4a`
const COVER = `covers/${'c'.repeat(64)}.jpg`
const WORDS = `lyrics/${'d'.repeat(64)}.words`
const LOG = 'log/mac-3f9a1c2e/000000000001.json'
const SNAPSHOT = 'snapshots/20260911T142205123Z-mac-3f9a1c2e.json'
const OLD_SNAPSHOT = 'snapshots/20260901T000000000Z-mac-3f9a1c2e.json'

type Place = Map<string, number>

function places(from: Record<string, number>, to: Record<string, number> = {}) {
  const old: Place = new Map(Object.entries({ 'format.json': 100, ...from }))
  const next: Place = new Map(Object.entries({ 'format.json': 101, ...to }))
  const copied: string[][] = []
  let finished = false
  const page = (place: Place, cursor: string | null): Promise<DoormanList> => {
    // Two to a page, so every listing here is followed across pages.
    const keys = [...place.keys()].sort()
    const at = cursor === null ? 0 : Number(cursor)
    return Promise.resolve({
      objects: keys.slice(at, at + 2).map(key => ({ key, size: place.get(key) ?? 0 })),
      cursor: at + 2 < keys.length ? String(at + 2) : null,
    })
  }
  const api: MoveApi = {
    listFrom: cursor => page(old, cursor),
    listTo: cursor => page(next, cursor),
    room: () => Promise.resolve(null),
    copy: (keys, remove) => {
      copied.push([...keys])
      for (const key of keys) {
        const size = old.get(key)
        if (size !== undefined) next.set(key, size)
      }
      for (const key of remove) next.delete(key)
      return Promise.resolve()
    },
    finish: () => {
      finished = true
      return Promise.resolve()
    },
  }
  return { api, old, next, copied, isFinished: () => finished }
}

describe('movePlan', () => {
  it('names what the new place lacks, songs first and snapshots last', () => {
    const from = [SNAPSHOT, LOG, WORDS, COVER, song(2), song(1), 'format.json'].map(key => ({
      key,
      size: 10,
    }))
    const plan = movePlan(from, [
      { key: song(1), size: 10 },
      { key: 'format.json', size: 99 },
    ])
    expect(plan.songs.map(object => object.key)).toEqual([song(2)])
    expect(plan.rest.map(object => object.key)).toEqual([COVER, WORDS, LOG, SNAPSHOT])
    expect(plan).toMatchObject({ songsTotal: 2, songsAcross: 1, remove: [] })
  })

  it('copies again a file that arrived another size, and removes records the old place let go', () => {
    const plan = movePlan(
      [
        { key: song(1), size: 10 },
        { key: SNAPSHOT, size: 5 },
      ],
      [
        { key: song(1), size: 4 },
        { key: OLD_SNAPSHOT, size: 5 },
        // A song the old place removed is left: nothing names it, and nothing reads it.
        { key: song(9), size: 10 },
      ],
    )
    expect(plan.songs.map(object => object.key)).toEqual([song(1)])
    expect(plan.remove).toEqual([OLD_SNAPSHOT])
  })
})

describe('runMove', () => {
  it('copies everything a few files at a time, then finishes', async () => {
    const songs = Object.fromEntries(Array.from({ length: 20 }, (_, n) => [song(n), 1000 + n]))
    const { api, old, next, copied, isFinished } = places({
      ...songs,
      [COVER]: 50,
      [LOG]: 20,
      [SNAPSHOT]: 30,
    })
    const said: MoveProgress[] = []
    expect(await runMove(api, { onProgress: progress => said.push(progress) })).toBe(true)

    expect(isFinished()).toBe(true)
    for (const [key, size] of old) if (key !== 'format.json') expect(next.get(key)).toBe(size)
    // Each place keeps its own format.json.
    expect(next.get('format.json')).toBe(101)
    expect(copied.every(batch => batch.length <= MOVE_COPY_MOST)).toBe(true)
    // The newest snapshot is the last file to arrive.
    expect(copied.filter(batch => batch.length > 0).at(-1)).toEqual([LOG, SNAPSHOT])
    expect(said).toContainEqual({ phase: 'songs', done: 20, total: 20 })
    expect(said.at(-1)).toEqual({ phase: 'finishing' })
  })

  it('takes up a move where it stopped, counting what is already across', async () => {
    const { api, copied } = places(
      { [song(1)]: 10, [song(2)]: 10, [song(3)]: 10, [SNAPSHOT]: 5 },
      { [song(1)]: 10, [song(2)]: 10 },
    )
    const said: MoveProgress[] = []
    await runMove(api, { onProgress: progress => said.push(progress) })
    expect(copied.flat()).toEqual([song(3), SNAPSHOT])
    expect(said).toContainEqual({ phase: 'songs', done: 3, total: 3 })
  })

  it('goes round again for a song that arrived meanwhile', async () => {
    const { api, old, next, isFinished } = places({ [song(1)]: 10, [SNAPSHOT]: 5 })
    const copy = api.copy
    let added = false
    api.copy = async (keys, remove) => {
      await copy(keys, remove)
      if (!added) old.set(song(2), 10)
      added = true
    }
    await runMove(api)
    expect(next.get(song(2))).toBe(10)
    expect(isFinished()).toBe(true)
  })

  it('stops when asked, without finishing', async () => {
    const { api, isFinished } = places({ [song(1)]: 10, [SNAPSHOT]: 5 })
    let asked = false
    const copy = api.copy
    api.copy = async (keys, remove) => {
      await copy(keys, remove)
      asked = true
    }
    expect(await runMove(api, { stopped: () => asked })).toBe(false)
    expect(isFinished()).toBe(false)
  })

  it('tries a batch again when the storage is busy, and gives up on a real refusal', async () => {
    const busy = places({ [song(1)]: 10 })
    const copy = busy.api.copy
    let refusals = 2
    busy.api.copy = (keys, remove) =>
      refusals-- > 0
        ? Promise.reject(new DoormanError(502, DOORMAN_ERROR.bucketBusy, 'busy'))
        : copy(keys, remove)
    await expect(runMove(busy.api, { wait: () => Promise.resolve() })).resolves.toBe(true)

    const full = places({ [song(1)]: 10 })
    full.api.copy = () =>
      Promise.reject(
        new DoormanError(502, DOORMAN_ERROR.storageFull, 'Your Google storage is full.'),
      )
    await expect(runMove(full.api)).rejects.toThrow('Your Google storage is full.')
    expect(full.isFinished()).toBe(false)
  })

  it('copies nothing when the new place has no room for it', async () => {
    const { api, copied } = places({ [song(1)]: 3 * 1024 ** 3 })
    api.room = () => Promise.resolve({ used: 14 * 1024 ** 3, limit: 15 * 1024 ** 3 })
    await expect(runMove(api)).rejects.toThrow(
      new MoveError(
        'There is not enough room: 3.0 GB to move, and 1.0 GB free in your Google storage.',
      ),
    )
    expect(copied).toEqual([])
  })
})

describe('bytesInWords', () => {
  it('says a size as storage is spoken of', () => {
    expect(bytesInWords(0)).toBe('0 MB')
    expect(bytesInWords(1000)).toBe('1 MB')
    expect(bytesInWords(310 * 1024 ** 2)).toBe('310 MB')
    expect(bytesInWords(4.13 * 1024 ** 3)).toBe('4.1 GB')
    expect(bytesInWords(15 * 1024 ** 3)).toBe('15 GB')
  })
})
