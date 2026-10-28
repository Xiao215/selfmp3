import { z } from 'zod/v4'
import {
  artistKey,
  joinedKeys,
  NO_JOINS,
  splitArtists,
  type ArtistJoinNames,
  type AskCard,
  type Song,
  type Tag,
} from '@selfmp3/shared'
import { libraryShape } from './library.js'
import { Remembered, tool, type Llm } from './llm.js'
import type { CatalogueSearch } from './names.js'
import { NO_STEPS, type Steps } from './progress.js'

/**
 * Ask's open questions (docs/features/ai.md, "Looking things up"): what the
 * fixed actions cannot say with filters — "which albums do I have only part
 * of", "what is Wordless Cliffs called in Chinese", "do I have anything from
 * Inazuma" — and questions about music itself, a song or artist they may not
 * have, answered from what the model knows too. The model is given the library's shape and tools to look: its
 * songs (`search_songs`), counts of them (`library_counts`), and 网易云
 * (`search_catalogue`); and the web, which the endpoint searches itself. It
 * answers in a few sentences and the songs it is about, and every song it
 * names is checked to be one of yours.
 */

const VERSION = 4
/** Rounds of looking before it must answer. */
const ROUNDS = 8
const MAX_SONGS = 50

const Out = z.object({
  say: z.string().max(1200),
  songs: z.array(z.number().int()).max(MAX_SONGS),
  get: z.string().max(120).nullable(),
})

const SYSTEM = `You answer someone's questions about music, in the language they write in: about their own library, and about music itself — a song, an artist, an album, who sang it. You have tools: search_songs and library_counts look through their library; search_catalogue looks up 网易云, a music catalogue with publishers' own names (Chinese, Japanese and English), albums and track lengths. Use them: never say what is or isn't in the library without looking, and look again with other words when a search finds nothing (another spelling, another language, part of the name).

About music itself, answer from what you know as well as from what you look up, and tell them what you know even when it isn't in their library or the catalogue. Say so when an answer is from memory and could be out of date. When the question is about a song or an artist, say whether they have it.

Reply with JSON only:
- say: the answer, plain and short, at most five sentences. Name songs, albums and artists as they are written. When you could not find out, say so.
- songs: the ids (from search_songs) of their songs the answer is about, best first, at most ${MAX_SONGS}; empty when none.
- get: when the answer is about one song or album they don't have, its name and artist as a music catalogue would list them, to search for it; otherwise null.`

const WEB = `

You may also search the web, for what neither their library nor the catalogue says. Say where an answer came from when it came from the web.`

interface ExploreDeps {
  readonly llm: Llm
  readonly songs: () => Song[]
  readonly tags: () => Tag[]
  /** Artists' other names, which join one artist's spellings (shared artistJoins.ts). */
  readonly artistNames?: () => ArtistJoinNames
  readonly lyrics: (query: string) => { songId: number; line: string }[]
  /** 网易云's search, as `NeteaseMusic.search` gives it. */
  readonly catalogue?: CatalogueSearch
  /** Whether the model may search the web: always, as the server runs it (`smartFeaturesFor`). */
  readonly web?: () => boolean
  readonly remembered?: Remembered
}

