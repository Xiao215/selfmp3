import { isYouTubeUrl, type ImportPreviewItem } from '@selfmp3/shared'

/** What a preview is doing, as the audio reports it (the `listen` port's state). */
export type ListenStatus = 'loading' | 'playing' | 'paused' | 'error'

export interface ListenState {
  readonly status: ListenStatus
  readonly currentTime: number
  /** NaN until the audio knows. */
  readonly duration: number
}

/** Listening before importing, with nothing drawn: the web's `ImportListen` rules. */

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
    duration: Number.isFinite(state.duration) && state.duration > 0 ? state.duration : current.duration,
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
