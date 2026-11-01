// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { stamp, VIDEOS_ATTRIBUTE, videosOf } from './videoIds.js'

/**
 * The data Polymer hands a queue row is a property set by the page's own
 * script; here it is set by hand, in the shape the live page had on
 * 2026-10-31 (`data.videoId` on the row, the two halves of a Song/Video
 * switch under its wrapper).
 */
function withData<T extends Element>(element: T, data: unknown): T {
  Object.assign(element, { data })
  return element
}

describe('the Up next rows, read in the page’s world', () => {
  it('reads a row’s own video', () => {
    const item = withData(document.createElement('ytmusic-player-queue-item'), {
      videoId: '-7HvsNTYBqA',
      title: { runs: [{ text: 'Sleeping Beauty' }] },
    })
    expect(videosOf(item)).toEqual(['-7HvsNTYBqA'])
  })

  it('reads both halves of a row with a Song/Video switch', () => {
    const wrapper = withData(
      document.createElement('ytmusic-playlist-panel-video-wrapper-renderer'),
      {
        primaryRenderer: { playlistPanelVideoRenderer: { videoId: 'atvATVatvAT' } },
        counterpart: [
          { counterpartRenderer: { playlistPanelVideoRenderer: { videoId: 'omvOMVomvOM' } } },
        ],
      },
    )
    const item = withData(document.createElement('ytmusic-player-queue-item'), {
      videoId: 'atvATVatvAT',
    })
    wrapper.append(item)
    expect(videosOf(item).sort()).toEqual(['atvATVatvAT', 'omvOMVomvOM'])
  })

  it('writes the videos onto the row, and takes them off a row that lost its data', () => {
    document.body.innerHTML = ''
    const item = withData(document.createElement('ytmusic-player-queue-item'), {
      videoId: 'ZRtdQ81jPUQ',
    })
    document.body.append(item)
    stamp(document)
    expect(item.getAttribute(VIDEOS_ATTRIBUTE)).toBe('ZRtdQ81jPUQ')

    // Polymer reuses the row for the next song.
    withData(item, { videoId: 'YQHsXMglC9A' })
    stamp(document)
    expect(item.getAttribute(VIDEOS_ATTRIBUTE)).toBe('YQHsXMglC9A')

    withData(item, undefined)
    stamp(document)
    expect(item.hasAttribute(VIDEOS_ATTRIBUTE)).toBe(false)
  })

  it('ignores anything that is not a video id', () => {
    const item = withData(document.createElement('ytmusic-player-queue-item'), {
      videoId: '<img onerror=x>',
    })
    expect(videosOf(item)).toEqual([])
  })
})
