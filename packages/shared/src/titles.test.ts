import { describe, expect, it } from 'vitest'
import { cleanArtist, cleanTitle, tidyVideoTitle } from './titles.js'

describe('cleanTitle', () => {
  it('strips bracketed noise but keeps meaningful brackets', () => {
    expect(cleanTitle('Get Lucky (Official Audio)')).toBe('Get Lucky')
    expect(cleanTitle('Get Lucky [HD]')).toBe('Get Lucky')
    expect(cleanTitle('Get Lucky (Lyrics)')).toBe('Get Lucky')
    expect(cleanTitle('Hotel California (2013 Remaster)')).toBe('Hotel California')
    expect(cleanTitle('Hotel California (Live)')).toBe('Hotel California (Live)')
    expect(cleanTitle('Blue (Da Ba Dee)')).toBe('Blue (Da Ba Dee)')
    expect(cleanTitle('Hold On (Ahead Of Time)')).toBe('Hold On (Ahead Of Time)')
  })

  it('strips Spotify-style dash suffixes', () => {
    expect(cleanTitle('Come Together - Remastered 2009')).toBe('Come Together')
    expect(cleanTitle('Bohemian Rhapsody - 2011 Remaster')).toBe('Bohemian Rhapsody')
    expect(cleanTitle('Levels - Radio Edit')).toBe('Levels')
  })

  it('strips featuring credits in every spelling', () => {
    expect(cleanTitle('Get Lucky (feat. Pharrell Williams)')).toBe('Get Lucky')
    expect(cleanTitle('Get Lucky feat. Pharrell Williams')).toBe('Get Lucky')
    expect(cleanTitle('Get Lucky ft Pharrell')).toBe('Get Lucky')
    expect(cleanTitle('Get Lucky [featuring Pharrell Williams]')).toBe('Get Lucky')
    expect(cleanTitle('Soft Cell')).toBe('Soft Cell')
    expect(cleanTitle('Left Hand Free')).toBe('Left Hand Free')
  })
})

describe('cleanArtist', () => {
  it('drops the Topic channel suffix', () => {
    expect(cleanArtist('YOASOBI - Topic')).toBe('YOASOBI')
    expect(cleanArtist('  Joe   Hisaishi ')).toBe('Joe Hisaishi')
  })

  it('drops a VEVO channel suffix', () => {
    expect(cleanArtist('AuroraLaneVEVO')).toBe('AuroraLane')
    expect(cleanArtist('Aurora Lane VEVO')).toBe('Aurora Lane')
    expect(cleanArtist('Klara Feld')).toBe('Klara Feld')
  })
})

describe('tidyVideoTitle', () => {
  const tidy = (title: string, channel: string) => tidyVideoTitle(title, channel)

  it('takes the song out of Japanese quotes, and the artist written before them', () => {
    expect(tidy('YOASOBI「アイドル」Official Music Video', 'Ayase / YOASOBI')).toEqual({
      title: 'アイドル',
      artist: 'YOASOBI',
    })
    expect(tidy('【MV】YOASOBI「群青」', 'Ayase / YOASOBI')).toEqual({
      title: '群青',
      artist: 'YOASOBI',
    })
    expect(tidy('『怪物』', 'Ayase / YOASOBI')).toEqual({ title: '怪物', artist: null })
  })

  it('reads "artist - title" when one side is the channel', () => {
    expect(tidy('Adele - Hello (Official Music Video)', 'AdeleVEVO')).toEqual({
      title: 'Hello',
      artist: 'Adele',
    })
    expect(tidy('Official髭男dism - Pretender［Official Video］', 'Official髭男dism')).toEqual({
      title: 'Pretender',
      artist: 'Official髭男dism',
    })
    expect(tidy('Hello - Adele', 'Adele')).toEqual({ title: 'Hello', artist: 'Adele' })
  })

  it('leaves a dash alone when neither side is the channel', () => {
    expect(tidy('Kenshi Yonezu - Lemon', '米津玄師')).toEqual({
      title: 'Kenshi Yonezu - Lemon',
      artist: null,
    })
  })

  it('drops what the video says about itself, wherever it is written', () => {
    expect(tidy('Blinding Lights | Official Video', 'The Weeknd')).toEqual({
      title: 'Blinding Lights',
      artist: null,
    })
    expect(tidy('夜に駆ける MV', 'Ayase / YOASOBI')).toEqual({ title: '夜に駆ける', artist: null })
    expect(tidy('Shinunoga E-Wa (Official Lyric Video)', 'Fujii Kaze')).toEqual({
      title: 'Shinunoga E-Wa',
      artist: null,
    })
    expect(tidy('One Summer’s Day | Joe Hisaishi', 'Joe Hisaishi')).toEqual({
      title: 'One Summer’s Day',
      artist: null,
    })
  })

  it('keeps what is part of the song', () => {
    expect(tidy('Hotel California (Live)', 'Eagles')).toEqual({
      title: 'Hotel California (Live)',
      artist: null,
    })
    expect(tidy('Let It Go (From "Frozen")', 'DisneyMusicVEVO')).toEqual({
      title: 'Let It Go (From "Frozen")',
      artist: null,
    })
    expect(tidy('Video Killed the Radio Star', 'The Buggles')).toEqual({
      title: 'Video Killed the Radio Star',
      artist: null,
    })
    expect(tidy('Music', 'Madonna')).toEqual({ title: 'Music', artist: null })
    expect(tidy('Get Lucky (feat. Pharrell Williams)', 'Daft Punk')).toEqual({
      title: 'Get Lucky (feat. Pharrell Williams)',
      artist: null,
    })
  })

  it('does not take a sentence for an artist because the channel is named in it', () => {
    // Found by importing a real OST: the whole disc name became the artist and
    // the title was thrown away, so three discs arrived as three songs with
    // the same name — which then broke every flow that finds a row by title.
    expect(
      tidy(
        'Jade Moon Upon a Sea of Clouds - Disc 1: Glazed Moon Over the Tides｜Genshin Impact',
        'Genshin Impact',
      ),
    ).toEqual({
      title: 'Jade Moon Upon a Sea of Clouds - Disc 1: Glazed Moon Over the Tides',
      artist: null,
    })
    expect(
      tidy(
        'Jade Moon Upon a Sea of Clouds - Disc 3: Battles of Liyue｜Genshin Impact',
        'Genshin Impact',
      ),
    ).toEqual({
      title: 'Jade Moon Upon a Sea of Clouds - Disc 3: Battles of Liyue',
      artist: null,
    })
  })

  it('reads the fullwidth bar, which is written without spaces', () => {
    // 「…」｜Artist is how a Japanese or Chinese title is usually written, and
    // requiring spaces around it left the channel glued to the song's name.
    expect(tidy('夜に駆ける｜YOASOBI', 'YOASOBI')).toEqual({ title: '夜に駆ける', artist: null })
    // The ASCII bar still needs its spaces: AC|DC is a band, not two pieces.
    expect(tidy('Thunderstruck', 'AC|DC')).toEqual({ title: 'Thunderstruck', artist: null })
  })

  it('still takes the artist from a channel that says more than the title does', () => {
    expect(tidy('YOASOBI - 群青', 'Ayase / YOASOBI')).toEqual({ title: '群青', artist: 'YOASOBI' })
  })

  it('never leaves nothing', () => {
    expect(tidy('(Official Video)', 'Someone')).toEqual({ title: '(Official Video)', artist: null })
    expect(tidy('  ', 'Someone')).toEqual({ title: '', artist: null })
  })
})
