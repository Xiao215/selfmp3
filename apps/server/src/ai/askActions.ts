import { z } from 'zod/v4'
import {
  AskOrderSchema,
  AskPlaceSchema,
  AskSortSchema,
  AskStatsRangeSchema,
  type AskAnswer,
  type Song,
  type Stats,
} from '@selfmp3/shared'
import { EVERYTHING, libraryAnswer, playlistSongs, type AskPlaylist } from './askLibrary.js'
import {
  PickOut,
  groundPicks,
  groundPlan,
  narrowAndPick,
  songsFitting,
  type DescribeDeps,
  type PlanOut,
} from './describe.js'
import { songTable } from './library.js'
import { Remembered } from './llm.js'
import type { FindNames } from './names.js'
import type { Steps } from './progress.js'
import { explore } from './explore.js'
import { getMusic, type MusicCatalogue } from './getMusic.js'
import { tagReview } from './tagReview.js'
import { tidy } from './tidy.js'

/**
 * What the Search box's Ask can do (docs/features/ai.md, "S1"), one entry
 * each. An action says when the router should choose it and how to fill it
 * in, what its part of the router's form is, whether it reads Describe's
 * filters, which Settings switch it sits behind, and how it answers. The
 * router (ask.ts) builds its prompt and its form from this list and runs
 * whichever entry it chose; adding an action is adding an entry.
 *
 * An entry is the shape a tool has (a name, when to use it, its parameters),
 * so a model that calls tools can be given these as they are.
 */

export interface AskDeps extends DescribeDeps {
  /** The playlists, for "delete…", "rename…" (`matchPlaylist`) and their songs. */
  readonly playlists?: () => readonly AskPlaylist[]
  readonly stats: (range: Stats['range']) => Stats
  readonly lyrics: (query: string) => { songId: number; line: string }[]
  /** The music catalogues, for names from outside the library (`names.ts`). */
  readonly findNames?: FindNames
  /** How they want things done, for every request (Settings › Smart features). */
  readonly notes?: () => readonly string[]
  /** 网易云's search, for looking things up (`explore.ts`). */
  readonly catalogue?: (
    words: string,
  ) => Promise<readonly { title: string; artist: string; album: string; duration: number }[]>
  /** Settings' web switch: whether looking things up may search the web. */
  readonly web?: () => boolean
  /** 网易云's albums and songs, for music to import (`getMusic.ts`). */
  readonly music?: MusicCatalogue
}

/** Features turned off in Settings that the router may still choose. */
export interface AskAllowed {
  readonly tidy: boolean
  readonly tags: boolean
}

/** What every action is run with: the request, and the library as it was asked about. */
export interface AskContext {
  readonly deps: AskDeps & { readonly remembered: Remembered }
  readonly text: string
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
  /** The Settings switch it sits behind, and the feature's name for saying it is off. */
  readonly switch?: { readonly key: keyof AskAllowed; readonly label: string }
  /** A method, so an entry fits the list whatever its fields are. */
  run(context: AskContext, fields: F, filters: Plan | null): AskAnswer | Promise<AskAnswer>
}

/** An entry, with its fields' type read off its schema. */
function action<F>(entry: AskAction<F>): AskAction<F> {
  return entry
}

/** Not something the box can do, with what it can do instead. */
export const none = (say: string, tries: readonly string[] = []): AskAnswer => ({
  kind: 'none',
  say,
  try: tries
    .map(each => each.trim())
    .filter(Boolean)
    .slice(0, 2),
})

const lower = (value: string): string => value.toLowerCase()

/** Letters and digits only, lower case: "chill · chinese · hype" and "chill chinese hype" are one. */
const bare = (value: string): string => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]!
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const above = row[j]!
      row[j] = Math.min(above + 1, row[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1))
      diagonal = above
    }
  }
  return row[b.length]!
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
    .map(playlist => ({ name: playlist.name, far: editDistance(wanted, bare(playlist.name)) }))
    .filter(each => each.far <= slips)
    .sort((a, b) => a.far - b.far)
  if (near.length === 0 || (near.length > 1 && near[0]!.far === near[1]!.far)) return null
  return near[0]!.name
}

/** The most songs a "find" is chosen from. */
const MAX_FOUND = 150
const FIND_SIZE = 5
const FIND_VERSION = 1
/** How many songs "after this" adds to Up next when no number is said (A8). */
const NEXT_SIZE = 10

