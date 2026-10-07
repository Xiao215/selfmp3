import { describe, expect, it } from 'vitest'

import { cameFrom } from './playlistDetail.model'

describe('where a back link goes', () => {
  const stack = (...names: string[]) => ({
    index: names.length - 1,
    routes: names.map(name => ({ name })),
  })

  it('goes back when the page it names is just behind', () => {
    expect(cameFrom(stack('index', 'playlists/index', 'playlists/[id]'), 'playlists/index')).toBe(
      true,
    )
  })

  it('does not, after a playlist made from the library, or a deep link', () => {
    expect(cameFrom(stack('index', 'playlists/[id]'), 'playlists/index')).toBe(false)
    expect(cameFrom(stack('playlists/[id]'), 'playlists/index')).toBe(false)
    expect(cameFrom(undefined, 'playlists/index')).toBe(false)
  })
})
