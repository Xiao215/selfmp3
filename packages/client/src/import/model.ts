import {
  extractUrls,
  fromSqliteTime,
  IMPORT_STEP_LABELS,
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

/**
 * In the library on the server but not yet in the cloud bucket: not a failure,
 * and the cloud sync finishes the job by itself (docs/SYNC.md).
 */
function waitingToUpload(job: Pick<ImportJob, 'status' | 'step'>): boolean {
  return job.status === 'error' && job.step === 'uploading'
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
type JobAction = 'cancel' | 'retry' | 'try-now' | null

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

/**
 * Whether a row can be taken off the queue for good: waiting, downloading,
 * failed or paused, and not wanted after all. A job past its download is
 * adding its song and cannot be, and a job that finished goes with the
 * day's Clear.
 */
export function dismissable(job: Pick<ImportJob, 'status' | 'step'>): boolean {
  if (job.status === 'error' || job.status === 'cancelled') return true
  return jobAction(job) === 'cancel'
}

/** How a job's row is tinted. */
type JobTone = 'running' | 'done' | 'error' | 'waiting' | 'cancelled' | 'queued'

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

/**
 * A kept review told again which of its songs the library has now.
 *
 * "In library" is a fact about the library at the moment it is read, and
 * a draft outlives the reading: a song removed since is coming in after all,
 * and a song imported since (from a phone, say) is not. A row that becomes
 * yours loses its tick; a row that stops being yours gets one, as it would
 * have had the link been looked up now. The same review comes back when
 * nothing changed, so a screen can tell.
 */
export function refreshAlreadyHave(
  review: Review,
  have: readonly boolean[],
  waiting: readonly boolean[] = [],
): Review {
  if (have.length !== review.items.length) return review
  let changed = false
  const chosen = new Set(review.chosen)
  const items = review.items.map((item, index) => {
    const now = have[index] ?? item.alreadyHave
    // A song of yours that has since reached the bucket says so, and the row's tick is not in question.
    const waits = now && (waiting[index] ?? item.waitingToUpload)
    if (now === item.alreadyHave && waits === item.waitingToUpload) return item
    changed = true
    if (now) chosen.delete(index)
    else chosen.add(index)
    return { ...item, alreadyHave: now, waitingToUpload: waits }
  })
  return changed ? { ...review, items, chosen } : review
}

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

/**
 * How many jobs finished since the queue was last read: done now, and not
 * done then.
 *
 * Done is the one status that means the song is in the library — and, with a
 * bucket, in a snapshot there, since the server does not mark a job done until
 * the upload is (importQueue.ts). `before` is every id read as done so far, or
 * null for a queue not read yet, so a queue that opens with yesterday's
 * finished jobs on it lands nothing. `done` is what to pass next time.
 */
export function landed(
  before: ReadonlySet<string> | null,
  jobs: readonly Pick<ImportJob, 'id' | 'status'>[],
): { landed: number; done: ReadonlySet<string> } {
  const done = new Set(jobs.filter(job => job.status === 'done').map(job => job.id))
  const count = before === null ? 0 : [...done].filter(id => !before.has(id)).length
  return { landed: count, done }
}

/**
 * What Pause all and Resume all have to work on, so each is offered only
 * while it would do something: Pause all takes every job a Cancel would,
 * Resume all every job that was cancelled. A job that failed on its own
 * keeps its own Retry, since a reason worth reading is on its row.
 */
export function queueControls(jobs: readonly Pick<ImportJob, 'status' | 'step'>[]): {
  pausable: number
  resumable: number
} {
  return {
    pausable: jobs.filter(job => jobAction(job) === 'cancel').length,
    resumable: jobs.filter(job => job.status === 'cancelled').length,
  }
}

/** A server's `2026-09-14 08:30:00` is UTC without saying so; an ISO time says so. */
function stampDate(stamp: string): Date {
  return new Date(fromSqliteTime(stamp))
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
