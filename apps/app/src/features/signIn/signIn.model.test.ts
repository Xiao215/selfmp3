import { describe, expect, it } from 'vitest'
import { DoormanError } from '@selfmp3/shared'

import {
  afterCheck,
  copyFor,
  endedMessage,
  LINK_GRACE_MS,
  refusalMessage,
  signInFailure,
  TOOK_TOO_LONG,
  type SignInStage,
} from './signIn.model'

/**
 * The sign-in's rules. Worth tests rather than a glance: the grace decides
 * whether a sign-in that is about to work flashes a failure, and the copy is
 * what has to stay free of a code nobody is ever shown.
 */
describe('afterCheck', () => {
  const waiting: SignInStage = { kind: 'waiting', googleDoneAt: null }

  it('keeps waiting while Google is still open', () => {
    expect(afterCheck(waiting, 'pending', 1_000)).toBe(waiting)
  })

  it('notes when Google finished, and gives the link a moment to arrive', () => {
    const done = afterCheck(waiting, 'done', 1_000)
    expect(done).toEqual({ kind: 'waiting', googleDoneAt: 1_000 })
    expect(afterCheck(done, 'done', 1_000 + LINK_GRACE_MS - 1)).toBe(done)
  })

  it('says the link did not come back once the moment has passed', () => {
    const done: SignInStage = { kind: 'waiting', googleDoneAt: 1_000 }
    expect(afterCheck(done, 'done', 1_000 + LINK_GRACE_MS)).toEqual({ kind: 'lost' })
  })

  it('starts over when the attempt is gone', () => {
    expect(afterCheck(waiting, 'gone', 1_000)).toEqual({ kind: 'idle', message: TOOK_TOO_LONG })
  })

  it('leaves every other stage alone, whatever the doorman says', () => {
    const others: SignInStage[] = [
      { kind: 'claiming' },
      { kind: 'lost' },
      { kind: 'idle', message: null },
    ]
    for (const stage of others) {
      for (const attempt of ['gone', 'pending', 'done'] as const) {
        expect(afterCheck(stage, attempt, 99_000)).toBe(stage)
      }
    }
  })
})

describe('copyFor', () => {
  const stages: SignInStage[] = [
    { kind: 'idle', message: null },
    { kind: 'waiting', googleDoneAt: null },
    { kind: 'lost' },
    { kind: 'claiming' },
  ]
  const words = stages.flatMap(stage => Object.values(copyFor(stage)))

  it('never asks for a code', () => {
    expect(words.filter(text => text !== null && /code/i.test(text))).toEqual([])
  })

  it('names no device, because every device shows it', () => {
    expect(words.filter(text => text !== null && /phone|mac|computer/i.test(text))).toEqual([])
  })
})

describe('signInFailure', () => {
  const refused = new TypeError('Failed to fetch')

  it('says a local address cannot sign in, rather than "Failed to fetch"', () => {
    for (const origin of ['http://localhost:4601', 'http://127.0.0.1:4621', 'http://localhost']) {
      expect(signInFailure(refused, origin)).toMatch(/this computer’s own address/)
    }
  })

  it('knows the doorman client’s wrapping of the same failure', () => {
    const wrapped = new DoormanError(0, 'unreachable', 'Failed to fetch')
    expect(signInFailure(wrapped, 'http://localhost:4621')).toMatch(/own address/)
    const none = new DoormanError(0, 'no_doorman', 'No doorman.')
    expect(signInFailure(none, 'http://localhost:4621')).toBe('No doorman.')
  })

  it('blames the connection anywhere else', () => {
    expect(signInFailure(refused, 'https://xiao215.github.io')).toMatch(/connection/)
    expect(signInFailure(refused, null)).toMatch(/connection/)
    // A name that only starts like a local one is not local.
    expect(signInFailure(refused, 'http://localhost.example.com')).toMatch(/connection/)
  })

  it('passes the doorman’s own words through', () => {
    expect(signInFailure(new Error('Google said no.'), 'http://localhost:4601')).toBe(
      'Google said no.',
    )
  })
})

describe('a sign-in that did not go through', () => {
  it('names the account that is not allowed, and the way on', () => {
    expect(refusalMessage({ reason: 'not-allowed', email: 'mallory@bugbash.test' })).toBe(
      'mallory@bugbash.test isn’t allowed on this self.mp3. Choose the account its owner added, or ask them to add this one.',
    )
    expect(refusalMessage({ reason: 'not-allowed', email: null })).toMatch(/^That Google account/)
    expect(refusalMessage({ reason: 'cancelled', email: null })).toMatch(/didn’t sign you in/)
  })

  it('says a sign-in the doorman ended, and what is still waiting to go up', () => {
    expect(endedMessage('a@b.c', 0)).toBe(
      'Your sign-in ended. Continue with Google as a@b.c to carry on.',
    )
    expect(endedMessage('a@b.c', 1)).toMatch(/1 change made here goes up once you’re back\.$/)
    expect(endedMessage('a@b.c', 3)).toMatch(/3 changes made here go up once you’re back\.$/)
  })
})
