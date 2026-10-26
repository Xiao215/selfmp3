import { describe, expect, it } from 'vitest'
import {
  EMPTY_QUEUE,
  NO_JOINS,
  type Playlist,
  type QueueState,
  type Song,
  type Tag,
} from '@selfmp3/shared'

import {
  combinedLink,
  describeSource,
  homeRecents,
  LIKED_SOURCE,
  LINED_UP_SOURCE,
  libraryListSource,
  librarySource,
  likedSongs,
  parseCombinedParams,
  parseListSource,
  parseRecentLists,
  placesSource,
  playAlone,
  recentKind,
  recentSongIds,
  savePlan,
  songsToSave,
  sourceAfterAdding,
  sourceKey,
  sourceTagIds,
  withListRenamed,
  withListStarted,
  withSongPlayed,
  type ListSource,
  type RecentList,
} from './lists.model'

const song = (id: number, extra: Partial<Song> = {}): Song =>
  ({
    id,
    title: `Song ${id}`,
    artist: 'Someone',
    album: '',
    duration: 60,
    tagIds: [],
    lastPlayedAt: null,
    addedAt: `2026-09-${String(10 + id).padStart(2, '0')} 00:00:00`,
    ...extra,
  }) as Song

const tag = (id: number, name: string): Tag => ({ id, name, hue: 10, songCount: 1 })
const playlist = (id: number, name: string) => ({ id, name }) as Pick<Playlist, 'id' | 'name'>

const TAGS = [tag(1, '原神纯音乐'), tag(2, 'YOASOBI'), tag(3, 'Calm')]
const known = { tags: TAGS, playlists: [playlist(7, 'Late drive')] }

const queue = (items: number[], original: number[] = items): QueueState => ({
  ...EMPTY_QUEUE,
  items,
  original,
  index: 0,
})

describe('what Up next is called', () => {
  it('names a tag and a playlist by what they are called now, and links to them', () => {
    expect(describeSource({ kind: 'tag', tagId: 3, name: 'Old name' }, known)).toMatchObject({
      label: 'Calm',
      link: { pathname: '/tag/[name]', params: { name: 'Calm' } },
    })
    expect(describeSource({ kind: 'playlist', playlistId: 7, name: 'x' }, known).label).toBe(
      'Late drive',
    )
  })

  it('says when what it came from was deleted while it played', () => {
    const line = describeSource({ kind: 'playlist', playlistId: 99, name: 'Gym' }, known)
    expect(line).toMatchObject({ label: 'Gym (deleted)', link: null })
  })

  it('reads tags combined with "or", in their names now', () => {
    const source: ListSource = { kind: 'combined', tagIds: [1, 2], artistKeys: [], name: 'stale' }
    expect(describeSource(source, known).label).toBe('原神纯音乐 or YOASOBI')
  })

  it('wears the sparkle for an answer, and links to its page while it is kept', () => {
    const asked: ListSource = { kind: 'answer', text: 'calm to study', name: 'Calm study' }
    expect(describeSource(asked, known)).toMatchObject({ asked: true, link: null })
    expect(describeSource({ ...asked, answerId: '4' }, known).link).toEqual({
      pathname: '/answer',
      params: { id: '4' },
    })
  })
})

