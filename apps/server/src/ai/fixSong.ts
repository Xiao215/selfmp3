import path from 'node:path'
import { z } from 'zod/v4'
import {
  creditList,
  type MetadataCandidate,
  type MetadataSuggestion,
  type Song,
} from '@selfmp3/shared'
import { withNotes } from './ask.js'
import { Remembered, type Llm } from './llm.js'
import { within, type FindNames, type FoundName, type MetadataLookup } from './names.js'

/**
 * Fix metadata's Suggested card (docs/features/ai.md): one song's names as
 * the model would set them, from what the catalogues list for it.
 *
 * The dialog already shows iTunes' and MusicBrainz's listings, each a whole
 * set of names to take or leave. What they cannot do is read: pick the title
 * from one listing and the artist's own script from another, see that the
 * library's title is a video's ("YOASOBI「アイドル」Official Music Video"),
 * or say the song is right as it is. 网易云 often has a song neither of them
 * does — most of a library of Chinese and game music — and the dialog never
 * showed it at all. That reading is this.
 *
 * Grounded the way Tidy up is: every name the model answers with must be
 * found in the song's own words, its file's name, or a listing. One that is
 * not is put back as it was and named in `dropped`, so a suggestion can be
 * wrong about which name to choose but never make one up. A year must be a
 * listing's. One call, on the smart tier, remembered against its exact
 * question, so opening the dialog twice costs one.
 */

export interface FixSongDeps {
  readonly llm: Llm
  readonly remembered: Remembered
  /** The catalogues' listings the dialog shows (`MetadataLookupService.lookup`). */
  readonly lookup?: MetadataLookup
  /** The same recording on 网易云, or MusicBrainz and iTunes (`catalogueFinder`). */
  readonly findNames?: FindNames
  readonly notes?: () => readonly string[]
}

const VERSION = 1

const SYSTEM = `You fix one song's names in a person's own music library.

You are given what the library has now, the name of the file it came from, the link it was downloaded from, and listings from music catalogues that matched it: numbered listings from iTunes and MusicBrainz, and names other catalogues (网易云 first) give the same recording.

Answer the names the song should have:
- Take every name from the listings or from the song's own words. Never make one up, and never translate one yourself.
- The official title, without video words ("Official Music Video", "MV", "[4K]", "Lyrics", "歌词"), channel words (" - Topic", "Official"), or the artist's name in front ("YOASOBI - アイドル" is "アイドル").
- The artist's own script: ヨルシカ's songs are by "ヨルシカ" if a listing says so, 周杰倫's by "周杰倫". Keep a title in two languages when the publisher's listing does.
- album and albumArtist: from a listing that is this recording; keep what the song has otherwise.
- year: only a listing's year for this recording, else null.
- When you are not sure of a field, give the value the song has now.
- agrees: the number of the listing your answer mostly follows, or null if none.
- why: one short sentence in plain English saying what you changed and on what grounds, or that it already looks right.`

const ReplySchema = z.object({
  title: z.string(),
  artist: z.string(),
  album: z.string(),
  albumArtist: z.string(),
  year: z.number().int().nullable(),
  agrees: z.number().int().nullable(),
  why: z.string(),
})

/** The fields a suggestion can change by name. */
const NAMED = ['title', 'artist', 'album', 'albumArtist'] as const
type Named = (typeof NAMED)[number]

export async function fixSong(
  deps: FixSongDeps,
  song: Song,
  again = false,
): Promise<MetadataSuggestion> {
  const query = {
    title: song.title,
    artist: song.artist,
    album: song.album,
    duration: song.duration,
  }
  const [candidates, found] = await Promise.all([
    deps.lookup ? deps.lookup(query).catch(() => []) : Promise.resolve([]),
    deps.findNames ? deps.findNames(song).catch(() => []) : Promise.resolve([]),
  ])
  const prompt = withNotes(promptFor(song, candidates, found), deps.notes?.() ?? [])

  const make = async (): Promise<MetadataSuggestion> => {
    const { value } = await deps.llm.generate({
      task: 'fix-song',
      tier: 'smart',
      system: SYSTEM,
      prompt,
      schema: ReplySchema,
    })
    return checked(song, candidates, found, value)
  }
  const key = Remembered.key('fix-song', VERSION, prompt)
  return again ? deps.remembered.put(key, make) : deps.remembered.get(key, make)
}

