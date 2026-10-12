import { extractUrls, isNeteaseUrl, isYouTubeUrl, type RoomSong } from '@selfmp3/shared'

/**
 * A link someone pasted into a room, as a song the room can carry
 * (docs/features/listen-together.md, "Links"). It plays through the host's
 * server, which only plays YouTube's and 网易云's.
 *
 * A guest has no server to ask what the link is, so a YouTube link's name and
 * picture come from YouTube's own oEmbed answer, which any page may ask for;
 * anything else is named by its address until it plays.
 */
export function playableLink(text: string): string | null {
  const url = extractUrls(text, 1)[0]
  return url && (isYouTubeUrl(url) || isNeteaseUrl(url)) ? url : null
}

export async function lookUpLink(url: string): Promise<RoomSong> {
  const song: RoomSong = {
    uid: null,
    title: isNeteaseUrl(url) ? '网易云 song' : 'YouTube video',
    artist: '',
    album: '',
    duration: 0,
    audio: null,
    cover: null,
    coverTone: null,
    lyrics: null,
    sourceUrl: url,
    link: url,
    artwork: null,
  }
  if (!isYouTubeUrl(url)) return song
  try {
    const response = await fetch(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`,
    )
    if (!response.ok) return song
    const said = (await response.json()) as {
      title?: unknown
      author_name?: unknown
      thumbnail_url?: unknown
    }
    return {
      ...song,
      title: typeof said.title === 'string' && said.title ? said.title.slice(0, 300) : song.title,
      artist:
        typeof said.author_name === 'string'
          ? said.author_name.replace(/ - Topic$/, '').slice(0, 300)
          : '',
      artwork:
        typeof said.thumbnail_url === 'string' && /^https:\/\//.test(said.thumbnail_url)
          ? said.thumbnail_url
          : null,
    }
  } catch {
    return song
  }
}
