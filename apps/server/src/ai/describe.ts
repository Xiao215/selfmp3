import { z } from 'zod/v4'
import {
  DAY_MS,
  fromSqliteTime,
  UnderstandingSchema,
  type DescribePick,
  type DescribeRequest,
  type DescribeResult,
  type Song,
  type Tag,
  type Understanding,
} from '@selfmp3/shared'
import { creditNames, hasWords, libraryShape, songTable } from './library.js'
import { LlmError, Remembered, type Llm } from './llm.js'
import { NO_STEPS, type Steps } from './progress.js'

/**
 * A1c · Describe a playlist (docs/features/ai.md).
 *
 * Plan, narrow, pick. The model reads the words once and says what they mean
 * in parts the library can check (tags, artists, energy, when played); the
 * server lets in the songs those parts allow, with no model involved; and only
 * when the words want something the parts cannot say, or more songs fit than
 * were asked for, the model picks from inside them.
 */

/** A playlist's worth, when the words do not say how many. */
export const DEFAULT_SIZE = 25

/** The most songs one answer holds: a long length of short pieces stops here. */
export const MAX_PICKS = 200

/** "1 hr 58 min", "40 min": a length the way the app writes one. */
function lengthWords(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  const hours = Math.floor(minutes / 60)
  if (hours === 0) return `${minutes} min`
  return minutes % 60 === 0 ? `${hours} hr` : `${hours} hr ${minutes % 60} min`
}

/**
 * The most songs a pick is chosen from. A line of the table is about 40
 * tokens, so this keeps the pick's prompt near 12k whatever the library's size.
 */
const MAX_CANDIDATES = 300

const PLAN_VERSION = 4
const PICK_VERSION = 3

const RangeOut = z.object({ min: z.number().nullable(), max: z.number().nullable() })

/** What the plan returns: an Understanding, kept in step with the shared one. */
export const PlanOut = z.object({
  name: z.string().min(1).max(60),
  anyTags: z.array(z.string()).max(12),
  artists: z.array(z.string()).max(12),
  noTags: z.array(z.string()).max(12),
  energy: RangeOut,
  bpm: RangeOut,
  year: RangeOut,
  words: z.enum(['with', 'without']).nullable(),
  loved: z.boolean().nullable(),
  playedWithinDays: z.number().int().min(1).max(3650).nullable(),
  notPlayedWithinDays: z.number().int().min(1).max(3650).nullable(),
  addedWithinDays: z.number().int().min(1).max(3650).nullable(),
  size: z.number().int().min(1).max(2000).nullable(),
  minutes: z.number().int().min(1).max(1440).nullable(),
  sound: z.string().max(120).nullable(),
  brief: z.string().max(200).nullable(),
})

export const PickOut = z.object({
  picks: z.array(z.object({ n: z.number().int(), why: z.string().max(120) })).max(200),
})

/** What each filter means and how to choose them; the router (ask.ts) is told the same. */
export const FILTERS_GUIDE = `The filters:
- anyTags: tag names, copied exactly from the library's tag list. A song is in if it has ANY of them.
- artists: artist names, copied exactly from the library's artist list. Also widens: a song by any of them is in too.
  Tags and artists are "places" that add songs together. Leave both empty to start from the whole library.
- noTags: tag names whose songs must be left out.
- energy: 0–1 from audio analysis. Calm, quiet, sleepy, soft music is low (max around the library's lower quarter); upbeat, loud, workout music is high (min around the upper quarter). Use the library's own spread, not fixed numbers. Leave both null if energy was not implied.
- bpm: only when a tempo is clearly asked for (running, a dance); tempo detection is unreliable for classical and rubato music, so prefer energy.
- year: the year a song came out, from its release (the library's spread is given). For an era: "2000s" or "00年代" is 2000–2009, "90s" 1990–1999. "Old songs", "throwbacks", "老歌" sit below the library's lower quarter; "recent releases", "this year's songs" are the last year or two. A classical recording's year is the recording's, not the composer's: ask for a composer by artist, never by year. Not for what is new to the library ("just added", "new stuff"): that is addedWithinDays.
- words: "with" for songs with lyrics, "without" for instrumental (studying, focus, "no vocals"). Null when not implied.
- loved: true only if they ask for loved or favourite songs.
- playedWithinDays / notPlayedWithinDays / addedWithinDays: when the description is about recency ("nothing I played this week" is notPlayedWithinDays 7; "new stuff" is addedWithinDays 30).
- size: a number of songs, only if they say one.
- minutes: how long it should play, only if they say a length ("2 hours" is 120, "half an hour" is 30). Never turn a length into a number of songs: songs differ in length, and the app counts them. Set size or minutes, never both.
- sound: how the music should sound, in English, for a model that listens to every song: instruments, mood, genre and style in a short phrase, such as "calm orchestral music with strings and flute", "intense epic battle music", "solo classical piano", "upbeat Japanese pop with female vocals". Write it in English whatever language the description is in, and only in positive words: the listening model does not understand "no" or "without" (no vocals is words "without"). Of the songs the other filters let in, it keeps the ones that sound like it, best first. Null when the description says nothing about how the music sounds; never set it just to order songs the other filters already choose.
- brief: what the description wants that the filters and sound cannot express, in a few words, such as "named for rain" or "songs about leaving home". Null if they say it all.
- name: a short, plain playlist name in the description's language, no emoji.

Prefer sound to energy and bpm for how music feels: "calm", "intense", "dreamy" or "epic" is sound, and energy or bpm only when they ask for a level or a tempo outright.

Rules: use only tag and artist names that appear in the library exactly. If the description names a tag or artist the library lacks, put that wish in brief instead of inventing a name. Prefer fewer filters: every filter you add removes songs. Anything the description welcomes, even "a few X are fine", is a place: add it, and say the mix in brief ("mostly piano, a few Genshin"). When a filter would shut out a place they asked for (the words filter shutting out every song of an artist they named), leave the filter out and say it in brief.`

