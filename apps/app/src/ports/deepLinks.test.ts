import { describe, expect, it } from 'vitest'

import {} from './deepLinks.web'
import { routeFor } from './deepLinkRoute.model'

/**
 * What a `selfmp3://` link means. Worth a test rather than a glance: these
 * arrive from outside the app — a link in a note, another app, a stale
 * bookmark — and the one thing that must not happen is a link talking the app
 * into a route it made up.
 */
describe('routeFor', () => {
  it('knows the two routes the app publishes', () => {
    expect(routeFor('selfmp3://now-playing')).toEqual({ kind: 'now-playing' })
    expect(routeFor('selfmp3://playlist/12')).toEqual({ kind: 'playlist', id: '12' })
  })

  it('forgives a trailing slash, which is what a browser adds', () => {
    expect(routeFor('selfmp3://now-playing/')).toEqual({ kind: 'now-playing' })
    expect(routeFor('selfmp3://playlist/12/')).toEqual({ kind: 'playlist', id: '12' })
  })

  it('takes no id that is not a number', () => {
    expect(routeFor('selfmp3://playlist/../settings')).toBeNull()
    expect(routeFor('selfmp3://playlist/%2e%2e%2fsettings')).toBeNull()
    expect(routeFor('selfmp3://playlist/')).toBeNull()
    expect(routeFor('selfmp3://playlist')).toBeNull()
  })

  it('ignores anything else, including a sign-in return', () => {
    expect(routeFor('selfmp3://welcome#signin-code=abc')).toBeNull()
    expect(routeFor('https://example.com/playlist/12')).toBeNull()
    expect(routeFor('selfmp3://settings')).toBeNull()
  })
})
