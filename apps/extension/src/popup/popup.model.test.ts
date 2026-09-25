import type { ImportRequestView } from '@selfmp3/replica'
import { reviewFrom } from '@selfmp3/client/core'
import type { ImportJob, ImportPreview, Tag } from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'
import { pageKind } from '../pageKind.js'
import {
  batchProgress,
  chipState,
  cleanedFrom,
  comingIn,
  connectionLabel,
  connectionOf,
  countLabel,
  hostOf,
  importLabel,
  jobForLink,
  listRequest,
  newTagFrom,
  pageTitle,
  popupView,
  progressLine,
  renameSong,
  requestForLink,
  rowState,
  sinceLine,
  songNote,
  songRequest,
  taggedLine,
  tagIdsFor,
  toggleLeftOut,
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
  waitingToUpload: false,
  inQueue: false,
}
const single: ImportPreview = { kind: 'single', playlistTitle: null, items: [item] }
const hit = {
  id: 1,
  title: 'アイドル',
  artist: 'YOASOBI',
  addedAt: '2026-08-12 10:00:00',
  playCount: 41,
}

const request = (patch: Partial<ImportRequestView> = {}): ImportRequestView => ({
  uid: 'r1',
  url: 'https://music.youtube.com/watch?v=ZRtdQ81jPUQ',
  state: 'waiting',
  title: null,
  songIds: [],
  error: null,
  requestedAt: '2026-09-16 12:00:00',
  requestedBy: 'extension',
  ...patch,
})

const base: PopupInputs = {
  connection: 'ready',
  link: IDOL,
  typed: false,
  page: pageKind(IDOL),
  hit: null,
  preview: { status: 'done', value: single },
  job: null,
  request: null,
  importAnyway: false,
}
const view = (patch: Partial<PopupInputs>) => popupView({ ...base, ...patch })

describe('connectionOf', () => {
  it('reads each way in: none, the server itself, the bucket, or a server that is asleep', () => {
    const server = { baseUrl: 'http://localhost:4600', typed: true }
    const status = { server: null, account: null, songCount: null }
    expect(connectionOf({ ...status, mode: 'none' })).toBe('none')
    expect(connectionOf({ ...status, mode: 'away', server })).toBe('away')
    expect(connectionOf({ ...status, mode: 'server', server, songCount: 36 })).toBe('ready')
    expect(connectionOf({ ...status, mode: 'bucket', account: 'x@y.z' })).toBe('bucket')
  })
})

/**
 * Through the bucket the popup offers everything it still can and nothing it
 * cannot: no preview, no list to tick through, and the tags and playlist of
 * this device's own copy of the library.
 */
describe('popupView, through the bucket', () => {
  const viaBucket = (patch: Partial<PopupInputs> = {}) =>
    view({ connection: 'bucket', preview: { status: 'idle' }, ...patch })

  it('offers the link, with nothing read from it', () => {
    expect(viaBucket()).toEqual({ name: 'request', link: IDOL, list: false })
  })

  it('offers a playlist as one request, since the server skips what you have', () => {
    const list = 'https://www.youtube.com/playlist?list=PL1234567890abcdefgh'
    expect(viaBucket({ link: list, page: pageKind(list) })).toMatchObject({
      name: 'request',
      list: true,
    })
  })

  it('still says when a song is already yours, from this device’s own library', () => {
    expect(viaBucket({ hit }).name).toBe('have')
    expect(viaBucket({ hit, importAnyway: true }).name).toBe('request')
    expect(viaBucket({ hit: 'loading' }).name).toBe('looking')
  })

  it('follows the link already left, and says what the server made of it', () => {
    expect(viaBucket({ request: request() })).toEqual({ name: 'waiting', request: request() })
    expect(viaBucket({ request: request({ state: 'working' }) }).name).toBe('waiting')
    expect(viaBucket({ request: request({ state: 'done', songIds: [7] }) }).name).toBe('requested')
    expect(
      viaBucket({ request: request({ state: 'failed', error: 'Video unavailable' }) }),
    ).toEqual({ name: 'failed', message: 'Video unavailable', jobId: null })
    // Called off: back to the link, to leave again or not.
    expect(viaBucket({ request: request({ state: 'cancelled' }) }).name).toBe('request')
  })

  it('offers the paste box on a page with no link to leave', () => {
    expect(
      viaBucket({ link: 'https://example.com/', page: pageKind('https://example.com/') }).name,
    ).toBe('paste')
  })
})

