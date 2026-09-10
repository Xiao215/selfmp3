/**
 * LRC parsing.
 *
 * The format is loose in the wild, so this parser is deliberately forgiving:
 * it accepts `[mm:ss]`, `[mm:ss.xx]` and `[mm:ss:xx]`, tolerates several
 * timestamps on one line (a repeated chorus), skips metadata tags like
 * `[ar: ...]`, and falls back to treating the whole file as plain text when it
 * cannot find enough real timestamps to be useful.
 */

export interface SyncedLine {
  /** Offset from the start of the track, in seconds. */
  readonly time: number
  readonly text: string
}

export type ParsedLyrics =
  | { readonly synced: true; readonly lines: readonly SyncedLine[] }
  | { readonly synced: false; readonly lines: readonly string[] }

/** `[ar:Artist]`, `[length:03:21]` and friends — informational, not timing. */
const METADATA_TAG = /^\[(?:ar|ti|al|au|by|offset|length|re|ve|tool):/i
const TIMESTAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g

export function parseLyrics(raw: string): ParsedLyrics {
  const synced: SyncedLine[] = []
  let sawTimestamp = false

  for (const rawLine of raw.split(/\r?\n/)) {
    if (METADATA_TAG.test(rawLine.trim())) continue

    TIMESTAMP.lastIndex = 0
    const stamps = [...rawLine.matchAll(TIMESTAMP)]
    if (stamps.length === 0) continue
    sawTimestamp = true

    const text = rawLine.replace(TIMESTAMP, '').replace(/\[[^\]]*\]/g, '').trim()
    for (const stamp of stamps) {
      const minutes = Number(stamp[1])
      const seconds = Number(stamp[2])
      // A 2-digit fraction is centiseconds, a 3-digit one is milliseconds.
      const fractionRaw = stamp[3] ?? ''
      const fraction = fractionRaw ? Number(fractionRaw) / Math.pow(10, fractionRaw.length) : 0
      const time = minutes * 60 + seconds + fraction
      if (Number.isFinite(time)) synced.push({ time, text })
    }
  }

  // One lone timestamp is usually a stray tag, not a synced file.
  if (sawTimestamp && synced.length >= 2) {
    synced.sort((a, b) => a.time - b.time)
    return { synced: true, lines: synced }
  }

  const plain = raw
    .split(/\r?\n/)
    .filter(line => !METADATA_TAG.test(line.trim()))
    .map(line => line.replace(TIMESTAMP, '').trimEnd())

  // Trim leading and trailing blank lines without touching interior spacing.
  let start = 0
  let end = plain.length
  while (start < end && plain[start]?.trim() === '') start++
  while (end > start && plain[end - 1]?.trim() === '') end--

  return { synced: false, lines: plain.slice(start, end) }
}

/**
 * Index of the line that should be highlighted at `time`, or -1 before the
 * first line. Binary search, because this runs on every timeupdate tick.
 *
 * `lead` highlights a line slightly early, which reads as more in-time than a
 * perfectly literal match because the eye needs a moment to travel.
 */
export function activeLineIndex(
  lines: readonly SyncedLine[],
  time: number,
  lead = 0.25,
): number {
  const target = time + lead
  let low = 0
  let high = lines.length - 1
  let found = -1
  while (low <= high) {
    const mid = (low + high) >> 1
    const line = lines[mid]
    if (line === undefined) break
    if (line.time <= target) {
      found = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return found
}

/** True when the text looks like it carries usable timing information. */
export function isSynced(raw: string): boolean {
  return parseLyrics(raw).synced
}
