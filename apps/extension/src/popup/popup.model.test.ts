import type { ImportJob, ImportPreview } from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'
import { pageKind } from '../pageKind.js'
import {
  batchProgress,
  cleanedFrom,
  connectionOf,
  hostOf,
  jobForLink,
  pageTitle,
  popupView,
  progressLine,
  sinceLine,
  type PopupInputs,
} from './popup.model.js'

const IDOL = 'https://www.youtube.com/watch?v=ZRtdQ81jPUQ'

const job = (patch: Partial<ImportJob> = {}): ImportJob => ({
  id: 'j1',
  url: 'https://music.youtube.com/watch?v=ZRtdQ81jPUQ',
  status: 'running',
  step: 'downloading',
  progress: 40,
  title: 'アイドル',
  artist: 'YOASOBI',
  album: '',
  thumbnail: null,
  duration: 213,
  error: null,
  songId: null,
  attempts: 1,
  tagIds: [],
  createdAt: '2026-09-15 12:00:00',
  updatedAt: '2026-09-15 12:00:30',
  ...patch,
})

const item = {
  url: IDOL,
  title: 'アイドル',
  artist: 'YOASOBI',
  album: '',
  duration: 213,
  thumbnail: null,
  alreadyHave: false,
}
const single: ImportPreview = { kind: 'single', playlistTitle: null, items: [item] }
const hit = {
  id: 1,
  title: 'アイドル',
  artist: 'YOASOBI',
  addedAt: '2026-08-12 10:00:00',
  playCount: 41,
}

const base: PopupInputs = {
  connection: 'ready',
  link: IDOL,
  typed: false,
  page: pageKind(IDOL),
  hit: null,
  preview: { status: 'done', value: single },
  job: null,
  importAnyway: false,
}
const view = (patch: Partial<PopupInputs>) => popupView({ ...base, ...patch })

describe('connectionOf', () => {
  it('needs a server, and one that answers', () => {
    expect(connectionOf({ server: null, reachable: null, songCount: null })).toBe('none')
    const server = { baseUrl: 'http://localhost:4600', hasToken: false }
    expect(connectionOf({ server, reachable: false, songCount: null })).toBe('away')
    expect(connectionOf({ server, reachable: true, songCount: 36 })).toBe('ready')
  })
})

describe('popupView', () => {
  it('asks for a server before anything else', () => {
    expect(view({ connection: 'checking', job: job() }).name).toBe('checking')
    expect(view({ connection: 'none', job: job() }).name).toBe('connect')
    expect(view({ connection: 'away', job: job() }).name).toBe('away')
  })

  it('follows a job for the link over what the page says', () => {
    expect(view({ job: job(), hit }).name).toBe('importing')
    expect(view({ job: job({ status: 'queued', step: 'waiting', progress: null }) }).name).toBe(
      'importing',
    )
    expect(view({ job: job({ status: 'done', step: 'finished' }) }).name).toBe('added')
    expect(view({ job: job({ status: 'error', error: 'Video unavailable' }) })).toEqual({
      name: 'failed',
      message: 'Video unavailable',
      jobId: 'j1',
    })
    // A cancelled job gives the song back, to import or not.
    expect(view({ job: job({ status: 'cancelled' }) }).name).toBe('song')
  })

  it('offers the paste box when the page has nothing to import', () => {
    expect(
      view({ link: 'https://example.com/', page: pageKind('https://example.com/') }).name,
    ).toBe('paste')
    expect(view({ link: null, page: pageKind(null) }).name).toBe('paste')
  })

  it('reads a pasted link, whatever site it is', () => {
    const link = 'https://soundcloud.com/artist/song'
    expect(view({ link, page: pageKind(link), typed: true }).name).toBe('song')
  })

  it('says the song is already yours, unless asked to import it anyway', () => {
    expect(view({ hit, preview: { status: 'idle' } })).toMatchObject({ name: 'have', hit })
    expect(view({ hit, importAnyway: true }).name).toBe('song')
    const had = { ...single, items: [{ ...item, alreadyHave: true }] }
    expect(view({ preview: { status: 'done', value: had } })).toMatchObject({
      name: 'have',
      hit: null,
    })
  })

  it('waits for the library and the server before drawing the song', () => {
    expect(view({ hit: 'loading' }).name).toBe('looking')
    expect(view({ preview: { status: 'loading' } }).name).toBe('looking')
  })

  it('shows what the server could not read', () => {
    expect(view({ preview: { status: 'error', message: 'This video is private.' } })).toEqual({
      name: 'failed',
      message: 'This video is private.',
      jobId: null,
    })
    expect(view({ preview: { status: 'done', value: { ...single, items: [] } } }).name).toBe(
      'failed',
    )
  })

  it('hands a list of songs over whole, to be ticked through', () => {
    const list: ImportPreview = {
      kind: 'playlist',
      playlistTitle: 'City pop night drive',
      items: [item, { ...item, alreadyHave: true }],
    }
    expect(view({ preview: { status: 'done', value: list } })).toEqual({
      name: 'list',
      preview: list,
    })
  })
})

