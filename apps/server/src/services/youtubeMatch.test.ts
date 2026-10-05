import { describe, expect, it } from 'vitest'
import {
  bestMatch,
  durationScore,
  foldForMatch,
  normalizeForMatch,
  scoreHit,
  searchQuery,
  similarAtLeast,
  similarity,
  YouTubeMatcher,
} from './youtubeMatch.js'
import { createLogger } from '../logger.js'
import type { ProbedTrack, SearchHit } from './ytdlp.js'

const hit = (partial: Partial<SearchHit> & { title: string }): SearchHit => ({
  url: `https://www.youtube.com/watch?v=${partial.title.replace(/\W/g, '').slice(0, 11)}`,
  channel: '',
  duration: 0,
  thumbnail: null,
  ...partial,
})

const getLucky = {
  title: 'Get Lucky',
  artist: 'Daft Punk',
  album: 'Random Access Memories',
  duration: 248,
}

describe('normalizeForMatch / similarity', () => {
  it('ignores case, accents, punctuation and ampersands', () => {
    expect(normalizeForMatch('Déjà Vu!')).toBe('deja vu')
    expect(normalizeForMatch('Earth, Wind & Fire')).toBe('earth wind and fire')
    expect(similarity('Beyoncé - Déjà Vu', 'beyonce deja vu')).toBe(1)
  })

  it('scores containment highly and unrelated text low', () => {
    expect(similarity('Get Lucky', 'Daft Punk Get Lucky Official Audio')).toBeGreaterThan(0.8)
    expect(similarity('Get Lucky', 'Around the World')).toBeLessThan(0.4)
    expect(similarity('', 'x')).toBe(0)
  })

  it('answers a threshold exactly as the full score would', () => {
    // The duplicate check's shortcut: the same yes and no, near each cutoff.
    const texts = [
      'Get Lucky',
      'Get Lucky (Live)',
      'Get Luckey',
      'Daft Punk Get Lucky Official Audio',
      'Around the World',
      'YOASOBI',
      'YOASOBI - Topic',
      'ずっと真夜中でいいのに。 ZUTOMAYO',
      'ZUTOMAYO',
      '周杰倫',
      '周杰伦 Jay Chou',
      '晴天',
      '我不曾忘记',
      '忘我',
      '',
    ]
    for (const a of texts) {
      for (const b of texts) {
        for (const threshold of [0.75, 0.9]) {
          expect(similarAtLeast(foldForMatch(a), foldForMatch(b), threshold), `${a} / ${b}`).toBe(
            similarity(a, b) >= threshold,
          )
        }
      }
    }
  })
})

describe('durationScore', () => {
  it('is null when a length is unknown and decays with the gap', () => {
    expect(durationScore(0, 200)).toBeNull()
    expect(durationScore(200, 0)).toBeNull()
    expect(durationScore(200, 202)).toBe(1)
    expect(durationScore(200, 245)).toBe(0)
    expect(durationScore(200, 224)).toBeCloseTo(0.5, 1)
  })
})

