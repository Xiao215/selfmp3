import {
  extractUrls,
  IMPORT_STEP_LABELS,
  isSquareCoverUrl,
  type ImportEnqueue,
  type ImportEnqueueItem,
  type ImportJob,
  type ImportPreview,
  type ImportPreviewItem,
} from '@selfmp3/shared'

/**
 * Importing, without the screen.
 *
 * Two steps on purpose: fetch the details first, review and correct them, then
 * commit. A forty-track playlist is exactly the case where you want to see what
 * is about to download, and to untick the six tracks you already have.
 */

/** What each queue state is called, for the icon's label and screen readers. */
export const JOB_STATUS_LABELS: Record<ImportJob['status'], string> = {
  queued: 'Waiting',
  running: 'Downloading',
  done: 'Done',
  error: 'Failed',
  cancelled: 'Cancelled',
}

/**
 * In the library on the server but not yet in the cloud bucket: not a failure,
 * and the cloud sync finishes the job by itself (docs/SYNC.md).
 */
export function waitingToUpload(job: Pick<ImportJob, 'status' | 'step'>): boolean {
  return job.status === 'error' && job.step === 'uploading'
}

export function jobLabel(job: Pick<ImportJob, 'status' | 'step'>): string {
  return waitingToUpload(job) ? 'Waiting to upload' : JOB_STATUS_LABELS[job.status]
}

/** The line under a job's title. */
export function jobSubtitle(
  job: Pick<ImportJob, 'status' | 'step' | 'error' | 'attempts'>,
): string {
  if (job.status === 'error') {
    const reason = job.error ?? 'Failed'
    return job.attempts > 1 ? `${reason} · ${job.attempts} attempts` : reason
  }
  if (job.status === 'cancelled') return 'Cancelled'
  if (job.status === 'done') return 'Added to your library'
  return IMPORT_STEP_LABELS[job.step]
}

/** The one thing a job row offers, if anything. */
export type JobAction = 'cancel' | 'retry' | 'try-now' | null

export function jobAction(job: Pick<ImportJob, 'status' | 'step'>): JobAction {
  if (job.status === 'queued') return 'cancel'
  // Past the download the song is on its way into the library, and the server
  // no longer takes a cancel for it.
  if (job.status === 'running') {
    return job.step === 'resolving' || job.step === 'downloading' ? 'cancel' : null
  }
  if (job.status === 'error' || job.status === 'cancelled') {
    return waitingToUpload(job) ? 'try-now' : 'retry'
  }
  return null
}

/** How a job's row is tinted. */
export type JobTone = 'running' | 'done' | 'error' | 'waiting' | 'cancelled' | 'queued'

export function jobTone(job: Pick<ImportJob, 'status' | 'step'>): JobTone {
  return waitingToUpload(job) ? 'waiting' : job.status
}

/** A review, as the screen holds it between fetching and importing. */
export interface Review {
  readonly items: readonly ImportPreviewItem[]
  /** Indexes into `items`. */
  readonly chosen: ReadonlySet<number>
  /** The source playlist's name, when the link was one, for "also create playlist". */
  readonly playlistTitle: string | null
}

/** Pre-tick everything except tracks that look like duplicates. */
export function reviewFrom(preview: ImportPreview): Review {
  return {
    items: preview.items,
    chosen: new Set(preview.items.flatMap((item, index) => (item.alreadyHave ? [] : [index]))),
    playlistTitle: preview.kind === 'playlist' ? preview.playlistTitle : null,
  }
}

export function toggleChosen(chosen: ReadonlySet<number>, index: number): ReadonlySet<number> {
  const next = new Set(chosen)
  if (next.has(index)) next.delete(index)
  else next.add(index)
  return next
}

export function chooseAll(items: readonly unknown[]): ReadonlySet<number> {
  return new Set(items.map((_, index) => index))
}

/** Correct one row's details; the url, which is what plays and downloads, stays. */
export function patchItem(
  items: readonly ImportPreviewItem[],
  index: number,
  patch: Partial<Pick<ImportPreviewItem, 'title' | 'artist' | 'album'>>,
): readonly ImportPreviewItem[] {
  return items.map((item, i) => (i === index ? { ...item, ...patch } : item))
}

/** A square picture is drawn square rather than cropped to the video shape. */
export const isSquareCover = isSquareCoverUrl

/**
 * The tag a link is named after, if you already have one: an artist's page
 * or a search for "yoasobi" with a `yoasobi` tag in the library. Pre-ticked,
 * so the songs are tagged without asking; still yours to untick.
 */