function promptFor(
  song: Song,
  candidates: readonly MetadataCandidate[],
  found: readonly FoundName[],
): string {
  const line = (value: string | number | null | undefined): string =>
    value === null || value === undefined || value === '' ? '—' : String(value)
  const lines = [
    'The song now:',
    `title: ${line(song.title)}`,
    `artist: ${line(song.artist)}`,
    `album: ${line(song.album)}`,
    `album artist: ${line(song.albumArtist)}`,
    `year: ${line(song.year)}`,
    `length: ${Math.round(song.duration)} s`,
    `file: ${fileWords(song)}`,
    `downloaded from: ${line(song.sourceUrl)}`,
    '',
    candidates.length > 0
      ? 'Listings (n | title | artist | album | album artist | year | length):'
      : 'Listings: none matched on iTunes or MusicBrainz.',
    ...candidates.map(
      (each, n) =>
        `${n} | ${each.title} | ${each.artist} | ${line(each.album)} | ${line(each.albumArtist)} | ${line(each.year)} | ${each.durationSec ? `${Math.round(each.durationSec)} s` : '—'}`,
    ),
    '',
    found.length > 0
      ? 'The same recording elsewhere (catalogue | title | artist | album):'
      : 'Other catalogues: nothing for the same recording.',
    ...found.map(each => `${each.source} | ${each.title} | ${each.artist} | ${line(each.album)}`),
  ]
  return lines.join('\n')
}

/** The song's file as words: the folder it is in names the artist and title ("Artist - Title/…"). */
function fileWords(song: Song): string {
  const parts = song.path.split(/[\\/]/).filter(Boolean)
  const file = parts.at(-1) ?? ''
  const folder = parts.at(-2)
  const name = path.basename(file, path.extname(file))
  return folder ? `${folder}/${name}` : name
}

/**
 * The model's answer, kept to what can be found: a changed name every part of
 * which is in one of the sources, a year a listing gives, a listing that
 * exists. Anything else is the song's own value again.
 */
function checked(
  song: Song,
  candidates: readonly MetadataCandidate[],
  found: readonly FoundName[],
  reply: z.infer<typeof ReplySchema>,
): MetadataSuggestion {
  const sources = [
    song.title,
    song.artist,
    song.album,
    song.albumArtist,
    fileWords(song),
    ...candidates.flatMap(each => [each.title, each.artist, each.album, each.albumArtist ?? '']),
    ...found.flatMap(each => [each.title, each.artist, each.album]),
  ].filter(Boolean)
  const foundSomewhere = (value: string, field: Named): boolean => {
    // A credit is checked name by name: "Ayase, ikura" from two listings.
    const parts = field === 'artist' || field === 'albumArtist' ? creditList(value) : [value]
    return parts.every(part => sources.some(source => within(part, source)))
  }

  const dropped: string[] = []
  const names = {} as Record<Named, string>
  for (const field of NAMED) {
    const now = song[field]
    const said = reply[field].trim()
    // A song keeps its title; clearing a name is not something to suggest.
    if (said === '' || said === now) names[field] = now
    else if (foundSomewhere(said, field)) names[field] = said
    else {
      names[field] = now
      dropped.push(field)
    }
  }

  const agrees =
    reply.agrees !== null && reply.agrees >= 0 && reply.agrees < candidates.length
      ? reply.agrees
      : null
  const agreed = agrees === null ? undefined : candidates[agrees]
  const listedYears = new Set(candidates.flatMap(each => (each.year ? [each.year] : [])))
  let year = song.year
  if (reply.year !== null && reply.year !== song.year) {
    if (listedYears.has(reply.year)) year = reply.year
    else dropped.push('year')
  }

  const changed = NAMED.some(field => names[field] !== song[field]) || year !== song.year
  const suggestion: MetadataCandidate | null =
    changed || agreed?.artworkUrl
      ? {
          source: 'ai',
          title: names.title,
          artist: names.artist,
          album: names.album,
          ...(names.albumArtist ? { albumArtist: names.albumArtist } : {}),
          ...(year !== null ? { year } : {}),
          ...(agreed?.trackNo !== undefined ? { trackNo: agreed.trackNo } : {}),
          ...(song.duration > 0 ? { durationSec: song.duration } : {}),
          ...(agreed?.artworkUrl ? { artworkUrl: agreed.artworkUrl } : {}),
          score: agreed?.score ?? 1,
        }
      : null
  return {
    suggestion,
    why: reply.why.trim().slice(0, 240),
    agrees,
    dropped,
    candidates: [...candidates],
  }
}
