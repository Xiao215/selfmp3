import { describe, expect, it } from 'vitest'

import { MOST_TEXT_SCALE, scaledSizes, textScaleFor } from './textScale.model'

describe('the browser’s text size', () => {
  it('leaves the type as it is at the browser’s default, or smaller', () => {
    expect(textScaleFor(16)).toBe(1)
    expect(textScaleFor(12)).toBe(1)
    expect(textScaleFor(Number.NaN)).toBe(1)
  })

  it('grows the type with a larger setting, up to half again', () => {
    expect(textScaleFor(20)).toBe(1.25)
    expect(textScaleFor(32)).toBe(MOST_TEXT_SCALE)
  })

  it('scales each size to a whole point', () => {
    expect(scaledSizes({ body: 15, small: 12 }, 1.25)).toEqual({ body: 19, small: 15 })
  })
})
