import { describe, expect, it } from 'vitest'
import { AskReplySchema, type AskObject, type AskTurn, type Stats } from '@selfmp3/shared'
import { ask, followed, withNotes } from './ask.js'
import { matchPlaylist } from './askLibrary.js'
import { songsMatching } from './halfRemembered.js'
import { SONGS, TAGS, endpointLlm } from './fixtures/library.js'

/**
 * Ask as an agent, in scripted conversations: the model's replies are tool
 * calls and a terminal `respond`, sent through a fake endpoint so `llm.ts`
 * runs its loop as it would against a real one, and the reply that comes out
 * is what the device would draw.
 */

const NOW = Date.parse('2026-10-03T12:00:00Z')

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
    { songId: 7, title: 'アイドル', artist: 'YOASOBI', hasArt: true, plays: 1, minutes: 3 },
  ],
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
  manual('running', [7, 9, 14]),
  live('genshin', [2]),
]

type Script = Parameters<typeof endpointLlm>[0]

function deps(script: Script, notes: string[] = []) {
  const llm = endpointLlm(script)
  return {
    llm,
    songs: () => SONGS,
    tags: () => TAGS,
    now: () => NOW,
    stats: () => STATS,
    lyrics: (query: string) => (query === '外婆' ? [{ songId: 15, line: '外婆的家' }] : []),
    playlists: () => PLAYLISTS,
    notes: () => notes,
  }
}

/** One reply of the agent: these calls, in order. */
const calls = (...each: [string, unknown][]) => ({
  calls: each.map(([name, args]) => ({ name, args })),
})
const respond = (args: unknown): [string, unknown] => ['respond', args]

/** What the model read back from the tools, by request, as the endpoint received it. */
function toolResults(llm: ReturnType<typeof endpointLlm>, request: number): string[] {
  return llm.sent['ask-agent']![request]!.messages.filter(each => each.role === 'tool').map(
    each => each.content ?? '',
  )
}

/** An earlier answer's songs, as the device sends them back. */
function shown(handle: string, songIds: number[], more: Partial<AskObject> = {}): AskObject {
  return {
    handle,
    kind: 'songs',
    label: 'Shown',
    songIds,
    why: songIds.map(() => null),
    playlist: null,
    lead: 'play',
    like: null,
    understanding: null,
    ...more,
  }
}
const turn = (asked: string, objects: AskObject[]): AskTurn => ({
  asked,
  answered: `Showed ${objects[0]?.songIds.length ?? 0} songs`,
  objects,
})

const ids = (reply: Awaited<ReturnType<typeof ask>>, card = 0): number[] => {
  const shownCard = reply.cards[card]!
  if (shownCard.kind === 'songs') return shownCard.describe.picks.map(pick => pick.songId)
  if (shownCard.kind === 'find') return shownCard.picks.map(pick => pick.songId)
  throw new Error(`card ${card} is ${shownCard.kind}`)
}

