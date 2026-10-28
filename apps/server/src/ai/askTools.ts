import { z } from 'zod/v4'
import {
  AskOrderSchema,
  AskSortSchema,
  AskStatsRangeSchema,
  joinedNames,
  NO_JOINS,
  type TidyResult,
} from '@selfmp3/shared'
import type { AskDeps } from './askActions.js'
import { EVERYTHING, sortSongs } from './askLibrary.js'
import { findCopies } from './copies.js'
import { groundPlan, narrowAndPick } from './describe.js'
import { fillGaps } from './fill.js'
import { haveTrack } from './getMusic.js'
import { halfRemembered } from './halfRemembered.js'
import { creditedArtists } from './library.js'
import { tool, type LlmTool, type Remembered } from './llm.js'
import { NO_STEPS, type Steps } from './progress.js'
import { tagReview } from './tagReview.js'
import { bare, pool, tally } from './text.js'
import { oneSpelling, tidy } from './tidy.js'
import {
  applyFilters,
  candidatesOf,
  FilterFields,
  nearNames,
  ScopeArg,
  SetName,
  type WorkingSet,
  type Library,
} from './workingSet.js'

/**
 * Ask's pipelines as tools a model calls (AGENT-DESIGN 2.3), over the songs
 * of one request (`workingSet.ts`). Each wraps code that already answers one
 * kind of request — Describe's filters and pick, the library's counts and
 * order, the listening, the find, the tag review, Tidy up, Fill, Copies,
 * 网易云 — with typed arguments, and returns data for the model to read, a
 * few dozen rows at most, never an answer for the person: what is shown to
 * them is the caller's to build, from the sets and proposals these leave
 * behind.
 *
 * Songs go in as a scope and come out as a set the model names (`as`), so a
 * reply can chain them: find, then pick from what was found, in one round.
 * Nothing here writes. A tool that cannot do what it was asked throws, and
 * the error is what the model reads back (`llm.ts`).
 *
 * Each description is the whole of what the model is told about the tool:
 * general instructions, no sample requests (Xiao's rule for every prompt).
 */

/** The tools there are, by name. */
export const ASK_TOOL_NAMES = [
  'find_songs',
  'count_by',
  'listening',
  'lookup_names',
  'pick_by_taste',
  'find_half_remembered',
  'propose_tags',
  'propose_names',
  'album_tracks',
  'catalogue',
] as const
export type AskToolName = (typeof ASK_TOOL_NAMES)[number]

/** The most groups `count_by` lists. */
const GROUPS_SHOWN = 100
/** The most proposal lines a proposing tool shows. */
const PROPOSED_SHOWN = 20
/** How many albums `album_tracks` reads at once, and how many of 网易云's it considers per album. */
const ALBUMS_AT_ONCE = 3
const ALBUM_CANDIDATES = 6
/** The most track titles an album's answer lists. */
const TRACKS_SHOWN = 60
/** The most top songs, artists or tags `listening` reads when a scope narrows them. */
const LISTENING_POOL = 500

type ToolDeps = AskDeps & { readonly remembered: Remembered }

/** The library as the tools read it, now. */
export function libraryOf(deps: AskDeps): Library {
  return {
    songs: deps.songs(),
    tags: deps.tags(),
    names: deps.artistNames?.() ?? NO_JOINS,
    now: deps.now?.() ?? Date.now(),
    lyrics: deps.lyrics,
  }
}

/** What a tidy proposal changes, a line each. */
function tidyLines(result: TidyResult): string[] {
  return result.changes
    .slice(0, PROPOSED_SHOWN)
    .map(
      change =>
        `${change.field}: “${change.from}” → “${change.to}” (${change.songIds.length} ${change.songIds.length === 1 ? 'song' : 'songs'})`,
    )
}

/**
 * The tools over one request's working set. `question` is what was asked, for
 * the tools whose model reads it; `only` keeps the tools a caller offers.
 */
