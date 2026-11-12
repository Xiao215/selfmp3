import { describe, expect, it } from 'vitest'
import { scriptedLlm, song } from './fixtures/library.js'
import { LlmError } from './llm.js'
import { askedTidy } from './askedTidy.js'

describe('tidy, asked for something', () => {
  const many = Array.from({ length: 61 }, (_, index) =>
    song(index + 1, { title: `Track ${index + 1}`, album: 'OST' }),
  )
  const text = 'give these their Chinese names'

  it('asks in batches, and says which songs a failed batch left out', async () => {
    const llm = scriptedLlm({
      'tidy-asked': [
        { edits: [{ n: 1, field: 'title', to: '第一首', why: 'Official Chinese name' }], say: '' },
        new LlmError('busy', 'slow down'),
      ],
    })
    const result = await askedTidy(
      { llm, songs: () => [] },
      {
        text,
        songs: many,
        unknown: [],
        lookUp: false,
      },
    )
    expect(llm.asked).toHaveLength(2)
    expect(result.changes).toEqual([
      expect.objectContaining({ field: 'title', from: 'Track 1', to: '第一首', songIds: [1] }),
    ])
    expect(result).toMatchObject({ looked: 61, asked: text })
    expect(result.note).toMatch(/Left out 1 song;/)
  })

  it('fails as the model failed when no batch could be asked', async () => {
    const llm = scriptedLlm({ 'tidy-asked': [new LlmError('unreachable', 'down')] })
    await expect(
      askedTidy(
        { llm, songs: () => [] },
        {
          text,
          songs: many.slice(0, 3),
          unknown: [],
          lookUp: false,
        },
      ),
    ).rejects.toBeInstanceOf(LlmError)
  })

  it('changes no more songs than they said, taken from the ones that still need it', async () => {
    const llm = scriptedLlm({
      'tidy-sort': [{ n: [1, 3, 5] }],
      'tidy-asked': [
        { edits: [{ n: 2, field: 'title', to: '第三首', why: 'Official Chinese name' }], say: '' },
      ],
    })
    const result = await askedTidy(
      { llm, songs: () => [] },
      {
        text: 'give the English ones their Chinese names, up to 2',
        songs: many,
        unknown: [],
        lookUp: false,
        limit: 2,
      },
    )
    expect(llm.asked.map(each => each.task)).toEqual(['tidy-sort', 'tidy-asked'])
    expect(llm.asked[0]!.tier).toBe('fast')
    const table = llm.asked[1]!.prompt
    expect(table).toContain('1 | Track 1 |')
    expect(table).toContain('2 | Track 3 |')
    expect(table).not.toContain('Track 5')
    expect(result.changes).toEqual([
      expect.objectContaining({ from: 'Track 3', to: '第三首', songIds: [3] }),
    ])
    expect(result.looked).toBe(2)
    expect(result.note).toBe(
      'Changing the first 2 of the 3 songs that need it; ask again for the rest.',
    )
  })

  it('keeps every song of a batch it could not sort', async () => {
    const llm = scriptedLlm({
      'tidy-sort': [new LlmError('busy', 'slow down')],
      'tidy-asked': [{ edits: [], say: '' }],
    })
    const result = await askedTidy(
      { llm, songs: () => [] },
      {
        text,
        songs: many.slice(0, 3),
        unknown: [],
        lookUp: false,
        limit: 2,
      },
    )
    expect(llm.asked[1]!.prompt).toContain('2 | Track 2 |')
    expect(result.note).toMatch(/^Changing the first 2 of the 3 songs/)
  })

  it('says what the model told them when it changes nothing', async () => {
    const llm = scriptedLlm({
      'tidy-asked': [
        {
          edits: [],
          say: 'Track 1 looks like the song you mean, but I am not sure of its official name.',
        },
        {
          edits: [],
          say: 'Track 1 looks like the song you mean, but I am not sure of its official name.',
        },
      ],
    })
    const result = await askedTidy(
      { llm, songs: () => [] },
      {
        text,
        songs: many,
        unknown: [],
        lookUp: false,
      },
    )
    expect(result).toMatchObject({
      changes: [],
      reply: 'Track 1 looks like the song you mean, but I am not sure of its official name.',
    })
  })

  it('speaks from the batch that changed something, in the language they asked in', async () => {
    const llm = scriptedLlm({
      'tidy-asked': [
        {
          edits: [{ n: 1, field: 'title', to: '第一首', why: 'Chinese name' }],
          say: 'Renamed one.',
        },
        { edits: [], say: '这些歌里没有你说的那首。' },
      ],
    })
    const asked = { text, songs: many, unknown: [], lookUp: false }
    expect(await askedTidy({ llm, songs: () => [] }, asked)).toMatchObject({
      reply: 'Renamed one.',
    })
  })

  it('leaves the words to the card when more than one batch changed names', async () => {
    const llm = scriptedLlm({
      'tidy-asked': [
        { edits: [{ n: 1, field: 'title', to: '第一首', why: 'Chinese name' }], say: 'One.' },
        { edits: [{ n: 1, field: 'title', to: '第六十一首', why: 'Chinese name' }], say: 'Two.' },
      ],
    })
    const asked = { text, songs: many, unknown: [], lookUp: false }
    const result = await askedTidy({ llm, songs: () => [] }, asked)
    expect(result.changes).toHaveLength(2)
    expect(result.reply).toBeNull()
  })

  it('stops before the model when no song needs it', async () => {
    const llm = scriptedLlm({ 'tidy-sort': [{ n: [] }] })
    const result = await askedTidy(
      { llm, songs: () => [] },
      {
        text,
        songs: many,
        unknown: [],
        lookUp: false,
        limit: 10,
      },
    )
    expect(result).toMatchObject({ changes: [], looked: 61, note: null })
    expect(llm.asked.map(each => each.task)).toEqual(['tidy-sort'])
  })
})

