import {
  extractUrls,
  fromSqliteTime,
  isNeteaseUrl,
  neteaseLink,
  spotifyLink,
  youtubeChannel,
  youtubeMusicAlbum,
  youtubeMusicSearch,
  youtubePlaylistId,
  youtubeVideoId,
  IMPORT_STEP_LABELS,
  type ImportEnqueue,
  type ImportEnqueueItem,
  type ImportFound,
  type ImportFrom,
  type ImportJob,
  type ImportPreview,
  type ImportPreviewItem,
  type ImportSource,
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
  // Pause and Pause all call a job off; it waits for Resume, so it is paused.
  if (job.status === 'cancelled') return 'Paused'
  if (job.status === 'done') return 'Added to your library'
  return IMPORT_STEP_LABELS[job.step]
}

/**
 * The one thing a job row offers, if anything: a waiting or downloading job
 * can be called off (`cancel`, which the app calls Pause), a paused one
 * resumed, a failed one retried, and one waiting on its upload tried now.
 */
type JobAction = 'cancel' | 'resume' | 'retry' | 'try-now' | null

export function jobAction(job: Pick<ImportJob, 'status' | 'step'>): JobAction {
  if (job.status === 'queued') return 'cancel'
  // Past the download the song is on its way into the library, and the server
  // no longer takes a cancel for it.
  if (job.status === 'running') {
    return job.step === 'resolving' || job.step === 'downloading' ? 'cancel' : null
  }
  if (job.status === 'cancelled') return 'resume'
  if (job.status === 'error') return waitingToUpload(job) ? 'try-now' : 'retry'
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
  /** What listed the songs: a YouTube link, a 网易云 one, a Spotify one, or a list of names. */
  readonly from: ImportFrom
}

/**
 * A row that is not coming in from this review: the library has the song
 * already, or a job for it is already in the queue. Such a row has no box.
 */
export function taken(item: Pick<ImportPreviewItem, 'alreadyHave' | 'inQueue'>): boolean {
  return item.alreadyHave || item.inQueue
}

/** Pre-tick everything except tracks that look like duplicates, or are already coming. */
export function reviewFrom(preview: ImportPreview): Review {
  return {
    items: preview.items,
    chosen: new Set(
      preview.items.flatMap((item, index) => (taken(item) || notFound(item) ? [] : [index])),
    ),
    playlistTitle: preview.kind === 'playlist' ? preview.playlistTitle : null,
    from: preview.from,
  }
}

// --- songs found by their names -------------------------------------------------

/** A song still being looked for on YouTube: it has no link to download yet. */
export function stillLooking(item: Pick<ImportPreviewItem, 'youtube'>): boolean {
  return item.youtube?.match === 'looking'
}

/** A song looked for on YouTube and not found: there is nothing to import. */
export function notFound(item: Pick<ImportPreviewItem, 'youtube' | 'source'>): boolean {
  return item.source === 'youtube' && item.youtube?.match === 'none'
}

/** The rows still to be looked for, in the list's order; a song yours already is not looked for. */
export function lookingFor(review: Review): number[] {
  return review.items.flatMap((item, index) => (stillLooking(item) && !taken(item) ? [index] : []))
}

/**
 * What YouTube said for some of a review's rows, written into them: the link
 * to download and how sure the match is, and the album and cover where the
 * row had none. A row nothing was found for loses its tick — there is nothing
 * to import — and a row that was found keeps whatever tick it had.
 */
export function withFound(
  review: Review,
  indexes: readonly number[],
  found: readonly (ImportFound | null)[],
): Review {
  const answers = new Map(indexes.map((index, at) => [index, found[at] ?? null]))
  const chosen = new Set(review.chosen)
  const items = review.items.map((item, index) => {
    if (!answers.has(index) || !stillLooking(item)) return item
    const match = answers.get(index)
    if (!match) {
      if (item.source === 'youtube') chosen.delete(index)
      return { ...item, url: item.source === 'youtube' ? '' : item.url, youtube: none }
    }
    const youtube = { url: match.url, match: match.sure ? ('sure' as const) : ('unsure' as const) }
    return {
      ...item,
      ...(item.source === 'youtube' ? { url: match.url } : {}),
      album: item.album || match.album,
      thumbnail: item.thumbnail ?? match.thumbnail,
      duration: item.duration || match.duration,
      youtube,
    }
  })
  return { ...review, items, chosen }
}

const none = { url: null, match: 'none' as const }

