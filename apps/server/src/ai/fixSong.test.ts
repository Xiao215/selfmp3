import { describe, expect, it } from 'vitest'
import type { MetadataCandidate } from '@selfmp3/shared'
import { fixSong, type FixSongDeps } from './fixSong.js'
import { scriptedLlm, song } from './fixtures/library.js'
import { LlmError, Remembered } from './llm.js'
import type { FoundName } from './names.js'

const IDOL = song(1, {
  title: 'YOASOBI「アイドル」 Official Music Video',
  artist: 'Ayase / YOASOBI',
  album: '',
  path: 'YOASOBI - アイドル/YOASOBI「アイドル」 Official Music Video.m4a',
  sourceUrl: 'https://www.youtube.com/watch?v=ZRtdQ81jPUQ',
  duration: 213,
})

const LISTED: MetadataCandidate[] = [
  {
    source: 'itunes',
    title: 'アイドル',
    artist: 'YOASOBI',
    album: 'アイドル - Single',
    year: 2023,
    trackNo: 1,
    durationSec: 213,
    artworkUrl: 'https://example.com/idol.jpg',
    score: 0.82,
  },
]

const FOUND: FoundName[] = [
  { source: '网易云', title: 'アイドル', artist: 'YOASOBI', album: 'アイドル' },
]

function depsWith(replies: unknown[], over: Partial<FixSongDeps> = {}) {
  const llm = scriptedLlm({ 'fix-song': replies })
  const deps: FixSongDeps = {
    llm,
    remembered: new Remembered(),
    lookup: async () => LISTED,
    findNames: async () => FOUND,
    ...over,
  }
  return { deps, llm }
}

const reply = (over: Record<string, unknown> = {}) => ({
  title: 'アイドル',
  artist: 'YOASOBI',
  album: 'アイドル - Single',
  albumArtist: 'YOASOBI',
  year: 2023,
  agrees: 0,
  why: 'The title was the video’s; iTunes and 网易云 list it as アイドル by YOASOBI.',
  ...over,
})

describe('fixSong', () => {
  it('suggests the listed names, the listing it follows, and that listing’s cover', async () => {
    const { deps, llm } = depsWith([reply()])
    const answer = await fixSong(deps, IDOL)
    expect(answer.suggestion).toMatchObject({
      source: 'ai',
      title: 'アイドル',
      artist: 'YOASOBI',
      album: 'アイドル - Single',
      albumArtist: 'YOASOBI',
      year: 2023,
      trackNo: 1,
      artworkUrl: 'https://example.com/idol.jpg',
    })
    expect(answer.agrees).toBe(0)
    expect(answer.dropped).toEqual([])
    expect(answer.candidates).toEqual(LISTED)
    // What it read: the song's file and link, the listing, and 网易云's name.
    const prompt = llm.asked[0]?.prompt ?? ''
    expect(prompt).toContain('YOASOBI - アイドル/')
    expect(prompt).toContain('watch?v=ZRtdQ81jPUQ')
    expect(prompt).toContain('0 | アイドル | YOASOBI | アイドル - Single')
    expect(prompt).toContain('网易云 | アイドル | YOASOBI')
  })

  it('puts back a name found nowhere, and says which', async () => {
    const { deps } = depsWith([reply({ title: 'Idol (English Version)', artist: 'YOASOBI' })])
    const answer = await fixSong(deps, IDOL)
    expect(answer.suggestion?.title).toBe(IDOL.title)
    expect(answer.suggestion?.artist).toBe('YOASOBI')
    expect(answer.dropped).toEqual(['title'])
  })

  it('takes a credit made of names from different places', async () => {
    const { deps } = depsWith([reply({ artist: 'YOASOBI, Ayase' })])
    const answer = await fixSong(deps, IDOL)
    expect(answer.suggestion?.artist).toBe('YOASOBI, Ayase')
    expect(answer.dropped).toEqual([])
  })

  it('keeps only a year a listing gives', async () => {
    const { deps } = depsWith([reply({ year: 1999 })])
    const answer = await fixSong(deps, IDOL)
    expect(answer.suggestion?.year).toBeUndefined()
    expect(answer.dropped).toEqual(['year'])
  })

  it('ignores a listing number that is not one', async () => {
    const { deps } = depsWith([reply({ agrees: 7 })])
    const answer = await fixSong(deps, IDOL)
    expect(answer.agrees).toBeNull()
    expect(answer.suggestion?.artworkUrl).toBeUndefined()
  })

  it('says the song looks right when nothing would change', async () => {
    const right = song(2, { title: 'アイドル', artist: 'YOASOBI', duration: 213 })
    const { deps } = depsWith([
      reply({ album: '', albumArtist: '', year: null, agrees: null, why: 'It already matches.' }),
    ])
    const answer = await fixSong(deps, right)
    expect(answer.suggestion).toBeNull()
    expect(answer.why).toBe('It already matches.')
  })

  it('works from 网易云 alone when iTunes and MusicBrainz have nothing', async () => {
    const { deps, llm } = depsWith([reply({ album: 'アイドル', year: null, agrees: null })], {
      lookup: async () => [],
    })
    const answer = await fixSong(deps, IDOL)
    expect(answer.suggestion).toMatchObject({ title: 'アイドル', album: 'アイドル' })
    expect(llm.asked[0]?.prompt).toContain('none matched on iTunes or MusicBrainz')
  })

  it('asks once for the same question, and afresh when asked again', async () => {
    const { deps, llm } = depsWith([reply(), reply({ why: 'Second look.' })])
    await fixSong(deps, IDOL)
    await fixSong(deps, IDOL)
    expect(llm.asked).toHaveLength(1)
    const fresh = await fixSong(deps, IDOL, true)
    expect(fresh.why).toBe('Second look.')
    expect(llm.asked).toHaveLength(2)
  })

  it('sends the person’s standing preferences with the question', async () => {
    const { deps, llm } = depsWith([reply()], { notes: () => ['Song names in Chinese only'] })
    await fixSong(deps, IDOL)
    expect(llm.asked[0]?.prompt).toContain('Song names in Chinese only')
  })

  it('lets a model that is off say so', async () => {
    const { deps } = depsWith([new LlmError('off', 'no model')])
    await expect(fixSong(deps, IDOL)).rejects.toMatchObject({ kind: 'off' })
  })
})
