import { ImportEnqueueSchema, type ImportJob, type ImportPreviewItem } from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'

import {
  canLookUp,
  canImportNext,
  changeQueue,
  chooseSource,
  chosenItems,
  describePaste,
  dismissable,
  enqueueRequest,
  finishedLabel,
  foldQueue,
  clockIn,
  hasLink,
  jobAction,
  jobSubtitle,
  jobTone,
  landed,
  linkHint,
  lookAgain,
  lookingFor,
  matchingTag,
  queueActivity,
  queueControls,
  refreshAlreadyHave,
  reviewFrom,
  sharedLinks,
  stepFraction,
  timeLeft,
  withFound,
  type Review,
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
    expect(jobSubtitle(job({ status: 'cancelled' }))).toBe('Paused')
    expect(jobSubtitle(job({ status: 'error', error: 'Video unavailable', attempts: 1 }))).toBe(
      'Video unavailable',
    )
    expect(jobSubtitle(job({ status: 'error', error: null, attempts: 3 }))).toBe(
      'Failed · 3 attempts',
    )
  })

  it('offers cancel while going, resume when paused, retry after, and nothing when done', () => {
    expect(jobAction(job({ status: 'queued' }))).toBe('cancel')
    expect(jobAction(job({ status: 'running', step: 'downloading' }))).toBe('cancel')
    // The song is already on its way into the library: the server refuses.
    expect(jobAction(job({ status: 'running', step: 'saving' }))).toBeNull()
    expect(jobAction(job({ status: 'error', step: 'downloading' }))).toBe('retry')
    expect(jobAction(job({ status: 'cancelled' }))).toBe('resume')
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

  it('keeps what failed apart from what is importing, and folds the finished away', () => {
    const jobs = [
      job({ status: 'done' }),
      job({ status: 'running', step: 'downloading' }),
      job({ status: 'error', step: 'finished' }),
      job({ status: 'done' }),
      job({ status: 'cancelled' }),
      // In the library already, and going up by itself: still importing.
      job({ status: 'error', step: 'uploading' }),
    ]
    const { importing, failed, finished } = foldQueue(jobs)
    expect(importing.map(j => `${j.status}/${j.step}`)).toEqual([
      'running/downloading',
      'cancelled/waiting',
      'error/uploading',
    ])
    expect(failed.map(j => j.status)).toEqual(['error'])
    expect(finished).toHaveLength(2)
  })

  it('moves a song’s ring by its steps, the download filling only its own share', () => {
    const at = (patch: Partial<ImportJob>) =>
      stepFraction({ status: 'running', step: 'downloading', progress: null, ...patch })
    expect(stepFraction({ status: 'queued', step: 'waiting', progress: null })).toBe(0)
    expect(at({ step: 'resolving' })).toBe(0.1)
    expect(at({ progress: 0 })).toBe(0.2)
    expect(at({ progress: 100 })).toBeCloseTo(0.4)
    expect(at({ step: 'uploading' })).toBe(0.88)
    // Each step further on is further round.
    const steps = [
      'resolving',
      'downloading',
      'converting',
      'lyrics',
      'saving',
      'uploading',
    ] as const
    const fills = steps.map(step => at({ step }))
    expect([...fills].sort((a, b) => a - b)).toEqual(fills)
    expect(stepFraction({ status: 'cancelled', step: 'finished', progress: 40 })).toBe(0)
  })

  it('counts a wait down in minutes and seconds, rounded up', () => {
    expect(clockIn(38_000)).toBe('0:38')
    expect(clockIn(37_200)).toBe('0:38')
    expect(clockIn(724_000)).toBe('12:04')
    expect(clockIn(-5)).toBe('0:00')
  })

  it('says how long is left in round words', () => {
    expect(timeLeft(20_000)).toBe('less than a minute left')
    expect(timeLeft(38 * 60_000)).toBe('about 38 min left')
    expect(timeLeft(80 * 60_000)).toBe('about 1 h 20 min left')
    expect(timeLeft(120 * 60_000)).toBe('about 2 h left')
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

  describe('drawn at once, before the server answers', () => {
    const full = (id: string, patch: Partial<ImportJob>): ImportJob => ({
      id,
      url: `https://youtu.be/${id}`,
      status: 'queued',
      step: 'waiting',
      progress: null,
      title: id,
      artist: '',
      album: '',
      thumbnail: null,
      duration: 0,
      error: null,
      songId: null,
      attempts: 1,
      tagIds: [],
      createdAt: '2026-10-01 09:00:00',
      updatedAt: '2026-10-01 09:00:00',
      ...patch,
    })
    const queue = {
      active: 2,
      queued: 1,
      done: 0,
      pacing: null,
      jobs: [
        full('failed', { status: 'error', step: 'finished', error: 'Video unavailable' }),
        full('upload', { status: 'error', step: 'uploading', error: 'Bucket away' }),
        full('down', { status: 'running', step: 'downloading', progress: 40 }),
        full('saving', { status: 'running', step: 'saving' }),
        full('wait', {}),
        full('paused', { status: 'cancelled', step: 'finished' }),
      ],
    }
    const states = (q: { jobs: readonly ImportJob[] }): string[] =>
      q.jobs.map(j => `${j.id}:${j.status}`)

    it('pauses one row, or every row a Pause would take, and counts again', () => {
      const one = changeQueue(queue, { kind: 'pause', id: 'down' })
      expect(one.jobs.find(j => j.id === 'down')).toMatchObject({
        status: 'cancelled',
        progress: null,
      })
      expect(one).toMatchObject({ active: 1, queued: 1 })

      const all = changeQueue(queue, { kind: 'pause' })
      expect(states(all)).toEqual([
        'failed:error',
        'upload:error',
        'down:cancelled',
        'saving:running',
        'wait:cancelled',
        'paused:cancelled',
      ])
      expect(all).toMatchObject({ active: 1, queued: 0 })
    })

    it('resumes what was paused into the queue, where it stands', () => {
      const all = changeQueue(changeQueue(queue, { kind: 'pause' }), { kind: 'resume' })
      expect(states(all)).toEqual([
        'failed:error',
        'upload:error',
        'down:queued',
        'saving:running',
        'wait:queued',
        'paused:queued',
      ])
    })

    it('retries one failed row, or every failure but the one waiting on its upload', () => {
      const one = changeQueue(queue, { kind: 'retry', id: 'failed' })
      expect(one.jobs[0]).toMatchObject({ status: 'queued', step: 'waiting', error: null })
      expect(one.queued).toBe(2)

      const all = changeQueue(queue, { kind: 'retry' })
      expect(states(all).slice(0, 2)).toEqual(['failed:queued', 'upload:error'])
    })

    it('removes one row it may, never one adding its song, and every failure at once', () => {
      expect(changeQueue(queue, { kind: 'remove', id: 'wait' }).jobs).toHaveLength(5)
      expect(changeQueue(queue, { kind: 'remove', id: 'saving' }).jobs).toHaveLength(6)
      expect(changeQueue(queue, { kind: 'remove' }).jobs.map(j => j.id)).toEqual([
        'upload',
        'down',
        'saving',
        'wait',
        'paused',
      ])
    })

    it('imports a song next as the server moves it: ahead of the other waiting ones', () => {
      const longer = {
        ...queue,
        jobs: [...queue.jobs, full('later', {}), full('last', {})],
      }
      const ids = (q: { jobs: readonly ImportJob[] }): string[] => q.jobs.map(j => j.id)

      expect(ids(changeQueue(longer, { kind: 'next', id: 'last' }))).toEqual([
        'failed',
        'upload',
        'down',
        'saving',
        'last',
        'wait',
        'paused',
        'later',
      ])
      // A paused song is queued on the way.
      const paused = changeQueue(longer, { kind: 'next', id: 'paused' })
      expect(states(paused).slice(4, 6)).toEqual(['paused:queued', 'wait:queued'])
      expect(paused.queued).toBe(4)
      // Already next, or not waiting at all: nothing moves.
      expect(ids(changeQueue(longer, { kind: 'next', id: 'wait' }))).toEqual(ids(longer))
      expect(changeQueue(longer, { kind: 'next', id: 'down' }).jobs).toEqual(longer.jobs)
    })

    it('offers Import next for a song behind others, or a paused one', () => {
      expect(canImportNext({ id: 'wait', status: 'queued' }, 'first')).toBe(true)
      expect(canImportNext({ id: 'first', status: 'queued' }, 'first')).toBe(false)
      expect(canImportNext({ id: 'paused', status: 'cancelled' }, 'first')).toBe(true)
      expect(canImportNext({ id: 'down', status: 'running' }, 'first')).toBe(false)
      expect(canImportNext({ id: 'failed', status: 'error' }, null)).toBe(false)
    })
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
    inQueue: false,
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

  it('takes a song out once a job for it is in the queue, and offers it back when the job is gone', () => {
    const queued = refreshAlreadyHave(review, [true, false, false], [], [false, true, false])
    expect(queued.items[1]?.inQueue).toBe(true)
    expect([...queued.chosen].sort()).toEqual([2])
    const gone = refreshAlreadyHave(queued, [true, false, false], [], [false, false, false])
    expect([...gone.chosen].sort()).toEqual([1, 2])
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

describe('what the box holds', () => {
  it('takes links and song names alike', () => {
    expect(canLookUp('yoasobi idol')).toBe(true)
    expect(canLookUp('  \n ')).toBe(false)
  })

  it('says what was pasted, before it is looked up', () => {
    expect(describePaste('')).toBeNull()
    expect(
      describePaste(
        '分享Xiao创建的歌单《夜车》: https://y.music.163.com/m/playlist?id=7713825406 (来自@网易云音乐)',
      ),
    ).toBe('网易云 playlist')
    expect(describePaste('https://music.163.com/#/song?id=186016')).toBe('网易云 song')
    expect(describePaste('https://music.163.com/#/artist?id=8325')).toBe('网易云 artist')
    expect(describePaste('https://163cn.tv/zZ3PjY')).toBe('网易云 link')
    expect(describePaste('https://open.spotify.com/album/4m2880jivSbbyEGAKfITCa')).toBe(
      'Spotify album',
    )
    expect(describePaste('https://open.spotify.com/track/2Foc5Q5nqNiosCNqttzHof')).toBe(
      'Spotify song',
    )
    expect(
      describePaste('https://music.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG'),
    ).toBe('YouTube playlist')
    expect(describePaste('https://youtu.be/dGZqpVCJP3k')).toBe('YouTube song')
    expect(describePaste('https://youtu.be/a\nhttps://youtu.be/b')).toBe('2 links')
    expect(describePaste('Daft Punk - Get Lucky\nRadiohead - Creep')).toBe('A list of song names')
  })
})

describe('songs found by their names', () => {
  const byName = (n: number, patch: Partial<ImportPreviewItem> = {}): ImportPreviewItem => ({
    url: '',
    title: `Song ${n}`,
    artist: 'Someone',
    album: '',
    duration: 200,
    thumbnail: null,
    alreadyHave: false,
    waitingToUpload: false,
    inQueue: false,
    source: 'youtube',
    netease: null,
    youtube: { url: null, match: 'looking' },
    ...patch,
  })
  const found = (n: number, sure = true) => ({
    url: `https://www.youtube.com/watch?v=${n}`,
    title: `Song ${n}`,
    artist: 'Someone',
    album: 'An Album',
    duration: 201,
    thumbnail: `https://lh3.googleusercontent.com/${n}=w544-h544`,
    sure,
  })
  const review = (...items: ImportPreviewItem[]): Review =>
    reviewFrom({ kind: 'playlist', playlistTitle: 'Mix', items, from: 'spotify' })

  it('are ticked while they are looked for, and not imported until found', () => {
    const start = review(byName(1), byName(2))
    expect([...start.chosen]).toEqual([0, 1])
    expect(lookingFor(start)).toEqual([0, 1])
    expect(chosenItems(start)).toEqual([])
  })

  it('take the link, album and cover found, and lose the tick when nothing was', () => {
    const next = withFound(review(byName(1), byName(2), byName(3)), [0, 1], [found(1, false), null])
    expect(next.items[0]).toMatchObject({
      url: 'https://www.youtube.com/watch?v=1',
      album: 'An Album',
      thumbnail: 'https://lh3.googleusercontent.com/1=w544-h544',
      youtube: { url: 'https://www.youtube.com/watch?v=1', match: 'unsure' },
    })
    expect(next.items[1]).toMatchObject({ url: '', youtube: { url: null, match: 'none' } })
    expect([...next.chosen]).toEqual([0, 2])
    expect(lookingFor(next)).toEqual([2])
    expect(chosenItems(next).map(each => each.url)).toEqual(['https://www.youtube.com/watch?v=1'])
  })

  it('switch between 网易云 and YouTube, looking for it on YouTube the first time', () => {
    const netease = byName(1, {
      url: 'https://music.163.com/song?id=1',
      source: 'netease',
      netease: { url: 'https://music.163.com/song?id=1', free: true },
      youtube: null,
    })
    const toYouTube = chooseSource(review(netease), 0, 'youtube')
    expect(toYouTube.items[0]).toMatchObject({
      source: 'youtube',
      url: '',
      youtube: { url: null, match: 'looking' },
    })
    const foundIt = withFound(toYouTube, [0], [found(1)])
    const back = chooseSource(foundIt, 0, 'netease')
    expect(back.items[0]).toMatchObject({
      source: 'netease',
      url: 'https://music.163.com/song?id=1',
    })
    // The match is kept: going back to YouTube is at once.
    expect(chooseSource(back, 0, 'youtube').items[0]?.url).toBe('https://www.youtube.com/watch?v=1')
  })

  it('never take a 网易云 song that only plays a preview from there', () => {
    const vip = byName(1, { netease: { url: 'https://music.163.com/song?id=2', free: false } })
    const start = review(vip)
    expect(chooseSource(start, 0, 'netease')).toBe(start)
  })

  it('look again by the name as it stands, ticked again', () => {
    const notFound = withFound(review(byName(1)), [0], [null])
    const again = lookAgain(notFound, 0)
    expect(again.items[0]?.youtube).toEqual({ url: null, match: 'looking' })
    expect([...again.chosen]).toEqual([0])
  })
})
