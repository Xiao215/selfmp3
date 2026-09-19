import { describe, expect, it } from 'vitest'

import { nudgeBody, nudgeTitle } from './artistNudge.model'

describe('the nudge for a tag named like an artist', () => {
  it('names the tag as it was typed', () => {
    expect(nudgeTitle('  yorushika ')).toBe('New tag: "yorushika"')
  })

  it('says what the artist already has, in the artist’s own spelling', () => {
    expect(nudgeBody({ name: 'Yorushika', songIds: Array.from({ length: 20 }, (_, i) => i) })).toBe(
      'Yorushika is already an artist here, with their 20 songs. A tag is for songs you choose, whoever made them.',
    )
    expect(nudgeBody({ name: 'Aimer', songIds: [4] })).toContain('with their 1 song.')
  })
})
