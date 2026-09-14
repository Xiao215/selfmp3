import { describe, expect, it } from 'vitest'

import { isBehind, routeNamesFor } from './backRow.model'

const stack = (...names: string[]) => ({
  index: names.length - 1,
  routes: names.map(name => ({ name })),
})

describe('going back to a page', () => {
  it('names the routes a file-based address is drawn by', () => {
    expect(routeNamesFor('/')).toEqual(['index'])
    expect(routeNamesFor('/you')).toEqual(['you', 'you/index'])
    expect(routeNamesFor('/import/')).toEqual(['import', 'import/index'])
  })

  it('goes back only when the page is directly behind', () => {
    expect(isBehind(stack('you', 'stats/index'), '/you')).toBe(true)
    expect(isBehind(stack('import/index', 'import/migrate'), '/import')).toBe(true)
    expect(isBehind(stack('index', 'stats/report'), '/')).toBe(true)
    // Opened straight on the page: nothing behind it.
    expect(isBehind(stack('settings'), '/you')).toBe(false)
    // Something else behind: back would leave for there.
    expect(isBehind(stack('you', 'index', 'settings'), '/you')).toBe(false)
    expect(isBehind(undefined, '/you')).toBe(false)
  })
})
