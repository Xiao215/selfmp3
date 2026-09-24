import { isYouTubeUrl, type CoverTone, type ImportPreviewItem } from '@selfmp3/shared'

/** What a preview is doing, as the audio reports it (the `listen` port's state). */
export type ListenStatus = 'loading' | 'playing' | 'paused' | 'error'

export interface ListenState {
  readonly status: ListenStatus
  readonly currentTime: number
  /** NaN until the audio knows. */
  readonly duration: number
}

/** Listening before importing, with nothing drawn. */

export type ListenTrack = Pick<
  ImportPreviewItem,
  'url' | 'title' | 'artist' | 'duration' | 'thumbnail'
>

export interface Listening {
  readonly track: ListenTrack
  readonly status: ListenStatus
  readonly currentTime: number
  /** The song's, as the review knows it; from the audio when the review does not (0 until it knows). */
  readonly duration: number
  /** The cover's colour, once the server has read it (ImportListen.tsx); null until then, or for a cover without one. */
  readonly tone: CoverTone | null
}

/** The server can only stream what yt-dlp finds on YouTube. */
export const canListen = (item: Pick<ImportPreviewItem, 'url'>): boolean => isYouTubeUrl(item.url)

/** A new preview, before the audio has said anything; `tone` when its cover's colour is already known. */
export const startListening = (track: ListenTrack, tone: CoverTone | null = null): Listening => ({
  track,
  status: 'loading',
  currentTime: 0,
  duration: track.duration,
  tone,
})

/**
 * Fold what the audio reports into the preview. The length stays the song's
 * where the review knows it: a stream read in pieces can misjudge its own
 * (a phone's player read 8:00 into a 4:01 song), and the bar would then run to
 * the middle and stop. The audio's length is for a song the review has none
 * for, a search's or an artist's page's, and until then the bar has no length.
 */
export function followAudio(current: Listening, state: ListenState): Listening {
  const known = current.track.duration > 0
  return {
    ...current,
    status: state.status,
    currentTime: state.currentTime,
    duration: known
      ? current.track.duration
      : Number.isFinite(state.duration) && state.duration > 0
        ? state.duration
        : current.duration,
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
