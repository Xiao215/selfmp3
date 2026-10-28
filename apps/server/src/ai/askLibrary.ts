import type { z } from 'zod/v4'
import {
  editDistance,
  formatDuration,
  isResting,
  joinedNames,
  NO_JOINS,
  ASK_CLARIFY_OPTIONS,
  type AskCard,
  type AskOrder,
  type AskSort,
  type DescribePick,
  type DescribeResult,
  type SmartRules,
  type Song,
  type Tag,
  type Understanding,
} from '@selfmp3/shared'
import {
  DEFAULT_SIZE,
  MAX_PICKS,
  PickOut,
  groundPicks,
  groundPlan,
  narrowAndPick,
  songsFitting,
  type DescribeDeps,
  type PlanOut,
} from './describe.js'
import { creditedArtists, songTable } from './library.js'
import { Remembered } from './llm.js'
import { NO_STEPS, type Steps } from './progress.js'
import { bare, tally } from './text.js'

/**
 * Two of Ask's answers that read the library rather than the listening
 * (docs/features/ai.md, "Playlists from the box" and "Questions about your
 * library"): songs into or out of a playlist, or its order; and how many,
 * which and whose songs fit a description. The filters are the router's,
 * which are Describe's; the songs are counted and sorted here, in code.
 */

/** A playlist as Ask sees it: its kind and a live one's rules, and its songs when asked for. */
export interface AskPlaylist {
  readonly name: string
  readonly kind: 'manual' | 'live'
  readonly rules: SmartRules | null
  readonly songIds: () => readonly number[]
}

/**
 * The playlist a name means, by its exact name, or null. Spelled the way
 * people type a name they half remember — "chill chiense hype" is "chill ·
 * chinese · hype" — but only ever one that exists: the same letters, or a few
 * slips from them, and when two are equally near, neither.
 */
export function matchPlaylist(
  name: string,
  playlists: readonly { readonly name: string }[],
): string | null {
  const wanted = bare(name)
  if (!wanted) return null
  const exact = playlists.find(playlist => bare(playlist.name) === wanted)
  if (exact) return exact.name
  const slips = Math.max(2, Math.floor(wanted.length * 0.2))
  const near = playlists
    // Anything past `slips` comes back as `slips + 1`, which the filter drops.
    .map(playlist => ({
      name: playlist.name,
      far: editDistance(wanted, bare(playlist.name), slips),
    }))
    .filter(each => each.far <= slips)
    .sort((a, b) => a.far - b.far)
  if (near.length === 0 || (near.length > 1 && near[0]!.far === near[1]!.far)) return null
  return near[0]!.name
}

/** How many songs a library question lists at most: as many as a playlist answer holds. */
const LIST_SIZE = 200
/** How many artists, albums or tags a library question names; how many there are is counted apart. */
const TOP = 50

/** The filters as a plan, for a question that set none: the whole library. */
export const EVERYTHING: z.infer<typeof PlanOut> = {
  name: 'Your library',
  anyTags: [],
  artists: [],
  albums: [],
  noTags: [],
  energy: { min: null, max: null },
  bpm: { min: null, max: null },
  year: { min: null, max: null },
  words: null,
  loved: null,
  playedWithinDays: null,
  notPlayedWithinDays: null,
  addedWithinDays: null,
  size: null,
  minutes: null,
  sound: null,
  brief: null,
}

function keyOf(song: Song, by: AskSort): number | string | null {
  switch (by) {
    case 'energy':
      return song.audioFeatures?.energy ?? null
    case 'bpm':
      return song.audioFeatures?.bpm ?? null
    case 'year':
      return song.year
    case 'title':
      return song.title.toLowerCase()
    case 'artist':
      return song.artist.toLowerCase()
    case 'addedAt':
      return song.addedAt
    case 'duration':
      return song.duration
    case 'plays':
      return song.playCount
    case 'lastPlayed':
      return song.lastPlayedAt
    case 'track':
      // Albums apart, then each in its own order; a song without a number goes last on its album.
      return `${song.album.toLowerCase()}\u0000${String(song.trackNo ?? 9999).padStart(4, '0')}`
  }
}

/** Songs in order of one thing; a song without it (not analysed, never played) goes last either way. */
export function sortSongs(songs: readonly Song[], by: AskSort, order: AskOrder): Song[] {
  const sign = order === 'asc' ? 1 : -1
  return [...songs].sort((a, b) => {
    const x = keyOf(a, by)
    const y = keyOf(b, by)
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1
    if (typeof x === 'string' && typeof y === 'string') return sign * x.localeCompare(y)
    return sign * ((x as number) - (y as number))
  })
}