describe('jobForLink', () => {
  const now = new Date('2026-09-15T12:05:00Z')

  it('matches a job by its video, whichever form of link queued it', () => {
    expect(jobForLink([job()], IDOL, new Set(), now)?.id).toBe('j1')
    expect(
      jobForLink(
        [job({ url: 'https://www.youtube.com/watch?v=YQHsXMglC9A' })],
        IDOL,
        new Set(),
        now,
      ),
    ).toBeNull()
    expect(jobForLink([job()], null, new Set(), now)).toBeNull()
  })

  it('takes the one started here, then one still going, then one just finished', () => {
    const old = job({
      id: 'old',
      status: 'done',
      step: 'finished',
      updatedAt: '2026-09-14 08:00:00',
    })
    expect(jobForLink([old], IDOL, new Set(), now)).toBeNull()
    expect(jobForLink([old], IDOL, new Set(['old']), now)?.id).toBe('old')
    const recent = job({
      id: 'recent',
      status: 'done',
      step: 'finished',
      updatedAt: '2026-09-15 12:01:00',
    })
    expect(jobForLink([old, recent], IDOL, new Set(), now)?.id).toBe('recent')
    const cancelled = job({ id: 'c', status: 'cancelled', updatedAt: '2026-09-15 12:04:00' })
    expect(jobForLink([cancelled], IDOL, new Set(), now)).toBeNull()
  })
})

describe('batchProgress', () => {
  it('follows what a list started: the one still going, then how many landed', () => {
    const jobs = [
      job({ id: 'one', status: 'done', step: 'finished' }),
      job({ id: 'two' }),
      job({ id: 'elsewhere' }),
    ]
    const started = new Set(['one', 'two'])
    expect(batchProgress(jobs, started)).toMatchObject({ total: 2, added: 1 })
    expect(batchProgress(jobs, started)?.job.id).toBe('two')

    const finished = [
      job({ id: 'one', status: 'done', step: 'finished' }),
      job({ id: 'two', status: 'done', step: 'finished' }),
    ]
    expect(batchProgress(finished, started)).toMatchObject({ total: 2, added: 2 })
    expect(batchProgress(jobs, new Set())).toBeNull()
  })
})

describe('the words', () => {
  it('takes YouTube’s name and the unread count off a tab title', () => {
    expect(pageTitle('(3) YOASOBI「アイドル」Official Music Video - YouTube')).toBe(
      'YOASOBI「アイドル」Official Music Video',
    )
    expect(pageTitle('アイドル - YouTube Music')).toBe('アイドル')
    expect(pageTitle(' - YouTube')).toBeNull()
    expect(pageTitle(undefined)).toBeNull()
  })

  it('names the video’s title only when the server changed it', () => {
    expect(cleanedFrom('YOASOBI「アイドル」Official Music Video', 'アイドル')).toBe(
      'YOASOBI「アイドル」Official Music Video',
    )
    expect(cleanedFrom('Hello', 'hello')).toBeNull()
    expect(cleanedFrom(null, 'Hello')).toBeNull()
  })

  it('says since when, and how often it was played', () => {
    const now = new Date('2026-09-15T12:00:00Z')
    expect(sinceLine(hit, now)).toBe('In your library since 12 Aug · played 41 times')
    expect(sinceLine({ ...hit, addedAt: '2025-12-30 10:00:00', playCount: 1 }, now)).toBe(
      'In your library since 30 Dec 2025 · played once',
    )
    expect(sinceLine({ ...hit, playCount: 0 }, now)).toBe(
      'In your library since 12 Aug · not played yet',
    )
  })

  it('gives a download its percentage and every other step its name', () => {
    expect(progressLine(job())).toEqual({ text: 'Downloading · 40%', fraction: 0.4 })
    expect(progressLine(job({ step: 'lyrics', progress: null }))).toEqual({
      text: 'Looking for lyrics',
      fraction: null,
    })
    expect(progressLine(job({ status: 'queued', step: 'waiting', progress: null }))).toEqual({
      text: 'Waiting in queue',
      fraction: null,
    })
  })

  it('writes the server as its host', () => {
    expect(hostOf('https://mac-mini.tail1234.ts.net')).toBe('mac-mini.tail1234.ts.net')
    expect(hostOf('http://localhost:4600')).toBe('localhost:4600')
  })
})
