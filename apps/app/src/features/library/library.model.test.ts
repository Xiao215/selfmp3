import { describe, expect, it } from 'vitest'
import { ApiError } from '@selfmp3/client'

import {
  emptyReason,
  footNotice,
  footSummary,
  matchNote,
  noMatchesTitle,
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
    expect(copy.title).toBe('Your storage’s allowance for today is used up')
    expect(copy.body).toContain('in about 21 hours')
    expect(copy.body).toContain('Caps & Alerts')
    expect(copy.body).not.toMatch(/online|reach/i)
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

  it('says a server library’s edits wait for it to come back', () => {
    expect(footNotice({ ...base, error: offline, fromCloud: false })).toEqual({
      title: 'Can’t reach your library',
      body: 'Songs on this computer still play. Changes can’t be saved until it’s back. Check that you’re online.',
    })
  })

  it('says a used-up allowance, and when it comes back, even before a read fails', () => {
    expect(footNotice({ ...base, held: true })).toEqual({
      title: 'Storage allowance used up',
      body: 'Songs on this computer still play. The rest come back in about 20 hours.',
    })
  })

  it('reassures on hover, naming only what this device keeps', () => {
    expect(footSummary({ songs: 109, here: 12, place: 'computer' })).toBe(
      'All saved · 109 songs · 12 on this computer',
    )
    expect(footSummary({ songs: 1, here: 0, place: 'computer' })).toBe('All saved · 1 song')
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
