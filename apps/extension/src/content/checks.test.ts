// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { Site } from './anchors.js'
import { CHECK_TAG, createChecks } from './checks.js'
import { VIDEOS_ATTRIBUTE } from './videoIds.js'

/**
 * The rows are the shapes the live pages had on 2026-10-31 — tags, classes
 * and nesting, and nothing else.
 */

const MINE = 'YQHsXMglC9A'
const NOT_MINE = 'ZRtdQ81jPUQ'

const queueItem = (videos: string) => `
  <ytmusic-player-queue-item ${videos ? `${VIDEOS_ATTRIBUTE}="${videos}"` : ''}>
    <div class="left-items"></div>
    <div class="song-info"><yt-formatted-string class="song-title">A song</yt-formatted-string></div>
    <ytmusic-menu-renderer class="menu"></ytmusic-menu-renderer>
    <yt-formatted-string class="duration">4:01</yt-formatted-string>
  </ytmusic-player-queue-item>`

const listItem = (href: string, durations = true) => `
  <ytmusic-responsive-list-item-renderer>
    <div class="left-items"></div>
    <div class="flex-columns">
      <div class="title-column">
        <yt-formatted-string class="title"><a href="${href}">A song</a></yt-formatted-string>
        <div id="columnar-layout-badges" class="badges"></div>
      </div>
    </div>
    <ytmusic-menu-renderer class="menu"></ytmusic-menu-renderer>
    ${durations ? '<div class="fixed-columns"><yt-formatted-string class="fixed-column">4:11</yt-formatted-string></div>' : ''}
  </ytmusic-responsive-list-item-renderer>`

const panelItem = (videoId: string) => `
  <ytd-playlist-panel-video-renderer>
    <a id="wc-endpoint" href="/watch?v=${videoId}&list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG">
      <div id="container"><div id="meta"><h4><span id="video-title">A video</span></h4></div></div>
    </a>
    <div id="menu"></div>
  </ytd-playlist-panel-video-renderer>`

/** A library of one song, and every question asked of it. */
function setUp(html: string, site: Site = 'music', answer: string[] | null = [MINE]) {
  document.body.innerHTML = html
  const asked: string[][] = []
  let time = 0
  const checks = createChecks({
    document,
    site,
    ask: videoIds => {
      asked.push(videoIds)
      return Promise.resolve(answer && videoIds.filter(id => answer.includes(id)))
    },
    theme: '',
    now: () => time,
  })
  return {
    checks,
    asked,
    later: (ms: number) => {
      time += ms
    },
  }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0))
const rows = (selector: string) => [...document.querySelectorAll(selector)]
const checked = (selector: string) =>
  rows(selector).map(row => row.querySelector(CHECK_TAG) !== null)

describe('the checks on the song rows', () => {
  it('checks the Up next rows that are yours, before the duration, asking once', async () => {
    const { checks, asked } = setUp(queueItem(MINE) + queueItem(NOT_MINE) + queueItem(MINE))
    checks.scan()
    await settle()
    expect(asked).toEqual([[MINE, NOT_MINE]])
    expect(checked('ytmusic-player-queue-item')).toEqual([true, false, true])
    const check = document.querySelector(CHECK_TAG)
    expect(check?.nextElementSibling?.className).toBe('duration')
    expect(check?.getAttribute('aria-label')).toBe('In your self.mp3 library')
  })

  it('checks a row with a Song/Video switch when either half is yours', async () => {
    const { checks } = setUp(queueItem(`${NOT_MINE} ${MINE}`))
    checks.scan()
    await settle()
    expect(checked('ytmusic-player-queue-item')).toEqual([true])
  })

  it('takes the check off a row reused for a song that is not yours', async () => {
    const { checks, asked } = setUp(queueItem(MINE))
    checks.scan()
    await settle()
    const row = document.querySelector('ytmusic-player-queue-item')
    row?.setAttribute(VIDEOS_ATTRIBUTE, NOT_MINE)
    checks.scan()
    await settle()
    expect(checked('ytmusic-player-queue-item')).toEqual([false])
    // Scanning again draws from what is known: the same check, no new question.
    checks.scan()
    checks.scan()
    expect(document.querySelectorAll(CHECK_TAG)).toHaveLength(0)
    expect(asked).toEqual([[MINE], [NOT_MINE]])
  })

  it('checks playlist and search rows, and leaves an artist’s row alone', async () => {
    const { checks, asked } = setUp(
      listItem(`watch?v=${MINE}&list=RDCLAK5uy`) +
        listItem(`watch?v=${MINE}`, false) +
        listItem('browse/UCI6B8NkZKqlFWoiC_xE-hzA', false),
    )
    checks.scan()
    await settle()
    expect(asked).toEqual([[MINE]])
    expect(checked('ytmusic-responsive-list-item-renderer')).toEqual([true, true, false])
    const [inPlaylist, inSearch] = rows(CHECK_TAG)
    // Before the duration where there is one, after the title where there is not.
    expect(inPlaylist?.parentElement?.className).toBe('fixed-columns')
    expect(inPlaylist?.nextElementSibling?.textContent).toBe('4:11')
    expect(inSearch?.previousElementSibling?.className).toBe('title')
  })

  it('checks the playlist beside a YouTube watch page, before the menu', async () => {
    const { checks } = setUp(panelItem(MINE) + panelItem(NOT_MINE), 'www')
    checks.scan()
    await settle()
    expect(checked('ytd-playlist-panel-video-renderer')).toEqual([true, false])
    expect(document.querySelector(CHECK_TAG)?.nextElementSibling?.id).toBe('menu')
  })

  it('checks a song imported from this page at once, without asking', async () => {
    const { checks, asked } = setUp(queueItem(NOT_MINE))
    checks.scan()
    await settle()
    checks.markOwned(NOT_MINE)
    expect(checked('ytmusic-player-queue-item')).toEqual([true])
    expect(asked).toHaveLength(1)
  })

  it('asks again after a few minutes, keeping the check meanwhile', async () => {
    const { checks, asked, later } = setUp(queueItem(MINE))
    checks.scan()
    await settle()
    later(60_000)
    checks.scan()
    expect(asked).toHaveLength(1)
    later(5 * 60_000)
    checks.scan()
    expect(asked).toHaveLength(2)
    expect(checked('ytmusic-player-queue-item')).toEqual([true])
  })

  it('draws nothing, and does not keep asking, when the worker cannot say', async () => {
    const { checks, asked } = setUp(queueItem(MINE), 'music', null)
    checks.scan()
    await settle()
    checks.scan()
    expect(asked).toHaveLength(1)
    expect(document.querySelectorAll(CHECK_TAG)).toHaveLength(0)
  })
})