const PLAN_SYSTEM = `You turn someone's description of a playlist into filters over their own music library.

You are given the library's shape (its tags with what each holds, its artists, the spread of energy and tempo) and the description. Reply with JSON only, in the schema given.

${FILTERS_GUIDE}`

const PICK_SYSTEM = `You choose songs for a playlist from a numbered table of someone's own songs.

You are given the description they wrote, sometimes what it wants beyond the filters, how many songs to choose, and the table.

Reply with JSON only: picks, each the song's number from the table (n) and why it fits in at most ten plain words, written for the listener ("slow solo piano", "named for rain"). Judge every song against the whole description yourself, with what you know of the music and what the table says, and leave out a song that does not fit it. Choose the songs that fit the description best, in a good listening order. Unless the description asks for particular artists, spread the choice across artists rather than filling it with one. When the table has a sound column, a listening model has already heard every song: it scores 0–100 how well the song sounds like what was asked, the table is in that order, and you should trust it over what a title suggests. Never use a number that is not in the table, never repeat one, and choose no more than asked. If fewer fit well, choose fewer.`

/** The listening model's two questions (sound/sound.ts); each answers null when it cannot. */
interface SoundRanker {
  /** How well each song sounds like the words. */
  match(text: string, songIds: readonly number[]): Promise<Map<number, number> | null>
  /** How close each song sounds to one song. */
  closeTo(seedId: number, songIds: readonly number[]): Map<number, number> | null
}

export interface DescribeDeps {
  readonly llm: Llm
  readonly songs: () => Song[]
  readonly tags: () => Tag[]
  /** Absent, or answering null, where no song has been heard: songs are then sampled. */
  readonly sound?: SoundRanker
  readonly now?: () => number
  readonly remembered?: Remembered
}

const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

/** "within the last week" style words for the loosened list. */
function days(n: number): string {
  return n === 1 ? '1 day' : `${n} days`
}

/**
 * Names the library has, as it spells them, and the ones it does not.
 * A model that writes "yoasobi" for "YOASOBI" still means the artist.
 */
function resolveNames(
  wanted: readonly string[],
  known: readonly string[],
): { found: string[]; unknown: string[] } {
  const found: string[] = []
  const unknown: string[] = []
  for (const name of wanted) {
    const match = known.find(candidate => sameName(candidate, name))
    if (match) {
      if (!found.includes(match)) found.push(match)
    } else unknown.push(name)
  }
  return { found, unknown }
}

/** The parts that narrow, in the order they are given up when nothing fits. */
const LOOSEN_ORDER = [
  'bpm',
  'energy',
  'words',
  'year',
  'notPlayedWithinDays',
  'playedWithinDays',
  'addedWithinDays',
  'loved',
  'noTags',
] as const