describe('ask, music to play or keep', () => {
  it('plans a find, a pick and the answer in one round, and leads with what was asked', async () => {
    const d = deps({
      'ask-agent': [
        calls(
          ['find_songs', { as: 'chopin', tags: ['古典'] }],
          [
            'pick_by_taste',
            { as: 'calm', from: { set: 'chopin' }, brief: 'for reading', count: 2 },
          ],
          respond({ say: null, cards: [{ kind: 'songs', from: { set: 'calm' }, lead: 'play' }] }),
        ),
      ],
      'describe-pick': [
        {
          picks: [
            { n: 1, why: 'slow piano' },
            { n: 2, why: 'gentle' },
          ],
        },
      ],
    })
    const reply = await ask(d, 'calm piano for reading')
    expect(AskReplySchema.parse(reply)).toEqual(reply)
    expect(reply.cards).toHaveLength(1)
    const card = reply.cards[0]!
    expect(card).toMatchObject({ kind: 'songs', lead: 'play' })
    if (card.kind !== 'songs') throw new Error('songs')
    expect(card.describe.picks).toHaveLength(2)
    expect(card.describe.picks.every(pick => [1, 2, 3].includes(pick.songId))).toBe(true)
    expect(card.describe.picks.map(pick => pick.why)).toEqual(['slow piano', 'gentle'])
    // What the songs were chosen from stays as chips: the tag, the brief, the size.
    expect(card.describe.understanding).toMatchObject({
      anyTags: ['古典'],
      brief: 'for reading',
      size: 2,
    })
    // One round, and the brain is the smart tier with JSON as text.
    expect(d.llm.sent['ask-agent']).toHaveLength(1)
    expect(d.llm.sent['ask-agent']![0]!.messages[0]!.content).toContain('JSON Schema ("ask-agent")')
    expect(d.llm.sent['ask-agent']![0]).toMatchObject({ reasoning_effort: 'low' })
  })

  it('plays the first songs in an order exactly, sorted in code with no pick', async () => {
    const d = deps({
      'ask-agent': [
        calls(
          ['find_songs', { as: 'top', sort: 'energy', order: 'desc', limit: 3 }],
          respond({
            cards: [
              {
                kind: 'songs',
                from: { set: 'top' },
                lead: 'play',
                expect: { count: 3, order: { by: 'energy', dir: 'desc' } },
              },
            ],
          }),
        ),
      ],
    })
    const reply = await ask(d, 'my 3 loudest songs')
    expect(ids(reply)).toEqual([7, 8, 9])
    expect(d.llm.sent['describe-pick']).toBeUndefined()
  })

  it('keeps a list as a playlist under the name given, and plays now what was wanted next with nothing playing', async () => {
    const d = deps({
      'ask-agent': [
        calls(
          ['find_songs', { as: 'y', artist: ['YOASOBI'] }],
          respond({
            cards: [
              { kind: 'songs', from: { set: 'y' }, lead: 'save', title: 'Morning' },
              { kind: 'songs', from: { set: 'y' }, lead: 'next' },
            ],
          }),
        ),
      ],
    })
    const reply = await ask(d, 'save yoasobi as Morning, and queue them')
    expect(reply.cards[0]).toMatchObject({ kind: 'songs', lead: 'save' })
    expect(reply.cards[0]!.kind === 'songs' && reply.cards[0]!.describe.understanding.name).toBe(
      'Morning',
    )
    expect(reply.cards[1]).toMatchObject({ kind: 'songs', lead: 'play' })
  })

  it('steers from the song playing: chosen like it, and it is not one of them', async () => {
    const d = deps({
      'ask-agent': [
        calls(
          ['find_songs', { as: 'kind', tags: ['jpop'] }],
          [
            'pick_by_taste',
            {
              as: 'calmer',
              from: { set: 'kind' },
              brief: 'calmer than this',
              like: { set: 'playing' },
            },
          ],
          respond({ cards: [{ kind: 'songs', from: { set: 'calmer' }, lead: 'next' }] }),
        ),
      ],
      'describe-pick': [{ picks: [{ n: 1, why: 'softer' }] }],
    })
    const reply = await ask(d, 'something calmer like this next', { playing: 7, screen: null })
    const card = reply.cards[0]!
    expect(card).toMatchObject({ kind: 'songs', lead: 'next', like: 7 })
    expect(ids(reply)).not.toContain(7)
    expect(d.llm.prompts['ask-agent']![0]).toContain('Now playing (the set playing): アイドル')
  })
})

describe('ask, several parts', () => {
  it('answers songs and a tag change over the same songs, in the order asked, with no review to plan', async () => {
    const d = deps({
      'ask-agent': [
        calls(
          ['find_songs', { as: 'jp', tags: ['jpop'] }],
          ['pick_by_taste', { as: 'calm', from: { set: 'jp' }, brief: 'calm', count: 2 }],
          [
            'propose_tags',
            { as: 'night', request: 'tag them 夜', scope: { set: 'calm' }, add: ['夜'] },
          ],
          respond({
            cards: [
              {
                kind: 'songs',
                from: { set: 'calm' },
                lead: 'play',
                expect: { count: 2, script: 'Japanese' },
              },
              { kind: 'tags', proposal: 'night' },
            ],
          }),
        ),
      ],
      'describe-pick': [
        {
          picks: [
            { n: 1, why: 'soft' },
            { n: 2, why: 'quiet' },
          ],
        },
      ],
    })
    const reply = await ask(d, '2 calm japanese songs and tag them 夜')
    expect(reply.cards.map(card => card.kind)).toEqual(['songs', 'tags'])
    const tags = reply.cards[1]!
    if (tags.kind !== 'tags') throw new Error('tags')
    expect(tags.review.changes).toEqual([
      expect.objectContaining({
        op: 'add',
        tag: '夜',
        isNew: true,
        by: 'rule',
        songIds: ids(reply),
      }),
    ])
    expect(d.llm.sent['tags-plan']).toBeUndefined()
    expect(d.llm.sent['tags-groups']).toBeUndefined()
  })

  it('hands the tag review what it would have read itself, so it does not plan', async () => {
    const d = deps({
      'ask-agent': [
        calls(
          [
            'propose_tags',
            {
              as: 'zh',
              request: 'tag the songs that should be 中文流行',
              focus: ['中文流行'],
              songs: 'without',
              artists: ['周杰倫'],
            },
          ],
          respond({ cards: [{ kind: 'tags', proposal: 'zh' }] }),
        ),
      ],
      'tags-groups': [
        {
          groups: [
            {
              g: 'g1',
              songs: [],
              add: ['中文流行'],
              remove: [],
              newTag: null,
              sure: 'high',
              why: 'Mandarin pop',
            },
          ],
        },
      ],
    })
    const reply = await ask(d, 'tag the songs that should be 中文流行')
    expect(reply.cards[0]).toMatchObject({ kind: 'tags' })
    expect(d.llm.sent['tags-plan']).toBeUndefined()
    expect(d.llm.prompts['tags-groups']![0]).toContain('周杰倫')
  })
})