export function matchingTag(
  tags: readonly { id: number; name: string }[],
  playlistTitle: string | null,
): number | null {
  const wanted = playlistTitle?.trim().toLowerCase()
  if (!wanted) return null
  return tags.find(tag => tag.name.trim().toLowerCase() === wanted)?.id ?? null
}

export function chosenItems(review: Review): readonly ImportPreviewItem[] {
  return review.items.filter((_, index) => review.chosen.has(index))
}

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`

/** "40 tracks found", and how many are already here. */
export function reviewHeading(review: Review): { found: string; duplicates: string | null } {
  const duplicates = review.items.filter(item => item.alreadyHave).length
  return {
    found: `${plural(review.items.length, 'track', 'tracks')} found`,
    duplicates: duplicates > 0 ? `${duplicates} already in your library` : null,
  }
}

export function selectedCount(review: Review): string {
  return `${chosenItems(review).length} of ${review.items.length} selected`
}

export function importButtonLabel(count: number): string {
  return `Import ${plural(count, 'track', 'tracks')}`
}

/**
 * Whether the box holds a link the server can read. The server takes every
 * http(s) address in the text and ignores the rest (importPreview.ts), so a
 * box with none of them could only ever come back as an error.
 */
export function hasLink(text: string): boolean {
  return extractUrls(text, 1).length > 0
}

/**
 * The line under the box once something is typed that holds no link: said
 * there, while typing, rather than as an error after pressing Fetch details.
 */
export function linkHint(text: string): string | null {
  return text.trim() && !hasLink(text)
    ? 'That doesn’t look like a link. Paste a music.youtube.com or youtube.com address.'
    : null
}

/**
 * The queue with its finished jobs folded away. Each one added a song, which
 * the library already shows; what still needs you — running, waiting, failed,
 * cancelled — stays in rows.
 */
export function foldQueue<T extends Pick<ImportJob, 'status'>>(
  jobs: readonly T[],
): { open: readonly T[]; finished: readonly T[] } {
  return {
    open: jobs.filter(job => job.status !== 'done'),
    finished: jobs.filter(job => job.status === 'done'),
  }
}

/** A server's `2026-09-14 08:30:00` is UTC without saying so; an ISO time says so. */
function stampDate(stamp: string): Date {
  return new Date(stamp.includes('T') ? stamp : `${stamp.replace(' ', 'T')}Z`)
}

/** "13 added today", or "13 added" once any of them is from an earlier day. */
export function finishedLabel(
  finished: readonly Pick<ImportJob, 'updatedAt'>[],
  now = new Date(),
): string {
  const today = now.toDateString()
  const allToday = finished.every(job => stampDate(job.updatedAt).toDateString() === today)
  return `${finished.length} added${allToday ? ' today' : ''}`
}

/** "2 downloading, 5 waiting", only while something is happening. */
export function queueActivity(queue: { active: number; queued: number }): string | null {
  return queue.active + queue.queued > 0
    ? `${queue.active} downloading, ${queue.queued} waiting`
    : null
}

/** What goes to `/api/import/enqueue`. */
export function enqueueRequest(
  review: Review,
  options: {
    tagIds: ReadonlySet<number>
    playlistId: number | null
    createPlaylist: boolean
  },
): ImportEnqueue {
  const items: ImportEnqueueItem[] = chosenItems(review).map(item => ({
    url: item.url,
    title: item.title,
    artist: item.artist,
    album: item.album,
    thumbnail: item.thumbnail,
    duration: item.duration,
  }))
  return {
    items,
    tagIds: [...options.tagIds],
    playlistId: options.playlistId,
    // Only when no playlist was picked: picking one is the stronger request.
    createPlaylistName:
      options.playlistId === null && options.createPlaylist ? review.playlistTitle : null,
  }
}

/**
 * Links shared to the app: the web's Web Share Target, `/import?url=…&text=…`.
 *
 * What arrives varies by app: the YouTube app on Android puts the link in
 * `text` (often with the video title in front), a browser puts it in `url`,
 * and some fill both. The import box wants the links, one per line.
 */
export function sharedLinks(params: {
  url?: string | string[] | null
  text?: string | string[] | null
  title?: string | string[] | null
}): string | null {
  const first = (value: string | string[] | null | undefined): string | null =>
    Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
  const candidates = [first(params.url), first(params.text), first(params.title)]
  const urls = extractUrls(candidates.filter((v): v is string => !!v).join('\n'))
  return urls.length > 0 ? urls.join('\n') : null
}

/** The share-target query keys, so the screen can clear them once read. */
export const SHARE_PARAMS = ['url', 'text', 'title'] as const