describe('tidy, with names looked up', () => {
  const cliffs = song(1, {
    title: 'Wordless Cliffs',
    artist: 'HOYO-MiX',
    album: 'Millelith’s Watch',
  })
  const lost = song(2, { title: 'Not Anywhere', artist: 'HOYO-MiX' })
  const findNames = async (each: { id: number }) =>
    each.id === 1
      ? [
          {
            source: '网易云' as const,
            title: '丹砂巍巍 Wordless Cliffs',
            artist: 'HOYO-MiX',
            album: '原神-千岩旷望 Millelith’s Watch',
          },
        ]
      : []

  it('takes names only from what the catalogues have, and starts them ticked', async () => {
    const llm = scriptedLlm({
      'tidy-asked': [
        {
          edits: [
            { n: 1, field: 'title', to: '丹砂巍巍', why: 'Official Chinese name' },
            { n: 1, field: 'album', to: '千岩旷望', why: 'Official Chinese name' },
            // Words no catalogue has: made up, so dropped.
            { n: 1, field: 'artist', to: '米哈游', why: 'Official Chinese name' },
          ],
          say: '',
        },
      ],
    })
    const result = await askedTidy(
      { llm, songs: () => [], findNames },
      {
        text: '加上官方的中文名，album也是',
        songs: [cliffs, lost],
        unknown: [],
        lookUp: true,
      },
    )
    expect(
      result.changes.map(
        c => `${c.field}|${c.from}→${c.to}|${c.songIds.join(',')}|${c.by}|${c.why}`,
      ),
    ).toEqual([
      'album|Millelith’s Watch→千岩旷望|1|rule|The name on 网易云',
      'title|Wordless Cliffs→丹砂巍巍|1|rule|The name on 网易云',
    ])
    expect(result.note).toBe(
      '1 song wasn’t found on 网易云, MusicBrainz or iTunes, so it is left as it is.',
    )
    // Only the song that was found goes to the model, with what was found.
    const prompt = llm.asked[0]!.prompt
    expect(prompt).toContain(
      'found: 网易云 “丹砂巍巍 Wordless Cliffs” by HOYO-MiX on “原神-千岩旷望',
    )
    expect(prompt).not.toContain('Not Anywhere')
    expect(llm.asked[0]!.system).toContain('Never write a name that is not in what was found')
  })

  it('looks on the web for songs no catalogue has, and leaves those unticked', async () => {
    const llm = scriptedLlm({
      'tidy-web': [
        {
          edits: [{ n: 1, field: 'title', to: '无处可寻', why: 'Game wiki' }],
          say: 'Found on a game wiki.',
        },
      ],
    })
    const result = await askedTidy(
      { llm, songs: () => [], findNames, web: () => true },
      {
        text: 'official Chinese names',
        songs: [lost],
        unknown: [],
        lookUp: true,
      },
    )
    expect(result.changes).toEqual([
      expect.objectContaining({
        field: 'title',
        to: '无处可寻',
        by: 'model',
        why: 'Found on the web',
      }),
    ])
    expect(result.note).toMatch(/the web was searched instead/)
    // The names pass said nothing, so the web pass's words are the one thing said.
    expect(result.reply).toBe('Found on a game wiki.')
    expect(llm.asked.map(each => each.task)).toEqual(['tidy-web'])
    expect(llm.asked[0]!.webSearch).toBe(true)
  })

  it('looks up only the songs that still need it, when there are many', async () => {
    const many = Array.from({ length: 61 }, (_, index) =>
      song(index + 1, {
        title: index === 1 ? 'Wordless Cliffs' : `第${index + 1}首`,
        album: 'OST',
      }),
    )
    const looked: number[] = []
    const llm = scriptedLlm({ 'tidy-sort': [{ n: [2] }] })
    const result = await askedTidy(
      {
        llm,
        songs: () => [],
        findNames: async each => {
          looked.push(each.id)
          return []
        },
      },
      { text: '英文的换成官方中文名', songs: many, unknown: [], lookUp: true },
    )
    expect(looked).toEqual([2])
    expect(result.looked).toBe(61)
  })

  it('asks the model nothing when no song was found', async () => {
    const llm = scriptedLlm({})
    const result = await askedTidy(
      { llm, songs: () => [], findNames },
      {
        text: 'official names',
        songs: [lost],
        unknown: [],
        lookUp: true,
      },
    )
    expect(result.changes).toEqual([])
    expect(llm.asked).toHaveLength(0)
  })
})
