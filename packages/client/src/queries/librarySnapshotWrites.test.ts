import { describe, expect, it } from 'vitest'
import type { Library } from '@selfmp3/shared'
import { createLibrarySnapshotWrites, LIBRARY_SNAPSHOT_EVERY_MS } from './librarySnapshotWrites.js'

/*
 * The throttle on saving the offline library, against a clock and a timer of
 * the test's own: what is written, and when.
 */

const answer = (version: number, plays = 0): Library =>
  ({ version, songs: [{ id: 1, playCount: plays }], tags: [], playlists: [] }) as unknown as Library

const MINUTE = 60_000

function harness(withTimer = true) {
  let clock = 1_000_000
  const written: Library[] = []
  const timers: { at: number; run: () => void; cancelled: boolean }[] = []
  const writes = createLibrarySnapshotWrites(library => written.push(library), {
    now: () => clock,
    later: withTimer
      ? (ms, run) => {
          const timer = { at: clock + ms, run, cancelled: false }
          timers.push(timer)
          return () => {
            timer.cancelled = true
          }
        }
      : null,
  })
  return {
    writes,
    written,
    pendingTimers: () => timers.filter(timer => !timer.cancelled),
    /** Move the clock on, running every timer that falls due on the way. */
    advance(ms: number) {
      clock += ms
      for (const timer of timers) {
        if (!timer.cancelled && timer.at <= clock) {
          timer.cancelled = true
          timer.run()
        }
      }
    },
  }
}

describe('saving the offline library', () => {
  it('saves the first answer, and every answer whose version moved, straight away', () => {
    const h = harness()
    h.writes.offer(answer(1))
    h.writes.offer(answer(2))
    h.advance(1_000)
    h.writes.offer(answer(3))
    expect(h.written.map(library => library.version)).toEqual([1, 2, 3])
  })

  it('holds back an answer with the same version, and saves the latest when the interval is up', () => {
    const h = harness()
    h.writes.offer(answer(4, 0))
    h.advance(MINUTE)
    h.writes.offer(answer(4, 1))
    h.advance(MINUTE)
    h.writes.offer(answer(4, 2))
    expect(h.written).toHaveLength(1)

    h.advance(LIBRARY_SNAPSHOT_EVERY_MS - 2 * MINUTE - 1)
    expect(h.written).toHaveLength(1)
    h.advance(1)
    // Only the newest of the held answers, once.
    expect(h.written).toHaveLength(2)
    expect(h.written[1]).toEqual(answer(4, 2))
    expect(h.pendingTimers()).toHaveLength(0)
  })

  it('saves at once an answer with the same version once the interval has passed', () => {
    const h = harness()
    h.writes.offer(answer(4, 0))
    h.advance(LIBRARY_SNAPSHOT_EVERY_MS)
    h.writes.offer(answer(4, 5))
    expect(h.written).toEqual([answer(4, 0), answer(4, 5)])
  })

  it('lets a new version overtake the held answer, which is then not saved over it', () => {
    const h = harness()
    h.writes.offer(answer(4, 0))
    h.writes.offer(answer(4, 1))
    h.writes.offer(answer(5, 1))
    h.advance(LIBRARY_SNAPSHOT_EVERY_MS)
    expect(h.written).toEqual([answer(4, 0), answer(5, 1)])
  })

  it('drops the held answer on forget, and saves the next answer straight away', () => {
    const h = harness()
    h.writes.offer(answer(4, 0))
    h.writes.offer(answer(4, 1))
    h.writes.forget()
    h.advance(LIBRARY_SNAPSHOT_EVERY_MS)
    expect(h.written).toEqual([answer(4, 0)])

    // Another server's library may well have the same version number.
    h.writes.offer(answer(4, 9))
    expect(h.written).toEqual([answer(4, 0), answer(4, 9)])
  })

  it('without a timer, saves the next answer once the interval has passed', () => {
    const h = harness(false)
    h.writes.offer(answer(4, 0))
    h.writes.offer(answer(4, 1))
    h.advance(LIBRARY_SNAPSHOT_EVERY_MS)
    expect(h.written).toHaveLength(1)
    h.writes.offer(answer(4, 2))
    expect(h.written).toEqual([answer(4, 0), answer(4, 2)])
  })
})
