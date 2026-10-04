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
import {
  FILTERS_GUIDE,
  PickOut,
  PlanOut,
  groundPicks,
  groundPlan,
  narrowAndPick,
  type DescribeDeps,
} from './describe.js'
import { libraryAnswer, playlistSongs, type AskPlaylist } from './askLibrary.js'
import { libraryShape, songTable } from './library.js'
import { Remembered } from './llm.js'
import { tagReview } from './tagReview.js'
import { tidy } from './tidy.js'

import { NO_STEPS, type Steps } from './progress.js'
/**
 * S1 · the Search box's Ask (docs/features/ai.md).
 *
 * A router: one call reads the request against the library's shape and
 * chooses one of a fixed list of actions, filling in what that action needs.
 * Then the action runs as code: "songs" and "find" make a second call, to
 * pick, and "tags" and "tidy" run their own reviews. Every answer is a proposal: nothing here writes.
 *
 * The router's answer for "songs" is Describe's plan itself, so a playlist
 * asked for in the box costs what Describe costs and no more.
 */

const VERSION = 6

/** The most songs a "find" is chosen from. */
const MAX_FOUND = 150
const FIND_SIZE = 5
/** How many songs "after this" adds to Up next when no number is said (A8). */
const NEXT_SIZE = 10

const RouteOut = z.object({
  action: z.enum([
    'songs',
    'find',
    'tags',
    'stats',
    'library',
    'tidy',
    'playlists',
    'playlistSongs',
    'open',
    'none',
  ]),
  /** songs: they want it now, not kept. */
  play: z.boolean(),
  /** songs: they want it after the song playing, in Up next. */
  next: z.boolean(),
  /** songs, playlistSongs (add and remove) and library: the filters, as Describe's plan. */
  songs: PlanOut.nullable(),
  find: z
    .object({ terms: z.array(z.string().max(60)).max(12), brief: z.string().max(200) })
    .nullable(),
  stats: z
    .object({
      range: z.enum(AskStatsRangeSchema.options),
      about: z.enum(['songs', 'artists', 'tags', 'totals']),
    })
    .nullable(),
  playlists: z
    .object({
      op: z.enum(['delete', 'rename']),
      names: z.array(z.string().max(120)).max(20),
      newName: z.string().max(80).nullable(),
    })
    .nullable(),
  playlistSongs: z
    .object({
      name: z.string().max(120),
      op: z.enum(['add', 'remove', 'sort']),
      sortBy: z.enum(AskSortSchema.options).nullable(),
      order: z.enum(AskOrderSchema.options),
    })
    .nullable(),
  library: z
    .object({
      show: z.enum(['count', 'songs', 'artists', 'albums', 'tags']),
      sortBy: z.enum(AskSortSchema.options).nullable(),
      order: z.enum(AskOrderSchema.options),
    })
    .nullable(),
  open: z.enum(AskPlaceSchema.options).nullable(),
  /** open and none: one plain sentence for the person. */
  say: z.string().max(240).nullable(),
  /** none: requests the box can do that come closest, in their words. */
  try: z.array(z.string().max(120)).max(2).nullable(),
})

