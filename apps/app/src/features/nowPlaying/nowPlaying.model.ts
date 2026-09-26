import { clamp, type LyricsLanguage, type ParsedLyrics } from '@selfmp3/shared'

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

/**
 * The cover while paused, as a share of its size playing (`M1`, "The cover
 * breathes"). How long it takes to shrink is `MOVE_MS.breath`, with every other
 * length in the app; growing back is the spring, which is why only one of the
 * two is a length at all.
 */
export const PAUSED_COVER_SCALE = 0.84

/**
 * The least a flick may travel and still count. How far a slow pull must go, and
 * how quick a flick has to be, are the caller's: they are `PULL` in
 * `ui/motion.model.ts`, the same two numbers a sheet's pull is let go by, and a
 * model file reads nothing from the UI — so the screen hands them in.
 */
const SWIPE_FLICK_DISTANCE = 48

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
  close,
  flick,
}: {
  view: PhoneView
  dy: number
  vy: number
  /** How far a slow pull must travel, in points: `PULL.close`. */
  close: number
  /** How quick a flick has to be, in points a second: `PULL.flick`. */
  flick: number
}): 'close' | 'lyrics' | 'cover' | null {
  // A gesture's `vy` is points a millisecond, which is why the flick's points a
  // second is divided.
  const far = (d: number, v: number): boolean =>
    d > close || (d > SWIPE_FLICK_DISTANCE && v > flick / 1000)
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
  /**
   * A page taller than it is wide (an iPad in portrait, `T05`): the cover and
   * the title share a row, and the words run the page's width under them.
   */
  readonly stacked: boolean
  /** The status bar's height over the page (an iPad's), which the head sits under. */
  readonly inset: number
}

/** Past this width a page keeps its cover and its words side by side, however tall. */
const STACK_MAX_WIDTH = 1000

/** The page's measurements, from its own size. */
export function stageGeometry(width: number, height: number, inset = 0): StageGeometry {
  const stacked = width < STACK_MAX_WIDTH && height > width
  return {
    stacked,
    inset,
    pad: clamp(width * 0.05, 28, 72),
    gutter: clamp(width * 0.05, 28, 72),
    right: clamp(width * 0.04, 20, 56),
    cover: stacked
      ? clamp(width * 0.36, 200, 320)
      : Math.max(180, Math.min(400, width * 0.34, height - 290)),
    title: clamp(width * 0.022, 22, 30),
    lyric: clamp(width * 0.023, 22, 32),
    focusLyric: clamp(width * 0.039, 30, 54),
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
