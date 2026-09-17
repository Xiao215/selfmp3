import { useSyncExternalStore } from 'react'
import type { Tag } from '@selfmp3/shared'

/**
 * How many of a song's tags fit in its row, and how many are left over.
 *
 * The slot is a fixed width at the end of the row, so a fourth tag — or one
 * long name — used to be sliced in half and bleed into the album column. A cut
 * chip reads as a rendering fault, and the one thing it cannot tell you is how
 * many tags you are not seeing. So chips are laid in until the next one will
 * not fit and the remainder becomes a count: three short tags all show, one
 * long tag shows alone with a "+2" beside it, and the slot is always full and
 * never over.
 *
 * Widths come from the chips themselves. Every chip reports its width the
 * first time it is drawn (`rememberChipWidth`), and because a chip's width
 * depends only on its name, one measurement serves every row that tag is on.
 * Until a name has been drawn anywhere its width is estimated, which is close
 * enough that the correction is rarely visible.
 */

/** The slot, as `SongRow`'s styles set it out. */
export const TAG_SLOT_WIDTH = 180
export const TAG_SLOT_PADDING_LEFT = 20
export const TAG_GAP = 5
/** The dashed ⊕, which keeps its place in the slot whether or not it is lit. */
export const TAG_ADD_WIDTH = 22
/** No single chip may take the slot: a long name ends in an ellipsis instead. */
export const TAG_CHIP_MAX_WIDTH = 96

const CHIP_PADDING = 16
const CHIP_FONT_SIZE = 11

/** Room for the chips and the count, once the ⊕ has taken its place. */
export function chipBudget({ hasAddButton }: { hasAddButton: boolean }): number {
  const content = TAG_SLOT_WIDTH - TAG_SLOT_PADDING_LEFT
  return hasAddButton ? content - TAG_ADD_WIDTH - TAG_GAP : content
}

/**
 * What a chip will be about this wide, before it has ever been drawn.
 *
 * Latin letters run a little over half the font size; the kana, hanzi and
 * hangul this library is full of are square, so they take the whole of it.
 */
export function estimateChipWidth(name: string): number {
  let text = 0
  for (const ch of name) text += isFullWidth(ch) ? CHIP_FONT_SIZE : CHIP_FONT_SIZE * 0.55
  return Math.min(TAG_CHIP_MAX_WIDTH, Math.ceil(text) + CHIP_PADDING)
}

function isFullWidth(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0
  return (
    (code >= 0x1100 && code <= 0x115f) || // hangul jamo
    (code >= 0x2e80 && code <= 0xa4cf) || // kana, hanzi, bopomofo
    (code >= 0xac00 && code <= 0xd7a3) || // hangul syllables
    (code >= 0xf900 && code <= 0xfaff) || // compatibility ideographs
    (code >= 0xfe30 && code <= 0xfe6f) || // CJK punctuation forms
    (code >= 0xff00 && code <= 0xff60) || // full-width forms
    code >= 0x20000 // the supplementary ideographic planes
  )
}

/** "+3", at the width it will draw at. */
export function countPillWidth(hidden: number): number {
  return estimateChipWidth(`+${hidden}`)
}

/**
 * The tags to draw, and how many are left for the count.
 *
 * Tried longest-first: every chip, then one fewer, until a row fits. Dropping
 * a chip changes the count, and the count changes what fits, so each candidate
 * is measured whole rather than unpicked from the last one.
 */
export function fitTags(
  tags: readonly Tag[],
  widthOf: (tag: Tag) => number,
  budget: number,
): { shown: readonly Tag[]; hidden: number } {
  for (let shown = tags.length; shown > 0; shown--) {
    if (rowWidth(tags, widthOf, shown) <= budget) {
      return { shown: tags.slice(0, shown), hidden: tags.length - shown }
    }
  }
  // Not even one chip and its count fit: the count alone says how many there are.
  return { shown: [], hidden: tags.length }
}

function rowWidth(tags: readonly Tag[], widthOf: (tag: Tag) => number, shown: number): number {
  let width = 0
  for (let i = 0; i < shown; i++) {
    width += Math.min(TAG_CHIP_MAX_WIDTH, widthOf(tags[i] as Tag)) + (i > 0 ? TAG_GAP : 0)
  }
  const hidden = tags.length - shown
  if (hidden > 0) width += (shown > 0 ? TAG_GAP : 0) + countPillWidth(hidden)
  return width
}

/*
 * Every chip width this app has drawn, by name. A module-level map rather than
 * state: the rows are memoised and there are hundreds of them, and a tag is
 * the same width on every one of them.
 */
const measured = new Map<string, number>()
const listeners = new Set<() => void>()
let version = 0

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const getVersion = (): number => version

/** A chip, reporting the width it drew at. Ignored unless it is news. */
export function rememberChipWidth(name: string, width: number): void {
  const rounded = Math.ceil(width)
  if (rounded <= 0 || measured.get(name) === rounded) return
  measured.set(name, rounded)
  version += 1
  for (const listener of listeners) listener()
}

/** For the tests, which must not inherit widths from one another. */
export function forgetChipWidths(): void {
  measured.clear()
  version += 1
}

/**
 * How wide a tag's chip is, re-rendering the caller when a width it used was
 * only an estimate and the real one has since been drawn.
 */
export function useChipWidth(): (tag: Tag) => number {
  useSyncExternalStore(subscribe, getVersion, getVersion)
  return tag => measured.get(tag.name) ?? estimateChipWidth(tag.name)
}
