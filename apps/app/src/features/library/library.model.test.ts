import { describe, expect, it } from 'vitest'
import { ApiError, SORT_OPTIONS } from '@selfmp3/client'

import {
  emptyReason,
  footNotice,
  footSummary,
  linkedSort,
  matchNote,
  noMatchesTitle,
  orderLabel,
  stripTags,
  unreachableCopy,
  unreachableLabel,
  untilCapResets,
} from './library.model'

describe('saying the library cannot be reached', () => {
  it('names the address it tried, without the scheme', () => {
    expect(
      unreachableCopy({ fromCloud: false, address: 'http://192.168.1.20:4600/', compact: false }),
    ).toEqual({
      title: 'Can’t reach your library',
      body: 'self.mp3 tried 192.168.1.20:4600. Check that this device is online and that the computer your library lives on is switched on.',
      why: null,
    })
  })

  it('shows no address for a cloud library', () => {
    const copy = unreachableCopy({ fromCloud: true, address: 'http://old:4600', compact: false })
    expect(copy.title).toBe('Can’t reach your library')
    expect(copy.body).not.toContain('old:4600')
  })

  it('says one short line on a phone', () => {
    expect(unreachableCopy({ fromCloud: false, address: 'http://a:1', compact: true }).body).toBe(
      'Check that you’re online, then try again.',
    )
  })
  // The doorman's answer when Backblaze's daily allowance is used up: it was
  // reached, so saying it was not sent Xiao looking at a working server.
  const capped = new ApiError(502, 'Backblaze says “… cap exceeded …”', 'bucket_cap_exceeded')
  const evening = new Date('2026-10-08T02:49:00Z')

  it('says the storage’s allowance is used up, not that the library is out of reach', () => {
    const copy = unreachableCopy({
      fromCloud: true,
      address: null,
      compact: false,
      error: capped,
      now: evening,
    })
    expect(copy.title).toBe('Storage allowance used up')
    // One line of what it means; the rest waits behind Why?.
    expect(copy.body).toBe('Downloads are paused for about 21 hours.')
    expect(copy.why).toContain('Caps & Alerts')
    expect(`${copy.body} ${copy.why}`).not.toMatch(/online|reach/i)
    expect(unreachableLabel(capped)).toBe('Storage allowance used up for today')
  })

  it('still says can’t reach for anything else', () => {
    const offline = new ApiError(0, 'Failed to fetch', 'offline')
    expect(unreachableLabel(offline)).toBe('Can’t reach your library')
    expect(unreachableLabel(new Error('boom'))).toBe('Can’t reach your library')
    expect(
      unreachableCopy({ fromCloud: true, address: null, compact: false, error: offline }).title,
    ).toBe('Can’t reach your library')
  })

  it('says a library that answered with an error ran into a problem, not that it is out of reach', () => {
    const broken = new ApiError(500, 'Unexpected answer from /api/library', 'contract_mismatch')
    const copy = unreachableCopy({
      fromCloud: false,
      address: 'http://a:1',
      compact: false,
      error: broken,
    })
    expect(copy.title).toBe('Your library ran into a problem')
    expect(copy.body).not.toMatch(/online|switched on/)
    expect(unreachableLabel(new ApiError(503, 'Service Unavailable'))).toBe(
      'Your library ran into a problem',
    )
  })

  it('counts down to midnight GMT, in minutes for the last hour', () => {
    expect(untilCapResets(new Date('2026-10-08T00:00:00Z'))).toBe('24 hours')
    expect(untilCapResets(new Date('2026-10-08T22:31:00Z'))).toBe('1 hour')
    expect(untilCapResets(new Date('2026-10-08T23:20:00Z'))).toBe('40 minutes')
    expect(untilCapResets(new Date('2026-10-08T23:59:59Z'))).toBe('1 minute')
  })

  it('says it shorter where a line has little room', () => {
    expect(untilCapResets(new Date('2026-10-08T04:00:00Z'), true)).toBe('20 h')
    expect(untilCapResets(new Date('2026-10-08T23:20:00Z'), true)).toBe('40 min')
  })
})

