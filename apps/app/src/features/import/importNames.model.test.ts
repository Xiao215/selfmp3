import { describe, expect, it } from 'vitest'
import { reviewFrom } from '@selfmp3/client'
import type { ImportPreviewItem } from '@selfmp3/shared'
import { rowsToAsk, suggestionFor, suggestionsByRow, suggestionWords } from './importNames.model'

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
    expect(suggestionWords(idol)).toBe('アイドル · YOASOBI')
    expect(suggestionWords({ title: 'a', artist: '', album: 'b' })).toBe('a · Unknown artist · b')
  })
})
