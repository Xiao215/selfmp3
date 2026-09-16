import {
  extractUrls,
  youtubeChannel,
  youtubeMusicAlbum,
  youtubeMusicSearch,
  youtubePlaylistId,
  type ImportPreview,
  type ImportPreviewItem,
  type Playlist,
} from '@selfmp3/shared'
import { HttpError } from '../http/errors.js'
import type { SongRepository } from '../repositories/songs.js'
import type { PlaylistRepository } from '../repositories/playlists.js'
import type { ProbedTrack, YtDlpService } from './ytdlp.js'
import type { YouTubeMusicArtists } from './youtubeMusicArtist.js'
import type { YouTubeMusicLists } from './youtubeMusicLists.js'

type PreviewDeps = {
  ytdlp: Pick<YtDlpService, 'status' | 'probe'>
  songs: Pick<SongRepository, 'all'>
  youtubeMusicArtists: Pick<YouTubeMusicArtists, 'topSongs'>
  youtubeMusicLists: Pick<YouTubeMusicLists, 'songs' | 'album' | 'playlist'>
}

type Probed = { kind: 'single' | 'playlist'; playlistTitle: string | null; tracks: ProbedTrack[] }

/**
 * The "read metadata before downloading" half of importing, pulled out of the
 * route so the interactive preview and the one-shot share endpoint resolve
 * links in exactly the same way.
 */
export async function buildImportPreview(deps: PreviewDeps, text: string): Promise<ImportPreview> {
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
    const probed = await probeLink(deps, url)
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
 * One link's tracks. An artist's channel means their songs, not the channel's
 * tabs: the "Top songs" list from YouTube Music, read by yt-dlp as the
 * playlist it is, and named after the artist.
 *
 * A search page, an album and a playlist are asked of YouTube Music itself
 * (youtubeMusicLists.ts): its answer has the artist, album, length and square
 * cover of every song, where yt-dlp's listing has a title and an uploader. A
 * search has no other reading, so no answer is an error; an album or playlist
 * YouTube Music will not answer, or answers only the first page of, is read by
 * yt-dlp as before.
 */
async function probeLink(deps: PreviewDeps, url: string): Promise<Probed> {
  const query = youtubeMusicSearch(url)
  if (query) {
    const tracks = await deps.youtubeMusicLists.songs(query)
    if (!tracks) {
      throw HttpError.unprocessable(
        'YouTube Music did not answer that search. Try again in a moment.',
      )
    }
    return { kind: 'playlist', playlistTitle: query, tracks }
  }

  const albumId = youtubeMusicAlbum(url)
  if (albumId) {
    const album = await deps.youtubeMusicLists.album(albumId)
    if (album) return { kind: 'playlist', playlistTitle: album.title, tracks: album.tracks }
    return probeWithYtDlp(deps, url)
  }

  const playlistId = youtubePlaylistId(url)
  if (playlistId) {
    const playlist = await deps.youtubeMusicLists.playlist(playlistId)
    if (playlist)
      return { kind: 'playlist', playlistTitle: playlist.title, tracks: playlist.tracks }
    return probeWithYtDlp(deps, url)
  }

  const channel = youtubeChannel(url)
  if (!channel) return probeWithYtDlp(deps, url)

  const artist = await deps.youtubeMusicArtists.topSongs(channel)
  if (!artist) {
    throw HttpError.unprocessable(
      'That channel has no songs on YouTube Music. Paste its Videos tab (…/videos), a playlist or a video instead.',
    )
  }
  const tracks = artist.playlistUrl
    ? (await probeWithYtDlp(deps, artist.playlistUrl)).tracks
    : [...artist.tracks]
  return { kind: 'playlist', playlistTitle: artist.artist || null, tracks }
}

async function probeWithYtDlp(deps: PreviewDeps, url: string): Promise<Probed> {
  // A link yt-dlp cannot read is the caller's problem to fix (wrong link,
  // private, not signed in), not a server fault — so 422 with the reason,
  // rather than a 500 that hides it behind "internal error".
  return deps.ytdlp.probe(url).catch((error: unknown) => {
    throw HttpError.unprocessable(error instanceof Error ? error.message : String(error))
  })
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
    if (playlist.kind === 'live') {
      throw HttpError.badRequest('imports cannot be added to a live playlist')
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
