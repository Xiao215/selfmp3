import { z } from 'zod/v4'
import {
  AskOrderSchema,
  AskPlaceSchema,
  AskPlaybackOpSchema,
  AskSortSchema,
  AskStatsRangeSchema,
  editDistance,
  NO_JOINS,
  type AskAnswer,
  type AskTurn,
  type DescribeResult,
  type Song,
  type Stats,
} from '@selfmp3/shared'
import {
  EVERYTHING,
  libraryAnswer,
  none,
  playlistSongs,
  songsInOrder,
  songsThatAre,
  type AskPlaylist,
} from './askLibrary.js'
import {
  groundPlan,
  narrowAndPick,
  songsFitting,
  type DescribeDeps,
  type PlanOut,
} from './describe.js'
import type { Remembered } from './llm.js'
import type { CatalogueSearch, FindListings, FindNames } from './names.js'
import { findCopies } from './copies.js'
import { fillGaps } from './fill.js'
import type { Steps } from './progress.js'
import { explore } from './explore.js'
import { halfRemembered } from './halfRemembered.js'
import { getMusic, type MusicCatalogue } from './getMusic.js'
import { refine } from './refine.js'
import {
  heldObject,
  PLAYING,
  ScopeField,
  SCOPE_WHEN,
  scopeOf,
  scopeWhy,
  type Held,
  type Scope,
} from './scope.js'
import { tagReview } from './tagReview.js'
import { bare } from './text.js'
import { oneSpelling, tidy } from './tidy.js'

/**
 * What the Search box's Ask can do (docs/features/ai.md, "S1"), one entry
 * each. An action says when the router should choose it and how to fill it
 * in, what its part of the router's form is, whether it reads Describe's
 * filters, and how it answers. The
 * router (ask.ts) builds its prompt and its form from this list and runs
 * whichever entry it chose; adding an action is adding an entry.
 *
 * An entry is the shape a tool has (a name, when to use it, its parameters),
 * so a model that calls tools can be given these as they are.
 */

export interface AskDeps extends DescribeDeps {
  /** The playlists, for "delete…", "rename…" (`matchPlaylist`) and their songs. */
  readonly playlists?: () => readonly AskPlaylist[]
  /** The listening in a range, with up to `top` songs, artists and tags (the Stats page's when left out). */
  readonly stats: (range: Stats['range'], top?: number) => Stats
  readonly lyrics: (query: string) => { songId: number; line: string }[]
  /** The music catalogues, for names from outside the library (`names.ts`). */
  readonly findNames?: FindNames
  /** Every catalogue's listings for a song, for an album, a year or a cover it lacks. */
  readonly findListings?: FindListings
  /** How they want things done, for every request (Settings › Smart features). */
  readonly notes?: () => readonly string[]
  /** 网易云's search, for looking things up (`explore.ts`). */
  readonly catalogue?: CatalogueSearch
  /** Whether looking things up may search the web: always, as the server runs it. */
  readonly web?: () => boolean
  /** 网易云's albums and songs, for music to import (`getMusic.ts`). */
  readonly music?: MusicCatalogue
  /** How each Chinese or Japanese name is spelt in Latin letters, for one artist's names made one. */
  readonly spellings?: () => ReadonlyMap<string, readonly string[]>
}

/** What every action is run with: the request, and the library as it was asked about. */
export interface AskContext {
  readonly deps: AskDeps & { readonly remembered: Remembered }
  /** The request as asked after the conversation (`followed`). */
  readonly text: string
  /** Their newest words alone. */
  readonly words: string
  /** The conversation before, for what an object's turn first asked. */
  readonly before: readonly AskTurn[]
  /** What the handles name (`scope.ts`): the song playing and what earlier answers showed. */
  readonly held: Held
  /** The song playing on the asking device, and the line the router saw for it. */
  readonly playing: Song | undefined
  readonly nowPlaying: string
  readonly playlists: readonly AskPlaylist[]
  readonly now: number
  /** Told each stage as it begins, for the device's waiting steps (`progress.ts`). */
  readonly steps: Steps
}

type Plan = z.infer<typeof PlanOut>

