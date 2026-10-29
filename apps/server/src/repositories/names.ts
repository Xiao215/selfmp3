import { ArtistNamesSchema, hlcWins, namesFound, type ArtistJoinNames } from '@selfmp3/shared'
import { z } from 'zod'
import type { Db } from '../db/index.js'

/** An artist's other names, and the stamp of the change that set them. */
export interface ArtistNamesRow {
  readonly names: readonly string[]
  readonly hlc: string
}

const SpeltSchema = z.array(z.string())

/**
 * What search finds things by besides their own names
 * (packages/shared/src/searchNames.ts): the names each artist also goes by,
 * which travel like any edit, and each Chinese or Japanese name spelt in Latin
 * letters, which this server works out and every device reads.
 */
export class NamesRepository {
  readonly #artistNames
  readonly #artistNamed
  readonly #setArtistNames
  readonly #lookedAt
  readonly #setLookedAt
  readonly #spellings
  readonly #setSpelling
  readonly #latestStamp

  constructor(db: Db) {
    this.#artistNames = db.prepare<[], { artist: string; names: string; hlc: string }>(
      'SELECT artist, names, hlc FROM artist_names',
    )
    this.#artistNamed = db.prepare<[string], { names: string; hlc: string }>(
      'SELECT names, hlc FROM artist_names WHERE artist = ?',
    )
    this.#setArtistNames = db.prepare(`
      INSERT INTO artist_names (artist, names, hlc) VALUES (?, ?, ?)
      ON CONFLICT (artist) DO UPDATE SET names = excluded.names, hlc = excluded.hlc
    `)
    this.#lookedAt = db.prepare<[string], { looked_at: string }>(
      'SELECT looked_at FROM artist_name_lookups WHERE artist = ?',
    )
    this.#setLookedAt = db.prepare(`
      INSERT INTO artist_name_lookups (artist, looked_at) VALUES (?, ?)
      ON CONFLICT (artist) DO UPDATE SET looked_at = excluded.looked_at
    `)
    this.#spellings = db.prepare<[], { name: string; spelt: string }>(
      'SELECT name, spelt FROM spellings',
    )
    this.#setSpelling = db.prepare(`
      INSERT INTO spellings (name, spelt) VALUES (?, ?)
      ON CONFLICT (name) DO UPDATE SET spelt = excluded.spelt
    `)
    this.#latestStamp = db.prepare<[], { hlc: string | null }>(
      'SELECT MAX(hlc) AS hlc FROM artist_names',
    )
  }

  // --- Artists' other names --------------------------------------------------

  /** Every artist's other names, by `artistKey`. */
  artistNames(): Map<string, ArtistNamesRow> {
    return new Map(
      this.#artistNames
        .all()
        .map(row => [row.artist, { names: readNames(row.names), hlc: row.hlc }]),
    )
  }

  /**
   * Every artist's other names as the library carries them, with the artists
   * whose names are MusicBrainz's as found: what joins artists (shared artistJoins.ts).
   */
  joinNames(): ArtistJoinNames {
    const rows = this.artistNames()
    return {
      artistNames: Object.fromEntries([...rows].map(([artist, row]) => [artist, [...row.names]])),
      artistNamesFound: [...rows].flatMap(([artist, row]) => (namesFound(row.hlc) ? [artist] : [])),
    }
  }

  /** One artist's, or null when nobody has named them, nor the lookup. */
  artistNamed(artist: string): ArtistNamesRow | null {
    const row = this.#artistNamed.get(artist)
    return row ? { names: readNames(row.names), hlc: row.hlc } : null
  }

  /**
   * An artist's other names, if this change is later than the one that set
   * them: the rule every device replays `artistNamed` by (shared sync.ts).
   * True when it took.
   */
  takeArtistNames(artist: string, names: readonly string[], hlc: string): boolean {
    if (!hlcWins(hlc, this.#artistNamed.get(artist)?.hlc)) return false
    this.#setArtistNames.run(artist, JSON.stringify(names), hlc)
    return true
  }

  /** The latest stamp an artist's names carry, for where this server's clock carries on from. */
  latestStamp(): string | null {
    return this.#latestStamp.get()?.hlc ?? null
  }

  /** When an artist was last looked up on MusicBrainz, in ms; null for never. */
  lookedAt(artist: string): number | null {
    const row = this.#lookedAt.get(artist)
    return row ? Date.parse(row.looked_at) : null
  }

  markLookedUp(artist: string, at: Date): void {
    this.#setLookedAt.run(artist, at.toISOString())
  }

  // --- Spellings ---------------------------------------------------------------

  /** Every name spelt so far: as written → each way it is spelt. */
  spellings(): Map<string, string[]> {
    return new Map(this.#spellings.all().map(row => [row.name, readSpelt(row.spelt)]))
  }

  setSpelling(name: string, spelt: readonly string[]): void {
    this.#setSpelling.run(name, JSON.stringify(spelt))
  }
}

/** Written by this class alone, so a row that does not read is an empty one. */
function readNames(json: string): string[] {
  const parsed = ArtistNamesSchema.safeParse(safeJson(json))
  return parsed.success ? parsed.data : []
}

function readSpelt(json: string): string[] {
  const parsed = SpeltSchema.safeParse(safeJson(json))
  return parsed.success ? parsed.data : []
}

function safeJson(json: string): unknown {
  try {
    return JSON.parse(json) as unknown
  } catch {
    return null
  }
}
