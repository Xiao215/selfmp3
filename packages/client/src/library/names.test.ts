import { describe, expect, it } from 'vitest'

import { uniqueName } from './names.js'

describe('uniqueName', () => {
  it('keeps the name while nothing has it', () => {
    expect(uniqueName('New playlist', ['Morning'])).toBe('New playlist')
  })

  it('counts on from 2 past the names already taken', () => {
    expect(uniqueName('New playlist', ['New playlist', 'New playlist 2'])).toBe('New playlist 3')
  })

  it('fills the first gap rather than the next number up', () => {
    expect(uniqueName('Mix', ['Mix', 'Mix 3'])).toBe('Mix 2')
  })
})