/** The most common, as a library answer lists them, and how many different ones there are. */
function top(values: Iterable<string>): {
  listed: { label: string; count: number }[]
  distinct: number
} {
  const counted = tally(values)
  return {
    listed: counted.slice(0, TOP).map(([label, count]) => ({ label, count })),
    distinct: counted.length,
  }
}

/** Whether the filters choose anything, rather than letting every song in. */
function chooses(understanding: Understanding): boolean {
  const { anyTags, artists, albums, noTags, energy, bpm, year } = understanding
  return (
    anyTags.length > 0 ||
    artists.length > 0 ||
    albums.length > 0 ||
    noTags.length > 0 ||
    energy.min !== null ||
    energy.max !== null ||
    bpm.min !== null ||
    bpm.max !== null ||
    year.min !== null ||
    year.max !== null ||
    understanding.words !== null ||
    understanding.loved !== null ||
    understanding.playedWithinDays !== null ||
    understanding.notPlayedWithinDays !== null ||
    understanding.addedWithinDays !== null
  )
}

/**
 * Not something the box can do as asked, said: a question back whose options
 * are the requests it can do that come closest, each asked when pressed, or
 * only the words when there is nothing to offer.
 */
export function instead(say: string, options: readonly string[] = []): AskCard {
  const offered = options
    .map(each => each.trim())
    .filter(Boolean)
    .slice(0, ASK_CLARIFY_OPTIONS)
  return offered.length > 0
    ? { kind: 'clarify', question: say, options: offered }
    : { kind: 'explore', say, songIds: [], get: null }
}

/** The songs a model judged to be what was asked about, and how many of how many it read. */
interface Judged {
  readonly songIds: readonly number[]
  readonly judged: number
  readonly of: number
}

/** "How many YOASOBI songs do I have", "what did I add this week", "my longest song". */
export function libraryAnswer(
  deps: Pick<DescribeDeps, 'songs' | 'tags' | 'now' | 'artistNames'>,
  plan: z.infer<typeof PlanOut> | null,
  question: {
    show: 'count' | 'songs' | 'artists' | 'albums' | 'tags'
    sortBy: AskSort | null
    order: AskOrder
  },
  /** The songs, when a model judged them (`songsThatAre`) rather than the filters alone. */
  chosen?: Judged,
): AskCard {
  const songs = deps.songs()
  const tags = deps.tags()
  const now = deps.now?.() ?? Date.now()
  const joins = deps.artistNames?.() ?? NO_JOINS
  const { understanding, unknown } = groundPlan(plan ?? EVERYTHING, songs, tags, joins)
  const shownAs = joinedNames(songs, joins)
  const byId = new Map(songs.map(song => [song.id, song]))
  const fitting = chosen
    ? chosen.songIds.flatMap(id => byId.get(id) ?? [])
    : songsFitting(songs, tags, understanding, now, joins)
  const sorted = sortSongs(
    fitting,
    question.sortBy ?? 'addedAt',
    question.sortBy ? question.order : 'desc',
  )
  // Judged from an even spread of the songs rather than all of them: scaled up to all.
  const scale = chosen && chosen.judged < chosen.of ? chosen.of / chosen.judged : 1
  const names = new Map(tags.map(tag => [tag.id, tag.name]))
  const artists = top(fitting.flatMap(song => creditedArtists(song, shownAs)))
  const albums = top(fitting.map(song => song.album).filter(Boolean))
  const tagged = top(
    fitting.flatMap(song => song.tagIds.map(id => names.get(id) ?? '')).filter(Boolean),
  )
  return {
    kind: 'library',
    understanding,
    unknown,
    show: question.show,
    count: Math.round(fitting.length * scale),
    seconds: fitting.reduce((sum, song) => sum + song.duration, 0) * scale,
    judged: chosen ? { songs: chosen.judged, of: chosen.of } : null,
    songIds: sorted.slice(0, understanding.size ?? LIST_SIZE).map(song => song.id),
    sortBy: question.sortBy,
    order: question.order,
    artists: artists.listed,
    albums: albums.listed,
    tags: tagged.listed,
    distinct: { artists: artists.distinct, albums: albums.distinct, tags: tagged.distinct },
  }
}

