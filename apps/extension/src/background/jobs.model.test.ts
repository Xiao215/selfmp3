import { IDLE_PACING, type ImportJob, type ImportQueue } from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'
import { badgeText, finished, jobsOf, noticeFor, stillGoing, type Batch } from './jobs.model.js'

const job = (id: string, patch: Partial<ImportJob> = {}): ImportJob => ({
  id,
  url: `https://www.youtube.com/watch?v=${id.padEnd(11, 'x')}`,
  status: 'running',
  step: 'downloading',
  progress: 40,
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

const queue = (jobs: ImportJob[]): ImportQueue => ({
  jobs,
  active: jobs.filter(each => each.status === 'running').length,
  queued: jobs.filter(each => each.status === 'queued').length,
  done: 0,
  pacing: IDLE_PACING,
})

const batch = (jobIds: string[], label: string | null = null): Batch => ({
  id: jobIds[0] ?? 'b',
  jobIds,
  label,
  startedAt: '2026-09-15T12:00:00.000Z',
})

const done = { status: 'done', step: 'finished', progress: 100 } as const
const failedStep = { status: 'error', step: 'downloading', error: 'Video unavailable' } as const

describe('what the badge counts', () => {
  it('counts only the jobs this extension started', () => {
    const all = queue([job('a'), job('b'), job('elsewhere')])
    expect(jobsOf(all, [batch(['a', 'b'])]).map(each => each.id)).toEqual(['a', 'b'])
    expect(stillGoing(all, [batch(['a', 'b'])])).toBe(2)
    expect(stillGoing(queue([job('a', done), job('b')]), [batch(['a', 'b'])])).toBe(1)
  })

  it('says how many are going, then nothing, but holds up a failure', () => {
    expect(badgeText(3, false)).toBe('3')
    expect(badgeText(0, false)).toBe('')
    expect(badgeText(0, true)).toBe('!')
    // While more are going, the count is the more useful thing to show.
    expect(badgeText(2, true)).toBe('2')
  })
})

describe('a batch that has finished', () => {
  it('is one whose every job is done, failed or cancelled', () => {
    const batches = [batch(['a', 'b'])]
    expect(finished(queue([job('a', done), job('b')]), batches)).toHaveLength(0)
    expect(finished(queue([job('a', done), job('b', failedStep)]), batches)).toHaveLength(1)
    // Nothing known about it yet: not announced.
    expect(finished(queue([]), batches)).toHaveLength(0)
  })

  it('names one song, counts several, and says what did not make it', () => {
    const one = finished(queue([job('a', done)]), [batch(['a'])])[0]
    expect(one && noticeFor(one)).toEqual({ title: 'Song a added', message: 'YOASOBI' })

    const many = finished(queue([job('a', done), job('b', done), job('c', failedStep)]), [
      batch(['a', 'b', 'c'], 'City pop night drive'),
    ])[0]
    expect(many && noticeFor(many)).toEqual({
      title: '2 songs added',
      message: 'City pop night drive · 1 couldn’t be downloaded',
    })

    const none = finished(queue([job('a', failedStep)]), [batch(['a'])])[0]
    expect(none && noticeFor(none)).toEqual({
      title: '1 song couldn’t be downloaded',
      message: 'Video unavailable',
    })
  })

  it('says nothing about a batch you cancelled yourself', () => {
    const cancelled = finished(queue([job('a', { status: 'cancelled' })]), [batch(['a'])])[0]
    expect(cancelled && noticeFor(cancelled)).toBeNull()
  })
})
