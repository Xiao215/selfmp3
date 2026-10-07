import type { z } from 'zod/v4'
import type { AskAnswer, AskOrder, AskSort, Song, Understanding } from '@selfmp3/shared'
import {
  groundPlan,
  narrowAndPick,
  songsFitting,
  type DescribeDeps,
  type PlanOut,
} from './describe.js'
import { mainArtist } from './library.js'
import { LlmError } from './llm.js'
import { NO_STEPS, type Steps } from './progress.js'
import { tally } from './text.js'

/**
 * Two of Ask's answers that read the library rather than the listening
 * (docs/features/ai.md, "Playlists from the box" and "Questions about your
 * library"): songs into or out of a playlist, or its order; and how many,
 * which and whose songs fit a description. The filters are the router's,
 * which are Describe's; the songs are counted and sorted here, in code.
 */

/** A playlist as Ask sees it: its kind, and its songs when asked for. */
export interface AskPlaylist {
  readonly name: string
  readonly kind: 'manual' | 'live'
  readonly songIds: () => readonly number[]
}

/** How many songs a library question lists at most. */
const LIST_SIZE = 50
/** How many artists, albums or tags a library question names. */
const TOP = 8

/** The filters as a plan, for a question that set none: the whole library. */
export const EVERYTHING: z.infer<typeof PlanOut> = {
  name: 'Your library',
  anyTags: [],
  artists: [],
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

/** The most common few, as a library answer lists them. */
function top(values: Iterable<string>): { label: string; count: number }[] {
  return tally(values)
    .slice(0, TOP)
    .map(([label, count]) => ({ label, count }))
}

/** Whether the filters choose anything, rather than letting every song in. */
function chooses(understanding: Understanding): boolean {
  const { anyTags, artists, noTags, energy, bpm, year } = understanding
  return (
    anyTags.length > 0 ||
    artists.length > 0 ||
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

/** Not something the box can do, with what it can do instead. */
export const none = (say: string, tries: readonly string[] = []): AskAnswer => ({
  kind: 'none',
  say,
  try: tries
    .map(each => each.trim())
    .filter(Boolean)
    .slice(0, 2),
})

/** "How many YOASOBI songs do I have", "what did I add this week", "my longest song". */
export function libraryAnswer(
  deps: Pick<DescribeDeps, 'songs' | 'tags' | 'now'>,
  plan: z.infer<typeof PlanOut> | null,
  question: {
    show: 'count' | 'songs' | 'artists' | 'albums' | 'tags'
    sortBy: AskSort | null
    order: AskOrder
  },
): AskAnswer {
  const songs = deps.songs()
  const tags = deps.tags()
  const now = deps.now?.() ?? Date.now()
  const { understanding, unknown } = groundPlan(plan ?? EVERYTHING, songs, tags)
  const fitting = songsFitting(songs, tags, understanding, now)
  const sorted = sortSongs(
    fitting,
    question.sortBy ?? 'addedAt',
    question.sortBy ? question.order : 'desc',
  )
  const names = new Map(tags.map(tag => [tag.id, tag.name]))
  return {
    kind: 'library',
    understanding,
    unknown,
    show: question.show,
    count: fitting.length,
    seconds: fitting.reduce((sum, song) => sum + song.duration, 0),
    songIds: sorted.slice(0, understanding.size ?? LIST_SIZE).map(song => song.id),
    sortBy: question.sortBy,
    order: question.order,
    artists: top(fitting.map(song => mainArtist(song.artist))),
    albums: top(fitting.map(song => song.album).filter(Boolean)),
    tags: top(fitting.flatMap(song => song.tagIds.map(id => names.get(id) ?? '')).filter(Boolean)),
  }
}

/** "add the YOASOBI songs to gym", "take the slow ones out of chill", "sort genshin by energy". */
export async function playlistSongs(
  deps: DescribeDeps,
  playlist: AskPlaylist,
  text: string,
  plan: z.infer<typeof PlanOut> | null,
  edit: { op: 'add' | 'remove' | 'sort'; sortBy: AskSort | null; order: AskOrder },
  steps: Steps = NO_STEPS,
): Promise<AskAnswer> {
  if (playlist.kind === 'live') {
    return none(
      `${playlist.name} fills itself from the tags it follows, so its songs change with their tags.`,
    )
  }
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
      return none(
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
  const { understanding, unknown } = groundPlan(plan ?? EVERYTHING, songs, tags)
  if (!chooses(understanding) && understanding.brief === null) {
    return none(
      adding
        ? `Say which songs to add to ${playlist.name}: an artist, a tag, or a kind of song.`
        : `Say which songs to take out of ${playlist.name}: an artist, a tag, or a kind of song.`,
    )
  }
  const inPlaylist = new Set(members.map(song => song.id))
  const pool = adding ? songs.filter(song => !inPlaylist.has(song.id)) : members
  const fitting = songsFitting(pool, tags, understanding, now)
  const answer = (
    chosen: { songId: number; why: string | null }[],
    by: 'rule' | 'model',
  ): AskAnswer => ({
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
  )
  try {
    return answer((await judging).picks, 'model')
  } catch (caught) {
    // Choosing none is an answer here: nothing in the playlist is what they meant.
    if (caught instanceof LlmError && caught.kind === 'invalid') return answer([], 'model')
    throw caught
  }
}
