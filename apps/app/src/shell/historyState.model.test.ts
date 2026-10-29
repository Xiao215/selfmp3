import { describe, expect, it } from 'vitest'

import { broughtBackUp, onLiveKeys } from './historyState.model'

/** The live state: the app's layout at the root, and the stack of pages under it. */
const live = {
  key: 'root-1',
  routes: [
    {
      key: '__root-1',
      name: '__root',
      state: {
        key: 'stack-1',
        routes: [
          { key: 'index-1', name: 'index', params: {} },
          { key: 'library-1', name: 'library', params: {} },
        ],
      },
    },
  ],
}

describe('a history step put on the live keys', () => {
  it('keeps the app’s layout mounted going back to the first page, saved with no keys', () => {
    const first = { routes: [{ name: '__root', state: { routes: [{ name: 'index' }] } }] }
    const restored = onLiveKeys(first, live)
    expect(restored.key).toBe('root-1')
    expect(restored.routes[0]?.key).toBe('__root-1')
    expect(restored.routes[0]?.state?.key).toBe('stack-1')
    expect(restored.routes[0]?.state?.routes[0]?.key).toBe('index-1')
  })

  it('replaces keys saved before the app was last mounted', () => {
    const later = {
      key: 'root-0',
      routes: [
        {
          key: '__root-0',
          name: '__root',
          state: {
            key: 'stack-0',
            routes: [
              { key: 'index-0', name: 'index', params: {} },
              { key: 'library-0', name: 'library', params: {} },
            ],
          },
        },
      ],
    }
    const restored = onLiveKeys(later, live)
    expect(restored.routes[0]?.state?.routes.map(route => route.key)).toEqual([
      'index-1',
      'library-1',
    ])
  })

  it('draws a page that is not live any more as the entry had it', () => {
    const entry = {
      routes: [
        {
          name: '__root',
          state: {
            routes: [
              { name: 'index', params: {} },
              { key: 'tag-0', name: 'tag/[name]', params: { name: 'night' } },
            ],
          },
        },
      ],
    }
    const pages = onLiveKeys(entry, live).routes[0]?.state?.routes
    expect(pages?.map(route => route.key)).toEqual(['index-1', 'tag-0'])
  })

  it('tells two pages of the same kind apart by their params', () => {
    const tags = {
      key: 'stack-1',
      routes: [
        { key: 'a', name: 'tag/[name]', params: { name: 'night' } },
        { key: 'b', name: 'tag/[name]', params: { name: 'rain' } },
      ],
    }
    const entry = {
      key: 'stack-0',
      routes: [{ key: 'old', name: 'tag/[name]', params: { name: 'rain' } }],
    }
    expect(onLiveKeys(entry, tags).routes[0]?.key).toBe('b')
  })

  it('takes a page read from its address alone as a step on from the live stack', () => {
    const forward = { routes: [{ name: '__root', state: { routes: [{ name: 'stats' }] } }] }
    const pages = onLiveKeys(forward, live).routes[0]?.state
    expect(pages?.routes.map(route => route.name)).toEqual(['index', 'library', 'stats'])
    expect(pages?.routes.map(route => route.key)).toEqual(['index-1', 'library-1', undefined])
    expect(pages?.index).toBe(2)
  })

  it('takes one the stack already has as a step back to it', () => {
    const back = { routes: [{ name: '__root', state: { routes: [{ name: 'index' }] } }] }
    const pages = onLiveKeys(back, live).routes[0]?.state
    expect(pages?.routes.map(route => route.key)).toEqual(['index-1'])
  })

  it('gives each live route to one page only', () => {
    const twice = {
      routes: [
        { name: 'library', params: {} },
        { name: 'library', params: {} },
      ],
    }
    const one = { key: 's', routes: [{ key: 'library-1', name: 'library', params: {} }] }
    expect(onLiveKeys(twice, one).routes.map(route => route.key)).toEqual(['library-1', undefined])
  })
})

describe('a page brought back up the stack', () => {
  const inStack = (...names: string[]) => ({
    key: 'root-1',
    index: 0,
    routes: [
      {
        key: '__root-1',
        name: '__root',
        state: {
          key: 'stack-1',
          index: names.length - 1,
          routes: names.map(name => ({ key: `${name}-1`, name, params: {} })),
        },
      },
    ],
  })

  it('is a step: Library → Stats → Library', () => {
    expect(broughtBackUp(inStack('library', 'stats'), inStack('stats', 'library'))).toBe(true)
  })

  it('is not a page pushed, popped, or left on top', () => {
    expect(broughtBackUp(inStack('library'), inStack('library', 'stats'))).toBe(false)
    expect(broughtBackUp(inStack('library', 'stats'), inStack('library'))).toBe(false)
    expect(broughtBackUp(inStack('library', 'stats'), inStack('library', 'stats'))).toBe(false)
    expect(broughtBackUp(undefined, inStack('library'))).toBe(false)
  })

  it('is not a page replaced by another', () => {
    const replaced = inStack('library', 'stats')
    const tags = { key: 'tags-1', name: 'tags', params: {} }
    const next = {
      ...replaced,
      routes: [
        {
          ...replaced.routes[0]!,
          state: { key: 'stack-1', index: 1, routes: [replaced.routes[0]!.state.routes[0]!, tags] },
        },
      ],
    }
    expect(broughtBackUp(replaced, next)).toBe(false)
  })
})