/**
 * Take a row's song from 网易云 or from YouTube (the review's switch). 网易云 only
 * when it gives the whole song out. YouTube from the match already found, or,
 * with none yet, by looking for it — the row has no link until it is found.
 */
export function chooseSource(review: Review, index: number, source: ImportSource): Review {
  const item = review.items[index]
  if (!item || item.source === source) return review
  if (source === 'netease') {
    if (!item.netease?.free) return review
    return replaceItem(review, index, { ...item, source, url: item.netease.url })
  }
  const found = item.youtube?.url ?? null
  return replaceItem(review, index, {
    ...item,
    source,
    url: found ?? '',
    youtube: found ? item.youtube : { url: null, match: 'looking' },
  })
}

/**
 * Look for a row's song on YouTube again, by its name as it stands now: for
 * a match that was not the song, or nothing found, once the name is fixed.
 */
export function lookAgain(review: Review, index: number): Review {
  const item = review.items[index]
  if (!item || item.source !== 'youtube' || item.youtube === null) return review
  const chosen = new Set(review.chosen)
  if (!taken(item)) chosen.add(index)
  return {
    ...replaceItem(review, index, { ...item, url: '', youtube: { url: null, match: 'looking' } }),
    chosen,
  }
}

function replaceItem(review: Review, index: number, item: ImportPreviewItem): Review {
  return { ...review, items: review.items.map((each, i) => (i === index ? item : each)) }
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
  queued: readonly boolean[] = [],
): Review {
  if (have.length !== review.items.length) return review
  let changed = false
  const chosen = new Set(review.chosen)
  const items = review.items.map((item, index) => {
    const now = have[index] ?? item.alreadyHave
    // A song of yours that has since reached the bucket says so, and the row's tick is not in question.
    const waits = now && (waiting[index] ?? item.waitingToUpload)
    const coming = queued[index] ?? item.inQueue
    if (now === item.alreadyHave && waits === item.waitingToUpload && coming === item.inQueue)
      return item
    changed = true
    const next = { ...item, alreadyHave: now, waitingToUpload: waits, inQueue: coming }
    if (taken(next)) chosen.delete(index)
    else if (taken(item)) chosen.add(index)
    return next
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

/** The ticked songs that can be downloaded: a song still being looked for, or not found, has no link. */
export function chosenItems(review: Review): readonly ImportPreviewItem[] {
  return review.items.filter((item, index) => review.chosen.has(index) && item.url !== '')
}

/**
 * Whether Import's box holds something to look up: a link, or the names of
 * songs, one per line (the server reads both, importPreview.ts).
 */
export function canLookUp(text: string): boolean {
  return text.trim().length > 0
}

const NETEASE_KINDS = { song: 'song', album: 'album', playlist: 'playlist' } as const
const SPOTIFY_KINDS = { track: 'song', album: 'album', playlist: 'playlist' } as const

/**
 * What Import's box holds, said under it before anything is looked up:
 * "网易云 playlist", "Spotify album", "3 links", "A list of song names" —
 * so a paste that is not what was meant shows before the wait, not after.
 * Null for an empty box.
 */
export function describePaste(text: string): string | null {
  if (!text.trim()) return null
  const urls = extractUrls(text)
  if (urls.length === 0) return 'A list of song names'
  if (urls.length > 1) return `${urls.length} links`
  const url = urls[0] as string
  const netease = neteaseLink(url)
  if (netease) return `网易云 ${NETEASE_KINDS[netease.kind]}`
  if (isNeteaseUrl(url)) return '网易云 link'
  const spotify = spotifyLink(url)
  if (spotify) return `Spotify ${SPOTIFY_KINDS[spotify.kind]}`
  if (youtubeMusicSearch(url)) return 'YouTube Music search'
  if (youtubeMusicAlbum(url)) return 'YouTube Music album'
  if (youtubePlaylistId(url)) return 'YouTube playlist'
  if (youtubeChannel(url)) return 'YouTube artist'
  if (youtubeVideoId(url)) return 'YouTube song'
  return 'A link'
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
 * A job that failed on its own and needs a person: Retry, or let it go. A
 * song waiting on its upload is not one — it is in the library already and
 * goes up by itself — and neither is one that was paused.
 */
export function failedJob(job: Pick<ImportJob, 'status' | 'step'>): boolean {
  return job.status === 'error' && !waitingToUpload(job)
}

/**
 * The queue in its three parts. Each finished job added a song, which the
 * library already shows; what failed needs you, and is kept apart so a long
 * queue cannot bury it; everything else — downloading, waiting, paused, or
 * waiting on its upload — is what is currently importing, in the order the
 * server sends it (the order it was asked for).
 */
export function foldQueue<T extends Pick<ImportJob, 'status' | 'step'>>(
  jobs: readonly T[],
): { importing: readonly T[]; failed: readonly T[]; finished: readonly T[] } {
  return {
    importing: jobs.filter(job => job.status !== 'done' && !failedJob(job)),
    failed: jobs.filter(job => failedJob(job)),
    finished: jobs.filter(job => job.status === 'done'),
  }
}

/**
 * How far one song is through its own steps, 0 to 1, for the ring on its
 * row. Not its bytes: the audio arrives in a fraction of a second, so a bar
 * of those sat at nothing and then jumped to full. The steps are what take
 * the time — reading YouTube's page, the lyrics, the upload — and each one
 * moves the ring on; the download's own percentage fills its share.
 */
export function stepFraction(job: Pick<ImportJob, 'status' | 'step' | 'progress'>): number {
  if (job.status === 'done') return 1
  if (job.status !== 'running') return 0
  switch (job.step) {
    case 'resolving':
      return 0.1
    case 'downloading':
      return 0.2 + 0.2 * Math.min(1, Math.max(0, (job.progress ?? 0) / 100))
    case 'converting':
      return 0.45
    case 'lyrics':
      return 0.6
    case 'saving':
      return 0.75
    case 'uploading':
      return 0.88
    default:
      return 0
  }
}

/** "0:38", "12:04": how long until something starts, rounded up to the second. */
export function clockIn(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/**
 * The words beside the queue's bar: "about 38 min left", "about 1 h 20 min
 * left", or "less than a minute left". Rounded, because it is a guess from
 * the pace so far (the server's `importRun`) and reads as one.
 */
export function timeLeft(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return 'less than a minute left'
  if (minutes < 60) return `about ${minutes} min left`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `about ${hours} h left` : `about ${hours} h ${rest} min left`
}

/**
 * What a press on the queue asks of the server, one job (`id`) or every job
 * it applies to. Without an id, `retry` and `remove` are Retry all and
 * Remove all beside what failed.
 */
export type QueueChange = {
  readonly kind: 'pause' | 'resume' | 'retry' | 'remove'
  readonly id?: string
}

/**
 * The queue as it will be once the server has done what was asked: drawn at
 * once, so the row a person pressed answers under their finger rather than a
 * round trip and a poll later, and moves from there. The server's answer
 * replaces it as soon as it is read; the same lines are drawn here as there
 * (repositories/imports.ts), so the two agree.
 */
export function changeQueue<
  Q extends { jobs: readonly ImportJob[]; active: number; queued: number },
>(queue: Q, change: QueueChange): Q {
  const mine = (job: ImportJob): boolean => change.id === undefined || job.id === change.id
  const waiting = (job: ImportJob): ImportJob => ({
    ...job,
    status: 'queued',
    step: 'waiting',
    error: null,
    progress: null,
  })
  let jobs: ImportJob[]
  switch (change.kind) {
    case 'pause':
      jobs = queue.jobs.map(job =>
        mine(job) && jobAction(job) === 'cancel'
          ? { ...job, status: 'cancelled', step: 'finished', progress: null }
          : job,
      )
      break
    case 'resume':
      jobs = queue.jobs.map(job => (mine(job) && job.status === 'cancelled' ? waiting(job) : job))
      break
    case 'retry':
      // One job is retried from failed or paused, as the server's retry
      // takes it; Retry all takes only what failed.
      jobs = queue.jobs.map(job =>
        mine(job) &&
        (change.id === undefined
          ? failedJob(job)
          : job.status === 'error' || job.status === 'cancelled')
          ? waiting(job)
          : job,
      )
      break
    case 'remove':
      jobs = queue.jobs.filter(job =>
        change.id === undefined ? !failedJob(job) : !(job.id === change.id && dismissable(job)),
      )
      break
  }
  return {
    ...queue,
    jobs,
    active: jobs.filter(job => job.status === 'running').length,
    queued: jobs.filter(job => job.status === 'queued').length,
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
 * while it would do something: Pause all takes every job a Pause would,
 * Resume all every job that was paused. What failed has Retry all, beside
 * its own list (`foldQueue`).
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
