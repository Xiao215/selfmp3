import { cleanArtist, cleanTitle } from '@selfmp3/shared'

/**
 * A list of songs pasted as words, made into tracks to find on YouTube.
 *
 * Two shapes are understood, both without touching the network:
 *  - a CSV/TSV export (Exportify, TuneMyMusic, Apple Music's playlist export)
 *  - plain text, one song per line, in any of the usual "Artist - Title",
 *    "Title by Artist" or bare "Title" forms
 *
 * Everything here is pure so the long tail of messy real-world input can be
 * pinned down by tests rather than discovered one support question at a time.
 */

/** One song as another app described it, before it is found anywhere. */
export interface ListedTrack {
  readonly title: string
  readonly artist: string
  readonly album: string
  /** Seconds; 0 when the source did not say. */
  readonly duration: number
}

/** A pasted list, read. */
interface TrackList {
  readonly kind: 'text' | 'csv'
  readonly playlistName: string | null
  readonly tracks: ListedTrack[]
  /** Lines that could not be understood. */
  readonly skipped: string[]
}

// Titles and artists are cleaned by packages/shared/src/titles.ts, which the
// import path shares.

/** "3:45" → 225, "1:02:03" → 3723, "225" → 225, "225000" (ms) → 225. */
export function parseDurationValue(raw: string, unit: 'seconds' | 'ms' | 'auto' = 'auto'): number {
  const text = raw.trim()
  if (!text) return 0
  const clock = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text)
  if (clock) {
    const [, a = '0', b = '0', c] = clock
    return c === undefined
      ? Number(a) * 60 + Number(b)
      : Number(a) * 3600 + Number(b) * 60 + Number(c)
  }
  const value = Number.parseFloat(text)
  if (!Number.isFinite(value) || value < 0) return 0
  if (unit === 'ms') return Math.round(value / 1000)
  if (unit === 'seconds') return Math.round(value)
  // Nothing is 3 hours long in a playlist; a large number must be milliseconds.
  return value > 10_000 ? Math.round(value / 1000) : Math.round(value)
}

// --- CSV -------------------------------------------------------------------

const TITLE_COLUMNS = ['track name', 'track', 'song name', 'song', 'title', 'name', 'track title']
const ARTIST_COLUMNS = [
  'artist name(s)',
  'artist name',
  'artist names',
  'artists',
  'artist(s)',
  'artist',
]
const ALBUM_COLUMNS = ['album name', 'album', 'album title']
const DURATION_COLUMNS = ['duration (ms)', 'duration_ms', 'duration', 'time', 'length']
const PLAYLIST_COLUMNS = ['playlist name', 'playlist']

/** RFC-4180-ish: quoted fields, doubled quotes, newlines inside quotes. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i] as string
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += char
      }
      continue
    }
    if (char === '"') {
      quoted = true
    } else if (char === delimiter) {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter(cells => cells.some(cell => cell.trim().length > 0))
}

function columnIndex(header: readonly string[], names: readonly string[]): number {
  for (const name of names) {
    const index = header.indexOf(name)
    if (index >= 0) return index
  }
  return -1
}

/** Decide whether the first line looks like an export header, and with what delimiter. */
export function detectCsv(text: string): { delimiter: string } | null {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  for (const delimiter of ['\t', ',', ';']) {
    if (!firstLine.includes(delimiter)) continue
    const header = firstLine
      .split(delimiter)
      .map(cell => cell.trim().replace(/^"|"$/g, '').toLowerCase())
    const hasTitle = columnIndex(header, TITLE_COLUMNS) >= 0
    const hasArtist = columnIndex(header, ARTIST_COLUMNS) >= 0
    // "Name,Artist" is the Apple Music shape; "Track Name" alone is Exportify's.
    if (hasTitle && (hasArtist || header.length >= 3)) return { delimiter }
  }
  return null
}

function parseCsv(text: string, delimiter: string): TrackList {
  const rows = parseDelimited(text, delimiter)
  const header = (rows[0] ?? []).map(cell => cell.trim().toLowerCase())
  const titleAt = columnIndex(header, TITLE_COLUMNS)
  const artistAt = columnIndex(header, ARTIST_COLUMNS)
  const albumAt = columnIndex(header, ALBUM_COLUMNS)
  const durationAt = columnIndex(header, DURATION_COLUMNS)
  const playlistAt = columnIndex(header, PLAYLIST_COLUMNS)
  const durationUnit: 'seconds' | 'ms' | 'auto' = /\bms\b/.test(header[durationAt] ?? '')
    ? 'ms'
    : header[durationAt] === 'time'
      ? 'seconds'
      : 'auto'

  const tracks: ListedTrack[] = []
  const skipped: string[] = []
  let playlistName: string | null = null

  for (const cells of rows.slice(1)) {
    const title = cleanTitle(cells[titleAt] ?? '')
    if (!title) {
      skipped.push(cells.join(delimiter === '\t' ? '\t' : delimiter).trim())
      continue
    }
    const rawArtist = artistAt >= 0 ? (cells[artistAt] ?? '') : ''
    // Exportify separates several artists with commas; keep the first as the
    // lead and let the search engine cope with the rest.
    const artist = cleanArtist(rawArtist.split(/\s*[,;]\s*/)[0] ?? '')
    const album = albumAt >= 0 ? cleanTitle(cells[albumAt] ?? '') : ''
    const duration = durationAt >= 0 ? parseDurationValue(cells[durationAt] ?? '', durationUnit) : 0
    if (playlistAt >= 0 && !playlistName && cells[playlistAt]?.trim()) {
      playlistName = cells[playlistAt].trim()
    }
    tracks.push({ title, artist, album, duration })
  }

  return { kind: 'csv', playlistName, tracks, skipped }
}

