import type { AskAnswer, Song } from '@selfmp3/shared'
import { sameRecording, sameTitle } from './names.js'
import { NO_STEPS, type Steps } from './progress.js'

/**
 * Music you don't have yet (docs/features/ai.md, "Getting music"): "get the
 * rest of the Liyue OST", "download 春泥棒". The router says what to look for
 * and whether it is an album or a song; 网易云 is searched, and each of the
 * few it lists says how much of it you have already, a song at a time: the
 * same recording as catalogue names count it (`sameRecording`), and the same
 * title too, since an album holds many songs by one artist of about one
 * length. Choosing one opens Import with its link, whose review does the
 * rest: the songs you have, and a song 网易云 only previews found on YouTube
 * instead.
 */

/** How many albums or songs are offered. */
const OFFERED = 4

interface Track {
  readonly title: string
  readonly artist: string
  readonly album: string
  readonly duration: number
  readonly url: string
  readonly thumbnail: string | null
}

export interface MusicCatalogue {
  readonly albums: (words: string) => Promise<
    readonly {
      id: string
      url: string
      title: string
      artist: string
      tracks: number
      cover: string | null
    }[]
  >
  readonly albumTracks: (id: string) => Promise<readonly Track[]>
  readonly songs: (words: string) => Promise<readonly Track[]>
}

type GetMusic = Extract<AskAnswer, { kind: 'getMusic' }>

/** Whether some song of yours is this catalogue track. */
function have(songs: readonly Song[], track: Track): boolean {
  const listed = {
    source: '网易云' as const,
    title: track.title,
    artist: track.artist,
    album: track.album,
    seconds: track.duration || null,
  }
  return songs.some(song => sameRecording(song, listed) && sameTitle(song, listed))
}

export async function getMusic(
  deps: { readonly songs: () => Song[]; readonly music: MusicCatalogue },
  wanted: { readonly words: string; readonly kind: 'album' | 'song' },
  steps: Steps = NO_STEPS,
): Promise<GetMusic> {
  const songs = deps.songs()
  const words = wanted.words.trim()
  steps.begin(`Looking for “${words}” on 网易云`)
  if (wanted.kind === 'album') {
    const albums = (await deps.music.albums(words)).slice(0, OFFERED)
    steps.begin('Checking which songs you have')
    const items = await Promise.all(
      albums.map(async album => {
        const tracks = await deps.music.albumTracks(album.id)
        return {
          kind: 'album' as const,
          title: album.title,
          artist: album.artist,
          url: album.url,
          cover: album.cover,
          tracks: tracks.length || album.tracks,
          have: tracks.filter(track => have(songs, track)).length,
        }
      }),
    )
    steps.done()
    return { kind: 'getMusic', words, items }
  }
  const found = (await deps.music.songs(words)).slice(0, OFFERED)
  steps.done()
  return {
    kind: 'getMusic',
    words,
    items: found.map(track => ({
      kind: 'song' as const,
      title: track.title,
      artist: track.artist,
      url: track.url,
      cover: track.thumbnail,
      tracks: 1,
      have: have(songs, track) ? 1 : 0,
    })),
  }
}
