import type {
  MigrateCandidate,
  MigrateEnqueue,
  MigrateMatchItem,
  MigrateMatchJob,
  MigrateParseResult,
} from '@selfmp3/shared'

/**
 * Migrating a playlist, without the screen: the web's `MigrateView` rules.
 *
 * Three stages on one page: paste, match, review. Matching is a server job
 * that is polled, because fifty YouTube searches take a minute and a phone
 * should be able to lock and come back to a finished table.
 */

export const PLACEHOLDER = [
  'Daft Punk - Get Lucky',
  'Hello by Adele',
  'Radiohead — Creep',
  '',
  '…or paste a CSV export, or a public Spotify playlist link',
].join('\n')

export type Stage = 'input' | 'matching' | 'review'

export function stageOf(job: Pick<MigrateMatchJob, 'status'> | null | undefined): Stage {
  if (!job) return 'input'
  return job.status === 'running' ? 'matching' : 'review'
}

/** A track that has been searched, with the upload chosen for it (the best, unless picked). */
export interface MigrateRow {
  readonly index: number
  readonly item: MigrateMatchItem
  readonly match: MigrateCandidate | null
}

export function migrateRows(
  job: Pick<MigrateMatchJob, 'items'> | null | undefined,
  picked: ReadonlyMap<number, number>,
): readonly MigrateRow[] {
  return (job?.items ?? []).flatMap((item, index) =>
    item ? [{ index, item, match: item.candidates[picked.get(index) ?? 0] ?? null }] : [],
  )
}

/** Worth importing without asking: a confident match that is not already here. */
export function initialChosen(job: Pick<MigrateMatchJob, 'items'>): ReadonlySet<number> {
  return new Set(
    job.items.flatMap((item, index) => {
      const best = item?.candidates[0]
      return best && best.confidence >= 0.5 && !item.alreadyHave ? [index] : []
    }),
  )
}

/** Only rows with a match can be ticked. */
export function matchedIndexes(rows: readonly MigrateRow[]): ReadonlySet<number> {
  return new Set(rows.filter(row => row.match).map(row => row.index))
}

export function chosenRows(
  rows: readonly MigrateRow[],
  chosen: ReadonlySet<number>,
): (MigrateRow & { match: MigrateCandidate })[] {
  return rows.filter((row): row is MigrateRow & { match: MigrateCandidate } =>
    Boolean(row.match && chosen.has(row.index)),
  )
}

export type ConfidenceTone = 'good' | 'fair' | 'poor'

/**
 * How sure a match is, as a tone, a word and a mark. Green, amber and red alone
 * fail anyone who cannot separate those hues, so each level has its own shape
 * and word as well.
 */
export function confidenceLevel(confidence: number): {
  tone: ConfidenceTone
  word: 'Strong' | 'Likely' | 'Weak'
  mark: string
} {
  if (confidence >= 0.8) return { tone: 'good', word: 'Strong', mark: '✓' }
  if (confidence >= 0.5) return { tone: 'fair', word: 'Likely', mark: '~' }
  return { tone: 'poor', word: 'Weak', mark: '!' }
}

export const percent = (confidence: number): string => `${Math.round(confidence * 100)}%`

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`

export function matchingHeading(job: Pick<MigrateMatchJob, 'completed' | 'total'>): string {
  return `Matching ${job.completed} of ${job.total}`
}

export function matchedHeading(rows: readonly MigrateRow[]): string {
  const matched = rows.filter(row => row.match).length
  return `${matched} of ${plural(rows.length, 'song', 'songs')} matched`
}

/** "Searching… 3 to go", while there are tracks still to search. */
export function pendingNote(
  job: Pick<MigrateMatchJob, 'status' | 'total'>,
  rows: readonly MigrateRow[],
): string | null {
  const left = job.total - rows.length
  return job.status === 'running' && left > 0 ? `Searching… ${left} to go` : null
}

/** The lines the parser could not read, so they can be fixed by hand. */
export function skippedNote(parsed: Pick<MigrateParseResult, 'skipped'> | null): string | null {
  if (!parsed || parsed.skipped.length === 0) return null
  const { skipped } = parsed
  return `Could not read ${plural(skipped.length, 'line', 'lines')}: ${skipped
    .slice(0, 3)
    .join(' · ')}${skipped.length > 3 ? ' …' : ''}`
}

export function importSongsLabel(count: number): string {
  return `Import ${plural(count, 'song', 'songs')}`
}

export function queuedMessage(count: number): string {
  return `${plural(count, 'song', 'songs')} queued.`
}

/** What goes to `/api/migrate/enqueue`: the source's names, the upload's audio. */
export function enqueueRequest(
  rows: readonly MigrateRow[],
  chosen: ReadonlySet<number>,
  options: { tagIds: ReadonlySet<number>; playlistName: string },
): MigrateEnqueue {
  return {
    items: chosenRows(rows, chosen).map(({ item, match }) => ({
      url: match.url,
      title: item.source.title,
      artist: item.source.artist,
      album: item.source.album,
      thumbnail: match.thumbnail,
      duration: item.source.duration || match.duration,
    })),
    tagIds: [...options.tagIds],
    playlistName: options.playlistName.trim() || null,
  }
}
