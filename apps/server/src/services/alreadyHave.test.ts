import { describe, expect, it } from 'vitest'

import { alreadyHave, libraryIndex, normaliseUrl, type LibrarySong } from './alreadyHave.js'

/**
 * The duplicate guard, against the cases that actually got through.
 *
 * Every "the real thing" case below is taken from a dev library that ended up
 * holding 111 files of 45 songs: the same links imported again and again,
 * because the old check compared `artist::title` as exact strings and YouTube
 * does not hand back the same strings twice.
 */

const song = (title: string, artist: string, extra: Partial<LibrarySong> = {}): LibrarySong => ({
  title,
  artist,
  ...extra,
})

describe('reducing a link to what identifies it', () => {
  it('sees one video behind every way YouTube spells it', () => {
    const forms = [
      'https://www.youtube.com/watch?v=by4SYYWlhEs',
      'https://music.youtube.com/watch?v=by4SYYWlhEs',
      'https://youtu.be/by4SYYWlhEs',
      'https://www.youtube.com/watch?v=by4SYYWlhEs&list=RDAMVM&index=1',
    ]
    const ids = new Set(forms.map(normaliseUrl))
    expect(ids).toEqual(new Set(['yt:by4SYYWlhEs']))
  })

  it('sees one 网易云 song behind every way 网易云 spells it', () => {
    const forms = [
      'https://music.163.com/song?id=186016',
      'https://music.163.com/#/song?id=186016',
      'https://y.music.163.com/m/song?id=186016&userid=7',
    ]
    expect(new Set(forms.map(normaliseUrl))).toEqual(new Set(['ne:186016']))
  })

  it('strips the noise a share button adds to anything else', () => {
    expect(normaliseUrl('https://example.com/a.mp3?si=abc')).toBe('https://example.com/a.mp3')
  })

  it('has nothing to say about nothing', () => {
    expect(normaliseUrl(null)).toBeNull()
    expect(normaliseUrl('  ')).toBeNull()
  })
})

describe('recognising a track the library already holds', () => {
  // The answer is the song itself: the preview says where it is, not only that it is.
  const library = [
    song('夜に駆ける', 'YOASOBI', {
      duration: 261,
      sourceUrl: 'https://music.youtube.com/watch?v=by4SYYWlhEs',
    }),
    song('Hunch Gray (Live)', 'ZUTOMAYO', { duration: 212 }),
    song('Get Lucky', 'Daft Punk', { duration: 369 }),
  ]
  const index = libraryIndex(library)

  it('knows the link even when both sides have renamed the song', () => {
    expect(
      alreadyHave(
        {
          title: 'Yoru ni Kakeru (Official Music Video)',
          artist: 'Ayase',
          url: 'https://youtu.be/by4SYYWlhEs',
        },
        index,
      ),
    ).toBe(library[0])
  })

  it('the real thing: the artist spelled two ways on two different days', () => {
    // What put ten copies of one track in a dev library: YouTube gave the
    // channel as "ZUTOMAYO" once and with its Japanese name the next time.
    expect(
      alreadyHave(
        { title: 'Hunch Gray (Live)', artist: 'ずっと真夜中でいいのに。 ZUTOMAYO', duration: 212 },
        index,
      ),
    ).toBe(library[1])
  })

  it('ignores the noise a video title carries', () => {
    expect(
      alreadyHave(
        {
          title: 'Get Lucky (Official Audio) feat. Pharrell Williams',
          artist: 'Daft Punk',
          duration: 369,
        },
        index,
      ),
    ).toBe(library[2])
  })

  it('lets a genuinely different song through', () => {
    expect(alreadyHave({ title: 'Around the World', artist: 'Daft Punk' }, index)).toBeNull()
  })

  it('lets a different recording of the same song through, by its length', () => {
    // A live take twice the length is not the song you already have.
    expect(
      alreadyHave({ title: 'Get Lucky', artist: 'Daft Punk', duration: 700 }, index),
    ).toBeNull()
  })

  it('accepts a few seconds between two uploads of one song', () => {
    expect(alreadyHave({ title: '夜に駆ける', artist: 'YOASOBI', duration: 258 }, index)).toBe(
      library[0],
    )
  })

  it('does not weigh a length neither side knows', () => {
    expect(alreadyHave({ title: 'Hunch Gray (Live)', artist: 'ZUTOMAYO' }, index)).toBe(library[1])
  })

  it('matches on title alone when one side has no artist', () => {
    expect(alreadyHave({ title: 'Get Lucky', artist: '', duration: 369 }, index)).toBe(library[2])
  })

  it('says nothing about a track with no title', () => {
    expect(alreadyHave({ title: '   ', artist: 'YOASOBI' }, index)).toBeNull()
  })

  it('knows a Chinese song written in the other script', () => {
    const library = [song('晴天', '周杰倫')]
    expect(alreadyHave({ title: '晴天', artist: '周杰伦' }, libraryIndex(library))).toBe(library[0])
  })
})

describe('the cases the playlist matcher used to own', () => {
  // Carried over when the two matchers became one. A list from another app is
  // compared with the library by the same rule a pasted link is.
  const library = [song('Get Lucky', 'Daft Punk'), song('Creep', 'Radiohead'), song('Hello', '')]
  const index = libraryIndex(library)
  const getLucky = { title: 'Get Lucky', artist: 'Daft Punk' }

  it('matches fuzzily on title and artist', () => {
    expect(alreadyHave(getLucky, index)).toBe(library[0])
    expect(alreadyHave({ ...getLucky, title: 'get lucky (feat. Pharrell)' }, index)).toBe(
      library[0],
    )
    expect(alreadyHave({ ...getLucky, artist: 'daft punk & pharrell' }, index)).toBe(library[0])
  })

  it('does not match the same title by a different artist', () => {
    expect(alreadyHave({ title: 'Creep', artist: 'TLC' }, index)).toBeNull()
  })

  it('matches on title alone when either side has no artist', () => {
    expect(alreadyHave({ title: 'Hello', artist: 'Adele' }, index)).toBe(library[2])
    expect(alreadyHave({ title: 'Creep', artist: '' }, index)).toBe(library[1])
    expect(alreadyHave({ title: 'Around the World', artist: '' }, index)).toBeNull()
  })
})
