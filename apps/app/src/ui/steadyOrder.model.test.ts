import { describe, expect, it } from 'vitest'

import { steadyOrder } from './steadyOrder.model'

const name = (item: { name: string }): string => item.name
const items = (...names: string[]): { name: string }[] => names.map(each => ({ name: each }))
const names = (list: readonly { name: string }[]): string[] => list.map(name)

describe('a list that keeps its places', () => {
  it('leaves the items shown where they are when only their order changed', () => {
    expect(names(steadyOrder(items('b', 'yoasobi'), items('yoasobi', 'b'), name))).toEqual([
      'b',
      'yoasobi',
    ])
  })

  it('puts an item that joins at the front, and closes up behind one that leaves', () => {
    expect(names(steadyOrder(items('a', 'b', 'c'), items('d', 'a', 'c'), name))).toEqual([
      'd',
      'a',
      'c',
    ])
  })

  it('draws a kept item as it is now', () => {
    const now = { name: 'a', hue: 2 }
    expect(steadyOrder([{ name: 'a', hue: 1 }], [now], name)[0]).toBe(now)
  })

  it('is the new order when nothing was shown', () => {
    expect(names(steadyOrder([], items('c', 'a'), name))).toEqual(['c', 'a'])
  })
})
