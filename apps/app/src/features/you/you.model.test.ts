import { describe, expect, it } from 'vitest'

import { youRows } from './you.model'

describe('the You page', () => {
  it('lists Stats, Tags and Settings, each with what it has', () => {
    const rows = youRows({ plays: 328, tags: 2 })
    expect(rows.map(row => [row.label, row.href, row.hint])).toEqual([
      ['Stats & report', '/stats', '328 plays this month'],
      ['Tags', '/tags', '2'],
      ['Settings', '/settings', null],
    ])
  })

  it('says nothing it does not know yet', () => {
    const loading = youRows({ plays: undefined, tags: undefined })
    expect(loading.map(row => row.hint)).toEqual([null, null, null])

    const done = youRows({ plays: 1, tags: 0 })
    expect(done.map(row => row.hint)).toEqual(['1 play this month', '0', null])
  })

  it('lists Stats even with no plays to put beside it yet', () => {
    // A cloud library that has not reached its server knows no play count. The
    // row is still there: the page it opens is what explains why it is empty.
    const rows = youRows({ plays: undefined, tags: 3 })
    expect(rows.map(row => row.id)).toEqual(['stats', 'tags', 'settings'])
    expect(rows[0]?.hint).toBeNull()
  })
})
