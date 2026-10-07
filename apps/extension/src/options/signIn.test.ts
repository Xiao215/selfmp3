import { describe, expect, it } from 'vitest'
import { signInFailure } from './signIn.js'

describe('signInFailure', () => {
  it('does not call a closed window a failure', () => {
    expect(signInFailure(new Error('The user did not approve access.'))).toBe(
      'That sign-in window was closed before Google finished.',
    )
    expect(signInFailure(new Error('Authorization page could not be loaded.'))).toBe(
      'Authorization page could not be loaded.',
    )
  })
})
