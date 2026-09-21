/**
 * The facts about a song, put into words and drawings.
 *
 * Shared so the phone and the desktop describe a song the same way: a tempo
 * written like a score, the energy as a wave, the file format as a name
 * rather than a MIME type. Pure, and compiled without a DOM, so a URL is
 * parsed by hand rather than with `URL`.
 */

/**
 * No-break spaces: the marking never splits across a wrap. Full width rather
 * than thin, because the ♩ often comes from a fallback font and a thin space
 * beside it all but disappears.
 */
const NBSP = ' '

/** ♩ = 130, set like a metronome marking. */
export function tempoMark(bpm: number): string {
  return `♩${NBSP}=${NBSP}${Math.round(bpm)}`
}

/** A plain word for the pace, not an Italian one. */
export function tempoWords(bpm: number): string {
  if (bpm < 70) return 'slow'
  if (bpm < 100) return 'relaxed'
  if (bpm < 125) return 'moderate'
  if (bpm < 150) return 'fast'
  return 'very fast'
}

interface WaveShape {
  /** Peak distance from the centre line, in the drawing's own units. */
  readonly amplitude: number
  /** Full periods across the width. */
  readonly cycles: number
}

const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0

/**
 * The energy waveform's shape, straight from a 0–1 energy: taller and denser
 * as a song gets more intense. Height leaves room for the stroke; the floor
 * keeps a quiet song from drawing a flat line, which would read as "no data"
 * rather than "calm".
 */
export function waveShape(energy: number, height: number, strokeWidth = 1.5): WaveShape {
  const e = clamp01(energy)
  const room = height / 2 - strokeWidth / 2 - 0.25
  return {
    amplitude: room * (0.15 + 0.85 * e),
    cycles: 1 + 2.5 * e,
  }
}

/** The SVG path, sampled every half unit: smooth at any size it is drawn. */
export function energyWavePath(energy: number, width: number, height: number): string {
  const { amplitude, cycles } = waveShape(energy, height)
  const middle = height / 2
  const steps = Math.max(2, Math.round(width * 2))
  let path = ''
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * width
    const y = middle - amplitude * Math.sin((2 * Math.PI * cycles * x) / width)
    path += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`
  }
  return path
}

const FORMAT_BY_MIME: Record<string, string> = {
  'audio/mp4': 'AAC (.m4a)',
  'audio/mpeg': 'MP3',
  'audio/flac': 'FLAC',
  'audio/ogg': 'Ogg Vorbis',
  'audio/opus': 'Opus',
  'audio/wav': 'WAV',
  'audio/aac': 'AAC',
  'audio/webm': 'WebM',
}

/** "AAC (.m4a)" rather than audio/mp4; the extension when the type is unknown. */
export function formatName(mime: string, path: string): string {
  const known = FORMAT_BY_MIME[mime]
  if (known) return known
  const extension = /\.([a-z0-9]+)$/i.exec(path)?.[1]
  return extension ? extension.toUpperCase() : mime
}

/** "YouTube Music" rather than music.youtube.com; the host for anything else. */
export function sourceName(url: string): string {
  const host = /^[a-z][a-z0-9+.-]*:\/\/([^/?#:]+)/i.exec(url)?.[1]?.toLowerCase()
  if (!host) return url
  const bare = host.replace(/^www\./, '')
  if (bare === 'music.youtube.com') return 'YouTube Music'
  if (bare === 'youtube.com' || bare === 'youtu.be' || bare === 'm.youtube.com') return 'YouTube'
  return bare
}

/** The database's `YYYY-MM-DD HH:MM:SS` (UTC) as "10 Sep 2026". */
export function formatAddedDate(value: string): string {
  const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}
