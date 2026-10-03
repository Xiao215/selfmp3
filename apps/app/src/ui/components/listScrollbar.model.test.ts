import { describe, expect, it } from 'vitest'
import type { Song } from '@selfmp3/shared'
import {
  MIN_THUMB,
  dayLabel,
  initialOf,
  positionLabel,
  rowAt,
  rowMark,
  rowOnScreen,
  rowTop,
  scrollForThumb,
  scrollToRow,
  sortLabel,
  thumbLength,
  thumbOffset,
} from './listScrollbar.model'

const song = (fields: Partial<Song>): Song =>
  ({
    title: 'Song',
    artist: 'Artist',
    album: 'Album',
    duration: 200,
    playCount: 0,
    lastPlayedAt: null,
    addedAt: '2026-09-25T12:00:00.000Z',
    ...fields,
  }) as Song

const now = new Date('2026-10-02T12:00:00.000Z')

describe('initialOf', () => {
  it('capitalises a Latin letter and drops its accent', () => {
    expect(initialOf('études')).toBe('E')
    expect(initialOf('  crystal Curtains')).toBe('C')
  })

  it('keeps a kana or a kanji as it is, voicing mark and all', () => {
    expect(initialOf('がらくた')).toBe('が')
    expect(initialOf('夜に駆ける')).toBe('夜')
    expect(initialOf('ヨルシカ')).toBe('ヨ')
  })

  it('files a digit, a sign or nothing under #', () => {
    expect(initialOf('451')).toBe('#')
    expect(initialOf('「花」')).toBe('#')
    expect(initialOf('')).toBe('#')
  })
})

describe('dayLabel', () => {
  it('names the day, with the year only outside this one', () => {
    expect(dayLabel('2026-09-25T12:00:00.000Z', now)).toBe('Sep 25')
    expect(dayLabel('2024-03-02T12:00:00.000Z', now)).toBe('Mar 2, 2024')
  })

  it('reads the database’s own time format', () => {
    expect(dayLabel('2026-09-25 12:00:00', now)).toBe('Sep 25')
  })
})

describe('sortLabel', () => {
  it('says the part of each sort a song is in', () => {
    const one = song({
      title: 'Ébène',
      artist: 'HOYO-MiX',
      album: 'Pelagic Primaevality',
      duration: 125,
      playCount: 3,
      lastPlayedAt: '2026-10-01T12:00:00.000Z',
    })
    expect(sortLabel('title', now)(one, 0, 1)).toBe('E')
    expect(sortLabel('artist', now)(one, 0, 1)).toBe('HOYO-MiX')
    expect(sortLabel('album', now)(one, 0, 1)).toBe('Pelagic Primaevality')
    expect(sortLabel('addedAt', now)(one, 0, 1)).toBe('Sep 25')
    expect(sortLabel('lastPlayedAt', now)(one, 0, 1)).toBe('Oct 1')
    expect(sortLabel('duration', now)(one, 0, 1)).toBe('2:05')
    expect(sortLabel('playCount', now)(one, 0, 1)).toBe('3 plays')
  })

  it('says so for a song with no artist, album or plays', () => {
    const bare = song({ artist: '', album: '' })
    expect(sortLabel('artist', now)(bare, 0, 1)).toBe('Unknown artist')
    expect(sortLabel('album', now)(bare, 0, 1)).toBe('No album')
    expect(sortLabel('playCount', now)(bare, 0, 1)).toBe('Not played yet')
    expect(sortLabel('lastPlayedAt', now)(bare, 0, 1)).toBe('Not played yet')
  })

  it('falls back on the position in a shuffled list', () => {
    expect(sortLabel('random', now)(song({}), 11, 1270)).toBe('12 of 1,270')
    expect(positionLabel(song({}), 0, 88)).toBe('1 of 88')
  })
})

describe('the thumb', () => {
  const metrics = { viewport: 800, content: 4000, track: 788 }

  it('is the share of the list on screen, but never too short to hold', () => {
    expect(thumbLength(metrics)).toBeCloseTo(157.6)
    expect(thumbLength({ viewport: 800, content: 1270 * 54, track: 788 })).toBe(MIN_THUMB)
    expect(thumbLength({ viewport: 800, content: 600, track: 788 })).toBe(788)
  })

  it('runs from the top of the track to the bottom as the list does', () => {
    const room = 788 - thumbLength(metrics)
    expect(thumbOffset(0, metrics)).toBe(0)
    expect(thumbOffset(3200, metrics)).toBeCloseTo(room)
    expect(thumbOffset(1600, metrics)).toBeCloseTo(room / 2)
    expect(thumbOffset(9999, metrics)).toBeCloseTo(room)
  })

  it('takes the list back to where a thumb at an offset says', () => {
    for (const scrollTop of [0, 800, 1600, 3200]) {
      expect(scrollForThumb(thumbOffset(scrollTop, metrics), metrics)).toBeCloseTo(scrollTop)
    }
    expect(scrollForThumb(-50, metrics)).toBe(0)
  })
})

describe('the rows', () => {
  // A 300-point head, then 100 rows of 54.
  const span = { header: 300, content: 300 + 100 * 54, count: 100 }
  const metrics = { viewport: 810, content: span.content, track: 798 }

  it('finds the row at the top of the window', () => {
    expect(rowAt(0, span)).toBe(0)
    expect(rowAt(300 + 54 * 10 + 5, span)).toBe(10)
    expect(rowAt(1e9, span)).toBe(99)
    expect(rowTop(10, span)).toBe(840)
  })

  it('knows whether a row is in the window', () => {
    expect(rowOnScreen(0, 0, 810, span)).toBe(true)
    expect(rowOnScreen(40, 0, 810, span)).toBe(false)
    expect(rowOnScreen(40, rowTop(40, span) - 400, 810, span)).toBe(true)
  })

  it('marks a row where the thumb would be with that row in the middle', () => {
    const scrollTop = scrollToRow(50, metrics, span)
    expect(scrollTop).toBeCloseTo(rowTop(50, span) + 27 - 405)
    expect(rowMark(50, metrics, span)).toBeCloseTo(
      thumbOffset(scrollTop, metrics) + thumbLength(metrics) / 2,
    )
    // The first row cannot be taken past the top.
    expect(scrollToRow(0, metrics, span)).toBe(0)
  })
})
