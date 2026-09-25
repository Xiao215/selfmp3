import { ImportEnqueueSchema, type ImportJob, type ImportPreviewItem } from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'

import {
  chosenItems,
  dismissable,
  enqueueRequest,
  finishedLabel,
  foldQueue,
  hasLink,
  jobAction,
  jobSubtitle,
  jobTone,
  landed,
  linkHint,
  matchingTag,
  queueActivity,
  queueControls,
  refreshAlreadyHave,
  reviewFrom,
  sharedLinks,
} from './model.js'

describe('how a job’s row is tinted', () => {
  it('is the job’s own status, until the song is waiting for the bucket', () => {
    expect(jobTone({ status: 'running', step: 'downloading' })).toBe('running')
    expect(jobTone({ status: 'done', step: 'done' })).toBe('done')
    expect(jobTone({ status: 'error', step: 'downloading' })).toBe('error')
  })

  it('calls a song the server has but the cloud does not "waiting", not failed', () => {
    expect(jobTone({ status: 'error', step: 'uploading' })).toBe('waiting')
  })
})

describe('matchingTag', () => {
  const tags = [
    { id: 1, name: 'reference' },
    { id: 2, name: 'YOASOBI' },
  ]

  it('finds the tag a link is named after, whatever the case', () => {
    expect(matchingTag(tags, 'yoasobi')).toBe(2)
    expect(matchingTag(tags, ' Reference ')).toBe(1)
  })

  it('finds nothing for a name you have no tag for, or no name at all', () => {
    expect(matchingTag(tags, 'Ado')).toBeNull()
    expect(matchingTag(tags, null)).toBeNull()
    expect(matchingTag(tags, '  ')).toBeNull()
  })
})

const item = (n: number, alreadyHave = false): ImportPreviewItem => ({
  url: `https://music.youtube.com/watch?v=${n}`,
  title: `Song ${n}`,
  artist: 'YOASOBI',
  album: '',
  duration: 200,
  thumbnail: null,
  alreadyHave,
})

const job = (
  patch: Partial<ImportJob>,
): Pick<ImportJob, 'status' | 'step' | 'error' | 'attempts'> => ({
  status: 'queued',
  step: 'waiting',
  error: null,
  attempts: 0,
  ...patch,
})

describe('import review', () => {
  const preview = {
    kind: 'playlist' as const,
    playlistTitle: 'THE BOOK',
    items: [item(1), item(2, true), item(3)],
  }

  it('pre-ticks everything but what the library already has', () => {
    const review = reviewFrom(preview)
    expect([...review.chosen]).toEqual([0, 2])
    expect(review.playlistTitle).toBe('THE BOOK')
  })

  it('keeps no playlist name for a single link', () => {
    expect(reviewFrom({ ...preview, kind: 'single' }).playlistTitle).toBeNull()
  })

  it('imports only the ticked tracks, as the server expects them', () => {
    const review = reviewFrom(preview)
    const request = enqueueRequest(review, {
      tagIds: new Set([7]),
      playlistId: null,
      createPlaylist: true,
    })
    expect(chosenItems(review)).toHaveLength(2)
    expect(request.items.map(i => i.title)).toEqual(['Song 1', 'Song 3'])
    expect(request.tagIds).toEqual([7])
    expect(request.createPlaylistName).toBe('THE BOOK')
    expect(ImportEnqueueSchema.safeParse(request).success).toBe(true)
  })

  it('lets a chosen playlist win over creating one', () => {
    const request = enqueueRequest(reviewFrom(preview), {
      tagIds: new Set(),
      playlistId: 4,
      createPlaylist: true,
    })
    expect(request.playlistId).toBe(4)
    expect(request.createPlaylistName).toBeNull()
  })
})

