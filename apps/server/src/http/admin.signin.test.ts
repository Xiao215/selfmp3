import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { signInStartUrl } from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'

/**
 * The admin page's copy of the doorman's sign-in address, held to the
 * original. `public/admin.js` has no build step, so it cannot import
 * `signInStartUrl` (as admin.format.test.ts says of its formatters); its
 * block is read as text, run, and compared with the package's.
 */

const ADMIN_JS = fileURLToPath(new URL('../../public/admin.js', import.meta.url))

function adminSignInStartUrl(): typeof signInStartUrl {
  const text = readFileSync(ADMIN_JS, 'utf8')
  const start = text.indexOf('function signInStartUrl(')
  const end = text.indexOf('/** End of signInStartUrl. */')
  if (start < 0 || end < start) throw new Error('admin.js has moved signInStartUrl')
  return new Function(`${text.slice(start, end)}\nreturn signInStartUrl`)() as typeof signInStartUrl
}

describe('admin.js signInStartUrl', () => {
  it('agrees with @selfmp3/shared', () => {
    const admin = adminSignInStartUrl()
    const cases: Array<[string, string, string | null]> = [
      ['https://doorman.example', '0'.repeat(32), 'http://localhost:4600/'],
      ['https://doorman.example/', 'ab'.repeat(16), null],
      ['http://127.0.0.1:8787', 'cd'.repeat(16), 'https://pi.example.ts.net/?a=1&b=2'],
    ]
    for (const [doorman, attempt, back] of cases) {
      expect(admin(doorman, attempt, back)).toBe(signInStartUrl(doorman, attempt, back))
    }
  })
})
