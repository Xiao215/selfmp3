import type {
  ImportPreview,
  ImportPreviewItem,
  Library,
  Playlist,
  Song,
  Tag,
} from '@selfmp3/shared'
import type { KeyValueStore } from '../src/background/store.js'

/**
 * A small library and the links the specs open, shared by the fake server and
 * the unit tests so both describe the same songs.
 */

export const IDOL_URL = 'https://www.youtube.com/watch?v=ZRtdQ81jPUQ'
export const IDOL_TAB_TITLE = 'YOASOBI「アイドル」Official Music Video - YouTube'
export const HELLO_URL = 'https://www.youtube.com/watch?v=YQHsXMglC9A'
/** A video the fake server says it cannot read. */
export const PRIVATE_URL = 'https://www.youtube.com/watch?v=PRIVATEvid0'
export const PLAYLIST_URL = 'https://music.youtube.com/playlist?list=PLcitypopnightdrive'

export function song(fields: Partial<Song> & Pick<Song, 'id' | 'title' | 'artist'>): Song {
  return {
    path: `${fields.artist} - ${fields.title}/${fields.title}.m4a`,
    album: '',
    albumArtist: '',
    trackNo: null,
    year: null,
    duration: 200,
    sizeBytes: 4_000_000,
    mime: 'audio/mp4',
    hasArt: false,
    rev: '1',
    coverTone: null,
    lyricsKind: 'none',
    instrumental: false,
    playCount: 0,
    skipCount: 0,
    loved: false,
    sourceUrl: null,
    lastPlayedAt: null,
    addedAt: '2026-09-01 12:00:00',
    missing: false,
    tagIds: [],
    audioFeatures: null,
    ...fields,
  }
}

const tag = (id: number, name: string, hue: number): Tag => ({ id, name, hue, songCount: 3 })

const playlist = (id: number, name: string, kind: Playlist['kind'], pinned: boolean): Playlist => ({
  id,
  name,
  description: '',
  kind,
  rules: null,
  songCount: 1,
  totalDuration: 200,
  pinned,
  createdAt: '2026-09-01 12:00:00',
  updatedAt: '2026-09-01 12:00:00',
  lastPlayedAt: null,
})

export function fixtureLibrary(): Library {
  return {
    songs: [
      song({
        id: 1,
        title: 'Hello',
        artist: 'Adele',
        sourceUrl: HELLO_URL,
        playCount: 41,
        addedAt: '2026-08-12 10:00:00',
      }),
      song({ id: 2, title: 'Dropped into the folder', artist: 'Someone' }),
    ],
    tags: [tag(1, 'new', 150), tag(2, 'j-pop', 330)],
    playlists: [playlist(1, 'Gym rotation', 'manual', true), playlist(2, 'Loved', 'live', false)],
    version: 1,
    generatedAt: '2026-09-15 12:00:00',
  }
}

const previewItem = (
  url: string,
  title: string,
  artist: string,
  alreadyHave = false,
): ImportPreviewItem => ({
  url,
  title,
  artist,
  album: '',
  duration: 213,
  thumbnail: null,
  alreadyHave,
})

/** What the fake server's `/api/import/preview` answers for a link: a status and a body. */
export function previewFor(url: string): {
  status: number
  body: ImportPreview | { error: string; code: string }
} {
  if (url.includes('PRIVATEvid0')) {
    return {
      status: 422,
      body: {
        error: 'This video is private. Sign YouTube in under Settings → Importing, then try again.',
        code: 'unprocessable',
      },
    }
  }
  if (url.includes('list=')) {
    return {
      status: 200,
      body: {
        kind: 'playlist',
        playlistTitle: 'City pop night drive',
        items: [
          previewItem(
            'https://music.youtube.com/watch?v=aaaaaaaaaa1',
            'Plastic Love',
            'Mariya Takeuchi',
          ),
          previewItem(
            'https://music.youtube.com/watch?v=aaaaaaaaaa2',
            'Mayonaka no Door',
            'Miki Matsubara',
          ),
          previewItem(
            'https://music.youtube.com/watch?v=aaaaaaaaaa3',
            'Ride on Time',
            'Tatsuro Yamashita',
            true,
          ),
        ],
      },
    }
  }
  if (url.includes('YQHsXMglC9A')) {
    return {
      status: 200,
      body: {
        kind: 'single',
        playlistTitle: null,
        items: [previewItem(url, 'Hello', 'Adele', true)],
      },
    }
  }
  return {
    status: 200,
    body: { kind: 'single', playlistTitle: null, items: [previewItem(url, 'アイドル', 'YOASOBI')] },
  }
}

/** A store that forgets when the test ends. */
export function memoryStore(): KeyValueStore {
  const values = new Map<string, unknown>()
  return {
    read: key => Promise.resolve(values.get(key) ?? null),
    write: (key, value) => {
      values.set(key, value)
      return Promise.resolve()
    },
    remove: key => {
      values.delete(key)
      return Promise.resolve()
    },
    // One JavaScript context, so the three steps need nothing around them.
    update: (key, change) => {
      const next = change(values.get(key) ?? null)
      values.set(key, next)
      return Promise.resolve(next)
    },
  }
}