const ROUTE_SYSTEM = `You are the request box of someone's own music app. Turn one request into exactly one action over their library, as JSON in the schema given. Set every field; fields the action does not use are null (play and next are false).

The actions:
- songs: they want music: a playlist made, or something to listen to. Fill "songs" with the filters below. Set play to true when they want it now ("play…", "put on…", "something for right now"), false when they want it kept ("make a playlist…"). Set next to true when they want it after the song playing ("next", "after this", "queue up…", "up next"), or when they ask to steer what is playing ("more like this", "something calmer"). When a song is playing and they say "this", "like this" or "after this", describe the music relative to it with the filters: its artists or tags for "like this", an energy range below its energy for "calmer", above it for "more upbeat".
- find: they are looking for one particular song they half remember (its story, its words, how it sounds). Fill "find": terms are words likely to be in its title, artist, album or lyrics, in every language the library uses (grandma: 外婆, 奶奶, おばあちゃん, grandma), at most twelve; brief is what they remember, in a sentence.
- tags: anything about their tags: songs given a tag or taken out of one, even when they leave it to you to say which songs ("tag every 周杰倫 song 中文流行", "tag the songs that should be 中文流行", "take ipop off what isn't Japanese"), a tag renamed, merged into another or deleted, or their tags checked or tidied up. Nothing else to fill: the request itself is what is used.
- stats: a question about their own listening (most played, how much, which artists). Fill "stats": range is 7d, 30d, 90d, 365d or all ("last month" is 30d, "this year" is 365d); about is songs, artists, tags or totals.
- tidy: they want their song names checked, fixed or cleaned up: wrong, messy or inconsistent titles, artists or albums, metadata worth fixing. Nothing else to fill.
- library: a question about what is in their library, not about their listening ("how many YOASOBI songs do I have", "what did I add this week", "my longest song", "which songs have no lyrics", "who is in 中文流行"). Fill "songs" with the filters that choose the songs (null for the whole library; size for how many to list, such as 1 for "my longest song") and "library": show is count (how many), songs (which ones), artists, albums or tags (who or what they are by or in); sortBy and order when they ask for the most, least, longest, newest and so on (asc is lowest, earliest or A first), else sortBy null.
- playlistSongs: they want songs put into or taken out of one playlist, or its songs put in order ("add the YOASOBI songs to gym", "take the slow ones out of chill", "sort genshin by energy"). Fill "playlistSongs": name copied from their playlist list as closely as you can; op add, remove or sort; for a sort, sortBy and order (asc is lowest, earliest or A first: calmest first is energy asc; year is when a song came out, addedAt when it joined the library), else sortBy null and order asc. For add and remove also fill "songs" with the filters that choose the songs (for remove, among the playlist's own songs), with brief for what the filters cannot say.
- playlists: they want playlists deleted or one renamed. Fill "playlists": op is delete or rename; names are the playlists they mean, copied from their playlist list as closely as you can (they may misspell or shorten them); newName is the new name for a rename, else null. Playlists only, never songs or tags.
- open: they want to go somewhere in the app rather than get an answer here: import (adding music, which takes a YouTube, Spotify or 网易云 link), stats, tags, library, playlists, settings. Fill "open", and "say" with one sentence on what they will find there. The app shows a button that goes there: never say you opened, changed or did anything.
- none: anything else, including talk that is not a request, or a request missing what it needs. "say" is one plain sentence on what you can do instead, and "try" is up to two requests, in their language, that this box can do and that come closest to what they wanted (for "tag the good ones": "tag the songs that should be 中文流行"). Empty when nothing comes close. Never pretend to do something.

For every action but none, try is null.

Filters, for songs, playlistSongs and library:
${FILTERS_GUIDE}`

const FIND_SYSTEM = `Someone is looking for one song in their own library that they half remember. You are given what they remember and a numbered table of candidate songs (with a lyric line where one matched). Reply with JSON only: picks, at most ${FIND_SIZE}, best first, each the song's number (n) and why it fits in at most ten plain words. Only choose songs that plausibly are the one they mean; if none are, return no picks. Never use a number that is not in the table.`

export interface AskDeps extends DescribeDeps {
  /** The playlists, for "delete…", "rename…" (`matchPlaylist`) and their songs. */
  readonly playlists?: () => readonly AskPlaylist[]
  readonly stats: (range: Stats['range']) => Stats
  readonly lyrics: (query: string) => { songId: number; line: string }[]
}

const lower = (value: string): string => value.toLowerCase()

/** Not something the box can do, with what it can do instead. */
const none = (say: string, tries: readonly string[] = []): AskAnswer => ({
  kind: 'none',
  say,
  try: tries
    .map(each => each.trim())
    .filter(Boolean)
    .slice(0, 2),
})

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

