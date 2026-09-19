import { isYouTubeUrl, type ImportPreviewItem } from '@selfmp3/shared'

/** What a preview is doing, as the audio reports it (the `listen` port's state). */
export type ListenStatus = 'loading' | 'playing' | 'paused' | 'error'

export interface ListenState {
  readonly status: ListenStatus
  readonly currentTime: number
  /** NaN until the audio knows. */
  readonly duration: number
}

/** Listening before importing, with nothing drawn. */

export type ListenTrack = Pick<ImportPreviewItem, 'url' | 'title' | 'artist' | 'duration'>

export interface Listening {
  readonly track: ListenTrack
  readonly status: ListenStatus
  readonly currentTime: number
  /** From the audio once it knows; the preview's length until then (0 if unknown). */
  readonly duration: number
}

/** The server can only stream what yt-dlp finds on YouTube. */
export const canListen = (item: Pick<ImportPreviewItem, 'url'>): boolean => isYouTubeUrl(item.url)

/** A new preview, before the audio has said anything. */
export const startListening = (track: ListenTrack): Listening => ({
  track,
  status: 'loading',
  currentTime: 0,
  duration: track.duration,
})

/** Fold what the audio reports into the preview, keeping the known length until it has one. */
export function followAudio(current: Listening, state: ListenState): Listening {
  return {
    ...current,
    status: state.status,
    currentTime: state.currentTime,
    duration:
      Number.isFinite(state.duration) && state.duration > 0 ? state.duration : current.duration,
  }
}

/** A preview whose track has left the review (cancelled, imported, a new link fetched) stops. */
export const listeningLeftReview = (
  listening: Pick<Listening, 'track'> | null,
  items: readonly Pick<ImportPreviewItem, 'url'>[] | null,
): boolean => listening !== null && !(items ?? []).some(item => item.url === listening.track.url)

/** The play button's label on a review row. */
export function listenLabel(title: string, status: ListenStatus | null): string {
  return status === 'playing' ? `Pause ${title}` : `Listen to ${title}`
}

/** The bar's second line: the artist, or why it would not play. */
export function listenDetail(listening: Pick<Listening, 'track' | 'status'>): string {
  return listening.status === 'error'
    ? 'Couldn’t play this one from YouTube'
    : listening.track.artist || 'Unknown artist'
}

/**
 * The bar's pattern: how tall each of its `count` bars is, from 0.25 to 0.95
 * of the bar's height.
 *
 * It looks like a waveform, but it is not one. Peaks for a song that has not
 * been imported do not exist, and fetching and decoding the audio to draw a
 * seek bar would cost a download per row. So the shape comes from the song's
 * url instead: the same song draws the same bars every time, and two songs
 * look different, which is all a seek bar's shape is for.
 */
export function barPattern(seed: string, count: number): readonly number[] {
  // FNV-1a folds the url into a number; mulberry32 spreads it into a sequence.
  let state = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    state ^= seed.charCodeAt(i)
    state = Math.imul(state, 0x01000193)
  }
  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return Array.from({ length: Math.max(0, count) }, () => 0.25 + Math.round(next() * 70) / 100)
}

/** How far along the bar is filled, 0 to 1. Nothing while the length is unknown. */
export function playedRatio(position: number, duration: number): number {
  if (!(duration > 0) || !Number.isFinite(position)) return 0
  return Math.max(0, Math.min(1, position / duration))
}

/** Where a drag at `x` along a bar `width` wide lands, in seconds. */
export function seekAt(x: number, width: number, duration: number): number {
  if (!(width > 0) || !(duration > 0)) return 0
  return Math.max(0, Math.min(1, x / width)) * duration
}
