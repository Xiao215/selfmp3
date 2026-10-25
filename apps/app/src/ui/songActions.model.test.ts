import { describe, expect, it } from 'vitest'

import { songActions } from './songActions.model'

const one = {
  count: 1,
  loved: 0,
  held: 0,
  installed: true,
  roomSong: false,
  inPlaylist: false,
  nowPlaying: false,
  place: 'phone',
  shareable: false,
  detailsInMenu: false,
}

const ids = (facts: typeof one): string[] => songActions(facts).map(action => action.id)
const labels = (facts: typeof one): string[] => songActions(facts).map(action => action.label)

describe('what can be done to songs', () => {
  it('offers one song the menu it always had, in its order', () => {
    expect(labels(one)).toEqual([
      'Tags…',
      'Add to playlist',
      'Add to Up next',
      'Play similar songs',
      'Download',
      'Song details',
      'Delete from library…',
    ])
  })

  // One list for one song and for many: the bar's More used to say "Tags…"
  // where the menu said "Tags", and download by another path.
  it('offers many songs the same things by the same names, with their counts', () => {
    expect(labels({ ...one, count: 3, loved: 1, held: 2 })).toEqual([
      'Like the rest',
      'Unlike 1',
      'Tags…',
      'Add to playlist',
      'Add to Up next',
      'Download the rest',
      'Remove 2 from this phone',
      'Delete 3 songs from library…',
    ])
    expect(labels({ ...one, count: 2, loved: 2, held: 2 })).toContain('Unlike all')
    expect(labels({ ...one, count: 2, loved: 2, held: 2 })).toContain('Remove from this phone')
    expect(labels({ ...one, count: 2 })).toContain('Like all')
    expect(labels({ ...one, count: 2 })).toContain('Download all')
  })

  it('keeps nothing on a browser', () => {
    expect(ids({ ...one, installed: false })).not.toContain('download')
    expect(ids({ ...one, installed: false, held: 1 })).not.toContain('removeDownload')
  })

  it('takes a song out of the playlist it was opened from', () => {
    expect(ids({ ...one, inPlaylist: true }).slice(-2)).toEqual(['removeFromPlaylist', 'delete'])
  })

  it('leaves out what Now Playing shows itself, and Up next for the song playing', () => {
    expect(ids({ ...one, nowPlaying: true })).toEqual([
      'addToPlaylist',
      'playSimilar',
      'download',
      'delete',
    ])
  })

  it('keeps Song details for a phone’s Now Playing, which has no door of its own to it', () => {
    expect(ids({ ...one, nowPlaying: true, detailsInMenu: true })).toEqual([
      'addToPlaylist',
      'playSimilar',
      'download',
      'details',
      'delete',
    ])
  })

  it('shares songs as a link once signed in with a bucket, one song or many', () => {
    expect(labels({ ...one, shareable: true })).toEqual([
      'Tags…',
      'Add to playlist',
      'Add to Up next',
      'Play similar songs',
      'Share link',
      'Download',
      'Song details',
      'Delete from library…',
    ])
    expect(ids({ ...one, count: 3, shareable: true })).toContain('share')
    expect(ids({ ...one, nowPlaying: true, shareable: true })).toContain('share')
  })

  it('offers nothing of the library for a friend’s song in a room', () => {
    expect(songActions({ ...one, roomSong: true, shareable: true })).toEqual([])
    expect(songActions({ ...one, count: 0 })).toEqual([])
  })
})
