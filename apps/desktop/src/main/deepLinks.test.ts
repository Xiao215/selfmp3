import { describe, expect, it } from 'vitest'

import { DeepLinks, deepLinkFromArgv } from './deepLinks.js'

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
    links.listen(url => seen.push(url))
    expect(seen).toEqual(['selfmp3://welcome#signin-code=A-B'])
  })

  it('delivers straight through once someone is listening', () => {
    const links = new DeepLinks()
    const seen: string[] = []
    links.listen(url => seen.push(url))
    links.deliver('selfmp3://now-playing')
    expect(seen).toEqual(['selfmp3://now-playing'])
  })

  it('hands each held link over once and no more', () => {
    const links = new DeepLinks()
    links.deliver('selfmp3://one')
    const first: string[] = []
    links.listen(url => first.push(url))
    const second: string[] = []
    links.listen(url => second.push(url))
    expect(first).toEqual(['selfmp3://one'])
    expect(second).toEqual([])
  })

  it('ignores nothing arriving', () => {
    const links = new DeepLinks()
    const seen: string[] = []
    links.listen(url => seen.push(url))
    links.deliver(null)
    expect(seen).toEqual([])
  })
})