function describePart(understanding: Understanding, part: (typeof LOOSEN_ORDER)[number]): string {
  switch (part) {
    case 'bpm':
      return 'the tempo'
    case 'energy':
      return 'the energy'
    case 'words':
      return understanding.words === 'with' ? 'only songs with words' : 'only songs without words'
    case 'year':
      return 'the years'
    case 'notPlayedWithinDays':
      return `not played in ${days(understanding.notPlayedWithinDays ?? 0)}`
    case 'playedWithinDays':
      return `played in the last ${days(understanding.playedWithinDays ?? 0)}`
    case 'addedWithinDays':
      return `added in the last ${days(understanding.addedWithinDays ?? 0)}`
    case 'loved':
      return understanding.loved ? 'only loved songs' : 'no loved songs'
    case 'noTags':
      return `leaving out ${understanding.noTags.join(', ')}`
  }
}

function isSet(understanding: Understanding, part: (typeof LOOSEN_ORDER)[number]): boolean {
  const value = understanding[part]
  if (Array.isArray(value)) return value.length > 0
  if (value && typeof value === 'object') return value.min !== null || value.max !== null
  return value !== null
}

function unset(understanding: Understanding, part: (typeof LOOSEN_ORDER)[number]): Understanding {
  switch (part) {
    case 'bpm':
    case 'energy':
    case 'year':
      return { ...understanding, [part]: { min: null, max: null } }
    case 'noTags':
      return { ...understanding, noTags: [] }
    default:
      return { ...understanding, [part]: null }
  }
}

function inRange(
  value: number | null | undefined,
  range: { min: number | null; max: number | null },
): boolean {
  if (range.min === null && range.max === null) return true
  if (value === null || value === undefined) return false
  return (range.min === null || value >= range.min) && (range.max === null || value <= range.max)
}

/**
 * The songs an understanding lets in. Places widen (any tag, any artist),
 * everything else narrows. Pure, and the same rule the chips describe.
 */
export function songsFitting(
  songs: readonly Song[],
  tags: readonly Tag[],
  understanding: Understanding,
  now: number,
): Song[] {
  const tagIdsOf = (names: readonly string[]): Set<number> =>
    new Set(tags.filter(tag => names.some(name => sameName(name, tag.name))).map(tag => tag.id))
  const anyTags = tagIdsOf(understanding.anyTags)
  const noTags = tagIdsOf(understanding.noTags)
  const artists = understanding.artists.map(name => name.toLowerCase())
  const hasPlaces = understanding.anyTags.length > 0 || understanding.artists.length > 0
  const within = (iso: string | null, n: number | null): boolean =>
    n === null || (iso !== null && now - fromSqliteTime(iso) <= n * DAY_MS)

  return songs.filter(song => {
    if (hasPlaces) {
      const inTag = song.tagIds.some(id => anyTags.has(id))
      const byArtist = creditNames(song.artist).some(name => artists.includes(name.toLowerCase()))
      if (!inTag && !byArtist) return false
    }
    if (song.tagIds.some(id => noTags.has(id))) return false
    if (!inRange(song.audioFeatures?.energy, understanding.energy)) return false
    if (!inRange(song.audioFeatures?.bpm, understanding.bpm)) return false
    if (!inRange(song.year, understanding.year)) return false
    if (understanding.words !== null && hasWords(song) !== (understanding.words === 'with'))
      return false
    if (understanding.loved !== null && song.loved !== understanding.loved) return false
    if (!within(song.lastPlayedAt, understanding.playedWithinDays)) return false
    if (
      understanding.notPlayedWithinDays !== null &&
      song.lastPlayedAt !== null &&
      within(song.lastPlayedAt, understanding.notPlayedWithinDays)
    ) {
      return false
    }
    if (!within(song.addedAt, understanding.addedWithinDays)) return false
    return true
  })
}

/**
 * How far below the best match a song may score and still sound like the
 * words. The scores are relative (a sentence against songs, about 0.1–0.3), so
 * the line is drawn from the top, not at a fixed value: a sound few songs have
 * keeps few, a broad one keeps many. Measured on 585 of the library's songs
 * (2026-10-07): "solo classical piano" kept 20 against the 18 piano pieces,
 * three in four of them right; "Japanese pop" kept 86, nineteen in twenty right;
 * "intense epic battle music" kept 26 of 337 Genshin tracks.
 */
const SOUND_MARGIN = 0.06

/**
 * Each song's place, 0–100, in how it sounds: the description's sound, how
 * close it is to a song they are steering from, or both, averaged. Songs the
 * model has not heard have no place. With a description, `kept` is the songs
 * that sound like it, within `SOUND_MARGIN` of the best; steering from a song
 * keeps every one. Null when there is nothing to order by.
 */
