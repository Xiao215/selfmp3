import { describe, expect, it } from 'vitest'
import {
  IOS_INSTALL_LINK,
  IOS_INSTALL_PAGE_URL,
  fetchIosLatest,
  iosAssetUrl,
  isNewerIosBuild,
  iphoneKey,
  renderIosManifest,
  type IosLatest,
} from './iosApp.js'

const latest = (build: number): IosLatest => ({
  version: '1.0.0',
  build,
  commit: 'abc1234',
  publishedAt: '2026-10-24T00:00:00Z',
  devices: [],
})

const answer = (status: number, body: unknown = {}): typeof fetch =>
  (() => Promise.resolve(new Response(JSON.stringify(body), { status }))) as typeof fetch

describe('the iPhone app for friends', () => {
  it('keeps every build at one address, on its own release', () => {
    expect(iosAssetUrl('selfmp3.ipa')).toBe(
      'https://github.com/Xiao215/selfmp3/releases/download/ios/selfmp3.ipa',
    )
    expect(IOS_INSTALL_PAGE_URL).toBe('https://xiao215.github.io/selfmp3/install/')
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

  it('offers a build only when it is later than this one', () => {
    expect(isNewerIosBuild(latest(120), 119)).toBe(true)
    expect(isNewerIosBuild(latest(120), 120)).toBe(false)
    expect(isNewerIosBuild(latest(120), 121)).toBe(false)
    expect(isNewerIosBuild(null, 1)).toBe(false)
    expect(isNewerIosBuild(latest(120), Number.NaN)).toBe(false)
  })

  it('reads the release’s build, and takes no release or a strange answer as none', async () => {
    await expect(fetchIosLatest(answer(200, latest(7)))).resolves.toEqual(latest(7))
    await expect(fetchIosLatest(answer(404))).resolves.toBeNull()
    await expect(fetchIosLatest(answer(200, { build: 'seven' }))).resolves.toBeNull()
    await expect(fetchIosLatest(answer(503))).rejects.toThrow('503')
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