/** How many songs one judging call reads: its table stays near 6k tokens, and its picks fit PickOut. */
const JUDGE_BATCH = 150
/**
 * The most songs a question by meaning judges, a few calls at once. Past it an
 * even spread of them is judged, and the answer says it is an estimate.
 */
const JUDGE_MOST = 600
const JUDGE_VERSION = 1

const JUDGE_SYSTEM = `You judge songs one by one for a question about someone's own music library. You are given the question, what a song must be to count, and a numbered table of their songs. Judge every row on its own, with what you know of the music and what the table says: is this song what they asked about? Reply with JSON only: picks, one for each song that is, each its number (n) and why in at most ten plain words; leave out every song that is not. There is no number to reach or to stay under. Never use a number that is not in the table.`

/** `n` of the songs, spread evenly through them, in their order. */
function spread(songs: readonly Song[], n: number): Song[] {
  if (songs.length <= n) return [...songs]
  return Array.from({ length: n }, (_, i) => songs[Math.floor((i * songs.length) / n)]!)
}

/**
 * Which of the songs the filters let in are what a question means, when only
 * a model can tell (what a song is about, how it sounds): every one of them is
 * judged, a table at a time, rather than a pick from a sample, so the count is
 * a count. Past `JUDGE_MOST` an even spread is judged and the count is scaled.
 */
export async function songsThatAre(
  deps: DescribeDeps,
  text: string,
  understanding: Understanding,
  steps: Steps = NO_STEPS,
): Promise<Judged> {
  const remembered = deps.remembered ?? new Remembered()
  const now = deps.now?.() ?? Date.now()
  const tags = deps.tags()
  steps.begin('Looking through your library')
  const fitting = songsFitting(deps.songs(), tags, understanding, now, deps.artistNames?.())
  steps.done(`${fitting.length} ${fitting.length === 1 ? 'song' : 'songs'} to judge`)
  const judging = spread(fitting, JUDGE_MOST)
  const meaning = [understanding.brief, understanding.sound && `sounds like ${understanding.sound}`]
    .filter(Boolean)
    .join('; ')
  const tables: Song[][] = []
  for (let at = 0; at < judging.length; at += JUDGE_BATCH) {
    tables.push(judging.slice(at, at + JUDGE_BATCH))
  }
  if (tables.length === 0) return { songIds: [], judged: 0, of: 0 }
  steps.begin(
    judging.length < fitting.length
      ? `Judging ${judging.length} of the ${fitting.length}, one by one`
      : `Judging ${judging.length === 1 ? 'it' : `all ${judging.length}`}, one by one`,
  )
  const found = await Promise.all(
    tables.map(async table => {
      const prompt = [
        `The question: ${text}`,
        `What a song must be to count: ${meaning}`,
        '',
        'The table (number | title | artist | album | year | tags | energy | tempo | length | words | plays):',
        songTable(table, tags, now),
      ].join('\n')
      const answer = await remembered.get(
        Remembered.key('ask-judge', JUDGE_VERSION, prompt),
        async () =>
          (
            await deps.llm.generate({
              task: 'ask-judge',
              tier: 'smart',
              system: JUDGE_SYSTEM,
              prompt,
              schema: PickOut,
            })
          ).value,
      )
      return groundPicks(answer.picks, table, table.length).map(pick => pick.songId)
    }),
  )
  const songIds = found.flat()
  steps.done(`${songIds.length} ${songIds.length === 1 ? 'is' : 'are'}`)
  return { songIds, judged: judging.length, of: fitting.length }
}

/** How many songs a pick in an order chooses from: the first in the order, a pick's table of them. */
const IN_ORDER_POOL = 300

/**
 * Songs to play in an order the library knows (the most played, the newest,
 * the longest): the songs the filters let in, sorted in code, and the first of
 * them, as many or as long as asked, with no model. Words only a model can
 * judge are judged among the first in the order, and what it chooses keeps the
 * order. When nothing fits, Describe answers, loosening the filters and saying so.
 */