describe('ask, following up', () => {
  const before = [turn('some yoasobi', [shown('t1.1', [7, 8, 9])])]

  it('acts on a place in an earlier list by its handle, after the song playing', async () => {
    const d = deps({
      'ask-agent': [
        calls(
          respond({ cards: [{ kind: 'songs', from: { set: 't1.1', pick: [3] }, lead: 'next' }] }),
        ),
      ],
    })
    const reply = await ask(
      d,
      'play the 3rd one next',
      { playing: 1, screen: 't1.1' },
      undefined,
      before,
    )
    expect(reply.cards[0]).toMatchObject({ kind: 'songs', lead: 'next' })
    expect(ids(reply)).toEqual([9])
    const prompt = d.llm.prompts['ask-agent']![0]!
    expect(prompt).toContain('On their screen now: t1.1 (the set screen).')
    expect(prompt).toContain('3. アポリア · Yorushika')
  })

  it('plays the first of the candidates a find showed when asked to play it', async () => {
    const found = [
      turn('the jay chou one about grandma', [shown('t1.1', [15, 14], { kind: 'find' })]),
    ]
    const d = deps({
      'ask-agent': [
        calls(
          respond({ cards: [{ kind: 'songs', from: { set: 'screen', pick: [1] }, lead: 'play' }] }),
        ),
      ],
    })
    const reply = await ask(d, 'play it', { playing: null, screen: 't1.1' }, undefined, found)
    expect(ids(reply)).toEqual([15])
  })

  it('leaves out the songs named and keeps the rest in their places', async () => {
    const d = deps({
      'ask-agent': [
        calls(
          respond({ cards: [{ kind: 'songs', from: { set: 'screen', drop: [2] }, lead: 'play' }] }),
        ),
      ],
    })
    const reply = await ask(
      d,
      'not 夜に駆ける',
      { playing: null, screen: 't1.1' },
      undefined,
      before,
    )
    expect(ids(reply)).toEqual([7, 9])
  })

  it('changes a list keeping the songs that still fit in their places, and picks only the rest', async () => {
    const list = [
      turn('some japanese songs', [
        shown('t1.1', [8, 7], { understanding: null, why: ['upbeat', 'catchy'] }),
      ]),
    ]
    const d = deps({
      'ask-agent': [
        calls(
          [
            'pick_by_taste',
            {
              as: 'more',
              from: { filters: { tags: ['jpop'] } },
              brief: 'japanese songs',
              count: 3,
              keep: { set: 'screen' },
            },
          ],
          respond({
            cards: [{ kind: 'songs', from: { set: 'more' }, lead: 'play', expect: { count: 3 } }],
          }),
        ),
      ],
      'describe-pick': [{ picks: [{ n: 1, why: 'also jpop' }] }],
    })
    const reply = await ask(d, '3 songs', { playing: null, screen: 't1.1' }, undefined, list)
    expect(ids(reply)).toEqual([8, 7, 9])
    const card = reply.cards[0]!
    if (card.kind !== 'songs') throw new Error('songs')
    expect(card.describe.picks.map(pick => pick.why)).toEqual(['upbeat', 'catchy', 'also jpop'])
    // Only one song was left to choose.
    expect(d.llm.prompts['describe-pick']![0]).toContain('Choose up to 1 songs.')
  })

  it('takes the earlier turns as context and answers the newest words', () => {
    const text = followed(
      'and the 2nd one?',
      before,
      't1.1',
      new Map(SONGS.map(song => [song.id, song])),
    )
    expect(text).toContain('They asked: some yoasobi')
    expect(text).toContain('t1.1 — “Shown” (songs, offered to play), 3 songs:')
    expect(text).toContain('Now they say: and the 2nd one?')
    expect(followed('hi', [])).toBe('hi')
  })
})

