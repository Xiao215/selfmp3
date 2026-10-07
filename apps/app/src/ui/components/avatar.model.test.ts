import { describe, expect, it } from 'vitest'
import { accountInitials } from './avatar.model'

/**
 * What the round mark falls back to without a picture, the way every other
 * app does it: it has to read as a person, not a puzzle.
 */
describe('accountInitials', () => {
  const named = (name: string | null): string | null =>
    accountInitials({ name, email: 'xiao@example.com' })

  it('takes one letter from each of the first two words', () => {
    expect(named('Xiao Zhang')).toBe('XZ')
    expect(named('Ada')).toBe('A')
    // A middle name is a third word; two letters is the shape of the mark.
    expect(named('Ada Byron Lovelace')).toBe('AB')
    expect(named('  yuki  tanaka ')).toBe('YT')
    expect(named('ヨルシカ')).toBe('ヨ')
  })

  it('falls back to the address, then to nothing', () => {
    expect(named(null)).toBe('X')
    expect(named('   ')).toBe('X')
    expect(accountInitials({ name: null, email: '' })).toBeNull()
    expect(accountInitials(null)).toBeNull()
  })
})
