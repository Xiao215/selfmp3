import { describe, expect, it } from 'vitest'
import type { Song, SongFeatures } from '@selfmp3/shared'
import { autoMixCrossfade, autoMixOrder, orderPath } from './autoMix.js'
import { EMPTY_QUEUE, type QueueState } from './queue.js'

const feat = (patch: Partial<SongFeatures> = {}): SongFeatures => ({
  bpm: 120,
  energy: 0.5,
  loudnessLufs: -14,
  key: 'C major',
  camelot: '8B',
  danceability: 0.5,
  analyzedAt: '2026-01-01 00:00:00',
  version: 1,
  ...patch,
})

const song = (id: number, features: SongFeatures | null): Song => ({
  id,
  path: `${id}.m4a`,
  title: `Song ${id}`,
  artist: '',
  album: '',
  albumArtist: '',
  trackNo: null,
  year: null,
  duration: 200,
  sizeBytes: 0,
  mime: 'audio/mp4',
  hasArt: false,
  lyricsKind: 'none',
  instrumental: false,
  playCount: 0,
  skipCount: 0,
  loved: false,
  sourceUrl: null,
  lastPlayedAt: null,
  addedAt: '2026-01-01',
  missing: false,
  tagIds: [],
  features,
})

const library = new Map<number, Song>(
  [
    song(1, feat({ bpm: 120, camelot: '8B', energy: 0.5 })),
    song(2, feat({ bpm: 90, camelot: '2A', energy: 0.9 })),
    song(3, feat({ bpm: 122, camelot: '9B', energy: 0.55 })),
    song(4, feat({ bpm: 92, camelot: '3A', energy: 0.85 })),
    song(5, feat({ bpm: 124, camelot: '8A', energy: 0.6 })),
    song(6, null),
  ].map(s => [s.id, s]),
)

const queue = (patch: Partial<QueueState>): QueueState => ({ ...EMPTY_QUEUE, ...patch })

describe('orderPath', () => {
  it('walks to the nearest neighbour each step', () => {
    // From 1 (120 BPM, 8B): 3 is closest, then 5, then the two slow tracks.
    expect(orderPath(1, [2, 3, 4, 5], library)).toEqual([3, 5, 4, 2])
  })

  it('keeps un-analysed songs at the end, in their original order', () => {
    expect(orderPath(1, [6, 2, 3], library)).toEqual([3, 2, 6])
  })

  it('starts from the first queued song when nothing is playing', () => {
    expect(orderPath(undefined, [2, 3, 4], library)).toEqual([2, 4, 3])
  })

  it('handles empty and single-item lists', () => {
    expect(orderPath(1, [], library)).toEqual([])
    expect(orderPath(1, [2], library)).toEqual([2])
  })
})

describe('autoMixOrder', () => {
  it('reorders only what is after the current track', () => {
    const state = queue({ items: [4, 1, 2, 3, 5], index: 1 })
    const next = autoMixOrder(state, library)
    expect(next.items).toEqual([4, 1, 3, 5, 2])
    expect(next.index).toBe(1)
  })

  it('returns the same state when there is nothing to reorder', () => {
    const state = queue({ items: [1, 2], index: 0 })
    expect(autoMixOrder(state, library)).toBe(state)
    const ordered = queue({ items: [1, 3, 5, 2], index: 0 })
    expect(autoMixOrder(ordered, library)).toBe(ordered)
  })

  it('treats an empty index as starting from the first song', () => {
    const state = queue({ items: [1, 2, 3], index: -1 })
    expect(autoMixOrder(state, library).items).toEqual([1, 3, 2])
  })

  it('keeps every song exactly once', () => {
    const state = queue({ items: [1, 2, 3, 4, 5, 6], index: 0 })
    const next = autoMixOrder(state, library)
    expect([...next.items].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6])
  })
})

describe('autoMixCrossfade', () => {
  const a = library.get(1) ?? null
  const close = library.get(3) ?? null
  const far = library.get(2) ?? null

  it('uses a modest fade when the user has crossfade off', () => {
    expect(autoMixCrossfade(a, close, 0)).toBe(4)
    expect(autoMixCrossfade(a, far, 0)).toBeLessThan(4)
    expect(autoMixCrossfade(a, far, 0)).toBeGreaterThanOrEqual(1)
  })

  it('never exceeds the user setting', () => {
    expect(autoMixCrossfade(a, close, 8)).toBe(8)
    expect(autoMixCrossfade(a, close, 12)).toBe(12)
    expect(autoMixCrossfade(a, far, 12)).toBeLessThan(12)
  })
})
