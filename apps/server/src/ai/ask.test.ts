import { describe, expect, it } from 'vitest'
import type { Stats } from '@selfmp3/shared'
import { ask, followed, routeForm, routeSystem, withNotes } from './ask.js'
import { ASK_ACTIONS, foundFor, matchPlaylist } from './askActions.js'
import { SONGS, TAGS, scriptedLlm } from './fixtures/library.js'

const NOW = Date.parse('2026-10-03T12:00:00Z')

const noFilters = {
  name: 'x',
  anyTags: [],
  artists: [],
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
  songIds: () => songIds,
})
const PLAYLISTS = [
  manual('chill · chinese · hype'),
  manual('chill · chinese'),
  manual('hi'),
  manual('running', [7, 9, 14]),
  { ...manual('genshin'), kind: 'live' as const },
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

  it('shows the model the playlists it may name', async () => {
    const d = deps({ 'ask-route': [route({ action: 'none', say: 'x' })] })
    await ask(d, 'delete hi')
    expect(String(d.llm.asked[0]?.prompt)).toContain(
      'chill · chinese · hype | chill · chinese | hi',
    )
  })
})

describe('ask', () => {
  it('turns a request for music into Describe’s answer, with what it led with', async () => {
    const d = deps({
      'ask-route': [
        route({
          action: 'songs',
          songs: { play: true, next: false },
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

  it('steers from the song playing: shown as "this", left out of the picks, led as next', async () => {
    const d = deps({
      'ask-route': [
        route({
          action: 'songs',
          songs: { play: false, next: true },
          filters: { ...noFilters, artists: ['YOASOBI'] },
        }),
      ],
    })
    const answer = await ask(d, 'more like this after', 7)
    expect(answer).toMatchObject({ kind: 'songs', lead: 'next' })
    expect(answer.kind === 'songs' && answer.describe.picks.map(pick => pick.songId)).toEqual([8])
    const playing = SONGS.find(song => song.id === 7)!
    expect(d.llm.asked[0]!.prompt).toContain(`Now playing: ${playing.title} | ${playing.artist}`)
  })

  it('does not lead with next when nothing is playing', async () => {
    const d = deps({
      'ask-route': [
        route({
          action: 'songs',
          songs: { play: false, next: true },
          filters: { ...noFilters, artists: ['YOASOBI'] },
        }),
      ],
    })
    expect(await ask(d, 'queue some YOASOBI')).toMatchObject({ kind: 'songs', lead: 'save' })
  })

  it('hands anything about tags to the tag review, with the request itself', async () => {
    const d = deps({
      'ask-route': [route({ action: 'tags' })],
      'tags-plan': [
        {
          checkup: false,
          ops: [],
          focus: ['jpop'],
          newTag: null,
          songs: 'without',
          artists: ['Yorushika'],
        },
      ],
      'tags-groups': [
        {
          groups: [
            { g: 'g1', add: ['jpop'], remove: [], newTag: null, sure: 'high', why: 'J-pop' },
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

  it('changes names the way it was asked, on the songs the filters choose', async () => {
    const d = deps({
      'ask-route': [
        route({
          action: 'tidy',
          tidy: { checkup: false, lookUp: false },
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
        tidy: { checkup: false, lookUp: false },
        filters: { ...noFilters, anyTags: ['原神纯音乐'], size },
      })
    const d = deps({
      'ask-route': [tidyRoute(2), tidyRoute(300)],
      'tidy-sort': [{ n: [1, 2, 3] }],
      'tidy-asked': [{ edits: [] }, { edits: [] }],
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

  it('reads a follow-up together with what was said before it', async () => {
    const d = deps({
      'ask-route': [route({ action: 'tidy', tidy: { checkup: false, lookUp: false } })],
      'tidy-asked': [{ edits: [] }],
    })
    const first = 'give the 原神纯音乐 songs their official Chinese names'
    await ask(d, 'only the albums', null, undefined, undefined, [first])
    const request = followed('only the albums', [first])
    expect(request).toBe(
      `They first asked: ${first}\nNow they say: only the albums\n(Answer all of it together: the latest words change what was asked before.)`,
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
        route({ action: 'tidy', tidy: { checkup: false, lookUp: false } }),
      ],
      'tidy-asked': [{ edits: [] }],
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
      'ask-route': [route({ action: 'tidy', tidy: { checkup: true, lookUp: false } })],
      'tidy-names': [{ spellings: [], credits: [], albums: [] }],
    })
    const answer = await ask(d, 'clean up my song names')
    expect(answer).toMatchObject({ kind: 'tidy', tidy: { asked: null } })
    expect(d.llm.asked.map(each => each.task)).toEqual(['ask-route', 'tidy-names'])
  })

  it('says so when Tags is turned off', async () => {
    const d = deps({ 'ask-route': [route({ action: 'tags' })] })
    expect(await ask(d, 'tidy my tags', null, { tidy: true, tags: false })).toMatchObject({
      kind: 'none',
    })
    expect(d.llm.asked).toHaveLength(1)
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

  it('answers a listening question from the plays, not from the model', async () => {
    const d = deps({
      'ask-route': [route({ action: 'stats', stats: { range: '30d', about: 'songs' } })],
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

    // An action without what it needs is not trusted.
    const broken = deps({ 'ask-route': [route({ action: 'songs', songs: null })] })
    expect((await ask(broken, 'hm')).kind).toBe('none')
  })
})

describe('the router, built from the actions', () => {
  it('tells the model every action in its own words, and the filters only where they are read', () => {
    const system = routeSystem(ASK_ACTIONS)
    for (const each of ASK_ACTIONS) expect(system).toContain(`- ${each.name}: ${each.when}`)
    expect(system).toContain('"filters", for songs, library, tidy, playlistSongs:')
  })

  it('gives each action with fields its own part of the form, and the rest none', () => {
    const form = routeForm(ASK_ACTIONS)
    expect(form.parse(route({ action: 'tags' }))).toMatchObject({ action: 'tags' })
    expect(() => form.parse(route({ action: 'dance' }))).toThrow()
    const keys = Object.keys(form.parse(route({ action: 'tidy' })))
    expect(keys).toEqual(expect.arrayContaining(['songs', 'find', 'playlistSongs', 'tidy', 'open']))
    expect(keys).not.toContain('tags')
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
      library: { show: 'count', sortBy: null, order: 'asc', ...overrides },
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
})

describe('ask about a playlist’s songs', () => {
  const edit = (overrides: Record<string, unknown>, filters: unknown = null) =>
    route({
      action: 'playlistSongs',
      filters,
      playlistSongs: { name: 'running', op: 'add', sortBy: null, order: 'asc', ...overrides },
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

  it('asks which songs when the words choose none', async () => {
    const d = deps({ 'ask-route': [edit({}, noFilters)] })
    expect(await ask(d, 'add songs to running')).toMatchObject({
      kind: 'none',
      say: 'Say which songs to add to running: an artist, a tag, or a kind of song.',
    })
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

describe('foundFor', () => {
  it('matches titles, artists and albums, then lyrics, once each', () => {
    const lyrics = (query: string) => (query === 'yoasobi' ? [{ songId: 7, line: 'a line' }] : [])
    const found = foundFor(['YOASOBI'], SONGS, lyrics)
    expect(found.map(each => [each.song.id, each.line])).toEqual([
      [7, 'a line'],
      [8, null],
    ])
  })
})
