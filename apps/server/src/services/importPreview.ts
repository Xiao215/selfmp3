import {
  extractUrls,
  type ImportPreview,
  type ImportPreviewItem,
  type Playlist,
} from '@selfmp3/shared'
import { HttpError } from '../http/errors.js'
import type { SongRepository } from '../repositories/songs.js'
import type { PlaylistRepository } from '../repositories/playlists.js'
import type { YtDlpService } from './ytdlp.js'

/**
 * The "read metadata before downloading" half of importing, pulled out of the
 * route so the interactive preview and the one-shot share endpoint resolve
 * links in exactly the same way.
 */
export async function buildImportPreview(
  deps: { ytdlp: YtDlpService; songs: SongRepository },
  text: string,
): Promise<ImportPreview> {
  const tools = await deps.ytdlp.status()
  if (!tools.ytdlp) {
    throw HttpError.failedDependency(
      'yt-dlp is not installed. Install it with: brew install yt-dlp ffmpeg',
    )
  }

  const urls = extractUrls(text)
  if (urls.length === 0) throw HttpError.badRequest('that does not look like a link')

  // An index of what is already here, so the UI can grey out duplicates.
  const existing = new Set(
    deps.songs.all().map(song => `${song.artist}::${song.title}`.toLowerCase()),
  )

  const items: ImportPreviewItem[] = []
  let kind: 'single' | 'playlist' = 'single'
  let playlistTitle: string | null = null

  for (const url of urls) {
    // A link yt-dlp cannot read is the caller's problem to fix (wrong link,
    // private, not signed in), not a server fault — so 422 with the reason,
    // rather than a 500 that hides it behind "internal error".
    const probed = await deps.ytdlp.probe(url).catch((error: unknown) => {
      throw HttpError.unprocessable(error instanceof Error ? error.message : String(error))
    })
    if (probed.kind === 'playlist') {
      kind = 'playlist'
      playlistTitle ??= probed.playlistTitle
    }
    for (const track of probed.tracks) {
      items.push({
        url: track.url,
        title: track.title,
        artist: track.artist,
        album: track.album,
        duration: track.duration,
        thumbnail: track.thumbnail,
        alreadyHave: existing.has(`${track.artist}::${track.title}`.toLowerCase()),
      })
    }
  }

  if (urls.length > 1) kind = 'playlist'
  return { kind, playlistTitle, items }
}

/**
 * Work out which playlist imported tracks should land in: an explicit id, a
 * named one to create (reusing a manual playlist of the same name so a second
 * import of "Liked Music" does not spawn "Liked Music (2)"), or none.
 */
export function resolveImportPlaylist(
  playlists: PlaylistRepository,
  input: { playlistId: number | null; createPlaylistName: string | null },
): Playlist | null {
  if (input.playlistId !== null) {
    const playlist = playlists.byId(input.playlistId)
    if (!playlist) throw HttpError.notFound('no such playlist')
    if (playlist.kind === 'smart') {
      throw HttpError.badRequest('imports cannot be added to a smart playlist')
    }
    return playlist
  }

  if (input.createPlaylistName) {
    const wanted = input.createPlaylistName.toLowerCase()
    const found = playlists
      .all()
      .find(list => list.kind === 'manual' && list.name.toLowerCase() === wanted)
    return (
      found ??
      playlists.create({
        name: input.createPlaylistName,
        description: '',
        kind: 'manual',
        rules: null,
      })
    )
  }

  return null
}
