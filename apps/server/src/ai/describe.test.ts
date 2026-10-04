import { describe as group, expect, it } from 'vitest'
import type { Understanding } from '@selfmp3/shared'
import { describe, groundPicks, narrowAndPick, songsFitting } from './describe.js'
import { AskProgress } from './progress.js'
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
  year: { min: null, max: null },
  words: null,
  loved: null,
  playedWithinDays: null,
  notPlayedWithinDays: null,
  addedWithinDays: null,
  size: null,
  minutes: null,
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

  it('keeps the songs from the years asked for, and none without a year', () => {
    const early20s = { ...nothing, anyTags: ['jpop', '原神纯音乐'], year: { min: 2020, max: 2021 } }
    expect(ids(songsFitting(SONGS, TAGS, early20s, NOW))).toEqual([4, 5, 8])
    const upTo2025 = { ...nothing, year: { min: null, max: 2025 } }
    expect(ids(songsFitting(SONGS, TAGS, upTo2025, NOW))).toEqual([4, 5, 6, 7, 8, 9])
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

  it('lets the years go when the library has none of them', async () => {
    const llm = scriptedLlm({
      'describe-plan': [{ ...nothing, anyTags: ['jpop'], year: { min: 1990, max: 1999 } }],
    })
    const result = await describe(deps(llm), { text: '90s jpop', understanding: null })

    expect(result.loosened).toEqual(['the years'])
    expect(result.fit).toBe(3)
  })

  it('picks around the songs it showed before, while others fit', async () => {
    const llm = scriptedLlm({})
    const parts = { ...nothing, anyTags: ['jpop'] }
    const first = await describe(deps(llm), { text: 'jpop', understanding: parts, avoid: [] })
    const shown = first.picks.map(pick => pick.songId)
    const again = await describe(deps(llm), {
      text: 'jpop',
      understanding: parts,
      avoid: shown.slice(0, 2),
    })
    expect(again.picks.map(pick => pick.songId)).toEqual(shown.slice(2))
    // Every one shown: nothing else fits, so they come back rather than nothing.
    const all = await describe(deps(llm), { text: 'jpop', understanding: parts, avoid: shown })
    expect(all.picks.map(pick => pick.songId)).toEqual(shown)
  })

  it('fills a length asked for, though the model stops short of it', async () => {
    // Every song here is 3 min 20 s: twenty minutes is six of them.
    const llm = scriptedLlm({
      'describe-pick': [
        {
          picks: [
            { n: 1, why: 'a' },
            { n: 2, why: 'b' },
          ],
        },
        { picks: [] },
      ],
    })
    const result = await narrowAndPick(
      deps(llm),
      'calm, twenty minutes',
      { ...nothing, minutes: 20, brief: 'calm' },
      [],
    )
    expect(result.picks).toHaveLength(6)
    expect(new Set(result.picks.map(pick => pick.songId)).size).toBe(6)
    // Asked once, then once more for the rest; the rest was made up without it.
    expect(llm.asked.map(request => request.task)).toEqual(['describe-pick', 'describe-pick'])
    expect(String(llm.asked[1]?.prompt)).toContain('Choose up to 4 songs.')
  })

  it('takes every song that fits when they all fit in the length', async () => {
    const llm = scriptedLlm({})
    const jpop = { ...nothing, anyTags: ['jpop'], minutes: 120 }
    const result = await narrowAndPick(deps(llm), 'two hours of jpop', jpop, [])
    expect(result.picks).toHaveLength(3)
    expect(llm.asked).toHaveLength(0)
  })

  it('says each stage as it goes, with what it found', async () => {
    const progress = new AskProgress()
    const steps = progress.track('ticket-123456')
    const parts = { ...nothing, anyTags: ['jpop'] }
    await narrowAndPick(deps(scriptedLlm({})), 'jpop', parts, [], [], steps)
    expect(progress.steps('ticket-123456')).toEqual([{ text: '3 songs fit', done: true }])
    expect(progress.steps('someone-else')).toEqual([])
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

  it('gives the spread of years by decade', () => {
    expect(libraryShape(SONGS, TAGS)).toContain(
      'Years (when each came out) are known for 6: 2020–2024, a quarter before 2020, half before 2023. By decade: 2020s 6.',
    )
  })

  it('numbers the table from one', () => {
    const table = songTable(SONGS.slice(3, 5), TAGS, NOW)
    expect(table.split('\n')[0]).toMatch(
      /^#1 \| Dream Aria \| Yu-Peng Chen, HOYO-MiX \| .* \| 2020 \| 原神纯音乐 \| energy 0\.37 \| 123 bpm \| 3:20 \| no words \| 1 plays, played 2d ago$/,
    )
  })
})
