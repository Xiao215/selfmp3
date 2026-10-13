import { describe, expect, it } from 'vitest'
import type { DoormanAccess } from '@selfmp3/shared'
import { anyoneHint, withEmail, withoutEmail } from './access.model'

const ACCESS: DoormanAccess = {
  anyone: false,
  emails: ['friend@example.com'],
  owners: ['me@example.com'],
}

describe('Settings › Who can sign in', () => {
  it('adds an address as Google would write it', () => {
    expect(withEmail(ACCESS, '  New@Example.com ')).toEqual({
      update: { anyone: false, emails: ['friend@example.com', 'new@example.com'] },
    })
  })

  it('says what is wrong rather than sending it', () => {
    expect(withEmail(ACCESS, 'nope')).toEqual({ problem: 'That isn’t an email address.' })
    expect(withEmail(ACCESS, 'Me@example.com')).toEqual({ problem: 'Owners can always sign in.' })
    expect(withEmail(ACCESS, 'friend@example.com')).toEqual({
      problem: 'They’re already on the list.',
    })
  })

  it('removes one, keeping the switch as it is', () => {
    expect(withoutEmail({ ...ACCESS, anyone: true }, 'friend@example.com')).toEqual({
      anyone: true,
      emails: [],
    })
  })

  it('says what the switch means now', () => {
    expect(anyoneHint(ACCESS)).toMatch(/^Off/)
    expect(anyoneHint({ ...ACCESS, anyone: true })).toMatch(/^Any Google account/)
  })
})