describe('requestForLink', () => {
  it('matches by video, and prefers one still waiting', () => {
    const done = request({ uid: 'r0', state: 'done' })
    const waiting = request({ uid: 'r1', url: 'https://youtu.be/ZRtdQ81jPUQ' })
    expect(requestForLink([done, waiting], IDOL)?.uid).toBe('r1')
    expect(requestForLink([done], IDOL)?.uid).toBe('r0')
    expect(requestForLink([request({ state: 'cancelled' })], IDOL)).toBeNull()
    expect(requestForLink([done], null)).toBeNull()
    expect(requestForLink([done], 'https://example.com/')).toBeNull()
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

  it('hands a list of songs over whole, every one coming in unless left out', () => {
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

describe('the header', () => {
  it('names the way in, not its address', () => {
    expect(connectionLabel('ready')).toBe('Your server')
    expect(connectionLabel('bucket')).toBe('Via your bucket')
    expect(connectionLabel('away')).toBe('Not answering')
    expect(connectionLabel('none')).toBeNull()
    expect(connectionLabel('checking')).toBeNull()
  })
})

const tag = (id: number, name: string): Tag => ({ id, name, hue: 150, songCount: 0 })
const TAGS = [tag(1, 'new'), tag(2, 'j-pop'), tag(3, 'chill')]

describe('tags, and never a playlist', () => {
  it('keeps a default tag on, and lets the others be picked', () => {
    expect(chipState(1, [1], new Set())).toBe('fixed')
    expect(chipState(1, [1], new Set([1]))).toBe('fixed')
    expect(chipState(2, [1], new Set([2]))).toBe('on')
    expect(chipState(3, [1], new Set([2]))).toBe('off')
    expect(chipState(2, undefined, new Set())).toBe('off')
  })

  it('sends the defaults and the picked together, once each', () => {
    expect([...tagIdsFor([1], new Set([2, 1]))].sort()).toEqual([1, 2])
    expect([...tagIdsFor(undefined, new Set([3]))]).toEqual([3])
  })

  it('makes a new tag only of a name that is not there yet, in any case', () => {
    expect(newTagFrom('   ', TAGS)).toEqual({ kind: 'empty' })
    expect(newTagFrom(' J-Pop ', TAGS)).toEqual({ kind: 'existing', tag: TAGS[1] })
    expect(newTagFrom(' city   pop ', TAGS)).toEqual({ kind: 'new', name: 'city pop' })
  })

  it('says what an import was tagged with', () => {
    expect(taggedLine([], TAGS)).toBeNull()
    expect(taggedLine([2], TAGS)).toBe('Tagged j-pop.')
    expect(taggedLine([1, 2, 3], TAGS)).toBe('Tagged new, j-pop and chill.')
    // A tag deleted since is left out rather than named wrongly.
    expect(taggedLine([9, 3], TAGS)).toBe('Tagged chill.')
  })
})

describe('a song', () => {
  it('says where the words came from, and how long it is', () => {
    expect(songNote('YOASOBI「アイドル」Official Music Video', 213)).toBe(
      'Tidied from “YOASOBI「アイドル」Official Music Video”. Change either before it is saved; 3:33.',
    )
    expect(songNote(null, 0)).toBe('From the page. Change either before it is saved.')
  })

  it('imports the song as corrected, with its tags, into no playlist', () => {
    expect(songRequest(item, { title: ' Idol ', artist: ' YOASOBI ' }, new Set([1, 2]))).toEqual({
      items: [
        {
          url: IDOL,
          title: 'Idol',
          artist: 'YOASOBI',
          album: '',
          thumbnail: null,
          duration: 213,
        },
      ],
      tagIds: [1, 2],
      playlistId: null,
      createPlaylistName: null,
    })
  })
})

describe('a list', () => {
  const list: ImportPreview = {
    kind: 'playlist',
    playlistTitle: 'THE BOOK',
    items: [
      { ...item, url: `${IDOL}&a`, title: 'アイドル', alreadyHave: true },
      { ...item, url: `${IDOL}&b`, title: 'ハルジオン' },
      { ...item, url: `${IDOL}&c`, title: '群青' },
    ],
  }

  it('has every song coming in except the ones that are yours already', () => {
    const review = reviewFrom(list)
    expect([0, 1, 2].map(index => rowState(review, index))).toEqual(['yours', 'in', 'in'])
    expect(countLabel(review)).toBe('2 of 3 coming in')
    expect(importLabel(comingIn(review))).toBe('Import 2 songs')
  })

  it('leaves a song out at the far end of its row, and brings it back the same way', () => {
    const out = toggleLeftOut(reviewFrom(list), 2)
    expect(rowState(out, 2)).toBe('out')
    expect(countLabel(out)).toBe('1 of 3 coming in')
    expect(importLabel(comingIn(out))).toBe('Import 1 song')
    expect(rowState(toggleLeftOut(out, 2), 2)).toBe('in')
  })

  it('cannot bring in a song that is yours already', () => {
    const review = reviewFrom(list)
    expect(toggleLeftOut(review, 0)).toBe(review)
    expect(toggleLeftOut(review, 7)).toBe(review)
  })

  it('renames a song in place, keeping the link it downloads from', () => {
    const renamed = renameSong(reviewFrom(list), 2, { title: 'Gunjou' })
    expect(renamed.items[2]).toMatchObject({ url: `${IDOL}&c`, title: 'Gunjou', artist: 'YOASOBI' })
    expect(renamed.items[1]?.title).toBe('ハルジオン')
  })

  it('sends only the songs coming in, as renamed, tagged, and into no playlist', () => {
    const review = renameSong(toggleLeftOut(reviewFrom(list), 1), 2, {
      artist: ' YOASOBI feat. 合唱 ',
    })
    // Even if the one you have was somehow chosen, it is not sent.
    const request = listRequest({ ...review, chosen: new Set([0, 2]) }, new Set([1]))
    expect(request.items.map(each => [each.title, each.artist])).toEqual([
      ['群青', 'YOASOBI feat. 合唱'],
    ])
    expect(request).toMatchObject({ tagIds: [1], playlistId: null, createPlaylistName: null })
  })
})
