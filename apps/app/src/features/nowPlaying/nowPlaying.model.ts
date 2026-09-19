import type { LyricsLanguage, ParsedLyrics } from '@selfmp3/shared'

/**
 * Now Playing's rules, with nothing drawn: where things sit on a computer's
 * page, which words a song has to show, and when "Next" should appear.
 *
 * The numbers follow the page's own width and height rather than the window's.
 */

/*
 * Up next is not a tab: it is the rail beside the page (`features/queue`), so
 * the stage keeps the song's words and what is known about it.
 */
export type StageTab = 'lyrics' | 'about'
export type PageMode = 'stage' | 'focus'

/** The tab in the address, or the lyrics when it names nothing we know. */
export function parseTab(value: unknown): StageTab {
  return value === 'about' ? 'about' : 'lyrics'
}

/**
 * The phone page's two views of one route (docs/ui-mock `P21`, `P22`): the
 * cover, and the words alone. In the address, so a swipe up is a step the
 * page can be sent back from and a link can open the words directly.
 */
export type PhoneView = 'cover' | 'lyrics'

export function parseView(value: unknown): PhoneView {
  return value === 'lyrics' ? 'lyrics' : 'cover'
}

/** The cover while paused, as a share of its size playing (`M1`, "The cover breathes"). */
export const PAUSED_COVER_SCALE = 0.84
/** How long the cover takes to breathe in or out. */
export const BREATH_MS = 400

/** How far a pull must travel to count, or how quick a flick. */
const SWIPE_DISTANCE = 140
const SWIPE_FLICK_DISTANCE = 48
const SWIPE_FLICK_VELOCITY = 0.9

/**
 * What a vertical pull on the phone page does once it is let go.
 *
 * On the cover a pull down puts the page away and a pull up opens the words;
 * on the words a pull down goes back to the cover, and a pull up does nothing
 * (the lyrics scroll that way). A long pull or a quick flick counts; anything
 * less springs back.
 */
export function swipeOutcome({
  view,
  dy,
  vy,
}: {
  view: PhoneView
  dy: number
  vy: number
}): 'close' | 'lyrics' | 'cover' | null {
  const far = (d: number, v: number): boolean =>
    d > SWIPE_DISTANCE || (d > SWIPE_FLICK_DISTANCE && v > SWIPE_FLICK_VELOCITY)
  if (far(dy, vy)) return view === 'cover' ? 'close' : 'cover'
  if (view === 'cover' && far(-dy, -vy)) return 'lyrics'
  return null
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
const UP_NEXT_LEAD = 15

/**
 * What a song has to read, in one of three states.
 *
 * `missing` is one state however the song came to have no words: the lookup
 * found nothing, or it answered before that the song has none and that answer
 * was kept. Both show the song's visual (`visuals.model.ts`), so the app never
 * has to say which. Only `offline` is told apart, because there the words may
 * well exist and simply cannot be asked for.
 */
export type SongWords =
  | { readonly status: 'loading' }
  | {
      readonly status: 'lyrics'
      readonly parsed: ParsedLyrics
      /** Pinyin or romaji, one per line; null when off or not lined up. */
      readonly roman: readonly string[] | null
    }
  | { readonly status: 'missing'; readonly offline: boolean }

export function resolveSongWords({
  loading,
  parsed,
  instrumental,
  romanizationOn,
  romanized,
  offline,
}: {
  loading: boolean
  parsed: ParsedLyrics | null
  /**
   * The library's own answer that this song has no words: the server writes it
   * down the first time a lookup finds none. Taken here rather than waited
   * for, so a song that is played again is on its visual from the first frame
   * — the lookup saying "none" a moment later used to flip the page's Lyrics
   * button to Visual after it had already been drawn.
   */
  instrumental: boolean
  romanizationOn: boolean
  romanized: readonly string[] | null
  offline: boolean
}): SongWords {
  if (instrumental && !parsed) return { status: 'missing', offline: false }
  if (loading) return { status: 'loading' }
  if (parsed) {
    // Only romanization that lines up exactly: misaligned is worse than none.
    const roman =
      romanizationOn && romanized && romanized.length === parsed.lines.length ? romanized : null
    return { status: 'lyrics', parsed, roman }
  }
  return { status: 'missing', offline }
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
  /**
   * A song with no lyrics (`C10`): the visual is the window, and the cover
   * steps down to its foot, smaller, with the title beside it and larger.
   */
  readonly visualCover: number
  readonly visualTitle: number
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
    visualCover: clamp(150, Math.min(width * 0.16, height * 0.28), 220),
    visualTitle: clamp(28, width * 0.031, 44),
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

/**
 * How tall the similar-songs shelf is: heading, cards and the gap under them.
 * The shelf is drawn into exactly this height (`SimilarShelf`), so an empty
 * slot held while the neighbours are being fetched is the same height as a
 * full one.
 */
export const SIMILAR_SHELF_HEIGHT = 144

/** A similar song played from the shelf goes first, with the rest after it in their order. */
export function playSimilarOrder(ids: readonly number[], chosen: number): number[] {
  return [chosen, ...ids.filter(id => id !== chosen)]
}
