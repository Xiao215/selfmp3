import { describe, expect, it } from 'vitest'

import {
  dataAnswer,
  downloadAsk,
  LARGE_SYNC_BYTES,
  onWifi,
  playBlock,
  shouldAutoDownload,
  syncHeader,
  syncHeaderText,
  type SyncSituation,
} from './syncPolicy.js'

const MB = 1024 * 1024

const phone: SyncSituation = {
  installed: true,
  network: 'wifi',
  autoOnWifi: true,
  missing: 40,
  missingBytes: 300 * MB,
  queued: 0,
  batchTotal: 0,
  paused: false,
  error: null,
}

describe('downloading automatically', () => {
  it('downloads on Wi-Fi with the setting on', () => {
    expect(shouldAutoDownload(phone)).toBe(true)
    expect(shouldAutoDownload({ ...phone, network: 'unknown' })).toBe(true)
  })

  it('does not on data, offline, with the setting off, or in a browser', () => {
    expect(shouldAutoDownload({ ...phone, network: 'cellular' })).toBe(false)
    expect(shouldAutoDownload({ ...phone, network: 'none' })).toBe(false)
    expect(shouldAutoDownload({ ...phone, autoOnWifi: false })).toBe(false)
    expect(shouldAutoDownload({ ...phone, installed: false })).toBe(false)
  })

  it('waits for a tap over 500 MB, on any connection', () => {
    expect(shouldAutoDownload({ ...phone, missingBytes: LARGE_SYNC_BYTES })).toBe(true)
    expect(shouldAutoDownload({ ...phone, missingBytes: LARGE_SYNC_BYTES + 1 })).toBe(false)
  })

  it('does not start again while running, paused, or after a failure', () => {
    expect(shouldAutoDownload({ ...phone, queued: 3 })).toBe(false)
    expect(shouldAutoDownload({ ...phone, paused: true })).toBe(false)
    expect(shouldAutoDownload({ ...phone, error: 'x: 404' })).toBe(false)
    expect(shouldAutoDownload({ ...phone, missing: 0 })).toBe(false)
  })
})

describe('the header', () => {
  const text = (situation: SyncSituation): string => syncHeaderText(syncHeader(situation)).text

  it('counts through a run', () => {
    expect(text({ ...phone, queued: 29, batchTotal: 40 })).toBe('Downloading 12 of 40')
    expect(syncHeaderText(syncHeader({ ...phone, queued: 1, batchTotal: 0 }))).toEqual({
      text: 'Downloading 1 of 1',
      action: 'Pause',
    })
    expect(text({ ...phone, queued: 29, batchTotal: 40, paused: true })).toBe('Paused at 12 of 40')
  })

  it('says why it is waiting, in Xiao’s words', () => {
    expect(syncHeaderText(syncHeader({ ...phone, network: 'cellular' }))).toEqual({
      text: '40 not downloaded · on data',
      action: 'Download',
    })
    expect(syncHeaderText(syncHeader({ ...phone, network: 'none' }))).toEqual({
      text: '40 not downloaded · offline',
      action: null,
    })
    expect(text({ ...phone, missingBytes: 1.2 * 1024 * MB })).toBe('40 not downloaded · 1.2 GB')
    expect(text({ ...phone, autoOnWifi: false })).toBe('40 not downloaded')
  })

  it('says nothing when there is nothing to say', () => {
    expect(syncHeader({ ...phone, missing: 0 })).toEqual({ kind: 'none' })
    expect(syncHeader(phone)).toEqual({ kind: 'none' })
    // A browser streams; a song it has not kept is not news.
    expect(syncHeader({ ...phone, installed: false, network: 'cellular' })).toEqual({
      kind: 'none',
    })
  })

  it('shows a failure until the next try', () => {
    expect(syncHeaderText(syncHeader({ ...phone, error: 'Idol: 404' }))).toEqual({
      text: 'Idol: 404',
      action: 'Retry',
    })
  })
})

describe('asking', () => {
  it('asks about data once, until Wi-Fi', () => {
    expect(downloadAsk('cellular', false, 10 * MB)).toBe('data')
    expect(downloadAsk('cellular', true, 10 * MB)).toBe('none')
    expect(dataAnswer(true, 'cellular')).toBe(true)
    expect(dataAnswer(true, 'wifi')).toBe(false)
    expect(onWifi('cellular')).toBe(false)
  })

  it('asks about size over 500 MB, and both when both apply', () => {
    expect(downloadAsk('wifi', false, 600 * MB)).toBe('large')
    expect(downloadAsk('cellular', false, 600 * MB)).toBe('data-large')
    expect(downloadAsk('cellular', true, 600 * MB)).toBe('large')
  })
})

describe('playing a song that is not downloaded', () => {
  const song = {
    downloaded: false,
    installed: true,
    network: 'wifi' as const,
    streamUndownloaded: true,
    fromCloud: false,
    dataAllowed: false,
  }

  it('plays a downloaded song whatever else is true', () => {
    expect(playBlock({ ...song, downloaded: true, network: 'none', fromCloud: true })).toBeNull()
  })

  it('streams on Wi-Fi with streaming on', () => {
    expect(playBlock(song)).toBeNull()
  })

  it('says why it cannot', () => {
    expect(playBlock({ ...song, fromCloud: true })).toBe('cloud')
    expect(playBlock({ ...song, network: 'none' })).toBe('offline')
    expect(playBlock({ ...song, streamUndownloaded: false })).toBe('streaming-off')
    expect(playBlock({ ...song, network: 'cellular' })).toBe('data')
    expect(playBlock({ ...song, network: 'cellular', dataAllowed: true })).toBeNull()
  })

  it('always streams in a browser while online', () => {
    expect(
      playBlock({ ...song, installed: false, streamUndownloaded: false, network: 'cellular' }),
    ).toBeNull()
  })
})