export async function songsInOrder(
  deps: DescribeDeps,
  text: string,
  understanding: Understanding,
  unknown: string[],
  /** The song steered from, which is not one of them. */
  avoid: readonly number[],
  sort: { sortBy: AskSort; order: AskOrder },
  steps: Steps = NO_STEPS,
): Promise<DescribeResult> {
  const now = deps.now?.() ?? Date.now()
  steps.begin('Looking through your library')
  const left = new Set(avoid)
  let fitting = songsFitting(
    deps.songs(),
    deps.tags(),
    understanding,
    now,
    deps.artistNames?.(),
  ).filter(song => !left.has(song.id))
  // Resting songs (shared rest.ts) stay out while anything else fits, as in any music to play.
  const awake = fitting.filter(song => !isResting(song, now))
  const notes: string[] = []
  const resting = fitting.length - awake.length
  if (awake.length > 0 && resting > 0) {
    fitting = awake
    notes.push(`Left out ${resting === 1 ? '1 song' : `${resting} songs`} you’ve set to rest.`)
  }
  steps.done(
    fitting.length === 0
      ? undefined
      : `${fitting.length} ${fitting.length === 1 ? 'song fits' : 'songs fit'}`,
  )
  if (fitting.length === 0) return narrowAndPick(deps, text, understanding, unknown, avoid, steps)
  const sorted = sortSongs(fitting, sort.sortBy, sort.order)
  if (understanding.brief !== null || understanding.sound !== null) {
    const pool = sorted.slice(0, IN_ORDER_POOL)
    const found = await narrowAndPick(
      { ...deps, songs: () => pool },
      text,
      understanding,
      unknown,
      [],
      steps,
      null,
      false,
    )
    const place = new Map(pool.map((song, index) => [song.id, index]))
    const picks = [...found.picks].sort(
      (a, b) => (place.get(a.songId) ?? 0) - (place.get(b.songId) ?? 0),
    )
    return { ...found, fit: fitting.length, picks, notes: [...notes, ...found.notes] }
  }
  const target = understanding.minutes === null ? null : understanding.minutes * 60
  const size = Math.min(MAX_PICKS, understanding.size ?? DEFAULT_SIZE)
  const picks: DescribePick[] = []
  let seconds = 0
  for (const song of sorted) {
    if (picks.length >= (target === null ? size : MAX_PICKS)) break
    if (target !== null && seconds >= target) break
    picks.push({ songId: song.id, why: null })
    seconds += song.duration
  }
  return { understanding, fit: fitting.length, loosened: [], unknown, picks, notes }
}

const RULE_OPS: Readonly<Record<string, string>> = {
  gt: 'over',
  gte: 'at least',
  lt: 'under',
  lte: 'at most',
  eq: 'exactly',
  contains: 'containing',
  notContains: 'not containing',
  equals: 'exactly',
  startsWith: 'starting with',
  inLastDays: 'in the last',
  notInLastDays: 'not in the last',
}

/** A live playlist's rules in words, for the router and for an answer: "songs tagged 中文流行". */
export function rulesWords(rules: SmartRules, tags: readonly Tag[]): string {
  const names = new Map(tags.map(tag => [tag.id, tag.name]))
  const each = rules.rules.map(rule => {
    switch (rule.field) {
      case 'tag':
        return `${rule.op === 'has' ? 'tagged' : 'not tagged'} ${names.get(rule.tagId) ?? '(a deleted tag)'}`
      case 'title':
      case 'artist':
      case 'album':
      case 'albumArtist':
        return `with ${rule.field} ${RULE_OPS[rule.op]} “${rule.value}”`
      case 'duration':
        return `${RULE_OPS[rule.op]} ${formatDuration(rule.value)} long`
      case 'playCount':
      case 'year':
      case 'bpm':
      case 'energy':
      case 'loudness':
        return `with ${rule.field} ${RULE_OPS[rule.op]} ${rule.value}`
      case 'addedAt':
      case 'lastPlayedAt': {
        const what = rule.field === 'addedAt' ? 'added' : 'played'
        return rule.op === 'never'
          ? `never ${what}`
          : `${what} ${RULE_OPS[rule.op]} ${rule.days} days`
      }
      case 'loved':
        return rule.value ? 'loved' : 'not loved'
      case 'hasLyrics':
        return rule.value ? 'with lyrics' : 'without lyrics'
      case 'hasArt':
        return rule.value ? 'with a cover' : 'without a cover'
      case 'key':
        return `in a key ${rule.op === 'is' ? 'of' : 'that mixes with'} ${rule.value}`
    }
  })
  const songs =
    each.length === 0
      ? 'every song'
      : `songs ${each.join(rules.match === 'all' ? ' and ' : ' or ')}`
  return rules.limit === null ? songs : `the first ${rules.limit} ${songs}`
}