export async function ask(
  deps: AskDeps,
  text: string,
  playingId: number | null = null,
  /** Features turned off in Settings that the router may still choose. */
  allowed: { tidy: boolean; tags: boolean } = { tidy: true, tags: true },
  /** Told each stage as it begins, for the device's waiting steps (`progress.ts`). */
  steps: Steps = NO_STEPS,
): Promise<AskAnswer> {
  const remembered = deps.remembered ?? new Remembered()
  const songs = deps.songs()
  const tags = deps.tags()
  const now = deps.now?.() ?? Date.now()

  const playing = songs.find(song => song.id === playingId)
  // "This", for the router and for the pick: the song as the table draws a row.
  const nowPlaying = playing
    ? `\n\nNow playing: ${songTable([playing], tags, now).replace(/^#1 \| /, '')}`
    : ''
  const playlists = deps.playlists?.() ?? []
  const prompt = `${libraryShape(songs, tags)}\n\nTheir tags, exactly: ${tags.map(tag => tag.name).join(', ') || '(none)'}\n\nTheir playlists, exactly: ${playlists.map(playlist => playlist.name).join(' | ') || '(none)'}${nowPlaying}\n\nThe request:\n${text}`
  steps.begin('Reading what you asked')
  const route = await remembered.get(
    Remembered.key('ask-route', VERSION, prompt),
    async () =>
      (
        await deps.llm.generate({
          task: 'ask-route',
          tier: 'fast',
          system: ROUTE_SYSTEM,
          prompt,
          schema: RouteOut,
        })
      ).value,
  )

  steps.done('Read what you asked')

  switch (route.action) {
    case 'songs': {
      if (!route.songs) break
      const steering = route.next && playing !== undefined
      // Up next is a handful after this song, not a playlist's worth, unless a number was said.
      const plan = steering ? { ...route.songs, size: route.songs.size ?? NEXT_SIZE } : route.songs
      const { understanding, unknown } = groundPlan(plan, songs, tags)
      const found = await narrowAndPick(
        deps,
        `${text}${nowPlaying}`,
        understanding,
        unknown,
        [],
        steps,
      )
      // The song playing is what they are steering from, never one of the picks.
      const describe = { ...found, picks: found.picks.filter(pick => pick.songId !== playingId) }
      const lead = steering ? 'next' : route.play ? 'play' : 'save'
      return { kind: 'songs', lead, describe }
    }

    case 'find': {
      if (!route.find) break
      const quoted = route.find.terms
        .slice(0, 3)
        .map(term => `“${term}”`)
        .join(', ')
      steps.begin(`Looking for ${quoted} in titles and lyrics`)
      const found = foundFor(route.find.terms, songs, deps.lyrics)
      steps.done(found.length === 0 ? 'Nothing matched' : `${found.length} could be it`)
      if (found.length === 0) return { kind: 'find', terms: route.find.terms, picks: [] }
      steps.begin('Choosing the one you mean')
      const table = found.map(each => each.song)
      const lines = songTable(table, tags, now)
        .split('\n')
        .map((line, index) =>
          found[index]!.line ? `${line} | lyric: ${found[index]!.line}` : line,
        )
      const findPrompt = `What they remember: ${route.find.brief}\nTheir words: ${text}\n\nThe table (number | title | artist | album | year | tags | energy | tempo | length | words | plays | lyric):\n${lines.join('\n')}`
      const answer = await remembered.get(
        Remembered.key('ask-find', VERSION, findPrompt),
        async () =>
          (
            await deps.llm.generate({
              task: 'ask-find',
              tier: 'smart',
              system: FIND_SYSTEM,
              prompt: findPrompt,
              schema: PickOut,
            })
          ).value,
      )
      steps.done()
      return {
        kind: 'find',
        terms: route.find.terms,
        picks: groundPicks(answer.picks, table, FIND_SIZE),
      }
    }

    case 'tags':
      if (!allowed.tags) {
        return none('Tags is turned off in Settings › Smart features.')
      }
      return { kind: 'tags', review: await tagReview({ ...deps, remembered }, { text }, steps) }

    case 'stats': {
      if (!route.stats) break
      steps.begin('Reading your listening')
      const stats = deps.stats(route.stats.range)
      steps.done()
      const items =
        route.stats.about === 'songs'
          ? stats.topSongs.map(each => ({
              label: `${each.title} · ${each.artist}`,
              plays: each.plays,
              songId: each.songId,
            }))
          : route.stats.about === 'artists'
            ? stats.topArtists.map(each => ({ label: each.key, plays: each.plays, songId: null }))
            : route.stats.about === 'tags'
              ? stats.topTags.map(each => ({ label: each.key, plays: each.plays, songId: null }))
              : []
      return {
        kind: 'stats',
        range: route.stats.range,
        about: route.stats.about,
        plays: stats.totals.plays,
        minutes: stats.totals.minutes,
        items: items.slice(0, 5),
      }
    }

    case 'tidy':
      if (!allowed.tidy) {
        return none('Tidy up is turned off in Settings › Smart features.')
      }
      return { kind: 'tidy', tidy: await tidy({ ...deps, remembered }, steps) }

    case 'playlists': {
      if (!route.playlists) break
      const { op, names: asked, newName } = route.playlists
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
    }

    case 'library':
      if (!route.library) break
      return libraryAnswer(deps, route.songs, route.library)

    case 'playlistSongs': {
      if (!route.playlistSongs) break
      const name = matchPlaylist(route.playlistSongs.name, playlists)
      const playlist = playlists.find(each => each.name === name)
      if (!playlist) return none(`No playlist here is called “${route.playlistSongs.name}”.`)
      return playlistSongs(
        { ...deps, remembered },
        playlist,
        text,
        route.songs,
        route.playlistSongs,
        steps,
      )
    }

    case 'open':
      if (!route.open) break
      return { kind: 'open', place: route.open, say: route.say ?? '' }

    case 'none':
      break
  }
  return none(
    route.say ??
      'Ask for music (a playlist, something to play now), a song you half remember, changes to your tags or playlists, or a question about your library or your listening.',
    route.try ?? [],
  )
}