describe('the sidebar foot', () => {
  const offline = new ApiError(0, 'Failed to fetch', 'offline')
  const base = {
    error: null,
    held: false,
    fromCloud: true,
    keepsSongs: true,
    place: 'computer' as const,
    unsent: 0,
    now: new Date('2026-10-08T04:00:00Z'),
  }

  it('says nothing on a normal day', () => {
    expect(footNotice(base)).toBeNull()
  })

  it('says what still works while offline, and that changes wait', () => {
    expect(footNotice({ ...base, error: offline })).toEqual({
      title: 'Offline',
      body: 'Songs on this computer still play. Changes send when you’re back.',
    })
    expect(footNotice({ ...base, error: offline, unsent: 3 })?.body).toBe(
      'Songs on this computer still play. Your 3 changes send when you’re back.',
    )
    expect(footNotice({ ...base, error: offline, unsent: 1 })?.body).toContain('Your change sends')
  })

  it('promises no songs from a browser tab, which keeps none', () => {
    expect(footNotice({ ...base, error: offline, keepsSongs: false })?.body).toBe(
      'Changes send when you’re back.',
    )
  })

  // R3-M1: "All saved", then "Saving…" with a green dot, over edits the bucket refused.
  it('says edits the storage did not take are not sent, whatever else answers', () => {
    expect(footNotice({ ...base, unsent: 2, stuck: true })).toEqual({
      title: 'Not sent yet',
      body: 'Your 2 changes didn’t go through. They’re sent again by themselves.',
    })
    expect(footNotice({ ...base, unsent: 1, stuck: true })?.body).toBe(
      'Your change didn’t go through. It’s sent again by itself.',
    )
    // Made a moment ago and on their way: nothing to say yet.
    expect(footNotice({ ...base, unsent: 2 })).toBeNull()
    expect(footSummary({ songs: 40, here: 40, place: 'computer', unsent: 2 })).toBe(
      'Saving 2 changes… · 40 songs · 40 on this computer',
    )
    // Offline says it its own way.
    expect(footNotice({ ...base, unsent: 1, stuck: true, offline: true })?.title).toBe('Offline')
  })

  it('says a server library’s edits wait for it to come back', () => {
    expect(footNotice({ ...base, error: offline, fromCloud: false })).toEqual({
      title: 'Can’t reach your library',
      body: 'Songs on this computer still play. Changes can’t be saved until it’s back. Check that you’re online.',
    })
  })

  it('says offline when the device is, though nothing has failed yet, with what waits', () => {
    expect(footNotice({ ...base, fromCloud: false, offline: true, unsent: 2 })).toEqual({
      title: 'Offline',
      body: 'Songs on this computer still play. Your 2 changes send when you’re back.',
    })
  })

  it('says a server that answered with an error ran into a problem', () => {
    const broken = new ApiError(503, 'Service Unavailable')
    expect(footNotice({ ...base, fromCloud: false, error: broken })?.title).toBe(
      'Your library ran into a problem',
    )
  })

  it('says a used-up allowance, and when it comes back, even before a read fails', () => {
    expect(footNotice({ ...base, held: true })).toEqual({
      title: 'Storage allowance used up',
      body: 'Songs on this computer still play. The rest come back in about 20 hours.',
    })
  })

  it('says an edit the storage would not take waits for the allowance, not the connection', () => {
    const capped = new ApiError(502, 'Transaction cap exceeded', 'bucket_cap_exceeded')
    expect(footNotice({ ...base, error: capped, unsent: 1 })).toEqual({
      title: 'Storage allowance used up',
      body: 'Your change sends when it resets, in about 20 hours.',
    })
    expect(footNotice({ ...base, error: capped, unsent: 2 })?.body).toBe(
      'Your 2 changes send when it resets, in about 20 hours.',
    )
  })

  it('reassures on hover, naming only what this device keeps', () => {
    expect(footSummary({ songs: 109, here: 12, place: 'computer' })).toBe(
      'All saved · 109 songs · 12 on this computer',
    )
    expect(footSummary({ songs: 1, here: 0, place: 'computer' })).toBe('All saved · 1 song')
    expect(footSummary({ songs: 1, here: 0, place: 'computer', unsent: 2 })).toBe(
      'Saving 2 changes… · 1 song',
    )
  })
})

