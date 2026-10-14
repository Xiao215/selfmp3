import { beforeEach, describe, expect, it, vi } from 'vitest'

const openExternal = vi.hoisted(() => vi.fn<(url: string) => Promise<void>>(async () => {}))

vi.mock('electron', () => ({
  BrowserWindow: class {},
  screen: {},
  shell: { openExternal },
}))

const { openOutside } = await import('./window.js')

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
