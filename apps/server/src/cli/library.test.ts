import type { HubWorkspace } from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'
import { CliUsageError } from './args.js'
import { pickLibrary } from './library.js'

const workspace = (id: string, email: string | null, songs = 0): HubWorkspace => ({
  id,
  email,
  songs,
  connected: true,
  joinedAt: '2026-10-12T00:00:00.000Z',
})

const mine = workspace('aaaaaaaaaaaaaaaa', 'me@example.com', 12)
const theirs = workspace('bbbbbbbbbbbbbbbb', 'Friend@Example.com', 1)

describe('pickLibrary', () => {
  it('needs no name for the only library', () => {
    expect(pickLibrary([mine], null)).toBeNull()
    expect(pickLibrary([workspace('local', null)], null)).toBeNull()
  })

  it('takes an id, or an email in any case', () => {
    expect(pickLibrary([mine, theirs], 'bbbbbbbbbbbbbbbb')).toBe(theirs.id)
    expect(pickLibrary([mine, theirs], 'friend@example.com')).toBe(theirs.id)
    expect(pickLibrary([mine], 'me@example.com')).toBe(mine.id)
  })

  it('lists them rather than guessing when several and none named', () => {
    const asked = (): string | null => pickLibrary([mine, theirs], null)
    expect(asked).toThrow(CliUsageError)
    expect(asked).toThrow(
      'this server works for 2 libraries; say which with --library <id or email>:\n' +
        '    aaaaaaaaaaaaaaaa  me@example.com  12 songs\n' +
        '    bbbbbbbbbbbbbbbb  Friend@Example.com  1 song',
    )
  })

  it('says so when the name matches none, or one email matches two', () => {
    expect(() => pickLibrary([mine, theirs], 'nobody@example.com')).toThrow(
      /^no library here is nobody@example.com; these are:\n {4}aaaa/,
    )
    const again = workspace('cccccccccccccccc', 'me@example.com')
    expect(() => pickLibrary([mine, again], 'me@example.com')).toThrow(
      /^2 libraries here are me@example.com; say which by id:/,
    )
  })

  it('says when it works for nobody yet', () => {
    expect(() => pickLibrary([], null)).toThrow(/no libraries yet/)
    expect(() => pickLibrary([], 'me@example.com')).toThrow(/no libraries yet/)
  })
})
