import { describe, expect, it } from 'vitest'
import type { RoomSong, ShareLink, ShareSummary, Song } from '@selfmp3/shared'
import { libraryIndex, roomTrackId } from '@selfmp3/client'
import {
  gettable,
  receivedLine,
  sentLine,
  sentLinksHint,
  shareFromLine,
  shareHeadLine,
  shareStage,
  shareTimeLine,
  shareTracks,
  shareWords,
  sourceName,
} from './share.model'

/** A share link on this device: where it is in its life, its words, its tracks. */

const DAY = 24 * 60 * 60 * 1000
// Noon, so "tonight" and "tomorrow" are the same days in any timezone the tests run in.
const NOW = new Date(2026, 9, 13, 12).getTime()

function song(
  n: number,
  source: string | null = `https://youtu.be/${'a'.repeat(10)}${n}`,
): RoomSong {
  const sha = n.toString(16).padStart(2, '0').repeat(32)
  return {
    uid: null,
    title: `Song ${n}`,
    artist: 'Someone',
    album: '',
    duration: 100,
    audio: { key: `audio/${sha}.m4a`, size: 1, mime: 'audio/mp4' },
    cover: n === 1 ? { key: `covers/${sha}.jpg`, size: 0 } : null,
    coverTone: null,
    lyrics: null,
    sourceUrl: source,
    link: null,
    artwork: null,
  }
}

function link(changes: Partial<ShareLink> = {}): ShareLink {
  return {
    id: '0123456789abcdef',
    key: 'fedcba9876543210',
    name: 'Song 1',
    kind: 'song',
    from: { name: 'Xiao', picture: null },
    entries: [{ id: 'aaaaaaaaaaaa', song: song(1), gone: false }],
    createdAt: NOW - DAY,
    endsAt: NOW + 6 * DAY,
    limitAt: NOW + 29 * DAY,
    ended: null,
    keptUntil: NOW + 96 * DAY,
    asked: false,
    yours: false,
    plays: 0,
    opened: [],
    guests: 0,
    asks: [],
    ...changes,
  }
}

function summary(changes: Partial<ShareSummary> = {}): ShareSummary {
  const { entries: _entries, ...rest } = link()
  return { ...rest, songs: 1, cover: null, yours: true, ...changes }
}

describe('a share link’s words', () => {
  it('says how long it has', () => {
    expect(shareStage(link(), NOW)).toBe('live')
    expect(shareTimeLine(link(), NOW)).toBe('6 days left')
    expect(shareTimeLine(link({ endsAt: NOW + DAY / 2 + DAY }), NOW)).toBe('2 days left')
  })

  it('says so on its last day', () => {
    const tonight = link({ endsAt: NOW + 6 * 60 * 60 * 1000 })
    expect(shareStage(tonight, NOW)).toBe('lastDay')
    expect(shareTimeLine(tonight, NOW)).toBe('ends tonight')
    expect(shareTimeLine(link({ endsAt: NOW + 20 * 60 * 60 * 1000 }), NOW)).toBe('ends tomorrow')
  })

  it('says it ended, or that its sender removed the song', () => {
    const ended = link({ endsAt: NOW - DAY, ended: { at: NOW - DAY, why: 'idle' } })
    expect(shareStage(ended, NOW)).toBe('ended')
    expect(shareTimeLine(ended, NOW)).toMatch(/^ended [^·]+$/)
    const removed = link({ ended: { at: NOW, why: 'removed' } })
    expect(shareTimeLine(removed, NOW)).toMatch(/^removed [^·]+$/)
    // Its time run out is ended, even before the doorman is asked again.
    expect(shareStage(link({ endsAt: NOW }), NOW)).toBe('ended')
  })

  it('says who sent it', () => {
    expect(shareFromLine(link())).toBe('Xiao sent you a song')
    const list = link({
      kind: 'list',
      entries: [link().entries[0]!, { id: 'bbbbbbbbbbbb', song: song(2), gone: false }],
    })
    expect(shareFromLine(list)).toBe('Xiao sent you 2 songs')
  })

  it('heads its page with who sent it and how long it has, or who opened yours', () => {
    expect(shareHeadLine(link(), NOW)).toEqual({
      from: 'Xiao sent you a song',
      time: '6 days left',
    })
    expect(shareHeadLine(link({ yours: true, opened: ['Mia'] }), NOW)).toEqual({
      from: 'Your link',
      time: 'Opened by Mia · 6 days left',
    })
  })

  it('tells its sender who opened it, and its friends whose it is', () => {
    expect(sentLine(summary(), NOW)).toBe('Not opened yet · 6 days left')
    expect(sentLine(summary({ opened: ['Mia', 'Ken'], guests: 2 }), NOW)).toBe(
      'Opened by Mia, Ken and 2 more · 6 days left',
    )
    expect(sentLine(summary({ guests: 1 }), NOW)).toBe('Opened 1 time · 6 days left')
    expect(sentLine(summary({ ended: { at: NOW, why: 'idle' }, plays: 9 }), NOW)).toMatch(
      /^Ended .+ · played 9 times$/,
    )
    expect(receivedLine(summary(), NOW)).toBe('Xiao · 6 days')
    expect(receivedLine(summary({ ended: { at: NOW, why: 'stopped' } }), NOW)).toBe('Xiao · Ended')
  })

  it('sums up the links you sent for Profile', () => {
    expect(sentLinksHint(undefined, NOW)).toBe('Songs you sent as links')
    expect(sentLinksHint([], NOW)).toBe('None yet. Share link is in a song’s ⋯ menu')
    const asked = summary({ asks: [{ id: 'aaaaaaaaaaaa', name: 'Mia', at: NOW }] })
    const ended = summary({ ended: { at: NOW, why: 'idle' } })
    expect(sentLinksHint([summary(), asked, ended], NOW)).toBe(
      '2 links playing · 1 friend asks again',
    )
    expect(sentLinksHint([ended], NOW)).toBe('None playing')
  })
})