/** The songs an understanding chose, in words a request can carry: "the songs by 五月天". */
function songsWords(understanding: Understanding): string {
  const { artists, albums, anyTags } = understanding
  const places = [
    artists.length > 0 ? `by ${artists.join(' or ')}` : '',
    albums.length > 0 ? `on ${albums.join(' or ')}` : '',
    anyTags.length > 0 ? `tagged ${anyTags.join(' or ')}` : '',
  ].filter(Boolean)
  const what = [understanding.brief, understanding.sound && `that sound ${understanding.sound}`]
    .filter(Boolean)
    .join(', ')
  return [`the songs ${places.join(', ')}`.trim(), what].filter(Boolean).join(', ')
}

/**
 * An add or a remove asked of a live playlist, which fills itself from its
 * rules: nothing to propose, so the answer says how its rules decide, whether
 * the songs meant are in it already (or not in it), and, when it follows tags,
 * the tag change that would put them in or take them out, ready to ask.
 */
function liveEdit(
  deps: DescribeDeps,
  playlist: AskPlaylist,
  plan: z.infer<typeof PlanOut> | null,
  op: 'add' | 'remove' | 'sort',
  /** The songs pointed at, when the request named them by handle. */
  within: readonly Song[] | null = null,
): AskCard {
  const songs = within ?? deps.songs()
  const tags = deps.tags()
  const now = deps.now?.() ?? Date.now()
  const rules = playlist.rules
  const holds = rules ? rulesWords(rules, tags) : 'the songs its rules choose'
  if (op === 'sort') {
    return instead(
      `${playlist.name} is live: it holds ${holds}, in the order its rules set${rules ? ` (by ${rules.orderBy}, ${rules.order === 'asc' ? 'lowest' : 'highest'} first)` : ''}.`,
    )
  }
  const { understanding } = groundPlan(
    plan ?? EVERYTHING,
    songs,
    tags,
    deps.artistNames?.() ?? NO_JOINS,
  )
  const judged = understanding.brief !== null || understanding.sound !== null
  if (!within && !chooses(understanding) && !judged) {
    return instead(
      `${playlist.name} is live: it holds ${holds}. Say which songs you mean: an artist, an album, a tag, or a kind of song.`,
    )
  }
  const members = new Set(playlist.songIds())
  const fitting = songsFitting(songs, tags, understanding, now, deps.artistNames?.())
  const names = new Map(tags.map(tag => [tag.id, tag.name]))
  // The tags a song gets in by: what a playlist following tags can be asked through.
  const followed = (rules?.rules ?? []).flatMap(rule =>
    rule.field === 'tag' && rule.op === 'has' ? (names.get(rule.tagId) ?? []) : [],
  )
  const byTags = followed.length > 0 && (rules?.rules ?? []).every(rule => rule.field === 'tag')
  const all = rules?.match === 'all'
  const meant = songsWords(understanding)
  if (op === 'add') {
    const missing = fitting.filter(song => !members.has(song.id))
    if (!judged && fitting.length > 0 && missing.length === 0) {
      return instead(
        `${fitting.length === 1 ? 'That song is' : `All ${fitting.length} of those songs are`} in ${playlist.name} already: it holds ${holds}.`,
      )
    }
    const tries = !byTags
      ? []
      : all
        ? [`give ${meant} the tags ${followed.join(' and ')}`]
        : followed.map(tag => `give ${meant} the tag ${tag}`)
    return instead(
      `${playlist.name} is live: it holds ${holds}, so a song goes in by matching that${judged ? '' : `, and ${missing.length === 1 ? '1 of those songs does' : `${missing.length} of those songs do`} not yet`}.${tries.length > 0 ? ' Giving them its tag puts them in.' : ''}`,
      tries,
    )
  }
  const inIt = fitting.filter(song => members.has(song.id))
  if (!judged && inIt.length === 0) {
    return instead(`None of those songs are in ${playlist.name}: it holds ${holds}.`)
  }
  // Out of a playlist that takes any of its tags, a song goes only when it has none of them left.
  // That is said, never offered as a press: a tag taken off takes the songs out of the tag's own
  // page and every other list following it too, which is more than "out of this playlist" asked.
  return instead(
    `${playlist.name} is live: it holds ${holds}, so a song leaves it by no longer matching that.${byTags ? ` Taking ${followed.length === 1 ? `the tag ${followed[0]}` : `the tags ${followed.join(', ')}`} off them takes them out, and out of ${followed.length === 1 ? 'that tag' : 'those tags'} everywhere else too.` : ''}`,
  )
}