describe('what Save makes', () => {
  const q = queue([5, 6, 7])

  it('offers nothing for what is already a place of its own', () => {
    expect(savePlan({ kind: 'library' }, q, known)).toBeNull()
    expect(savePlan({ kind: 'tag', tagId: 1, name: 'x' }, q, known)).toBeNull()
    expect(savePlan({ kind: 'artist', key: 'a', name: 'A' }, q, known)).toBeNull()
    expect(savePlan({ kind: 'playlist', playlistId: 7, name: 'x' }, q, known)).toBeNull()
  })

  it('makes tags combined into a playlist that fills from them, whatever Up next became', () => {
    const source: ListSource = { kind: 'combined', tagIds: [1, 2], artistKeys: [], name: 'x' }
    // A song swiped out of Up next does not matter: the tags decide (G1).
    expect(savePlan(source, queue([5]), known)).toEqual({
      kind: 'follow',
      name: '原神纯音乐 or YOASOBI',
      tagIds: [1, 2],
      match: 'any',
    })
  })

  it('makes tags that are all wanted into a playlist that needs all of them', () => {
    const source: ListSource = {
      kind: 'combined',
      tagIds: [1, 2],
      artistKeys: [],
      name: 'x',
      match: 'all',
    }
    expect(savePlan(source, queue([5]), known)).toEqual({
      kind: 'follow',
      name: '原神纯音乐 & YOASOBI',
      tagIds: [1, 2],
      match: 'all',
    })
  })

  it('makes an answer into the songs left in Up next, in its own order', () => {
    const asked: ListSource = { kind: 'answer', text: 'calm', name: 'Calm study' }
    // Shuffled, one swiped out, one added after.
    expect(savePlan(asked, queue([7, 5, 9], [5, 6, 7]), known)).toEqual({
      kind: 'songs',
      name: 'Calm study',
      songIds: [5, 7, 9],
    })
  })

  it('makes a combination with an artist into its songs, as rules can only follow tags', () => {
    const source: ListSource = {
      kind: 'combined',
      tagIds: [1],
      artistKeys: ['yorushika'],
      name: 'Mix',
    }
    expect(savePlan(source, q, known)).toMatchObject({ kind: 'songs', name: 'Mix' })
  })

  it('brings Save back for a playlist deleted while it plays', () => {
    expect(savePlan({ kind: 'playlist', playlistId: 99, name: 'Gym' }, q, known)).toMatchObject({
      kind: 'songs',
      name: 'Gym',
    })
  })

  it('has nothing to save in one song, or in songs that need a tag', () => {
    expect(
      savePlan({ kind: 'songs', origin: 'search', name: 'Search' }, queue([5]), known),
    ).toBeNull()
    expect(savePlan({ kind: 'songs', origin: 'untagged', name: 'x' }, q, known)).toBeNull()
  })
})

describe('songs played from a search', () => {
  // The tile's title is the words searched; its line says they were searched.
  it('is a Search, not "From Search" under a title of Search', () => {
    expect(recentKind({ kind: 'songs', origin: 'search', name: '“yoru”' })).toBe('Search')
  })
})

describe('Home’s Recently played songs, played again', () => {
  const recent: ListSource = { kind: 'songs', origin: 'recent', name: 'Recently played' }

  it('names Up next "Recently played", with nowhere to go', () => {
    expect(describeSource(recent, known)).toEqual({
      label: 'Recently played',
      asked: false,
      link: null,
      saved: false,
    })
    expect(recentKind(recent)).toBe('Recently played')
  })

  it('offers no Save, and is not remembered as a list inside Recently played', () => {
    expect(savePlan(recent, queue([1, 2, 3]), known)).toBeNull()
    expect(sourceKey(recent, [1, 2, 3])).toBeNull()
    expect(withListStarted([], recent, [1, 2, 3], 100)).toEqual([])
  })
})

describe('a room that ended, played from its page', () => {
  const room: ListSource = { kind: 'room', code: 'KQ7482', name: 'With Mia' }

  it('names Up next after the room, and goes back to its page', () => {
    expect(describeSource(room, known)).toMatchObject({
      label: 'With Mia',
      link: { pathname: '/past-room/[code]', params: { code: 'KQ7482' } },
    })
    expect(recentKind(room)).toBe('Together')
  })

  it('saves your songs from it, and is not a second tile beside the room’s own', () => {
    expect(savePlan(room, queue([4, 5]), known)).toEqual({
      kind: 'songs',
      name: 'With Mia',
      songIds: [4, 5],
    })
    expect(sourceKey(room, [4, 5])).toBeNull()
    expect(withListStarted([], room, [4, 5], 100)).toEqual([])
  })

  it('reads back as it was kept', () => {
    expect(parseListSource(JSON.parse(JSON.stringify(room)))).toEqual(room)
    expect(parseListSource({ kind: 'room', name: 'With Mia' })).toBeNull()
  })
})

describe('a song picked from a general list', () => {
  it('plays that song alone, with no source: Up next is just it, nameless, with no Save', () => {
    const calls: unknown[][] = []
    playAlone({ playFrom: (...args: unknown[]) => void calls.push(args) }, 42)
    expect(calls).toEqual([[[42], 0]])
  })
})

describe('songsToSave', () => {
  it('keeps each song once', () => {
    expect(songsToSave(queue([1, 2, 1, 3], [1, 2, 3]))).toEqual([1, 2, 3])
  })
})

