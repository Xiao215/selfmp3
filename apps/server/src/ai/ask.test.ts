import { describe, expect, it } from 'vitest'
import type { Stats } from '@selfmp3/shared'
import { ask, followed, routeForm, routeSystem, withNotes } from './ask.js'
import { ASK_ACTIONS, matchPlaylist, songsMatching } from './askActions.js'
import { SONGS, TAGS, scriptedLlm, song } from './fixtures/library.js'

const NOW = Date.parse('2026-10-03T12:00:00Z')

/** The song playing, as the device sends it, with nothing on its screen. */
const whilePlaying = (id: number) => ({ playing: id, screen: null })
/** A form's scope naming the song playing. */
const PLAYING = { handle: 'playing', picks: null }

const noFilters = {
  name: 'x',
  anyTags: [],
  artists: [],
  albums: [],
  noTags: [],
  energy: { min: null, max: null },
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
}

const route = (overrides: Record<string, unknown>) => ({
  action: 'none',
  filters: null,
  songs: null,
  change: null,
  reply: null,
  tags: null,
  playback: null,
  find: null,
  stats: null,
  playlists: null,
  playlistSongs: null,
  library: null,
  tidy: null,
  remember: null,
  getMusic: null,
  open: null,
  say: null,
  try: null,
  ...overrides,
})

const STATS: Stats = {
  range: '30d',
  totals: {
    plays: 50,
    minutes: 48,
    songsPlayed: 49,
    librarySize: 17,
    libraryMinutes: 56,
    neverPlayed: 3,
  },
  streakDays: 1,
  longestStreakDays: 2,
  daily: [],
  hourly: [],
  topArtists: [{ key: 'HOYO-MiX', plays: 23, minutes: 20 }],
  topTags: [{ key: 'jpop', plays: 24, minutes: 25 }],
  topSongs: [
    { songId: 6, title: 'Light Glimmers', artist: 'HOYO-MiX', hasArt: true, plays: 2, minutes: 4 },
  ],
}

function deps(replies: Record<string, unknown[]>) {
  const llm = scriptedLlm(replies)
  return {
    llm,
    songs: () => SONGS,
    tags: () => TAGS,
    now: () => NOW,
    stats: () => STATS,
    lyrics: (query: string) => (query === '外婆' ? [{ songId: 15, line: '外婆的家' }] : []),
    playlists: () => PLAYLISTS,
  }
}

const manual = (name: string, songIds: number[] = []) => ({
  name,
  kind: 'manual' as const,
  rules: null,
  songIds: () => songIds,
})
/** A live playlist of the songs with any of these tags, as the server evaluates it. */
const live = (name: string, tagIds: number[]) => ({
  name,
  kind: 'live' as const,
  rules: {
    match: 'any' as const,
    rules: tagIds.map(tagId => ({ field: 'tag' as const, op: 'has' as const, tagId })),
    orderBy: 'addedAt' as const,
    order: 'desc' as const,
    limit: null,
  },
  songIds: () =>
    SONGS.filter(each => each.tagIds.some(id => tagIds.includes(id))).map(each => each.id),
})
const PLAYLISTS = [
  manual('chill · chinese · hype'),
  manual('chill · chinese'),
  manual('hi'),
  manual('running', [7, 9, 14]),
  live('genshin', [2]),
  live('jpop live', [3]),
]

describe('matchPlaylist', () => {
  it('finds a playlist however it is spaced, dotted or cased', () => {
    expect(matchPlaylist('Chill Chinese Hype', PLAYLISTS)).toBe('chill · chinese · hype')
    expect(matchPlaylist('chill chinese', PLAYLISTS)).toBe('chill · chinese')
  })

  it('forgives a slip or two, and names nothing that is not there', () => {
    expect(matchPlaylist('chill chiense hype', PLAYLISTS)).toBe('chill · chinese · hype')
    expect(matchPlaylist('chill chiense', PLAYLISTS)).toBe('chill · chinese')
    expect(matchPlaylist('workout', PLAYLISTS)).toBeNull()
    expect(matchPlaylist('', PLAYLISTS)).toBeNull()
  })
})

describe('ask, about playlists', () => {
  it('proposes deleting the playlists meant, by their real names', async () => {
    const d = deps({
      'ask-route': [
        route({
          action: 'playlists',
          playlists: {
            op: 'delete',
            names: ['chill chiense hype', 'chill chiense', 'gym'],
            newName: null,
          },
        }),
      ],
    })
    expect(await ask(d, 'remove the chill chiense hype and chill chiense playlists')).toEqual({
      kind: 'playlists',
      op: 'delete',
      names: ['chill · chinese · hype', 'chill · chinese'],
      newName: null,
      unknown: ['gym'],
    })
  })

  it('renames one playlist, and asks again when it cannot tell which or to what', async () => {
    const rename = (names: string[], newName: string | null) =>
      deps({
        'ask-route': [route({ action: 'playlists', playlists: { op: 'rename', names, newName } })],
      })
    expect(await ask(rename(['hi'], ' 华语慢歌 '), 'rename hi')).toMatchObject({
      kind: 'playlists',
      op: 'rename',
      names: ['hi'],
      newName: '华语慢歌',
    })
    expect(await ask(rename(['hi'], null), 'rename hi')).toMatchObject({ kind: 'none' })
    expect(await ask(rename(['nothing'], 'x'), 'rename nothing')).toEqual({
      kind: 'none',
      say: 'No playlist here is called “nothing”.',
      try: [],
    })
  })

  it('shows the model the playlists it may name, each with its kind and a live one’s rules', async () => {
    const d = deps({ 'ask-route': [route({ action: 'none', say: 'x' })] })
    await ask(d, 'delete hi')
    expect(String(d.llm.asked[0]?.prompt)).toContain(
      '- “chill · chinese · hype”: manual\n- “chill · chinese”: manual\n- “hi”: manual',
    )
    expect(String(d.llm.asked[0]?.prompt)).toContain(
      '- “genshin”: live, holds songs tagged 原神纯音乐',
    )
  })
})

