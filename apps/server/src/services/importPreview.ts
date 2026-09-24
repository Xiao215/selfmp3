import {
  extractUrls,
  youtubeChannel,
  youtubeMusicAlbum,
  youtubeMusicSearch,
  youtubePlaylistId,
  youtubeVideoId,
  type ImportPreview,
  type ImportPreviewItem,
  type Playlist,
} from '@selfmp3/shared'
import { HttpError } from '../http/errors.js'
import { alreadyHave, sourceUrlIndex } from './alreadyHave.js'
import type { SongRepository } from '../repositories/songs.js'
import type { PlaylistRepository } from '../repositories/playlists.js'
import type { ProbedTrack, YtDlpService } from './ytdlp.js'
import type { YouTubeMusicArtists } from './youtubeMusicArtist.js'
import type { SongList, YouTubeMusicLists } from './youtubeMusicLists.js'

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

  /*
   * What is already here, so the UI can grey out duplicates.
   *
   * This was a set of `artist::title` compared as exact lowercased strings,
   * and it let the same song in ten times: YouTube hands back a different
   * spelling of the channel from one week to the next, and two strings that
   * differ by one character are two different songs to an exact comparison.
   * `alreadyHave` knows the link, the fuzzy name and the length instead.
   */
  const library = deps.songs.all()
  const knownLinks = sourceUrlIndex(library)

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
        alreadyHave: alreadyHave(track, library, knownLinks) !== null,
      })
    }
  }

  if (urls.length > 1) kind = 'playlist'
  return { kind, playlistTitle, items }
}

/**
 * One link's tracks. An artist's channel means their songs, not the channel's
 * tabs: the "Top songs" list from YouTube Music, named after the artist.
 *
 * A search page, an album, a playlist and that list are asked of YouTube Music
 * itself (youtubeMusicLists.ts): its answer has the artist, album, length and
 * square cover of every song, where yt-dlp's listing has a title, an uploader
 * and a video still. A search has no other reading, so no answer is an error;
 * a list YouTube Music will not answer, or answers only part of, is read whole
 * by yt-dlp, with YouTube Music's word kept for every song it did name
 * (`withMusicDetails`).
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
  if (albumId) return fromList(deps, url, await deps.youtubeMusicLists.album(albumId), null)

  const playlistId = youtubePlaylistId(url)
  if (playlistId) {
    return fromList(deps, url, await deps.youtubeMusicLists.playlist(playlistId), null)
  }

  const channel = youtubeChannel(url)
  if (!channel) return probeWithYtDlp(deps, url)

  const artist = await deps.youtubeMusicArtists.topSongs(channel)
  if (!artist) {
    throw HttpError.unprocessable(
      'That channel has no songs on YouTube Music. Paste its Videos tab (…/videos), a playlist or a video instead.',
    )
  }
  const playlistTitle = artist.artist || null
  const songsList = artist.playlistUrl ? youtubePlaylistId(artist.playlistUrl) : null
  if (!artist.playlistUrl || !songsList)
    return { kind: 'playlist', playlistTitle, tracks: [...artist.tracks] }
  // The list is the artist's, so a song the page left out is credited to them,
  // not to the channel yt-dlp read it from ("ヨルシカ / n-buna Official").
  const list = await deps.youtubeMusicLists.playlist(songsList)
  const probed = await fromList(deps, artist.playlistUrl, list, artist.artist || null)
  return { ...probed, playlistTitle }
}

/**
 * A list as YouTube Music answered it: whole, and it is the answer; in part,
 * or not at all, and yt-dlp reads the whole of it, with YouTube Music's word
 * kept for each song it did name.
 */
async function fromList(
  deps: PreviewDeps,
  url: string,
  list: SongList | null,
  artist: string | null,
): Promise<Probed> {
  if (list?.complete) return { kind: 'playlist', playlistTitle: list.title, tracks: list.tracks }
  const probed = await probeWithYtDlp(deps, url)
  return {
    kind: 'playlist',
    playlistTitle: list?.title ?? probed.playlistTitle,
    tracks: withMusicDetails(probed.tracks, list?.tracks ?? [], artist),
  }
}

/**
 * yt-dlp's listing of a page, with what YouTube Music said of each song it
 * named in place of yt-dlp's reading: the artist as credited, the album, the
 * square cover, the length. The listing's order and its songs stand; a song
 * YouTube Music left out (its page hides what it cannot play from here) keeps
 * yt-dlp's title and video still, credited to `artist` when the list is one
 * artist's rather than to the channel it was uploaded by.
 */
export function withMusicDetails(
  listing: readonly ProbedTrack[],
  named: readonly ProbedTrack[],
  artist: string | null,
): ProbedTrack[] {
  const byVideo = new Map<string, ProbedTrack>()
  for (const track of named) {
    const id = youtubeVideoId(track.url)
    if (id && !byVideo.has(id)) byVideo.set(id, track)
  }
  return listing.map(track => {
    const id = youtubeVideoId(track.url)
    const detail = id ? byVideo.get(id) : undefined
    if (detail) return { ...detail, duration: detail.duration || track.duration }
    return artist ? { ...track, artist } : track
  })
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
