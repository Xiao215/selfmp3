import { describe, expect, it } from 'vitest'
import { IOS_INSTALL_LINK, iosAssetUrl, iphoneKey, renderIosManifest } from './iosApp.js'

describe('the iPhone app for friends', () => {
  it('keeps every build at one address, on its own release', () => {
    expect(iosAssetUrl('selfmp3.ipa')).toBe(
      'https://github.com/Xiao215/selfmp3/releases/download/ios/selfmp3.ipa',
    )
  })

  it('installs through the manifest, its address encoded whole', () => {
    expect(IOS_INSTALL_LINK).toBe(
      'itms-services://?action=download-manifest&url=https%3A%2F%2Fgithub.com%2FXiao215%2Fselfmp3%2Freleases%2Fdownload%2Fios%2Fmanifest.plist',
    )
  })

  it('lists an iPhone by a hash of its ID, the same however the ID is written', async () => {
    const key = await iphoneKey('00008140-00094D0436F3001C')
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    expect(await iphoneKey('00008140-00094d0436f3001c')).toBe(key)
    expect(key).not.toContain('00008140')
  })

  it('writes a manifest that names the app and escapes what it quotes', () => {
    const manifest = renderIosManifest({
      url: 'https://example.com/a.ipa?x=1&y=2',
      bundleId: 'com.selfmp3.app',
      version: '1.0.0',
      title: 'self.mp3',
    })
    expect(manifest).toContain('<string>software-package</string>')
    expect(manifest).toContain('<string>https://example.com/a.ipa?x=1&amp;y=2</string>')
    expect(manifest).toContain('<string>com.selfmp3.app</string>')
  })
})
