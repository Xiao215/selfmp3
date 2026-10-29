import {
  extractUrls,
  freshState,
  isNeteaseUrl,
  isRateLimited,
  musicCredits,
  penalize,
  PERSON_MAY_BORROW,
  spend,
  spotifyLink,
  toProbedTrack,
  youtubeChannel,
  youtubeMusicAlbum,
  youtubeMusicSearch,
  youtubePlaylistId,
  youtubeVideoId,
  youtubeWatchUrl,
  type AlreadyHaveResponse,
  type ImportPreview,
  type ImportPreviewItem,
  type ThrottleState,
} from '@selfmp3/shared'
import type { DeviceDownloader } from './deviceImports.model'

/**
 * Looking a YouTube video up on this device, and listening to it here
 * (docs/features/client-download.md): the two things a review asks YouTube
 * for before anything is imported, done with this device's turns instead of
 * the server's. Only a link to one video: a playlist, a search, an album or a
 * channel is the server's to read, as before.
 */

/** What the player says of a video (`packages/ytclient`'s `VideoFacts`). */
export interface VideoFacts {
  readonly title: string
  readonly author: string
  readonly durationSeconds: number
  readonly description: string
  readonly thumbnail: string | null
}

/** A downloader that can also say what a video is. */
export interface DeviceYouTube extends DeviceDownloader {
  describe(url: string): Promise<VideoFacts>
}

/** This device's budget at YouTube, wherever it is kept. */
interface BudgetStore {
  get(): ThrottleState | null
  save(state: ThrottleState): void
}

/** A device asks YouTube signed out: the extension carries no cookies. */
const SIGNED_IN = false

/**
 * The one YouTube video `text` links to — as the watch address the server
 * would give it — or null when it is anything else: no link, several, a
 * playlist (a watch link with a `list` in it is the playlist's), a search, an
 * album, a channel, or another site.
 */
export function singleVideo(text: string): string | null {
  const urls = extractUrls(text)
  const url = urls[0]
  if (urls.length !== 1 || url === undefined) return null
  if (isNeteaseUrl(url) || spotifyLink(url)) return null
  if (youtubeMusicSearch(url) || youtubeMusicAlbum(url) || youtubePlaylistId(url)) return null
  if (youtubeChannel(url)) return null
  const id = youtubeVideoId(url)
  return id ? youtubeWatchUrl(id) : null
}

/**
 * A turn at YouTube, if there is one to take now: a person is waiting, so this
 * does not wait for one — no turn, and the server is asked instead. As the
 * server lets a person's look-ups do, a few may go on turns not filled yet
 * (`PERSON_MAY_BORROW`).
 */
export function takeTurn(budget: BudgetStore, now: number): boolean {
  const next = spend(budget.get() ?? freshState(now), SIGNED_IN, now, PERSON_MAY_BORROW)
  if (!next) return false
  budget.save(next)
  return true
}

/** Whether YouTube's refusal for rate is still being waited out on this device. */
export function refusing(budget: BudgetStore, now: number): boolean {
  return (budget.get()?.pausedUntil ?? 0) > now
}

/** YouTube refused this device for rate: the bucket empties, and it keeps clear for a while. */
export function noteRefusal(budget: BudgetStore, now: number, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  if (isRateLimited(message)) budget.save(penalize(budget.get() ?? freshState(now), now))
}

/**
 * A review of the video at `url`, as the server's preview would make it: the
 * song named the way yt-dlp names it (`toProbedTrack`, with the credits a
 * YouTube Music track's description gives), and whether the library has it
 * already — which only the server knows, and answers without asking YouTube.
 * Throws when it cannot, and the server is asked instead.
 */
export async function previewOnDevice(
  deps: {
    youtube: Pick<DeviceYouTube, 'describe'>
    alreadyHave: (tracks: readonly ImportPreviewItem[]) => Promise<AlreadyHaveResponse>
    budget: BudgetStore
    now: () => number
  },
  url: string,
): Promise<ImportPreview> {
  if (!takeTurn(deps.budget, deps.now())) throw new Error('no turn at YouTube to spare just now')
  let facts: VideoFacts
  try {
    facts = await deps.youtube.describe(url)
  } catch (error) {
    noteRefusal(deps.budget, deps.now(), error)
    throw error
  }

  const credits = musicCredits(facts.description)
  const track = toProbedTrack(
    {
      webpage_url: url,
      title: facts.title,
      uploader: facts.author,
      duration: facts.durationSeconds,
      ...(facts.thumbnail ? { thumbnail: facts.thumbnail } : {}),
      ...(credits ? { track: credits.track, artist: credits.artist, album: credits.album } : {}),
    },
    url,
  )
  const row: ImportPreviewItem = {
    ...track,
    alreadyHave: false,
    waitingToUpload: false,
    inQueue: false,
    source: 'youtube',
    netease: null,
    youtube: null,
  }
  const answer = await deps.alreadyHave([row])
  return {
    kind: 'single',
    playlistTitle: null,
    items: [
      {
        ...row,
        alreadyHave: answer.have[0] ?? false,
        waitingToUpload: answer.waiting[0] ?? false,
        inQueue: answer.queued[0] ?? false,
      },
    ],
    from: 'youtube',
    // One link, and it was read: nothing left over.
    unread: [],
  }
}

/**
 * What a refusal for rate has left of this browser's pace at YouTube, in
 * words for Settings, or null when it is at full pace. Each refusal halves the
 * budget for good (ytBudget.ts `penalize`), as a server's does, and only a
 * person puts it back: whether anything has changed since is theirs to know.
 */
export function paceNote(state: ThrottleState | null, now: number): string | null {
  if (!state) return null
  const waiting = state.pausedUntil > now
  const slowed = state.ratchet < 1
  if (!waiting && !slowed) return null
  const pace = slowed
    ? `YouTube refused this browser before, so it asks at ${Math.round(state.ratchet * 100)}% of its pace.`
    : ''
  const pause = waiting
    ? ` It is waiting out a pause for another ${Math.max(1, Math.ceil((state.pausedUntil - now) / 60_000))} min.`
    : ''
  return `${pace}${pause}`.trim()
}