describe('the words that go with a link', () => {
  it('are the song and its artist, or the list and how many songs it holds', () => {
    expect(shareWords({ name: '干杯', kind: 'song', artist: '五月天', songs: 1 })).toBe(
      '干杯 · 五月天',
    )
    expect(shareWords({ name: '干杯', kind: 'song', artist: ' ', songs: 1 })).toBe('干杯')
    expect(shareWords({ name: '干杯', kind: 'song', artist: null, songs: 1 })).toBe('干杯')
    expect(shareWords({ name: '五月天 精选', kind: 'list', artist: null, songs: 12 })).toBe(
      '五月天 精选 · 12 songs',
    )
    expect(shareWords({ name: 'Picked', kind: 'list', artist: null, songs: 1 })).toBe(
      'Picked · 1 song',
    )
  })
})

describe('a share link’s songs', () => {
  const file = (entry: string, part: string) => `https://doorman/${entry}/${part}`

  it('play from the lent file, or your own copy, and only while the link lasts', () => {
    const library = libraryIndex([{ id: 7, path: song(1).audio?.key ?? '' } as Song])
    const tracks = shareTracks(link(), file, library, NOW)
    const track = tracks.get(roomTrackId('aaaaaaaaaaaa'))
    expect(track?.stream?.url).toBe('https://doorman/aaaaaaaaaaaa/audio')
    expect(track?.cover).toBe('https://doorman/aaaaaaaaaaaa/cover')
    expect(track?.yours).toBe(7)

    const ended = shareTracks(link({ ended: { at: NOW, why: 'idle' } }), file, library, NOW)
    expect(ended.get(roomTrackId('aaaaaaaaaaaa'))?.stream).toBeNull()
    // The card keeps its cover.
    expect(ended.get(roomTrackId('aaaaaaaaaaaa'))?.cover).toBe('https://doorman/aaaaaaaaaaaa/cover')
  })

  it('are got from their link, unless you have them or they came from nowhere', () => {
    const entries = [
      { id: 'aaaaaaaaaaaa', song: song(1), gone: true },
      { id: 'bbbbbbbbbbbb', song: song(2, null), gone: false },
      { id: 'cccccccccccc', song: song(3), gone: false },
    ]
    const library = libraryIndex([{ id: 9, path: song(3).audio?.key ?? '' } as Song])
    expect(gettable(link({ entries }), library).map(entry => entry.id)).toEqual(['aaaaaaaaaaaa'])
  })
})

describe('where a song came from', () => {
  it('is named by the place, not its address', () => {
    expect(sourceName('https://www.youtube.com/watch?v=x')).toBe('YouTube')
    expect(sourceName('https://youtu.be/x')).toBe('YouTube')
    expect(sourceName('https://music.youtube.com/watch?v=x')).toBe('YouTube Music')
    expect(sourceName('https://music.163.com/#/song?id=1')).toBe('网易云')
    expect(sourceName('https://example.org/a')).toBe('example.org')
  })
})
