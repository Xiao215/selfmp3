import { describe, expect, it } from 'vitest'
import { parseQuery } from './routes.js'

/**
 * Hand-written, because React Native's `URL` carries no `URLSearchParams`.
 * The cases below are the ones a hand-written parser gets wrong, checked
 * against what `URLSearchParams` answers — matching it exactly is the whole
 * requirement.
 */
describe('parseQuery', () => {
  const cases = [
    '?scope=playlists',
    'scope=playlists',
    '?limit=20&scope=library',
    '?a=1&a=2',
    '?flag',
    '?flag=',
    '?q=two%20words',
    '?q=two+words',
    '?q=a%26b',
    '?weird=%E2%9C%93',
    '',
    '?',
    '?&&',
  ]

  for (const search of cases) {
    it(`reads ${search || '(empty)'} the way a browser would`, () => {
      const mine = parseQuery(search)
      const theirs = new URLSearchParams(search)
      for (const key of ['scope', 'limit', 'a', 'flag', 'q', 'weird', 'missing']) {
        expect([key, mine.get(key)]).toEqual([key, theirs.get(key)])
      }
    })
  }
})
