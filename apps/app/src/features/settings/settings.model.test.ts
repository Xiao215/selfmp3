import { describe, expect, it } from 'vitest'

import {
  accentName,
  activeSection,
  ALL_SECTIONS,
  crossfadeLabel,
  devicePlace,
  healthLine,
  landingOffset,
  RECENT_DEVICE_WINDOW_MS,
  scanHint,
  sectionsFor,
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
    const ids = sectionsFor(true).map(section => section.id)
    expect(ids).toContain('playback')
    expect(ids).not.toContain('importing')
    expect(ids).not.toContain('cloud')
    // Found through the server the way Import finds it, or the last list kept here.
    expect(ids).toContain('devices')
    expect(sectionsFor(false)).toHaveLength(10)
    expect(sectionsFor(false, false).map(section => section.id)).not.toContain('offline')
  })

  it('lists keyboard shortcuts only in the installed app, which has a menu of them', () => {
    const ids = (...args: Parameters<typeof sectionsFor>) =>
      sectionsFor(...args).map(section => section.id)
    // A browser tab has a keyboard and no shortcuts of its own.
    expect(ids(false, false, true, false)).not.toContain('shortcuts')
    expect(ids(false, true, false, true)).not.toContain('shortcuts')
    expect(ids(false, true, true, true)).toContain('shortcuts')
    expect(ALL_LABEL('shortcuts')).toBe('Keyboard shortcuts')
  })

  it('leads with the account and the look, then what this device keeps (P38, C17)', () => {
    expect(sectionsFor(false).map(section => section.label)).toEqual([
      'Account',
      'Appearance',
      'On this phone',
      'Devices',
      'Playback',
      'Library',
      'Importing',
      'Cloud',
      'Lyrics',
      'About',
    ])
    const computer = sectionsFor(false, true, true, true, devicePlace('desktop'))
    expect(computer.find(section => section.id === 'offline')?.label).toBe('On this computer')
    expect(devicePlace('phone')).toBe('phone')
    expect(devicePlace('other')).toBe('computer')
  })

  it('shows the desktop section only where there is a shell to ask', () => {
    expect(sectionsFor(false).map(section => section.id)).not.toContain('desktop')
    expect(sectionsFor(false, true, true, true).map(section => section.id)).toContain('desktop')
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
    expect(healthLine(undefined, { error: true })).toBe('Can’t reach your server')
    expect(healthLine(undefined, { error: true, fromCloud: true })).toBe('Can’t reach the cloud')
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
        storageDriver: 'local',
        songCount: 13,
      }),
    ).toBe('self.mp3 1.0.0 · 13 songs · local storage')
    expect(scanHint({ added: 1, updated: 2, total: 13, durationMs: 40 })).toBe(
      'Last sweep found 1 new and 2 updated; 13 songs in the library.',
    )
  })
})
