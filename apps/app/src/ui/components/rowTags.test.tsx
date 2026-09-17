import type { Tag } from '@selfmp3/shared'
import {
  chipBudget,
  estimateChipWidth,
  fitTags,
  forgetChipWidths,
  rememberChipWidth,
  TAG_CHIP_MAX_WIDTH,
} from './rowTags'

const tag = (name: string, id = name.length): Tag => ({ id, name, hue: 200, songCount: 1 })

/** Chips are laid in at the width the caller says; the count is estimated. */
const widths =
  (byName: Record<string, number>) =>
  (subject: Tag): number =>
    byName[subject.name] ?? 30

beforeEach(forgetChipWidths)

describe('fitTags', () => {
  it('shows every tag when they all fit', () => {
    const tags = [tag('a'), tag('b'), tag('c')]
    const fitted = fitTags(tags, widths({ a: 24, b: 24, c: 24 }), 133)

    expect(fitted.shown).toHaveLength(3)
    expect(fitted.hidden).toBe(0)
  })

  it('drops tags until the chips and the count both fit', () => {
    const tags = [tag('one'), tag('two'), tag('three'), tag('four')]
    const fifty = widths({ one: 50, two: 50, three: 50, four: 50 })
    // Two chips and "+2" want 50 + 5 + 50 + 5 + 29 = 139.
    const roomy = fitTags(tags, fifty, 145)
    expect(roomy.shown.map(entry => entry.name)).toEqual(['one', 'two'])
    expect(roomy.hidden).toBe(2)

    // Six points short of that, the second chip goes and the count grows.
    const tight = fitTags(tags, fifty, 133)
    expect(tight.shown.map(entry => entry.name)).toEqual(['one'])
    expect(tight.hidden).toBe(3)
  })

  it('counts the room the pill itself takes', () => {
    const tags = [tag('a'), tag('b')]
    // Both chips fit in 120 on their own (55 + 5 + 55), and with nothing hidden
    // there is no pill to find room for.
    expect(fitTags(tags, widths({ a: 55, b: 55 }), 120).hidden).toBe(0)
    // One chip plus "+1" does not fit in 70, so the chip goes and the count stays.
    expect(fitTags(tags, widths({ a: 55, b: 55 }), 70)).toEqual({ shown: [], hidden: 2 })
  })

  it('never lets one long name take the whole slot', () => {
    const long = tag('aaaaaaaaaaaaaaaaaaaaaaaa')
    // Capped at 96 rather than the 400 it would want, which leaves the row a
    // chip and a count instead of one chip and a cut edge.
    const fitted = fitTags([long, tag('b')], widths({ [long.name]: 400, b: 60 }), 133)

    expect(fitted.shown.map(entry => entry.name)).toEqual([long.name])
    expect(fitted.hidden).toBe(1)
  })

  it('has nothing to do with no tags', () => {
    expect(fitTags([], widths({}), 133)).toEqual({ shown: [], hidden: 0 })
  })
})

describe('estimateChipWidth', () => {
  it('gives a square character its full width', () => {
    expect(estimateChipWidth('東京')).toBeGreaterThan(estimateChipWidth('ab'))
  })

  it('stops at the cap a chip is drawn with', () => {
    expect(estimateChipWidth('a'.repeat(30))).toBe(TAG_CHIP_MAX_WIDTH)
  })
})

describe('remembered widths', () => {
  it('replaces the estimate once a chip has been drawn', () => {
    const subject = tag('yoasobi')
    const estimated = estimateChipWidth(subject.name)
    rememberChipWidth(subject.name, estimated + 20)

    // The same name on any row now uses what was actually drawn.
    const fitted = fitTags(
      [subject],
      entry => (entry.name === subject.name ? estimated + 20 : 30),
      estimated + 10,
    )
    expect(fitted).toEqual({ shown: [], hidden: 1 })
  })
})

describe('chipBudget', () => {
  it('leaves room for the ⊕ when the row has one', () => {
    expect(chipBudget({ hasAddButton: true })).toBeLessThan(chipBudget({ hasAddButton: false }))
  })
})
