import { ApplyMetadataSchema, type FixCoversStatus, type MetadataCandidate } from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'

import {
  applyInput,
  applyLabel,
  appliedCount,
  candidateLine,
  coverArtHint,
  coverProgress,
  coverResult,
  defaultTicked,
  diffFields,
  diffLabel,
  missingArtCount,
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
    expect(
      candidateLine(CANDIDATE, s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`),
    ).toBe('YOASOBI · アイドル · 2023 · 3:32')
    expect(scorePercent(0.451)).toBe('45%')
  })
})

describe('the cover-art pass', () => {
  const status = (patch: Partial<FixCoversStatus>): FixCoversStatus => ({
    status: 'running',
    total: 12,
    done: 2,
    found: 1,
    currentTitle: 'アイドル',
    startedAt: null,
    finishedAt: null,
    ...patch,
  })

  it('counts the songs that have no art', () => {
    expect(missingArtCount([{ hasArt: false }, { hasArt: true }])).toBe(1)
    expect(coverArtHint(0)).toBe('Every song has artwork.')
    expect(coverArtHint(1)).toMatch(/^1 song has none/)
  })

  it('says where it is while running, and what it found after', () => {
    expect(coverProgress(status({}))).toBe('Checking 3 of 12 — アイドル · 1 found')
    expect(coverResult(status({}))).toBeNull()
    expect(coverResult(status({ status: 'done', done: 12, found: 4 }))).toBe(
      'Found artwork for 4 of 12 songs.',
    )
    expect(coverResult(status({ status: 'cancelled', done: 5, found: 1 }))).toBe(
      'Stopped. Found artwork for 1 of 5 songs (7 not checked).',
    )
  })
})
