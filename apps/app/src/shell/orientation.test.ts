import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

/**
 * Which way up each device is allowed to be.
 *
 * The real check is the `Info.plist` that `expo prebuild` writes, and that
 * needs a prebuild. This asserts the input to it, which is the part that gets
 * edited: `app.config.js`. It runs in the ordinary `npm run check`, on any
 * machine, with no Xcode and no simulator — so a change that quietly takes the
 * iPad's landscape away, or gives the iPhone one, fails here rather than on a
 * device weeks later.
 *
 * The two keys disagree on purpose. Expo's plugin writes only
 * `UISupportedInterfaceOrientations` from `orientation: 'portrait'` and never
 * touches the `~ipad` key, which is what makes "the phone stays put, the tablet
 * turns" expressible at all.
 */
const require_ = createRequire(import.meta.url)
const config = require_('../../app.config.js') as {
  orientation: string
  ios: { supportsTablet: boolean; requireFullScreen?: boolean; infoPlist: Record<string, unknown> }
}

const IPAD_KEY = 'UISupportedInterfaceOrientations~ipad'

describe('orientation', () => {
  it('keeps the iPhone portrait', () => {
    expect(config.orientation).toBe('portrait')
  })

  it('lets the iPad have all four', () => {
    expect(config.ios.infoPlist[IPAD_KEY]).toEqual([
      'UIInterfaceOrientationPortrait',
      'UIInterfaceOrientationPortraitUpsideDown',
      'UIInterfaceOrientationLandscapeLeft',
      'UIInterfaceOrientationLandscapeRight',
    ])
  })

  it('supports tablets at all, which the ~ipad key is meaningless without', () => {
    expect(config.ios.supportsTablet).toBe(true)
  })

  it('leaves requireFullScreen alone, which is what allows Split View', () => {
    // Apple deprecated UIRequiresFullScreen in iPadOS 26 (TN3192) and the
    // default is false; setting it true is what would make the app refuse to
    // be split-screened, so its absence is the assertion.
    expect(config.ios.requireFullScreen).toBeUndefined()
    expect(config.ios.infoPlist['UIRequiresFullScreen']).toBeUndefined()
  })

  it('does not reach for expo-screen-orientation, which a static mask does not need', () => {
    const plugins = (config as unknown as { plugins: unknown[] }).plugins
    const named = plugins.map(one => (Array.isArray(one) ? one[0] : one))
    expect(named).not.toContain('expo-screen-orientation')
  })
})