// --- plain text ------------------------------------------------------------

/** "1. ", "(3) ", "12: " at the start of a line — but not "22 - Taylor Swift". */
const LEADING_NUMBER = /^\(?\d{1,3}[.)\]:]\s+(?=\S)/
/** A bare "7 " prefix; only stripped when every line in the list counts up. */
const BARE_NUMBER = /^(\d{1,3})\s+(?=\S)/
/** A "3:45" (or "3:45 " / "(3:45)") at the end of a line. */
const TRAILING_DURATION = /\s+[([]?(\d{1,2}:\d{2}(?::\d{2})?)[)\]]?\s*$/
/** The separator between the two halves: a spaced hyphen, en/em dash or pipe. */
const SEPARATOR = /\s+[-–—|]\s+|\s*[–—]\s*/

interface SplitLine {
  left: string
  right: string | null
  /** Set when the line itself made the order unambiguous ("Title by Artist"). */
  order: 'artist-first' | 'title-first' | null
  duration: number
}

function splitLine(line: string, stripBareNumber: boolean): SplitLine | null {
  let text = line.replace(LEADING_NUMBER, '').trim()
  if (stripBareNumber) text = text.replace(BARE_NUMBER, '')
  let duration = 0
  const trailing = TRAILING_DURATION.exec(text)
  if (trailing?.[1]) {
    duration = parseDurationValue(trailing[1])
    text = text.slice(0, trailing.index).trim()
  }
  // A duration that followed a separator leaves it dangling: "Song -".
  text = text.replace(/\s*[-–—|]\s*$/, '').trim()
  if (!text) return null

  const by = BY_SPLIT.exec(text)
  const dash = text.split(SEPARATOR)
  if (dash.length >= 2 && dash[0]?.trim() && dash.slice(1).join(' - ').trim()) {
    // Split on the first separator only: "Artist - Song - Live" keeps its suffix.
    return { left: dash[0].trim(), right: dash.slice(1).join(' - ').trim(), order: null, duration }
  }
  if (by?.[1] && by[2]) {
    return { left: by[2].trim(), right: by[1].trim(), order: 'artist-first', duration }
  }
  return { left: text, right: null, order: null, duration }
}

/**
 * Is a pasted list "Artist - Title" or "Title - Artist"?
 *
 * No single line can tell, but a whole playlist usually can: an artist appears
 * on several lines, a title almost never does. Whichever side repeats more is
 * the artist side; on a tie the far more common "Artist - Title" wins.
 */
export function guessOrder(
  pairs: readonly { left: string; right: string }[],
): 'artist-first' | 'title-first' {
  const distinct = (values: string[]): number => new Set(values.map(v => v.toLowerCase())).size
  const lefts = distinct(pairs.map(pair => pair.left))
  const rights = distinct(pairs.map(pair => pair.right))
  if (rights < lefts) return 'title-first'
  if (lefts < rights) return 'artist-first'

  // Same repetition: a side that is just a number ("22", "1999") is a title.
  const numericLeft = pairs.filter(pair => /^\d+$/.test(pair.left)).length
  const numericRight = pairs.filter(pair => /^\d+$/.test(pair.right)).length
  return numericLeft > numericRight ? 'title-first' : 'artist-first'
}

/**
 * "Hello by Adele" — but not "Stand By Me". Only a lower-case "by" counts,
 * and never one followed by a pronoun, which is how titles use the word.
 */
const BY_SPLIT = /^(.+?) by (?!(?:me|you|your|myself|yourself|now|then|the|my|a|an|and)\b)(.+)$/

/** "1 Song", "2 Song", "3 Song" — every line numbered, counting up. */
function isCountedList(lines: readonly string[]): boolean {
  if (lines.length < 2) return false
  let previous = -1
  for (const line of lines) {
    const match = BARE_NUMBER.exec(line.replace(LEADING_NUMBER, ''))
    if (!match?.[1]) return false
    const n = Number(match[1])
    if (previous >= 0 && n !== previous + 1) return false
    previous = n
  }
  return true
}

function parseLines(text: string): TrackList {
  const lines = text
    .split(/\r?\n|\r/)
    .map(line => line.trim())
    .filter(line => line.length > 0)
  const splits: { raw: string; split: SplitLine }[] = []
  const skipped: string[] = []
  const stripBareNumber = isCountedList(lines)

  for (const line of lines) {
    const split = splitLine(line, stripBareNumber)
    if (!split) {
      skipped.push(line)
      continue
    }
    splits.push({ raw: line, split })
  }

  const pairs = splits
    .filter(entry => entry.split.right !== null && entry.split.order === null)
    .map(entry => ({ left: entry.split.left, right: entry.split.right as string }))
  const order = guessOrder(pairs)

  const tracks: ListedTrack[] = []
  for (const { split } of splits) {
    let artist = ''
    let title = split.left
    if (split.right !== null) {
      const artistFirst = (split.order ?? order) === 'artist-first'
      artist = artistFirst ? split.left : split.right
      title = artistFirst ? split.right : split.left
    }
    const cleaned = cleanTitle(title)
    if (!cleaned) {
      skipped.push(split.left)
      continue
    }
    tracks.push({
      title: cleaned,
      artist: cleanArtist(artist),
      album: '',
      duration: split.duration,
    })
  }

  return { kind: 'text', playlistName: null, tracks, skipped }
}

// --- entry point -----------------------------------------------------------

/** Read pasted text or CSV. */
export function parseTrackList(input: string): TrackList {
  const text = input.replace(/^\uFEFF/, '')
  const csv = detectCsv(text)
  return csv ? parseCsv(text, csv.delimiter) : parseLines(text)
}