describe('sources from places and Library', () => {
  it('is the tag itself for one tag, a combination for more', () => {
    expect(librarySource([], TAGS)).toEqual({ kind: 'library' })
    expect(librarySource([3], TAGS)).toEqual({ kind: 'tag', tagId: 3, name: 'Calm' })
    expect(librarySource([1, 2], TAGS)).toEqual({
      kind: 'combined',
      tagIds: [1, 2],
      artistKeys: [],
      name: '原神纯音乐 or YOASOBI',
    })
    expect(placesSource([{ kind: 'tag', tag: TAGS[2]! }])).toEqual({
      kind: 'tag',
      tagId: 3,
      name: 'Calm',
    })
  })

  it('writes a combination into an address and reads it back', () => {
    const link = combinedLink({ tagIds: [2, 1], artistKeys: ['yorushika'] })
    expect(link).toEqual({ pathname: '/combined', params: { tags: '2,1', artists: 'yorushika' } })
    expect(parseCombinedParams({ tags: '2,1,x,1', artists: 'Yorushika' })).toEqual({
      tagIds: [2, 1],
      artistKeys: ['yorushika'],
      match: 'any',
    })
  })

  it('names the tags a list plays from, for the chips its rows leave off', () => {
    expect(sourceTagIds(librarySource([3], TAGS))).toEqual([3])
    expect(sourceTagIds(librarySource([1, 2], TAGS))).toEqual([1, 2])
    expect(sourceTagIds({ kind: 'library' })).toEqual([])
    expect(sourceTagIds(null)).toEqual([])
  })
})

describe('reading a source back', () => {
  it('keeps every kind it wrote, and drops anything else', () => {
    const sources: ListSource[] = [
      { kind: 'library' },
      { kind: 'tag', tagId: 1, name: 'a' },
      { kind: 'artist', key: 'k', name: 'K' },
      { kind: 'playlist', playlistId: 7, name: 'p' },
      { kind: 'combined', tagIds: [1, 2], artistKeys: ['k'], name: 'a or b' },
      { kind: 'answer', text: 'calm', name: 'Calm' },
      { kind: 'songs', origin: 'gems', name: 'Forgotten gems' },
      { kind: 'songs', origin: 'recent', name: 'Recently played' },
    ]
    for (const source of sources) {
      expect(parseListSource(JSON.parse(JSON.stringify(source)))).toEqual(source)
    }
    expect(parseListSource({ kind: 'songs', origin: 'nope', name: 'x' })).toBeNull()
    expect(parseListSource('tag')).toBeNull()
  })

  it('forgets a saved mark and an answer’s page, which last only while the app is open', () => {
    expect(parseListSource({ kind: 'playlist', playlistId: 7, name: 'p', saved: true })).toEqual({
      kind: 'playlist',
      playlistId: 7,
      name: 'p',
    })
    expect(parseListSource({ kind: 'answer', text: 't', name: 'n', answerId: '3' })).toEqual({
      kind: 'answer',
      text: 't',
      name: 'n',
    })
  })
})

