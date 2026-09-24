import { describe, expect, it } from 'vitest'
import type { ImportPreviewItem } from '@selfmp3/shared'
import { reviewFrom } from '@selfmp3/client'
import type { PrefStore } from '../../ports/prefs'
import { IMPORT_DRAFT_KEY, parseImportDraft } from './importDraft.model'
import { createImportDraftStore } from './importDraft.store'
import { comingIn, rowState } from './review.model'

/** The `prefs` port with nothing behind it but a map: what a device remembers, without the device. */
function memoryPrefs(): PrefStore & { readonly kept: Map<string, string> } {
  const kept = new Map<string, string>()
  return {
    kept,
    get: key => kept.get(key) ?? null,
    set: (key, value) => {
      kept.set(key, value)
    },
  }
}

const item = (n: number, extra: Partial<ImportPreviewItem> = {}): ImportPreviewItem => ({
  url: `https://www.youtube.com/watch?v=${n}`,
  title: `Song ${n}`,
  artist: 'YOASOBI',
  album: 'THE BOOK',
  duration: 200 + n,
  thumbnail: null,
  alreadyHave: false,
  waitingToUpload: false,
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
    const { draftFor, patchDraft } = createImportDraftStore(memoryPrefs())
    patchDraft('own', { links: 'https://y.test/1', tagIds: new Set([3]) })
    expect(draftFor('own')).toMatchObject({ links: 'https://y.test/1', tagIds: new Set([3]) })
  })

  it("does not show one source's draft for another, whose ids differ", () => {
    const { draftFor, patchDraft } = createImportDraftStore(memoryPrefs())
    patchDraft('own', { links: 'https://y.test/1', tagIds: new Set([3]) })
    expect(draftFor('cloud')).toMatchObject({ links: '', tagIds: new Set() })
    // Writing for the other source starts it afresh rather than mixing the two.
    patchDraft('cloud', { links: 'https://y.test/2' })
    expect(draftFor('cloud')).toMatchObject({ links: 'https://y.test/2', tagIds: new Set() })
    expect(draftFor('own').links).toBe('')
  })

  it('unticks a song and ticks it back, and the review page finds it so', () => {
    const { draftFor, patchDraft, toggleChosenIn, chooseAllIn } =
      createImportDraftStore(memoryPrefs())
    patchDraft('own', { review: aReview() })
    toggleChosenIn('own', 2)
    const review = draftFor('own').review!
    expect(rowState(review, 2)).toBe('out')
    expect(comingIn(review)).toBe(1)

    toggleChosenIn('own', 2)
    expect(rowState(draftFor('own').review!, 2)).toBe('in')
    expect(comingIn(draftFor('own').review!)).toBe(2)

    chooseAllIn('own', false)
    expect(comingIn(draftFor('own').review!)).toBe(0)
    chooseAllIn('own', true)
    expect(comingIn(draftFor('own').review!)).toBe(2)
  })

  it('cannot bring in a song that is yours already', () => {
    const { draftFor, patchDraft, toggleChosenIn } = createImportDraftStore(memoryPrefs())
    patchDraft('own', { review: aReview() })
    toggleChosenIn('own', 0)
    expect(rowState(draftFor('own').review!, 0)).toBe('yours')
    expect(comingIn(draftFor('own').review!)).toBe(2)
  })

  it('keeps a rename, title and artist apart, and leaves the url alone', () => {
    const { draftFor, patchDraft, renameIn } = createImportDraftStore(memoryPrefs())
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
    const { draftFor, toggleChosenIn, chooseAllIn, renameIn } =
      createImportDraftStore(memoryPrefs())
    toggleChosenIn('own', 0)
    chooseAllIn('own', false)
    renameIn('own', 0, { title: 'x' })
    expect(draftFor('own').review).toBeNull()
  })

  it('is still there after a reload, ticks and renames and all', () => {
    const prefs = memoryPrefs()
    const before = createImportDraftStore(prefs)
    before.patchDraft('cloud', {
      links: 'https://y.test/list',
      review: aReview(),
      tagIds: new Set([3, 7]),
    })
    before.toggleChosenIn('cloud', 2)
    before.renameIn('cloud', 1, { title: '群青' })

    // A reload: a fresh store over what the device kept.
    const after = createImportDraftStore(prefs)
    const draft = after.draftFor('cloud')
    expect(draft.links).toBe('https://y.test/list')
    expect(draft.tagIds).toEqual(new Set([3, 7]))
    expect(draft.review!.playlistTitle).toBe('THE BOOK')
    expect(draft.review!.items[1]!.title).toBe('群青')
    expect(rowState(draft.review!, 2)).toBe('out')
    expect(comingIn(draft.review!)).toBe(1)
    // And it is one object until something changes, as a store React reads must be.
    expect(after.current()).toBe(after.current())
  })

  it('starts empty over anything it cannot read, rather than failing to start', () => {
    for (const raw of [null, '', 'not json', '{"source":"http://192.168.1.20:4600"}', '[]']) {
      expect(parseImportDraft(raw)).toBeNull()
    }
    const prefs = memoryPrefs()
    prefs.set(IMPORT_DRAFT_KEY, 'not json')
    expect(createImportDraftStore(prefs).draftFor('own')).toMatchObject({ links: '', review: null })
  })

  it('drops a tick that points past the songs it was kept with', () => {
    const prefs = memoryPrefs()
    createImportDraftStore(prefs).patchDraft('own', { review: aReview() })
    const stored = JSON.parse(prefs.kept.get(IMPORT_DRAFT_KEY)!) as { review: { chosen: number[] } }
    stored.review.chosen.push(9)
    prefs.set(IMPORT_DRAFT_KEY, JSON.stringify(stored))
    expect(comingIn(createImportDraftStore(prefs).draftFor('own').review!)).toBe(2)
  })

  it("forgets a source's draft, and only that source's", () => {
    const prefs = memoryPrefs()
    const store = createImportDraftStore(prefs)
    store.patchDraft('cloud', { links: 'https://y.test/1', review: aReview() })
    store.forget('own')
    expect(store.draftFor('cloud').review).not.toBeNull()
    store.forget('cloud')
    expect(store.draftFor('cloud')).toMatchObject({ links: '', review: null })
    // Forgotten on the device too, not only until the next launch.
    expect(createImportDraftStore(prefs).draftFor('cloud').review).toBeNull()
  })
})
