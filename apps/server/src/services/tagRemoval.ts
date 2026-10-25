import { rulesWithoutTag } from '@selfmp3/shared'
import type { Db } from '../db/index.js'
import type { PlaylistRepository } from '../repositories/playlists.js'
import type { TagRepository } from '../repositories/tags.js'
import type { LocalEdits } from './localEdits.js'

/**
 * A tag deleted on this server — asked for, or emptied by a removal — and the
 * playlists that follow it, which let go of it first (`rulesWithoutTag`): the
 * rules about it go, and one left with none keeps the songs it shows and
 * stops following. Stamped as edits, so every device's copy does the same.
 */
export class TagRemoval {
  readonly #db: Db
  readonly #tags: Pick<TagRepository, 'delete'>
  readonly #playlists: Pick<PlaylistRepository, 'all' | 'update' | 'stopFollowing' | 'songIds'>
  readonly #edits: Pick<LocalEdits, 'playlist'>

  constructor(deps: {
    db: Db
    tags: Pick<TagRepository, 'delete'>
    playlists: Pick<PlaylistRepository, 'all' | 'update' | 'stopFollowing' | 'songIds'>
    edits: Pick<LocalEdits, 'playlist'>
  }) {
    this.#db = deps.db
    this.#tags = deps.tags
    this.#playlists = deps.playlists
    this.#edits = deps.edits
  }

  /** The names of the playlists it changed, for whoever asked. */
  remove(tagId: number): string[] {
    return this.#db.transaction(() => {
      const changed: string[] = []
      for (const playlist of this.#playlists.all()) {
        if (playlist.kind !== 'live' || !playlist.rules) continue
        const rules = rulesWithoutTag(playlist.rules, tagId)
        if (rules === undefined) continue
        if (rules) {
          this.#playlists.update(playlist.id, { rules })
          this.#edits.playlist(playlist.id, ['rules'])
        } else {
          this.#playlists.stopFollowing(playlist, this.#playlists.songIds(playlist))
          this.#edits.playlist(playlist.id, ['rules', 'order'])
        }
        changed.push(playlist.name)
      }
      this.#tags.delete(tagId)
      return changed
    })()
  }
}
