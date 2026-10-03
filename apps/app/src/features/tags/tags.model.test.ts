import { describe, expect, it } from 'vitest'
import type { Song, Tag } from '@selfmp3/shared'

import { tagsMostPlayed } from '../tag/tag.model'
import { leadSong, tagsHeadline, tagsLayout, waitingArtists } from './tags.model'

const song = (id: number, extra: Partial<Song> = {}): Song =>
  ({
    id,
    title: `Song ${id}`,
    artist: 'Someone',
    album: '',
    duration: 60,
    playCount: 0,
    hasArt: true,
    lastPlayedAt: null,
    tagIds: [],
    addedAt: `2026-09-${String(10 + (id % 20)).padStart(2, '0')} 00:00:00`,
    ...extra,
  }) as Song

const tag = (id: number, name: string): Tag => ({ id, name, hue: 10, songCount: 0 })

/** Songs 1..n, each carrying the tags the map gives it. */
function library(tagsOf: Record<number, number[]>): Song[] {
  return Object.entries(tagsOf).map(([id, tagIds]) => song(Number(id), { tagIds }))
}

const names = (entries: readonly { standing: { tag: Tag } }[]) =>
  entries.map(e => e.standing.tag.name)

describe('All tags', () => {
  it('says how many tags there are and in what order, and when there are none', () => {
    expect(tagsHeadline(0)).toBe('No tags yet')
    expect(tagsHeadline(1)).toBe('1 tag · most played first')
    expect(tagsHeadline(8)).toBe('8 tags · most played first')
  })
})

describe('how All tags lays its tags out', () => {
  const game = tag(1, 'game')
  const snow = tag(2, 'snow')
  const stone = tag(3, 'stone')
  const pop = tag(4, 'pop')
  const tiny = tag(5, 'tiny')
  const empty = tag(6, 'empty')

  it('draws a tag inside the bigger tag that carries every one of its songs', () => {
    const songs = library({
      1: [1, 2],
      2: [1, 2],
      3: [1, 2],
      4: [1, 3],
      5: [1, 3],
      6: [1],
      7: [4],
      8: [4],
      9: [4],
    })
    const { main } = tagsLayout(tagsMostPlayed([game, snow, stone, pop], songs))
    expect(names(main)).toEqual(['game', 'pop'])
    expect(main[0]?.inside.map(s => s.tag.name)).toEqual(['snow', 'stone'])
    expect(main[1]?.inside).toEqual([])
  })

  it('puts a tag back beside the other once one of its songs is from elsewhere', () => {
    const songs = library({ 1: [1, 2], 2: [1, 2], 3: [1, 2], 4: [1], 5: [2, 4], 6: [4], 7: [4] })
    const { main } = tagsLayout(tagsMostPlayed([game, snow, pop], songs))
    expect(names(main)).toEqual(['game', 'snow', 'pop'])
  })

  it('nests one level, under the biggest holder, and leaves equal tags side by side', () => {
    // stone ⊂ snow ⊂ game: stone goes under game, beside snow, never under snow.
    const nested = library({ 1: [1, 2, 3], 2: [1, 2, 3], 3: [1, 2, 3], 4: [1, 2], 5: [1] })
    const { main } = tagsLayout(tagsMostPlayed([game, snow, stone], nested))
    expect(names(main)).toEqual(['game'])
    expect(main[0]?.inside.map(s => s.tag.name)).toEqual(['snow', 'stone'])

    const twins = library({ 1: [1, 2], 2: [1, 2], 3: [1, 2] })
    expect(names(tagsLayout(tagsMostPlayed([game, snow], twins)).main)).toEqual(['game', 'snow'])
  })

  it('keeps tags with a song or two, and empty ones, for the end', () => {
    const songs = library({ 1: [4], 2: [4], 3: [4], 4: [5], 5: [5] })
    const { main, justStarted } = tagsLayout(tagsMostPlayed([pop, tiny, empty], songs))
    expect(names(main)).toEqual(['pop'])
    expect(names(justStarted)).toEqual(['tiny', 'empty'])
  })

  it('leaves a one-song region inside its holder rather than at the end', () => {
    const songs = library({ 1: [1, 2], 2: [1], 3: [1] })
    const { main, justStarted } = tagsLayout(tagsMostPlayed([game, snow], songs))
    expect(main[0]?.inside.map(s => s.tag.name)).toEqual(['snow'])
    expect(justStarted).toEqual([])
  })
})

describe('a tag’s sleeve', () => {
  it('is the cover of the song played most, then played last, then newest', () => {
    const songs = [
      song(1, { playCount: 2, lastPlayedAt: '2026-09-01 10:00:00' }),
      song(2, { playCount: 2, lastPlayedAt: '2026-09-20 10:00:00' }),
      song(3, { playCount: 1, lastPlayedAt: '2026-10-01 10:00:00' }),
    ]
    expect(leadSong(songs)?.id).toBe(2)
    expect(leadSong([song(4), song(5)])?.id).toBe(5)
  })

  it('prefers a song with a cover, and is nothing for an empty tag', () => {
    expect(leadSong([song(1, { playCount: 9, hasArt: false }), song(2)])?.id).toBe(2)
    expect(leadSong([])).toBeNull()
  })
})

describe('who the untagged songs are by', () => {
  it('names the artists with the most, newest song first, and counts the rest', () => {
    const songs = [
      song(1, { artist: '周杰倫' }),
      song(2, { artist: '周杰倫' }),
      song(3, { artist: '周杰倫' }),
      song(4, { artist: '薛之谦, 薛之谦, 薛之谦' }),
      song(5, { artist: '郭顶, 薛之谦' }),
      song(6, { artist: 'HOYO-MiX' }),
      song(7, { artist: 'Someone else' }),
      song(8, { artist: 'Tagged', tagIds: [1] }),
    ]
    const { artists, rest } = waitingArtists(songs, 2)
    expect(artists.map(a => [a.name, a.count])).toEqual([
      ['周杰倫', 3],
      ['薛之谦', 2],
    ])
    expect(artists[0]?.song.id).toBe(3)
    expect(rest).toBe(2)
  })

  it('is empty when every song has a tag', () => {
    expect(waitingArtists([song(1, { tagIds: [1] })], 3)).toEqual({ artists: [], rest: 0 })
  })
})