/** "add the YOASOBI songs to gym", "take the slow ones out of chill", "sort genshin by energy". */
export async function playlistSongs(
  deps: DescribeDeps,
  playlist: AskPlaylist,
  text: string,
  plan: z.infer<typeof PlanOut> | null,
  edit: { op: 'add' | 'remove' | 'sort'; sortBy: AskSort | null; order: AskOrder },
  steps: Steps = NO_STEPS,
  /**
   * The songs the request pointed at by handle (`scope.ts`): the songs added
   * or taken out are among these alone, and without filters they are all of
   * them.
   */
  within: readonly Song[] | null = null,
): Promise<AskCard> {
  if (playlist.kind === 'live') return liveEdit(deps, playlist, plan, edit.op, within)
  const songs = deps.songs()
  const tags = deps.tags()
  const now = deps.now?.() ?? Date.now()
  const byId = new Map(songs.map(song => [song.id, song]))
  const members = playlist
    .songIds()
    .map(id => byId.get(id))
    .filter((song): song is Song => song !== undefined)

  if (edit.op === 'sort') {
    if (!edit.sortBy) {
      return instead(
        'Say what to sort it by: energy, tempo, title, artist, length, plays, or when they were added.',
      )
    }
    return {
      kind: 'playlistSongs',
      playlist: playlist.name,
      op: 'sort',
      songs: sortSongs(members, edit.sortBy, edit.order).map(song => ({
        songId: song.id,
        why: null,
      })),
      understanding: null,
      by: 'rule',
      sortBy: edit.sortBy,
      order: edit.order,
      unknown: [],
    }
  }

  const adding = edit.op === 'add'
  const { understanding, unknown } = groundPlan(
    plan ?? EVERYTHING,
    songs,
    tags,
    deps.artistNames?.() ?? NO_JOINS,
  )
  if (!within && !chooses(understanding) && understanding.brief === null) {
    return instead(
      adding
        ? `Say which songs to add to ${playlist.name}: an artist, an album, a tag, or a kind of song.`
        : `Say which songs to take out of ${playlist.name}: an artist, an album, a tag, or a kind of song.`,
    )
  }
  const inPlaylist = new Set(members.map(song => song.id))
  const pointed = within ? new Set(within.map(song => song.id)) : null
  const pool = (
    adding ? (within ?? songs).filter(song => !inPlaylist.has(song.id)) : members
  ).filter(song => !pointed || pointed.has(song.id))
  const fitting = songsFitting(pool, tags, understanding, now, deps.artistNames?.())
  if (within && fitting.length === 0) {
    return instead(
      adding
        ? `${within.length === 1 ? 'That song is' : `All ${within.length} of those songs are`} in ${playlist.name} already.`
        : `None of those songs are in ${playlist.name}.`,
    )
  }
  const answer = (
    chosen: { songId: number; why: string | null }[],
    by: 'rule' | 'model',
  ): AskCard => ({
    kind: 'playlistSongs',
    playlist: playlist.name,
    op: edit.op,
    songs: chosen,
    understanding,
    by,
    sortBy: null,
    order: edit.order,
    unknown,
  })
  if (fitting.length === 0) return answer([], 'rule')
  if (understanding.brief === null) {
    // The filters said it all: every song they let in, or as many as were asked for.
    const chosen = understanding.size === null ? fitting : fitting.slice(0, understanding.size)
    return answer(
      chosen.map(song => ({ songId: song.id, why: null })),
      'rule',
    )
  }
  // Words the filters cannot say ("the ones that don't fit"): the model judges
  // the songs that pass them, and only those (nothing is loosened here).
  const judging = narrowAndPick(
    { ...deps, songs: () => fitting },
    adding
      ? `Songs to add to the playlist “${playlist.name}”, as they asked: “${text}”`
      : `The songs to take out of the playlist “${playlist.name}”, as they asked: “${text}”. Choose only the ones that should go.`,
    { ...understanding, size: understanding.size ?? (adding ? null : fitting.length) },
    unknown,
    [],
    steps,
    null,
    // A playlist's songs are edited whether or not they are resting.
    false,
  )
  // Choosing none is an answer here too: nothing in the playlist is what they meant.
  return answer((await judging).picks, 'model')
}