describe('import queue', () => {
  it('describes where a job is up to', () => {
    expect(jobSubtitle(job({ status: 'running', step: 'lyrics' }))).toBe('Looking for lyrics')
    expect(jobSubtitle(job({ status: 'done', step: 'finished' }))).toBe('Added to your library')
    expect(jobSubtitle(job({ status: 'cancelled' }))).toBe('Cancelled')
    expect(jobSubtitle(job({ status: 'error', error: 'Video unavailable', attempts: 1 }))).toBe(
      'Video unavailable',
    )
    expect(jobSubtitle(job({ status: 'error', error: null, attempts: 3 }))).toBe(
      'Failed · 3 attempts',
    )
  })

  it('offers cancel while going, retry after, and nothing when done', () => {
    expect(jobAction(job({ status: 'queued' }))).toBe('cancel')
    expect(jobAction(job({ status: 'running', step: 'downloading' }))).toBe('cancel')
    // The song is already on its way into the library: the server refuses.
    expect(jobAction(job({ status: 'running', step: 'saving' }))).toBeNull()
    expect(jobAction(job({ status: 'error', step: 'downloading' }))).toBe('retry')
    expect(jobAction(job({ status: 'cancelled' }))).toBe('retry')
    expect(jobAction(job({ status: 'error', step: 'uploading' }))).toBe('try-now')
    expect(jobAction(job({ status: 'done', step: 'finished' }))).toBeNull()
  })

  it('lets any row still short of adding its song be removed, and never one done or past that', () => {
    expect(dismissable(job({ status: 'error', step: 'finished' }))).toBe(true)
    expect(dismissable(job({ status: 'error', step: 'uploading' }))).toBe(true)
    expect(dismissable(job({ status: 'cancelled' }))).toBe(true)
    expect(dismissable(job({ status: 'queued' }))).toBe(true)
    expect(dismissable(job({ status: 'running', step: 'downloading' }))).toBe(true)
    expect(dismissable(job({ status: 'running', step: 'saving' }))).toBe(false)
    expect(dismissable(job({ status: 'done', step: 'finished' }))).toBe(false)
  })

  it('folds the finished jobs away and keeps what still needs you', () => {
    const jobs = [
      job({ status: 'done' }),
      job({ status: 'running', step: 'downloading' }),
      job({ status: 'error' }),
      job({ status: 'done' }),
      job({ status: 'cancelled' }),
    ]
    const { open, finished } = foldQueue(jobs)
    expect(open.map(j => j.status)).toEqual(['running', 'error', 'cancelled'])
    expect(finished).toHaveLength(2)
  })

  it('says the finished ones were added today only when all of them were', () => {
    const now = new Date('2026-09-14T15:00:00')
    const at = (local: string) => ({ updatedAt: new Date(local).toISOString() })
    expect(finishedLabel([at('2026-09-14T09:00:00'), at('2026-09-14T14:00:00')], now)).toBe(
      '2 added today',
    )
    expect(finishedLabel([at('2026-09-13T22:00:00'), at('2026-09-14T09:00:00')], now)).toBe(
      '2 added',
    )
    // The server's own stamps are UTC with a space and no zone.
    const utc = now.toISOString().slice(0, 19).replace('T', ' ')
    expect(finishedLabel([{ updatedAt: utc }], now)).toBe('1 added today')
  })

  it('offers Pause all for what a cancel would take, and Resume all for what was paused', () => {
    expect(
      queueControls([
        job({ status: 'queued' }),
        job({ status: 'running', step: 'downloading' }),
        job({ status: 'running', step: 'saving' }),
        job({ status: 'cancelled' }),
        job({ status: 'error', step: 'downloading' }),
        job({ status: 'error', step: 'uploading' }),
      ]),
    ).toEqual({ pausable: 2, resumable: 1 })
    expect(queueControls([])).toEqual({ pausable: 0, resumable: 0 })
  })

  it('reports activity only while there is some', () => {
    expect(queueActivity({ active: 1, queued: 4 })).toBe('1 downloading, 4 waiting')
    expect(queueActivity({ active: 0, queued: 0 })).toBeNull()
  })
})

describe('the links box', () => {
  it('reads a link anywhere in the box, as the server does', () => {
    expect(hasLink('https://music.youtube.com/watch?v=abc')).toBe(true)
    expect(hasLink('YOASOBI\nhttps://youtu.be/dGZqpVCJP3k')).toBe(true)
    expect(hasLink('music.youtube.com/watch?v=abc')).toBe(false)
    expect(hasLink('yoasobi idol')).toBe(false)
  })

  it('says so under the box only once something without a link is typed', () => {
    expect(linkHint('')).toBeNull()
    expect(linkHint('   \n')).toBeNull()
    expect(linkHint('https://youtu.be/dGZqpVCJP3k')).toBeNull()
    expect(linkHint('not a link')).toBe(
      'That doesn’t look like a link. Paste a music.youtube.com or youtube.com address.',
    )
  })
})

