import { IDLE_PACING, type ImportJob, type ImportQueue } from '@selfmp3/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { memoryStore } from '../../verify/fixtures.js'
import { createWatcher, GIVE_UP_AFTER } from './watcher.js'

const job = (id: string, patch: Partial<ImportJob> = {}): ImportJob => ({
  id,
  url: `https://www.youtube.com/watch?v=${id.padEnd(11, 'x')}`,
  status: 'running',
  step: 'downloading',
  progress: 10,
  title: `Song ${id}`,
  artist: 'YOASOBI',
  album: '',
  thumbnail: null,
  duration: 200,
  error: null,
  songId: null,
  attempts: 0,
  tagIds: [],
  createdAt: '2026-09-15 12:00:00',
  updatedAt: '2026-09-15 12:00:30',
  ...patch,
})

const queueOf = (jobs: ImportJob[]): ImportQueue => ({
  jobs,
  active: jobs.filter(each => each.status === 'running').length,
  queued: jobs.filter(each => each.status === 'queued').length,
  pacing: IDLE_PACING,
})

function watcherWith(first: ImportQueue, now?: () => Date) {
  const badges: string[] = []
  const notices: { title: string; message: string }[] = []
  let answer: () => ImportQueue = () => first
  let reads = 0
  const store = memoryStore()
  const watcher = createWatcher({
    store,
    queue: () => {
      reads += 1
      return Promise.resolve(answer())
    },
    badge: text => {
      badges.push(text)
    },
    notify: notice => notices.push(notice),
    now,
  })
  return {
    watcher,
    store,
    badges,
    notices,
    reads: () => reads,
    answerWith: (next: () => ImportQueue) => (answer = next),
  }
}