describe('Recently played', () => {
  const tagSource: ListSource = { kind: 'tag', tagId: 1, name: '原神纯音乐' }
  const asked: ListSource = { kind: 'answer', text: 'calm', name: 'Calm' }

  it('remembers a list once, newest first, and not the whole library', () => {
    let lists: readonly RecentList[] = []
    lists = withListStarted(lists, tagSource, [1, 2], 100)
    lists = withListStarted(lists, asked, [3, 4], 200)
    lists = withListStarted(lists, tagSource, [1, 2], 300)
    expect(lists.map(entry => entry.key)).toEqual(['tag:1', 'answer:calm'])
    expect(withListStarted(lists, { kind: 'library' }, [1], 400)).toBe(lists)
    expect(sourceKey({ kind: 'songs', origin: 'search', name: 'Search' }, [5])).toBeNull()
  })

  it('shows a song heard in a list as the list, and a song played alone as itself', () => {
    let lists = withListStarted([], tagSource, [1, 2], Date.parse('2026-10-03T10:00:00Z'))
    lists = withSongPlayed(lists, 'tag:1', 1, Date.parse('2026-10-03T10:00:30Z'))
    const songs = [
      song(1, { lastPlayedAt: '2026-10-03 10:00:30' }),
      song(2),
      song(9, { lastPlayedAt: '2026-10-03 11:00:00' }),
    ]
    const tiles = homeRecents(lists, songs)
    expect(
      tiles.map(tile => (tile.kind === 'song' ? `song ${tile.song.id}` : tile.entry.key)),
    ).toEqual(['song 9', 'tag:1'])
  })

  it('leaves out a list none of whose songs is left', () => {
    const lists = withListStarted([], asked, [3, 4], 100)
    expect(homeRecents(lists, [song(1)])).toEqual([])
  })

  it('becomes the playlist it was saved as, keeping its place', () => {
    const lists = withListStarted(withListStarted([], asked, [3, 4], 100), tagSource, [1], 200)
    const saved: ListSource = { kind: 'playlist', playlistId: 8, name: 'Calm' }
    const renamed = withListRenamed(lists, 'answer:calm', 'playlist:8', saved)
    expect(renamed.map(entry => entry.key)).toEqual(['tag:1', 'playlist:8'])
    expect(renamed[1]?.songIds).toEqual([3, 4])
  })

  it('plays a tag again as the tag is now, and an answer as it was', () => {
    const library = {
      songs: [song(1, { tagIds: [1] }), song(2, { tagIds: [1] }), song(3)],
      tags: TAGS,
      ...NO_JOINS,
    }
    const fromTag = withListStarted([], tagSource, [1], 100)[0]!
    expect(recentSongIds(fromTag, library).sort()).toEqual([1, 2])
    const fromAnswer = withListStarted([], asked, [3, 99], 100)[0]!
    expect(recentSongIds(fromAnswer, library)).toEqual([3])
  })

  it('plays an artist kept from before a join as the artist it is joined to', () => {
    const library = {
      songs: [song(1, { artist: 'Yorushika' }), song(2, { artist: 'ヨルシカ' })],
      tags: TAGS,
      artistNames: { yorushika: ['ヨルシカ'] },
      artistNamesFound: [],
    }
    const kept = withListStarted(
      [],
      { kind: 'artist', key: 'ヨルシカ', name: 'ヨルシカ' },
      [2],
      100,
    )[0]!
    expect(recentSongIds(kept, library).sort()).toEqual([1, 2])
  })

  it('keeps an answer with its list, so its page can open after a reload', () => {
    const result = {
      understanding: {
        name: 'Calm',
        anyTags: [],
        artists: [],
        noTags: [],
        energy: { min: null, max: 0.4 },
        bpm: { min: null, max: null },
        year: { min: null, max: null },
        words: null,
        loved: null,
        playedWithinDays: null,
        notPlayedWithinDays: null,
        addedWithinDays: null,
        size: null,
        minutes: null,
        sound: null,
        brief: null,
      },
      fit: 9,
      loosened: [],
      unknown: [],
      picks: [{ songId: 3, why: null }],
    }
    const lists = withListStarted([], asked, [3], 100, result)
    expect(parseRecentLists(JSON.stringify(lists))[0]?.answer).toEqual(result)
    // Played again without it, the answer it had is kept.
    expect(withListStarted(lists, asked, [3], 200)[0]?.answer).toEqual(result)
  })

  it('survives being written and read back, and reads nothing from junk', () => {
    const lists = withListStarted([], asked, [3, 4], 100)
    expect(parseRecentLists(JSON.stringify(lists))).toEqual(lists)
    expect(parseRecentLists('nope')).toEqual([])
    expect(parseRecentLists(JSON.stringify([{ key: 1 }]))).toEqual([])
  })
})

