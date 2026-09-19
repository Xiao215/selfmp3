import { describe, expect, it } from 'vitest'

import { onTagPage } from './placePath.model'

describe('which tag page an address is', () => {
  it('matches the tag by name, whatever the case', () => {
    expect(onTagPage('/tag/chill', 'chill')).toBe(true)
    expect(onTagPage('/tag/Chill', 'chill')).toBe(true)
    expect(onTagPage('/tag/chill', 'study')).toBe(false)
  })

  it('reads a name the address encoded', () => {
    expect(onTagPage('/tag/night%20drive', 'night drive')).toBe(true)
    expect(onTagPage('/tag/night drive', 'Night Drive')).toBe(true)
    expect(onTagPage('/tag/%E4%B8%AD%E6%96%87', '中文')).toBe(true)
    // Not an escape at all: taken as it is rather than thrown on.
    expect(onTagPage('/tag/100%', '100%')).toBe(true)
  })

  it('is no other page', () => {
    expect(onTagPage('/tags', 'tags')).toBe(false)
    expect(onTagPage('/tag/', '')).toBe(false)
    expect(onTagPage('/artist/chill', 'chill')).toBe(false)
    expect(onTagPage('/library', 'chill')).toBe(false)
  })
})
