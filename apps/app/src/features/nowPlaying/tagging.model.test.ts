import { describe, expect, it } from 'vitest'

import { parseTagging, tagCloseStep, taggingLeft, taggingLine } from './tagging.model'

const untagged = { tagIds: [] }
const tagged = { tagIds: [3] }

describe('parseTagging', () => {
  it('is on only for "1"', () => {
    expect(parseTagging('1')).toBe(true)
    expect(parseTagging(undefined)).toBe(false)
    expect(parseTagging('0')).toBe(false)
    expect(parseTagging(['1'])).toBe(false)
  })
})

describe('tagCloseStep', () => {
  it('goes to the next song once the song has a tag', () => {
    expect(tagCloseStep({ tagged: true, saving: false, hasNext: true })).toBe('next')
  })

  it('ends when the tagged song was the last', () => {
    expect(tagCloseStep({ tagged: true, saving: false, hasNext: false })).toBe('end')
  })

  it('stops when the editor is closed with no tag', () => {
    expect(tagCloseStep({ tagged: false, saving: false, hasNext: true })).toBe('stop')
    expect(tagCloseStep({ tagged: false, saving: false, hasNext: false })).toBe('stop')
  })

  it('waits for a tick still on its way, whatever the song shows now', () => {
    expect(tagCloseStep({ tagged: false, saving: true, hasNext: true })).toBe('wait')
    expect(tagCloseStep({ tagged: true, saving: true, hasNext: false })).toBe('wait')
  })
})

describe('taggingLeft', () => {
  it('counts the song playing and the untagged ones after it', () => {
    expect(taggingLeft([untagged, untagged, untagged, untagged], 1)).toBe(3)
  })

  it('leaves out songs already tagged, before or after', () => {
    expect(taggingLeft([untagged, tagged, untagged, tagged, untagged], 1)).toBe(2)
  })

  it('drops the song playing once it has a tag', () => {
    expect(taggingLeft([tagged, untagged], 0)).toBe(1)
  })

  it('is nothing past the end or on an empty queue', () => {
    expect(taggingLeft([untagged], 3)).toBe(0)
    expect(taggingLeft([], 0)).toBe(0)
  })
})

describe('taggingLine', () => {
  it('says how many are left', () => {
    expect(taggingLine(3)).toBe('Tagging · 3 to go')
    expect(taggingLine(1)).toBe('Tagging · 1 to go')
    expect(taggingLine(0)).toBe('Tagging · all tagged')
  })
})
