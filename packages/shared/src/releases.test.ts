import { describe, expect, it } from 'vitest'

import { isNewer, macInstallers, RELEASES_URL, versionFromTag } from './releases.js'

/**
 * The release rules, without a network or an app.
 *
 * `versionFromTag` and `isNewer` decide whether someone is shown "there is a
 * new version". Told wrongly in one direction they nag on every launch; in the
 * other they never mention the version that fixed the thing they wrote in
 * about. `macInstallers` decides which file a Mac is offered, and the wrong
 * one runs under Rosetta without a word.
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

  it('ranks a prerelease under its release, and later prereleases higher', () => {
    expect(isNewer('1.2.0', '1.2.0-beta.1')).toBe(true)
    expect(isNewer('1.2.0-beta.1', '1.2.0')).toBe(false)
    expect(isNewer('1.2.0-beta.2', '1.2.0-beta.1')).toBe(true)
  })
})

describe('macInstallers', () => {
  const release = {
    tag_name: 'desktop-v1.0.0',
    html_url: `${RELEASES_URL}/tag/desktop-v1.0.0`,
    draft: false,
    assets: [
      { name: 'self.mp3-1.0.0-arm64.dmg', browser_download_url: 'https://dl/arm64.dmg' },
      { name: 'self.mp3-1.0.0-arm64.dmg.blockmap', browser_download_url: 'https://dl/arm64.map' },
      { name: 'self.mp3-1.0.0-x64.dmg', browser_download_url: 'https://dl/x64.dmg' },
      { name: 'self.mp3-1.0.0-arm64-mac.zip', browser_download_url: 'https://dl/arm64.zip' },
      { name: 'latest-mac.yml', browser_download_url: 'https://dl/latest-mac.yml' },
    ],
  }

  it('finds the dmg for each chip by the arch in its name, and nothing else', () => {
    expect(macInstallers(release)).toEqual({
      version: '1.0.0',
      page: `${RELEASES_URL}/tag/desktop-v1.0.0`,
      dmg: { arm64: 'https://dl/arm64.dmg', x64: 'https://dl/x64.dmg' },
    })
  })

  it('leaves a chip null when its dmg is missing, and keeps the page', () => {
    const one = { ...release, assets: release.assets.slice(0, 2) }
    expect(macInstallers(one)?.dmg).toEqual({ arm64: 'https://dl/arm64.dmg', x64: null })
  })

  it('answers null for a body that is not a release', () => {
    expect(macInstallers({ message: 'Not Found' })).toBeNull()
    expect(macInstallers(null)).toBeNull()
  })
})
