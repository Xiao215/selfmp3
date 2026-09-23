import { plural } from '@selfmp3/shared'
import type { ApplyMetadata, FixCoversStatus, MetadataCandidate, Song } from '@selfmp3/shared'

/**
 * Fixing a song's metadata, without the dialog.
 *
 * Current values on one side, suggestions from iTunes and MusicBrainz on the
 * other, and a per-field list of what a suggestion would change, so exactly
 * the corrections agreed with are applied and nothing else.
 */

export type Field = 'title' | 'artist' | 'album' | 'albumArtist' | 'year' | 'trackNo' | 'artwork'

export const FIELD_LABELS: Record<Field, string> = {
  title: 'Title',
  artist: 'Artist',
  album: 'Album',
  albumArtist: 'Album artist',
  year: 'Year',
  trackNo: 'Track №',
  // The picture, not a word: "Artwork" beside struck-through text read as one
  // more text field.
  artwork: 'Cover',
}

export const SOURCE_LABELS: Record<MetadataCandidate['source'], string> = {
  itunes: 'iTunes',
  musicbrainz: 'MusicBrainz',
}

interface Diff {
  readonly field: Field
  readonly current: string
  readonly proposed: string
  readonly value: string | number
}

/** A value as the dialog prints it: a dash for nothing. */
export function shown(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === '' ? '—' : String(value)
}

/** Every field where the suggestion offers something different from the song. */
export function diffFields(
  song: Pick<Song, 'title' | 'artist' | 'album' | 'albumArtist' | 'year' | 'trackNo' | 'hasArt'>,
  candidate: MetadataCandidate,
): Diff[] {
  const diffs: Diff[] = []
  const push = (
    field: Exclude<Field, 'artwork'>,
    current: string | number | null,
    proposed: string | number | undefined,
  ): void => {
    if (proposed === undefined || proposed === '' || proposed === current) return
    diffs.push({ field, current: shown(current), proposed: shown(proposed), value: proposed })
  }
  push('title', song.title, candidate.title)
  push('artist', song.artist, candidate.artist)
  push('album', song.album, candidate.album)
  push('albumArtist', song.albumArtist, candidate.albumArtist)
  push('year', song.year, candidate.year)
  push('trackNo', song.trackNo, candidate.trackNo)
  // Whether it is the same picture as the current cover cannot be known from
  // here, so the row shows both and lets the eye decide.
  if (candidate.artworkUrl) {
    diffs.push({
      field: 'artwork',
      current: song.hasArt ? 'current cover' : '—',
      proposed: `cover from ${SOURCE_LABELS[candidate.source]}`,
      value: candidate.artworkUrl,
    })
  }
  return diffs
}

/**
 * What starts ticked: every text correction, and the cover only when the song
 * has none. Replacing a cover already there is a choice to make by looking.
 */
export function defaultTicked(
  song: Pick<Song, 'hasArt'>,
  diffs: readonly Diff[],
): ReadonlySet<Field> {
  return new Set(
    diffs.filter(diff => diff.field !== 'artwork' || !song.hasArt).map(diff => diff.field),
  )
}

/** What goes to the server: only the ticked fields, each as the schema wants it. */
export function applyInput(
  diffs: readonly Diff[],
  ticked: ReadonlySet<Field>,
): ApplyMetadata | null {
  const input: ApplyMetadata = {}
  for (const diff of diffs) {
    if (!ticked.has(diff.field)) continue
    if (diff.field === 'artwork') input.artworkUrl = String(diff.value)
    else if (diff.field === 'year' || diff.field === 'trackNo')
      input[diff.field] = Number(diff.value)
    else input[diff.field] = String(diff.value)
  }
  return Object.keys(input).length > 0 ? input : null
}

export function appliedCount(diffs: readonly Diff[], ticked: ReadonlySet<Field>): number {
  return diffs.filter(diff => ticked.has(diff.field)).length
}

export function applyLabel(count: number, pending: boolean): string {
  if (pending) return 'Applying…'
  if (count === 0) return 'Apply'
  return `Apply ${plural(count, 'change', 'changes')}`
}

/** What a screen reader hears for a change row. */
export function diffLabel(diff: Diff, hasArt: boolean): string {
  if (diff.field === 'artwork') {
    return `${hasArt ? 'Replace the cover with the' : 'Add the'} ${diff.proposed}`
  }
  const from = diff.current === '—' ? 'nothing' : diff.current
  return `Apply ${FIELD_LABELS[diff.field].toLowerCase()}: ${from} becomes ${diff.proposed}`
}

/** "YOASOBI · Idol - Single · 2023 · 3:33", from what the suggestion has. */
export function candidateLine(
  candidate: MetadataCandidate,
  formatDuration: (seconds: number) => string,
): string {
  return [
    candidate.artist || 'Unknown artist',
    candidate.album || null,
    candidate.year ?? null,
    candidate.durationSec ? formatDuration(candidate.durationSec) : null,
  ]
    .filter(part => part !== null && part !== '')
    .join(' · ')
}

export const scorePercent = (score: number): string => `${Math.round(score * 100)}%`

// --- the cover-art pass (Settings → Library) ----------------------------------

export function missingArtCount(songs: readonly Pick<Song, 'hasArt'>[]): number {
  return songs.filter(song => !song.hasArt).length
}

export function coverArtHint(missing: number): string {
  return missing === 0
    ? 'Every song has artwork.'
    : `${plural(missing, 'song has', 'songs have')} none. Looks each one up on iTunes and MusicBrainz and keeps confident matches only.`
}

/** "Checking 3 of 12 — アイドル · 2 found", while the pass runs. */
export function coverProgress(status: FixCoversStatus): string {
  const at = Math.min(status.done + 1, status.total)
  return `Checking ${at} of ${status.total}${status.currentTitle ? ` — ${status.currentTitle}` : ''}${
    status.found > 0 ? ` · ${status.found} found` : ''
  }`
}

/** The result once it has finished or been stopped; nothing before. */
export function coverResult(status: FixCoversStatus): string | null {
  if (status.status !== 'done' && status.status !== 'cancelled') return null
  const stopped = status.status === 'cancelled' ? 'Stopped. ' : ''
  const unchecked = status.done < status.total ? ` (${status.total - status.done} not checked)` : ''
  return `${stopped}Found artwork for ${status.found} of ${plural(status.done, 'song', 'songs')}${unchecked}.`
}
