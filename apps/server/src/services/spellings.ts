import { namesToSpell, type Song } from '@selfmp3/shared'
import type { Logger } from '../logger.js'
import type { NamesRepository } from '../repositories/names.js'
import type { RomanizationService } from './romanization.js'

/**
 * Every Chinese and Japanese name in the library spelt in Latin letters, so
 * search finds 周杰伦 typed as "zhou jie lun" (packages/shared/src/searchNames.ts).
 *
 * The dictionaries are the server's — the Japanese one is too big for a phone
 * or a tab — so the spellings are made here, kept, and travel in the snapshot.
 * A name is spelt once: the first pass after a library arrives spells all of
 * it, and every pass after spells only what is new. A library taken on from
 * the bucket brings the spellings its snapshot carries (services/cloudAdopt.ts),
 * so only what that server had not spelt is left.
 */
export class SpellingService {
  readonly #names: NamesRepository
  readonly #songs: { all(): readonly Pick<Song, 'title' | 'artist' | 'album'>[] }
  readonly #romanization: Pick<RomanizationService, 'spell'>
  readonly #logger: Logger
  #filling: Promise<number> | null = null

  constructor(deps: {
    names: NamesRepository
    songs: { all(): readonly Pick<Song, 'title' | 'artist' | 'album'>[] }
    romanization: Pick<RomanizationService, 'spell'>
    logger: Logger
  }) {
    this.#names = deps.names
    this.#songs = deps.songs
    this.#romanization = deps.romanization
    this.#logger = deps.logger.child('spellings')
  }

  /**
   * Spell what is not spelt yet. One run however often it is asked. Stops when
   * the Japanese dictionary cannot be loaded, to try again next time. Returns
   * how many names it spelt.
   */
  fill(): Promise<number> {
    this.#filling ??= this.#fill().finally(() => {
      this.#filling = null
    })
    return this.#filling
  }

  /**
   * The spellings of the names the library has now: what the snapshot and the
   * library carry. `songs` when the caller has just read them: on a library of
   * thousands, reading every song is most of what building the answer costs.
   */
  current(
    songs: readonly Pick<Song, 'title' | 'artist' | 'album'>[] = this.#songs.all(),
  ): Record<string, string[]> {
    const wanted = this.#wanted(songs)
    // Entries, not assignments: a name like "__proto__" is an own key that way.
    return Object.fromEntries(
      [...this.#names.spellings()].filter(
        ([name, spellings]) => wanted.has(name) && spellings.length > 0,
      ),
    )
  }

  #wanted(
    songs: readonly Pick<Song, 'title' | 'artist' | 'album'>[] = this.#songs.all(),
  ): Set<string> {
    const others = Object.fromEntries(
      [...this.#names.artistNames()].map(([artist, row]) => [artist, row.names]),
    )
    return namesToSpell(songs, others)
  }

  async #fill(): Promise<number> {
    const have = this.#names.spellings()
    let spelt = 0
    for (const name of this.#wanted()) {
      if (have.has(name)) continue
      const spellings = await this.#romanization.spell(name)
      if (spellings === null) break
      this.#names.setSpelling(name, spellings)
      spelt++
    }
    if (spelt > 0) this.#logger.info('spelt names in latin letters', { names: spelt })
    return spelt
  }
}