describe('ask', () => {
  it('turns a request for music into Describe’s answer, with what it led with', async () => {
    const d = deps({
      'ask-route': [
        route({
          action: 'songs',
          songs: {
            play: true,
            next: false,
            from: null,
            like: null,
            name: null,
            sortBy: null,
            order: 'desc',
          },
          filters: { ...noFilters, artists: ['YOASOBI'] },
        }),
      ],
    })
    const answer = await ask(d, 'play some YOASOBI')
    expect(answer).toMatchObject({ kind: 'songs', lead: 'play' })
    expect(answer.kind === 'songs' && answer.describe.picks.map(pick => pick.songId)).toEqual([
      7, 8,
    ])
    // The route is the plan: nothing else was asked.
    expect(d.llm.asked.map(each => each.task)).toEqual(['ask-route'])
  })

  it('gives every song on an album asked for, however big the library', async () => {
    // More songs than a pick's table holds: an album left to the pick lost songs to the sample.
    const jukebox = new Set([37, 205, 411, 598, 760])
    const library = Array.from({ length: 800 }, (_, i) =>
      jukebox.has(i + 1)
        ? song(i + 1, { title: `Track ${i + 1}`, artist: '幾田りら', album: 'JUKEBOX' })
        : song(i + 1, { title: `Other ${i + 1}`, artist: `Artist ${i % 60}`, album: 'Other' }),
    )
    const d = {
      ...deps({
        'ask-route': [
          route({
            action: 'songs',
            songs: {
              play: true,
              next: false,
              from: null,
              like: null,
              name: null,
              sortBy: null,
              order: 'desc',
            },
            filters: { ...noFilters, albums: ['Jukebox'] },
          }),
        ],
      }),
      songs: () => library,
    }
    const answer = await ask(d, 'jukebox songs')
    expect(answer.kind === 'songs' && answer.describe.picks.map(pick => pick.songId)).toEqual([
      ...jukebox,
    ])
    expect(String(d.llm.asked[0]!.prompt)).toContain('JUKEBOX 5')
    expect(d.llm.asked.map(each => each.task)).toEqual(['ask-route'])
  })

  it('keeps the song playing when it is one of the songs asked for, not steered from', async () => {
    const d = deps({
      'ask-route': [
        route({
          action: 'songs',
          songs: {
            play: false,
            next: false,
            from: null,
            like: null,
            name: null,
            sortBy: null,
            order: 'desc',
          },
          filters: { ...noFilters, albums: ['七里香'] },
        }),
      ],
    })
    const answer = await ask(d, 'make a list of them', whilePlaying(14))
    expect(answer.kind === 'songs' && answer.describe.picks.map(pick => pick.songId)).toEqual([
      14, 15,
    ])
  })

  it('steers from the song playing: shown as "this", left out of the picks, led as next', async () => {
    const d = deps({
      'ask-route': [
        route({
          action: 'songs',
          songs: {
            play: false,
            next: true,
            from: null,
            like: null,
            name: null,
            sortBy: null,
            order: 'desc',
          },
          filters: { ...noFilters, artists: ['YOASOBI'] },
        }),
      ],
    })
    const answer = await ask(d, 'more like this after', whilePlaying(7))
    expect(answer).toMatchObject({ kind: 'songs', lead: 'next' })
    expect(answer.kind === 'songs' && answer.describe.picks.map(pick => pick.songId)).toEqual([8])
    const playing = SONGS.find(song => song.id === 7)!
    expect(d.llm.asked[0]!.prompt).toContain(`Now playing: ${playing.title} | ${playing.artist}`)
  })

  it('orders by how the song playing sounds only when they ask for music like it', async () => {
    const seeds: number[] = []
    const sound = {
      match: () => Promise.resolve(null),
      closeTo: (seed: number, ids: readonly number[]) => {
        seeds.push(seed)
        return new Map(ids.filter(id => id !== seed).map(id => [id, id / 100]))
      },
    }
    const steer = (like: boolean) => ({
      ...deps({
        'ask-route': [
          route({
            action: 'songs',
            songs: {
              play: false,
              next: true,
              from: null,
              like: like ? PLAYING : null,
              name: null,
              sortBy: null,
              order: 'desc',
            },
            filters: { ...noFilters, anyTags: ['原神纯音乐'] },
          }),
        ],
      }),
      sound,
    })
    await ask(steer(false), 'play some Genshin next', whilePlaying(7))
    expect(seeds).toEqual([])
    const answer = await ask(steer(true), 'more like this', whilePlaying(7))
    expect(seeds).toEqual([7])
    // The closest-sounding first, the song playing left out.
    expect(answer.kind === 'songs' && answer.describe.picks.map(pick => pick.songId)).toEqual([
      6, 5, 4,
    ])
  })

  it('does not lead with next when nothing is playing', async () => {
    const d = deps({
      'ask-route': [
        route({
          action: 'songs',
          songs: {
            play: false,
            next: true,
            from: null,
            like: null,
            name: null,
            sortBy: null,
            order: 'desc',
          },
          filters: { ...noFilters, artists: ['YOASOBI'] },
        }),
      ],
    })
    expect(await ask(d, 'queue some YOASOBI')).toMatchObject({ kind: 'songs', lead: 'save' })
  })

  it('hands anything about tags to the tag review, with the request itself', async () => {
    const d = deps({
      'ask-route': [route({ action: 'tags', tags: { from: null } })],
      'tags-plan': [
        {
          checkup: false,
          ops: [],
          focus: ['jpop'],
          newTag: null,
          songs: 'without',
          artists: ['Yorushika'],
          from: null,
        },
      ],
      'tags-groups': [
        {
          groups: [
            {
              g: 'g1',
              songs: [],
              add: ['jpop'],
              remove: [],
              newTag: null,
              sure: 'high',
              why: 'J-pop',
            },
          ],
        },
      ],
    })
    const answer = await ask(d, 'tag the yorushika songs that should be jpop')
    expect(answer).toMatchObject({ kind: 'tags', review: { asked: expect.any(String) } })
    if (answer.kind !== 'tags') throw new Error('not tags')
    expect(answer.review.changes).toEqual([
      expect.objectContaining({ op: 'add', tag: 'jpop', songIds: [13] }),
    ])
    expect(d.llm.asked[1]!.prompt).toContain('tag the yorushika songs that should be jpop')
  })

  it('hands the tag review the number of songs asked for', async () => {
    const d = deps({
      'ask-route': [
        route({ action: 'tags', tags: { from: null }, filters: { ...noFilters, size: 2 } }),
      ],
      'tags-plan': [
        {
          checkup: false,
          ops: [],
          focus: [],
          newTag: null,
          songs: 'untagged',
          artists: [],
          from: null,
          albums: [],
        },
      ],
      'tags-groups': [
        {
          groups: ['g1', 'g2', 'g3'].map(g => ({
            g,
            songs: [],
            add: ['jpop'],
            remove: [],
            newTag: null,
            sure: 'high',
            why: 'J-pop',
          })),
        },
      ],
    })
    const answer = await ask(d, 'tag two of my untagged songs')
    if (answer.kind !== 'tags') throw new Error('not tags')
    expect(new Set(answer.review.changes.flatMap(change => change.songIds)).size).toBe(2)
    expect(answer.review.note).toContain('Kept to 2 songs, as you asked.')
  })

  it('changes names the way it was asked, on the songs the filters choose', async () => {
    const d = deps({
      'ask-route': [
        route({
          action: 'tidy',
          tidy: { what: 'change', lookUp: false, from: null },
          filters: { ...noFilters, anyTags: ['原神纯音乐', 'genshin'] },
        }),
      ],
      'tidy-asked': [
        {
          edits: [
            // An album's songs sit together: Where Mercy Endures, Jade Moon…, The Wind….
            { n: 2, field: 'title', to: '璃月', why: 'Official Chinese name' },
            { n: 3, field: 'album', to: '风与牧歌之邦', why: 'Official Chinese name' },
            // Not in the table, a second answer for one field, and no change: all dropped.
            { n: 9, field: 'title', to: 'x', why: 'x' },
            { n: 2, field: 'title', to: 'Liyue again', why: 'x' },
            { n: 1, field: 'title', to: 'Light Glimmers as Shadows Shift', why: 'x' },
          ],
          say: '',
        },
      ],
    })
    const text = '原神纯音乐的歌，能不能帮我加上他们官方的中文名？album也是'
    const answer = await ask(d, text)
    if (answer.kind !== 'tidy') throw new Error(`not tidy: ${answer.kind}`)
    expect(answer.tidy).toMatchObject({ looked: 3, asked: text })
    expect(answer.tidy.note).toMatch(/no genshin/)
    expect(
      answer.tidy.changes.map(c => `${c.field}|${c.from}→${c.to}|${c.songIds.join(',')}|${c.by}`),
    ).toEqual([
      'album|The Wind and the Star Traveler→风与牧歌之邦|4|model',
      'title|Liyue→璃月|5|model',
    ])
    // The request itself and the songs' titles go to the model; the checkup's names call does not run.
    const prompt = d.llm.asked[1]!.prompt
    expect(prompt).toContain(text)
    expect(prompt).toContain('2 | Liyue | Yu-Peng Chen, HOYO-MiX | Jade Moon Upon a Sea of Clouds')
    expect(prompt).not.toContain('アイドル')
    expect(d.llm.asked.map(each => each.task)).toEqual(['ask-route', 'tidy-asked'])
  })

  it('changes no more songs than the number they gave', async () => {
    const tidyRoute = (size: number) =>
      route({
        action: 'tidy',
        tidy: { what: 'change', lookUp: false, from: null },
        filters: { ...noFilters, anyTags: ['原神纯音乐'], size },
      })
    const d = deps({
      'ask-route': [tidyRoute(2), tidyRoute(300)],
      'tidy-sort': [{ n: [1, 2, 3] }],
      'tidy-asked': [
        { edits: [], say: '' },
        { edits: [], say: '' },
      ],
    })
    const answer = await ask(d, '原神纯音乐英文的歌名换成官方中文名，先换2首')
    if (answer.kind !== 'tidy') throw new Error(`not tidy: ${answer.kind}`)
    expect(answer.tidy).toMatchObject({
      looked: 2,
      note: 'Changing the first 2 of the 3 songs that need it; ask again for the rest.',
    })
    expect(d.llm.asked.map(each => each.task)).toEqual(['ask-route', 'tidy-sort', 'tidy-asked'])
    // More than a playlist's 200 is a number too; with fewer songs than that, nothing is sorted.
    const all = await ask(d, '原神纯音乐英文的歌名换成官方中文名，先换300首')
    expect(all).toMatchObject({ kind: 'tidy', tidy: { looked: 3, note: null } })
  })

  it('reads a follow-up after the conversation before it, answers and all', async () => {
    const d = deps({
      'ask-route': [route({ action: 'tidy', tidy: { what: 'change', lookUp: false, from: null } })],
      'tidy-asked': [{ edits: [], say: '' }],
    })
    const first = {
      asked: 'give the 原神纯音乐 songs their official Chinese names',
      answered: 'Proposed 8 name changes.',
      objects: [],
    }
    await ask(d, 'only the albums', undefined, undefined, [first])
    const request = followed('only the albums', [first])
    expect(request).toBe(
      [
        'Earlier in this conversation:',
        `They asked: ${first.asked}`,
        'You answered: Proposed 8 name changes.',
        '',
        'Nothing from this conversation is on their screen now.',
        '',
        'Now they say: only the albums',
        '(Answer what they say now. The earlier turns are what it follows on from, not questions to answer again; when it changes something asked before, the answer is that earlier request changed. Songs an answer showed are named by its handle and their places in its list, never described again. Write anything for them in the language of what they say now, whatever language the earlier turns are in.)',
      ].join('\n'),
    )
    // The router and the action it chose both read all of it.
    expect(d.llm.asked[0]!.prompt).toContain(`The request:\n${request}`)
    expect(d.llm.asked[1]!.prompt).toContain(`The request:\n${request}`)
    expect(followed('hi', [])).toBe('hi')
  })

  it('offers to remember a way of doing things, and sends what it remembers with every request', async () => {
    const d = deps({
      'ask-route': [
        route({ action: 'remember', remember: { note: '  Chinese names only,  no English ' } }),
        route({ action: 'tidy', tidy: { what: 'change', lookUp: false, from: null } }),
      ],
      'tidy-asked': [{ edits: [], say: '' }],
    })
    expect(await ask(d, '以后都只要中文名')).toEqual({
      kind: 'remember',
      note: 'Chinese names only, no English',
    })
    const notes = ['Chinese names only, no English']
    await ask({ ...d, notes: () => notes }, 'fix the Genshin names')
    const request = withNotes('fix the Genshin names', notes)
    expect(request).toContain('Their standing preferences')
    expect(d.llm.asked[1]!.prompt).toContain(request)
    expect(d.llm.asked[2]!.prompt).toContain('- Chinese names only, no English')
    expect(withNotes('hi', [])).toBe('hi')
  })

  it('still runs the checkup when only asked to clean up', async () => {
    const d = deps({
      'ask-route': [
        route({ action: 'tidy', tidy: { what: 'checkup', lookUp: false, from: null } }),
      ],
      'tidy-names': [{ spellings: [], credits: [], albums: [] }],
    })
    const answer = await ask(d, 'clean up my song names')
    // The checkup lists what is missing, for "Fill in what's missing" to look up.
    expect(answer).toMatchObject({
      kind: 'tidy',
      tidy: { asked: null, gaps: { songs: 17, album: 0, year: 11, cover: 17 } },
    })
    expect(d.llm.asked.map(each => each.task)).toEqual(['ask-route', 'tidy-names'])
  })

  it('checks only the songs asked about, and says so when none of them is here', async () => {
    const d = deps({
      'ask-route': [
        route({
          action: 'tidy',
          tidy: { what: 'checkup', lookUp: false, from: null },
          filters: { ...noFilters, artists: ['YOASOBI'] },
        }),
        route({
          action: 'tidy',
          tidy: { what: 'checkup', lookUp: false, from: null },
          filters: { ...noFilters, artists: ['孙燕姿'] },
        }),
      ],
      'tidy-names': [{ spellings: [], credits: [], albums: [] }],
    })
    const answer = await ask(d, 'fix the names of my YOASOBI songs')
    expect(answer).toMatchObject({ kind: 'tidy', tidy: { looked: 2 } })
    expect(d.llm.asked[1]!.prompt).not.toContain('周杰倫')
    expect(await ask(d, 'fix the names of my 孙燕姿 songs')).toEqual({
      kind: 'none',
      say: 'Your library has no 孙燕姿.',
      try: [],
    })
  })

  it('changes the song playing and no other, when the request points at it', async () => {
    const d = deps({
      'ask-route': [
        route({ action: 'tidy', tidy: { what: 'change', lookUp: false, from: PLAYING } }),
        route({ action: 'tidy', tidy: { what: 'change', lookUp: false, from: PLAYING } }),
      ],
      'tidy-asked': [
        { edits: [{ n: 1, field: 'title', to: '夜に駆ける!', why: 'As you asked' }], say: '' },
      ],
    })
    const answer = await ask(d, 'this title should end with a !', whilePlaying(8))
    if (answer.kind !== 'tidy') throw new Error(`not tidy: ${answer.kind}`)
    expect(answer.tidy.changes.map(each => each.songIds)).toEqual([[8]])
    expect(answer.tidy.looked).toBe(1)
    expect(await ask(d, 'this title should end with a !')).toMatchObject({
      kind: 'none',
      say: 'Nothing is playing to look at.',
    })
  })

  it('fills in what the songs it chose are missing, from the catalogues', async () => {
    const d = deps({
      'ask-route': [
        route({
          action: 'tidy',
          tidy: { what: 'fill', lookUp: false, from: null },
          filters: { ...noFilters, artists: ['YOASOBI'] },
        }),
      ],
    })
    const looked: string[] = []
    const answer = await ask(
      {
        ...d,
        findListings: async song => {
          looked.push(song.title)
          return [
            {
              source: 'iTunes',
              title: song.title,
              artist: song.artist,
              album: song.album,
              year: null,
              cover: `https://is1.mzstatic.com/${song.id}.jpg`,
            },
          ]
        },
      },
      'fill in the missing covers of my YOASOBI songs',
    )
    expect(looked.sort()).toEqual(['アイドル', '夜に駆ける'])
    if (answer.kind !== 'tidy') throw new Error(`not tidy: ${answer.kind}`)
    expect(
      answer.tidy.changes.map(each => `${each.field}|${each.to}|${each.songIds}`).sort(),
    ).toEqual(['cover|https://is1.mzstatic.com/7.jpg|7', 'cover|https://is1.mzstatic.com/8.jpg|8'])
  })

  it('looks for songs held twice among the songs it chose', async () => {
    const d = deps({
      'ask-route': [route({ action: 'tidy', tidy: { what: 'copies', lookUp: false, from: null } })],
    })
    const twice = [...SONGS, { ...SONGS[6]!, id: 99 }]
    const answer = await ask({ ...d, songs: () => twice }, 'do I have any song twice?')
    expect(answer).toMatchObject({
      kind: 'copies',
      copies: { copies: [{ keep: 7, songIds: [99], by: 'rule' }], looked: 18 },
    })
  })

  it('finds a half-remembered song through titles and lyrics, then picks', async () => {
    const d = deps({
      'ask-route': [
        route({ action: 'find', find: { terms: ['外婆', 'tea'], brief: 'grandma’s tea' } }),
      ],
      'ask-find': [
        {
          picks: [
            { n: 1, why: 'about a grandmother' },
            { n: 9, why: 'made up' },
          ],
        },
      ],
    })
    const answer = await ask(d, 'the song about grandma’s tea')
    expect(answer).toEqual({
      kind: 'find',
      terms: ['外婆', 'tea'],
      picks: [{ songId: 15, why: 'about a grandmother' }],
    })
    expect(d.llm.asked[1]!.prompt).toContain('lyric: 外婆的家')
  })

  it('looks up a song that is none of theirs, so they hear what it is', async () => {
    const d = deps({
      'ask-route': [
        route({ action: 'find', find: { terms: ['小さな恋のうた'], brief: 'a song' } }),
      ],
      'ask-explore': [
        {
          say: 'MONGOL800’s song; not in your library.',
          songs: [],
          get: ' 小さな恋のうた MONGOL800 ',
        },
      ],
    })
    expect(await ask(d, 'chiisana koi no uta')).toEqual({
      kind: 'explore',
      say: 'MONGOL800’s song; not in your library.',
      songIds: [],
      // What to search for, to get it.
      get: '小さな恋のうた MONGOL800',
    })
    expect(d.llm.asked.map(each => each.task)).toEqual(['ask-route', 'ask-explore'])
  })

  it('looks it up too when none of the songs that matched is the one', async () => {
    const d = deps({
      'ask-route': [route({ action: 'find', find: { terms: ['外婆'], brief: 'grandma' } })],
      'ask-find': [{ picks: [] }],
      'ask-explore': [{ say: 'Not one of yours.', songs: [], get: null }],
    })
    expect(await ask(d, 'that grandma song')).toMatchObject({ kind: 'explore' })
    expect(d.llm.asked.map(each => each.task)).toEqual(['ask-route', 'ask-find', 'ask-explore'])
  })

  it('answers a listening question from the plays, not from the model', async () => {
    const d = deps({
      'ask-route': [
        route({ action: 'stats', stats: { range: '30d', about: 'songs', size: null } }),
      ],
    })
    expect(await ask(d, 'what did I play most')).toEqual({
      kind: 'stats',
      range: '30d',
      about: 'songs',
      plays: 50,
      minutes: 48,
      items: [{ label: 'Light Glimmers · HOYO-MiX', plays: 2, songId: 6 }],
    })
  })

  it('sends somewhere else, or says what it can do', async () => {
    const open = deps({
      'ask-route': [
        route({ action: 'open', open: { place: 'import', say: 'Import takes a link.' } }),
      ],
    })
    expect(await ask(open, 'download an album')).toEqual({
      kind: 'open',
      place: 'import',
      say: 'Import takes a link.',
    })
  })

  it('asks the router once more when the action it chose lacks what it needs, saying what', async () => {
    const fixed = deps({
      'ask-route': [
        route({ action: 'stats', stats: null }),
        route({ action: 'stats', stats: { range: 'all', about: 'totals', size: null } }),
      ],
    })
    expect(await ask(fixed, 'how much have I listened')).toMatchObject({ kind: 'stats' })
    expect(fixed.llm.asked[1]!.prompt).toContain(
      'Your last answer chose stats and left "stats" empty',
    )

    // Twice without it: not trusted, and the answer says what was missing.
    const broken = deps({
      'ask-route': [
        route({
          action: 'songs',
          songs: {
            play: true,
            next: false,
            from: null,
            like: null,
            name: null,
            sortBy: null,
            order: 'desc',
          },
        }),
        route({
          action: 'songs',
          songs: {
            play: true,
            next: false,
            from: null,
            like: null,
            name: null,
            sortBy: null,
            order: 'desc',
          },
        }),
      ],
    })
    expect(await ask(broken, 'hm')).toMatchObject({
      kind: 'none',
      say: expect.stringContaining('which songs you mean'),
    })
    expect(broken.llm.asked[1]!.prompt).toContain('left "filters" empty')
  })

  it('reads the request afresh every time: the same words are routed again, not remembered', async () => {
    const d = deps({
      'ask-route': [
        route({ action: 'none', say: 'first' }),
        route({ action: 'none', say: 'second' }),
      ],
    })
    expect(await ask(d, 'hm')).toMatchObject({ say: 'first' })
    expect(await ask(d, 'hm')).toMatchObject({ say: 'second' })
  })

  it('lists as many of the most played as were asked for, ten when no number is said', async () => {
    const tops: (number | undefined)[] = []
    const many: Stats = {
      ...STATS,
      topArtists: Array.from({ length: 30 }, (_, i) => ({
        key: `A${i}`,
        plays: 30 - i,
        minutes: 1,
      })),
    }
    const asked = (size: number | null) => ({
      ...deps({
        'ask-route': [route({ action: 'stats', stats: { range: 'all', about: 'artists', size } })],
      }),
      stats: (_range: Stats['range'], top?: number) => {
        tops.push(top)
        return many
      },
    })
    const twenty = await ask(asked(20), 'top 20 artists')
    expect(twenty.kind === 'stats' && twenty.items.map(item => item.label)).toEqual(
      many.topArtists.slice(0, 20).map(each => each.key),
    )
    const plain = await ask(asked(null), 'my top artists')
    expect(plain.kind === 'stats' && plain.items).toHaveLength(10)
    expect(tops).toEqual([20, 10])
  })
})

