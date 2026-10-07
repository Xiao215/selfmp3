import { describe, expect, it } from 'vitest'
import { signInCodeFromUrl } from './doorman.js'

const BACK = 'https://ojgfoohmmkangonahnbdpelfgmkjkfpi.chromiumapp.org/'

describe('signInCodeFromUrl', () => {
  it('reads the code the doorman put in the address it sent back', () => {
    // As the doorman writes it: eight characters of Crockford's base 32, hyphenated.
    expect(signInCodeFromUrl(`${BACK}#signin-code=4F7K-2QXM`)).toBe('4F7K2QXM')
    // A fragment with more than one thing in it, and a query rather than a hash.
    expect(signInCodeFromUrl(`${BACK}#state=x&signin-code=4F7K-2QXM`)).toBe('4F7K2QXM')
    expect(signInCodeFromUrl(`${BACK}?signin-code=4F7K-2QXM`)).toBe('4F7K2QXM')
    expect(signInCodeFromUrl('selfmp3://welcome#signin-code=4f7k2qxm')).toBe('4F7K2QXM')
  })

  it('answers nothing for an address with no code, or a code that is not one', () => {
    expect(signInCodeFromUrl(BACK)).toBeNull()
    expect(signInCodeFromUrl(`${BACK}#error=access_denied`)).toBeNull()
    expect(signInCodeFromUrl(`${BACK}#signin-code=nope`)).toBeNull()
  })
})
