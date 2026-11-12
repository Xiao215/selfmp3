import { describe, expect, it } from 'vitest'
import { codeOf } from './errors.js'

describe('codeOf', () => {
  it('reads the code a system error carries', () => {
    expect(codeOf(Object.assign(new Error('no such file'), { code: 'ENOENT' }))).toBe('ENOENT')
    expect(codeOf({ code: 'SQLITE_FULL' })).toBe('SQLITE_FULL')
  })

  it('says nothing for an error with no code, or a code that is not words', () => {
    expect(codeOf(new Error('plain'))).toBeUndefined()
    expect(codeOf(Object.assign(new Error('numbered'), { code: 7 }))).toBeUndefined()
    expect(codeOf('ENOENT')).toBeUndefined()
    expect(codeOf(null)).toBeUndefined()
    expect(codeOf(undefined)).toBeUndefined()
  })
})