describe('scoreHit', () => {
  it('rates an official upload of the right song green', () => {
    const topic = scoreHit(
      getLucky,
      hit({ title: 'Get Lucky', channel: 'Daft Punk - Topic', duration: 248 }),
    )
    const official = scoreHit(
      getLucky,
      hit({
        title: 'Daft Punk - Get Lucky (Official Audio) ft. Pharrell Williams, Nile Rodgers',
        channel: 'DaftPunkVEVO',
        duration: 249,
      }),
    )
    expect(topic).toBeGreaterThanOrEqual(0.9)
    expect(official).toBeGreaterThanOrEqual(0.8)
  })

  it('marks live, cover, remix, 8D, sped up and reaction videos down', () => {
    const studio = hit({ title: 'Daft Punk - Get Lucky', channel: 'Daft Punk', duration: 248 })
    const studioScore = scoreHit(getLucky, studio)
    for (const title of [
      'Daft Punk - Get Lucky (Live at Coachella)',
      'Get Lucky - Daft Punk (cover)',
      'Daft Punk - Get Lucky (Some DJ Remix)',
      'Daft Punk - Get Lucky (8D Audio)',
      'Daft Punk - Get Lucky (sped up)',
      'Daft Punk - Get Lucky (slowed + reverb)',
      'Producer REACTS to Daft Punk - Get Lucky',
      'Daft Punk - Get Lucky 1 hour loop',
    ]) {
      const score = scoreHit(getLucky, hit({ title, channel: 'Someone', duration: 248 }))
      expect(score, title).toBeLessThan(studioScore - 0.15)
    }
  })

  it('does not punish a lyrics video much', () => {
    const plain = scoreHit(
      getLucky,
      hit({ title: 'Daft Punk - Get Lucky', channel: 'Someone', duration: 248 }),
    )
    const lyrics = scoreHit(
      getLucky,
      hit({ title: 'Daft Punk - Get Lucky (Lyrics)', channel: 'Someone', duration: 248 }),
    )
    expect(plain - lyrics).toBeLessThan(0.06)
  })

  it('does not punish "live" or "remix" when the source title asks for it', () => {
    const source = { title: 'Get Lucky (Live)', artist: 'Daft Punk', album: '', duration: 0 }
    const score = scoreHit(
      source,
      hit({ title: 'Daft Punk - Get Lucky (Live)', channel: 'Daft Punk' }),
    )
    expect(score).toBeGreaterThanOrEqual(0.8)
  })

  it('uses duration to separate versions', () => {
    const close = scoreHit(
      getLucky,
      hit({ title: 'Daft Punk - Get Lucky', channel: 'x', duration: 250 }),
    )
    const far = scoreHit(
      getLucky,
      hit({ title: 'Daft Punk - Get Lucky', channel: 'x', duration: 369 }),
    )
    expect(close).toBeGreaterThan(far + 0.15)
  })

  it('punishes a compilation-length result', () => {
    const score = scoreHit(
      getLucky,
      hit({ title: 'Daft Punk - Get Lucky', channel: 'x', duration: 3600 }),
    )
    expect(score).toBeLessThan(0.5)
  })

  it('is red for the wrong song by the same artist', () => {
    const score = scoreHit(
      getLucky,
      hit({ title: 'Daft Punk - Around the World', channel: 'Daft Punk - Topic', duration: 248 }),
    )
    expect(score).toBeLessThan(0.5)
  })

  it('copes with a missing artist and an unknown length', () => {
    const source = { title: 'Bohemian Rhapsody', artist: '', album: '', duration: 0 }
    const good = scoreHit(
      source,
      hit({
        title: 'Queen – Bohemian Rhapsody (Official Video Remastered)',
        channel: 'Queen Official',
      }),
    )
    const bad = scoreHit(source, hit({ title: 'Top 10 rock songs', channel: 'Lists' }))
    expect(good).toBeGreaterThan(0.6)
    expect(bad).toBeLessThan(0.3)
  })

  it('finds the artist in the channel when the title omits it', () => {
    const source = { title: 'Hello', artist: 'Adele', album: '', duration: 295 }
    const score = scoreHit(source, hit({ title: 'Hello', channel: 'Adele - Topic', duration: 296 }))
    expect(score).toBeGreaterThanOrEqual(0.9)
  })
})

const song = (partial: Partial<ProbedTrack> & { title: string }): ProbedTrack => ({
  url: `https://www.youtube.com/watch?v=${encodeURIComponent(partial.title).slice(0, 11)}`,
  artist: '',
  album: '',
  duration: 0,
  thumbnail: null,
  ...partial,
})

describe('Chinese names', () => {
  it('reads simplified and traditional characters alike', () => {
    expect(normalizeForMatch('周杰伦')).toBe(normalizeForMatch('周杰倫'))
    expect(similarity('逃跑计划', '逃跑計劃')).toBe(1)
    expect(similarity('夜空中最亮的星', '夜空中最亮的星')).toBe(1)
  })

  it('still tells different songs apart', () => {
    expect(similarity('晴天', '稻香')).toBeLessThan(0.5)
  })

  it('does not find a name inside another by its characters', () => {
    // 忘我 shares both its characters with 我不曾忘记, in the other order.
    expect(similarity('我不曾忘记', '忘我')).toBeLessThan(0.4)
    expect(similarity('我不曾忘记', '忘‧記')).toBeLessThan(0.5)
  })

  it('still finds a name inside a longer title', () => {
    expect(similarity('孤勇者', '孤勇者 Warrior of the Darkness')).toBeGreaterThan(0.8)
    expect(similarity('周杰伦', '周杰倫 Jay Chou')).toBeGreaterThan(0.8)
  })
})

