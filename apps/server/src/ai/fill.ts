import { z } from 'zod/v4'
import { plural, type Song, type TidyResult } from '@selfmp3/shared'
import { LlmError, llmFailureWords, Remembered, type Llm } from './llm.js'
import type { FindListings, Listing } from './names.js'
import { NO_STEPS, type Steps } from './progress.js'
import { chunks, foldedBare as bare, pool } from './text.js'
import { grouped, missingFrom } from './tidy.js'

/**
 * A4 · Filling in what's missing (docs/features/ai.md): an album, a year or a
 * cover a song lacks, from what the music catalogues list for the same
 * recording, each as a change to approve in Tidy up's review. Nothing here
 * writes.
 *
 * Every value is a catalogue's own, from a listing that is this recording
 * (the same length, and its title or artist in common: `names.ts`). Where
 * the listings agree, that is the answer and no model is asked. Where they
 * differ — a single, its album and a collection years later — the model is
 * shown the song and the listings and says which one each field comes from;
 * it can choose the wrong listing, but never write a value of its own. A
 * cover follows the album: the picture of a listing on the album the song
 * has, or is given.
 */

const VERSION = 1

/** The most songs looked up in one request: MusicBrainz answers one request a second. */
const MAX_FILL = 40
/** Lookups at once: 网易云 and iTunes answer quickly, and MusicBrainz waits its turn on its own. */
const LOOKUPS_AT_ONCE = 3
/** Songs per model call: each comes with its listings. */
const SONGS_PER_CALL = 25
/** The most listings of one song the model is shown. */
const LISTINGS_SHOWN = 8

interface FillDeps {
  readonly llm: Llm
  readonly remembered?: Remembered
  /** The catalogues' listings for a song's recording; absent where they cannot be reached. */
  readonly findListings?: FindListings
}

const FillOut = z.object({
  fills: z
    .array(
      z.object({
        n: z.number().int(),
        album: z.number().int().nullable(),
        year: z.number().int().nullable(),
      }),
    )
    .max(SONGS_PER_CALL),
})

const FILL_SYSTEM = `You fill in what is missing from songs in someone's own music library. You are given a numbered table of songs, each saying whether its album and its year are missing, and under each song the listings music catalogues (网易云, MusicBrainz, iTunes) have for that same recording, matched by its length and its title or artist, numbered from 1. Reply with JSON only: fills, each a song's number (n) and, for its album and its year, the number of the listing to take it from, or null.

- Judge which listing is the release the recording belongs to, from what the table says and what you know of the music. A collection that gathers it later with other songs is not where it belongs when another listing shows the release it came out on.
- year: the year the recording first came out, from a listing that says one.
- Leave a field null when it is not missing, when no listing has it, or when you cannot tell which is right. Never use a song or a listing number that is not shown.`

/** A field a song lacks, and the different values its listings give for it. */
type Gap = 'album' | 'year'

/** One song looked up: what it lacks and its listings. */
interface Looked {
  readonly song: Song
  readonly missing: readonly ('album' | 'year' | 'cover')[]
  readonly listings: readonly Listing[]
}

/** The values of a field the listings give, each once, in the order listed. */
function valuesOf(listings: readonly Listing[], field: Gap): string[] {
  const values = new Map<string, string>()
  for (const listing of listings) {
    const value = field === 'album' ? listing.album.trim() : String(listing.year ?? '')
    if (value && !values.has(bare(value))) values.set(bare(value), value)
  }
  return [...values.values()]
}

/** A value from one listing, with the catalogue it came from. */
interface Chosen {
  readonly value: string
  readonly source: Listing['source']
  readonly by: 'rule' | 'model'
}

