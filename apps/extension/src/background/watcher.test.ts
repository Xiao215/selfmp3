import { IDLE_PACING, type ImportJob, type ImportQueue } from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'
import { memoryStore } from '../../verify/fixtures.js'
import { createWatcher } from './watcher.js'

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

function watcherWith(first: ImportQueue) {
  const badges: string[] = []
  const notices: { title: string; message: string }[] = []
  let answer: () => ImportQueue = () => first
  const watcher = createWatcher({
    store: memoryStore(),
    queue: () => Promise.resolve(answer()),
    badge: text => {
      badges.push(text)
    },
    notify: notice => notices.push(notice),
  })
  return { watcher, badges, notices, answerWith: (next: () => ImportQueue) => (answer = next) }
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
})
