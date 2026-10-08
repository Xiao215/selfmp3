import { describe, expect, it } from 'vitest'
import { ApiError } from '@selfmp3/client'

import {
  accentName,
  activeSection,
  ALL_SECTIONS,
  crossfadeLabel,
  devicePlace,
  downloadHint,
  healthLine,
  indexIdFor,
  landingOffset,
  RECENT_DEVICE_WINDOW_MS,
  soundHint,
  analysisProgress,
  scanHint,
  sectionsFor,
  settingsIndex,
  splitDevices,
} from './settings.model'

const ALL_LABEL = (id: string): string | undefined =>
  ALL_SECTIONS.find(section => section.id === id)?.label

const TOPS = [
  { id: 'a', top: 0 },
  { id: 'b', top: 600 },
  { id: 'c', top: 1200 },
  { id: 'd', top: 1500 },
]

describe('settings', () => {
  it('leaves out the server sections for a library in the cloud, but not Devices', () => {
    const ids = sectionsFor({ fromCloud: true }).map(section => section.id)
    expect(ids).toContain('playback')
    expect(ids).not.toContain('importing')
    expect(ids).not.toContain('cloud')
    // Found through the server the way Import finds it, or the last list kept here.
    expect(ids).toContain('devices')
    // Smart features too: Ask reaches the server from a cloud library, and so does its Test.
    expect(ids).toContain('smart')
    expect(sectionsFor({ fromCloud: false })).toHaveLength(12)
    expect(
      sectionsFor({ fromCloud: false, installed: false }).map(section => section.id),
    ).not.toContain('offline')
  })

  it('lists keyboard shortcuts only in the installed app, which has a menu of them', () => {
    const ids = (device: Parameters<typeof sectionsFor>[0]) =>
      sectionsFor(device).map(section => section.id)
    // A browser tab has a keyboard and no shortcuts of its own.
    expect(ids({ fromCloud: false, installed: false, keyboard: true, shell: false })).not.toContain(
      'shortcuts',
    )
    expect(ids({ fromCloud: false, installed: true, keyboard: false, shell: true })).not.toContain(
      'shortcuts',
    )
    expect(ids({ fromCloud: false, installed: true, keyboard: true, shell: true })).toContain(
      'shortcuts',
    )
    expect(ALL_LABEL('shortcuts')).toBe('Keyboard shortcuts')
  })

  it('leads with the account and the look, then what this device keeps (P38, C17)', () => {
    expect(sectionsFor({ fromCloud: false }).map(section => section.label)).toEqual([
      'Account',
      'Appearance',
      'On this phone',
      'Devices',
      'Playback',
      'Smart features',
      'Lyrics',
      'About',
      'Library',
      'Importing',
      'Cloud',
      'Model',
    ])
    const computer = sectionsFor({
      fromCloud: false,
      shell: true,
      place: devicePlace('desktop'),
    })
    expect(computer.find(section => section.id === 'offline')?.label).toBe('On this computer')
    expect(devicePlace('phone')).toBe('phone')
    expect(devicePlace('other')).toBe('computer')
  })

  it('puts what runs the server under one Advanced chip at the end (O1)', () => {
    const sections = sectionsFor({ fromCloud: false, shell: true })
    expect(settingsIndex(sections).map(section => section.label)).toEqual([
      'Account',
      'Appearance',
      'On this phone',
      'Devices',
      'Playback',
      'Smart features',
      'Lyrics',
      'Keyboard shortcuts',
      'About',
      'Advanced',
    ])
    expect(indexIdFor('cloud', sections)).toBe('advanced')
    expect(indexIdFor('desktop', sections)).toBe('advanced')
    expect(indexIdFor('lyrics', sections)).toBe('lyrics')
    // A cloud library still has the model under it, so Advanced is never empty.
    expect(settingsIndex(sectionsFor({ fromCloud: true })).at(-1)?.id).toBe('advanced')
  })

  it('shows the desktop section only where there is a shell to ask', () => {
    expect(sectionsFor({ fromCloud: false }).map(section => section.id)).not.toContain('desktop')
    expect(sectionsFor({ fromCloud: false, shell: true }).map(section => section.id)).toContain(
      'desktop',
    )
  })

  it('offers the Mac app only to a browser tab on a Mac, in the desktop section\u2019s place', () => {
    expect(sectionsFor({ fromCloud: false }).map(section => section.id)).not.toContain('getApp')
    const tab = sectionsFor({
      fromCloud: false,
      installed: false,
      place: 'computer',
      offered: true,
    }).map(section => section.id)
    expect(tab).toContain('getApp')
    expect(tab).not.toContain('desktop')
    expect(tab.at(-1)).toBe('getApp')
    expect(ALL_LABEL('getApp')).toBe('Mac app')
  })

  it('tells a browser that cannot name its chip how to find out', () => {
    const base = { loading: false, error: false, version: '1.0.0', offers: 2 }
    expect(downloadHint({ ...base, chip: 'arm64' })).toMatch(/^Version 1\.0\.0\. /)
    expect(downloadHint({ ...base, chip: 'arm64' })).not.toContain('About This Mac')
    expect(downloadHint({ ...base, chip: null })).toContain('About This Mac')
    expect(downloadHint({ ...base, offers: 0, chip: null })).toBe('No release yet.')
    expect(downloadHint({ ...base, loading: true, chip: null })).toBe('Finding the latest version…')
    expect(downloadHint({ ...base, error: true, chip: null })).toContain('releases page')
  })

  it('picks the last section past the reading line', () => {
    expect(activeSection(TOPS, 0, 800, 2400)).toBe('a')
    expect(activeSection(TOPS, 520, 800, 2400)).toBe('b')
  })

  it('lands a chosen section under whatever covers the top, and past the reading line', () => {
    // Beside the index column: under the page's 28pt top padding.
    expect(landingOffset(1250, 28)).toBe(1222)
    // Narrow: under the sticky chips (53pt) and their 14pt gap.
    expect(landingOffset(1780, 67)).toBe(1713)
    // Near the start the page cannot scroll above itself.
    expect(landingOffset(40, 67)).toBe(0)
    // Once there, the scroll-spy agrees it is the section being read.
    const tops = [
      { id: 'a', top: 0 },
      { id: 'b', top: 1250 },
      { id: 'c', top: 1900 },
    ]
    expect(activeSection(tops, landingOffset(1250, 67), 800, 3200)).toBe('b')
  })

  it('gives the short last sections their turn over the final screenful', () => {
    // At the very bottom the line is the bottom edge, so the last section wins.
    expect(activeSection(TOPS, 1600, 800, 2400)).toBe('d')
    expect(activeSection([], 0, 800, 2400)).toBeNull()
  })

  it('words the rows', () => {
    expect(crossfadeLabel(0)).toBe('off')
    expect(crossfadeLabel(4)).toBe('4s')
    expect(accentName(330, [{ hue: 330, name: 'Pink' }])).toBe('Pink')
    expect(accentName(30, [{ hue: 330, name: 'Pink' }])).toBe('Hue 30°')
  })

  it('says it is checking while it checks, and which side it could not reach', () => {
    expect(healthLine(undefined, { loading: true })).toBe('Checking your library…')
    expect(healthLine(undefined, { error: true })).toBe('Can’t reach your library')
    expect(healthLine(undefined, { error: true, fromCloud: true })).toBe('Can’t reach your library')
    const capped = new ApiError(502, 'cap exceeded', 'bucket_cap_exceeded')
    const now = new Date('2026-10-08T04:00:00Z')
    expect(healthLine(undefined, { error: capped, fromCloud: true, now })).toBe(
      'Storage allowance used up · resets in about 20 hours',
    )
  })

  it('says the bucket is refusing over a doorman that answered, shorter on a phone', () => {
    const doorman = { ok: true as const, version: 'web', uptimeSeconds: 0 }
    const now = new Date('2026-10-08T04:00:00Z')
    expect(healthLine(doorman, { fromCloud: true })).toBe('self.mp3 web')
    expect(healthLine(doorman, { fromCloud: true, capped: true, now })).toBe(
      'Storage allowance used up · resets in about 20 hours',
    )
    expect(healthLine(doorman, { fromCloud: true, capped: true, compact: true, now })).toBe(
      'Storage allowance used up · 20 h left',
    )
  })

  it('keeps this device, what is online and the last week, and folds the rest away', () => {
    const now = 100 * RECENT_DEVICE_WINDOW_MS
    const row = (id: string, ageMs: number, online = false) => ({
      device: { id, online, lastSeenAt: now - ageMs },
      ids: [id],
    })
    const rows = [
      row('me', 30 * RECENT_DEVICE_WINDOW_MS),
      row('phone', 0, true),
      row('mac', RECENT_DEVICE_WINDOW_MS - 1),
      row('old', RECENT_DEVICE_WINDOW_MS + 1),
    ]
    const { recent, older } = splitDevices(rows, 'me', now)
    expect(recent.map(entry => entry.device.id)).toEqual(['me', 'phone', 'mac'])
    expect(older.map(entry => entry.device.id)).toEqual(['old'])
  })

  it('says what it is connected to', () => {
    expect(healthLine(undefined)).toBe('Not connected to your library right now')
    expect(
      healthLine({
        ok: true,
        version: '1.0.0',
        uptimeSeconds: 5,
        songCount: 13,
      }),
    ).toBe('self.mp3 1.0.0 · 13 songs')
    expect(scanHint({ added: 1, updated: 2, total: 13, durationMs: 40 })).toBe(
      'Last scan: 1 new, 2 updated.',
    )
  })
})