async function soundOrder(
  sound: SoundRanker | undefined,
  songs: readonly Song[],
  understanding: Understanding,
  like: number | null,
): Promise<{ places: Map<number, number>; kept: Set<number> | null } | null> {
  if (!sound || songs.length === 0) return null
  const ids = songs.map(song => song.id)
  const matched = understanding.sound ? await sound.match(understanding.sound, ids) : null
  const sources = [matched, like !== null ? sound.closeTo(like, ids) : null].filter(
    (scores): scores is Map<number, number> => scores !== null && scores.size > 0,
  )
  if (sources.length === 0) return null
  // Places rather than raw scores: a sentence and a song sit at different
  // distances from the same music, and only their orders can be averaged.
  const places = sources.map(scores => {
    const ranked = [...scores.entries()].sort((a, b) => a[1] - b[1])
    return new Map(
      ranked.map(([id], index) => [
        id,
        ranked.length === 1 ? 100 : (100 * index) / (ranked.length - 1),
      ]),
    )
  })
  const out = new Map<number, number>()
  for (const id of ids) {
    const each = places.map(place => place.get(id)).filter((p): p is number => p !== undefined)
    if (each.length === places.length) out.set(id, each.reduce((a, b) => a + b, 0) / each.length)
  }
  if (out.size === 0) return null
  let kept: Set<number> | null = null
  if (matched && matched.size > 0) {
    const best = Math.max(...matched.values())
    kept = new Set(
      [...matched].filter(([, score]) => score >= best - SOUND_MARGIN).map(([id]) => id),
    )
  }
  return { places: out, kept }
}

