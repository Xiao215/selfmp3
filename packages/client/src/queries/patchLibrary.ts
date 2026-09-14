import type { Library, Playlist, Song, Tag } from '@selfmp3/shared'

/**
 * What an edit answered with, put into the library already held.
 *
 * Most edits answer with the song, tag or playlist they changed. Asking for
 * the whole library again after each one — which is what invalidating it does —
 * meant the whole library over the wire from a server, or replayed and parsed
 * again from the cloud copy, and on the web written to the device once more,
 * for one heart filling in.
 *
 * Each function answers null when the change reaches past the thing itself in
 * a way that cannot be worked out here, and the caller asks for the library
 * again then. Only replacements in place: a new or removed thing, or one whose
 * name moved it in an order the server decides, is left to the refetch.
 * Pure, so it can be tested without React.
 */

/**
 * Whether a playlist is worked out from rules. Those can follow any field of a
 * song — loved, a tag, the artist — so a song edit may change their counts.
 */
export function hasLivePlaylists(library: Library): boolean {
  return library.playlists.some(playlist => playlist.kind === 'live')
}

/** One song replaced, and the counts of the tags it gained or lost moved to match. */
export function withSong(library: Library, song: Song): Library | null {
  const index = library.songs.findIndex(candidate => candidate.id === song.id)
  const before = library.songs[index]
  if (!before) return null

  const songs = library.songs.slice()
  songs[index] = song
  const gained = song.tagIds.filter(id => !before.tagIds.includes(id))
  const lost = before.tagIds.filter(id => !song.tagIds.includes(id))
  const tags =
    gained.length === 0 && lost.length === 0
      ? library.tags
      : library.tags.map(tag => {
          const delta = (gained.includes(tag.id) ? 1 : 0) - (lost.includes(tag.id) ? 1 : 0)
          return delta === 0 ? tag : { ...tag, songCount: Math.max(0, tag.songCount + delta) }
        })
  return { ...library, songs, tags }
}

/** One tag replaced — not a renamed one: tags come sorted by name. */
export function withTag(library: Library, tag: Tag): Library | null {
  const index = library.tags.findIndex(candidate => candidate.id === tag.id)
  const before = library.tags[index]
  if (!before || before.name !== tag.name) return null
  const tags = library.tags.slice()
  tags[index] = tag
  return { ...library, tags }
}

/**
 * One playlist replaced — not one renamed or pinned, which moves it in the
 * list's order.
 *
 * `generatedAt` is the time of this change: what a playlist holds is kept on
 * the device once per library answer (the app's useKeepAlongside), and a
 * playlist whose songs changed is a new answer as far as that goes.
 */
export function withPlaylist(
  library: Library,
  playlist: Playlist,
  generatedAt: string,
): Library | null {
  const index = library.playlists.findIndex(candidate => candidate.id === playlist.id)
  const before = library.playlists[index]
  if (!before || before.name !== playlist.name || before.pinned !== playlist.pinned) return null
  const playlists = library.playlists.slice()
  playlists[index] = playlist
  return { ...library, playlists, generatedAt }
}
