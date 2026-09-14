import { describe, expect, it } from 'vitest'

import { signingTier } from './signingTier.mjs'

/*
 * Which signature a build gets. Worth tests rather than a glance: the tier is
 * baked into the app and decides whether it may replace itself, and a build
 * that looks signed and is not is the failure the whole script exists to
 * prevent.
 */
describe('signingTier', () => {
  it('is ad-hoc when nothing is set', () => {
    expect(signingTier({})).toEqual({
      tier: 'ad-hoc',
      identity: '-',
      notarising: false,
      canInstallUpdates: false,
    })
  })

  it('signs with a certificate from this Mac’s keychain when CSC_NAME names one', () => {
    expect(
      signingTier({ CSC_NAME: '  Apple Development: me@example.com (2534D99VND)  ' }),
    ).toEqual({
      tier: 'development',
      identity: 'Apple Development: me@example.com (2534D99VND)',
      notarising: false,
      canInstallUpdates: false,
    })
  })

  it('lets a Developer ID certificate win over a keychain name', () => {
    const tier = signingTier({
      CSC_LINK: 'file:///cert.p12',
      CSC_KEY_PASSWORD: 'secret',
      CSC_NAME: 'Apple Development: me@example.com (2534D99VND)',
    })
    expect(tier.tier).toBe('signed')
    expect(tier.canInstallUpdates).toBe(true)
  })

  it('notarises only a Developer ID build with all three API variables', () => {
    const api = { APPLE_API_KEY: 'k', APPLE_API_KEY_ID: 'i', APPLE_API_ISSUER: 's' }
    const p12 = { CSC_LINK: 'file:///cert.p12', CSC_KEY_PASSWORD: 'secret' }
    expect(signingTier({ ...p12, ...api }).notarising).toBe(true)
    expect(signingTier({ ...p12, APPLE_API_KEY: 'k', APPLE_API_KEY_ID: 'i' }).notarising).toBe(false)
    expect(signingTier({ CSC_NAME: 'Apple Development: me', ...api }).notarising).toBe(false)
  })

  it('takes a blank variable for an unset one', () => {
    expect(signingTier({ CSC_NAME: '   ' }).tier).toBe('ad-hoc')
    expect(signingTier({ CSC_LINK: 'file:///cert.p12', CSC_KEY_PASSWORD: '' }).tier).toBe('ad-hoc')
  })
})