describe('shared links', () => {
  it('finds the link wherever the sharing app put it', () => {
    expect(sharedLinks({ url: 'https://music.youtube.com/watch?v=a' })).toBe(
      'https://music.youtube.com/watch?v=a',
    )
    expect(sharedLinks({ text: 'アイドル https://youtu.be/ZRtdQ81jPUQ' })).toBe(
      'https://youtu.be/ZRtdQ81jPUQ',
    )
    expect(sharedLinks({ url: ['https://youtu.be/x', 'ignored'] })).toBe('https://youtu.be/x')
  })

  it('gives nothing when nothing shared is a link', () => {
    expect(sharedLinks({ text: 'just a title' })).toBeNull()
    expect(sharedLinks({})).toBeNull()
  })

  it('merges the url and the text without saying a link twice', () => {
    expect(
      sharedLinks({ url: 'https://a.example/x', text: 'https://a.example/x https://b.example/y' }),
    ).toBe('https://a.example/x\nhttps://b.example/y')
  })
})

describe('a kept review told again what the library has', () => {
  const item = (n: number, alreadyHave: boolean): ImportPreviewItem => ({
    url: `https://youtu.be/${n}`,
    title: `Song ${n}`,
    artist: 'YOASOBI',
    album: '',
    duration: 200,
    thumbnail: null,
    alreadyHave,
    waitingToUpload: false,
  })
  const review = reviewFrom({
    kind: 'playlist',
    playlistTitle: 'Top songs',
    items: [item(1, true), item(2, false), item(3, false)],
  })

  it('frees a song that was removed since, and ticks it; takes one imported since out', () => {
    const next = refreshAlreadyHave(review, [false, true, false])
    expect(next.items.map(i => i.alreadyHave)).toEqual([false, true, false])
    expect([...next.chosen].sort()).toEqual([0, 2])
  })

  it('is the same review when nothing changed, or when the answer does not fit', () => {
    expect(refreshAlreadyHave(review, [true, false, false])).toBe(review)
    expect(refreshAlreadyHave(review, [true, false])).toBe(review)
  })

  it('says a song of yours reached the bucket, or is still waiting, without touching the ticks', () => {
    const next = refreshAlreadyHave(review, [true, false, false], [true, false, false])
    expect(next.items.map(i => i.waitingToUpload)).toEqual([true, false, false])
    expect([...next.chosen].sort()).toEqual([1, 2])
    expect(
      refreshAlreadyHave(next, [true, false, false], [false, false, false]).items[0],
    ).toMatchObject({ alreadyHave: true, waitingToUpload: false })
    // A song no longer yours cannot be waiting either.
    expect(refreshAlreadyHave(next, [false, false, false]).items[0]).toMatchObject({
      alreadyHave: false,
      waitingToUpload: false,
    })
  })

  it('keeps a tick you took off yourself', () => {
    const unticked = { ...review, chosen: new Set([1]) }
    const next = refreshAlreadyHave(unticked, [false, false, false])
    expect([...next.chosen].sort()).toEqual([0, 1])
  })
})

describe('which imports have just landed', () => {
  const jobs = (...each: [string, ImportJob['status']][]) =>
    each.map(([id, status]) => ({ id, status }))

  it('counts a job done now that was not done at the last read', () => {
    const first = landed(new Set(), jobs(['a', 'running'], ['b', 'done']))
    expect(first.landed).toBe(1)
    const second = landed(first.done, jobs(['a', 'done'], ['b', 'done']))
    expect(second.landed).toBe(1)
    expect([...second.done]).toEqual(['a', 'b'])
  })

  it('lands nothing from a queue read for the first time, however much is on it', () => {
    const first = landed(null, jobs(['a', 'done'], ['b', 'done']))
    expect(first.landed).toBe(0)
    expect([...first.done]).toEqual(['a', 'b'])
  })

  it('does not count a failure, a cancel, or a job still going', () => {
    const before = new Set<string>()
    expect(landed(before, jobs(['a', 'error'], ['b', 'cancelled'], ['c', 'running'])).landed).toBe(
      0,
    )
  })

  it('counts nothing twice, and forgets a job the server cleared', () => {
    const first = landed(new Set(), jobs(['a', 'done']))
    const again = landed(first.done, jobs(['a', 'done']))
    expect(again.landed).toBe(0)
    const cleared = landed(again.done, jobs())
    expect(cleared.done.size).toBe(0)
  })
})
