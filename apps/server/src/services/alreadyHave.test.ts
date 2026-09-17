import { describe, expect, it } from 'vitest'

import { alreadyHave, normaliseUrl, sourceUrlIndex, type LibrarySong } from './alreadyHave.js'

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

  it('strips the noise a share button adds to anything else', () => {
    expect(normaliseUrl('https://example.com/a.mp3?si=abc')).toBe('https://example.com/a.mp3')
  })

  it('has nothing to say about nothing', () => {
    expect(normaliseUrl(null)).toBeNull()
    expect(normaliseUrl('  ')).toBeNull()
  })
})

describe('recognising a track the library already holds', () => {
  const library = [
    song('夜に駆ける', 'YOASOBI', {
      duration: 261,
      sourceUrl: 'https://music.youtube.com/watch?v=by4SYYWlhEs',
    }),
    song('Hunch Gray (Live)', 'ZUTOMAYO', { duration: 212 }),
    song('Get Lucky', 'Daft Punk', { duration: 369 }),
  ]
  const urls = sourceUrlIndex(library)

  it('knows the link even when both sides have renamed the song', () => {
    expect(
      alreadyHave(
        {
          title: 'Yoru ni Kakeru (Official Music Video)',
          artist: 'Ayase',
          url: 'https://youtu.be/by4SYYWlhEs',
        },
        library,
        urls,
      ),
    ).toBe('link')
  })

  it('the real thing: the artist spelled two ways on two different days', () => {
    // What put ten copies of one track in a dev library: YouTube gave the
    // channel as "ZUTOMAYO" once and with its Japanese name the next time.
    expect(
      alreadyHave(
        { title: 'Hunch Gray (Live)', artist: 'ずっと真夜中でいいのに。 ZUTOMAYO', duration: 212 },
        library,
        urls,
      ),
    ).toBe('name')
  })

  it('ignores the noise a video title carries', () => {
    expect(
      alreadyHave(
        {
          title: 'Get Lucky (Official Audio) feat. Pharrell Williams',
          artist: 'Daft Punk',
          duration: 369,
        },
        library,
        urls,
      ),
    ).toBe('name')
  })

  it('lets a genuinely different song through', () => {
    expect(
      alreadyHave({ title: 'Around the World', artist: 'Daft Punk' }, library, urls),
    ).toBeNull()
  })

  it('lets a different recording of the same song through, by its length', () => {
    // A live take twice the length is not the song you already have.
    expect(
      alreadyHave({ title: 'Get Lucky', artist: 'Daft Punk', duration: 700 }, library, urls),
    ).toBeNull()
  })

  it('accepts a few seconds between two uploads of one song', () => {
    expect(
      alreadyHave({ title: '夜に駆ける', artist: 'YOASOBI', duration: 258 }, library, urls),
    ).toBe('name')
  })

  it('does not weigh a length neither side knows', () => {
    expect(alreadyHave({ title: 'Hunch Gray (Live)', artist: 'ZUTOMAYO' }, library, urls)).toBe(
      'name',
    )
  })

  it('matches on title alone when one side has no artist', () => {
    expect(alreadyHave({ title: 'Get Lucky', artist: '', duration: 369 }, library, urls)).toBe(
      'name',
    )
  })

  it('says nothing about a track with no title', () => {
    expect(alreadyHave({ title: '   ', artist: 'YOASOBI' }, library, urls)).toBeNull()
  })

  it('works without a prebuilt index', () => {
    expect(alreadyHave({ title: '夜に駆ける', artist: 'YOASOBI', duration: 261 }, library)).toBe(
      'name',
    )
  })
})

describe('the cases the migrate matcher used to own', () => {
  // Carried over when the two matchers became one. A migrated playlist is now
  // compared with the library by the same rule a pasted link is.
  const library = [song('Get Lucky', 'Daft Punk'), song('Creep', 'Radiohead'), song('Hello', '')]
  const getLucky = { title: 'Get Lucky', artist: 'Daft Punk' }

  it('matches fuzzily on title and artist', () => {
    expect(alreadyHave(getLucky, library)).toBe('name')
    expect(alreadyHave({ ...getLucky, title: 'get lucky (feat. Pharrell)' }, library)).toBe('name')
    expect(alreadyHave({ ...getLucky, artist: 'daft punk & pharrell' }, library)).toBe('name')
  })

  it('does not match the same title by a different artist', () => {
    expect(alreadyHave({ title: 'Creep', artist: 'TLC' }, library)).toBeNull()
  })

  it('matches on title alone when either side has no artist', () => {
    expect(alreadyHave({ title: 'Hello', artist: 'Adele' }, library)).toBe('name')
    expect(alreadyHave({ title: 'Creep', artist: '' }, library)).toBe('name')
    expect(alreadyHave({ title: 'Around the World', artist: '' }, library)).toBeNull()
  })
})
