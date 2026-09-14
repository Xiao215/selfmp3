import { describe, expect, it } from 'vitest'

import { isNewer, versionFromTag } from './updates.rule.js'

/**
 * The update rule, without a network or an app.
 *
 * Both of these decide whether someone is shown "there is a new version". Told
 * wrongly in one direction they nag on every launch; in the other they never
 * mention the version that fixed the thing they wrote in about.
 */
describe('versionFromTag', () => {
  it('reads the version out of whatever the tag was called', () => {
    expect(versionFromTag('desktop-v1.2.3')).toBe('1.2.3')
    expect(versionFromTag('v1.2.3')).toBe('1.2.3')
    expect(versionFromTag('1.2.3')).toBe('1.2.3')
    expect(versionFromTag('desktop-v1.2.3-beta.1')).toBe('1.2.3-beta.1')
  })

  it('answers null for a tag with no version in it', () => {
    expect(versionFromTag('latest')).toBeNull()
    expect(versionFromTag('')).toBeNull()
  })
})

describe('isNewer', () => {
  it('compares the three numbers, not the string', () => {
    expect(isNewer('1.2.10', '1.2.9')).toBe(true)
    expect(isNewer('1.10.0', '1.9.9')).toBe(true)
    expect(isNewer('2.0.0', '1.99.99')).toBe(true)
  })

  it('is false for the same version, which is the common answer', () => {
    expect(isNewer('1.0.0', '1.0.0')).toBe(false)
  })

  it('is false for an older one, including a rolled-back release', () => {
    expect(isNewer('1.0.0', '1.0.1')).toBe(false)
    expect(isNewer('1.0.0', '2.0.0')).toBe(false)
  })

  it('puts a release above its own prereleases', () => {
    expect(isNewer('1.2.0', '1.2.0-beta.1')).toBe(true)
    expect(isNewer('1.2.0-beta.1', '1.2.0')).toBe(false)
    expect(isNewer('1.2.0-beta.2', '1.2.0-beta.1')).toBe(true)
  })

  it('treats a missing part as zero rather than as newer', () => {
    expect(isNewer('1.2', '1.2.0')).toBe(false)
    expect(isNewer('1.2.1', '1.2')).toBe(true)
  })
})
