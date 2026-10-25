import { describe, expect, it } from 'vitest'
import { IOS_INSTALL_LINK } from './iosApp.js'
import { INSTALL_PAGE_FONTS, renderInstallPage } from './installPage.js'

describe('the iPhone install page', () => {
  it('points at the doorman for the ID and at the manifest for the app', () => {
    const page = renderInstallPage('https://doorman.example')
    expect(page).toContain('href="https://doorman.example/v1/device"')
    expect(page).toContain(`href="${IOS_INSTALL_LINK.replace(/&/g, '&amp;')}"`)
  })

  it('loads only what sits beside it: its fonts and the icon, from nowhere else', () => {
    const page = renderInstallPage()
    for (const font of Object.keys(INSTALL_PAGE_FONTS)) expect(page).toContain(`../fonts/${font}`)
    expect(page).not.toMatch(/(?:src|href)="https?:\/\/(?!selfmp3-doorman)/)
    expect(page).not.toMatch(/url\(https?:/)
  })

  it('tells WeChat, other iPhone browsers and computers where to open it', () => {
    const page = renderInstallPage()
    expect(page).toContain('MicroMessenger')
    expect(page).toContain('Open in Safari')
    expect(page).toContain('CriOS')
  })
})
