import { afterEach, describe, expect, it } from 'vitest'
import type { ImportPreviewItem } from '@selfmp3/shared'
import { reviewFrom } from '@selfmp3/client'
import { draftFor, leaveOutIn, patchDraft, renameIn, resetImportDraft } from './importDraft'
import { comingIn, rowState } from './review.model'

afterEach(resetImportDraft)

const item = (n: number, extra: Partial<ImportPreviewItem> = {}): ImportPreviewItem => ({
  url: `https://www.youtube.com/watch?v=${n}`,
  title: `Song ${n}`,
  artist: 'YOASOBI',
  album: 'THE BOOK',
  duration: 200 + n,
  thumbnail: null,
  alreadyHave: false,
  ...extra,
})

const aReview = () =>
  reviewFrom({
    kind: 'playlist',
    playlistTitle: 'THE BOOK',
    items: [item(1, { alreadyHave: true }), item(2), item(3)],
  })

describe('the import draft', () => {
  it('keeps what was typed and chosen for the next screen that asks', () => {
    patchDraft('own', { links: 'https://y.test/1', tagIds: new Set([3]) })
    expect(draftFor('own')).toMatchObject({ links: 'https://y.test/1', tagIds: new Set([3]) })
  })

  it("does not show one server's draft for another, whose ids differ", () => {
    patchDraft('own', { links: 'https://y.test/1', tagIds: new Set([3]) })
    expect(draftFor('http://192.168.1.20:4600')).toMatchObject({ links: '', tagIds: new Set() })
    // Writing for the other server starts it afresh rather than mixing the two.
    patchDraft('http://192.168.1.20:4600', { links: 'https://y.test/2' })
    expect(draftFor('http://192.168.1.20:4600')).toMatchObject({
      links: 'https://y.test/2',
      tagIds: new Set(),
    })
    expect(draftFor('own').links).toBe('')
  })

  it('leaves a song out and brings it back, and the review page finds it so', () => {
    patchDraft('own', { review: aReview() })
    leaveOutIn('own', 2)
    const review = draftFor('own').review!
    expect(rowState(review, 2)).toBe('out')
    expect(comingIn(review)).toBe(1)

    leaveOutIn('own', 2)
    expect(rowState(draftFor('own').review!, 2)).toBe('in')
    expect(comingIn(draftFor('own').review!)).toBe(2)
  })

  it('cannot bring in a song that is yours already', () => {
    patchDraft('own', { review: aReview() })
    leaveOutIn('own', 0)
    expect(rowState(draftFor('own').review!, 0)).toBe('yours')
    expect(comingIn(draftFor('own').review!)).toBe(2)
  })

  it('keeps a rename, title and artist apart, and leaves the url alone', () => {
    patchDraft('own', { review: aReview() })
    renameIn('own', 1, { title: '群青' })
    renameIn('own', 1, { artist: 'YOASOBI feat. 合唱' })
    expect(draftFor('own').review!.items[1]).toMatchObject({
      url: 'https://www.youtube.com/watch?v=2',
      title: '群青',
      artist: 'YOASOBI feat. 合唱',
      album: 'THE BOOK',
    })
    expect(draftFor('own').review!.items[2]!.title).toBe('Song 3')
  })

  it('does nothing to a draft with no review', () => {
    leaveOutIn('own', 0)
    renameIn('own', 0, { title: 'x' })
    expect(draftFor('own').review).toBeNull()
  })
})