export interface AskAction<F> {
  readonly name: string
  /** For the router: when to choose it and what to fill in, in a paragraph. */
  readonly when: string
  /** Its own part of the form, or null when the request itself is all it needs. */
  readonly fields: z.ZodType<F> | null
  /** Whether it reads the shared filters, and whether it cannot answer without them. */
  readonly filters: 'required' | 'optional' | 'unused'
  /**
   * What the router left out that this action cannot do without, past its
   * fields and required filters, or null: asked once more, as they are.
   */
  missing?(fields: F, filters: Plan | null): string | null
  /** A method, so an entry fits the list whatever its fields are. */
  run(context: AskContext, fields: F, filters: Plan | null): AskAnswer | Promise<AskAnswer>
}

/** What is said when a handle names no songs here, rather than reaching for the whole library. */
function pointedAtNothing(from: NonNullable<Scope>): AskAnswer {
  return none(
    from.handle === PLAYING
      ? 'Nothing is playing to look at.'
      : 'Those songs aren’t in your library any more.',
  )
}

/** An entry, with its fields' type read off its schema. */
function action<F>(entry: AskAction<F>): AskAction<F> {
  return entry
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

/** How many songs "after this" adds to Up next when no number is said (A8). */
const NEXT_SIZE = 10
/** How many songs, artists or tags a listening question lists when no number is said, and at most. */
const STATS_SIZE = 10
const STATS_MOST = 50

const songs = action({
  name: 'songs',
  when:
    'they want music: a playlist made, or something to listen to, new or from what an earlier answer showed. In "songs", play is true when they want it now, false when they want it kept; next is true when they want it after the song playing (next, after this, up next, queued), or when they ask to steer what is playing. ' +
    SCOPE_WHEN +
    ' With from, the songs are exactly those, in that order (what was shown, or some of it, played, kept or queued), and filters is null. Without from, fill "filters" with the songs they describe. like names the one song they want music that sounds like, the way from names songs (the song playing, or one place in an earlier answer), and the songs are then ordered by how close they sound to it, so music like a song needs no filters; describe a change from it in sound, and add its tags or artists only when they want the same kind. Otherwise like is null, even with a song playing. name is what they call the list when they give it a name, else null. sortBy and order when they want the songs that come first in an order the library can sort by (sortBy says what, order which end: desc for the most, longest, newest or latest first); the songs are then exactly the first ones in that order. Else sortBy null and order desc.',
  fields: z.object({
    play: z.boolean(),
    next: z.boolean(),
    from: ScopeField,
    like: ScopeField,
    name: z.string().max(60).nullable(),
    sortBy: z.enum(AskSortSchema.options).nullable(),
    order: z.enum(AskOrderSchema.options),
  }),
  filters: 'optional',
  missing: ({ from, like }, filters) =>
    from === null && like === null && filters === null ? 'filters' : null,
  run: async (
    { deps, text, held, playing, nowPlaying, steps },
    { play, next, from, like, name, sortBy, order },
    filters,
  ) => {
    const steering = next && playing !== undefined
    // Up next with nothing playing has nothing to come after: what was wanted soon is played now.
    const lead = steering ? 'next' : play || next ? 'play' : 'save'
    const library = deps.songs()
    // Songs already shown: exactly those, nothing picked.
    const pointed = scopeOf(from, held, library)
    if (from && pointed?.length === 0) return pointedAtNothing(from)
    if (from && pointed)
      return { kind: 'songs', lead, ...shownSongs(deps, held, from, pointed, name) }
    const likeSong = scopeOf(like, held, library)?.[0]
    if (like && !likeSong) return pointedAtNothing(like)
    // Up next is a handful after this song, not a playlist's worth, unless a number was said.
    const asked = filters ?? EVERYTHING
    const plan = steering ? { ...asked, size: asked.size ?? NEXT_SIZE } : asked
    const { understanding, unknown } = groundPlan(
      // Music like one song with nothing else said is named after that song.
      {
        ...plan,
        name: name?.trim() || (!filters && likeSong ? `Like ${likeSong.title}` : plan.name),
      },
      library,
      deps.tags(),
      deps.artistNames?.() ?? NO_JOINS,
    )
    // Steering from a song (next, more like it) leaves it out: it is what they
    // move on from. Asked for any other way (a list of them while one of them
    // plays), it is one of the songs like any other.
    const leaving = likeSong ?? (steering ? playing : undefined)
    const avoid = leaving ? [leaving.id] : []
    // An order the library knows says which songs come first: sorted in code, not picked from a sample.
    const found = sortBy
      ? await songsInOrder(
          deps,
          `${text}${nowPlaying}`,
          understanding,
          unknown,
          avoid,
          {
            sortBy,
            order,
          },
          steps,
        )
      : await narrowAndPick(
          deps,
          `${text}${nowPlaying}`,
          understanding,
          unknown,
          avoid,
          steps,
          // Only when they asked for music like it: what sounds close to it comes first.
          likeSong?.id ?? null,
        )
    const describe = { ...found, picks: found.picks.filter(pick => pick.songId !== leaving?.id) }
    return { kind: 'songs', lead, describe, like: likeSong?.id ?? null }
  },
})

/**
 * Songs an earlier answer showed, as a song answer of their own: exactly
 * those, in that order, each with the reason it was shown with. Named, the
 * list takes the name; else the name it had.
 */
function shownSongs(
  deps: AskDeps,
  held: Held,
  from: NonNullable<Scope>,
  pointed: readonly Song[],
  name: string | null,
): { describe: DescribeResult; like: number | null } {
  const object = from.handle === PLAYING ? undefined : heldObject(held, from.handle)
  const why = scopeWhy(from, held)
  const base =
    object?.understanding ??
    groundPlan(EVERYTHING, deps.songs(), deps.tags(), deps.artistNames?.() ?? NO_JOINS)
      .understanding
  const called = name?.trim() || (object && !object.understanding ? object.label : '') || base.name
  return {
    describe: {
      understanding: { ...base, name: called.slice(0, 60), size: null, minutes: null },
      fit: pointed.length,
      loosened: [],
      unknown: [],
      notes: [],
      picks: pointed.map(song => ({ songId: song.id, why: why.get(song.id) ?? null })),
    },
    like: object?.like ?? null,
  }
}

/** The most places a change may take out of a list at once. */
const MOST_DROPPED = 50

/**
 * A list an earlier answer showed, changed (docs/features/ai.md, "Change
 * it"): the songs it names taken out and the rest kept as they were, or the
 * words read as a change to what it understood (`refine.ts`), the songs that
 * still fit kept in their places. It keeps what it was for: to play, to keep,
 * or after the song playing, sounding like it.
 */
const change = action({
  name: 'change',
  when: 'they want a song list an earlier answer showed changed, rather than something done with it as it is or a question about it: more or fewer songs, longer or shorter, a different sound, some of its songs taken out, other music let in. Fill "change": from is that list\'s handle; drop is the places in its list of the songs they want taken out when taking those out is all of the change, else null.',
  fields: z.object({
    from: z.string().max(12),
    drop: z.array(z.number().int().min(1).max(200)).max(MOST_DROPPED).nullable(),
  }),
  filters: 'unused',
  run: async ({ deps, words, before, held, steps }, { from, drop }) => {
    const object = heldObject(held, from)
    if (!object) return none('Say which list to change.')
    const all = { handle: from, picks: null }
    const shown = scopeOf(all, held, deps.songs()) ?? []
    if (shown.length === 0) return pointedAtNothing(all)
    const lead = object.lead ?? 'play'
    if (drop && drop.length > 0) {
      const gone = new Set(drop.flatMap(place => object.songIds[place - 1] ?? []))
      const left = shown.filter(song => !gone.has(song.id))
      const { describe } = shownSongs(deps, held, all, left, null)
      return { kind: 'songs', lead, describe, like: object.like }
    }
    const understanding =
      object.understanding ?? shownSongs(deps, held, all, shown, null).describe.understanding
    const asked = before.find(turn => turn.objects.some(each => each.handle === from))?.asked
    const changed = await refine(
      deps,
      {
        text: asked ?? understanding.name,
        understanding,
        change: words,
        shown: shown.map(song => song.id),
      },
      steps,
      object.like,
    )
    // The songs it kept come back with the reasons they were shown with.
    const why = scopeWhy(all, held)
    const describe = {
      ...changed,
      picks: changed.picks.map(pick => ({
        songId: pick.songId,
        why: pick.why ?? why.get(pick.songId) ?? null,
      })),
    }
    return { kind: 'songs', lead, describe, like: object.like }
  },
})

/**
 * A question an earlier answer already answers: said from what was shown,
 * each song's reason beside it, with the songs it is about. Nothing is looked
 * up; a question what was shown cannot answer is another action's.
 */
const reply = action({
  name: 'reply',
  when: 'a question about something an earlier answer showed that what it showed already answers: why a song is in a list (each song\'s reason is beside it, when it was given one), where a song is in it, what the list was. Fill "reply": say is the answer in at most three sentences, written in the language their newest words are in (not that of the song names, the list\'s name or the earlier turns), from what the conversation shows and nothing else; from names the songs it is about the way songs are named by handle and place, or null. When what was shown cannot answer it, choose the action that can find out instead.',
  fields: z.object({ say: z.string().min(1).max(600), from: ScopeField }),
  filters: 'unused',
  run: ({ deps, held }, { say, from }) => {
    const about = scopeOf(from, held, deps.songs()) ?? []
    return { kind: 'explore', say, songIds: about.map(song => song.id), get: null }
  },
})

/**
 * Listening with friends (docs/features/listen-together.md): a room to open,
 * or songs for the room they are in. The device knows which — only it knows
 * whether it is in a room — so the answer is the same either way: the songs
 * the words asked for, if any, and the device offers to start a room with
 * them or add them to the room (AskAnswer's `together`).
 */
const together = action({
  name: 'together',
  when: 'they want to listen with friends: a room, a jam or a listening party opened for friends to add songs to, or songs put into the room they are already in. When they say what music it should have, fill "filters" with it; when they only want the room, "filters" is null.',
  fields: null,
  filters: 'optional',
  run: async ({ deps, text, steps }, _fields, filters) => {
    if (!filters) return { kind: 'together', describe: null }
    const { understanding, unknown } = groundPlan(
      filters,
      deps.songs(),
      deps.tags(),
      deps.artistNames?.() ?? NO_JOINS,
    )
    const describe = await narrowAndPick(deps, text, understanding, unknown, [], steps, null)
    return { kind: 'together', describe }
  },
})

/** The furthest into Up next a place may count, either way: past any queue anyone keeps. */
const MAX_PLACE = 1000

/**
 * The music playing, controlled: the device carries it out (AskAnswer's
 * `playback`), since only it knows what is playing and what is in its Up next.
 * Nothing about the queue is sent here; a place in Up next is counted the way
 * the words say it, from the front or from the back, and the device finds it.
 */
const playback = action({
  name: 'playback',
  when: 'they want the music already playing controlled, not new music chosen: skip this song or go to the next one, go back to the song before, start this song again, pause or stop, carry on playing, or play one song already in Up next (the queue) by its place in it ("play the last song in Up next", "play the third song in the queue"). Fill "playback": op is next, previous, restart, pause, resume or upNext; for upNext, place counts from the front of Up next, 1 for the first and 3 for the third, or from the back as -1 for the last and -2 for the one before it; for every other op place is null. Asking for music to play or to queue is "songs", not this.',
  fields: z.object({
    op: z.enum(AskPlaybackOpSchema.options),
    place: z.number().int().min(-MAX_PLACE).max(MAX_PLACE).nullable(),
  }),
  filters: 'unused',
  run: (_context, { op, place }) => {
    if (op !== 'upNext') return { kind: 'playback', op, place: null }
    // "The song in Up next" with no place is not one the device can find.
    if (place === null || place === 0) return none('Say which song in Up next to play.')
    return { kind: 'playback', op, place }
  },
})

const find = action({
  name: 'find',
  when: 'they are looking for one particular song they half remember (its story, its words, how it sounds). Fill "find": terms are words likely to be in its title, artist, album or lyrics, in every language the library uses (grandma: 外婆, 奶奶, おばあちゃん, grandma), at most twelve; brief is what they remember, in a sentence.',
  fields: z.object({
    terms: z.array(z.string().max(60)).max(12),
    brief: z.string().max(200),
  }),
  filters: 'unused',
  run: async ({ deps, text, now, held, steps }, { terms, brief }) => {
    const { picks } = await halfRemembered(deps, { text, terms, brief, now }, steps)
    // Not one of theirs: what they named is looked up instead, so they hear what it is.
    return picks.length > 0 ? { kind: 'find', terms, picks } : explore(deps, text, steps, held)
  },
})

const tags = action({
  name: 'tags',
  when:
    'anything about their tags: songs given a tag or taken out of one, even when they leave it to you to say which songs ("tag every 周杰倫 song 中文流行", "tag the songs that should be 中文流行", "take ipop off what isn\'t Japanese"), a tag renamed, merged into another or deleted, or their tags checked or tidied up. The request itself says which songs and tags. Fill "tags": ' +
    SCOPE_WHEN +
    ' When they say how many songs to change, fill "filters" with that number as size and nothing else; otherwise filters is null.',
  fields: z.object({ from: ScopeField }),
  filters: 'optional',
  // The songs it points at go along, and the review looks at those and no others.
  run: async ({ deps, text, held, steps }, { from }, filters) => {
    const scope = scopeOf(from, held, deps.songs())
    if (from && scope?.length === 0) return pointedAtNothing(from)
    return {
      kind: 'tags',
      review: await tagReview(deps, { text, limit: filters?.size ?? null, scope }, steps),
    }
  },
})

const stats = action({
  name: 'stats',
  when: 'a question about their own listening (most played, how much, which artists). Fill "stats": range is 7d, 30d, 90d, 365d or all ("last month" is 30d, "this year" is 365d); about is songs, artists, tags or totals; size is how many to list when they say a number, else null.',
  fields: z.object({
    range: z.enum(AskStatsRangeSchema.options),
    about: z.enum(['songs', 'artists', 'tags', 'totals']),
    size: z.number().int().min(1).max(STATS_MOST).nullable(),
  }),
  filters: 'unused',
  run: ({ deps, steps }, { range, about, size }) => {
    const wanted = size ?? STATS_SIZE
    steps.begin('Reading your listening')
    const stats = deps.stats(range, wanted)
    steps.done()
    const items =
      about === 'songs'
        ? stats.topSongs.map(each => ({
            label: `${each.title} · ${each.artist}`,
            plays: each.plays,
            songId: each.songId,
          }))
        : about === 'artists'
          ? stats.topArtists.map(each => ({ label: each.key, plays: each.plays, songId: null }))
          : about === 'tags'
            ? stats.topTags.map(each => ({ label: each.key, plays: each.plays, songId: null }))
            : []
    return {
      kind: 'stats',
      range,
      about,
      plays: stats.totals.plays,
      minutes: stats.totals.minutes,
      items: items.slice(0, wanted),
    }
  },
})

const library = action({
  name: 'library',
  when:
    'a question about what is in their library, not about their listening ("how many YOASOBI songs do I have", "what did I add this week", "my longest song", "which songs have no lyrics", "who is in 中文流行"). Fill "filters" with the filters that choose the songs (null for the whole library; size for how many to list, such as 1 for "my longest song") and "library": from when the question is about songs already in front of them, which are then the only songs counted (' +
    SCOPE_WHEN +
    '); show is count (how many), songs (which ones), artists, albums or tags (who or what they are by or in); sortBy and order when they ask for the most, least, longest, newest and so on (asc is lowest, earliest or A first; year is when a song came out, addedAt when it joined the library), else sortBy null.',
  fields: z.object({
    from: ScopeField,
    show: z.enum(['count', 'songs', 'artists', 'albums', 'tags']),
    sortBy: z.enum(AskSortSchema.options).nullable(),
    order: z.enum(AskOrderSchema.options),
  }),
  filters: 'optional',
  run: async ({ deps: all, text, held, steps }, question, filters) => {
    // Songs it points at are the library the question is asked of.
    const scope = scopeOf(question.from, held, all.songs())
    if (question.from && scope?.length === 0) return pointedAtNothing(question.from)
    const deps = scope ? { ...all, songs: () => [...scope] } : all
    // A name the library lacks is counted as none of it, not looked for by a model.
    if (!filters || (filters.sound === null && filters.brief === null)) {
      return libraryAnswer(deps, filters, question)
    }
    // How a song sounds or what it is about cannot be counted in code: a model
    // judges each song the filters let in, and those it says are it are counted.
    const { understanding } = groundPlan(
      filters,
      deps.songs(),
      deps.tags(),
      deps.artistNames?.() ?? NO_JOINS,
    )
    const judged = await songsThatAre(deps, text, understanding, steps)
    return libraryAnswer(deps, filters, question, judged)
  },
})

const tidyUp = action({
  name: 'tidy',
  when:
    'anything about their songs\' names (titles, artists, albums): checked, fixed or cleaned up in general, or changed in a way they say ("give the 原神音乐 songs their official Chinese names", "write 周杰倫\'s albums in simplified Chinese", "take \'(Remastered)\' off the titles"); what their songs are missing (an album, a year, a cover) filled in; or songs they have more than once. Fill "tidy": what is checkup when they only ask to check or clean up their names, spellings when they want each artist the library holds under more than one name made one name, fill when they want what is missing filled in, copies when they ask about songs they have twice or more or which of the copies shown to keep, and change when they say what change they want made to the names; lookUp is true when the new names must come from outside the library (official, real or correct names, the real name of an album, the name the publisher uses in another language), false when the change is made from the names already there (take words off, change the script), and false for anything but a change; ' +
    SCOPE_WHEN +
    ' When they say which songs, or how many to change ("up to 300", "先换50首" is size 50), also fill "filters" with the filters that choose them (null for the whole library). Which of those songs still need the change ("the ones in English now") is not a filter: the request itself says it.',
  fields: z.object({
    what: z.enum(['checkup', 'change', 'spellings', 'fill', 'copies']),
    lookUp: z.boolean(),
    from: ScopeField,
  }),
  filters: 'optional',
  run: async ({ deps, text, now, held, steps }, { what, lookUp, from }, filters) => {
    // The songs it points at, when it does; else the ones the filters choose.
    const scope = scopeOf(from, held, deps.songs())
    if (from && scope?.length === 0) return pointedAtNothing(from)
    if (what === 'checkup' && scope === null && filters === null) {
      return { kind: 'tidy', tidy: await tidy(deps, steps) }
    }
    const songs = deps.songs()
    const { understanding, unknown } = groundPlan(
      filters ?? EVERYTHING,
      songs,
      deps.tags(),
      deps.artistNames?.() ?? NO_JOINS,
    )
    // Places asked for and none of them here: that is the answer, never the whole library instead.
    const named = filters
      ? filters.anyTags.length + filters.artists.length + filters.albums.length
      : 0
    const found =
      understanding.anyTags.length + understanding.artists.length + understanding.albums.length
    if (scope === null && named > 0 && found === 0) {
      return none(`Your library has no ${unknown.join(' or ')}.`)
    }
    const chosen =
      scope ?? songsFitting(songs, deps.tags(), understanding, now, deps.artistNames?.())
    // A checkup of the songs asked about: no change reaches past them.
    if (what === 'checkup') return { kind: 'tidy', tidy: await tidy(deps, steps, null, chosen) }
    if (what === 'copies') {
      return { kind: 'copies', copies: await findCopies(deps, chosen, steps) }
    }
    if (what === 'fill') {
      const limit = filters?.size ?? null
      return {
        kind: 'tidy',
        tidy: await fillGaps(deps, limit ? chosen.slice(0, limit) : chosen, text, steps),
      }
    }
    const asked = { text, songs: chosen, unknown, lookUp, limit: filters?.size ?? null }
    return {
      kind: 'tidy',
      tidy:
        what === 'spellings'
          ? await oneSpelling(deps, asked, steps)
          : await tidy(deps, steps, asked),
    }
  },
})

const remember = action({
  name: 'remember',
  when: 'they say how they want things done from now on, for every request after this one, not a change to make now ("from now on…", "always…", "never…", "remember that…", "I prefer…", "以后…", "记住…"). Fill "remember": note is that preference as one short rule in their language ("Song names in Chinese only, without the English after them").',
  fields: z.object({ note: z.string().max(200) }),
  filters: 'unused',
  run: (_context, { note }) => {
    const said = note.trim().replace(/\s+/g, ' ')
    return said ? { kind: 'remember', note: said } : none('Say what to remember.')
  },
})

const playlists = action({
  name: 'playlists',
  when: 'they want playlists deleted or one renamed. Fill "playlists": op is delete or rename; names are the playlists they mean, copied from their playlist list as closely as you can (they may misspell or shorten them); newName is the new name for a rename, else null. Playlists only, never songs or tags.',
  fields: z.object({
    op: z.enum(['delete', 'rename']),
    names: z.array(z.string().max(120)).max(20),
    newName: z.string().max(80).nullable(),
  }),
  filters: 'unused',
  run: ({ playlists }, { op, names: asked, newName }) => {
    const matched = asked.map(name => ({ name, found: matchPlaylist(name, playlists) }))
    const names = [...new Set(matched.flatMap(each => each.found ?? []))]
    const unknown = matched.filter(each => each.found === null).map(each => each.name)
    if (names.length === 0) {
      return none(
        asked.length > 0
          ? `No playlist here is called ${asked.map(name => `“${name}”`).join(' or ')}.`
          : 'Say which playlists you mean.',
      )
    }
    if (op === 'rename') {
      const to = (newName ?? '').trim().replace(/\s+/g, ' ')
      if (names.length !== 1 || !to || to === names[0]) {
        return none('Say which one playlist to rename, and what to call it.')
      }
      return { kind: 'playlists', op, names, newName: to, unknown }
    }
    return { kind: 'playlists', op, names, newName: null, unknown }
  },
})

const playlistEdit = action({
  name: 'playlistSongs',
  when:
    'they want songs put into or taken out of one playlist, or its songs put in order ("add the YOASOBI songs to gym", "take the slow ones out of chill", "sort genshin by energy"). Fill "playlistSongs": name copied from their playlist list as closely as you can; op add, remove or sort; for a sort, sortBy and order (asc is lowest, earliest or A first: calmest first is energy asc; year is when a song came out, addedAt when it joined the library), else sortBy null and order asc. For add and remove, from when the songs are ones already in front of them (' +
    SCOPE_WHEN +
    '), and then filters is null; otherwise fill "filters" with the filters that choose the songs (for remove, among the playlist\'s own songs), with brief for what the filters cannot say. Choose this for a live playlist too: its rules decide its songs, and the answer says how.',
  fields: z.object({
    name: z.string().max(120),
    from: ScopeField,
    op: z.enum(['add', 'remove', 'sort']),
    sortBy: z.enum(AskSortSchema.options).nullable(),
    order: z.enum(AskOrderSchema.options),
  }),
  filters: 'optional',
  run: ({ deps, text, held, playlists, steps }, edit, filters) => {
    const name = matchPlaylist(edit.name, playlists)
    const playlist = playlists.find(each => each.name === name)
    if (!playlist) return none(`No playlist here is called “${edit.name}”.`)
    const scope = edit.op === 'sort' ? null : scopeOf(edit.from, held, deps.songs())
    if (edit.from && scope?.length === 0) return pointedAtNothing(edit.from)
    return playlistSongs(deps, playlist, text, filters, edit, steps, scope)
  },
})

const lookInto = action({
  name: 'explore',
  when: 'a question or request that needs looking through their songs, the music catalogues or the web, and that no action above can do with its filters: which albums they have only part of, what a song or album is called in another language, what game or show a song is from, whether they have something, comparing artists or albums; and any question about music itself, a song, an artist or an album, whether or not it is in their library, a name on its own included. Nothing else to fill: the request itself is used. Prefer this to "none" whenever looking things up could answer it.',
  fields: null,
  filters: 'unused',
  run: async ({ deps, text, held, steps }) => explore(deps, text, steps, held),
})

const getMusicAction = action({
  name: 'getMusic',
  when: 'they ask to get music they don\'t have yet: an album, the rest of an album, a soundtrack, a song ("get the rest of the Liyue OST", "download 春泥棒", "把千岩旷望下载了"). Only when they ask for it to be got; a name on its own asks about it, which is "explore". Fill "getMusic": words are what to search a music catalogue for, the album\'s or song\'s name with its artist as they would be listed (the official name when you know it); kind is album for an album, a soundtrack or "the rest of" one, else song.',
  fields: z.object({ words: z.string().min(1).max(120), kind: z.enum(['album', 'song']) }),
  filters: 'unused',
  run: async ({ deps, steps }, wanted) => {
    if (!deps.music) return none('Finding music to import needs your server.')
    const answer = await getMusic({ songs: deps.songs, music: deps.music }, wanted, steps)
    return answer.items.length > 0 ? answer : none(`网易云 has nothing for “${wanted.words}”.`)
  },
})

const open = action({
  name: 'open',
  when: 'they want to go somewhere in the app rather than get an answer here: import (to paste a YouTube, Spotify or 网易云 link themselves; for particular music, getMusic), stats, tags, library, playlists, settings. Fill "open": place is where, and say is one sentence on what they will find there. The app shows a button that goes there: never say you opened, changed or did anything.',
  fields: z.object({
    place: z.enum(AskPlaceSchema.options),
    say: z.string().max(240),
  }),
  filters: 'unused',
  run: (_context, { place, say }) => ({ kind: 'open', place, say }),
})

/** Every action, in the order the router is told them. */
export const ASK_ACTIONS: readonly AskAction<unknown>[] = [
  songs,
  change,
  reply,
  together,
  playback,
  find,
  tags,
  stats,
  library,
  tidyUp,
  remember,
  playlists,
  playlistEdit,
  lookInto,
  getMusicAction,
  open,
]