describe('a filter that matched nothing', () => {
  it('blames the tags when some are chosen', () => {
    expect(noMatchesTitle(true)).toBe('Nothing matches these tags')
    expect(noMatchesTitle(false)).toBe('Nothing matches')
  })
})

/**
 * The first model test, and the reason the model rule exists.
 *
 * No simulator, no browser, no server: this is why `library.model.ts` is
 * forbidden from importing `react-native` or a component. If it ever does, this
 * file stops running and the rule has been broken in a way that is noticed.
 */
describe('why the library list is empty', () => {
  it('is not empty at all when something matched', () => {
    expect(emptyReason({ isError: false, total: 13, shown: 13 })).toBeNull()
    // Even a failed refetch is not what the reader is looking at, if there are
    // songs on the screen.
    expect(emptyReason({ isError: true, total: 13, shown: 3 })).toBeNull()
  })

  it('blames the network only when there is nothing cached to show', () => {
    expect(emptyReason({ isError: true, total: 0, shown: 0 })).toBe('unreachable')
  })

  it('tells apart an empty library from a filter that matched nothing', () => {
    // Nothing imported yet: the answer is "import something", not "try again".
    expect(emptyReason({ isError: false, total: 0, shown: 0 })).toBe('no-library')
    // Thirteen songs and none shown is the filter's doing.
    expect(emptyReason({ isError: false, total: 13, shown: 0 })).toBe('no-matches')
  })
})

describe('matchNote', () => {
  it('says nothing for none or one tag', () => {
    expect(matchNote(0, 0, 10)).toBeNull()
    expect(matchNote(1, 0, 10)).toBeNull()
  })

  it('names both tags for two, and counts them beyond that', () => {
    expect(matchNote(2, 62, 176)).toBe('62 have both tags, and come first')
    expect(matchNote(3, 24, 210)).toBe('24 have all 3 tags, and come first')
  })

  it('says nothing when no song carries every tag, or when every song does', () => {
    expect(matchNote(2, 0, 176)).toBeNull()
    expect(matchNote(2, 176, 176)).toBeNull()
  })
})

describe('the tag strip', () => {
  const tag = (id: number, name: string, songCount: number) => ({ id, name, hue: 1, songCount })
  const tags = [tag(1, 'a', 3), tag(2, 'b', 9), tag(3, 'c', 1), tag(4, 'empty', 0), tag(5, 'd', 5)]

  it('puts the chosen first, then the ones used lately, then the biggest', () => {
    expect(stripTags(tags, [3], [1]).map(entry => entry.name)).toEqual(['c', 'a', 'b', 'd'])
  })

  it('leaves out a tag with no songs unless it is chosen', () => {
    expect(stripTags(tags, [], []).map(entry => entry.name)).not.toContain('empty')
    expect(stripTags(tags, [4], []).map(entry => entry.name)).toContain('empty')
  })

  it('stops at its limit, but never hides a chosen tag', () => {
    expect(stripTags(tags, [], [], 2)).toHaveLength(2)
    expect(stripTags(tags, [1, 2, 3], [], 2)).toHaveLength(3)
  })
})

describe('naming the order', () => {
  const option = (field: string) => SORT_OPTIONS.find(each => each.field === field)

  it('says the field and which way round, in the field’s own words', () => {
    expect(orderLabel(option('addedAt'), true)).toBe('Recently added · newest')
    expect(orderLabel(option('addedAt'), false)).toBe('Recently added · oldest')
    expect(orderLabel(option('title'), false)).toBe('Title · A–Z')
    expect(orderLabel(option('playCount'), false)).toBe('Most played · fewest')
  })

  it('starts each field its own way round', () => {
    expect(option('addedAt')?.orders[0].descending).toBe(true)
    expect(option('artist')?.orders[0].descending).toBe(false)
    expect(option('duration')?.orders[0].label).toBe('Longest')
  })
})

describe('an order a link opens Library in', () => {
  it('is a sort Library has, read from the address; anything else is none', () => {
    expect(linkedSort('lastPlayedAt')).toBe('lastPlayedAt')
    expect(linkedSort(['playCount', 'title'])).toBe('playCount')
    expect(linkedSort(undefined)).toBeNull()
    expect(linkedSort('random')).toBeNull()
    expect(linkedSort('loudest')).toBeNull()
  })
})
