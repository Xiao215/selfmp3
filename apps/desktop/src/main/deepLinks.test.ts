import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { DEEP_LINK_SCHEME } from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'

import {
  DeepLinks,
  deepLinkFromArgv,
  followPage,
  type LinkPage,
  type NavigationStart,
} from './deepLinks.js'

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

type Listener = (details: NavigationStart) => void

/** A window's page, as far as `followPage` sees one: events to fire, and what it was sent. */
function fakePage(): LinkPage & {
  fire(event: string, details?: Partial<NavigationStart>): void
  sent: string[]
} {
  const listeners = new Map<string, Listener[]>()
  const sent: string[] = []
  return {
    sent,
    on(event: string, listener: Listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
    },
    send(_channel: string, url: string) {
      sent.push(url)
    },
    fire(event, details) {
      // A new document in the window's own frame, unless the test says otherwise.
      const full = { isMainFrame: true, isSameDocument: false, ...details }
      for (const listener of listeners.get(event) ?? []) listener(full)
    },
  }
}

describe('followPage', () => {
  it('holds a cold launch link until the page has loaded', () => {
    const links = new DeepLinks()
    const page = fakePage()
    followPage(links, page, 'deep-link')
    page.fire('did-start-navigation')
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
    page.fire('did-start-navigation')
    links.deliver('selfmp3://now-playing')
    expect(page.sent).toEqual([])
    page.fire('did-finish-load')
    expect(page.sent).toEqual(['selfmp3://now-playing'])
  })

  /*
   * The router moving between pages is a `pushState`: Electron says a load
   * started and never says it finished. Holding links on that held every link
   * after the first page change until the next reload.
   */
  it('keeps delivering after the page changes pages without loading', () => {
    const links = new DeepLinks()
    const page = fakePage()
    followPage(links, page, 'deep-link')
    page.fire('did-start-navigation')
    page.fire('did-finish-load')
    page.fire('did-start-loading')
    page.fire('did-start-navigation', { isSameDocument: true })
    links.deliver('selfmp3://playlist/9')
    expect(page.sent).toEqual(['selfmp3://playlist/9'])
  })

  it('keeps delivering while a frame inside the page loads', () => {
    const links = new DeepLinks()
    const page = fakePage()
    followPage(links, page, 'deep-link')
    page.fire('did-finish-load')
    page.fire('did-start-navigation', { isMainFrame: false })
    links.deliver('selfmp3://now-playing')
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

describe('the scheme the app is built to answer to', () => {
  /*
   * Declared in electron-builder.yml so the packaged app's Info.plist names it.
   * Without the declaration, a sign-in finished in the browser could not open
   * an app that had never been launched to claim the scheme for itself.
   */
  it('is the one the shell claims and the doorman sends sign-ins back to', () => {
    const config = readFileSync(
      fileURLToPath(new URL('../../electron-builder.yml', import.meta.url)),
      'utf8',
    )
    const declared = /^protocols:\n(?:\s+.*\n)*?\s+schemes:\n\s+- (\S+)$/m.exec(config)?.[1]
    expect(declared).toBe(DEEP_LINK_SCHEME)
  })
})