/** Songs whose title, artist or album holds a term, then ones whose lyrics do, once each. */
export function foundFor(
  terms: readonly string[],
  songs: readonly Song[],
  lyrics: AskDeps['lyrics'],
): { song: Song; line: string | null }[] {
  const wanted = terms.map(term => lower(term.trim())).filter(Boolean)
  const found = new Map<number, { song: Song; line: string | null }>()
  for (const song of songs) {
    const text = lower(`${song.title} ${song.artist} ${song.album}`)
    if (wanted.some(term => text.includes(term))) found.set(song.id, { song, line: null })
  }
  const byId = new Map(songs.map(song => [song.id, song]))
  for (const term of wanted) {
    for (const hit of lyrics(term)) {
      const song = byId.get(hit.songId)
      if (song && !found.has(song.id)) found.set(song.id, { song, line: hit.line })
      else if (song && found.get(song.id)!.line === null)
        found.set(song.id, { song, line: hit.line })
    }
  }
  return [...found.values()].slice(0, MAX_FOUND)
}

const FIND_SYSTEM = `Someone is looking for one song in their own library that they half remember. You are given what they remember and a numbered table of candidate songs (with a lyric line where one matched). Reply with JSON only: picks, at most ${FIND_SIZE}, best first, each the song's number (n) and why it fits in at most ten plain words. Only choose songs that plausibly are the one they mean; if none are, return no picks. Never use a number that is not in the table.`

const songs = action({
  name: 'songs',
  when: 'they want music: a playlist made, or something to listen to. Fill "filters". In "songs", play is true when they want it now ("play…", "put on…", "something for right now"), false when they want it kept ("make a playlist…"); next is true when they want it after the song playing ("next", "after this", "queue up…", "up next"), or when they ask to steer what is playing ("more like this", "something calmer"). When a song is playing and they say "this", "like this" or "after this", describe the music relative to it with the filters: its artists or tags for "like this", an energy range below its energy for "calmer", above it for "more upbeat".',
  fields: z.object({ play: z.boolean(), next: z.boolean() }),
  filters: 'required',
  run: async ({ deps, text, playing, nowPlaying, steps }, { play, next }, filters) => {
    const steering = next && playing !== undefined
    // Up next is a handful after this song, not a playlist's worth, unless a number was said.
    const plan = steering ? { ...filters!, size: filters!.size ?? NEXT_SIZE } : filters!
    const { understanding, unknown } = groundPlan(plan, deps.songs(), deps.tags())
    const found = await narrowAndPick(
      deps,
      `${text}${nowPlaying}`,
      understanding,
      unknown,
      [],
      steps,
    )
    // The song playing is what they are steering from, never one of the picks.
    const describe = { ...found, picks: found.picks.filter(pick => pick.songId !== playing?.id) }
    return { kind: 'songs', lead: steering ? 'next' : play ? 'play' : 'save', describe }
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
  run: async ({ deps, text, now, steps }, { terms, brief }) => {
    const quoted = terms
      .slice(0, 3)
      .map(term => `“${term}”`)
      .join(', ')
    steps.begin(`Looking for ${quoted} in titles and lyrics`)
    const found = foundFor(terms, deps.songs(), deps.lyrics)
    steps.done(found.length === 0 ? 'Nothing matched' : `${found.length} could be it`)
    if (found.length === 0) return { kind: 'find', terms, picks: [] }
    steps.begin('Choosing the one you mean')
    const table = found.map(each => each.song)
    const lines = songTable(table, deps.tags(), now)
      .split('\n')
      .map((line, index) => (found[index]!.line ? `${line} | lyric: ${found[index]!.line}` : line))
    const prompt = `What they remember: ${brief}\nTheir words: ${text}\n\nThe table (number | title | artist | album | year | tags | energy | tempo | length | words | plays | lyric):\n${lines.join('\n')}`
    const answer = await deps.remembered.get(
      Remembered.key('ask-find', FIND_VERSION, prompt),
      async () =>
        (
          await deps.llm.generate({
            task: 'ask-find',
            tier: 'smart',
            system: FIND_SYSTEM,
            prompt,
            schema: PickOut,
          })
        ).value,
    )
    steps.done()
    return { kind: 'find', terms, picks: groundPicks(answer.picks, table, FIND_SIZE) }
  },
})

const tags = action({
  name: 'tags',
  when: 'anything about their tags: songs given a tag or taken out of one, even when they leave it to you to say which songs ("tag every 周杰倫 song 中文流行", "tag the songs that should be 中文流行", "take ipop off what isn\'t Japanese"), a tag renamed, merged into another or deleted, or their tags checked or tidied up. Nothing else to fill: the request itself is what is used.',
  fields: null,
  filters: 'unused',
  switch: { key: 'tags', label: 'Tags' },
  run: async ({ deps, text, steps }) => ({
    kind: 'tags',
    review: await tagReview(deps, { text }, steps),
  }),
})

const stats = action({
  name: 'stats',
  when: 'a question about their own listening (most played, how much, which artists). Fill "stats": range is 7d, 30d, 90d, 365d or all ("last month" is 30d, "this year" is 365d); about is songs, artists, tags or totals.',
  fields: z.object({
    range: z.enum(AskStatsRangeSchema.options),
    about: z.enum(['songs', 'artists', 'tags', 'totals']),
  }),
  filters: 'unused',
  run: ({ deps, steps }, { range, about }) => {
    steps.begin('Reading your listening')
    const stats = deps.stats(range)
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
      items: items.slice(0, 5),
    }
  },
})

