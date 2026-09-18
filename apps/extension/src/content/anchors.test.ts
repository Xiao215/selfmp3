// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { findAnchor, siteOf, type IsVisible } from './anchors.js'

/**
 * The page skeletons are the shapes the live pages had when this was tried
 * against them (docs/features/browser-extension.md, "What the spike settled", question 4) — ids, classes, `hidden`
 * and nesting, and nothing else.
 *
 * jsdom has no layout, so visibility here is "not inside something hidden",
 * which is what the fixtures are about; the real one also measures the element.
 */
const visible: IsVisible = element => !element.closest('[hidden]')

const watchPage = (attributes = ''): string => `
  <ytd-watch-flexy ${attributes}>
    <ytd-watch-metadata>
      <div id="above-the-fold">
        <div id="top-row">
          <div id="owner"><ytd-video-owner-renderer></ytd-video-owner-renderer></div>
          <div id="actions"><div id="actions-inner"><div id="menu">
            <div id="top-level-buttons-computed"></div>
          </div></div></div>
        </div>
      </div>
    </ytd-watch-metadata>
  </ytd-watch-flexy>`

const draw = (html: string): Document => {
  document.body.innerHTML = html
  return document
}

describe('siteOf', () => {
  it('knows the three sites the pill goes on, and nowhere else', () => {
    expect(siteOf('www.youtube.com')).toBe('www')
    expect(siteOf('m.youtube.com')).toBe('mobile')
    expect(siteOf('music.youtube.com')).toBe('music')
    expect(siteOf('youtube.com')).toBe('www')
    expect(siteOf('example.com')).toBeNull()
  })
})

describe('findAnchor', () => {
  it('puts the pill in the button row, left of Like', () => {
    const found = findAnchor(draw(watchPage()), 'www', visible)
    expect(found?.element.id).toBe('top-level-buttons-computed')
    expect(found?.anchor.where).toBe('prepend')
  })

  it('falls back to the owner row when the buttons are not drawn yet', () => {
    const page = watchPage().replace('<div id="top-level-buttons-computed"></div>', '')
    expect(findAnchor(draw(page), 'www', visible)?.element.id).toBe('owner')
  })

  it('ignores the watch page left behind, hidden, after you navigate away', () => {
    // YouTube keeps the old one in the DOM; a match there is not a place on screen.
    const page = `${watchPage('hidden')}<ytd-browse></ytd-browse>`
    expect(findAnchor(draw(page), 'www', visible)).toBeNull()
  })

  it('prefers the player bar buttons that stay visible on YouTube Music', () => {
    const bar = (middle = '') => `
      <ytmusic-player-bar>
        <div class="middle-controls">${middle}</div>
        <div class="right-controls"><div class="right-controls-buttons"></div></div>
      </ytmusic-player-bar>`
    const withMiddle = bar('<div class="middle-controls-buttons"></div>')
    expect(findAnchor(draw(withMiddle), 'music', visible)?.element.className).toBe(
      'right-controls-buttons',
    )
    // During an ad the middle buttons are hidden; the right ones are not.
    const advert = bar('<div class="middle-controls-buttons" hidden></div>')
    expect(findAnchor(draw(advert), 'music', visible)?.element.className).toBe(
      'right-controls-buttons',
    )
  })

  it('finds nowhere to put it when the player bar is gone, and says so', () => {
    // Below about 600px YouTube Music has no bar at all: no pill, no looking again.
    expect(findAnchor(draw('<ytmusic-app></ytmusic-app>'), 'music', visible)).toBeNull()
  })

  it('finds the action bar on the phone site', () => {
    const mobile = `
      <ytm-slim-video-action-bar-renderer>
        <div class="slim-video-action-bar-actions"></div>
      </ytm-slim-video-action-bar-renderer>`
    expect(findAnchor(draw(mobile), 'mobile', visible)?.element.className).toBe(
      'slim-video-action-bar-actions',
    )
  })
})
