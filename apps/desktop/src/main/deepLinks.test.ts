import { describe, expect, it } from 'vitest'

import { DeepLinks, deepLinkFromArgv, followPage, type LinkPage } from './deepLinks.js'

describe('deepLinkFromArgv', () => {
  it('finds the URL wherever the OS put it', () => {
    expect(
      deepLinkFromArgv(['/Applications/self.mp3.app', 'selfmp3://welcome#signin-code=A-B']),
    ).toBe('selfmp3://welcome#signin-code=A-B')
    expect(deepLinkFromArgv(['electron', '.', '--inspect', 'selfmp3://now-playing'])).toBe(
      'selfmp3://now-playing',
    )
  })

  it('answers null for an ordinary launch', () => {
    expect(deepLinkFromArgv(['/Applications/self.mp3.app'])).toBeNull()
  })

  it('ignores a URL of some other scheme', () => {
    expect(deepLinkFromArgv(['app', 'https://example.com'])).toBeNull()
  })
})

describe('DeepLinks', () => {
  it('holds what arrives before the page is listening, which is the cold launch', () => {
    const links = new DeepLinks()
    links.deliver('selfmp3://welcome#signin-code=A-B')
    const seen: string[] = []
    links.ready(url => seen.push(url))
    expect(seen).toEqual(['selfmp3://welcome#signin-code=A-B'])
  })

  it('delivers straight through once someone is listening', () => {
    const links = new DeepLinks()
    const seen: string[] = []
    links.ready(url => seen.push(url))
    links.deliver('selfmp3://now-playing')
    expect(seen).toEqual(['selfmp3://now-playing'])
  })

  it('hands each held link over once and no more', () => {
    const links = new DeepLinks()
    links.deliver('selfmp3://one')
    const first: string[] = []
    links.ready(url => first.push(url))
    const second: string[] = []
    links.ready(url => second.push(url))
    expect(first).toEqual(['selfmp3://one'])
    expect(second).toEqual([])
  })

  it('ignores nothing arriving', () => {
    const links = new DeepLinks()
    const seen: string[] = []
    links.ready(url => seen.push(url))
    links.deliver(null)
    expect(seen).toEqual([])
  })
})

/** A window's page, as far as `followPage` sees one: events to fire, and what it was sent. */
function fakePage(): LinkPage & { fire(event: string): void; sent: string[] } {
  const listeners = new Map<string, (() => void)[]>()
  const sent: string[] = []
  return {
    sent,
    on(event, listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
    },
    send(_channel, url) {
      sent.push(url)
    },
    fire(event) {
      for (const listener of listeners.get(event) ?? []) listener()
    },
  }
}

describe('followPage', () => {
  it('holds a cold launch link until the page has loaded', () => {
    const links = new DeepLinks()
    const page = fakePage()
    followPage(links, page, 'deep-link')
    page.fire('did-start-loading')
    links.deliver('selfmp3://welcome#signin-code=A-B')
    expect(page.sent).toEqual([])
    page.fire('did-finish-load')
    expect(page.sent).toEqual(['selfmp3://welcome#signin-code=A-B'])
  })

  it('holds links again while the page reloads', () => {
    const links = new DeepLinks()
    const page = fakePage()
    followPage(links, page, 'deep-link')
    page.fire('did-finish-load')
    page.fire('did-start-loading')
    links.deliver('selfmp3://now-playing')
    expect(page.sent).toEqual([])
    page.fire('did-finish-load')
    expect(page.sent).toEqual(['selfmp3://now-playing'])
  })

  it('hands the stream to a window made again', () => {
    const links = new DeepLinks()
    const first = fakePage()
    followPage(links, first, 'deep-link')
    first.fire('did-finish-load')
    first.fire('destroyed')
    links.deliver('selfmp3://one')

    const second = fakePage()
    followPage(links, second, 'deep-link')
    second.fire('did-finish-load')
    expect(first.sent).toEqual([])
    expect(second.sent).toEqual(['selfmp3://one'])
  })
})
