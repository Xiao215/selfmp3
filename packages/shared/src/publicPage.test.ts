import { describe, expect, it } from 'vitest'

import { plainPageAt } from './publicPage.js'

describe('plainPageAt', () => {
  it('knows each plain page by any of its addresses', () => {
    expect(plainPageAt('privacy.html')).toBe('privacy')
    expect(plainPageAt('/privacy')).toBe('privacy')
    expect(plainPageAt('/bucket.html')).toBe('bucket')
    expect(plainPageAt('install/')).toBe('install')
    expect(plainPageAt('/install/index.html')).toBe('install')
  })

  it("leaves the app's own paths alone", () => {
    for (const path of ['', '/', 'index.html', '/library', '/playlists/52', 'toString']) {
      expect(plainPageAt(path)).toBeNull()
    }
  })
})
