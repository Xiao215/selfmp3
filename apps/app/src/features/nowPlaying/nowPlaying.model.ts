import type { LyricsLanguage, ParsedLyrics } from '@selfmp3/shared'

/**
 * Now Playing's rules, with nothing drawn: where things sit on a computer's
 * page, which words a song has to show, and when "Next" should appear.
 *
 * The numbers are the web app's stylesheet (`feat-now-playing.css`), whose
 * sizes follow the page's own width and height rather than the window's.
 */

export type StageTab = 'lyrics' | 'queue' | 'about'
export type PageMode = 'stage' | 'focus'

/** The tab in the address, or the lyrics when it names nothing we know. */
export function parseTab(value: unknown): StageTab {
  return value === 'queue' || value === 'about' ? value : 'lyrics'
}

export function parseMode(value: unknown): PageMode {
  return value === 'focus' ? 'focus' : 'stage'
}

/** Where the line being sung sits, as a fraction of the height from the top. */
export const LYRIC_ANCHOR = 0.4
/** A line lights up a moment before it is sung. */
export const LYRIC_LEAD = 0.25
/** How long a hand scroll holds off the auto-centring, so reading ahead is not fought. */
export const MANUAL_SCROLL_MS = 4_000
/** Focus hides its chrome after this long without the mouse or a key. */
export const IDLE_MS = 3_000
/** How close to the end "Next" slides in. */
export const UP_NEXT_LEAD = 15

/**
 * What a song has to read, in one of four states.
 *
 * `instrumental` and `missing` are kept apart on purpose: an instrumental is
 * known to have no words, while `missing` means we looked and found nothing.
 */
export type SongWords =
  | { readonly status: 'loading' }
  | {
      readonly status: 'lyrics'
      readonly parsed: ParsedLyrics
      /** Pinyin or romaji, one per line; null when off or not lined up. */
      readonly roman: readonly string[] | null
    }
  | { readonly status: 'instrumental' }
  | { readonly status: 'missing'; readonly offline: boolean }

export function resolveSongWords({
  loading,
  parsed,
  romanizationOn,
  romanized,
  offline,
  instrumental,
}: {
  loading: boolean
  parsed: ParsedLyrics | null
  romanizationOn: boolean
  romanized: readonly string[] | null
  offline: boolean
  instrumental: boolean
}): SongWords {
  if (loading) return { status: 'loading' }
  if (parsed) {
    // Only romanization that lines up exactly: misaligned is worse than none.
    const roman =
      romanizationOn && romanized && romanized.length === parsed.lines.length ? romanized : null
    return { status: 'lyrics', parsed, roman }
  }
  if (offline) return { status: 'missing', offline: true }
  if (instrumental) return { status: 'instrumental' }
  return { status: 'missing', offline: false }
}

/** What the romanization switch is called for these lyrics. */
export function romanName(language: LyricsLanguage): 'Romaji' | 'Pinyin' {
  return language === 'ja' ? 'Romaji' : 'Pinyin'
}

const clamp = (min: number, value: number, max: number): number =>
  Math.max(min, Math.min(max, value))

export interface StageGeometry {
  /** Left of the cover, and the gap between it and the words. */
  readonly pad: number
  readonly gutter: number
  /** Right of the words, the tools and the expand button. */
  readonly right: number
  readonly cover: number
  readonly title: number
  readonly lyric: number
  readonly focusLyric: number
}

/** The page's measurements, from its own size. */
export function stageGeometry(width: number, height: number): StageGeometry {
  return {
    pad: clamp(28, width * 0.05, 72),
    gutter: clamp(28, width * 0.05, 72),
    right: clamp(20, width * 0.04, 56),
    cover: Math.max(180, Math.min(400, width * 0.34, height - 290)),
    title: clamp(22, width * 0.022, 30),
    lyric: clamp(22, width * 0.023, 32),
    focusLyric: clamp(30, width * 0.039, 54),
  }
}

/** "Playing · 10 of 13", or "Shuffling · …". */
export function contextLine(shuffle: boolean, index: number, count: number): string {
  return `${shuffle ? 'Shuffling' : 'Playing'} · ${index + 1} of ${count}`
}

/**
 * Seconds until the next song, while "Next" should show; null otherwise.
 *
 * Not on repeat-one, where nothing else is coming, and not on a song short
 * enough that the card would be up for half of it.
 */
export function upNextSeconds({
  hasNext,
  repeatOne,
  duration,
  position,
}: {
  hasNext: boolean
  repeatOne: boolean
  duration: number
  position: number
}): number | null {
  const remaining = duration - position
  if (!hasNext || repeatOne || duration <= UP_NEXT_LEAD * 2) return null
  if (remaining <= 0 || remaining > UP_NEXT_LEAD) return null
  return Math.ceil(remaining)
}

/** A `#rrggbb` token at some opacity, for the web's `color-mix(… transparent)`. */
export function hexAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '')
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
