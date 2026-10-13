import {
  clamp01,
  artistOr,
  isNeteaseUrl,
  isYouTubeUrl,
  type CoverTone,
  type ImportPreviewItem,
} from '@selfmp3/shared'

/** What a preview is doing, as the audio reports it (the `listen` port's state). */
type ListenStatus = 'loading' | 'playing' | 'paused' | 'error'

interface ListenState {
  readonly status: ListenStatus
  readonly currentTime: number
  /** NaN until the audio knows. */
  readonly duration: number
}

/** Listening before importing, with nothing drawn. */

/**
 * What a preview is doing, from what was last asked of it and what its audio
 * says — the same rule for a phone's player and a browser's element.
 *
 * A player told to play reports itself playing while it is still waiting on
 * the network, so the wait is read as loading until the audio is `ready`; one
 * told to pause is paused whatever its buffer is doing. A preview that failed,
 * or went silent for too long (`createSilenceWatch`), says so either way.
 */
export function previewStatus(
  asked: 'play' | 'pause',
  audio: { readonly failed: boolean; readonly ready: boolean },
): ListenStatus {
  if (audio.failed) return 'error'
  if (asked === 'pause') return 'paused'
  return audio.ready ? 'playing' : 'loading'
}

/**
 * How long a preview may stay silent after play is asked before it counts as
 * failed. The server may hold a preview up to thirty seconds while it paces
 * its requests to YouTube; a stream that has said nothing after this has gone
 * wrong in a way the audio does not always report — a refused address left
 * one spinning for good (f920641e, on a phone; a browser's element can hang
 * on a stalled request the same way).
 */
const PREVIEW_SILENT_MS = 45_000

/**
 * The watch for that: `watch` when play is asked, `heard` with every status,
 * and `stop` when the preview is paused or let go. `onSilent` runs once if
 * nothing but loading was heard for `PREVIEW_SILENT_MS`.
 */
export function createSilenceWatch(onSilent: () => void): {
  watch(): void
  heard(status: ListenStatus): void
  stop(): void
} {
  let timer: ReturnType<typeof setTimeout> | null = null
  const stop = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
  return {
    watch() {
      stop()
      timer = setTimeout(() => {
        timer = null
        onSilent()
      }, PREVIEW_SILENT_MS)
    },
    heard(status) {
      if (status !== 'loading') stop()
    },
    stop,
  }
}

export type ListenTrack = Pick<
  ImportPreviewItem,
  'url' | 'title' | 'artist' | 'duration' | 'thumbnail'
>

/**
 * The preview, apart from where it is in the song: that moves four times a
 * second and is kept on its own (`useListen`'s `position`), so the review is
 * not drawn again at every tick for the one bar that moves.
 */
export interface Listening {
  readonly track: ListenTrack
  readonly status: ListenStatus
  /** The song's, as the review knows it; from the audio when the review does not (0 until it knows). */
  readonly duration: number
  /** The cover's colour, once the server has read it (ImportListen.tsx); null until then, or for a cover without one. */
  readonly tone: CoverTone | null
}

/** The server streams what yt-dlp finds on YouTube or 网易云; a song still being looked for has nothing yet. */
export const canListen = (item: Pick<ImportPreviewItem, 'url'>): boolean =>
  isYouTubeUrl(item.url) || isNeteaseUrl(item.url)

/** A new preview, before the audio has said anything; `tone` when its cover's colour is already known. */
export const startListening = (track: ListenTrack, tone: CoverTone | null = null): Listening => ({
  track,
  status: 'loading',
  duration: track.duration,
  tone,
})

/**
 * Fold what the audio reports into the preview. The length stays the song's
 * where the review knows it: a stream read in pieces can misjudge its own
 * (a phone's player read 8:00 into a 4:01 song), and the bar would then run to
 * the middle and stop. The audio's length is for a song the review has none
 * for, a search's or an artist's page's, and until then the bar has no length.
 *
 * The same object when nothing it holds changed, which is most reports: only
 * the position moved, and that is not the preview's to hold.
 */
export function followAudio(current: Listening, state: ListenState): Listening {
  const known = current.track.duration > 0
  const duration = known
    ? current.track.duration
    : Number.isFinite(state.duration) && state.duration > 0
      ? state.duration
      : current.duration
  if (state.status === current.status && duration === current.duration) return current
  return { ...current, status: state.status, duration }
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

/** The bar's second line: the artist, or why it would not play, from where it streams. */
export function listenDetail(listening: Pick<Listening, 'track' | 'status'>): string {
  if (listening.status !== 'error') return artistOr(listening.track.artist)
  return `Couldn’t play this one from ${isNeteaseUrl(listening.track.url) ? '网易云' : 'YouTube'}`
}

/** How far along the bar is filled, 0 to 1. Nothing while the length is unknown. */
export function playedRatio(position: number, duration: number): number {
  if (!(duration > 0) || !Number.isFinite(position)) return 0
  return clamp01(position / duration)
}

/** Where a drag at `x` along a bar `width` wide lands, in seconds. */
export function seekAt(x: number, width: number, duration: number): number {
  if (!(width > 0) || !(duration > 0)) return 0
  return clamp01(x / width) * duration
}

/**
 * What a phone row that was tapped and is waiting for its song should do now,
 * given what the preview is playing: open, since its song plays (or failed,
 * which the card says); keep waiting, since its song is still loading; or
 * forget the wait, since the player was taken by another song — a second row
 * tapped, or the first tapped again while this one was still loading — and
 * this one is no longer coming. Nothing playing at all is nothing to wait for.
 */
export function waitingRowNext(
  itemUrl: string | undefined,
  listening: Pick<Listening, 'track' | 'status'> | null,
): 'open' | 'wait' | 'forget' {
  if (!itemUrl || listening === null) return 'open'
  if (listening.track.url !== itemUrl) return 'forget'
  return listening.status === 'loading' ? 'wait' : 'open'
}
