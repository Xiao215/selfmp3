import { describe as group, expect, it } from 'vitest'
import { NO_JOINS, type Understanding } from '@selfmp3/shared'
import { describe, groundPicks, groundPlan, narrowAndPick, songsFitting } from './describe.js'
import { Remembered } from './llm.js'
import { AskProgress } from './progress.js'
import { SONGS, TAGS, scriptedLlm } from './fixtures/library.js'
import { libraryShape, songTable } from './library.js'

const NOW = Date.parse('2026-10-03T12:00:00Z')

const nothing: Understanding = {
  name: 'Test',
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

  it('counts an album as a place, every song on it in', () => {
    const album = { ...nothing, albums: ['七里香'] }
    expect(ids(songsFitting(SONGS, TAGS, album, NOW))).toEqual([14, 15])
    const widened = { ...album, artists: ['YOASOBI'] }
    expect(ids(songsFitting(SONGS, TAGS, widened, NOW))).toEqual([7, 8, 14, 15])
  })
})

group('groundPlan', () => {
  it('spells an album the library’s way and sets aside one it lacks', () => {
    const { understanding, unknown } = groundPlan(
      { ...nothing, albums: ['best of CHOPIN', 'Jukebox'] },
      SONGS,
      TAGS,
      NO_JOINS,
    )
    expect(understanding.albums).toEqual(['Best of Chopin'])
    expect(unknown).toEqual(['Jukebox'])
  })

  it('reads an empty sound or brief as none', () => {
    const { understanding } = groundPlan(
      { ...nothing, sound: '', brief: '  ' },
      SONGS,
      TAGS,
      NO_JOINS,
    )
    expect(understanding).toMatchObject({ sound: null, brief: null })
  })

  it('keeps an artist the library lacks as a wish when no place asked for is here', () => {
    const lacking = groundPlan({ ...nothing, artists: ['Taylor Swift'] }, SONGS, TAGS, NO_JOINS)
    expect(lacking.understanding.brief).toBe('by or from Taylor Swift')
    expect(lacking.unknown).toEqual(['Taylor Swift'])
    const alongside = groundPlan(
      { ...nothing, artists: ['Taylor Swift', 'yoasobi'] },
      SONGS,
      TAGS,
      NO_JOINS,
    )
    expect(alongside.understanding).toMatchObject({ artists: ['YOASOBI'], brief: null })
  })

  it('finds an artist under another script, another name or a slip of a letter, never calling it missing', () => {
    const names = { artistNames: { 周杰倫: ['Jay Chou'] }, artistNamesFound: [] }
    const { understanding, unknown } = groundPlan(
      { ...nothing, artists: ['周杰伦', 'jay chou', 'Yorushka', 'Taylor Swift'] },
      SONGS,
      TAGS,
      names,
    )
    expect(understanding.artists).toEqual(['周杰倫', 'Yorushika'])
    expect(unknown).toEqual(['Taylor Swift'])
  })

  it('takes both spellings of one artist the library holds apart, when they name each other', () => {
    const songs = [
      ...SONGS,
      { ...SONGS[0]!, id: 98, artist: 'Kenshi Yonezu' },
      { ...SONGS[0]!, id: 99, artist: '米津玄師' },
    ]
    const names = {
      artistNames: { 'kenshi yonezu': ['米津玄師'], 米津玄師: ['Kenshi Yonezu'] },
      artistNamesFound: ['kenshi yonezu', '米津玄師'],
    }
    const { understanding, unknown } = groundPlan(
      { ...nothing, artists: ['米津玄师'] },
      songs,
      TAGS,
      names,
    )
    expect([...understanding.artists].sort()).toEqual(['Kenshi Yonezu', '米津玄師'])
    expect(unknown).toEqual([])
  })

  it('takes an album or tag spelt in the other Chinese script', () => {
    const { understanding, unknown } = groundPlan(
      { ...nothing, albums: ['叶惠美'] },
      SONGS,
      TAGS,
      NO_JOINS,
    )
    expect(understanding.albums).toEqual(['葉惠美'])
    expect(unknown).toEqual([])
  })

  it('leaves a near spelling that fits two names unresolved', () => {
    const { understanding } = groundPlan(
      { ...nothing, artists: ['Henrik Mawe'] },
      [
        ...SONGS,
        { ...SONGS[0]!, id: 99, artist: 'Henrik Mawes' },
        { ...SONGS[0]!, id: 98, artist: 'Henrik Mawet' },
      ],
      TAGS,
      NO_JOINS,
    )
    // Folded, "Henrik Måwe" is the same name: that one answers alone.
    expect(understanding.artists).toEqual(['Henrik Måwe'])
    const two = groundPlan(
      { ...nothing, artists: ['Henrik Mawex'] },
      [...SONGS, { ...SONGS[0]!, id: 99, artist: 'Henrik Mawes' }],
      TAGS,
      NO_JOINS,
    )
    expect(two.unknown).toEqual(['Henrik Mawex'])
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

  it('passes over resting songs, while any other song fits', async () => {
    const yoasobi = { ...nothing, artists: ['YOASOBI'] }
    const until = new Date(NOW + 86_400_000).toISOString()
    const resting = (rest: readonly number[]) => ({
      ...deps(scriptedLlm({})),
      songs: () =>
        SONGS.map(song => (rest.includes(song.id) ? { ...song, restUntil: until } : song)),
    })
    const one = await narrowAndPick(resting([7]), 'YOASOBI', yoasobi, [])
    expect(one.picks.map(pick => pick.songId)).toEqual([8])
    // Both resting: they come back rather than nothing.
    const both = await narrowAndPick(resting([7, 8]), 'YOASOBI', yoasobi, [])
    expect(both.picks.map(pick => pick.songId)).toEqual([7, 8])
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
    expect(progress.seen('ticket-123456').steps).toEqual([{ text: '3 songs fit', done: true }])
    expect(progress.seen('someone-else').steps).toEqual([])
  })

  it('orders the songs by how they sound and takes the best, with no pick, when that is all it wants', async () => {
    const llm = scriptedLlm({})
    // The listening model hears song 5 as the most "calm", then 1, then 2.
    const heard = new Map([
      [5, 0.3],
      [1, 0.28],
      [2, 0.25],
    ])
    const sound = {
      match: (_text: string, ids: readonly number[]) =>
        Promise.resolve(new Map(ids.filter(id => heard.has(id)).map(id => [id, heard.get(id)!]))),
      closeTo: () => null,
    }
    const calm = { ...nothing, sound: 'calm orchestral music', size: 2 }
    const result = await narrowAndPick({ ...deps(llm), sound }, 'calm', calm, [])
    expect(result.picks.map(pick => pick.songId)).toEqual([5, 1])
    expect(llm.asked).toHaveLength(0)
  })

  it('keeps only the songs that sound like it, rather than padding the answer out', async () => {
    const llm = scriptedLlm({})
    // Two songs have the violin; the rest are well below them.
    const scores = new Map([
      [1, 0.29],
      [2, 0.25],
      [3, 0.12],
      [4, 0.1],
      [5, 0.08],
    ])
    const sound = {
      match: (_text: string, ids: readonly number[]) =>
        Promise.resolve(new Map(ids.filter(id => scores.has(id)).map(id => [id, scores.get(id)!]))),
      closeTo: () => null,
    }
    const violin = { ...nothing, sound: 'solo violin' }
    const result = await narrowAndPick({ ...deps(llm), sound }, 'violin songs', violin, [])
    expect(result.picks.map(pick => pick.songId)).toEqual([1, 2])
    expect(result.fit).toBe(2)
    expect(llm.asked).toHaveLength(0)
  })

  it('only orders the songs of the tags asked for by how they sound, never leaving one', async () => {
    const llm = scriptedLlm({})
    // "比较温和的jpop": song 8 stands well above the other jpop for "calm".
    const scores = new Map([
      [7, 0.18],
      [8, 0.3],
      [9, 0.2],
    ])
    const sound = {
      match: (_text: string, ids: readonly number[]) =>
        Promise.resolve(new Map(ids.filter(id => scores.has(id)).map(id => [id, scores.get(id)!]))),
      closeTo: () => null,
    }
    const calmJpop = { ...nothing, anyTags: ['jpop'], sound: 'calm, soft Japanese pop' }
    const result = await narrowAndPick({ ...deps(llm), sound }, '比较温和的jpop', calmJpop, [])
    expect(result.picks.map(pick => pick.songId)).toEqual([8, 9, 7])
    expect(result.fit).toBe(3)
    expect(llm.asked).toHaveLength(0)
  })

  it('answers a pick of no song with no songs and why, and asks the model again next time', async () => {
    const llm = scriptedLlm({
      'describe-pick': [{ picks: [] }, { picks: [{ n: 1, why: 'rain' }] }, { picks: [] }],
    })
    const both = { ...deps(llm), remembered: new Remembered() }
    const rain = { ...nothing, brief: 'named for rain', minutes: 20 }
    const none = await narrowAndPick(both, 'rain songs', rain, [])
    // Not filled to the length from the songs it turned down.
    expect(none.picks).toEqual([])
    expect(none.notes).toEqual(['None of the 17 songs that fit seemed to be “named for rain”.'])
    expect((await narrowAndPick(both, 'rain songs', rain, [])).picks.length).toBeGreaterThan(0)
  })

  it('says what made the songs fewer: the sound line, resting songs and a size nobody asked for', async () => {
    const until = new Date(NOW + 86_400_000).toISOString()
    const songs = SONGS.map(song => (song.id === 3 ? { ...song, restUntil: until } : song))
    const sound = {
      match: (_text: string, ids: readonly number[]) =>
        Promise.resolve(new Map(ids.map(id => [id, id <= 2 ? 0.3 : 0.1]))),
      closeTo: () => null,
    }
    const violin = { ...nothing, sound: 'solo violin' }
    const result = await narrowAndPick(
      { ...deps(scriptedLlm({})), songs: () => songs, sound },
      'violin',
      violin,
      [],
    )
    expect(result.notes).toEqual([
      'Left out 1 song you’ve set to rest.',
      'Kept the 2 of 16 songs that sound closest to what you described.',
    ])
    const many = Array.from({ length: 30 }, (_, index) => ({
      ...SONGS[6]!,
      id: 100 + index,
    }))
    const all = Array.from({ length: 30 }, (_, index) => ({ n: index + 1, why: 'yes' }))
    const capped = await narrowAndPick(
      { ...deps(scriptedLlm({ 'describe-pick': [{ picks: all }] })), songs: () => many },
      'yoasobi',
      { ...nothing, artists: ['YOASOBI'] },
      [],
    )
    expect(capped.picks).toHaveLength(25)
    expect(capped.notes).toEqual(['No number was asked for, so it stopped at 25.'])
  })

  it('marks the songs inside a place that sound like it, for a pick that keeps only those', async () => {
    const llm = scriptedLlm({ 'describe-pick': [{ picks: [{ n: 1, why: 'erhu' }] }] })
    const sound = {
      match: (_text: string, ids: readonly number[]) =>
        Promise.resolve(new Map(ids.map(id => [id, id === 5 ? 0.3 : 0.1]))),
      closeTo: () => null,
    }
    const parts = {
      ...nothing,
      anyTags: ['原神纯音乐'],
      sound: 'erhu',
      brief: 'only songs with erhu',
    }
    const result = await narrowAndPick({ ...deps(llm), sound }, 'liyue, only erhu', parts, [])
    expect(result.picks.map(pick => pick.songId)).toEqual([5])
    const prompt = String(llm.asked[0]?.prompt)
    expect(prompt).toMatch(/#1 \| Liyue \|[^\n]* \| sound 100 close\n/)
    expect(prompt).toContain('| sound 50\n')
  })

  it('draws the sound line from every song before leaving out the ones shown', async () => {
    // Song 1 and 2 sound like it; 3 only nearly. "Different songs" after 1 is 2, not 2 and 3.
    const scores = new Map([
      [1, 0.3],
      [2, 0.27],
      [3, 0.22],
    ])
    const sound = {
      match: (_text: string, ids: readonly number[]) =>
        Promise.resolve(new Map(ids.map(id => [id, scores.get(id) ?? 0.1]))),
      closeTo: () => null,
    }
    const violin = { ...nothing, sound: 'solo violin' }
    const result = await narrowAndPick(
      { ...deps(scriptedLlm({})), sound },
      'violin',
      violin,
      [],
      [1],
    )
    expect(result.picks.map(pick => pick.songId)).toEqual([2])
  })

  it('only orders the songs of an album asked for by how they sound, too', async () => {
    const sound = {
      match: (_text: string, ids: readonly number[]) =>
        Promise.resolve(new Map(ids.map(id => [id, id === 15 ? 0.3 : 0.1]))),
      closeTo: () => null,
    }
    const calmAlbum = { ...nothing, albums: ['七里香'], sound: 'calm Mandarin pop' }
    const result = await narrowAndPick({ ...deps(scriptedLlm({})), sound }, '七里香', calmAlbum, [])
    expect(result.picks.map(pick => pick.songId)).toEqual([15, 14])
  })

  it('gives the model the best-sounding songs, in that order, with a sound column', async () => {
    const llm = scriptedLlm({ 'describe-pick': [{ picks: [{ n: 1, why: 'calm' }] }] })
    const sound = {
      match: (_text: string, ids: readonly number[]) =>
        Promise.resolve(new Map(ids.map(id => [id, id === 6 ? 0.3 : id === 4 ? 0.27 : 0.25]))),
      closeTo: () => null,
    }
    const parts = { ...nothing, anyTags: ['原神纯音乐'], sound: 'calm', brief: 'for sleeping' }
    const result = await narrowAndPick({ ...deps(llm), sound }, 'calm for sleep', parts, [])
    expect(result.picks.map(pick => pick.songId)).toEqual([6])
    const prompt = String(llm.asked[0]?.prompt)
    expect(prompt).toContain('How it should sound: calm')
    expect(prompt).toContain('| plays | sound):')
    expect(prompt).toMatch(
      /#1 \| [^\n]* \| sound 100 close\n#2 \| [^\n]* \| sound 50 close\n#3 \| [^\n]* \| sound 0 close/,
    )
  })

  it('steers from a song by how close the others sound to it', async () => {
    const llm = scriptedLlm({})
    const sound = {
      match: () => Promise.resolve(null),
      closeTo: (seed: number, ids: readonly number[]) =>
        new Map(ids.filter(id => id !== seed).map(id => [id, id === 3 ? 0.9 : 0.1 * id])),
    }
    const parts = { ...nothing, anyTags: ['古典'], size: 1 }
    const result = await narrowAndPick(
      { ...deps(llm), sound },
      'more like this',
      parts,
      [],
      [],
      undefined,
      1,
    )
    expect(result.picks.map(pick => pick.songId)).toEqual([3])
  })

  it('samples as before when no song has been heard', async () => {
    const llm = scriptedLlm({})
    const sound = { match: () => Promise.resolve(null), closeTo: () => null }
    const parts = { ...nothing, anyTags: ['jpop'], sound: 'upbeat' }
    const result = await narrowAndPick({ ...deps(llm), sound }, 'upbeat jpop', parts, [])
    expect(result.picks).toHaveLength(3)
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
  it('describes each tag by what it holds', () => {
    const shape = libraryShape(SONGS, TAGS)
    expect(shape).toContain(
      '- 古典 · 3 songs · by Henrik Måwe 2, Vitaly Margulis 1 · albums Best of Chopin 3',
    )
    expect(shape).toContain('17 songs')
  })

  it('names the albums of two songs or more, most songs first', () => {
    expect(libraryShape(SONGS, TAGS)).toContain(
      'Albums of two songs or more, most songs first: Best of Chopin 4, 七里香 2',
    )
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
