import { ApplyMetadataSchema, type MetadataCandidate } from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'

import {
  applyInput,
  applyLabel,
  appliedCount,
  candidateLine,
  defaultTicked,
  diffFields,
  diffLabel,
  editable,
  handEdits,
  scorePercent,
} from './metadata.model'

const SONG = {
  title: 'アイドル',
  artist: 'YOASOBI',
  album: 'Idol - Single',
  albumArtist: '',
  year: 2023,
  trackNo: 1,
  hasArt: true,
}

const CANDIDATE: MetadataCandidate = {
  source: 'musicbrainz',
  title: 'アイドル',
  artist: 'YOASOBI',
  album: 'アイドル',
  albumArtist: 'YOASOBI',
  year: 2023,
  trackNo: 1,
  durationSec: 212,
  artworkUrl: 'https://example.com/idol.jpg',
  score: 1,
}

describe('metadata changes', () => {
  it('lists only what the suggestion changes, the cover included', () => {
    const diffs = diffFields(SONG, CANDIDATE)
    expect(diffs.map(diff => diff.field)).toEqual(['album', 'albumArtist', 'artwork'])
    expect(diffs[1]).toMatchObject({ current: '—', proposed: 'YOASOBI' })
  })

  it('ticks text corrections, and a cover only when there is none', () => {
    const diffs = diffFields(SONG, CANDIDATE)
    expect([...defaultTicked(SONG, diffs)]).toEqual(['album', 'albumArtist'])
    expect([...defaultTicked({ hasArt: false }, diffs)]).toContain('artwork')
  })

  it('sends only the ticked fields, numbers as numbers', () => {
    const diffs = diffFields({ ...SONG, year: 2020 }, CANDIDATE)
    const input = applyInput(diffs, new Set(['year', 'artwork']))
    expect(input).toEqual({ year: 2023, artworkUrl: 'https://example.com/idol.jpg' })
    expect(ApplyMetadataSchema.safeParse(input).success).toBe(true)
    expect(applyInput(diffs, new Set())).toBeNull()
  })

  it('takes corrections typed by hand, and lets them win over the suggestion', () => {
    expect(editable(null)).toBe('')
    expect(editable(2023)).toBe('2023')
    const typed = handEdits(SONG, {
      title: ' Idol ',
      artist: 'YOASOBI',
      albumArtist: '',
      year: '',
      trackNo: 'x',
    })
    // The artist is what it was; a blank album artist is what it was; "x" is no number.
    expect(typed).toEqual({ title: 'Idol', year: null })
    // A title typed to nothing is not a change: a song has a title.
    expect(handEdits(SONG, { title: '  ' })).toEqual({})
    expect(handEdits(SONG, { trackNo: '12' })).toEqual({ trackNo: 12 })

    const diffs = diffFields(SONG, CANDIDATE)
    const input = applyInput(diffs, new Set(['album']), { album: 'Mine', year: null })
    expect(input).toEqual({ album: 'Mine', year: null })
    expect(ApplyMetadataSchema.safeParse(input).success).toBe(true)
    expect(appliedCount(diffs, new Set(['album', 'artwork']), { album: 'Mine', year: null })).toBe(
      3,
    )
  })

  it('counts on the button, and says when it is working', () => {
    const diffs = diffFields(SONG, CANDIDATE)
    expect(appliedCount(diffs, new Set(['album']))).toBe(1)
    expect(applyLabel(1, false)).toBe('Apply 1 change')
    expect(applyLabel(3, false)).toBe('Apply 3 changes')
    expect(applyLabel(0, false)).toBe('Apply')
    expect(applyLabel(2, true)).toBe('Applying…')
  })

  it('reads a change out in words', () => {
    const [album, albumArtist, artwork] = diffFields(SONG, CANDIDATE)
    expect(diffLabel(album!, true)).toBe('Apply album: Idol - Single becomes アイドル')
    expect(diffLabel(albumArtist!, true)).toBe('Apply album artist: nothing becomes YOASOBI')
    expect(diffLabel(artwork!, true)).toBe('Replace the cover with the cover from MusicBrainz')
    expect(diffLabel(artwork!, false)).toBe('Add the cover from MusicBrainz')
  })

  it('describes a suggestion on one line', () => {
    expect(candidateLine(CANDIDATE)).toBe('YOASOBI · アイドル · 2023 · 3:32')
    expect(scorePercent(0.451)).toBe('45%')
  })
})