describe('bestMatch', () => {
  const ne = (title: string, artist: string, duration: number) => ({
    title,
    artist,
    album: '',
    duration,
  })

  it('takes the studio song over a live take, whichever script it is written in', () => {
    const found = bestMatch(ne('晴天', '周杰伦', 269), [
      song({ title: '晴天', artist: '周杰倫', album: '葉惠美', duration: 270 }),
      song({ title: '晴天', artist: '周杰倫', album: '2004無與倫比演唱會', duration: 300 }),
      song({ title: '稻香', artist: '周杰倫', duration: 224 }),
    ])
    expect(found?.track.album).toBe('葉惠美')
    expect(found?.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it('trusts the first answer when the artist goes by an English name there', () => {
    const found = bestMatch(ne('孤勇者', '陈奕迅', 256), [
      song({
        title: '孤勇者 (《英雄聯盟：雙城之戰》動畫劇集中文主題曲) - Warrior of the Darkness',
        artist: 'Eason Chan',
        duration: 256,
      }),
      song({ title: '十年 (國)', artist: '陳奕迅', duration: 205 }),
    ])
    expect(found?.track.artist).toBe('Eason Chan')
    expect(found?.confidence).toBeGreaterThanOrEqual(0.7)
  })

  it('does not take another song that shares its characters', () => {
    // YouTube Music's answers for 网易云 song 2014336709, which it only has under an English name.
    const found = bestMatch(ne('我不曾忘记', '花玲, 张安琪, 沐霏', 231), [
      song({ title: "I've Never Forgotten (Genshin Fansong)", duration: 231 }),
      song({ title: '忘‧記', artist: '羽泉', duration: 385 }),
      song({ title: '你沒理由忘記我', artist: '唐安麒', duration: 175 }),
      song({ title: '忘我', artist: '丁菲飛', duration: 304 }),
    ])
    expect(found?.track.title).not.toBe('忘我')
  })

  it('finds nothing when no answer is the song', () => {
    expect(bestMatch(getLucky, [song({ title: 'Hey Jude', artist: 'The Beatles' })])).toBeNull()
    expect(bestMatch(getLucky, [])).toBeNull()
  })
})

describe('YouTubeMatcher', () => {
  it('answers each song in order, sure or not, and null for no answer', async () => {
    const answers: Record<string, ProbedTrack[] | null> = {
      'Daft Punk Get Lucky': [
        song({ title: 'Get Lucky', artist: 'Daft Punk', duration: 248, album: 'RAM' }),
      ],
      'Adele Hello': [song({ title: 'Hello (Live at the BBC)', artist: 'Someone', duration: 330 })],
      'Nobody Nothing': null,
    }
    const matcher = new YouTubeMatcher({
      lists: { songs: async query => answers[query] ?? [] },
      logger: createLogger('silent'),
    })
    const found = await matcher.find([
      getLucky,
      { title: 'Hello', artist: 'Adele', album: '', duration: 295 },
      { title: 'Nothing', artist: 'Nobody', album: '', duration: 0 },
    ])
    expect(found[0]).toMatchObject({ title: 'Get Lucky', album: 'RAM', sure: true })
    expect(found[1]?.sure ?? false).toBe(false)
    expect(found[2]).toBeNull()
  })
})

describe('searchQuery', () => {
  it('puts the artist first and drops noise', () => {
    expect(searchQuery(getLucky)).toBe('Daft Punk Get Lucky')
    expect(
      searchQuery({ title: 'Creep (Remastered 2009)', artist: '', album: '', duration: 0 }),
    ).toBe('Creep')
  })
})