const library = action({
  name: 'library',
  when: 'a question about what is in their library, not about their listening ("how many YOASOBI songs do I have", "what did I add this week", "my longest song", "which songs have no lyrics", "who is in 中文流行"). Fill "filters" with the filters that choose the songs (null for the whole library; size for how many to list, such as 1 for "my longest song") and "library": show is count (how many), songs (which ones), artists, albums or tags (who or what they are by or in); sortBy and order when they ask for the most, least, longest, newest and so on (asc is lowest, earliest or A first; year is when a song came out, addedAt when it joined the library), else sortBy null.',
  fields: z.object({
    show: z.enum(['count', 'songs', 'artists', 'albums', 'tags']),
    sortBy: z.enum(AskSortSchema.options).nullable(),
    order: z.enum(AskOrderSchema.options),
  }),
  filters: 'optional',
  run: ({ deps }, question, filters) => libraryAnswer(deps, filters, question),
})

const tidyUp = action({
  name: 'tidy',
  when: 'anything about their songs\' names (titles, artists, albums): checked, fixed or cleaned up in general, or changed in a way they say ("give the 原神音乐 songs their official Chinese names", "write 周杰倫\'s albums in simplified Chinese", "take \'(Remastered)\' off the titles"). Fill "tidy": checkup is true when they only ask to check or clean up their names, false when they say what change they want; lookUp is true when the new names must come from outside the library (official, real or correct names, the real name of an album, the name the publisher uses in another language), false when the change is made from the names already there (take words off, change the script, make them consistent). When they say which songs, also fill "filters" with the filters that choose them (null for the whole library).',
  fields: z.object({ checkup: z.boolean(), lookUp: z.boolean() }),
  filters: 'optional',
  switch: { key: 'tidy', label: 'Tidy up' },
  run: async ({ deps, text, now, steps }, { checkup, lookUp }, filters) => {
    if (checkup) return { kind: 'tidy', tidy: await tidy(deps, steps) }
    const songs = deps.songs()
    const { understanding, unknown } = groundPlan(filters ?? EVERYTHING, songs, deps.tags())
    const chosen = songsFitting(songs, deps.tags(), understanding, now)
    return {
      kind: 'tidy',
      tidy: await tidy(deps, steps, { text, songs: chosen, unknown, lookUp }),
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
  when: 'they want songs put into or taken out of one playlist, or its songs put in order ("add the YOASOBI songs to gym", "take the slow ones out of chill", "sort genshin by energy"). Fill "playlistSongs": name copied from their playlist list as closely as you can; op add, remove or sort; for a sort, sortBy and order (asc is lowest, earliest or A first: calmest first is energy asc; year is when a song came out, addedAt when it joined the library), else sortBy null and order asc. For add and remove also fill "filters" with the filters that choose the songs (for remove, among the playlist\'s own songs), with brief for what the filters cannot say.',
  fields: z.object({
    name: z.string().max(120),
    op: z.enum(['add', 'remove', 'sort']),
    sortBy: z.enum(AskSortSchema.options).nullable(),
    order: z.enum(AskOrderSchema.options),
  }),
  filters: 'optional',
  run: ({ deps, text, playlists, steps }, edit, filters) => {
    const name = matchPlaylist(edit.name, playlists)
    const playlist = playlists.find(each => each.name === name)
    if (!playlist) return none(`No playlist here is called “${edit.name}”.`)
    return playlistSongs(deps, playlist, text, filters, edit, steps)
  },
})

const lookInto = action({
  name: 'explore',
  when: 'a question or request that needs looking through their songs, the music catalogues or the web, and that no action above can do with its filters: which albums they have only part of, what a song or album is called in another language, what game or show a song is from, whether they have something, comparing artists or albums. Nothing else to fill: the request itself is used. Prefer this to "none" whenever looking things up could answer it.',
  fields: null,
  filters: 'unused',
  run: async ({ deps, text, steps }) => explore(deps, text, steps),
})

const getMusicAction = action({
  name: 'getMusic',
  when: 'they want music they don\'t have yet: an album, the rest of an album, a soundtrack, a song ("get the rest of the Liyue OST", "download 春泥棒", "把千岩旷望下载了"). Fill "getMusic": words are what to search a music catalogue for, the album\'s or song\'s name with its artist as they would be listed (the official name when you know it); kind is album for an album, a soundtrack or "the rest of" one, else song.',
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
