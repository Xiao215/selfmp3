/**
 * LRC writing — the other half of `lrc.ts`.
 *
 * Used by the timing editor: the user taps a time for each line, and this
 * turns those taps into a file the parser (and every other player) reads back
 * identically. Times are written as `[mm:ss.xx]`, the most widely understood
 * form.
 */

export interface TimedLine {
  /** Seconds, or null for a line the user has not tapped yet. */
  readonly time: number | null
  readonly text: string
}

/** `83.456` → `[01:23.46]`. Negative or non-finite times clamp to zero. */
export function formatLrcTimestamp(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  // Round to centiseconds first so 59.999 becomes 1:00.00, not 0:60.00.
  const centis = Math.round(safe * 100)
  const minutes = Math.floor(centis / 6000)
  const rest = centis - minutes * 6000
  const secs = Math.floor(rest / 100)
  const frac = rest - secs * 100
  return `[${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(frac).padStart(2, '0')}]`
}

/**
 * Build an LRC document from tapped lines.
 *
 * Lines without a time are dropped — an untimed line in a synced file would
 * either be silently lost by most players or shown at the wrong moment, and
 * the editor makes untimed lines visible before saving. Lines are emitted in
 * time order regardless of the order they were tapped in, and blank lines are
 * kept when timed (a deliberate pause in the display).
 */
export function buildLrc(
  lines: readonly TimedLine[],
  meta: { readonly title?: string; readonly artist?: string } = {},
): string {
  const header: string[] = []
  if (meta.title?.trim()) header.push(`[ti:${meta.title.trim()}]`)
  if (meta.artist?.trim()) header.push(`[ar:${meta.artist.trim()}]`)

  const timed = lines
    .map((line, index) => ({ ...line, index }))
    .filter((line): line is TimedLine & { index: number; time: number } => line.time !== null)
    .sort((a, b) => a.time - b.time || a.index - b.index)
    .map(line => `${formatLrcTimestamp(line.time)}${line.text.trim()}`)

  return [...header, ...timed].join('\n') + (timed.length > 0 ? '\n' : '')
}

/** Split pasted text into editable lines, dropping any existing timestamps. */
export function splitPlainLyrics(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.replace(/\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/g, '').trim())
    .filter((line, index, all) => {
      // Collapse runs of blank lines; one blank between verses is plenty.
      if (line !== '') return true
      return index > 0 && all[index - 1] !== ''
    })
  // A trailing blank is just the file's final newline, not a pause.
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}