export async function fillGaps(
  deps: FillDeps,
  songs: readonly Song[],
  text: string,
  steps: Steps = NO_STEPS,
): Promise<TidyResult> {
  const remembered = deps.remembered ?? new Remembered()
  const answer = (changes: TidyResult['changes'], notes: string[]): TidyResult => ({
    changes,
    looked: songs.length,
    note: notes.length > 0 ? notes.join(' ') : null,
    asked: text,
    reply: null,
    gaps: null,
  })
  // An album's songs side by side, so they are looked up and judged together.
  const lacking = songs
    .filter(song => missingFrom(song).length > 0)
    .sort(
      (a, b) =>
        (a.albumArtist || a.artist).localeCompare(b.albumArtist || b.artist) ||
        a.album.localeCompare(b.album) ||
        (a.trackNo ?? 0) - (b.trackNo ?? 0) ||
        a.id - b.id,
    )
  steps.begin(`Checking what ${plural(songs.length, 'song lacks', 'songs lack')}`)
  if (lacking.length === 0) {
    steps.done('Nothing missing')
    return answer(
      [],
      [
        songs.length === 1
          ? 'It has an album, a year and a cover already.'
          : 'None of them is missing an album, a year or a cover.',
      ],
    )
  }
  const findListings = deps.findListings
  if (!findListings) return answer([], ['Songs can’t be looked up from here.'])

  const notes: string[] = []
  const asking = lacking.slice(0, MAX_FILL)
  if (lacking.length > asking.length) {
    notes.push(
      `Looked up the first ${asking.length} of the ${lacking.length.toLocaleString('en')} songs missing something; ask again for the rest.`,
    )
  }

  // 1 · The catalogues: every listing that is this recording.
  const all = plural(asking.length, 'song', 'songs')
  const lookingFor = `Looking up ${all} on 网易云, MusicBrainz and iTunes`
  steps.begin(lookingFor)
  const looked: Looked[] = []
  let done = 0
  await pool(asking, LOOKUPS_AT_ONCE, async song => {
    const listings = await findListings(song).catch(() => [])
    if (listings.length > 0) looked.push({ song, missing: missingFrom(song), listings })
    done++
    if (done % 10 === 0 && done < asking.length) steps.update(`${lookingFor} · ${done} done`)
  })
  // In the order asked: the pool finishes them in any order.
  looked.sort((a, b) => asking.indexOf(a.song) - asking.indexOf(b.song))
  steps.done(`Found ${looked.length} of ${asking.length}`)
  const unfound = asking.length - looked.length
  if (unfound > 0) {
    notes.push(
      `${plural(unfound, 'song wasn’t', 'songs weren’t')} found in the catalogues, so ${unfound === 1 ? 'it stays' : 'they stay'} as ${unfound === 1 ? 'it is' : 'they are'}.`,
    )
  }

  // 2 · Where the listings agree, that is the value; where they differ, the model says which.
  const chosen = new Map<number, Partial<Record<Gap, Chosen>>>()
  const toJudge: Looked[] = []
  for (const each of looked) {
    const picks: Partial<Record<Gap, Chosen>> = {}
    let differ = false
    for (const field of ['album', 'year'] as const) {
      if (!each.missing.includes(field)) continue
      const values = valuesOf(each.listings, field)
      if (values.length === 1) {
        const value = values[0]!
        const from = each.listings.find(listing =>
          field === 'album'
            ? bare(listing.album) === bare(value)
            : String(listing.year ?? '') === value,
        )!
        picks[field] = { value, source: from.source, by: 'rule' }
      } else if (values.length > 1) differ = true
    }
    chosen.set(each.song.id, picks)
    if (differ) toJudge.push(each)
  }

  if (toJudge.length > 0) {
    steps.begin(`Choosing between the listings for ${plural(toJudge.length, 'song', 'songs')}`)
    const failures: LlmError[] = []
    await pool(chunks(toJudge, SONGS_PER_CALL), 2, async batch => {
      const prompt = fillPrompt(batch)
      try {
        const reply = await remembered.get(
          Remembered.key('tidy-fill', VERSION, prompt),
          async () =>
            (
              await deps.llm.generate({
                task: 'tidy-fill',
                tier: 'smart',
                system: FILL_SYSTEM,
                prompt,
                schema: FillOut,
              })
            ).value,
        )
        judged(batch, reply, chosen)
      } catch (caught) {
        if (!(caught instanceof LlmError)) throw caught
        failures.push(caught)
      }
    })
    const [failure] = failures
    if (failure) {
      const { kind } = failure
      // Stopped is nobody waiting: there is no answer to give.
      if (kind === 'stopped') throw failure
      notes.push(
        `${llmFailureWords[kind]} Where the catalogues disagree, the songs stay as they are.`,
      )
    }
    steps.done('Chosen')
  }

  // 3 · The changes: each value from its listing, a cover from a listing on the song's album.
  const { propose, changes } = grouped()
  for (const each of looked) {
    const picks = chosen.get(each.song.id) ?? {}
    for (const field of ['album', 'year'] as const) {
      const pick = picks[field]
      if (pick)
        propose(each.song, field, '', { value: pick.value, whys: [`From ${pick.source}`] }, pick.by)
    }
    if (each.missing.includes('cover')) {
      const album = picks.album?.value ?? each.song.album
      const pictured = album
        ? each.listings.find(listing => listing.cover && bare(listing.album) === bare(album))
        : undefined
      if (pictured?.cover) {
        propose(
          each.song,
          'cover',
          '',
          { value: pictured.cover, whys: [`From ${pictured.source}`] },
          picks.album?.by ?? 'rule',
        )
      }
    }
  }
  const proposed = changes()
  steps.done(`${plural(proposed.length, 'thing', 'things')} to fill in`)
  return answer(proposed, notes)
}

/** The songs and their listings as the model reads them. */
function fillPrompt(batch: readonly Looked[]): string {
  const or = (value: string | number | null): string =>
    value === null || value === '' ? '-' : String(value)
  return batch
    .map((each, index) => {
      const { song } = each
      const lacks = (field: Gap) => (each.missing.includes(field) ? 'missing' : 'has one')
      return [
        `${index + 1} | ${song.title} | ${song.artist || '-'} | album: ${lacks('album') === 'missing' ? 'missing' : song.album} | year: ${lacks('year') === 'missing' ? 'missing' : or(song.year)} | ${Math.round(song.duration)} s`,
        ...each.listings
          .slice(0, LISTINGS_SHOWN)
          .map(
            (listing, at) =>
              `   listing ${at + 1} | ${listing.source} | ${listing.title} | ${listing.artist} | ${or(listing.album)} | ${or(listing.year)}`,
          ),
      ].join('\n')
    })
    .join('\n')
}

/** The model's choices, kept to what was shown: a song in the batch, a listing that has the field. */
function judged(
  batch: readonly Looked[],
  reply: z.infer<typeof FillOut>,
  chosen: Map<number, Partial<Record<Gap, Chosen>>>,
): void {
  for (const fill of reply.fills) {
    const each = batch[fill.n - 1]
    if (!each) continue
    const picks = chosen.get(each.song.id) ?? {}
    for (const field of ['album', 'year'] as const) {
      const at = fill[field]
      // Agreed already, or not missing: the model is not asked about it.
      if (at === null || picks[field] || !each.missing.includes(field)) continue
      const listing = each.listings.slice(0, LISTINGS_SHOWN)[at - 1]
      const value = listing
        ? field === 'album'
          ? listing.album.trim()
          : String(listing.year ?? '')
        : ''
      if (listing && value) picks[field] = { value, source: listing.source, by: 'model' }
    }
    chosen.set(each.song.id, picks)
  }
}