describe('ask for songs in an order', () => {
  const ordered = (filters: Record<string, unknown>, sortBy: string, order = 'desc') =>
    route({
      action: 'songs',
      songs: { play: true, next: false, from: null, like: null, name: null, sortBy, order },
      filters: { ...noFilters, ...filters },
    })

  it('plays exactly the first songs in the order, sorted in code and not picked from a sample', async () => {
    // More songs than a pick's table holds, the most played far from the front of the library.
    const library = Array.from({ length: 800 }, (_, i) =>
      song(i + 1, { title: `Song ${i + 1}`, playCount: i === 640 ? 99 : (i * 7) % 50 }),
    )
    const d = {
      ...deps({ 'ask-route': [ordered({ size: 20 }, 'plays')] }),
      songs: () => library,
    }
    const answer = await ask(d, 'play my 20 most played songs')
    if (answer.kind !== 'songs') throw new Error(answer.kind)
    const plays = answer.describe.picks.map(pick => library[pick.songId - 1]!.playCount)
    expect(plays).toHaveLength(20)
    expect(plays[0]).toBe(99)
    expect(plays).toEqual([...plays].sort((a, b) => b - a))
    expect(Math.min(...plays)).toBeGreaterThanOrEqual(
      [...library].sort((a, b) => b.playCount - a.playCount)[19]!.playCount,
    )
    expect(answer.describe.fit).toBe(800)
    expect(d.llm.asked.map(each => each.task)).toEqual(['ask-route'])
  })

  it('fills a length in order, and leaves out the song steered from', async () => {
    const d = deps({ 'ask-route': [ordered({ minutes: 10 }, 'duration')] })
    const answer = await ask(d, 'my longest songs, ten minutes')
    if (answer.kind !== 'songs') throw new Error(answer.kind)
    // Every fixture song is 200 s but two: the longest first, until ten minutes are full.
    const seconds = answer.describe.picks.map(
      pick => SONGS.find(s => s.id === pick.songId)!.duration,
    )
    expect(seconds).toEqual([...seconds].sort((a, b) => b - a))
    expect(seconds.slice(0, -1).reduce((a, b) => a + b, 0)).toBeLessThan(600)
    expect(seconds.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(600)

    const next = deps({
      'ask-route': [
        route({
          action: 'songs',
          songs: {
            play: false,
            next: true,
            from: null,
            like: null,
            name: null,
            sortBy: 'energy',
            order: 'desc',
          },
          filters: { ...noFilters, anyTags: ['jpop'] },
        }),
      ],
    })
    const steered = await ask(next, 'the most energetic jpop next', whilePlaying(7))
    expect(
      steered.kind === 'songs' && steered.describe.picks.map(pick => pick.songId),
    ).not.toContain(7)
  })

  it('judges words the order cannot say among the first in the order, and keeps the order', async () => {
    const d = deps({
      'ask-route': [ordered({ anyTags: ['jpop', '原神纯音乐'], brief: 'sung' }, 'energy')],
      'describe-pick': [
        {
          picks: [
            { n: 3, why: 'sung' },
            { n: 1, why: 'sung' },
          ],
        },
      ],
    })
    const answer = await ask(d, 'my most energetic songs with singing')
    if (answer.kind !== 'songs') throw new Error(answer.kind)
    const energies = answer.describe.picks.map(
      pick => SONGS.find(s => s.id === pick.songId)!.audioFeatures!.energy!,
    )
    expect(energies).toHaveLength(2)
    expect(energies[0]).toBeGreaterThan(energies[1]!)
  })
})

describe('the router, built from the actions', () => {
  it('tells the model every action in its own words, and the filters only where they are read', () => {
    const system = routeSystem(ASK_ACTIONS)
    for (const each of ASK_ACTIONS) expect(system).toContain(`- ${each.name}: ${each.when}`)
    expect(system).toContain('"filters", for songs, together, tags, library, tidy, playlistSongs:')
  })

  it('gives each action with fields its own part of the form, and the rest none', () => {
    const form = routeForm(ASK_ACTIONS)
    expect(form.parse(route({ action: 'tags', tags: { from: null } }))).toMatchObject({
      action: 'tags',
    })
    expect(() => form.parse(route({ action: 'dance' }))).toThrow()
    const keys = Object.keys(form.parse(route({ action: 'tidy' })))
    expect(keys).toEqual(expect.arrayContaining(['songs', 'find', 'playlistSongs', 'tidy', 'open']))
    expect(keys).not.toContain('explore')
  })

  it('takes a new action as an entry, with nothing else to change', () => {
    const shuffle = {
      name: 'shuffle',
      when: 'they want everything shuffled.',
      fields: null,
      filters: 'unused' as const,
      run: () => ({ kind: 'none' as const, say: 'shuffled', try: [] }),
    }
    const actions = [...ASK_ACTIONS, shuffle]
    expect(routeSystem(actions)).toContain('- shuffle: they want everything shuffled.')
    expect(routeForm(actions).parse(route({ action: 'shuffle' }))).toMatchObject({
      action: 'shuffle',
    })
  })
})

describe('ask about the library', () => {
  const question = (overrides: Record<string, unknown>) =>
    route({
      action: 'library',
      library: { from: null, show: 'count', sortBy: null, order: 'asc', ...overrides },
    })

  it('counts the songs the filters choose, and says who they are by', async () => {
    const d = deps({
      'ask-route': [{ ...question({}), filters: { ...noFilters, artists: ['yoasobi'] } }],
    })
    expect(await ask(d, 'how many yoasobi songs do I have')).toMatchObject({
      kind: 'library',
      count: 2,
      seconds: 400,
      songIds: [7, 8],
      artists: [{ label: 'YOASOBI', count: 2 }],
      tags: [{ label: 'jpop', count: 2 }],
    })
    // The answer is counted in code: the model is asked once, to route.
    expect(d.llm.asked).toHaveLength(1)
  })

  it('sorts the whole library when no filter is set, songs without the value last', async () => {
    const d = deps({ 'ask-route': [question({ show: 'songs', sortBy: 'energy', order: 'desc' })] })
    const answer = await ask(d, 'my most energetic songs')
    if (answer.kind !== 'library') throw new Error(answer.kind)
    expect(answer.count).toBe(17)
    expect(answer.songIds.slice(0, 2)).toEqual([7, 8])
    expect(answer.songIds.at(-1)).toBe(13)
  })

  it('counts what only a model can judge by judging every song the filters let in', async () => {
    const d = deps({
      'ask-route': [
        { ...question({}), filters: { ...noFilters, words: 'with', brief: 'named for rain' } },
      ],
      'ask-judge': [{ picks: [{ n: 1, why: 'rain' }] }],
    })
    const answer = await ask(d, 'how many songs about rain do I have')
    expect(answer).toMatchObject({ kind: 'library', count: 1, judged: { songs: 8, of: 8 } })
    // One table holding every song with words, not a sample of them.
    expect(String(d.llm.asked[1]!.prompt).match(/^#\d+ \|/gm)).toHaveLength(8)
  })

  it('judges a big library a table at a time, and past the most it judges, says it is an estimate', async () => {
    const library = (n: number) =>
      Array.from({ length: n }, (_, i) => song(i + 1, { title: `Song ${i + 1}` }))
    const every = (count: number) =>
      Array.from({ length: count }, () => ({
        picks: [
          { n: 1, why: 'yes' },
          { n: 2, why: 'yes' },
        ],
      }))
    const all = {
      ...deps({
        'ask-route': [{ ...question({}), filters: { ...noFilters, brief: 'love songs' } }],
        'ask-judge': every(3),
      }),
      songs: () => library(400),
    }
    const counted = await ask(all, 'how many love songs do I have')
    expect(counted).toMatchObject({ count: 6, judged: { songs: 400, of: 400 } })
    expect(all.llm.asked.filter(each => each.task === 'ask-judge')).toHaveLength(3)

    const big = {
      ...deps({
        'ask-route': [{ ...question({}), filters: { ...noFilters, brief: 'love songs' } }],
        'ask-judge': every(4),
      }),
      songs: () => library(1200),
    }
    // 8 of the 600 judged, an even spread of 1,200: about 16 in all.
    expect(await ask(big, 'how many love songs do I have')).toMatchObject({
      count: 16,
      judged: { songs: 600, of: 1200 },
    })
  })

  it('counts none when the model judges none, and fails when its answer cannot be read', async () => {
    const d = deps({
      'ask-route': [{ ...question({}), filters: { ...noFilters, brief: 'named for rain' } }],
      'ask-judge': [{ picks: [] }],
    })
    expect(await ask(d, 'how many songs about rain do I have')).toMatchObject({
      kind: 'library',
      count: 0,
    })
    const unreadable = deps({
      'ask-route': [{ ...question({}), filters: { ...noFilters, brief: 'named for rain' } }],
      'ask-judge': [new Error('unreadable')],
    })
    await expect(ask(unreadable, 'how many songs about rain do I have')).rejects.toThrow()
  })

  it('counts a song for everyone it is by, and how many artists, albums and tags there are', async () => {
    const d = deps({
      'ask-route': [
        { ...question({ show: 'artists' }), filters: { ...noFilters, anyTags: ['原神纯音乐'] } },
      ],
    })
    const answer = await ask(d, 'who is in 原神纯音乐')
    expect(answer).toMatchObject({
      count: 3,
      judged: null,
      artists: [
        { label: 'HOYO-MiX', count: 3 },
        { label: 'Yu-Peng Chen', count: 2 },
      ],
      distinct: { artists: 2, tags: 1 },
    })
    const albums = deps({
      'ask-route': [
        { ...question({ show: 'albums' }), filters: { ...noFilters, artists: ['周杰倫'] } },
      ],
    })
    const jay = await ask(albums, '周杰伦的专辑我有几张')
    expect(jay.kind === 'library' && jay.distinct.albums).toBe(
      new Set(SONGS.filter(s => s.artist.startsWith('周杰倫')).map(s => s.album)).size,
    )
  })
})

describe('ask about a playlist’s songs', () => {
  const edit = (overrides: Record<string, unknown>, filters: unknown = null) =>
    route({
      action: 'playlistSongs',
      filters,
      playlistSongs: {
        name: 'running',
        from: null,
        op: 'add',
        sortBy: null,
        order: 'asc',
        ...overrides,
      },
    })

  it('adds the songs the filters choose that are not in it yet', async () => {
    const d = deps({ 'ask-route': [edit({}, { ...noFilters, artists: ['YOASOBI'] })] })
    expect(await ask(d, 'add the yoasobi songs to running')).toMatchObject({
      kind: 'playlistSongs',
      playlist: 'running',
      op: 'add',
      songs: [{ songId: 8, why: null }],
      by: 'rule',
    })
  })

  it('lets the model judge words the filters cannot say, among the playlist’s own songs', async () => {
    const d = deps({
      'ask-route': [edit({ op: 'remove' }, { ...noFilters, brief: 'the Japanese ones' })],
      'describe-pick': [
        {
          picks: [
            { n: 1, why: 'Japanese' },
            { n: 2, why: 'Japanese' },
          ],
        },
      ],
    })
    const answer = await ask(d, 'take the japanese ones out of running')
    if (answer.kind !== 'playlistSongs') throw new Error(answer.kind)
    expect(answer.by).toBe('model')
    expect(answer.songs).toHaveLength(2)
    expect(answer.songs.every(each => [7, 9, 14].includes(each.songId))).toBe(true)
    expect(String(d.llm.asked[1]?.prompt)).toContain('take out of the playlist “running”')
  })

  it('sorts its songs, and leaves a playlist that fills itself alone', async () => {
    const sorted = deps({ 'ask-route': [edit({ op: 'sort', sortBy: 'energy', order: 'asc' })] })
    expect(await ask(sorted, 'sort running calmest first')).toMatchObject({
      songs: [{ songId: 14 }, { songId: 9 }, { songId: 7 }],
    })
    const live = deps({ 'ask-route': [edit({ name: 'genshin', op: 'sort', sortBy: 'energy' })] })
    expect(await ask(live, 'sort genshin')).toMatchObject({ kind: 'none' })
  })

  it('says when the songs to add to a live playlist are in it already, by the tag it follows', async () => {
    const d = deps({
      'ask-route': [edit({ name: 'jpop live' }, { ...noFilters, artists: ['YOASOBI'] })],
    })
    expect(await ask(d, 'add the yoasobi songs to jpop live')).toEqual({
      kind: 'none',
      say: 'All 2 of those songs are in jpop live already: it holds songs tagged jpop.',
      try: [],
    })
  })

  it('offers the tag change that puts songs into a live playlist, or takes them out', async () => {
    const add = deps({
      'ask-route': [edit({ name: 'jpop live' }, { ...noFilters, artists: ['周杰倫'] })],
    })
    expect(await ask(add, 'add jay chou to jpop live')).toEqual({
      kind: 'none',
      say: 'jpop live is live: it holds songs tagged jpop, so a song goes in by matching that, and 3 of those songs do not yet. Giving them its tag puts them in.',
      try: ['give the songs by 周杰倫 the tag jpop'],
    })
    const remove = deps({
      'ask-route': [
        edit({ name: 'jpop live', op: 'remove' }, { ...noFilters, brief: 'the slow ones' }),
      ],
    })
    expect(await ask(remove, 'take the slow ones out of jpop live')).toMatchObject({
      kind: 'none',
      try: ['take the tag jpop off the songs tagged jpop, the slow ones'],
    })
    // Nothing is proposed for a live playlist, so no model judges its songs.
    expect(remove.llm.asked.map(each => each.task)).toEqual(['ask-route'])
  })

  it('asks which songs when the words choose none', async () => {
    const d = deps({ 'ask-route': [edit({}, noFilters)] })
    expect(await ask(d, 'add songs to running')).toMatchObject({
      kind: 'none',
      say: 'Say which songs to add to running: an artist, an album, a tag, or a kind of song.',
    })
  })
})

describe('ask, to listen with friends', () => {
  it('opens a room with nothing chosen when they only want the room', async () => {
    const d = deps({ 'ask-route': [route({ action: 'together' })] })
    expect(await ask(d, 'start a room')).toEqual({ kind: 'together', describe: null })
    expect(d.llm.asked.map(each => each.task)).toEqual(['ask-route'])
  })

  it('picks the songs the words asked for, for the device to start the room with or add', async () => {
    const d = deps({
      'ask-route': [route({ action: 'together', filters: { ...noFilters, artists: ['YOASOBI'] } })],
    })
    const answer = await ask(d, 'start a room with some YOASOBI')
    expect(answer.kind === 'together' && answer.describe?.picks.map(pick => pick.songId)).toEqual([
      7, 8,
    ])
  })
})

describe('ask, about the music playing', () => {
  const control = (playback: { op: string; place: number | null }) =>
    deps({ 'ask-route': [route({ action: 'playback', playback })] })

  it('hands skipping, going back, restarting and pausing to the device, with no place', async () => {
    for (const op of ['next', 'previous', 'restart', 'pause', 'resume']) {
      // A place the router filled in anyway means nothing for these.
      expect(await ask(control({ op, place: 2 }), 'skip this song', whilePlaying(7))).toEqual({
        kind: 'playback',
        op,
        place: null,
      })
    }
  })

  it('counts a song in Up next from the front or from the back, as the words did', async () => {
    expect(
      await ask(control({ op: 'upNext', place: 3 }), 'play the third song in the queue'),
    ).toEqual({ kind: 'playback', op: 'upNext', place: 3 })
    expect(
      await ask(control({ op: 'upNext', place: -1 }), 'play the last song in Up next'),
    ).toEqual({ kind: 'playback', op: 'upNext', place: -1 })
  })

  it('asks which song when the place says none', async () => {
    for (const place of [null, 0]) {
      expect(await ask(control({ op: 'upNext', place }), 'play the song in Up next')).toEqual({
        kind: 'none',
        say: 'Say which song in Up next to play.',
        try: [],
      })
    }
  })

  it('refuses a place past any Up next, or an op it does not know', async () => {
    const d = control({ op: 'upNext', place: 5000 })
    await expect(ask(d, 'play the 5000th song in the queue')).rejects.toThrow()
    await expect(ask(control({ op: 'shuffle', place: null }), 'shuffle')).rejects.toThrow()
  })
})

describe('a dead end', () => {
  it('offers what the box can do instead, ready to ask', async () => {
    const d = deps({
      'ask-route': [
        route({
          action: 'none',
          say: 'Say which songs.',
          try: ['tag the songs that should be jpop', ' '],
        }),
      ],
    })
    expect(await ask(d, 'tag the good ones')).toEqual({
      kind: 'none',
      say: 'Say which songs.',
      try: ['tag the songs that should be jpop'],
    })
  })
})

describe('songsMatching', () => {
  it('matches titles, artists and albums, then lyrics, once each', () => {
    const lyrics = (query: string) => (query === 'yoasobi' ? [{ songId: 7, line: 'a line' }] : [])
    const found = songsMatching(['YOASOBI'], SONGS, lyrics)
    expect(found.map(each => [each.song.id, each.line])).toEqual([
      [7, 'a line'],
      [8, null],
    ])
  })
})

describe('ask, acting on what an earlier answer showed', () => {
  // An Up next list of three songs (and one the library no longer has), as the device sends it back.
  const shown = {
    handle: 't1.1',
    kind: 'songs' as const,
    label: 'J-pop next',
    songIds: [7, 8, 9, 999],
    why: ['bright', 'fast', null, 'gone'],
    playlist: null,
    lead: 'next' as const,
    like: 13,
    understanding: { ...noFilters, name: 'J-pop next', anyTags: ['jpop'] },
  }
  const before = [
    {
      asked: 'some jpop next',
      answered: 'Offered 4 songs (“J-pop next”) to play after the song playing',
      objects: [shown],
    },
  ]
  const onScreen = { playing: 13, screen: 't1.1' }
  const songsPart = (overrides: Record<string, unknown>) => ({
    play: false,
    next: false,
    from: null,
    like: null,
    name: null,
    sortBy: null,
    order: 'desc',
    ...overrides,
  })

  it('shows the router each object by handle, its songs numbered with their reasons, the screen’s first', async () => {
    const d = deps({
      'ask-route': [
        route({
          action: 'songs',
          songs: songsPart({ play: true, from: { handle: 't1.1', picks: [2] } }),
        }),
      ],
    })
    const answer = await ask(d, 'play the 2nd one', onScreen, undefined, before)
    const prompt = d.llm.asked[0]!.prompt
    expect(prompt).toContain('It showed: t1.1')
    expect(prompt).toContain(
      't1.1 — “J-pop next” (songs, offered to play next), 4 songs:\n  1. アイドル · YOASOBI (why: bright)\n  2. 夜に駆ける · YOASOBI (why: fast)',
    )
    expect(prompt).toContain('On their screen now: t1.1.')
    // Exactly the song at that place, played now, with the reason it was shown with.
    expect(answer).toMatchObject({
      kind: 'songs',
      lead: 'play',
      like: 13,
      describe: { picks: [{ songId: 8, why: 'fast' }], fit: 1 },
    })
    expect(d.llm.asked).toHaveLength(1)
  })

  it('keeps exactly the songs shown under the name given, only those the library has', async () => {
    const d = deps({
      'ask-route': [
        route({
          action: 'songs',
          songs: songsPart({ from: { handle: 't1.1', picks: null }, name: 'Morning' }),
        }),
      ],
    })
    const answer = await ask(d, 'save it as Morning', onScreen, undefined, before)
    expect(answer).toMatchObject({ kind: 'songs', lead: 'save' })
    expect(answer.kind === 'songs' && answer.describe.understanding.name).toBe('Morning')
    expect(answer.kind === 'songs' && answer.describe.picks.map(pick => pick.songId)).toEqual([
      7, 8, 9,
    ])
  })

  it('adds the songs shown to a playlist, leaving out the ones already in it', async () => {
    const d = deps({
      'ask-route': [
        route({
          action: 'playlistSongs',
          playlistSongs: {
            name: 'running',
            from: { handle: 't1.1', picks: null },
            op: 'add',
            sortBy: null,
            order: 'asc',
          },
        }),
      ],
    })
    const answer = await ask(d, 'add these to running', onScreen, undefined, before)
    expect(answer).toMatchObject({
      kind: 'playlistSongs',
      playlist: 'running',
      op: 'add',
      by: 'rule',
    })
    expect(answer.kind === 'playlistSongs' && answer.songs.map(each => each.songId)).toEqual([8])
  })

  it('takes out the songs named and keeps the rest as they were, still next and like the song', async () => {
    const d = deps({
      'ask-route': [route({ action: 'change', change: { from: 't1.1', drop: [1] } })],
    })
    const answer = await ask(d, 'not アイドル', onScreen, undefined, before)
    expect(answer).toMatchObject({ kind: 'songs', lead: 'next', like: 13 })
    expect(answer.kind === 'songs' && answer.describe.picks).toEqual([
      { songId: 8, why: 'fast' },
      { songId: 9, why: null },
    ])
    expect(d.llm.asked).toHaveLength(1)
  })

  it('changes a list from what it understood, keeping the songs that still fit and what it was for', async () => {
    const d = deps({
      'ask-route': [route({ action: 'change', change: { from: 't1.1', drop: null } })],
      'refine-plan': [{ ...shown.understanding, size: 2 }],
    })
    const answer = await ask(d, 'just two', onScreen, undefined, before)
    expect(d.llm.asked[1]!.prompt).toContain('What they first asked:\nsome jpop next')
    expect(d.llm.asked[1]!.prompt).toContain('What to change:\njust two')
    expect(answer).toMatchObject({ kind: 'songs', lead: 'next', like: 13 })
    expect(answer.kind === 'songs' && answer.describe.picks).toEqual([
      { songId: 7, why: 'bright' },
      { songId: 8, why: 'fast' },
    ])
  })

  it('answers why a song is in a list from what was shown, with the song it is about', async () => {
    const d = deps({
      'ask-route': [
        route({
          action: 'reply',
          reply: { say: 'It was picked for being fast.', from: { handle: 't1.1', picks: [2] } },
        }),
      ],
    })
    expect(await ask(d, 'why is 夜に駆ける in here', onScreen, undefined, before)).toEqual({
      kind: 'explore',
      say: 'It was picked for being fast.',
      songIds: [8],
      get: null,
    })
  })

  it('hands the tag review the songs pointed at, and only those', async () => {
    const d = deps({
      'ask-route': [route({ action: 'tags', tags: { from: { handle: 't1.1', picks: [1, 3] } } })],
      'tags-plan': [
        { checkup: false, ops: [], focus: ['jpop'], newTag: null, songs: 'all', artists: [] },
      ],
      'tags-groups': [{ groups: [] }],
    })
    const answer = await ask(d, 'are these right as jpop', onScreen, undefined, before)
    expect(d.llm.asked[1]!.prompt).toContain('The songs it is about:\nアイドル | YOASOBI |')
    expect(answer).toMatchObject({ kind: 'tags', review: { looked: 2 } })
  })

  it('says so when a handle names nothing here, rather than reaching for the whole library', async () => {
    const d = deps({
      'ask-route': [
        route({
          action: 'songs',
          songs: songsPart({ play: true, from: { handle: 't4.1', picks: null } }),
        }),
      ],
    })
    expect(await ask(d, 'play that one', onScreen, undefined, before)).toEqual({
      kind: 'none',
      say: 'Those songs aren’t in your library any more.',
      try: [],
    })
  })
})