/** The tools, over this library as it is now. */
function toolsFor(deps: ExploreDeps, steps: Steps) {
  const songs = deps.songs()
  const tags = deps.tags()
  const tagName = new Map(tags.map(tag => [tag.id, tag.name]))
  const row = (song: Song) => ({
    id: song.id,
    title: song.title,
    artist: song.artist,
    album: song.album,
    year: song.year,
    tags: song.tagIds.flatMap(id => tagName.get(id) ?? []),
    plays: song.playCount,
    seconds: Math.round(song.duration),
  })
  const tagged = (name: string | null): ((song: Song) => boolean) => {
    if (!name) return () => true
    const tag = tags.find(each => each.name.toLowerCase() === name.trim().toLowerCase())
    return song => tag !== undefined && song.tagIds.includes(tag.id)
  }
  const by = (name: string | null): ((song: Song) => boolean) => {
    if (!name) return () => true
    const wanted = name.trim().toLowerCase()
    // Yorushika brings ヨルシカ when one is the other's other name.
    const keys = new Set(joinedKeys(songs, deps.artistNames?.() ?? NO_JOINS, name))
    return song =>
      song.artist.toLowerCase().includes(wanted) ||
      song.albumArtist.toLowerCase().includes(wanted) ||
      splitArtists(song.artist).some(each => keys.has(artistKey(each)))
  }

  const search = tool({
    name: 'search_songs',
    description:
      'Their songs that match: words in the title, artist, album or lyrics, a tag, an artist, an album. Every given condition must hold; leave the others null. Returns how many match and a page of them.',
    parameters: z.object({
      words: z.string().max(120).nullable(),
      tag: z.string().max(80).nullable(),
      artist: z.string().max(120).nullable(),
      album: z.string().max(200).nullable(),
      limit: z.number().int().min(1).max(100).nullable(),
      offset: z.number().int().min(0).nullable(),
    }),
    run: ({ words, tag, artist, album, limit, offset }) => {
      steps.begin(
        words ? `Looking through your songs for “${words}”` : 'Looking through your songs',
      )
      const term = words ? words.trim().toLowerCase() : ''
      const inLyrics = new Set(term ? deps.lyrics(term).map(hit => hit.songId) : [])
      const wantedAlbum = album ? album.trim().toLowerCase() : ''
      const inTag = tagged(tag)
      const byArtist = by(artist)
      const matches = songs.filter(
        song =>
          (!term ||
            `${song.title} ${song.artist} ${song.album}`.toLowerCase().includes(term) ||
            inLyrics.has(song.id)) &&
          inTag(song) &&
          byArtist(song) &&
          (!wantedAlbum || song.album.toLowerCase().includes(wantedAlbum)),
      )
      const start = offset ?? 0
      return {
        total: matches.length,
        songs: matches.slice(start, start + (limit ?? 40)).map(row),
      }
    },
  })

  const counts = tool({
    name: 'library_counts',
    description:
      'How many of their songs there are for each artist, album, tag or year, most first, optionally only among one tag or one artist.',
    parameters: z.object({
      by: z.enum(['artist', 'album', 'tag', 'year']),
      tag: z.string().max(80).nullable(),
      artist: z.string().max(120).nullable(),
    }),
    run: ({ by: key, tag, artist }) => {
      steps.begin(`Counting your songs by ${key}`)
      const tally = new Map<string, number>()
      const inTag = tagged(tag)
      const byArtist = by(artist)
      for (const song of songs.filter(each => inTag(each) && byArtist(each))) {
        const names =
          key === 'artist'
            ? splitArtists(song.artist).slice(0, 1)
            : key === 'album'
              ? [song.album ? `${song.album} · ${song.albumArtist || song.artist}` : '(no album)']
              : key === 'tag'
                ? song.tagIds.flatMap(id => tagName.get(id) ?? [])
                : [song.year ? String(song.year) : '(no year)']
        for (const name of names) tally.set(name, (tally.get(name) ?? 0) + 1)
      }
      return [...tally]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 200)
        .map(([name, songCount]) => ({ name, songs: songCount }))
    },
  })

  const catalogue = deps.catalogue
  const lookUp = catalogue
    ? [
        tool({
          name: 'search_catalogue',
          description:
            'Songs 网易云 lists for some words (a title, an artist, an album, in any language): the publisher’s own names, often in two languages, with album and length in seconds.',
          parameters: z.object({ words: z.string().min(1).max(120) }),
          run: async ({ words }) => {
            steps.begin(`Looking up “${words}” on 网易云`)
            return (await catalogue(words)).slice(0, 8).map(each => ({
              title: each.title,
              artist: each.artist,
              album: each.album,
              seconds: each.duration,
            }))
          },
        }),
      ]
    : []

  return [search, counts, ...lookUp]
}

export async function explore(
  deps: ExploreDeps,
  text: string,
  steps: Steps = NO_STEPS,
): Promise<Extract<AskCard, { kind: 'explore' }>> {
  const remembered = deps.remembered ?? new Remembered()
  const songs = deps.songs()
  const web = deps.web?.() ?? false
  const prompt = `${libraryShape(songs, deps.tags(), deps.artistNames?.())}\n\nThe question:\n${text}`
  steps.begin('Looking into it')
  const answer = await remembered.get(
    Remembered.key('ask-explore', VERSION, web, prompt),
    async () =>
      (
        await deps.llm.generate({
          task: 'ask-explore',
          tier: 'smart',
          system: web ? SYSTEM + WEB : SYSTEM,
          prompt,
          schema: Out,
          tools: toolsFor(deps, steps),
          maxRounds: ROUNDS,
          webSearch: web,
        })
      ).value,
  )
  steps.done()
  // Only their songs, once each.
  const ids = new Set(songs.map(song => song.id))
  const songIds = [...new Set(answer.songs)].filter(id => ids.has(id))
  return { kind: 'explore', say: answer.say.trim(), songIds, get: answer.get?.trim() || null }
}