describe('the watcher', () => {
  it('counts what it started, then announces it once and goes quiet', async () => {
    const running = queueOf([job('a'), job('b')])
    const { watcher, badges, notices, answerWith } = watcherWith(running)

    await watcher.add([job('a'), job('b')], 'City pop night drive')
    expect(badges.at(-1)).toBe('2')

    await watcher.tick()
    expect(badges.at(-1)).toBe('2')
    expect(notices).toHaveLength(0)

    answerWith(() =>
      queueOf([
        job('a', { status: 'done', step: 'finished' }),
        job('b', { status: 'done', step: 'finished' }),
      ]),
    )
    await watcher.tick()
    expect(notices).toEqual([{ title: '2 songs added', message: 'City pop night drive' }])
    expect(badges.at(-1)).toBe('')

    // The batch is forgotten, so the next read says nothing again.
    await watcher.tick()
    expect(notices).toHaveLength(1)
  })

  it('holds a failure up on the badge until the popup is opened', async () => {
    const { watcher, badges, answerWith } = watcherWith(queueOf([job('a')]))
    await watcher.add([job('a')], null)
    answerWith(() => queueOf([job('a', { status: 'error', error: 'Video unavailable' })]))
    await watcher.tick()
    expect(badges.at(-1)).toBe('!')

    // Its own reads — the 2 s poll, the 30 s alarm — are not anyone looking.
    await watcher.tick()
    await watcher.tick()
    expect(badges.at(-1)).toBe('!')

    await watcher.seen()
    expect(badges.at(-1)).toBe('')
  })

  it('leaves the badge alone when the server cannot be read', async () => {
    const { watcher, badges } = watcherWith(queueOf([job('a')]))
    await watcher.add([job('a')], null)
    const before = badges.length
    await watcher.tick()
    expect(badges.length).toBeGreaterThan(before)

    const failing = createWatcher({
      store: memoryStore(),
      queue: () => Promise.reject(new Error('asleep')),
      badge: () => undefined,
      notify: () => undefined,
    })
    await expect(failing.tick()).resolves.toBeUndefined()
  })

  it('says nothing at all when nothing of ours is going', async () => {
    const { watcher, badges, notices } = watcherWith(queueOf([job('elsewhere')]))
    await watcher.tick()
    expect(badges).toEqual([''])
    expect(notices).toHaveLength(0)
  })

  it('reads less and less often while nothing changes, and every alarm again once something does', async () => {
    let at = Date.parse('2026-09-24T09:00:00Z')
    const { watcher, reads, answerWith, notices } = watcherWith(
      queueOf([job('a')]),
      () => new Date(at),
    )
    await watcher.add([job('a')], null)
    const alarms = async (count: number): Promise<void> => {
      for (let i = 0; i < count; i += 1) {
        at += 30_000
        await watcher.tick()
      }
    }

    // The first reads come at every alarm; then each read that finds nothing
    // new puts the next one a step further off.
    await alarms(2)
    expect(reads()).toBe(2)
    await alarms(1)
    expect(reads()).toBe(2)
    await alarms(1)
    expect(reads()).toBe(3)
    // An hour and a half of alarms is a handful of reads, not 180.
    await alarms(180)
    expect(reads()).toBeLessThan(12)
    // Settled at the last step: one read per twenty minutes, whatever the phase.
    const settled = reads()
    await alarms(80)
    expect(reads()).toBe(settled + 2)

    // The song lands: announced at the next read. A new import starts the
    // pace over, so its first alarms read again.
    answerWith(() => queueOf([job('a', { status: 'done', step: 'finished', progress: 100 })]))
    await alarms(40)
    expect(notices).toHaveLength(1)
    const announced = reads()
    await watcher.add([job('b')], null)
    answerWith(() => queueOf([job('b')]))
    await alarms(2)
    expect(reads()).toBe(announced + 2)
  })

  it('forgets a batch a day old even while the server cannot be read', async () => {
    let clock = new Date('2026-09-15T12:00:00Z')
    const { watcher, store, answerWith } = watcherWith(queueOf([job('a')]), () => clock)
    await watcher.add([job('a')], null)
    answerWith(() => {
      throw new Error('asleep')
    })

    clock = new Date('2026-09-16T11:00:00Z')
    await watcher.tick()
    expect(await store.read('batches')).toHaveLength(1)

    clock = new Date('2026-09-16T12:00:01Z')
    await watcher.tick()
    expect(await store.read('batches')).toEqual([])
  })

  describe('following', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('polls while a batch is going, and stops once the server has missed a few answers', async () => {
      vi.useFakeTimers()
      const { watcher, reads, answerWith } = watcherWith(queueOf([job('a')]))
      await watcher.add([job('a')], null)

      await vi.advanceTimersByTimeAsync(2_000)
      await vi.advanceTimersByTimeAsync(2_000)
      expect(reads()).toBe(2)

      answerWith(() => {
        throw new Error('asleep')
      })
      for (let i = 0; i < GIVE_UP_AFTER; i += 1) await vi.advanceTimersByTimeAsync(2_000)
      expect(reads()).toBe(2 + GIVE_UP_AFTER)

      // No more of its own: the alarm is what asks from here on.
      await vi.advanceTimersByTimeAsync(60_000)
      expect(reads()).toBe(2 + GIVE_UP_AFTER)

      // A new import starts it again, and one answer is a clean slate.
      await watcher.add([job('b')], null)
      answerWith(() => queueOf([job('a'), job('b')]))
      await vi.advanceTimersByTimeAsync(2_000)
      expect(reads()).toBe(3 + GIVE_UP_AFTER)
    })

    it('one slow answer among good ones does not end it', async () => {
      vi.useFakeTimers()
      const { watcher, reads, answerWith } = watcherWith(queueOf([job('a')]))
      await watcher.add([job('a')], null)
      let fail = true
      answerWith(() => {
        fail = !fail
        if (!fail) return queueOf([job('a')])
        throw new Error('slow')
      })
      for (let i = 0; i < 4 * GIVE_UP_AFTER; i += 1) await vi.advanceTimersByTimeAsync(2_000)
      expect(reads()).toBe(4 * GIVE_UP_AFTER)
    })
  })
})
