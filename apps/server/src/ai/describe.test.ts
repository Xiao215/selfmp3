import { describe as group, expect, it } from 'vitest'
import type { Understanding } from '@selfmp3/shared'
import { describe, groundPicks, songsFitting } from './describe.js'
import { SONGS, TAGS, scriptedLlm } from './fixtures/library.js'
import { creditNames, libraryShape, songTable } from './library.js'

const NOW = Date.parse('2026-10-03T12:00:00Z')

const nothing: Understanding = {
  name: 'Test',
  anyTags: [],
  artists: [],
  noTags: [],
  energy: { min: null, max: null },
  bpm: { min: null, max: null },
  words: null,
  loved: null,
  playedWithinDays: null,
  notPlayedWithinDays: null,
  addedWithinDays: null,
  size: null,
  brief: null,
}

const deps = (llm: ReturnType<typeof scriptedLlm>) => ({
  llm,
  songs: () => SONGS,
  tags: () => TAGS,
  now: () => NOW,
})

const ids = (songs: { id: number }[]) => songs.map(song => song.id)

group('songsFitting', () => {
  it('lets in songs from any of the places, then narrows', () => {
    const calm = { ...nothing, anyTags: ['古典', '原神纯音乐'], energy: { min: null, max: 0.45 } }
    expect(ids(songsFitting(SONGS, TAGS, calm, NOW))).toEqual([1, 2, 4])
  })

  it('counts an artist anywhere in a credit as a place', () => {
    const chopin = { ...nothing, artists: ['frédéric chopin'] }
    expect(ids(songsFitting(SONGS, TAGS, chopin, NOW))).toEqual([1, 2, 3])
  })

  it('keeps never-played songs when leaving out the recently played', () => {
    const fresh = { ...nothing, anyTags: ['原神纯音乐'], notPlayedWithinDays: 7 }
    expect(ids(songsFitting(SONGS, TAGS, fresh, NOW))).toEqual([5, 6])
  })

  it('leaves out a song not yet analysed when energy is asked for', () => {
    const quiet = { ...nothing, energy: { min: null, max: 0.9 } }
    expect(ids(songsFitting(SONGS, TAGS, quiet, NOW))).not.toContain(13)
  })

  it('splits words from no words', () => {
    const words = { ...nothing, anyTags: ['jpop', '古典'], words: 'with' as const }
    expect(ids(songsFitting(SONGS, TAGS, words, NOW))).toEqual([7, 8, 9])
  })
})

group('describe', () => {
  it('plans, narrows and picks, and keeps only picks that are in the table', async () => {
    const llm = scriptedLlm({
      'describe-plan': [
        {
          ...nothing,
          name: 'Rain',
          anyTags: ['古典', '原神纯音乐', 'Lo-fi'],
          brief: 'sounds like rain',
        },
      ],
      'describe-pick': [
        {
          picks: [
            { n: 2, why: 'named for rain' },
            { n: 2, why: 'again' },
            { n: 99, why: 'made up' },
            { n: 1, why: 'slow and quiet' },
          ],
        },
      ],
    })

    const result = await describe(deps(llm), { text: 'sounds like rain', understanding: null })

    expect(result.understanding.anyTags).toEqual(['古典', '原神纯音乐'])
    expect(result.unknown).toEqual(['Lo-fi'])
    expect(result.fit).toBe(6)
    expect(result.picks).toHaveLength(2)
    expect(result.picks.map(pick => pick.why)).toEqual(['named for rain', 'slow and quiet'])
    // The plan saw the library's shape, never a song table.
    expect(llm.asked[0]!.prompt).toContain('原神纯音乐')
    expect(llm.asked[0]!.prompt).not.toContain('#1 |')
    expect(llm.asked[1]!.tier).toBe('smart')
  })

  it('takes every song that fits, with no pick, when nothing more is wanted', async () => {
    const llm = scriptedLlm({
      'describe-plan': [{ ...nothing, name: 'YOASOBI', artists: ['yoasobi'] }],
    })
    const result = await describe(deps(llm), { text: 'YOASOBI', understanding: null })

    expect(result.understanding.artists).toEqual(['YOASOBI'])
    expect(result.picks).toEqual([
      { songId: 7, why: null },
      { songId: 8, why: null },
    ])
    expect(llm.asked).toHaveLength(1)
  })

  it('loosens one part at a time when together they let nothing in', async () => {
    const llm = scriptedLlm({
      'describe-plan': [
        { ...nothing, anyTags: ['jpop'], energy: { min: null, max: 0.2 }, words: 'with' },
      ],
    })
    const result = await describe(deps(llm), { text: 'calm jpop', understanding: null })

    expect(result.loosened).toEqual(['the energy'])
    expect(result.understanding.energy).toEqual({ min: null, max: null })
    expect(result.understanding.words).toBe('with')
    expect(result.fit).toBe(3)
  })

  it('skips the plan when the device sends the parts back', async () => {
    const llm = scriptedLlm({})
    const parts = { ...nothing, anyTags: ['jpop'] }
    const result = await describe(deps(llm), { text: 'jpop', understanding: parts })
    expect(result.fit).toBe(3)
    expect(llm.asked).toHaveLength(0)
  })
})

group('groundPicks', () => {
  it('stops at the size asked for', () => {
    const table = SONGS.slice(0, 3)
    const picks = groundPicks(
      [
        { n: 1, why: 'a' },
        { n: 2, why: 'b' },
        { n: 3, why: ' ' },
      ],
      table,
      2,
    )
    expect(picks).toEqual([
      { songId: 1, why: 'a' },
      { songId: 2, why: 'b' },
    ])
  })
})

group('library', () => {
  it('reads one name per person from a credit', () => {
    expect(creditNames('薛之谦, 薛之谦, 薛之谦')).toEqual(['薛之谦'])
    expect(creditNames('Yu-Peng Chen, HOYO-MiX')).toEqual(['Yu-Peng Chen', 'HOYO-MiX'])
    expect(creditNames('A feat. B')).toEqual(['A', 'B'])
  })

  it('describes each tag by what it holds', () => {
    const shape = libraryShape(SONGS, TAGS)
    expect(shape).toContain(
      '- 古典 · 3 songs · by Henrik Måwe 2, Vitaly Margulis 1 · albums Best of Chopin 3',
    )
    expect(shape).toContain('17 songs')
  })

  it('numbers the table from one', () => {
    const table = songTable(SONGS.slice(3, 5), TAGS, NOW)
    expect(table.split('\n')[0]).toMatch(
      /^#1 \| Dream Aria \| Yu-Peng Chen, HOYO-MiX \| .* \| 原神纯音乐 \| energy 0\.37 \| 123 bpm \| 3:20 \| no words \| 1 plays, played 2d ago$/,
    )
  })
})
