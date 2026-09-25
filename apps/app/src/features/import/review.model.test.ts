import { describe, expect, it } from 'vitest'
import type { ImportPreviewItem } from '@selfmp3/shared'
import { reviewFrom } from '@selfmp3/client'
import {
  chooseAll,
  chosenState,
  comingIn,
  countLabel,
  importLabel,
  importRequest,
  mosaicCovers,
  renameSong,
  reviewKicker,
  reviewName,
  rowState,
  toggleChosen,
} from './review.model'

const item = (n: number, extra: Partial<ImportPreviewItem> = {}): ImportPreviewItem => ({
  url: `https://www.youtube.com/watch?v=${n}`,
  title: `Song ${n}`,
  artist: 'YOASOBI',
  album: '',
  duration: 200,
  thumbnail: `https://i.test/${n}.jpg`,
  alreadyHave: false,
  waitingToUpload: false,
  inQueue: false,
  ...extra,
})

/** `P30`'s seven: the first is yours already, and everything else is coming in. */
const theBook = () =>
  reviewFrom({
    kind: 'playlist',
    playlistTitle: 'THE BOOK',
    items: [item(1, { alreadyHave: true }), item(2), item(3), item(4), item(5), item(6), item(7)],
  })

describe('reviewing a link', () => {
  it('has every song coming in except those that are yours already', () => {
    const review = theBook()
    expect(rowState(review, 0)).toBe('yours')
    expect(rowState(review, 1)).toBe('in')
    expect(comingIn(review)).toBe(6)
    expect(countLabel(review, true)).toBe('6 of 7 coming in')
    expect(countLabel(review, false)).toBe('6 of 7 in')
  })

  it('unticks a song, keeps it listed, and ticks it back', () => {
    const out = toggleChosen(theBook(), 4)
    expect(out.items).toHaveLength(7)
    expect(rowState(out, 4)).toBe('out')
    expect(countLabel(out, true)).toBe('5 of 7 coming in')
    expect(importLabel(comingIn(out))).toBe('Import 5 songs')
    expect(rowState(toggleChosen(out, 4), 4)).toBe('in')
  })

  it('ticks and unticks every song from the head, never the one that is yours', () => {
    const review = theBook()
    expect(chosenState(review)).toBe('all')
    expect(chosenState(toggleChosen(review, 4))).toBe('some')
    const none = chooseAll(review, false)
    expect(chosenState(none)).toBe('none')
    expect(comingIn(none)).toBe(0)
    const all = chooseAll(none, true)
    expect(chosenState(all)).toBe('all')
    expect(comingIn(all)).toBe(6)
    expect(rowState(all, 0)).toBe('yours')
  })

  it('never brings in a song that is yours already', () => {
    const review = theBook()
    expect(toggleChosen(review, 0)).toBe(review)
    // Nor one the server said was yours after the review was chosen by hand.
    const forced = { ...review, chosen: new Set([0, 1]) }
    expect(comingIn(forced)).toBe(1)
    expect(importRequest(forced, new Set()).items.map(song => song.url)).toEqual([
      'https://www.youtube.com/watch?v=2',
    ])
  })

  it('renames a title, an artist or an album, and nothing else', () => {
    const review = renameSong(theBook(), 2, { title: '群青' })
    expect(review.items[2]).toMatchObject({ title: '群青', artist: 'YOASOBI' })
    const both = renameSong(review, 2, { artist: 'YOASOBI feat. 合唱' })
    expect(both.items[2]).toMatchObject({ title: '群青', artist: 'YOASOBI feat. 合唱' })
    const named = renameSong(both, 2, { album: 'THE BOOK' })
    expect(named.items[2]!.album).toBe('THE BOOK')
    // A patch carrying more than a rename is only a rename.
    const sneaky = renameSong(named, 2, { title: 'x', url: 'y' } as never)
    expect(sneaky.items[2]!.url).toBe('https://www.youtube.com/watch?v=3')
  })

  it('says one song, and several', () => {
    expect(importLabel(1)).toBe('Import 1 song')
    expect(importLabel(0)).toBe('Import 0 songs')
  })

  it('is named after the playlist, the song, or how many links there were', () => {
    expect(reviewName(theBook())).toBe('THE BOOK')
    expect(reviewKicker(theBook())).toBe('From this link · playlist')
    const one = reviewFrom({ kind: 'single', playlistTitle: null, items: [item(9)] })
    expect(reviewName(one)).toBe('Song 9')
    expect(reviewKicker(one)).toBe('From this link · song')
    const pasted = reviewFrom({ kind: 'single', playlistTitle: null, items: [item(1), item(2)] })
    expect(reviewName(pasted)).toBe('2 songs')
    expect(reviewKicker(pasted)).toBe('From these links')
  })

  it('draws four different covers at most for the mosaic', () => {
    const review = reviewFrom({
      kind: 'playlist',
      playlistTitle: 'x',
      items: [item(1), item(1), item(2, { thumbnail: null }), item(3), item(4), item(5)],
    })
    expect(mosaicCovers(review)).toEqual([
      'https://i.test/1.jpg',
      'https://i.test/3.jpg',
      'https://i.test/4.jpg',
      'https://i.test/5.jpg',
    ])
  })

  it('asks for tags and never for a playlist', () => {
    const request = importRequest(toggleChosen(theBook(), 6), new Set([3]))
    expect(request.items).toHaveLength(5)
    expect(request.tagIds).toEqual([3])
    expect(request.playlistId).toBeNull()
    expect(request.createPlaylistName).toBeNull()
  })
})
