import { describe, expect, it } from 'vitest'
import type { Song } from '@selfmp3/shared'
import { endpointLlm, song } from './fixtures/library.js'
import { fillGaps } from './fill.js'
import type { Listing } from './names.js'
import { gapsIn } from './tidy.js'

const RUN = song(1, { title: '夜に駆ける', artist: 'YOASOBI', duration: 261 })
const SECOND = song(2, {
  title: 'アポリア',
  artist: 'ヨルシカ',
  album: 'second person',
  hasArt: true,
  duration: 230,
})
const WHOLE = song(3, {
  title: 'アイドル',
  artist: 'YOASOBI',
  album: 'アイドル',
  year: 2023,
  hasArt: true,
})
const UNKNOWN = song(4, { title: 'Untitled demo', artist: 'Nobody', album: 'Demos', hasArt: true })

const listing = (over: Partial<Listing>): Listing => ({
  source: 'iTunes',
  title: 'x',
  artist: 'x',
  album: '',
  year: null,
  cover: null,
  ...over,
})

const LISTINGS = new Map<number, Listing[]>([
  [
    1,
    [
      listing({
        source: '网易云',
        title: '夜に駆ける',
        artist: 'YOASOBI',
        album: 'THE BOOK',
        cover: 'https://p1.music.126.net/book.jpg',
      }),
      listing({
        title: '夜に駆ける',
        artist: 'YOASOBI',
        album: '夜に駆ける - Single',
        year: 2019,
        cover: 'https://is1.mzstatic.com/single.jpg',
      }),
      listing({
        source: 'MusicBrainz',
        title: '夜に駆ける',
        artist: 'YOASOBI',
        album: 'THE BOOK',
        year: 2021,
      }),
    ],
  ],
  [2, [listing({ title: 'アポリア', artist: 'ヨルシカ', album: 'second person', year: 2023 })]],
])

const findListings = async (each: Song): Promise<Listing[]> => {
  looked.push(each.id)
  return LISTINGS.get(each.id) ?? []
}
let looked: number[] = []

const describeChange = (c: {
  field: string
  to: string
  songIds: number[]
  why: string
  by: string
}) => `${c.field}|${c.to}|${c.songIds.join(',')}|${c.why}|${c.by}`

describe('filling in what is missing', () => {
  it('takes what the listings agree on, and asks the model only where they differ', async () => {
    looked = []
    const llm = endpointLlm({ 'tidy-fill': [{ fills: [{ n: 1, album: 2, year: 2 }] }] })

    const result = await fillGaps(
      { llm, findListings },
      [RUN, SECOND, WHOLE, UNKNOWN],
      'fill in what’s missing',
    )

    // The song with nothing missing is not looked up; the one without a year is, and is not found.
    expect(looked.sort()).toEqual([1, 2, 4])
    expect(result.note).toBe('1 song wasn’t found in the catalogues, so it stays as it is.')
    expect(result.changes.map(describeChange)).toEqual([
      'album|夜に駆ける - Single|1|From iTunes|model',
      'year|2019|1|From iTunes|model',
      'year|2023|2|From iTunes|rule',
      // The cover follows the album the model chose, from the listing on it.
      'cover|https://is1.mzstatic.com/single.jpg|1|From iTunes|model',
    ])
    expect(result.changes.every(each => each.from === '')).toBe(true)
    expect(result).toMatchObject({ looked: 4, asked: 'fill in what’s missing', gaps: null })
    // Only the song whose listings differ went to the model, with its listings numbered.
    const [prompt] = llm.prompts['tidy-fill']!
    expect(prompt).toContain('1 | 夜に駆ける | YOASOBI | album: missing | year: missing | 261 s')
    expect(prompt).toContain(
      'listing 2 | iTunes | 夜に駆ける | YOASOBI | 夜に駆ける - Single | 2019',
    )
    expect(prompt).not.toContain('アポリア')
  })

  it('says how many were not found', async () => {
    const llm = endpointLlm({})
    const result = await fillGaps(
      { llm, findListings },
      [SECOND, song(5, { title: 'Lost', hasArt: true, album: 'A' })],
      'fill in the years',
    )
    expect(result.changes.map(describeChange)).toEqual(['year|2023|2|From iTunes|rule'])
    expect(result.note).toBe('1 song wasn’t found in the catalogues, so it stays as it is.')
    expect(llm.prompts['tidy-fill']).toBeUndefined()
  })

  it('keeps what the catalogues agree on when the model is away', async () => {
    const llm = endpointLlm({ 'tidy-fill': [502] })
    const result = await fillGaps({ llm, findListings }, [RUN, SECOND], 'fill in what’s missing')
    expect(result.changes.map(describeChange)).toEqual(['year|2023|2|From iTunes|rule'])
    expect(result.note).toMatch(/couldn’t reach the model\. Where the catalogues disagree/)
  })

  it('takes nothing the model makes up: a listing not shown, or a field not missing', async () => {
    const llm = endpointLlm({
      'tidy-fill': [
        {
          fills: [
            { n: 1, album: 9, year: null },
            { n: 7, album: 1, year: 1 },
          ],
        },
      ],
    })
    const result = await fillGaps({ llm, findListings }, [RUN], 'fill in what’s missing')
    expect(result.changes).toEqual([])
  })

  it('looks nothing up when nothing is missing', async () => {
    looked = []
    const result = await fillGaps({ llm: endpointLlm({}), findListings }, [WHOLE], 'fill it in')
    expect(looked).toEqual([])
    expect(result.note).toBe('It has an album, a year and a cover already.')
  })

  it('counts what a checkup lists', () => {
    expect(gapsIn([RUN, SECOND, WHOLE, UNKNOWN])).toEqual({ songs: 3, album: 1, year: 3, cover: 1 })
  })
})
