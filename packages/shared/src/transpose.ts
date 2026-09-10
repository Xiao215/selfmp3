import { camelotFromKey, keyName, PITCH_NAMES, type KeyMode } from './features.js'

/**
 * Transposition helpers for the practice panel.
 *
 * The audio itself is not pitch-shifted (see docs/features/practice-tools.md
 * for why); these shift the *displayed* key so someone playing along with a
 * capo, or singing a song a tone down, can see what key they are actually in.
 */

export interface ParsedKey {
  readonly pitchClass: number
  readonly mode: KeyMode
}

/** Accepts the analyser's own spelling plus common ASCII variants ("F#", "Bb"). */
export function parseKeyName(key: string): ParsedKey | null {
  const match = /^\s*([A-Ga-g])\s*([#♯b♭]?)\s*(major|minor|maj|min|m)?\s*$/.exec(key)
  if (!match) return null

  const letter = match[1]?.toUpperCase() ?? 'C'
  const natural: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
  let pitchClass = natural[letter] ?? 0
  const accidental = match[2] ?? ''
  if (accidental === '#' || accidental === '♯') pitchClass += 1
  if (accidental === 'b' || accidental === '♭') pitchClass -= 1

  const modeWord = (match[3] ?? 'major').toLowerCase()
  const mode: KeyMode = modeWord === 'minor' || modeWord === 'min' || modeWord === 'm' ? 'minor' : 'major'

  return { pitchClass: ((pitchClass % 12) + 12) % 12, mode }
}

/** "A minor" + 2 → "B minor"; returns null when the key cannot be parsed. */
export function transposeKey(key: string, semitones: number): string | null {
  const parsed = parseKeyName(key)
  if (!parsed) return null
  return keyName(parsed.pitchClass + semitones, parsed.mode)
}

/** The Camelot code after transposing, for people who think in wheel positions. */
export function transposeCamelot(key: string, semitones: number): string | null {
  const parsed = parseKeyName(key)
  if (!parsed) return null
  return camelotFromKey(parsed.pitchClass + semitones, parsed.mode)
}

/** "+2", "−3", "0" — typographic minus, since it is displayed not typed. */
export function formatSemitones(semitones: number): string {
  if (semitones === 0) return '0'
  return semitones > 0 ? `+${semitones}` : `−${Math.abs(semitones)}`
}

/**
 * How far playback speed moves the pitch when pitch lock is off.
 *
 * Speed multiplies frequency, so the shift in semitones is 12·log₂(rate):
 * 0.5× is an octave down, 1.25× is a little under four semitones up.
 */
export function rateToSemitones(rate: number): number {
  if (!(rate > 0)) return 0
  return Math.round(12 * Math.log2(rate) * 10) / 10
}

/** The pitch names, so a UI can show a wheel or a list. */
export const TRANSPOSE_PITCHES = PITCH_NAMES