describe('ask, checked before it reaches the device', () => {
  it('sends a failed check back once, and the mended answer is the one shown', async () => {
    const d = deps({
      'ask-agent': [
        calls(
          ['find_songs', { as: 'jp', tags: ['jpop'] }],
          respond({
            say: 'Here are 3 songs.',
            cards: [
              { kind: 'songs', from: { set: 'jp' }, expect: { count: 2, artists: ['YOASOBI'] } },
            ],
          }),
        ),
        calls(
          respond({
            cards: [
              {
                kind: 'songs',
                from: { set: 'jp', pick: [1, 2] },
                expect: { count: 2, artists: ['YOASOBI'] },
              },
            ],
          }),
        ),
      ],
    })
    const reply = await ask(d, 'two yoasobi songs')
    expect(ids(reply)).toEqual([7, 8])
    const bounced = toolResults(d.llm, 1).at(-1)!
    expect(bounced).toContain('1 song is by none of YOASOBI (“アポリア”)')
  })

  it('accepts the second try as well as it can: songs past the number or by others left out', async () => {
    const wrong = respond({
      cards: [{ kind: 'songs', from: { set: 'jp' }, expect: { count: 1, artists: ['YOASOBI'] } }],
    })
    const d = deps({
      'ask-agent': [calls(['find_songs', { as: 'jp', tags: ['jpop'] }], wrong), calls(wrong)],
    })
    const reply = await ask(d, 'one yoasobi song')
    expect(ids(reply)).toEqual([7])
  })

  it('refuses a number in its words that no result shows', async () => {
    const d = deps({
      'ask-agent': [
        calls(
          ['count_by', { by: 'artist', scope: { filters: { artist: ['YOASOBI'] } } }],
          respond({
            say: 'You have 99 YOASOBI songs.',
            cards: [{ kind: 'library', from: { filters: { artist: ['YOASOBI'] } } }],
          }),
        ),
        calls(
          respond({
            say: 'You have 2 YOASOBI songs.',
            cards: [{ kind: 'library', from: { filters: { artist: ['YOASOBI'] } } }],
          }),
        ),
      ],
    })
    const reply = await ask(d, 'how many yoasobi songs do i have')
    expect(toolResults(d.llm, 1).at(-1)).toContain('say has 99')
    expect(reply.say).toBe('You have 2 YOASOBI songs.')
    expect(reply.cards[0]).toMatchObject({ kind: 'library', count: 2 })
  })

  it('wants an empty card to say why', async () => {
    const d = deps({
      'ask-agent': [
        calls(respond({ cards: [{ kind: 'songs', from: { ids: [] } }] })),
        calls(respond({ cards: [{ kind: 'words', text: 'None of your songs is that.' }] })),
      ],
    })
    const reply = await ask(d, 'heavy metal')
    expect(toolResults(d.llm, 1).at(-1)).toContain('holds no songs')
    expect(reply.cards[0]).toMatchObject({ kind: 'explore', say: 'None of your songs is that.' })
  })

  it('looks again when a list it never saw came to nothing, and takes what emptied it the second time', async () => {
    const empty = calls(
      ['find_songs', { as: 'x', artist: ['YOASOBI'], year: { min: 1990, max: 1991 } }],
      respond({ cards: [{ kind: 'songs', from: { set: 'x' } }] }),
    )
    const d = deps({
      'ask-agent': [empty, calls(respond({ cards: [{ kind: 'songs', from: { set: 'x' } }] }))],
    })
    const reply = await ask(d, 'yoasobi from 1990')
    expect(toolResults(d.llm, 1).at(-1)).toContain(
      'holds no songs (year 1990–1991 (left none of 2))',
    )
    const card = reply.cards[0]!
    expect(card.kind === 'songs' && card.describe.notes).toEqual([
      'year 1990–1991 (left none of 2)',
    ])
  })

  it('wants its words in the language of theirs', async () => {
    const d = deps({
      'ask-agent': [
        calls(respond({ cards: [{ kind: 'words', text: '这里不能打乱播放队列。' }] })),
        calls(respond({ cards: [{ kind: 'words', text: 'Shuffle is in the player.' }] })),
      ],
    })
    const reply = await ask(d, 'shuffle my queue')
    expect(toolResults(d.llm, 1).at(-1)).toContain('language of their newest words')
    expect(reply.cards[0]).toMatchObject({ say: 'Shuffle is in the player.' })
  })

  it('finds a title as it is written before one that only holds it', async () => {
    const d = deps({
      'ask-agent': [
        calls(
          ['find_songs', { as: 'q', title: 'Liyue' }],
          respond({ cards: [{ kind: 'songs', from: { set: 'q', pick: [1] } }] }),
        ),
      ],
    })
    const reply = await ask(d, 'play Liyue')
    expect(ids(reply)).toEqual([5])
  })

  it('refuses a set, a place or an id it was never given', async () => {
    const d = deps({
      'ask-agent': [
        calls(
          respond({
            cards: [
              { kind: 'songs', from: { set: 'nope' } },
              { kind: 'songs', from: { ids: [3] } },
            ],
          }),
        ),
        calls(respond({ cards: [{ kind: 'words', text: 'Say which songs.' }] })),
      ],
    })
    await ask(d, 'those')
    const bounced = toolResults(d.llm, 1).at(-1)!
    expect(bounced).toContain('There is no set called “nope”')
    expect(bounced).toContain('3 is not an id you were shown')
  })

  it('asks back on its own, and never beside an answer', async () => {
    const d = deps({
      'ask-agent': [
        calls(
          respond({
            cards: [
              { kind: 'clarify', question: 'Which one?', options: ['a', 'b'] },
              { kind: 'stats' },
            ],
          }),
        ),
        calls(
          respond({
            cards: [{ kind: 'clarify', question: 'Which one?', options: ['a', 'b', 'c'] }],
          }),
        ),
      ],
    })
    const reply = await ask(d, 'the good one')
    expect(toolResults(d.llm, 1).at(-1)).toContain('A clarify card stands alone')
    expect(reply).toEqual({
      say: null,
      cards: [{ kind: 'clarify', question: 'Which one?', options: ['a', 'b', 'c'] }],
    })
  })

  it('reads a tool’s error, mends the call, and goes on', async () => {
    const d = deps({
      'ask-agent': [
        calls(['find_songs', { as: 'x', scope: { set: 'gone' } }]),
        calls(
          ['find_songs', { as: 'x', artist: ['Yorushika'] }],
          respond({ cards: [{ kind: 'songs', from: { set: 'x' } }] }),
        ),
      ],
    })
    const reply = await ask(d, 'yorushika')
    expect(toolResults(d.llm, 1)[0]).toContain('There is no set called “gone”')
    expect(ids(reply)).toEqual([9, 13])
  })

  it('answers with what it has once its rounds are spent, the tools no longer offered', async () => {
    const look = calls(['lookup_names', { kind: 'artist', query: 'yoasobi' }])
    const d = deps({
      'ask-agent': [
        look,
        look,
        look,
        look,
        {
          say: 'Here they are.',
          cards: [{ kind: 'songs', from: { filters: { artist: ['YOASOBI'] } } }],
        },
      ],
    })
    const reply = await ask(d, 'yoasobi')
    expect(d.llm.sent['ask-agent']!.map(each => each.tool_choice)).toEqual([
      'auto',
      'auto',
      'auto',
      'auto',
      'none',
    ])
    expect(ids(reply)).toEqual([7, 8])
    expect(reply.say).toBe('Here they are.')
  })
})

