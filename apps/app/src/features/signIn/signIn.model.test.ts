import { describe, expect, it } from 'vitest'

import {
  afterCheck,
  copyFor,
  FOOTNOTE,
  LINK_GRACE_MS,
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
  const words = stages.flatMap(stage => Object.values(copyFor(stage))).concat(FOOTNOTE)

  it('never asks for a code', () => {
    expect(words.filter(text => text !== null && /code/i.test(text))).toEqual([])
  })

  it('names no device, because every device shows it', () => {
    expect(words.filter(text => text !== null && /phone|mac|computer/i.test(text))).toEqual([])
  })
})