export function askTools(
  deps: ToolDeps,
  set: WorkingSet,
  options: {
    readonly question: string
    readonly only?: readonly AskToolName[]
    readonly steps?: Steps
  },
): LlmTool[] {
  const steps = options.steps ?? NO_STEPS
  const library = set.library

  const findSongs = tool({
    name: 'find_songs',
    description:
      'Find songs of theirs and keep them as a set named `as`, which later calls can name in a scope, in this reply or the next. Every condition given must hold; leave the rest out. Artist, album and tag names are matched as the library spells them, across scripts and an artist’s other names; a name the library does not have matches no song and comes back under unmatched with the names nearest it, so look again with one of those rather than concluding it is missing. text matches words in a title, artist, album or lyrics; title only titles; lyrics only lyrics. words is with or without lyrics. scope starts from a set or ids instead of the whole library. sort and order put the set in an order and limit keeps that many from the front. The answer is the set’s size, its minutes and its first rows; offset shows later rows. When it comes to no songs, emptiedBy says which condition left none.',
    parameters: z.object({
      as: SetName,
      scope: ScopeArg.nullish(),
      ...FilterFields,
      sort: z.enum(AskSortSchema.options).nullish(),
      order: z.enum(AskOrderSchema.options).nullish(),
      limit: z.number().int().min(1).max(5000).nullish(),
      offset: z.number().int().min(0).nullish(),
    }),
    run: ({ as, scope, sort, order, limit, offset, ...filters }) => {
      steps.begin(
        filters.text
          ? `Looking through your songs for “${filters.text}”`
          : 'Looking through your songs',
      )
      const from = set.resolve(scope)
      const found = from.emptiedBy ? from : applyFilters(from.songs, filters, library)
      let songs = sort ? sortSongs(found.songs, sort, order ?? 'desc') : found.songs
      if (limit) songs = songs.slice(0, limit)
      set.put(as, songs, 'songs found')
      steps.done()
      return set.view(as, {
        offset,
        emptiedBy: found.emptiedBy,
        unmatched: [...from.unmatched, ...(found === from ? [] : found.unmatched)],
      })
    },
  })

  const countBy = tool({
    name: 'count_by',
    description:
      'Count songs by artist, album, tag or year, most first: over the whole library, or over a scope. A song by several artists counts once for each, and an artist’s spellings joined by their other names count as one. An album is told apart by who it is by. The answer is how many songs were counted, how many different values there are, and the groups.',
    parameters: z.object({
      scope: ScopeArg.nullish(),
      by: z.enum(['artist', 'album', 'tag', 'year']),
      limit: z.number().int().min(1).max(GROUPS_SHOWN).nullish(),
    }),
    run: ({ scope, by, limit }) => {
      steps.begin(`Counting your songs by ${by}`)
      const from = set.resolve(scope)
      const shownAs = joinedNames(library.songs, library.names)
      const tagName = new Map(library.tags.map(tag => [tag.id, tag.name]))
      const values = from.songs.flatMap(song =>
        by === 'artist'
          ? creditedArtists(song, shownAs)
          : by === 'album'
            ? [song.album ? `${song.album} — ${song.albumArtist || song.artist}` : '(no album)']
            : by === 'tag'
              ? song.tagIds.flatMap(id => tagName.get(id) ?? [])
              : [song.year ? String(song.year) : '(no year)'],
      )
      const counted = tally(values)
      steps.done()
      return {
        songs: from.songs.length,
        distinct: counted.length,
        groups: counted.slice(0, limit ?? GROUPS_SHOWN).map(([name, songs]) => ({ name, songs })),
        ...(from.emptiedBy ? { emptiedBy: from.emptiedBy } : {}),
      }
    },
  })

  const listening = tool({
    name: 'listening',
    description:
      'Their listening over a range of days, from their plays: the most played songs, artists or tags, as many as limit, or the totals (plays, minutes, songs played, songs never played, the streak of days). A scope keeps only the plays of its songs. Songs come with ids that may be named afterwards.',
    parameters: z.object({
      range: z.enum(AskStatsRangeSchema.options),
      about: z.enum(['songs', 'artists', 'tags', 'totals']),
      limit: z.number().int().min(1).max(100).nullish(),
      scope: ScopeArg.nullish(),
    }),
    run: ({ range, about, limit, scope }) => {
      steps.begin('Reading your listening')
      const most = limit ?? 10
      const stats = deps.stats(range, scope ? LISTENING_POOL : most)
      steps.done()
      if (about === 'totals') {
        return {
          range,
          ...stats.totals,
          minutes: Math.round(stats.totals.minutes),
          streakDays: stats.streakDays,
          longestStreakDays: stats.longestStreakDays,
        }
      }
      const inScope = scope ? new Set(set.resolve(scope).songs.map(song => song.id)) : null
      const topSongs = stats.topSongs.filter(each => !inScope || inScope.has(each.songId))
      if (about === 'songs') {
        const listed = topSongs.slice(0, most)
        set.shown(listed.map(each => each.songId))
        return {
          range,
          songs: listed.map(each => `${each.songId}|${each.title}|${each.artist}|${each.plays}`),
          columns: 'id|title|artist|plays',
        }
      }
      if (!inScope) {
        const entries = about === 'artists' ? stats.topArtists : stats.topTags
        return {
          range,
          [about]: entries.slice(0, most).map(each => ({ name: each.key, plays: each.plays })),
        }
      }
      // Within a scope: its songs' plays, added up by whom or what they are.
      const byId = new Map(library.songs.map(song => [song.id, song]))
      const shownAs = joinedNames(library.songs, library.names)
      const tagName = new Map(library.tags.map(tag => [tag.id, tag.name]))
      const plays = new Map<string, number>()
      for (const each of topSongs) {
        const song = byId.get(each.songId)
        if (!song) continue
        const keys =
          about === 'artists'
            ? creditedArtists(song, shownAs)
            : song.tagIds.flatMap(id => tagName.get(id) ?? [])
        for (const key of keys) plays.set(key, (plays.get(key) ?? 0) + each.plays)
      }
      return {
        range,
        [about]: [...plays]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .slice(0, most)
          .map(([name, count]) => ({ name, plays: count })),
      }
    },
  })

  const lookupNames = tool({
    name: 'lookup_names',
    description:
      'The names of their artists, albums, tags or playlists nearest some words, best first, each with how many songs: matched with case, accents, punctuation and script set aside (Chinese also as pinyin), an artist by its other names too, then by a name holding the words, then by a few slips. Use it to learn how the library spells something before naming it to another tool.',
    parameters: z.object({
      kind: z.enum(['artist', 'album', 'tag', 'playlist']),
      query: z.string().min(1).max(120),
    }),
    run: ({ kind, query }) => {
      const candidates =
        kind === 'playlist'
          ? (deps.playlists?.() ?? []).map(playlist => ({
              name: playlist.name,
              songs: playlist.songIds().length,
            }))
          : candidatesOf(library, kind)
      return {
        matches: nearNames(query, candidates, 10).map(each => ({
          name: each.name,
          songs: each.songs,
          ...(each.also && each.also.length > 0 ? { also: each.also.slice(0, 4) } : {}),
        })),
      }
    },
  })

  const pickByTaste = tool({
    name: 'pick_by_taste',
    description:
      'Choose songs from a scope by judgement and keep them as a set named `as`: brief says what every song must be or what they are for, sound says in English how they should sound for the listening model (positive words only), count or minutes how many or how long, like a song they should sound close to, avoid songs to leave out. A model reads the songs against the brief. When none fit, the set is empty and notes say why: tell them rather than loosening. Notes also say what else made it fewer (songs set to rest, a default number).',
    parameters: z.object({
      as: SetName,
      from: ScopeArg,
      brief: z.string().min(1).max(200),
      sound: z.string().max(120).nullish(),
      count: z.number().int().min(1).max(200).nullish(),
      minutes: z.number().int().min(1).max(1440).nullish(),
      like: ScopeArg.nullish(),
      avoid: ScopeArg.nullish(),
    }),
    run: async ({ as, from, brief, sound, count, minutes, like, avoid }) => {
      const scoped = set.resolve(from)
      const pool = scoped.songs
      if (pool.length === 0) {
        set.put(as, [], brief)
        return set.view(as, {
          emptiedBy: scoped.emptiedBy ?? 'nothing to choose from',
          unmatched: scoped.unmatched,
        })
      }
      const likeSong = like ? set.resolve(like).songs[0] : undefined
      if (like && !likeSong) throw new Error('like names no song.')
      const left = avoid ? set.resolve(avoid).songs.map(song => song.id) : []
      const { understanding } = groundPlan(
        {
          ...EVERYTHING,
          name: 'Chosen',
          brief,
          sound: sound?.trim() || null,
          size: count ?? null,
          minutes: count ? null : (minutes ?? null),
        },
        library.songs,
        library.tags,
        library.names,
      )
      const found = await narrowAndPick(
        { ...deps, songs: () => pool },
        brief,
        understanding,
        [],
        left,
        steps,
        likeSong?.id ?? null,
      )
      const byId = new Map(pool.map(song => [song.id, song]))
      const picked = found.picks.flatMap(pick => byId.get(pick.songId) ?? [])
      const why = new Map(
        found.picks.flatMap(pick => (pick.why ? [[pick.songId, pick.why] as const] : [])),
      )
      set.put(as, picked, brief, why)
      return set.view(as, {
        notes: [...found.loosened.map(part => `Let go of ${part} to find any.`), ...found.notes],
        ...(picked.length === 0 ? { emptiedBy: 'the pick chose none of them' } : {}),
      })
    },
  })

  const findHalfRemembered = tool({
    name: 'find_half_remembered',
    description:
      'Look for one song they half remember and keep the few that could be it as a set named `as`, best first, each with why. terms are words likely in its title, artist, album or lyrics, in every language and script the library uses; brief is what they remember, in a sentence. Empty when none of their songs could be it.',
    parameters: z.object({
      as: SetName,
      terms: z.array(z.string().min(1).max(60)).min(1).max(12),
      brief: z.string().min(1).max(200),
    }),
    run: async ({ as, terms, brief }) => {
      const { found, picks } = await halfRemembered(
        deps,
        { text: options.question, terms, brief, now: library.now },
        steps,
      )
      const byId = new Map(library.songs.map(song => [song.id, song]))
      const why = new Map(
        picks.flatMap(pick => (pick.why ? [[pick.songId, pick.why] as const] : [])),
      )
      set.put(
        as,
        picks.flatMap(pick => byId.get(pick.songId) ?? []),
        brief,
        why,
      )
      return set.view(as, {
        ...(picks.length === 0
          ? {
              emptiedBy:
                found === 0
                  ? 'no song holds any of the terms'
                  : `none of the ${found} songs holding the terms seemed to be it`,
            }
          : {}),
      })
    },
  })

  const proposeTags = tool({
    name: 'propose_tags',
    description:
      'Propose changes to their tags, kept under `as` for the answer to show; nothing is changed until they accept. request says what to do in their words: songs given a tag or taken out of one, a tag renamed, merged or deleted, the tags checked. scope limits it to those songs, and no others; without one the request says which. limit is the most songs to change. The answer lists the proposed changes.',
    parameters: z.object({
      as: SetName,
      request: z.string().min(1).max(400),
      scope: ScopeArg.nullish(),
      limit: z.number().int().min(1).max(5000).nullish(),
    }),
    run: async ({ as, request, scope, limit }) => {
      const songs = scope ? set.resolve(scope).songs : null
      if (songs && songs.length === 0) throw new Error('The scope holds no songs.')
      const review = await tagReview(
        deps,
        { text: request, limit: limit ?? null, scope: songs },
        steps,
      )
      set.propose(as, { kind: 'tags', value: review })
      return {
        proposal: as,
        looked: review.looked,
        changes: review.changes.length,
        list: review.changes
          .slice(0, PROPOSED_SHOWN)
          .map(
            change =>
              `${change.op} ${change.tag}${change.to ? ` → ${change.to}` : ''}${change.songIds.length > 0 ? `: ${change.songIds.length} songs (${change.who})` : ''}`,
          ),
        unsure: review.unsure.length,
        note: review.note,
      }
    },
  })

  const proposeNames = tool({
    name: 'propose_names',
    description:
      'Propose changes to their songs’ names, kept under `as` for the answer to show; nothing is changed until they accept. what is checkup to check and clean the names, change for a change they describe in request, spellings to make each artist written more than one way one name, fill to fill in a missing album or year from the catalogues, copies to find songs they have more than once. lookUp is true when the new names must come from outside the library (official names, another language’s published name). scope limits it to those songs; limit is the most songs to change. The answer lists the proposed changes.',
    parameters: z.object({
      as: SetName,
      what: z.enum(['checkup', 'change', 'spellings', 'fill', 'copies']),
      request: z.string().min(1).max(400),
      lookUp: z.boolean().nullish(),
      scope: ScopeArg.nullish(),
      limit: z.number().int().min(1).max(5000).nullish(),
    }),
    run: async ({ as, what, request, lookUp, scope, limit }) => {
      const songs = scope ? set.resolve(scope).songs : null
      if (songs && songs.length === 0) throw new Error('The scope holds no songs.')
      const chosen = songs ?? library.songs
      if (what === 'copies') {
        const copies = await findCopies(deps, chosen, steps)
        set.propose(as, { kind: 'copies', value: copies })
        set.shown(copies.copies.flatMap(copy => copy.songIds))
        return {
          proposal: as,
          looked: copies.looked,
          copies: copies.copies.length,
          list: copies.copies
            .slice(0, PROPOSED_SHOWN)
            .map(copy => `keep ${copy.keep}, extra ${copy.songIds.join(',')}: ${copy.why}`),
          note: copies.note,
        }
      }
      const asked = {
        text: request,
        songs: chosen,
        unknown: [],
        lookUp: lookUp ?? false,
        limit: limit ?? null,
      }
      const result =
        what === 'checkup'
          ? await tidy(deps, steps, null, songs)
          : what === 'fill'
            ? await fillGaps(deps, limit ? chosen.slice(0, limit) : chosen, request, steps)
            : what === 'spellings'
              ? await oneSpelling(deps, asked, steps)
              : await tidy(deps, steps, asked)
      set.propose(as, { kind: 'tidy', value: result })
      return {
        proposal: as,
        looked: result.looked,
        changes: result.changes.length,
        list: tidyLines(result),
        reply: result.reply,
        note: result.note,
      }
    },
  })

  const music = deps.music
  const albumTracks = tool({
    name: 'album_tracks',
    description:
      'Albums’ track lists from 网易云, the music catalogue, with which tracks they have: for each album asked for (its name as published, and its artist when known), the album 网易云 lists under that name, how many tracks it has, which of them are theirs (with ids) and the titles of the ones they lack, plus the other albums 网易云 listed for the same words in case the first is the wrong one. Use it to say how much of an album they have.',
    parameters: z.object({
      albums: z
        .array(
          z.object({
            album: z.string().min(1).max(200),
            artist: z.string().max(120).nullish(),
          }),
        )
        .min(1)
        .max(8),
    }),
    run: async ({ albums }) => {
      if (!music) throw new Error('网易云 cannot be reached from here.')
      steps.begin(
        `Reading ${albums.length === 1 ? 'the album' : `${albums.length} albums`} on 网易云`,
      )
      const out: unknown[] = Array.from({ length: albums.length })
      await pool(
        albums.map((wanted, index) => ({ wanted, index })),
        ALBUMS_AT_ONCE,
        async ({ wanted, index }) => {
          const words = [wanted.album, wanted.artist ?? ''].join(' ').trim()
          const listed = (await music.albums(words)).slice(0, ALBUM_CANDIDATES)
          // The album of that very name first, by that artist when one was said.
          const score = (album: { title: string; artist: string }): number =>
            (bare(album.title) === bare(wanted.album) ? 2 : 0) +
            (wanted.artist && bare(album.artist).includes(bare(wanted.artist)) ? 1 : 0)
          const best = [...listed].sort((a, b) => score(b) - score(a))[0]
          if (!best) {
            out[index] = { asked: wanted.album, found: null }
            return
          }
          const tracks = await music.albumTracks(best.id)
          const theirs = tracks.map(track => haveTrack(library.songs, track))
          set.shown(theirs.flatMap(song => (song ? [song.id] : [])))
          out[index] = {
            asked: wanted.album,
            album: best.title,
            artist: best.artist,
            tracks: tracks.length || best.tracks,
            have: theirs.filter(Boolean).length,
            theirs: tracks
              .flatMap((track, at) => {
                const song = theirs[at]
                return song ? [`${song.id}|${song.title}`] : []
              })
              .slice(0, TRACKS_SHOWN),
            lacking: tracks
              .filter((_, at) => !theirs[at])
              .map(track => track.title)
              .slice(0, TRACKS_SHOWN),
            others: listed
              .filter(album => album !== best)
              .slice(0, 3)
              .map(album => `${album.title} — ${album.artist} (${album.tracks} tracks)`),
          }
        },
      )
      steps.done()
      return out
    },
  })

  const search = deps.catalogue
  const catalogue = tool({
    name: 'catalogue',
    description:
      'Songs 网易云, the music catalogue, lists for some words (a title, an artist, an album, in any language): the publisher’s own names, often in two languages, with album and length in seconds. Use it for what a song or album is called, who it is by, or what exists that they may not have.',
    parameters: z.object({ words: z.string().min(1).max(120) }),
    run: async ({ words }) => {
      if (!search) throw new Error('网易云 cannot be reached from here.')
      steps.begin(`Looking up “${words}” on 网易云`)
      const found = (await search(words)).slice(0, 8).map(each => ({
        title: each.title,
        artist: each.artist,
        album: each.album,
        seconds: each.duration,
      }))
      steps.done()
      return found
    },
  })

  const all: Record<AskToolName, LlmTool> = {
    find_songs: findSongs,
    count_by: countBy,
    listening,
    lookup_names: lookupNames,
    pick_by_taste: pickByTaste,
    find_half_remembered: findHalfRemembered,
    propose_tags: proposeTags,
    propose_names: proposeNames,
    album_tracks: albumTracks,
    catalogue,
  }
  // A catalogue the server cannot reach is not offered at all.
  const reachable = (name: AskToolName): boolean =>
    (name !== 'album_tracks' || music !== undefined) &&
    (name !== 'catalogue' || search !== undefined)
  return (options.only ?? ASK_TOOL_NAMES).filter(reachable).map(name => all[name])
}