describe('ask, every kind of answer', () => {
  it('finds a half-remembered song through titles and lyrics', async () => {
    const d = deps({
      'ask-agent': [
        calls(
          [
            'find_half_remembered',
            { as: 'it', terms: ['外婆', 'grandma'], brief: 'about his grandma' },
          ],
          respond({ cards: [{ kind: 'find', from: { set: 'it' } }] }),
        ),
      ],
      'ask-find': [{ picks: [{ n: 1, why: 'about grandma' }] }],
    })
    const reply = await ask(d, 'the jay chou one about grandma')
    expect(reply.cards[0]).toMatchObject({
      kind: 'find',
      terms: ['外婆', 'grandma'],
      picks: [{ songId: 15, why: 'about grandma' }],
    })
  })

  it('counts the library in code: how many, how long, who, and how many different', async () => {
    const d = deps({
      'ask-agent': [
        calls(
          respond({
            cards: [{ kind: 'library', from: { filters: { tags: ['古典'] } }, show: 'artists' }],
          }),
        ),
      ],
    })
    const reply = await ask(d, 'who is in 古典')
    expect(reply.cards[0]).toMatchObject({
      kind: 'library',
      count: 3,
      show: 'artists',
      distinct: { artists: 3, albums: 1, tags: 1 },
    })
  })

  it('counts by meaning when a model has judged every song', async () => {
    const d = deps({
      'ask-agent': [
        calls(
          ['judge_each', { as: 'love', brief: 'love songs', from: { filters: { words: 'with' } } }],
          respond({ cards: [{ kind: 'library', from: { set: 'love' } }] }),
        ),
      ],
      'ask-judge': [{ picks: [{ n: 1, why: 'a love song' }] }],
    })
    const reply = await ask(d, 'how many love songs do i have')
    expect(reply.cards[0]).toMatchObject({ kind: 'library', count: 1, judged: { songs: 8, of: 8 } })
  })

  it('answers the listening from the plays, as many as asked', async () => {
    const d = deps({
      'ask-agent': [
        calls(respond({ cards: [{ kind: 'stats', range: '30d', about: 'songs', limit: 1 }] })),
      ],
    })
    const reply = await ask(d, 'my top song this month')
    expect(reply.cards[0]).toEqual({
      kind: 'stats',
      range: '30d',
      about: 'songs',
      plays: 50,
      minutes: 48,
      items: [{ label: 'Light Glimmers · HOYO-MiX', plays: 2, songId: 6 }],
    })
  })

  it('proposes playlists deleted or renamed by their real names, and says when none is called that', async () => {
    const d = deps({
      'ask-agent': [
        calls(
          respond({
            cards: [
              {
                kind: 'playlist',
                op: 'delete',
                playlists: ['chill chiense hype', 'chill chinese'],
              },
              { kind: 'playlist', op: 'rename', playlists: ['runing'], newName: '跑步' },
            ],
          }),
        ),
        calls(
          respond({ cards: [{ kind: 'playlist', op: 'delete', playlists: ['nothing like it'] }] }),
        ),
        calls(
          respond({ cards: [{ kind: 'playlist', op: 'delete', playlists: ['nothing like it'] }] }),
        ),
      ],
    })
    const reply = await ask(d, 'delete the chill playlists and rename running to 跑步')
    expect(reply.cards).toEqual([
      {
        kind: 'playlists',
        op: 'delete',
        names: ['chill · chinese · hype', 'chill · chinese'],
        newName: null,
        unknown: [],
      },
      { kind: 'playlists', op: 'rename', names: ['running'], newName: '跑步', unknown: [] },
    ])
    const none = await ask(d, 'delete nothing like it')
    expect(none.cards).toEqual([
      {
        kind: 'explore',
        say: 'No playlist here is called “nothing like it”.',
        songIds: [],
        get: null,
      },
    ])
  })

  it('adds songs to a manual playlist, leaving out those in it, and says how a live one fills itself', async () => {
    const d = deps({
      'ask-agent': [
        calls(
          ['find_songs', { as: 'y', artist: ['YOASOBI', 'Yorushika'] }],
          respond({
            cards: [{ kind: 'playlist', op: 'add', playlists: ['running'], from: { set: 'y' } }],
          }),
        ),
        calls(
          ['find_songs', { as: 'g', tags: ['原神纯音乐'] }],
          respond({
            cards: [{ kind: 'playlist', op: 'add', playlists: ['genshin'], from: { set: 'g' } }],
          }),
        ),
      ],
    })
    const add = await ask(d, 'add yoasobi and yorushika to running')
    expect(add.cards[0]).toMatchObject({
      kind: 'playlistSongs',
      playlist: 'running',
      op: 'add',
      songs: [{ songId: 8 }, { songId: 13 }],
    })
    const toLive = await ask(d, 'add the genshin songs to genshin')
    expect(toLive.cards[0]).toMatchObject({ kind: 'explore' })
    expect(JSON.stringify(toLive.cards[0])).toContain('in genshin already')
  })

  it('sorts a playlist in code', async () => {
    const d = deps({
      'ask-agent': [
        calls(
          respond({
            cards: [
              {
                kind: 'playlist',
                op: 'sort',
                playlists: ['running'],
                sort: 'energy',
                order: 'asc',
              },
            ],
          }),
        ),
      ],
    })
    const reply = await ask(d, 'sort running calmest first')
    expect(reply.cards[0]).toMatchObject({
      kind: 'playlistSongs',
      op: 'sort',
      songs: [{ songId: 14 }, { songId: 9 }, { songId: 7 }],
    })
  })

  it('hands playback to the device, and asks which song in Up next when no place is said', async () => {
    const d = deps({
      'ask-agent': [
        calls(
          respond({
            cards: [
              { kind: 'playback', op: 'next' },
              { kind: 'playback', op: 'upNext', at: -1 },
            ],
          }),
        ),
        calls(respond({ cards: [{ kind: 'playback', op: 'upNext' }] })),
        calls(respond({ cards: [{ kind: 'playback', op: 'upNext' }] })),
      ],
    })
    const reply = await ask(d, 'skip, then play the last in up next')
    expect(reply.cards).toEqual([
      { kind: 'playback', op: 'next', place: null },
      { kind: 'playback', op: 'upNext', place: -1 },
    ])
    const vague = await ask(d, 'play the one in up next')
    expect(vague.cards[0]).toMatchObject({
      kind: 'explore',
      say: 'Say which song in Up next to play.',
    })
  })

  it('offers to remember, sends somewhere, opens a room, and answers in words with the songs it is about', async () => {
    const d = deps({
      'ask-agent': [
        calls(
          ['find_songs', { as: 'jay', artist: ['周杰倫'] }],
          respond({
            say: 'He is 周杰倫.',
            cards: [
              { kind: 'remember', text: 'Chinese names only' },
              { kind: 'open', place: 'stats', text: 'Your stats are there.' },
              { kind: 'together' },
              { kind: 'words', from: { set: 'jay' } },
            ],
          }),
        ),
      ],
    })
    const reply = await ask(d, 'who is jay chou')
    expect(reply.say).toBeNull()
    expect(reply.cards).toEqual([
      { kind: 'remember', note: 'Chinese names only' },
      { kind: 'open', place: 'stats', say: 'Your stats are there.' },
      { kind: 'together', describe: null },
      { kind: 'explore', say: 'He is 周杰倫.', songIds: [14, 15, 16], get: null },
    ])
  })

  it('shows the model the playlists with their kind and rules, the sets, and the standing notes', async () => {
    const d = deps({ 'ask-agent': [calls(respond({ cards: [{ kind: 'words', text: 'Hi.' }] }))] }, [
      'Chinese names only',
    ])
    await ask(d, 'hi', { playing: 7, screen: null })
    const prompt = d.llm.prompts['ask-agent']![0]!
    expect(prompt).toContain('- “genshin”: live, holds songs tagged 原神纯音乐')
    expect(prompt).toContain('- “running”: manual, 3 songs')
    expect(prompt).toContain('- playing: 1 song, the song playing (“アイドル” · YOASOBI)')
    expect(prompt).toContain(
      'Their standing preferences (follow them unless these words say otherwise):\n- Chinese names only',
    )
    expect(withNotes('x', [])).toBe('x')
  })
})

describe('matchPlaylist', () => {
  it('finds a playlist however it is spaced, dotted, cased or slipped, and names nothing that is not there', () => {
    expect(matchPlaylist('Chill Chinese Hype', PLAYLISTS)).toBe('chill · chinese · hype')
    expect(matchPlaylist('chill chiense', PLAYLISTS)).toBe('chill · chinese')
    expect(matchPlaylist('gym', PLAYLISTS)).toBeNull()
  })
})

describe('songsMatching', () => {
  it('matches titles, artists and albums, then lyrics, once each', () => {
    const found = songsMatching(['外婆', '七里香'], SONGS, query =>
      query === '外婆' ? [{ songId: 15, line: '外婆的家' }] : [],
    )
    expect(found.map(each => each.song.id)).toEqual(expect.arrayContaining([14, 15]))
  })
})
