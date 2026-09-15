import { describe, expect, it } from 'vitest'

import { youRows } from './you.model'

describe('the You page', () => {
  it('lists Stats, Untagged, Tags and Settings, each with what it has', () => {
    const rows = youRows({ fromCloud: false, plays: 328, untagged: 21, tags: 2 })
    expect(rows.map(row => [row.label, row.href, row.hint, row.count])).toEqual([
      ['Stats & report', '/stats', '328 plays this month', null],
      ['Untagged', '/inbox', null, 21],
      ['Tags', '/tags', '2', null],
      ['Settings', '/settings', null, null],
    ])
  })

  it('says nothing it does not know yet, and "All tagged" once nothing waits', () => {
    const loading = youRows({ fromCloud: false, plays: undefined, untagged: undefined, tags: undefined })
    expect(loading.map(row => row.hint)).toEqual([null, null, null, null])
    expect(loading.map(row => row.count)).toEqual([null, null, null, null])

    const done = youRows({ fromCloud: false, plays: 1, untagged: 0, tags: 0 })
    expect(done.map(row => row.hint)).toEqual(['1 play this month', 'All tagged', '0', null])
    expect(done[1]?.count).toBeNull()
  })

  it('leaves out what a cloud library cannot ask its server for', () => {
    const rows = youRows({ fromCloud: true, plays: undefined, untagged: 4, tags: 3 })
    expect(rows.map(row => row.id)).toEqual(['tags', 'settings'])
  })
})