describe('soundHint', () => {
  const sound = { state: 'ready' as const, heard: 40, pending: 2, message: null }

  it('counts the songs heard and the ones to go', () => {
    expect(soundHint(sound, 42)).toBe('40 of 42 songs heard · 2 to go')
    expect(soundHint({ ...sound, heard: 42, pending: 0 }, 42)).toBe('42 of 42 songs heard')
  })

  it('says why the model is not there yet', () => {
    expect(soundHint({ ...sound, state: 'fetching' }, 42)).toMatch(/about 750 MB/)
    expect(soundHint({ ...sound, state: 'waiting' }, 42)).toMatch(/once every song has tempo/)
    expect(soundHint({ ...sound, state: 'off' }, 42)).toBe('Switched off on this server.')
    expect(
      soundHint({ ...sound, state: 'failed', message: 'downloading mert.onnx failed: 404' }, 42),
    ).toMatch(/get the model: downloading mert.onnx failed: 404\. Tries again hourly\.$/)
  })
})

describe('analysisProgress', () => {
  const status = {
    running: true,
    pending: 3,
    done: 1,
    failed: 0,
    current: { id: 1, title: '晴天' },
    sound: { state: 'ready' as const, heard: 0, pending: 40, message: null },
  }

  it('says it is measuring while songs still need their tempo and key', () => {
    expect(analysisProgress(status)).toBe('Analysing — 晴天 · 3 to go')
  })

  it('says it is listening once they all have them', () => {
    expect(analysisProgress({ ...status, pending: 0 })).toBe('Listening — 晴天 · 40 to go')
    expect(
      analysisProgress({
        ...status,
        pending: 0,
        current: null,
        sound: { ...status.sound, pending: 0 },
      }),
    ).toBe('Analysing…')
  })
})