/** A stable order that is not the library's: the same words give the same sample. */
function sample(songs: readonly Song[], seed: string, n: number): Song[] {
  if (songs.length <= n) return [...songs]
  const score = (id: number): number => {
    let hash = 2166136261
    for (const char of `${seed}:${id}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
    return hash >>> 0
  }
  return [...songs].sort((a, b) => score(a.id) - score(b.id)).slice(0, n)
}

/** The plan's answer, made to fit this library: names spelled its way, unknown ones set aside. */
export function groundPlan(
  plan: z.infer<typeof PlanOut>,
  songs: readonly Song[],
  tags: readonly Tag[],
): { understanding: Understanding; unknown: string[] } {
  const tagNames = tags.map(tag => tag.name)
  const artistNames = [...new Set(songs.flatMap(song => creditNames(song.artist)))]
  const anyTags = resolveNames(plan.anyTags, tagNames)
  const noTags = resolveNames(plan.noTags, tagNames)
  const artists = resolveNames(plan.artists, artistNames)
  const understanding = UnderstandingSchema.parse({
    ...plan,
    anyTags: anyTags.found,
    noTags: noTags.found,
    artists: artists.found,
  })
  return {
    understanding,
    unknown: [...anyTags.unknown, ...noTags.unknown, ...artists.unknown],
  }
}

/** The pick's answer, kept to numbers that are in the table, once each, no more than asked. */
export function groundPicks(
  picks: z.infer<typeof PickOut>['picks'],
  table: readonly Song[],
  size: number,
): DescribePick[] {
  const seen = new Set<number>()
  const out: DescribePick[] = []
  for (const pick of picks) {
    const song = table[pick.n - 1]
    if (!song || seen.has(song.id)) continue
    seen.add(song.id)
    out.push({ songId: song.id, why: pick.why.trim() || null })
    if (out.length >= size) break
  }
  return out
}

/** A describe request as code sends it: `avoid` may be left out, as the route's default does. */
export type DescribeInput = Omit<DescribeRequest, 'avoid'> & { readonly avoid?: readonly number[] }

export async function describe(
  deps: DescribeDeps,
  request: DescribeInput,
): Promise<DescribeResult> {
  const remembered = deps.remembered ?? new Remembered()
  const songs = deps.songs()
  const tags = deps.tags()

  // 1 · Plan, unless the parts came back from the device already decided.
  let understanding: Understanding
  let unknown: string[] = []
  if (request.understanding) {
    understanding = request.understanding
  } else {
    const shape = libraryShape(songs, tags)
    const prompt = `${shape}\n\nThe description:\n${request.text}`
    const plan = await remembered.get(
      Remembered.key('describe-plan', PLAN_VERSION, prompt),
      async () =>
        (
          await deps.llm.generate({
            task: 'describe-plan',
            tier: 'fast',
            system: PLAN_SYSTEM,
            prompt,
            schema: PlanOut,
          })
        ).value,
    )
    ;({ understanding, unknown } = groundPlan(plan, songs, tags))
  }

  return narrowAndPick(deps, request.text, understanding, unknown, request.avoid ?? [])
}

/**
 * Steps 2 and 3 for an understanding already decided: by the plan, by the
 * device after a chip was taken away, or by the router (ask.ts).
 */
export async function narrowAndPick(
  deps: DescribeDeps,
  text: string,
  understanding: Understanding,
  unknown: string[],
  avoid: readonly number[] = [],
  steps: Steps = NO_STEPS,
  /** A song they are steering from ("more like this"): the songs are ordered by how close they sound to it. */
  like: number | null = null,
): Promise<DescribeResult> {
  const now = deps.now?.() ?? Date.now()
  const remembered = deps.remembered ?? new Remembered()
  const songs = deps.songs()
  const tags = deps.tags()

  // 2 · Narrow, with no model: and loosen, a part at a time, if nothing fits.
  steps.begin('Looking through your library')
  let fitting = songsFitting(songs, tags, understanding, now)
  const loosened: string[] = []
  let applied = understanding
  for (const part of LOOSEN_ORDER) {
    if (fitting.length > 0) break
    if (!isSet(applied, part)) continue
    loosened.push(describePart(applied, part))
    applied = unset(applied, part)
    fitting = songsFitting(songs, tags, applied, now)
  }

  // Different songs: the ones shown last time stay out while anything else fits.
  if (avoid.length > 0) {
    const shown = new Set(avoid)
    const others = fitting.filter(song => !shown.has(song.id))
    if (others.length > 0) fitting = others
  }

  steps.done(
    fitting.length === 0
      ? 'Nothing in your library fits'
      : `${fitting.length} ${fitting.length === 1 ? 'song fits' : 'songs fit'}${loosened.length > 0 ? `, once ${loosened.join(', ')} was let go` : ''}`,
  )

  // How they sound, when the words or the song steered from say: the songs in
  // that order, best first. A described sound also keeps only the songs that
  // sound like it, so a sound few songs have is not padded out with ones that
  // do not; songs not heard yet cannot be vouched for and stay out with them.
  let places: Map<number, number> | null = null
  if (fitting.length > 1 && (understanding.sound !== null || like !== null)) {
    steps.begin(
      understanding.sound
        ? `Listening for “${understanding.sound}”`
        : 'Listening for songs like it',
    )
    const heard = await soundOrder(deps.sound, fitting, understanding, like)
    if (heard) {
      places = heard.places
      const kept = heard.kept
      if (kept) fitting = fitting.filter(song => kept.has(song.id))
      steps.done(
        kept
          ? `${kept.size} of the ${heard.places.size} heard ${kept.size === 1 ? 'sounds' : 'sound'} like it`
          : `Heard ${heard.places.size} of them`,
      )
    } else {
      steps.done('No song has been heard yet')
    }
  }
  const ordered = places
    ? [...fitting].sort((a, b) => (places.get(b.id) ?? -1) - (places.get(a.id) ?? -1))
    : null

  // 3 · Pick, only when there is something to judge.
  const byId = new Map(songs.map(song => [song.id, song]))
  const length = (picked: readonly DescribePick[]): number =>
    picked.reduce((sum, pick) => sum + (byId.get(pick.songId)?.duration ?? 0), 0)
  const target = understanding.minutes === null ? null : understanding.minutes * 60
  const average =
    fitting.length > 0 ? fitting.reduce((sum, song) => sum + song.duration, 0) / fitting.length : 0
  // A length is counted in this library's own songs: two hours of ninety-second
  // pieces is eighty of them, not the thirty an average pop song would make.
  const size =
    target !== null && average > 0
      ? Math.min(MAX_PICKS, Math.max(1, Math.ceil(target / average)))
      : Math.min(MAX_PICKS, understanding.size ?? DEFAULT_SIZE)

  /** One round of the model choosing `count` of `candidates`. */
  const pickFrom = async (candidates: readonly Song[], count: number): Promise<DescribePick[]> => {
    const table = places
      ? inOrder(candidates).slice(0, MAX_CANDIDATES)
      : sample(candidates, text, MAX_CANDIDATES)
    const prompt = [
      `The description: ${text}`,
      ...(understanding.brief ? [`What it wants beyond the filters: ${understanding.brief}`] : []),
      ...(places && understanding.sound ? [`How it should sound: ${understanding.sound}`] : []),
      `Choose up to ${count} songs.`,
      '',
      `The table holds the songs the filters let in: a rough first cut, so some may not fit the description (number | title | artist | album | year | tags | energy | tempo | length | words | plays${places ? ' | sound' : ''}):`,
      songTable(table, tags, now, places ? song => soundColumn(places, song) : undefined),
    ].join('\n')
    const answer = await remembered.get(
      Remembered.key('describe-pick', PICK_VERSION, prompt),
      async () =>
        (
          await deps.llm.generate({
            task: 'describe-pick',
            tier: 'smart',
            system: PICK_SYSTEM,
            prompt,
            schema: PickOut,
          })
        ).value,
    )
    return groundPicks(answer.picks, table, count)
  }

  let picks: DescribePick[]
  const everything = (ordered ?? fitting).map(song => ({ songId: song.id, why: null }))
  if (fitting.length === 0) {
    picks = []
  } else if (
    understanding.brief === null &&
    (target === null ? fitting.length <= size : length(everything) <= target)
  ) {
    picks = everything
  } else if (understanding.brief === null && ordered) {
    // Nothing is wanted that the listening has not already judged: the songs
    // that sound most like it, as many as were asked for, with no model call.
    picks = fillToLength(everything)
  } else {
    steps.begin(
      target !== null
        ? `Choosing ${lengthWords(target)} that suits it`
        : `Choosing ${Math.min(size, fitting.length)} that suit it`,
    )
    picks = await pickFrom(fitting, size)
    if (picks.length === 0) throw new LlmError('invalid', 'The model picked no song from the table')
    if (target !== null) picks = await fillTo(picks)
    steps.done(
      target !== null
        ? `Chose ${picks.length}, ${lengthWords(length(picks))}`
        : `Chose ${picks.length}`,
    )
  }

  /**
   * A length asked for is a length given. The model may stop short of it —
   * "if fewer fit well, choose fewer" — so it is asked once more for the rest
   * from what it has not chosen; whatever is still missing is made up from the
   * songs that fit, in the same stable order its table was drawn in; and a
   * last song that runs well past the length is left off.
   */
  async function fillTo(first: DescribePick[]): Promise<DescribePick[]> {
    if (target === null) return first
    let picked = first
    const unchosen = (): Song[] => {
      const taken = new Set(picked.map(pick => pick.songId))
      return fitting.filter(song => !taken.has(song.id))
    }
    const short = (): number => target - length(picked)
    if (short() > average / 2 && unchosen().length > 0) {
      steps.begin(`Choosing more, to make ${lengthWords(target)}`)
      const more = await pickFrom(unchosen(), Math.ceil(short() / Math.max(average, 1)))
      picked = [...picked, ...more]
    }
    for (const song of places ? inOrder(unchosen()) : sample(unchosen(), text, unchosen().length)) {
      if (short() <= average / 2) break
      picked = [...picked, { songId: song.id, why: null }]
    }
    while (picked.length > 1) {
      const last = byId.get(picked[picked.length - 1]!.songId)?.duration ?? 0
      if (length(picked) - last < target) break
      picked = picked.slice(0, -1)
    }
    return picked.slice(0, MAX_PICKS)
  }

  /** The best-sounding first, as many as were asked for, or as long as was asked. */
  function fillToLength(inSoundOrder: DescribePick[]): DescribePick[] {
    if (target === null) return inSoundOrder.slice(0, size)
    const out: DescribePick[] = []
    for (const pick of inSoundOrder) {
      if (length(out) >= target - average / 2) break
      out.push(pick)
    }
    return out.slice(0, MAX_PICKS)
  }

  /** Songs in the order they sound, best first; the ones not heard keep their place after. */
  function inOrder(candidates: readonly Song[]): Song[] {
    const rank = new Map((ordered ?? []).map((song, index) => [song.id, index]))
    return [...candidates].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
  }

  return { understanding: applied, fit: fitting.length, loosened, unknown, picks }
}

/** The sound column: a song's place, 0–100, or "?" for one not heard yet. */
function soundColumn(places: Map<number, number>, song: Song): string {
  const place = places.get(song.id)
  return place === undefined ? 'sound ?' : `sound ${Math.round(place)}`
}
