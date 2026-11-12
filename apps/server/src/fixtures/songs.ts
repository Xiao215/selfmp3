import type { NewSong } from '../repositories/songs.js'

/**
 * A song's row as the scanner would add it, with only what a test cares about
 * said: a one-second m4a with no tags, art or lyrics, at `<title>.m4a`.
 */
export function newSong(fields: Partial<NewSong> & Pick<NewSong, 'title'>): NewSong {
  return {
    path: `${fields.title}.m4a`,
    artist: '',
    album: '',
    albumArtist: '',
    trackNo: null,
    year: null,
    duration: 1,
    sizeBytes: 1,
    mime: 'audio/mp4',
    mtimeMs: 0,
    hasArt: false,
    artExt: null,
    lyricsKind: 'none',
    sourceUrl: null,
    ...fields,
  }
}
