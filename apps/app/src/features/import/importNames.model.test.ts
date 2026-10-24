import { describe, expect, it } from 'vitest'
import { reviewFrom } from '@selfmp3/client'
import type { ImportPreviewItem } from '@selfmp3/shared'
import {
  changesWords,
  rowsToAsk,
  suggestionChanges,
  suggestionFor,
  suggestionsByRow,
} from './importNames.model'

const item = (title: string, over: Partial<ImportPreviewItem> = {}): ImportPreviewItem => ({
  url: `https://youtu.be/${title}`,
  title,
  artist: 'Ayase Official',
  album: '',
  duration: 213,
  thumbnail: null,
  alreadyHave: false,
  waitingToUpload: false,
  inQueue: false,
  source: 'youtube',
  netease: null,
  youtube: null,
  ...over,
})

const review = reviewFrom({
  kind: 'playlist',
  playlistTitle: 'YOASOBI hits',
  from: 'youtube',
  items: [
    item('夜に駆ける', { alreadyHave: true }),
    item('YOASOBI「アイドル」'),
    item(''),
    item('群青', { artist: 'YOASOBI' }),
  ],
})

describe('an import’s names, as the review offers them', () => {
  it('asks only about songs coming in that have a name', () => {
    expect(rowsToAsk(review).map(row => [row.index, row.title])).toEqual([
      [1, 'YOASOBI「アイドル」'],
      [3, '群青'],
    ])
  })

  it('puts each suggestion on its row, for as long as the row keeps the names it was read with', () => {
    const asked = rowsToAsk(review)
    const byRow = suggestionsByRow(asked, {
      suggestions: [
        { row: 0, title: 'アイドル', artist: 'YOASOBI', album: '', why: 'Artist in the title' },
        // Not a row that was asked about.
        { row: 7, title: 'x', artist: 'y', album: '', why: 'z' },
      ],
    })
    expect([...byRow.keys()]).toEqual([1])
    const idol = byRow.get(1)!
    expect(suggestionFor(review.items[1]!, idol)).toBe(idol)
    // Fixed by hand, or the suggestion taken: nothing left to offer.
    expect(suggestionFor({ ...review.items[1]!, title: 'アイドル' }, idol)).toBeUndefined()
  })

  it('shows only the names a suggestion changes, and says when one would be left empty', () => {
    const from = { title: '恋風 - Koikaze', artist: 'Lilas', album: 'Laugh' }
    const romaji = { title: '恋風', artist: 'Lilas', album: 'Laugh', why: 'Romanization', from }
    expect(suggestionChanges(romaji)).toEqual([
      { name: 'title', label: 'Title', words: '恋風', empty: false },
    ])
    const changes = suggestionChanges({ ...romaji, artist: 'Lilas Ikuta', album: '' })
    expect(changes.map(change => [change.name, change.words, change.empty])).toEqual([
      ['title', '恋風', false],
      ['artist', 'Lilas Ikuta', false],
      ['album', 'No album', true],
    ])
    expect(changesWords(changes)).toBe('title 恋風, artist Lilas Ikuta, album No album')
    // A suggestion that changes nothing is not offered.
    expect(suggestionFor(from, { ...from, why: 'Looks right', from })).toBeUndefined()
  })
})