describe('Liked', () => {
  const songs = [
    song(1, { loved: true, lovedAt: '2026-10-01 10:00:00' }),
    song(2, { loved: false, lovedAt: null }),
    song(3, { loved: true, lovedAt: '2026-10-20 10:00:00' }),
    // Liked before likes were timed: after the timed ones, newest added first.
    song(4, { loved: true, lovedAt: null }),
    song(5, { loved: true, lovedAt: null }),
  ]

  it('lists the liked songs, the newest like first', () => {
    expect(likedSongs(songs).map(each => each.id)).toEqual([3, 1, 5, 4])
  })

  it('is a place of its own: named Liked, linked to its page, never saved', () => {
    expect(describeSource(LIKED_SOURCE, known)).toMatchObject({
      label: 'Liked',
      link: { pathname: '/playlists/liked' },
    })
    expect(savePlan(LIKED_SOURCE, queue([3, 1, 5]), known)).toBeNull()
    expect(parseListSource(JSON.parse(JSON.stringify(LIKED_SOURCE)))).toEqual(LIKED_SOURCE)
  })

  it('is remembered once, and plays again as the likes are now', () => {
    expect(sourceKey(LIKED_SOURCE, [1, 3])).toBe('liked')
    const entry: RecentList = {
      key: 'liked',
      source: LIKED_SOURCE,
      songIds: [1],
      played: [],
      at: 1,
    }
    expect(recentSongIds(entry, { songs, tags: TAGS })).toEqual([3, 1, 5, 4])
  })

  it('is what Library plays with its Liked chip on, and with tags too it is a list of its own', () => {
    expect(libraryListSource({ tagIds: [], likedOnly: true }, TAGS)).toEqual(LIKED_SOURCE)
    expect(libraryListSource({ tagIds: [3], likedOnly: false }, TAGS)).toEqual(
      librarySource([3], TAGS),
    )
    const both = libraryListSource({ tagIds: [3], likedOnly: true }, TAGS)
    expect(both).toEqual({ kind: 'songs', origin: 'liked', name: 'Liked · Calm' })
    expect(savePlan(both, queue([1, 3]), known)).toMatchObject({
      kind: 'songs',
      name: 'Liked · Calm',
    })
  })
})

describe('Up next lined up by hand', () => {
  it('is what one song or the library becomes once songs are added; anything named stays', () => {
    expect(sourceAfterAdding(null)).toEqual(LINED_UP_SOURCE)
    expect(sourceAfterAdding({ kind: 'library' })).toEqual(LINED_UP_SOURCE)
    const tagged: ListSource = { kind: 'tag', tagId: 3, name: 'Calm' }
    expect(sourceAfterAdding(tagged)).toBe(tagged)
    expect(sourceAfterAdding(LIKED_SOURCE)).toBe(LIKED_SOURCE)
  })

  it('saves the songs in Up next’s order, by a name no playlist has yet', () => {
    const shuffled = queue([5, 2, 9], [2, 5, 9])
    const taken = { ...known, playlists: [playlist(8, 'Songs you lined up')] }
    expect(savePlan(LINED_UP_SOURCE, shuffled, taken)).toEqual({
      kind: 'songs',
      name: 'Songs you lined up 2',
      songIds: [5, 2, 9],
    })
    expect(savePlan(LINED_UP_SOURCE, queue([5]), known)).toBeNull()
  })

  it('is not kept as a list of its own by Recently played: its songs are', () => {
    expect(sourceKey(LINED_UP_SOURCE, [1, 2])).toBeNull()
  })
})

describe('tags combined: any or all', () => {
  const places = [
    { kind: 'tag' as const, tag: TAGS[2]! },
    { kind: 'tag' as const, tag: TAGS[1]! },
  ]

  it('names any with “or” and all with “&”, and keeps all in the source and the address', () => {
    expect(placesSource(places)).not.toHaveProperty('match')
    const all = placesSource(places, 'all')
    expect(all).toEqual({
      kind: 'combined',
      tagIds: [3, 2],
      artistKeys: [],
      name: 'Calm & YOASOBI',
      match: 'all',
    })
    if (all?.kind !== 'combined') throw new Error('combined')
    expect(describeSource(all, known).label).toBe('Calm & YOASOBI')
    expect(combinedLink(all).params).toEqual({ tags: '3,2', match: 'all' })
    expect(parseCombinedParams({ tags: '3,2', match: 'all' }).match).toBe('all')
    expect(parseCombinedParams({ tags: '3,2' }).match).toBe('any')
    expect(parseListSource(JSON.parse(JSON.stringify(all)))).toEqual(all)
  })

  it('remembers any and all as two lists, and plays all again as all', () => {
    const any = placesSource(places)!
    const all = placesSource(places, 'all')!
    expect(sourceKey(any, [])).not.toBe(sourceKey(all, []))
    const songs = [song(1, { tagIds: [3] }), song(2, { tagIds: [2, 3] })]
    const entry: RecentList = { key: 'k', source: all, songIds: [], played: [], at: 1 }
    expect(recentSongIds(entry, { songs, tags: TAGS })).toEqual([2])
  })
})
