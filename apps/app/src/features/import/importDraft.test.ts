import { afterEach, describe, expect, it } from 'vitest'
import { draftFor, patchDraft, resetImportDraft } from './importDraft'

afterEach(resetImportDraft)

describe('the import draft', () => {
  it('keeps what was typed and chosen for the next screen that asks', () => {
    patchDraft('own', { links: 'https://y.test/1', tagIds: new Set([3]) })
    patchDraft('own', { playlistId: 7 })
    expect(draftFor('own')).toMatchObject({
      links: 'https://y.test/1',
      tagIds: new Set([3]),
      playlistId: 7,
      createPlaylist: false,
    })
  })

  it("does not show one server's draft for another, whose ids differ", () => {
    patchDraft('own', { links: 'https://y.test/1', playlistId: 7 })
    expect(draftFor('http://192.168.1.20:4600')).toMatchObject({ links: '', playlistId: 0 })
    // Writing for the other server starts it afresh rather than mixing the two.
    patchDraft('http://192.168.1.20:4600', { links: 'https://y.test/2' })
    expect(draftFor('http://192.168.1.20:4600')).toMatchObject({
      links: 'https://y.test/2',
      playlistId: 0,
    })
    expect(draftFor('own').links).toBe('')
  })
})
