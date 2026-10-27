import { beforeEach, describe, expect, it, vi } from 'vitest'

const openExternal = vi.hoisted(() => vi.fn<(url: string) => Promise<void>>(async () => {}))

vi.mock('electron', () => ({
  BrowserWindow: class {},
  screen: {},
  shell: { openExternal },
}))

const { openOutside, outsideAddress } = await import('./window.js')

describe('openOutside', () => {
  beforeEach(() => openExternal.mockClear())

  it('hands a web address to the browser', () => {
    openOutside('https://example.com/docs')
    openOutside('http://localhost:4600/')
    expect(openExternal.mock.calls).toEqual([
      ['https://example.com/docs'],
      ['http://localhost:4600/'],
    ])
  })

  it('opens nothing else', () => {
    for (const url of ['file:///etc/hosts', 'javascript:alert(1)', 'mailto:a@example.com']) {
      openOutside(url)
    }
    expect(openExternal).not.toHaveBeenCalled()
  })
})

describe('outsideAddress', () => {
  const own = ['app://selfmp3', 'http://localhost:8081']

  it("keeps the app's own screens in the window", () => {
    for (const url of [
      'app://selfmp3',
      'app://selfmp3/',
      'app://selfmp3/library',
      'app://selfmp3/playlists/52',
      'http://localhost:8081/settings',
    ]) {
      expect(outsideAddress(url, own)).toBeNull()
    }
  })

  it('sends the plain pages beside the app to where they are published', () => {
    expect(outsideAddress('app://selfmp3/privacy.html', own)).toBe(
      'https://xiao215.github.io/selfmp3/privacy.html',
    )
    expect(outsideAddress('app://selfmp3/bucket.html', own)).toBe(
      'https://xiao215.github.io/selfmp3/bucket.html',
    )
    expect(outsideAddress('http://localhost:8081/install/', own)).toBe(
      'https://xiao215.github.io/selfmp3/install/',
    )
  })

  it('sends anywhere else out as it is', () => {
    expect(outsideAddress('https://example.com/docs', own)).toBe('https://example.com/docs')
    expect(outsideAddress('app://selfmp3.example/privacy.html', own)).toBe(
      'app://selfmp3.example/privacy.html',
    )
  })
})
