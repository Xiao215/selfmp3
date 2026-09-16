import { describe, expect, it } from 'vitest'
import { codeFromRedirect, signInFailure } from './signIn.js'

const BACK = 'https://ojgfoohmmkangonahnbdpelfgmkjkfpi.chromiumapp.org/'

describe('codeFromRedirect', () => {
  it('reads the code the doorman put in the address it sent back', () => {
    // As the doorman writes it: eight characters of Crockford's base 32, hyphenated.
    expect(codeFromRedirect(`${BACK}#signin-code=4F7K-2QXM`)).toBe('4F7K2QXM')
    // A fragment with more than one thing in it, and a query rather than a hash.
    expect(codeFromRedirect(`${BACK}#state=x&signin-code=4F7K-2QXM`)).toBe('4F7K2QXM')
    expect(codeFromRedirect(`${BACK}?signin-code=4F7K-2QXM`)).toBe('4F7K2QXM')
  })

  it('answers nothing for an address with no code, or a code that is not one', () => {
    expect(codeFromRedirect(BACK)).toBeNull()
    expect(codeFromRedirect(`${BACK}#error=access_denied`)).toBeNull()
    expect(codeFromRedirect(`${BACK}#signin-code=nope`)).toBeNull()
  })
})

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
