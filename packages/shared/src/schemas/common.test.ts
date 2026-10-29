import { describe, expect, it } from 'vitest'
import { NameSchema, OptionalTextSchema, tidyText } from './common.js'
import { TagNameSchema } from './tag.js'

/**
 * Names as typed, made fit to show. A name that looks like nothing made a
 * blank chip and a blank sidebar row, a bidi override made "evil" read as
 * "live", and the same word typed two ways made two tags.
 */
describe('names', () => {
  it('composes a name one way, so the same word typed two ways is one tag', () => {
    const decomposed = 'Chaös'
    expect(TagNameSchema.parse(decomposed)).toBe(TagNameSchema.parse('Chaös'))
  })

  it.each(['​', '⠀', 'ㅤ', ' ﻿ ', '‮', '‍'])('refuses a name of nothing visible (%j)', name => {
    expect(TagNameSchema.safeParse(name).success).toBe(false)
    expect(NameSchema.safeParse(name).success).toBe(false)
  })

  it('takes out what shows nothing, and keeps what joins', () => {
    expect(tidyText('‮evil')).toBe('evil')
    expect(tidyText('chill​')).toBe('chill')
    expect(TagNameSchema.parse('chill​')).toBe('chill')
    // An emoji family and a Persian word keep their joiners.
    expect(tidyText('👨‍👩‍👧')).toBe('👨‍👩‍👧')
    expect(tidyText('می‌خواهم')).toBe('می‌خواهم')
  })

  it('puts a name on one line', () => {
    expect(NameSchema.parse('line1\nline2\r\n\tline3')).toBe('line1 line2 line3')
  })

  it('leaves an ordinary name as it is, and lets artist and album be empty', () => {
    expect(NameSchema.parse('  夜に駆ける  ')).toBe('夜に駆ける')
    expect(NameSchema.parse('שלום עולם abc')).toBe('שלום עולם abc')
    expect(OptionalTextSchema.parse(undefined)).toBe('')
    expect(OptionalTextSchema.parse('​')).toBe('')
  })
})
