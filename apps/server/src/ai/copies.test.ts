import { describe, expect, it } from 'vitest'
import { candidateGroups, findCopies, keeper, titleKey } from './copies.js'
import { endpointLlm, song } from './fixtures/library.js'

const SONGS = [
  // Imported twice, nothing between them.
  song(1, { title: 'アイドル', artist: 'YOASOBI', album: 'アイドル', duration: 213, playCount: 5 }),
  song(2, { title: 'アイドル', artist: 'YOASOBI', album: 'アイドル', duration: 213.4 }),
  // One theme kept on two soundtracks: never looked at, though they sound the same.
  song(3, { title: 'Theme', artist: 'HOYO-MiX', album: 'OST A', duration: 180 }),
  song(4, { title: 'Theme', artist: 'HOYO-MiX', album: 'OST B', duration: 180 }),
  // An arrangement a minute longer: never looked at.
  song(5, { title: 'Liyue', artist: 'HOYO-MiX', duration: 200 }),
  song(6, { title: 'Liyue (Orchestral)', artist: 'HOYO-MiX', duration: 260 }),
  // A live take as long as the studio one.
  song(7, { title: 'Song (Live)', artist: 'Band', duration: 240 }),
  song(8, { title: 'Song', artist: 'Band', duration: 241 }),
  // Named two ways, sounding the same.
  song(9, { title: 'Yoru ni Kakeru', artist: 'YOASOBI', duration: 261, sizeBytes: 9_000_000 }),
  song(10, { title: '夜に駆ける', artist: 'YOASOBI', duration: 261, sizeBytes: 4_000_000 }),
  // As long as each other, sounding different.
  song(11, { title: 'Rain', artist: 'A', duration: 261 }),
  // Another take on its own single, as long as the album's one.
  song(12, { title: 'Hello', artist: 'C', album: 'Album', duration: 190 }),
  song(13, { title: 'Hello (Single Version)', artist: 'C', duration: 190 }),
]

/** The listening model: 9 and 10 sound alike, and so do 3 and 4; everything else apart. */
const sound = {
  closeTo(seed: number, ids: readonly number[]) {
    const alike = (a: number, b: number) =>
      [new Set([9, 10]), new Set([3, 4])].some(pair => pair.has(a) && pair.has(b))
    return new Map(ids.map(id => [id, alike(seed, id) ? 0.99 : 0.6]))
  },
}

describe('songs you have twice', () => {
  it('sets aside what is in brackets when comparing titles', () => {
    expect(titleKey('Song (Live)')).toBe(titleKey('song'))
    expect(titleKey('【MV】')).toBe('mv')
  })

  it('finds the songs that might be one recording, by name and length or by sound', () => {
    const all = new Set(SONGS.map(each => each.id))
    const { groups } = candidateGroups(SONGS, all, sound)
    expect(groups.map(group => group.map(each => each.id))).toEqual([
      [1, 2],
      [7, 8],
      [9, 10],
      [12, 13],
    ])
    // Only groups with a song asked about.
    expect(candidateGroups(SONGS, new Set([7]), sound).groups).toHaveLength(1)
  })

  it('keeps the copy with the most plays, then the bigger file', () => {
    expect(keeper([SONGS[1]!, SONGS[0]!]).id).toBe(1)
    expect(keeper([SONGS[9]!, SONGS[8]!]).id).toBe(9)
  })

  it('counts exact copies itself, and leaves the model to tell copies from versions', async () => {
    const llm = endpointLlm({
      'tidy-copies': [
        {
          groups: [
            { g: 1, same: [], why: 'Live and studio' },
            { g: 2, same: [[1, 2]], why: 'Same song, title romanised' },
            { g: 3, same: [], why: 'Another take' },
            // A group that was never shown.
            { g: 9, same: [[1, 2]], why: 'x' },
          ],
        },
      ],
    })
    const result = await findCopies({ llm, songs: () => SONGS, sound }, SONGS)
    expect(result.copies.map(c => `${c.keep}|${c.songIds.join(',')}|${c.why}|${c.by}`)).toEqual([
      '1|2|The same song, twice|rule',
      '9|10|Same song, title romanised|model',
    ])
    expect(result).toMatchObject({ looked: SONGS.length, note: null })
    const [prompt] = llm.prompts['tidy-copies']!
    expect(prompt).toContain('Group 1\n 1 | Song (Live) | Band | - |')
    // The theme on two soundtracks never went to the model.
    expect(prompt).not.toContain('OST A')
    expect(prompt).toContain(
      ' 2 | 夜に駆ける | YOASOBI | - | - | 4:21 | m4a 4.0 MB | added 2026-09-01 | 0 plays | sound 99',
    )
    // The exact copies never went to the model.
    expect(prompt).not.toContain('アイドル')
  })

  it('still offers the exact copies when the model is away, and says what is left', async () => {
    const llm = endpointLlm({ 'tidy-copies': [429] })
    const result = await findCopies({ llm, songs: () => SONGS, sound }, SONGS)
    expect(result.copies.map(c => c.keep)).toEqual([1])
    expect(result.note).toMatch(/over its limit.*3 groups of songs that look alike need the model/)
  })
})
