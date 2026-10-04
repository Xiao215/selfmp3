import { z } from 'zod/v4'
import {
  AskPlaceSchema,
  AskStatsRangeSchema,
  TAG_NAME_MAX,
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
  songsFitting,
  type DescribeDeps,
} from './describe.js'
import { libraryShape, songTable } from './library.js'
import { Remembered } from './llm.js'
import { tidy } from './tidy.js'

/**
 * S1 · the Search box's Ask (docs/features/ai.md).
 *
 * A router: one call reads the request against the library's shape and
 * chooses one of a fixed list of actions, filling in what that action needs.
 * Then the action runs as code, and only "songs" and "find" make a second
 * call, to pick. Every answer is a proposal: nothing here writes.
 *
 * The router's answer for "songs" is Describe's plan itself, so a playlist
 * asked for in the box costs what Describe costs and no more.
 */

const VERSION = 2

/** The most songs a "find" is chosen from. */
const MAX_FOUND = 150
const FIND_SIZE = 5

const RouteOut = z.object({
  action: z.enum(['songs', 'find', 'tag', 'stats', 'tidy', 'open', 'none']),
  /** songs: they want it now, not kept. */
  play: z.boolean(),
  /** songs, and tag (as the songs to tag): the filters, as Describe's plan. */
  songs: PlanOut.nullable(),
  tag: z.object({ name: z.string().max(60) }).nullable(),
  find: z
    .object({ terms: z.array(z.string().max(60)).max(12), brief: z.string().max(200) })
    .nullable(),
  stats: z
    .object({
      range: z.enum(AskStatsRangeSchema.options),
      about: z.enum(['songs', 'artists', 'tags', 'totals']),
    })
    .nullable(),
  open: z.enum(AskPlaceSchema.options).nullable(),
  /** open and none: one plain sentence for the person. */
  say: z.string().max(240).nullable(),
})

const ROUTE_SYSTEM = `You are the request box of someone's own music app. Turn one request into exactly one action over their library, as JSON in the schema given. Set every field; fields the action does not use are null (play is false).

The actions:
- songs: they want music: a playlist made, or something to listen to. Fill "songs" with the filters below. Set play to true when they want it now ("play…", "put on…", "something for right now"), false when they want it kept ("make a playlist…").
- find: they are looking for one particular song they half remember (its story, its words, how it sounds). Fill "find": terms are words likely to be in its title, artist, album or lyrics, in every language the library uses (grandma: 外婆, 奶奶, おばあちゃん, grandma), at most twelve; brief is what they remember, in a sentence.
- tag: they want one tag put on many songs. Fill "tag" with the tag's name, spelled exactly as in their tag list if it exists, and "songs" with the filters that pick those songs (usually artists or tags). Never tag the whole library: if they did not say which songs, choose none.
- stats: a question about their own listening (most played, how much, which artists). Fill "stats": range is 7d, 30d, 90d, 365d or all ("last month" is 30d, "this year" is 365d); about is songs, artists, tags or totals.
- tidy: they want their song names checked, fixed or cleaned up: wrong, messy or inconsistent titles, artists or albums, metadata worth fixing. Nothing else to fill.
- open: they want to go somewhere in the app rather than get an answer here: import (adding music, which takes a YouTube, Spotify or 网易云 link), stats, tags, library, playlists, settings. Fill "open" and "say" with one sentence.
- none: anything else, including talk that is not a request. "say" is one plain sentence on what you can do instead. Never pretend to do something.

Filters, for songs and tag:
${FILTERS_GUIDE}`

const FIND_SYSTEM = `Someone is looking for one song in their own library that they half remember. You are given what they remember and a numbered table of candidate songs (with a lyric line where one matched). Reply with JSON only: picks, at most ${FIND_SIZE}, best first, each the song's number (n) and why it fits in at most ten plain words. Only choose songs that plausibly are the one they mean; if none are, return no picks. Never use a number that is not in the table.`

export interface AskDeps extends DescribeDeps {
  readonly stats: (range: Stats['range']) => Stats
  readonly lyrics: (query: string) => { songId: number; line: string }[]
}

const lower = (value: string): string => value.toLowerCase()

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

export async function ask(deps: AskDeps, text: string): Promise<AskAnswer> {
  const remembered = deps.remembered ?? new Remembered()
  const songs = deps.songs()
  const tags = deps.tags()
  const now = deps.now?.() ?? Date.now()

  const prompt = `${libraryShape(songs, tags)}\n\nTheir tags, exactly: ${tags.map(tag => tag.name).join(', ') || '(none)'}\n\nThe request:\n${text}`
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

  switch (route.action) {
    case 'songs': {
      if (!route.songs) break
      const { understanding, unknown } = groundPlan(route.songs, songs, tags)
      const describe = await narrowAndPick(deps, text, understanding, unknown)
      return { kind: 'songs', lead: route.play ? 'play' : 'save', describe }
    }

    case 'find': {
      if (!route.find) break
      const found = foundFor(route.find.terms, songs, deps.lyrics)
      if (found.length === 0) return { kind: 'find', terms: route.find.terms, picks: [] }
      const table = found.map(each => each.song)
      const lines = songTable(table, tags, now)
        .split('\n')
        .map((line, index) =>
          found[index]!.line ? `${line} | lyric: ${found[index]!.line}` : line,
        )
      const findPrompt = `What they remember: ${route.find.brief}\nTheir words: ${text}\n\nThe table (number | title | artist | album | tags | energy | tempo | length | words | plays | lyric):\n${lines.join('\n')}`
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
      return {
        kind: 'find',
        terms: route.find.terms,
        picks: groundPicks(answer.picks, table, FIND_SIZE),
      }
    }

    case 'tag': {
      if (!route.tag || !route.songs) break
      const { understanding } = groundPlan(route.songs, songs, tags)
      const chooses =
        understanding.anyTags.length > 0 ||
        understanding.artists.length > 0 ||
        songsFitting(songs, tags, understanding, now).length < songs.length
      const name = route.tag.name.trim().replace(/\s+/g, ' ')
      if (!chooses || !name || name.length > TAG_NAME_MAX) {
        return { kind: 'none', say: 'Say which songs to tag: an artist, a tag, or a kind of song.' }
      }
      const existing = tags.find(tag => lower(tag.name) === lower(name)) ?? null
      const fitting = songsFitting(songs, tags, understanding, now)
      const without = fitting.filter(song => !existing || !song.tagIds.includes(existing.id))
      return {
        kind: 'tag',
        tag: existing?.name ?? name,
        isNew: existing === null,
        understanding,
        songIds: without.map(song => song.id),
        already: fitting.length - without.length,
      }
    }

    case 'stats': {
      if (!route.stats) break
      const stats = deps.stats(route.stats.range)
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
      return { kind: 'tidy', tidy: await tidy({ ...deps, remembered }) }

    case 'open':
      if (!route.open) break
      return { kind: 'open', place: route.open, say: route.say ?? '' }

    case 'none':
      break
  }
  return {
    kind: 'none',
    say:
      route.say ??
      'Ask for music (a playlist, something to play now), a song you half remember, a tag for many songs, or a question about your listening.',
  }
}
