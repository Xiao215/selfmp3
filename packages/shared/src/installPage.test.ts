import { describe, expect, it } from 'vitest'
import { ANDROID_DOWNLOAD_URL } from './androidApp.js'
import { IOS_INSTALL_LINK } from './iosApp.js'
import { INSTALL_PAGE_FONTS, renderInstallPage } from './installPage.js'

describe('the phone install page', () => {
  it('points at the doorman for the ID and at the manifest for the iPhone app', () => {
    const page = renderInstallPage('https://doorman.example')
    expect(page).toContain('href="https://doorman.example/v1/device"')
    expect(page).toContain(`href="${IOS_INSTALL_LINK.replace(/&/g, '&amp;')}"`)
  })

  it('downloads the Android app from its release', () => {
    expect(renderInstallPage()).toContain(`href="${ANDROID_DOWNLOAD_URL}"`)
  })

  it('loads only what sits beside it: its fonts and the icon, from nowhere else', () => {
    const page = renderInstallPage()
    for (const font of Object.keys(INSTALL_PAGE_FONTS)) expect(page).toContain(`../fonts/${font}`)
    expect(page).not.toMatch(/src="https?:/)
    expect(page).not.toMatch(/<link[^>]+href="https?:/)
    expect(page).not.toMatch(/url\(https?:/)
  })

  it('has a script a browser can run', () => {
    const script = /<script>([\s\S]*)<\/script>/.exec(renderInstallPage())?.[1] ?? ''
    expect(() => new Function(script)).not.toThrow()
    expect(script).toContain('/\\bQQ\\/|MQQBrowser/i')
  })

  it('picks the phone from the address, then from the phone it is open on', () => {
    const page = renderInstallPage()
    expect(page).toContain("named === 'android'")
    expect(page).toContain('/Android/i.test(ua)')
  })

  it('tells WeChat, other iPhone browsers and computers where to open it', () => {
    const page = renderInstallPage()
    expect(page).toContain('MicroMessenger')
    expect(page).toContain('Open in Safari')
    expect(page).toContain('Open in Browser')
    expect(page).toContain('CriOS')
  })
})
